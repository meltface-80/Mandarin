// Identifier.cs — the scan that finds each album's right names (v0.8.19):
// lib/identify/identifier.js, rule for rule.
//
// One album at a time, in the background: what the files carry (a MusicBrainz
// release id, a barcode, a catalogue number, ISRCs) first; then a MusicBrainz
// search by name, the likeliest few releases fetched in full and each scored
// against the album's tracks and lengths (Score.cs). A match near enough is
// applied — artist, title, year and the track titles written to the overlays
// the album editor uses (album_edits, track_edits), never to the files; a near
// miss is proposed for one tap; anything else is left unidentified. An album
// MusicBrainz can't place is asked of iTunes too. Every verdict is kept in
// album_matches so an album is looked at once, and an applied one can be
// undone.
//
// When it runs: whenever Scheduling is off; between the start and end times
// when it is on (the server's clock). Never while the library scan is
// running, never on an album you edited by hand.
//
// What it writes, it writes as the Node server wrote it, column for column;
// the Node server is then told (Library.Tell, { edits }) and reads the
// library again, keeping album-edits.json beside the database as before.
using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal sealed class IdentifyError(string message, int status) : Exception(message)
{
    public int Status { get; } = status;
}

/* An album_matches row, its values as JavaScript reads them from better-sqlite3. */
internal sealed class MatchRow
{
    public string Key = "";
    public object? Mbid, Distance, Candidate, Before, AppliedAt, ITunes;
    public string Status = "";
    public object? CheckedAt;
    public MatchRow Copy() => (MatchRow)MemberwiseClone();
    public double Checked => Js.ToNumber(CheckedAt);
}

internal sealed partial class Identifier
{
    public const long RetryUnidentifiedMs = 30L * 86400000;   // an unidentified album is looked at again after a month
    private const int FetchMax = 5;                             // releases fetched in full per album
    private const double SearchLimit = 40;                      // search results asked for (one request whatever the number)
    private const int WidenMax = 8;                             // other pressings of the best fit's record fetched when the count is off
    private const double MinTracks = 2;                         // a one-track "album" can't be told apart by its lengths

    public readonly PackFirst Mb;
    public readonly ITunes? ITunes;
    private readonly Func<MbPack?> pack;
    private readonly Action<string> log;
    private readonly int tickMs;

    private Task? busy;
    private JsObj? current;
    private int failures;
    private long pausedUntil;
    private (MbPack Pack, int Count, long At, HashSet<string> Keys)? packCache;
    private readonly HashSet<string> packTried = [];
    private Timer? timer;
    private volatile bool stopped = true;
    private bool waitingApplied;
    private int ticking;
    // What's written is written one at a time, and told to the Node server
    // before the page reads it (so the page never shows an apply its library hasn't got).
    private readonly SemaphoreSlim writing = new(1, 1);
    private readonly object state = new();

    public Identifier(PackFirst mb, ITunes? itunes, Func<MbPack?> pack, Action<string> log, int tickMs)
    {
        Mb = mb;
        ITunes = itunes;
        this.pack = pack;
        this.log = log;
        this.tickMs = tickMs;
    }

    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    // ------------------------------------------------------------ settings

    [GeneratedRegex("^([0-9]{1,2}):([0-9]{2})\\z")]
    private static partial Regex HhMm();

