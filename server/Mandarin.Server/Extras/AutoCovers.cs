// AutoCovers.cs — the cover finder (bug list item 409): albums with no cover of
// their own given one from the web, by themselves, as Edit album's Find gives
// one when you press it (ArtFind.cs), and only where that search would pick one
// without asking: a hit that agrees on the title, the artist and the tracks
// ("sure"). Anything less is left for you, in Edit album.
//
// An album is looked at when it has no cover of its own: none in album_edits,
// no picture in its folder, none in its first three tracks (Covers.Own: the
// tests the covers are drawn by, read without drawing). A sure cover is made
// ready as an edit's is (FoundCover: downloaded, a picture, upright, 1500 px at
// most; here 300 px at least too) and kept as one (Library.KeepAutoCover), its
// source auto:itunes, auto:deezer or auto:caa. A folder picture, an embedded
// one, a cover you chose or took away (AutoCoverStore's "owner") is never
// touched, nor are the music files: only the database changes.
//
// What came of each look is kept (AutoCoverStore), so nothing is asked twice:
// an album with nothing sure is asked again after 60 days, or once its tracks
// change. A look a catalogue didn't answer whole (resting, refusing, down) that
// found nothing sure isn't kept: the next run looks again.
//
// When: after a library scan, the albums not looked at yet; each night at three
// (the server's clock), those due again too. Gently: an album a few seconds
// apart (auto_covers_gap_ms, 4000), each catalogue kept to its own pace
// (CoverCatalogues.cs); never while a scan runs or a track is being made as it
// plays (Cpu.MakingNow); ffprobe and ffmpeg on the cores playback doesn't keep
// (Covers.Run). On unless switched off (Settings → Library Scanner → Find
// covers: the setting "autoCovers").
using System.Globalization;
using System.Text.Json.Nodes;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal sealed class AutoCovers(CoverCatalogues ask, int gapMs, Action<string> log)
{
    public const long RetryMs = 60L * 86400000;
    public const int MinSide = 300;
    private const string Setting = "autoCovers";

    /* The finder this server runs (Jobs.cs), or null before the work is set up. */
    public static AutoCovers? Current { get; set; }

    /* Whether this server may go on (the work set up, Jobs.cs). */
    public Func<bool> Ready { get; init; } = () => true;

    private readonly SemaphoreSlim passing = new(1, 1);
    private volatile bool stopped, again, againWide;
    private long lastAsked;
    private string lastNight = "";
    private Timer? nightly;

    /* What one run came to. */
    public sealed record Summary(int Looked, int Found, int None, int Own, int Later);

    // ------------------------------------------------------------ the switch

    /* Find covers: on unless switched off. */
    public static bool On()
    {
        try { using var c = Db.Open(); return Db.Setting(c, Setting) is not JsonValue v || !v.TryGetValue<bool>(out var on) || on; }
        catch (Microsoft.Data.Sqlite.SqliteException) { return false; }
    }

    /* Switched on (a run started) or off (the run under way stops at its next step). */
    public void Set(bool on)
    {
        using (var c = Db.Open())
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
            cmd.Parameters.AddWithValue("$k", Setting);
            cmd.Parameters.AddWithValue("$v", on ? "true" : "false");
            cmd.ExecuteNonQuery();
        }
        status = null;
        if (on) Kick();
    }

    // ------------------------------------------------------------ when

    /* Each night at three, the server's clock: a run that asks again what is due. */
    public void Start() => nightly ??= new Timer(_ =>
    {
        var now = DateTime.Now;
        var day = now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        if (now.Hour == 3 && lastNight != day) { lastNight = day; Kick(wide: true); }
    }, null, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(20));

    public void Stop() { stopped = true; nightly?.Dispose(); nightly = null; }

    /* A run in the background (after a scan; [wide]: the albums due again too); asked while one runs, it goes round once more. */
    public void Kick(bool wide = false)
    {
        if (stopped) return;
        againWide |= wide;
        again = true;
        if (Interlocked.CompareExchange(ref kicked, 1, 0) != 0) return;
        _ = Task.Run(async () =>
        {
            try
            {
                while (again && !stopped)
                {
                    again = false;
                    var w = againWide;
                    againWide = false;
                    await Run(w);
                }
            }
            finally { Interlocked.Exchange(ref kicked, 0); }
            // Asked again just as it ended: once more.
            if (again && !stopped) Kick();
        });
    }
    private int kicked;

    /* One run, after any under way (the tests' /internal/jobs/covers). */
    public async Task<Summary> Run(bool wide)
    {
        await passing.WaitAsync();
        try { return await Pass(wide); }
        catch (Exception e) { log($"[covers] {e.GetType().Name}: {e.Message}"); return new Summary(0, 0, 0, 0, 0); }
        finally { status = null; passing.Release(); }
    }

    private bool Going => !stopped && Ready() && On();

    // A scan running, or a track being made as it plays: wait for the machine.
    private static async Task<bool> Busy()
    {
        if (Cpu.MakingNow) return true;
        return await Library.CurrentState() is not var (_, st) || st.Scanning;
    }

    // ------------------------------------------------------------ the run

    private async Task<Summary> Pass(bool wide)
    {
        if (!Going || await Library.CurrentCopy() is not { } s) return new Summary(0, 0, 0, 0, 0);
        var rows = AutoCoverStore.All();
        var marks = AutoCoverStore.Tracks();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        int looked = 0, found = 0, none = 0, own = 0, later = 0;
        foreach (var al in s.Albums.OrderByDescending(a => a.Added ?? 0))
        {
            if (!Going) break;
            if (!Wanted(al, rows, marks, now, wide, out var mark)) continue;
            while (await Busy()) { if (!Going) break; await Task.Delay(1000); }
            if (!Going) break;
            looked++;
            var has = await Covers.Own(al);
            if (has == Covers.Ownership.Yes) { AutoCoverStore.Put(al.Key, mark, "own"); own++; continue; }
            if (has == Covers.Ownership.Unknown) { later++; continue; }
            switch (await Look(s, al))
            {
                case Outcome.Found: AutoCoverStore.Put(al.Key, mark, "found"); found++; break;
                case Outcome.None: AutoCoverStore.Put(al.Key, mark, "none"); none++; break;
                default: later++; break;
            }
        }
        if (looked > 0)
            log($"[covers] {looked} album(s) looked at: {found} cover(s) found, {none} with no sure match, {own} with a cover of their own" +
                (later > 0 ? $", {later} to look at again (a catalogue or a drive didn't answer)" : ""));
        if (found > 0) Covers.DrawAhead();
        return new Summary(looked, found, none, own, later);
    }

    /* Whether to look at [al] now: an album of the library's with nothing in album_edits, not looked at (or due again). */
    private static bool Wanted(Album al, Dictionary<string, AutoCoverStore.Row> rows, Dictionary<long, string> marks, long now, bool wide, out string mark)
    {
        mark = marks.TryGetValue(al.Id, out var m) ? m : "";
        if (al.Transient || al.Service != null || al.CustomArt || mark.Length == 0 || !al.ImageKey.StartsWith("al-", StringComparison.Ordinal)) return false;
        if (!rows.TryGetValue(al.Key, out var row)) return true;
        if (row.Status == "owner") return false;
        if (row.Tracks != mark) return true;
        return row.Status == "none" && wide && now - row.Ts >= RetryMs;
    }

    private enum Outcome { Found, None, Later }

    /* The catalogues asked about one album, and its sure cover kept. */
    private async Task<Outcome> Look(Snapshot s, Album al)
    {
        // An album a few seconds after the last one asked about.
        var wait = Interlocked.Read(ref lastAsked) + gapMs - Environment.TickCount64;
        if (wait > 0) await Task.Delay(TimeSpan.FromMilliseconds(wait));
        Interlocked.Exchange(ref lastAsked, Environment.TickCount64);
        var look = new CoverCatalogues.Look();
        var titles = Library.TrackTitles(s, al);
        var result = await ArtFind.Find(al.Title, al.Artist, titles, ask.For(look), _ => { });
        foreach (var c in (result["candidates"] as List<object?> ?? []).OfType<JsObj>().Take(3))
        {
            if (c["sure"] is not true || CoverCatalogues.SourceOf(c["source"]) is not var (source, name)) break;
            var url = ask.Here(Js.Str(c["url"]));
            // Deezer's picture for an album it has none of: its address has no picture's name in it.
            if (url.Contains("/images/cover//", StringComparison.Ordinal)) continue;
            var (art, _, error) = await Library.FoundCover(url, MinSide);
            if (art == null) { log($"[covers] {al.Artist} — {al.Title}: the cover on {name} couldn't be used ({error})"); continue; }
            if (!Going || !await Library.KeepAutoCover(al, art, source)) return Outcome.Later;
            log($"[covers] {al.Artist} — {al.Title}: cover found on {name}, sure ({Why(c, titles.Count(Js.Truthy))})");
            return Outcome.Found;
        }
        return look.Short ? Outcome.Later : Outcome.None;
    }

    /* "title, artist, 11 of 11 tracks": what the sure hit agreed on. */
    private static string Why(JsObj c, int tracks)
    {
        var m = c["match"] as JsObj;
        var parts = new List<string>();
        if (m?["title"] is double) parts.Add("title");
        parts.Add("artist");
        if (m?["tracks"] is double t) parts.Add(string.Create(CultureInfo.InvariantCulture, $"{(int)Math.Round(t * tracks)} of {tracks} tracks"));
        return string.Join(", ", parts);
    }

    // ------------------------------------------------------------ the page's line

    private volatile JsonObject? status;
    private long statusAt;

    /*
     * The switch and how far it has got (Settings → Library Scanner): found
     * (albums whose cover it found), left (no cover of their own known yet,
     * not looked at, or due again) and none (looked at, nothing sure). Counted
     * again at most every ten seconds.
     */
    public async Task<JsonObject> Status()
    {
        var running = passing.CurrentCount == 0;
        if (status is { } kept && Environment.TickCount64 - Interlocked.Read(ref statusAt) < 10000)
            return new JsonObject { ["on"] = On(), ["running"] = running, ["found"] = kept["found"]?.DeepClone(), ["left"] = kept["left"]?.DeepClone(), ["none"] = kept["none"]?.DeepClone() };
        int found = 0, left = 0, none = 0;
        if (await Library.CurrentCopy() is { } s)
        {
            var rows = AutoCoverStore.All();
            var marks = AutoCoverStore.Tracks();
            var folders = FolderArt();
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            foreach (var al in s.Albums)
            {
                if (al.CustomArt) { if (al.ArtSource?.StartsWith("auto:", StringComparison.Ordinal) == true) found++; continue; }
                if (folders.Contains(al.Id) || !Wanted(al, rows, marks, now, true, out _))
                {
                    if (rows.TryGetValue(al.Key, out var r) && r.Status == "none" && marks.TryGetValue(al.Id, out var m) && r.Tracks == m) none++;
                    continue;
                }
                left++;
            }
        }
        var o = new JsonObject { ["on"] = On(), ["running"] = running, ["found"] = found, ["left"] = left, ["none"] = none };
        status = (JsonObject)o.DeepClone();
        Interlocked.Exchange(ref statusAt, Environment.TickCount64);
        return o;
    }

    // The albums with a picture in their folder (as the scan found it).
    private static HashSet<long> FolderArt()
    {
        var ids = new HashSet<long>();
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id FROM albums WHERE art_path IS NOT NULL AND art_path != ''";
        using var r = cmd.ExecuteReader();
        while (r.Read()) ids.Add(r.GetInt64(0));
        return ids;
    }
}
