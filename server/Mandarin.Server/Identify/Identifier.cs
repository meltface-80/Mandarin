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
// the library is then told (Library.Tell, { edits }) and read again, and
// album-edits.json beside the database kept as before.
using System.Globalization;
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
    // What's written is written one at a time, and the library told of it
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
    public JsObj Settings() => Stored();

    /* The same, for the loudness measuring, which keeps to the same hours (v0.8.24). */
    public static JsObj Stored()
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

    /* Is now (or [at]) inside the night window? A window over midnight (22:00–04:00) counts. */
    public static bool InWindow(JsObj s, DateTime? at = null)
    {
        var d = at ?? DateTime.Now;
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
}