    /* minutes("01:30") → 90; the fallback for anything else. */
    public static double? Minutes(object? hhmm, double? fallback)
    {
        var m = HhMm().Match(Js.Truthy(hhmm) ? Js.Str(hhmm) : "");
        if (!m.Success) return fallback;
        double h = double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture), mi = double.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture);
        return h >= 0 && h < 24 && mi >= 0 && mi < 60 ? h * 60 + mi : fallback;
    }

    private static object? Setting(string key)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT value FROM settings WHERE key = $k";
        cmd.Parameters.AddWithValue("$k", key);
        if (cmd.ExecuteScalar() is not string v) return Undef.V;
        try { return JsJson.Parse(v); } catch (Exception) { return Undef.V; }
    }
    private static void SetSetting(string key, object? value)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
        cmd.Parameters.AddWithValue("$k", key);
        cmd.Parameters.AddWithValue("$v", Js.Json(value) ?? "null");
        cmd.ExecuteNonQuery();
    }

    /* { enabled, schedule, start, end, itunes }, the defaults under what's kept. */
    public JsObj Settings()
    {
        var s = new JsObj();
        s["enabled"] = true;
        s["schedule"] = true;
        s["start"] = "01:00";
        s["end"] = "06:00";
        s["itunes"] = true;
        var kept = Setting("identify");
        if (Js.Truthy(kept) && kept is JsObj o) foreach (var k in o.Keys) s[k] = o[k];
        var outS = new JsObj();
        outS["enabled"] = Js.Truthy(s["enabled"]);
        outS["schedule"] = Js.Truthy(s["schedule"]);
        outS["start"] = s["start"];
        outS["end"] = s["end"];
        outS["itunes"] = !(s["itunes"] is bool b && !b);
        return outS;
    }

    public JsObj SetSettings(JsObj patch)
    {
        var s = Settings();
        if (!Js.IsUndef(patch["enabled"])) s["enabled"] = Js.Truthy(patch["enabled"]);
        if (!Js.IsUndef(patch["schedule"])) s["schedule"] = Js.Truthy(patch["schedule"]);
        if (!Js.IsUndef(patch["itunes"])) s["itunes"] = Js.Truthy(patch["itunes"]);
        if (!Js.IsUndef(patch["start"]) && Minutes(patch["start"], null) != null) s["start"] = patch["start"];
        if (!Js.IsUndef(patch["end"]) && Minutes(patch["end"], null) != null) s["end"] = patch["end"];
        SetSetting("identify", s);
        return s;
    }

    /* Is now inside the night window? A window over midnight (22:00–04:00) counts. */
    public static bool InWindow(JsObj s)
    {
        var d = DateTime.Now;
        var t = d.Hour * 60 + d.Minute;
        double a = Minutes(s["start"], 60)!.Value, b = Minutes(s["end"], 360)!.Value;
        if (a == b) return false;
        return a < b ? t >= a && t < b : t >= a || t < b;
    }

    /* Why the scan is or isn't running right now. */
    public JsObj State(Snapshot lib, LibState st)
    {
        var s = Settings();
        string reason;
        JsObj? cur;
        lock (state) cur = current;
        if (!Js.Truthy(s["enabled"])) reason = "off";
        else if (Js.Truthy(s["schedule"]) && !InWindow(s)) reason = "waiting";
        else if (st.Scanning) reason = "scanning";
        else if (Now < pausedUntil) reason = cur != null ? "pack" : Next(lib, packOnly: true) != null ? "pack" : "unreachable";
        else if (cur != null) reason = "checking";
        else reason = Next(lib) != null ? "starting" : "done";
        var o = new JsObj();
        o["settings"] = s;
        o["reason"] = reason;
        o["current"] = cur;
        o["active"] = reason is not ("off" or "waiting" or "scanning" or "unreachable");
        return o;
    }

    /* The keys of the albums whose barcode the pack has, worked out once a while. */
    private HashSet<string>? PackKeys(Snapshot lib)
    {
        var p = pack();
        if (p == null) return null;
        lock (state)
        {
            if (packCache is { } c && ReferenceEquals(c.Pack, p) && c.Count == lib.Count && Now - c.At < 10 * 60 * 1000) return c.Keys;
        }
        var keys = new HashSet<string>();
        try
        {
            var byId = new Dictionary<long, string>();
            foreach (var al in lib.Albums) byId[al.Id] = al.Key;
            using var c = Db.Open();
            foreach (var r in Rows(c, "SELECT id, barcode FROM albums WHERE barcode IS NOT NULL AND barcode != ''"))
            {
                if (r[0] is double id && byId.TryGetValue((long)id, out var key) && p.Has(r[1])) keys.Add(key);
            }
        }
        catch (Exception) { /* the pack is a help, not a need */ }
        lock (state) packCache = (p, lib.Count, Now, keys);
        return keys;
    }

    // ------------------------------------------------------------ the database

    private static object? Value(object? v) => v switch { DBNull => null, long l => (double)l, int n => (double)n, _ => v };

    private static List<object?[]> Rows(SqliteConnection c, string sql, params object?[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        for (var i = 0; i < args.Length; i++) cmd.Parameters.AddWithValue("$" + (i + 1), Bind(args[i]));
        using var r = cmd.ExecuteReader();
        var rows = new List<object?[]>();
        while (r.Read())
        {
            var row = new object?[r.FieldCount];
            for (var i = 0; i < r.FieldCount; i++) row[i] = Value(r.IsDBNull(i) ? null : r.GetValue(i));
            rows.Add(row);
        }
        return rows;
    }

    /* A value bound as better-sqlite3 binds it: a number as a double, text as text, null as NULL. */
    private static object Bind(object? v) => v switch
    {
        null or Undef => DBNull.Value,
        double d => d,
        long l => (double)l,
        int n => (double)n,
        bool b => b ? 1.0 : 0.0,
        string s => s,
        byte[] bytes => bytes,
        _ => Js.Str(v)
    };

    private static int Exec(SqliteConnection c, SqliteTransaction? tx, string sql, params object?[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        for (var i = 0; i < args.Length; i++) cmd.Parameters.AddWithValue("$" + (i + 1), Bind(args[i]));
        return cmd.ExecuteNonQuery();
    }

    private const string RowColumns = "key, mbid, distance, status, candidate, before, checked_at, applied_at, itunes";
    private static MatchRow RowOf(object?[] r) => new()
    {
        Key = Js.Str(r[0]), Mbid = r[1], Distance = r[2], Status = r[3] is string st ? st : Js.Str(r[3]), Candidate = r[4],
        Before = r[5], CheckedAt = r[6], AppliedAt = r[7], ITunes = r[8]
    };

    public static Dictionary<string, MatchRow> AllRows(SqliteConnection c)
    {
        var m = new Dictionary<string, MatchRow>();
        foreach (var r in Rows(c, $"SELECT {RowColumns} FROM album_matches")) m[Js.Str(r[0])] = RowOf(r);
        return m;
    }
    public static List<MatchRow> RowList(SqliteConnection c) => Rows(c, $"SELECT {RowColumns} FROM album_matches").Select(RowOf).ToList();
    public static MatchRow? Row(SqliteConnection c, string key) => Rows(c, $"SELECT {RowColumns} FROM album_matches WHERE key = $1", key).Select(RowOf).FirstOrDefault();
    public static MatchRow? Row(string key) { using var c = Db.Open(); return Row(c, key); }

    private static void Put(SqliteConnection c, SqliteTransaction? tx, MatchRow r) => Exec(c, tx,
        @"INSERT INTO album_matches(key, mbid, distance, status, candidate, before, checked_at, applied_at, itunes)
          VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT(key) DO UPDATE SET mbid=excluded.mbid, distance=excluded.distance, status=excluded.status,
            candidate=excluded.candidate, before=excluded.before, checked_at=excluded.checked_at, applied_at=excluded.applied_at,
            itunes=excluded.itunes",
        r.Key, r.Mbid, r.Distance, r.Status, r.Candidate, r.Before, r.CheckedAt, r.AppliedAt, r.ITunes);

    // ------------------------------------------------------------ the queue

    /* Albums the scan can say something about: with enough tracks to tell by. */
    public static IEnumerable<Album> Eligible(Snapshot lib) => lib.Albums.Where(al => al.TrackCount is double n && n >= MinTracks && al.Service == null);

    /* iTunes is on, there, and not asking us to wait. */
    private bool ITunesUsable() => ITunes != null && Js.Truthy(Settings()["itunes"]) && !ITunes.Paused;

    /* A verdict that only lacks iTunes's opinion: unidentified within its month, iTunes not asked. */
    private static bool ITunesOnly(MatchRow? r) =>
        r != null && r.Status == "unidentified" && !(r.ITunes is string s && s == "asked") && Now - r.Checked <= RetryUnidentifiedMs;

    /*
     * The next album to look at: one never looked at, or unidentified long
     * enough ago; never one you edited by hand. Suspect artists first, then the
     * newest additions.
     */
    public Album? Next(Snapshot lib, bool packOnly = false)
    {
        Dictionary<string, MatchRow> rows;
        using (var c = Db.Open()) rows = AllRows(c);
        var now = Now;
        Album? best = null;
        (double A, double B) bestRank = default;
        var ask = ITunesUsable();
        // With the pack, the albums it can answer come first; while musicbrainz.org isn't answering, only those, each once.
        var inPack = PackKeys(lib);
        if (packOnly && inPack == null) return null;
        HashSet<string> tried;
        lock (state) tried = [.. packTried];
        foreach (var al in Eligible(lib))
        {
            if (packOnly && (!inPack!.Contains(al.Key) || tried.Contains(al.Key))) continue;
            rows.TryGetValue(al.Key, out var r);
            // Unidentified, and iTunes not asked yet: asked now, after the albums never looked at.
            var itunesOnly = ask && ITunesOnly(r);
            if (r != null && !itunesOnly && !(r.Status == "unidentified" && now - r.Checked > RetryUnidentifiedMs)) continue;
            if (al.Edited && !(r != null && r.Status == "unidentified")) continue;     // yours, not ours
            if (packOnly && itunesOnly) continue;
            var rank = (itunesOnly ? 2 : inPack != null && inPack.Contains(al.Key) ? -1 : Score.ArtistSuspect(al.Artist, al.Title) ? 0 : 1, -(double)(al.Added ?? 0));
            if (best == null || rank.Item1 < bestRank.A || (rank.Item1 == bestRank.A && rank.Item2 < bestRank.B)) { best = al; bestRank = rank; }
        }
        return best;
    }

    // ------------------------------------------------------------ one album

    private sealed record TrackRow(object? Id, string? Path, object? Title, object? EditTitle, object? Duration, object? Disc, object? No);

    /* library.trackPos: "disc-number", or "disc-p<index>" for a file with no track number. */
    public static string TrackPos(object? disc, object? no, int i) =>
        $"{(Js.Truthy(disc) ? Js.Str(disc) : "1")}-{(Js.Truthy(no) ? Js.Str(no) : "p" + (i + 1))}";

    /* An album's tracks in playing order, with the corrected titles laid over them (library.tracks). */
    private static List<TrackRow> Tracks(SqliteConnection c, Album al)
    {
        var edits = new Dictionary<string, object?>();
        foreach (var r in Rows(c, "SELECT pos, title FROM track_edits WHERE key = $1 AND title IS NOT NULL", al.Key)) edits[Js.Str(r[0])] = r[1];
        var rows = Rows(c, "SELECT id, path, title, duration, disc_no, track_no FROM tracks WHERE album_id = $1 ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path", (double)al.Id);
        var list = new List<TrackRow>(rows.Count);
        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            edits.TryGetValue(TrackPos(r[4], r[5], i), out var edit);
            list.Add(new TrackRow(r[0], r[1] as string, r[2], Js.Truthy(edit) ? edit : null, r[3], r[4], r[5]));
        }
        return list;
    }

    /* What the scorer sees of an album: the names its files carry and each track's title and length. */
    private JsObj Input(SqliteConnection c, Album al)
    {
        var rows = Tracks(c, al);
        var tracks = new List<object?>();
        foreach (var t in rows)
        {
            // t.scanned_title || t.title || "": the tagged title, or what's laid over an untitled one.
            var title = Js.Truthy(t.Title) ? t.Title : t.EditTitle ?? t.Title;
            var o = new JsObj();
            o["title"] = Score.Tidy(Js.Truthy(title) ? title : "");
            o["length"] = Js.Truthy(t.Duration) ? t.Duration : null;
            tracks.Add(o);
        }
        var input = new JsObj();
        input["title"] = Score.Tidy(al.ScannedTitle.Length > 0 ? al.ScannedTitle : al.Title);
        input["artist"] = Score.Tidy(al.ScannedArtist.Length > 0 ? al.ScannedArtist : al.Artist);
        input["year"] = (al.ScannedYear ?? al.Year) is long y ? (double)y : null;
        input["tracks"] = tracks;
        input["ids"] = IdsOf(c, al);
        input["context"] = ContextOf(c, al, rows);
        return input;
    }

    [GeneratedRegex("[cC][oO][mM][mM][eE][nN][tT]|[vV][eE][rR][sS][iI][oO][nN]|[sS][uU][bB][tT][iI][tT][lL][eE]|[dD][eE][sS][cC][rR][iI][pP][tT][iI][oO][nN]|[rR][eE][mM][iI][xX]|[mM][iI][xX][eE][rR]|[eE][dD][iI][tT][iI][oO][nN]")]
    private static partial Regex EditionTag();

    /* What else says which version of a record this is: its folders, its box set, and the tags that name an edition. */
    private static string ContextOf(SqliteConnection c, Album al, List<TrackRow> tracks)
    {
        var bits = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        void Add(string s) { if (seen.Add(s)) bits.Add(s); }
        foreach (var t in tracks)
        {
            if (string.IsNullOrEmpty(t.Path)) continue;
            Add(NodePath.Basename(NodePath.Dirname(t.Path)));
            Add(NodePath.Basename(NodePath.Dirname(NodePath.Dirname(t.Path))));
        }
        if (al.Box != null) Add(al.Box.Name);
        try
        {
            foreach (var r in Rows(c, "SELECT g.tags FROM track_tags g JOIN tracks t ON t.id = g.track_id WHERE t.album_id = $1 LIMIT 40", (double)al.Id))
            {
                if (JsJson.Parse(Js.Truthy(r[0]) ? Js.Str(r[0]) : "{}") is not JsObj tags) continue;
                foreach (var k in tags.Keys)
                {
                    if (!EditionTag().IsMatch(k)) continue;
                    var v = tags[k];
                    foreach (var x in v is List<object?> l ? l : [v])
                    {
                        var s = Js.Str(x);
                        Add(s.Length > 200 ? s[..200] : s);
                    }
                }
            }
        }
        catch (Exception) { /* tags are a help, not a need */ }
        return string.Join(" · ", bits);
    }

    /* What the files themselves say the release is: its release id, barcode, catalogue number and label, and a few ISRCs. */
    private static JsObj IdsOf(SqliteConnection c, Album al)
    {
        var o = new JsObj();
        try
        {
            var r = Rows(c, "SELECT barcode, catno, mb_album, label FROM albums WHERE id = $1", (double)al.Id).FirstOrDefault() ?? new object?[4];
            var isrcs = Rows(c, "SELECT DISTINCT isrc FROM tracks WHERE album_id = $1 AND isrc IS NOT NULL ORDER BY COALESCE(disc_no, 1), COALESCE(track_no, 9999) LIMIT 3", (double)al.Id)
                .Select(x => x[0]).ToList();
            o["mbid"] = Js.Truthy(r[2]) ? r[2] : null;
            o["barcode"] = Js.Truthy(r[0]) ? r[0] : null;
            o["catno"] = Js.Truthy(r[1]) ? r[1] : null;
            o["label"] = Js.Truthy(r[3]) ? r[3] : null;
            o["isrcs"] = isrcs;
        }
        catch (Exception) { o = new JsObj(); o["isrcs"] = new List<object?>(); }
        return o;
    }

    private static JsObj With(JsObj o, string k, object? v)
    {
        var c = new JsObj();
        foreach (var key in o.Keys) c[key] = o[key];
        c[k] = v;
        return c;
    }

    /* The verdict, applied: the best match's candidate marked with how it was found. */
    private static Score.Verdict Applied(Score.Verdict v, string by)
    {
        var best = v.Best! with { Candidate = With(v.Best!.Candidate, "matched_by", by) };
        var list = v.ScoredList.Select(s => ReferenceEquals(s, v.Best) ? best : s).ToList();
        return v with { Status = "applied", Best = best, ScoredList = list };
    }

    private sealed record Resolved(List<JsObj> Cands, Score.Verdict Verdict, string? By);

    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static double TracksIn(JsObj input) => L(input["tracks"]).Count;

    /*
     * The release the files name, found by what they carry — before any search
     * by name — in order of certainty: the release id, the barcode, the
     * catalogue number (with the label), the ISRCs. Applied when it fits
     * within "proposed".
     */
    private async Task<Resolved?> IdResolve(JsObj input, IReleases mb)
    {
        var ids = input["ids"] as JsObj ?? new JsObj();
        var have = new HashSet<string>();
        Resolved? Settle(List<JsObj> cands, string by, bool always = false)
        {
            if (cands.Count == 0) return null;
            var verdict = Score.Decide(input, cands);
            var best = verdict.Best;
            if (best == null || (!always && best.Distance > Score.Propose)) return null;
            return new Resolved(cands, Applied(verdict, by), by);
        }
        if (Js.Truthy(ids["mbid"]))
        {
            JsObj? rel;
            try { rel = await mb.Release(Js.Str(ids["mbid"])); } catch (Exception) { rel = null; }
            var r = rel != null ? Settle([rel], "musicbrainz-id", true) : null;
            if (r != null) return r;
        }
        if (Js.Truthy(ids["barcode"]))
        {
            List<JsObj> found;
            try { found = await mb.ByBarcode(ids["barcode"]); } catch (Exception) { found = []; }
            var r = Settle(await FetchBest(found, input, have, 3, mb), "barcode");
            if (r != null) return r;
        }
        if (Js.Truthy(ids["catno"]))
        {
            List<JsObj> found;
            try { found = await mb.ByCatno(ids["catno"], ids["label"]); } catch (Exception) { found = []; }
            if (found.Count == 0 && Js.Truthy(ids["label"])) { try { found = await mb.ByCatno(ids["catno"]); } catch (Exception) { found = []; } }
            var r = Settle(await FetchBest(found, input, have, 3, mb), "catalogue-number");
            if (r != null) return r;
        }
        var isrcs = L(ids["isrcs"]);
        if (isrcs.Count > 0)
        {
            // The releases most of the sampled recordings appear on.
            var counts = new List<(string Mbid, JsObj F, double N)>();
            foreach (var code in isrcs)
            {
                List<JsObj> found;
                try { found = await mb.ByIsrc(code); } catch (Exception) { found = []; }
                foreach (var f in found)
                {
                    var id = Js.Str(f["mbid"]);
                    var i = counts.FindIndex(x => x.Mbid == id);
                    if (i < 0)
                    {
                        var copy = new JsObj();
                        copy["n"] = 0.0;
                        foreach (var k in f.Keys) copy[k] = f[k];
                        counts.Add((id, copy, 1));
                    }
                    else counts[i] = (counts[i].Mbid, counts[i].F, counts[i].N + 1);
                }
            }
            var most = counts.Count > 0 ? Math.Max(0, counts.Max(x => x.N)) : 0;
            var shared = counts.Where(x => x.N == most).Select(x =>
            {
                var c = With(x.F, "n", x.N);
                c["score"] = x.N;
                return c;
            }).ToList();
            var r = Settle(await FetchBest(shared, input, have, 4, mb), "isrc");
            if (r != null) return r;
        }
        return null;
    }

    /* found.sort: the nearest track count first, then MusicBrainz's own score. */
    private static List<JsObj> ByNearest(List<JsObj> found, JsObj input, bool score = true)
    {
        var n = TracksIn(input);
        double Off(JsObj f) => Math.Abs((Js.Truthy(f["track_count"]) ? Js.ToNumber(f["track_count"]) : 0) - n);
        return Library.Sorted(found, (a, b) =>
        {
            var d = Off(a) - Off(b);
            if (d != 0 && !double.IsNaN(d)) return d < 0 ? -1 : 1;
            return score ? Lookups.Sgn(Js.ToNumber(b["score"]) - Js.ToNumber(a["score"])) : 0;
        });
    }

    /* The likeliest few of a search's results fetched in full; none fetched twice. */
    private static async Task<List<JsObj>> FetchBest(List<JsObj> found, JsObj input, HashSet<string> have, int max, IReleases mb)
    {
        var outList = new List<JsObj>();
        foreach (var f in ByNearest(found, input))
        {
            if (outList.Count >= max) break;
            var id = Js.Str(f["mbid"]);
            if (!have.Add(id)) continue;
            JsObj? rel;
            try { rel = await mb.Release(id); } catch (Exception) { rel = null; }
            if (rel != null) outList.Add(rel);
        }
        return outList;
    }

    /*
     * The releases that could be this album, and the verdict on them. Three
     * questions at most, each only when the one before fell short: the album's
     * name (without its edition, with its artist where the tag can be trusted);
     * its words in any order with no artist; and when the best fit hasn't the
     * copy's track count, the other pressings of its record.
     */
    private async Task<Resolved> Resolve(JsObj input)
    {
        // What the files say, first.
        Resolved? byIds;
        try { byIds = await IdResolve(input, Mb); } catch (Exception) { byIds = null; }
        if (byIds != null) return byIds;
        var suspect = Score.ArtistSuspect(input["artist"], input["title"]);
        var bare = Score.Bare(input["title"]);
        object? plain = bare.Length > 0 ? bare : input["title"];
        var have = new HashSet<string>();
        var cands = await FetchBest(await Mb.Search(plain, suspect ? "" : input["artist"], null, SearchLimit), input, have, FetchMax, Mb);
        var verdict = Score.Decide(input, cands);
        if (verdict.Best == null || verdict.Best.Distance > Score.Propose)
        {
            var found = await Mb.Search(plain, "", null, SearchLimit, loose: true);
            cands = [.. cands, .. await FetchBest(found, input, have, FetchMax, Mb)];
            verdict = Score.Decide(input, cands);
        }
        var best = verdict.Best;
        if (best != null && Js.Truthy(best.Candidate["group_mbid"]) && (Js.Truthy(best.Parts["missing_tracks"]) || Js.Truthy(best.Parts["extra_tracks"])))
        {
            // The pressings with the copy's count, or within one of it: the nearest count fetched first.
            List<JsObj> group;
            try { group = await Mb.GroupReleases(best.Candidate["group_mbid"]); } catch (Exception) { group = []; }
            var n = TracksIn(input);
            var others = group.Where(r => Math.Abs((Js.Truthy(r["track_count"]) ? Js.ToNumber(r["track_count"]) : 0) - n) <= 1 && !have.Contains(Js.Str(r["mbid"]))).ToList();
            if (others.Count > 0)
            {
                cands = [.. cands, .. await FetchBest(others, input, have, WidenMax, Mb)];
                verdict = Score.Decide(input, cands);
            }
        }
        return new Resolved(cands, verdict, null);
    }

    /*
     * iTunes's albums for this one, and the verdict on them: the barcode
     * first, then by artist and title (the title alone when the artist tag
     * can't be trusted, or when that finds nothing); the two nearest in track
     * count fetched in full.
     */
    private async Task<Score.Verdict> ITunesResolve(JsObj input)
    {
        var it = ITunes!;
        var ids = input["ids"] as JsObj;
        var code = ids?["barcode"];
        if (Js.Truthy(code))
        {
            JsObj? c;
            try { c = await it.ByUpc(code); }
            catch (LookupError e) when (!e.Paused) { c = null; }
            catch (Exception e) when (e is not LookupError) { c = null; }
            if (c != null)
            {
                var v = Score.Decide(input, [c]);
                if (v.Best != null && v.Best.Distance <= Score.Propose) return Applied(v, "barcode");
            }
        }
        var suspect = Score.ArtistSuspect(input["artist"], input["title"]);
        var bare = Score.Bare(input["title"]);
        object? plain = bare.Length > 0 ? bare : input["title"];
        var found = await it.Search(plain, suspect ? "" : input["artist"]);
        if (found.Count == 0 && !suspect) found = await it.Search(plain, "");
        found = ByNearest(found, input, score: false);
        var cands = new List<JsObj>();
        foreach (var f in found.Take(2))
        {
            JsObj? c;
            try { c = await it.Album(f["id"]); }
            catch (LookupError e) when (!e.Paused) { c = null; }
            catch (Exception e) when (e is not LookupError) { c = null; }
            if (c != null) cands.Add(c);
        }
        return Score.Decide(input, cands);
    }

    /* Look one album up, decide, record — and apply when it's near enough. */
    private async Task<MatchRow?> Identify(Album al)
    {
        JsObj input;
        MatchRow? prev;
        using (var c = Db.Open()) { input = Input(c, al); prev = Row(c, al.Key); }
        // Unidentified already, iTunes not asked yet: only iTunes is asked.
        var only = ITunesOnly(prev);
        var verdict = only ? null : (await Resolve(input)).Verdict;
        string? itunes = null;
        if ((verdict == null || verdict.Status == "unidentified") && ITunesUsable())
        {
            try
            {
                var v = await ITunesResolve(input);
                itunes = "asked";
                // iTunes's answer when it has one; else whichever came nearer, for the page to name.
                var nearer = v.Best != null && (verdict == null || verdict.Best == null || v.Best.Distance < verdict.Best.Distance);
                if (v.Status != "unidentified" || (!only && nearer)) verdict = v;
            }
            catch (Exception e)
            {
                // Too busy, or not answering: asked again later; iTunes rests a while either way.
                itunes = "skipped";
                if (!(e is LookupError { Paused: true }) && ITunes != null) ITunes.PausedUntil = Now + 10 * 60 * 1000;
            }
        }
        if (verdict == null || (only && verdict.Status == "unidentified"))
        {
            // Nothing new: the MusicBrainz verdict stands, and its month runs on.
            if (prev != null && itunes != null)
                await Writing(async () => { using var c = Db.Open(); Exec(c, null, "UPDATE album_matches SET itunes = $1 WHERE key = $2", itunes, al.Key); await Task.CompletedTask; return false; });
            return prev;
        }
        return await Record(al, verdict, itunes);
    }

    /*
     * An album the pack alone can place, while musicbrainz.org isn't answering:
     * its release id, else its barcode, from the pack; a fit is applied as any
     * match is. Anything less waits for musicbrainz.org.
     */
    private async Task<MatchRow?> IdentifyFromPack(Album al)
    {
        var p = pack();
        lock (state) packTried.Add(al.Key);
        if (p == null) return null;
        JsObj input;
        using (var c = Db.Open()) input = Input(c, al);
        var r = await IdResolve(input, new PackOnly(p));
        return r != null ? await Record(al, r.Verdict, null) : null;
    }

    /* Everything written here goes through this: one at a time, the Node server told when it's done. */
    private async Task<T> Writing<T>(Func<Task<(T Result, bool Edits)>> work)
    {
        await writing.WaitAsync();
        try
        {
            var (result, edits) = await work();
            if (edits) await Library.Tell(new JsonObject { ["edits"] = true });
            return result;
        }
        finally { writing.Release(); }
    }
    private Task<bool> Writing(Func<Task<bool>> work) => Writing(async () => { var e = await work(); return (true, e); });

    /* The page reads the verdicts while nothing is half written. */
    public async Task<T> Reading<T>(Func<T> read)
    {
        await writing.WaitAsync();
        try { return read(); }
        finally { writing.Release(); }
    }

    /* A verdict written: applied (with what was there kept for Undo), proposed or not found. */
    private Task<MatchRow> Record(Album al, Score.Verdict verdict, string? itunes) => Writing(async () =>
    {
        await Task.CompletedTask;
        var best = verdict.Best;
        var now = (double)Now;
        var row = new MatchRow
        {
            Key = al.Key,
            Mbid = best != null ? best.Candidate["mbid"] : null,
            Distance = best?.Distance,
            Status = verdict.Status,
            Candidate = best != null ? Js.Json(Score.Kept(best, ("ambiguous", verdict.Ambiguous))) : null,
            Before = null, CheckedAt = now, AppliedAt = null, ITunes = itunes
        };
        if (row.Mbid is Undef) row.Mbid = null;
        using var c = Db.Open();
        if (verdict.Status == "applied")
        {
            using var tx = c.BeginTransaction();
            row.Before = Js.Json(Snapshot(c, tx, al));
            row.AppliedAt = row.CheckedAt;
            Put(c, tx, row);
            // With its pairs: a copy missing a track takes each name from the track it paired with.
            Apply(c, tx, al, With(best!.Candidate, "pairs", best.Pairs));
            tx.Commit();
            var cand = best.Candidate;
            log($"[identify] {al.Artist} — {al.Title} → {Js.Str(cand["artist"])} — {Js.Str(cand["title"])} ({Js.Num(Js.Round((1 - best.Distance) * 100))} %"
                + (Js.StrictEq(cand["source"], "itunes") ? ", iTunes" : "")
                + (Js.Truthy(cand["matched_by"]) ? ", by " + Js.Str(cand["matched_by"]) + (Js.Truthy(cand["from_pack"]) ? " (pack)" : "") : "") + ")");
            return (row, true);
        }
        Put(c, null, row);
        return (row, false);
    });

    /*
     * The releases that could be this album, scored, best first — for the
     * album editor's Find match, where you choose. Nothing is written.
     */
    public async Task<JsObj?> Suggest(Album al)
    {
        JsObj input;
        using (var c = Db.Open()) input = Input(c, al);
        var verdict = (await Resolve(input)).Verdict;
        if (verdict.Status == "unidentified" && ITunesUsable())
        {
            Score.Verdict? v;
            try { v = await ITunesResolve(input); } catch (Exception) { v = null; }
            if (v != null && v.ScoredList.Count > 0)
            {
                var scored = Library.Sorted(verdict.ScoredList.Concat(v.ScoredList), (a, b) => Lookups.Sgn(a.Distance - b.Distance));
                verdict = v.Status != "unidentified" ? v with { ScoredList = scored } : verdict with { ScoredList = scored };
            }
        }
        var o = new JsObj();
        o["verdict"] = verdict.Status;
        o["ambiguous"] = verdict.Ambiguous;
        o["candidates"] = verdict.ScoredList.Select(s =>
        {
            var c = s.Candidate;
            var x = new JsObj();
            x["mbid"] = c["mbid"];
            x["title"] = Score.Clean(c["title"]);
            x["artist"] = c["artist"];
            x["year"] = c["year"];
            x["release_title"] = Js.Truthy(c["release_title"]) ? c["release_title"] : null;
            x["release_year"] = Js.Truthy(c["release_year"]) ? c["release_year"] : null;
            x["edition"] = Js.Truthy(c["edition"]) ? c["edition"] : null;
            x["country"] = Js.Truthy(c["country"]) ? c["country"] : null;
            x["type"] = Js.Truthy(c["type"]) ? c["type"] : null;
            x["track_count"] = c["track_count"];
            x["source"] = Js.Truthy(c["source"]) ? c["source"] : "musicbrainz";
            x["similarity"] = Js.Round((1 - s.Distance) * 100);
            x["distance"] = s.Distance;
            x["missing_tracks"] = Js.Truthy(s.Parts["missing_tracks"]) ? s.Parts["missing_tracks"] : 0.0;
            x["extra_tracks"] = Js.Truthy(s.Parts["extra_tracks"]) ? s.Parts["extra_tracks"] : 0.0;
            return (object?)x;
        }).ToList();
        return o;
    }

    [GeneratedRegex("^itunes:[0-9]+\\z")]
    private static partial Regex ITunesId();

    /*
     * A match you name: a barcode off the sleeve, or a MusicBrainz release or
     * release-group link. The release is scored so the page can say how alike
     * it is, then applied whatever the score — you said so.
     */
    public async Task<MatchRow?> Match(Snapshot lib, Album al, string? barcode, string? mbid, string? group, string? how)
    {
        JsObj input;
        using (var c = Db.Open()) input = Input(c, al);
        if (mbid != null && ITunesId().IsMatch(mbid))
        {
            if (ITunes == null) throw new IdentifyError("iTunes isn't available", 409);
            JsObj? c;
            try { c = await ITunes.Album(mbid[7..]); } catch (Exception) { c = null; }
            if (c == null) throw new IdentifyError("iTunes didn't give that album", 502);
            return await ApplyChosen(al, input, [c], how ?? "pick");
        }
        List<JsObj> found;
        if (!string.IsNullOrEmpty(mbid))
        {
            var f = new JsObj();
            f["mbid"] = mbid;
            f["track_count"] = 0.0;
            f["score"] = 0.0;
            found = [f];
        }
        else if (!string.IsNullOrEmpty(group)) found = await Mb.GroupReleases(group);
        else found = await Mb.ByBarcode(barcode);
        if (found.Count == 0) throw new IdentifyError(!string.IsNullOrEmpty(barcode) ? "No release on MusicBrainz carries that barcode" : "Nothing at that MusicBrainz link", 404);
        var cands = new List<JsObj>();
        foreach (var f in ByNearest(found, input).Take(3))
        {
            JsObj? rel;
            try { rel = await Mb.Release(Js.Str(f["mbid"])); } catch (Exception) { rel = null; }
            if (rel != null) cands.Add(rel);
        }
        if (cands.Count == 0) throw new IdentifyError("MusicBrainz didn't give that release", 502);
        return await ApplyChosen(al, input, cands, how ?? (!string.IsNullOrEmpty(barcode) ? "barcode" : "link"));
    }

    /* The release you chose written to the album, whatever its score. */
    private Task<MatchRow?> ApplyChosen(Album al, JsObj input, List<JsObj> cands, string how) => Writing<MatchRow?>(async () =>
    {
        await Task.CompletedTask;
        var verdict = Score.Decide(input, cands);
        var best = verdict.Best!;
        using var c = Db.Open();
        using var tx = c.BeginTransaction();
        var prev = Row(c, al.Key);
        if (prev != null && prev.Status == "applied") Undo(c, tx, al, prev);
        var now = (double)Now;
        Put(c, tx, new MatchRow
        {
            Key = al.Key, Mbid = best.Candidate["mbid"] is Undef ? null : best.Candidate["mbid"], Distance = best.Distance, Status = "applied",
            Candidate = Js.Json(Score.Kept(best, ("manual", how))),
            Before = Js.Json(Snapshot(c, tx, al)), CheckedAt = now, AppliedAt = now,
            ITunes = prev != null ? (Js.Truthy(prev.ITunes) ? prev.ITunes : null) : null
        });
        Apply(c, tx, al, With(best.Candidate, "pairs", best.Pairs));
        tx.Commit();
        log($"[identify] {al.Artist} — {al.Title} → {Js.Str(best.Candidate["artist"])} — {Js.Str(best.Candidate["title"])} (by {how}, {Js.Num(Js.Round((1 - best.Distance) * 100))} %)");
        return (Row(c, al.Key), true);
    });

    // ------------------------------------------------------------ the album's overlays (lib/library/index.js)

    /* The album's edit and track titles as they are, for undo. */
    private static JsObj Snapshot(SqliteConnection c, SqliteTransaction? tx, Album al)
    {
        var cur = RowsTx(c, tx, "SELECT title, artist, year FROM album_edits WHERE key = $1", al.Key).FirstOrDefault() ?? new object?[3];
        var edit = new JsObj();
        edit["title"] = Js.Truthy(cur[0]) ? cur[0] : null;
        edit["artist"] = Js.Truthy(cur[1]) ? cur[1] : null;
        edit["year"] = Js.Truthy(cur[2]) ? cur[2] : null;
        var tracks = new JsObj();
        foreach (var r in RowsTx(c, tx, "SELECT pos, title FROM track_edits WHERE key = $1 AND title IS NOT NULL ORDER BY rowid", al.Key)) tracks[Js.Str(r[0])] = r[1];
        var o = new JsObj();
        o["edit"] = edit;
        o["tracks"] = tracks;
        return o;
    }

    private static List<object?[]> RowsTx(SqliteConnection c, SqliteTransaction? tx, string sql, params object?[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        for (var i = 0; i < args.Length; i++) cmd.Parameters.AddWithValue("$" + (i + 1), Bind(args[i]));
        using var r = cmd.ExecuteReader();
        var rows = new List<object?[]>();
        while (r.Read())
        {
            var row = new object?[r.FieldCount];
            for (var i = 0; i < r.FieldCount; i++) row[i] = Value(r.IsDBNull(i) ? null : r.GetValue(i));
            rows.Add(row);
        }
        return rows;
    }

    /* library.saveEdit(id, { title, artist, year }): laid over the album; an empty value puts back what was scanned. */
    private static void SaveEdit(SqliteConnection c, SqliteTransaction tx, Album al, object? title, object? artist, object? year)
    {
        var cur = RowsTx(c, tx, "SELECT title, artist, year, art, art_hash, art_source FROM album_edits WHERE key = $1", al.Key).FirstOrDefault() ?? new object?[6];
        object? Or(object? v) => Js.Truthy(v) ? v : null;
        string? Text(object? v, string scanned)
        {
            var t = Js.Trim(Js.IsNullish(v) ? "" : Js.Str(v));
            return t.Length > 0 && t != scanned ? t : null;
        }
        var nTitle = Text(title, al.ScannedTitle);
        var nArtist = Text(artist, al.ScannedArtist);
        var y = Js.ParseInt(year);
        object? nYear = y >= 1000 && y <= 2999 && !(al.ScannedYear is long sy && sy == y) ? y : null;
        object? art = Or(cur[3]), artHash = Or(cur[4]), artSource = Or(cur[5]);
        if (nTitle == null && nArtist == null && nYear == null && art == null)
            Exec(c, tx, "DELETE FROM album_edits WHERE key = $1", al.Key);
        else
            Exec(c, tx, @"INSERT INTO album_edits(key, title, artist, year, art, art_hash, art_source, updated_at)
                          VALUES($1, $2, $3, $4, $5, $6, $7, $8)
                          ON CONFLICT(key) DO UPDATE SET title=excluded.title, artist=excluded.artist, year=excluded.year,
                            art=excluded.art, art_hash=excluded.art_hash, art_source=excluded.art_source,
                            updated_at=excluded.updated_at",
                al.Key, nTitle, nArtist, nYear, art, artHash, artSource, (double)Now);
    }

    /* library.saveTrackEdits(id, titles): each position's title, or the tagged one put back. */
    private static void SaveTrackEdits(SqliteConnection c, SqliteTransaction tx, Album al, JsObj titles)
    {
        var rows = RowsTx(c, tx, "SELECT disc_no, track_no, title FROM tracks WHERE album_id = $1 ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path", (double)al.Id);
        foreach (var pos in titles.Keys)
        {
            var title = titles[pos];
            var t = Js.Trim(Js.IsNullish(title) ? "" : Js.Str(title));
            var i = -1;
            for (var k = 0; k < rows.Count && i < 0; k++) if (TrackPos(rows[k][0], rows[k][1], k) == pos) i = k;
            var tagged = i >= 0 ? (Js.Truthy(rows[i][2]) ? Js.Str(rows[i][2]) : "") : null;
            if (t.Length == 0 || t == tagged) Exec(c, tx, "DELETE FROM track_edits WHERE key = $1 AND pos = $2", al.Key, pos);
            else Exec(c, tx, "INSERT INTO track_edits(key, pos, title) VALUES($1, $2, $3) ON CONFLICT(key, pos) DO UPDATE SET title = excluded.title", al.Key, pos, t);
        }
    }

    /*
     * Write a candidate's names over the album: the album's name and the year
     * it first came out (the group's), never the pressing's; each track the
     * name of the release track it was paired with (by position only for a
     * candidate kept without its pairs); one paired with nothing keeps its tag.
     */
    private static void Apply(SqliteConnection c, SqliteTransaction tx, Album al, JsObj cand)
    {
        SaveEdit(c, tx, al, Score.Clean(cand["title"]), cand["artist"], Js.Truthy(cand["year"]) ? cand["year"] : "");
        var rows = RowsTx(c, tx, "SELECT disc_no, track_no FROM tracks WHERE album_id = $1 ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path", (double)al.Id);
        var pairs = cand["pairs"] as List<object?>;
        var tracks = L(cand["tracks"]);
        var titles = new JsObj();
        for (var i = 0; i < rows.Count; i++)
        {
            var p = pairs != null ? (i < pairs.Count ? pairs[i] : Undef.V) : (double)i;
            JsObj? r = null;
            if (!Js.IsNullish(p))
            {
                var j = Js.ToNumber(p);
                if (j >= 0 && j == Math.Floor(j) && j < tracks.Count) r = tracks[(int)j] as JsObj;
            }
            if (r != null && Js.Truthy(r["title"])) titles[TrackPos(rows[i][0], rows[i][1], i)] = Score.Clean(r["title"]);
        }
        SaveTrackEdits(c, tx, al, titles);
    }

    /* Put back what the album had before the match was applied (undo's writes). */
    private static void Undo(SqliteConnection c, SqliteTransaction tx, Album al, MatchRow r)
    {
        object? before = null;
        try { before = JsJson.Parse(Js.Truthy(r.Before) ? Js.Str(r.Before) : "null"); } catch (Exception) { /* none */ }
        var b = before as JsObj;
        var e = (b != null && Js.Truthy(b["edit"]) ? b["edit"] as JsObj : null) ?? new JsObj();
        SaveEdit(c, tx, al, Js.Truthy(e["title"]) ? e["title"] : "", Js.Truthy(e["artist"]) ? e["artist"] : "", Js.Truthy(e["year"]) ? e["year"] : "");
        Exec(c, tx, "DELETE FROM track_edits WHERE key = $1", al.Key);
        if (b != null && b["tracks"] is JsObj t && t.Count > 0) SaveTrackEdits(c, tx, al, t);
        var next = r.Copy();
        next.Status = "rejected";
        next.Before = null;
        next.AppliedAt = null;
        Put(c, tx, next);
    }

    /* Forget every verdict that wasn't applied, so the scan looks at those albums again. Declined ones stay declined. */
    public Task<int> RecheckAll() => Writing(async () =>
    {
        await Task.CompletedTask;
        using var c = Db.Open();
        return (Exec(c, null, "DELETE FROM album_matches WHERE status IN ('unidentified', 'proposed')"), false);
    });

    // ------------------------------------------------------------ your say

    public Task<MatchRow?> Accept(Album al) => Writing<MatchRow?>(async () => { await Task.CompletedTask; var r = AcceptNow(al); return (r, r != null); });

    private MatchRow? AcceptNow(Album al)
    {
        using var c = Db.Open();
        var r = Row(c, al.Key);
        if (r == null || !Js.Truthy(r.Candidate)) return null;
        var cand = JsJson.Parse(Js.Str(r.Candidate)) as JsObj ?? new JsObj();
        using var tx = c.BeginTransaction();
        var next = r.Copy();
        next.Status = "applied";
        next.Before = Js.Json(Snapshot(c, tx, al));
        next.AppliedAt = (double)Now;
        Put(c, tx, next);
        Apply(c, tx, al, cand);
        tx.Commit();
        return Row(c, al.Key);
    }

    /* listed: the album is on the walls (albumFor finds it); undo needs it, declining a proposal doesn't. */
    public Task<MatchRow?> Reject(Album al, bool listed) => Writing<MatchRow?>(async () =>
    {
        await Task.CompletedTask;
        using var c = Db.Open();
        var r = Row(c, al.Key);
        if (r == null || (r.Status == "applied" && !listed)) return (null, false);
        using var tx = c.BeginTransaction();
        var undone = r.Status == "applied";
        if (undone) Undo(c, tx, al, r);
        else
        {
            var next = r.Copy();
            next.Status = "rejected";
            next.AppliedAt = null;
            Put(c, tx, next);
        }
        tx.Commit();
        return (Row(c, al.Key), undone);
    });

    /* Put back what the album had before the match was applied. */
    public Task<MatchRow?> UndoIt(Album al) => Writing<MatchRow?>(async () =>
    {
        await Task.CompletedTask;
        using var c = Db.Open();
        var r = Row(c, al.Key);
        if (r == null || r.Status != "applied") return (null, false);
        using var tx = c.BeginTransaction();
        Undo(c, tx, al, r);
        tx.Commit();
        return (Row(c, al.Key), true);
    });

    /* Forget the verdict: the scan looks at the album again (from the pack too, while musicbrainz.org is away). */
    public Task<bool> Recheck(Album al, bool listed) => Writing(async () =>
    {
        await Task.CompletedTask;
        using var c = Db.Open();
        var r = Row(c, al.Key);
        using var tx = c.BeginTransaction();
        var undone = r != null && r.Status == "applied" && listed;
        if (undone) Undo(c, tx, al, r!);
        Exec(c, tx, "DELETE FROM album_matches WHERE key = $1", al.Key);
        tx.Commit();
        lock (state) packTried.Remove(al.Key);
        return (true, undone);
    });

    // ------------------------------------------------------------ the loop

    public void Start()
    {
        if (timer != null) return;
        stopped = false;
        timer = new Timer(_ => { _ = Tick(); }, null, tickMs, tickMs);
    }

    public void Stop()
    {
        stopped = true;
        timer?.Dispose();
        timer = null;
    }

    /* While the C# server doesn't hold the work (the Node server restarting): nothing is started. */
    public Func<bool> Ready = () => true;

    /*
     * Proposals already waiting that the rule now applies (95 % alike): applied
     * once the library is there, as if accepted. → how many were applied.
     */
    private async Task<int> ApplyWaiting(Snapshot lib)
    {
        List<MatchRow> rows;
        using (var c = Db.Open()) rows = Rows(c, $"SELECT {RowColumns} FROM album_matches WHERE status = 'proposed' AND candidate IS NOT NULL").Select(RowOf).ToList();
        var n = 0;
        foreach (var r in rows)
        {
            JsObj? cand;
            try { cand = JsJson.Parse(Js.Str(r.Candidate)) as JsObj; } catch (Exception) { continue; }
            if (!Score.AppliesUnasked(r.Distance is double d ? d : null)) continue;
            var al = lib.Albums.FirstOrDefault(a => a.Key == r.Key);
            if (al == null || await Accept(al) == null) continue;
            n++;
            log($"[identify] {al.Artist} — {al.Title} → {Js.Str(cand?["artist"])} — {Js.Str(cand?["title"])} ({Js.Num(Score.Similarity(Js.ToNumber(r.Distance)))} %, waiting, now applied)");
        }
        return n;
    }

    public async Task Tick()
    {
        if (Interlocked.Exchange(ref ticking, 1) == 1) return;
        try
        {
            if (busy != null || stopped || !Ready()) return;
            var cur = await Library.CurrentState();
            if (cur is not var (lib, st) || lib.Count == 0) return;
            if (!waitingApplied) { waitingApplied = true; await ApplyWaiting(lib); }
            var stNow = State(lib, st);
            // musicbrainz.org is back: what the pack alone couldn't place is asked again.
            lock (state) if (Now >= pausedUntil && packTried.Count > 0) packTried.Clear();
            if (Js.StrictEq(stNow["reason"], "pack"))
            {
                var al = Next(lib, packOnly: true);
                if (al == null) return;
                Run(al, async () =>
                {
                    try { await IdentifyFromPack(al); }
                    catch (Exception e) { log($"[identify] pack: {e.Message}"); }
                });
                return;
            }
            if (!Js.Truthy(stNow["active"])) return;
            var next = Next(lib);
            if (next == null) return;
            Run(next, async () =>
            {
                try { await Identify(next); failures = 0; }
                catch (Exception e)
                {
                    // MusicBrainz down or unreachable: leave it ten minutes rather than knock every few seconds.
                    if (++failures >= 3)
                    {
                        pausedUntil = Now + 10 * 60 * 1000;
                        failures = 0;
                        log($"[identify] MusicBrainz isn't answering ({e.Message}); trying again in ten minutes");
                    }
                }
            });
        }
        catch (Exception e) { log($"[identify] {e.GetType().Name}: {e.Message}"); }
        finally { Interlocked.Exchange(ref ticking, 0); }
    }

    /* One album looked at, in the background: busy (and current) until it's done. */
    private void Run(Album al, Func<Task> work)
    {
        var done = new TaskCompletionSource();
        busy = done.Task;
        SetCurrent(al);
        _ = Task.Run(async () =>
        {
            try { await work(); }
            finally { SetCurrent(null); busy = null; done.SetResult(); }
        });
    }

    private void SetCurrent(Album? al)
    {
        JsObj? o = null;
        if (al != null)
        {
            o = new JsObj();
            o["id"] = (double)al.Id;
            o["title"] = al.Title;
            o["artist"] = al.Artist;
        }
        lock (state) current = o;
    }

    // ------------------------------------------------------------ the page

    public static JsObj Progress(Snapshot lib, Dictionary<string, MatchRow> rows)
    {
        var counts = new Dictionary<string, double> { ["applied"] = 0, ["proposed"] = 0, ["unidentified"] = 0, ["rejected"] = 0 };
        var keys = new HashSet<string>(Eligible(lib).Select(al => al.Key));
        double checkedN = 0;
        foreach (var (key, r) in rows)
        {
            if (!keys.Contains(key)) continue;
            checkedN++;
            if (counts.ContainsKey(r.Status)) counts[r.Status]++;
        }
        var o = new JsObj();
        o["eligible"] = (double)keys.Count;
        o["checked"] = checkedN;
        foreach (var k in new[] { "applied", "proposed", "unidentified", "rejected" }) o[k] = counts[k];
        return o;
    }
}
