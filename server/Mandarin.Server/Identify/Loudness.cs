// Loudness.cs — measuring loudness (v0.8.19): the measuring half of
// lib/loudness.js, rule for rule. Files without ReplayGain tags are measured
// (EBU R128 integrated loudness and true peak, by ffmpeg's ebur128 filter)
// when "Measure ReplayGain" is on, in the background: a file at a time on each
// core playback doesn't keep, at the lowest priority. What's measured goes
// into track_loudness, which the Node server reads for each track's gain.
//
// When, and in what order (v0.8.24):
//   - the hours are the identification scan's: with Scheduling on, only
//     between its start and end times; with it off, whenever, until done;
//   - never while the library scan is running;
//   - album by album, newest additions first, so each album's gain is known
//     as soon as can be; an album once the identification scan has looked at
//     it, while that scan is working through the library — the scan first,
//     then the measuring. When it isn't (switched off, done, MusicBrainz not
//     answering), any album.
// Qobuz and Tidal tracks (qobuz://, tidal://) have no file here and are never
// measured, nor counted as waiting to be.
//
// The gains themselves (which one a device gets, the album's from its tracks)
// stay with the Node server, which plays.
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Loudness(Action<string> log, int tickMs)
{
    // ffmpeg's ebur128, the frames' own lines at "verbose" (not shown at
    // ffmpeg's usual level), the summary at "info": what is read. Not
    // framelog=quiet, which ffmpeg 5.1 — Debian 12's, the image's — doesn't
    // know: every file failed there (v0.8.24). lib/loudness.js has the same.
    public const string Filter = "ebur128=peak=true:framelog=verbose";

    private readonly object gate = new();
    private readonly Dictionary<double, Process?> jobs = [];   // track id → its ffmpeg, being measured now
    private readonly Queue<(double Id, string Path)> queue = new();   // the album being measured: its tracks not started yet
    private JsObj? current;                                    // that album: { offset, title, subtitle }
    private string idle = "";                                  // why nothing was started last time: "identifying", "done", or ""
    private Timer? timer;
    private int ticking;

    /* While the C# server doesn't hold the work (the Node server restarting): nothing is started. */
    public Func<bool> Ready = () => true;
    /* The identification scan, whose hours and order the measuring keeps to. */
    public Func<Identifier?> Identify = () => null;

    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    // ------------------------------------------------------------ the setting

    private static object? Stored()
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT value FROM settings WHERE key = 'replaygain'";
        if (cmd.ExecuteScalar() is not string v) return new JsObj();
        try { return JsJson.Parse(v); } catch (Exception) { return new JsObj(); }
    }

    /* The server's own switch: measuring files without ReplayGain tags. */
    public JsObj Settings()
    {
        var s = Stored();
        var o = new JsObj();
        o["measure"] = Js.Truthy(s) && s is JsObj j && Js.Truthy(j["measure"]);
        return o;
    }

    /* Measure ReplayGain switched on or off (Settings → Library Scanner). */
    public JsObj Set(JsObj patch)
    {
        var s = Settings();
        if (!Js.IsUndef(patch["measure"])) s["measure"] = Js.Truthy(patch["measure"]);
        var kept = Stored();
        var merged = new JsObj();
        if (Js.Truthy(kept) && kept is JsObj k) foreach (var key in k.Keys) merged[key] = k[key];
        foreach (var key in s.Keys) merged[key] = s[key];
        using (var c = Db.Open())
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = "INSERT INTO settings(key, value) VALUES('replaygain', $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
            cmd.Parameters.AddWithValue("$v", Js.Json(merged) ?? "null");
            cmd.ExecuteNonQuery();
        }
        if (Js.Truthy(s["measure"])) Start(); else Stop();
        return s;
    }

    // ------------------------------------------------------------ when

    /* Inside the hours (Scheduling off: always). */
    public static bool InHours()
    {
        var s = Identifier.Stored();
        return !Js.Truthy(s["schedule"]) || Identifier.InWindow(s);
    }

    /*
     * Files that failed before v0.8.24 failed because of ffmpeg's options, not
     * themselves (Filter, above): measured again, once. lib/loudness.js does
     * the same, under the same flag, so whichever server measures does it.
     */
    private static void RetryOnce()
    {
        using var c = Db.Open();
        using var get = c.CreateCommand();
        get.CommandText = "SELECT value FROM settings WHERE key = 'loudnessRetried'";
        if (get.ExecuteScalar() is string) return;
        using var tx = c.BeginTransaction();
        using (var del = c.CreateCommand()) { del.Transaction = tx; del.CommandText = "DELETE FROM track_loudness WHERE lufs IS NULL"; del.ExecuteNonQuery(); }
        using (var put = c.CreateCommand()) { put.Transaction = tx; put.CommandText = "INSERT OR REPLACE INTO settings(key, value) VALUES('loudnessRetried', '1')"; put.ExecuteNonQuery(); }
        tx.Commit();
    }

    // ------------------------------------------------------------ measuring

    public void Start()
    {
        try { RetryOnce(); } catch (Exception e) { log($"[loudness] {e.GetType().Name}: {e.Message}"); }
        lock (gate)
        {
            if (timer != null || !Js.Truthy(Settings()["measure"])) return;
            timer = new Timer(_ => { _ = Tick(); }, null, tickMs, tickMs);
        }
        ThreadPool.QueueUserWorkItem(_ => { _ = Tick(); });
    }

    public void Stop()
    {
        lock (gate)
        {
            timer?.Dispose();
            timer = null;
            queue.Clear();
            current = null;
            foreach (var p in jobs.Values)
            {
                try { p?.Kill(); } catch (Exception) { /* gone */ }
            }
        }
    }

    private bool On { get { lock (gate) return timer != null; } }

    /* As many files at once as there are cores for the rest (fewer while DSP has playback's second). */
    private async Task Tick()
    {
        if (!Ready() || Interlocked.Exchange(ref ticking, 1) == 1) return;
        try
        {
            lock (gate) if (timer == null || jobs.Count >= Cpu.Slots) return;
            // Outside the hours, or while the library is scanned: nothing new starts,
            // and the album under way is chosen again when it may (a scan may have
            // changed its tracks meanwhile).
            var cur = InHours() ? await Library.CurrentState() : null;
            if (cur is not var (lib, st) || st.Scanning)
            {
                lock (gate) queue.Clear();
                return;
            }
            while (true)
            {
                (double Id, string Path) next;
                lock (gate)
                {
                    if (timer == null || jobs.Count >= Cpu.Slots) return;
                    if (queue.Count == 0) next = (-1, "");
                    else next = queue.Dequeue();
                }
                if (next.Id < 0)
                {
                    if (!NextAlbum(lib, st)) return;
                    continue;
                }
                lock (gate)
                {
                    if (jobs.ContainsKey(next.Id)) continue;
                    jobs[next.Id] = null;
                }
                _ = Run(next.Id, next.Path);
            }
        }
        catch (Exception e) { log($"[loudness] {e.GetType().Name}: {e.Message}"); }
        finally { Interlocked.Exchange(ref ticking, 0); }
    }

    private const string Waiting = "t.rg_track_gain IS NULL AND l.track_id IS NULL AND t.path NOT LIKE '%://%'";

    /*
     * The next album to measure, its tracks queued: newest additions first;
     * while the identification scan is working through the library, only an
     * album it has looked at (or won't). False when there is none to start.
     */
    private bool NextAlbum(Snapshot lib, LibState st)
    {
        var pending = new List<double?>();
        double[] busy;
        lock (gate) busy = [.. jobs.Keys];
        using var c = Db.Open();
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = $"SELECT DISTINCT t.album_id FROM tracks t LEFT JOIN track_loudness l ON l.track_id = t.id WHERE {Waiting} AND t.id NOT IN (SELECT value FROM json_each($1))";
            cmd.Parameters.AddWithValue("$1", "[" + string.Join(",", busy.Select(Js.Num)) + "]");
            using var r = cmd.ExecuteReader();
            while (r.Read()) pending.Add(r.IsDBNull(0) ? null : Convert.ToDouble(r.GetValue(0), CultureInfo.InvariantCulture));
        }
        if (pending.Count == 0) { idle = "done"; return false; }

        // The identification scan at work: an album waits for it, unless the scan
        // won't look at it (too few tracks, edited by hand) or already has.
        Func<Album, bool> ready = _ => true;
        var idf = Identify();
        if (idf != null && idf.Running && Js.Truthy(idf.Settings()["enabled"]) && Js.Str(idf.State(lib, st)["reason"]) is "checking" or "starting")
        {
            var rows = Identifier.AllRows(c);
            var eligible = new HashSet<long>(Identifier.Eligible(lib).Select(a => a.Id));
            ready = al => !eligible.Contains(al.Id) || rows.ContainsKey(al.Key) || al.Edited;
        }
        double? pick = null;
        Album? pickAl = null;
        var found = false;
        foreach (var id in pending)
        {
            Album? al = id is double d ? lib.Find(d) : null;
            if (al != null && !ready(al)) continue;
            // Newest first; tracks with no album here (one removed meanwhile) last.
            if (!found || Newer(al, pickAl, id, pick)) { pick = id; pickAl = al; found = true; }
        }
        if (!found) { idle = "identifying"; return false; }
        idle = "";
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = $@"SELECT t.id, t.path FROM tracks t LEFT JOIN track_loudness l ON l.track_id = t.id
                WHERE {Waiting} AND {(pick == null ? "t.album_id IS NULL" : "t.album_id = $a")}
                AND t.id NOT IN (SELECT value FROM json_each($1)) ORDER BY COALESCE(t.disc_no, 1), COALESCE(t.track_no, 9999), t.id LIMIT 500";
            if (pick != null) cmd.Parameters.AddWithValue("$a", pick.Value);
            cmd.Parameters.AddWithValue("$1", "[" + string.Join(",", busy.Select(Js.Num)) + "]");
            using var r = cmd.ExecuteReader();
            lock (gate)
            {
                while (r.Read()) queue.Enqueue((Convert.ToDouble(r.GetValue(0), CultureInfo.InvariantCulture), r.IsDBNull(1) ? "" : r.GetString(1)));
                var o = new JsObj();
                o["offset"] = pickAl != null ? pickAl.Id : null;
                o["title"] = pickAl?.Title ?? "";
                o["subtitle"] = pickAl?.Artist ?? "";
                current = o;
            }
        }
        return true;
    }

    private static bool Newer(Album? a, Album? b, double? aId, double? bId)
    {
        if (a == null) return false;
        if (b == null) return true;
        long x = a.Added ?? 0, y = b.Added ?? 0;
        return x != y ? x > y : (aId ?? 0) > (bId ?? 0);
    }

    private static void Put(double id, double? lufs, double? peak, string? error)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = @"INSERT INTO track_loudness(track_id, lufs, peak, measured_at, error) VALUES($1, $2, $3, $4, $5)
            ON CONFLICT(track_id) DO UPDATE SET lufs = excluded.lufs, peak = excluded.peak, measured_at = excluded.measured_at, error = excluded.error";
        cmd.Parameters.AddWithValue("$1", id);
        cmd.Parameters.AddWithValue("$2", (object?)lufs ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$3", (object?)peak ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$4", (double)Now);
        cmd.Parameters.AddWithValue("$5", (object?)error ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    private async Task Run(double id, string file)
    {
        try
        {
            var (lufs, peak) = await Measure(file, p => { lock (gate) { if (jobs.ContainsKey(id)) jobs[id] = p; } });
            Put(id, lufs, peak, lufs == null ? "no loudness found" : null);
        }
        catch (Exception e)
        {
            // Stopped on purpose: measured again next time. (A track gone meanwhile has nothing to keep.)
            try { if (On) { var m = e.Message; Put(id, null, null, m.Length > 200 ? m[..200] : m); } } catch (Exception) { /* gone */ }
        }
        finally
        {
            lock (gate) jobs.Remove(id);
        }
        if (On) ThreadPool.QueueUserWorkItem(_ => { _ = Tick(); });
    }

    [GeneratedRegex("I:[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*(-?[0-9.]+|-inf)[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*LUFS")]
    private static partial Regex Integrated();
    [GeneratedRegex("Peak:[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*(-?[0-9.]+|-inf)[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*dBFS")]
    private static partial Regex TruePeak();

    /* How loud a measured stretch is, from ebur128's summary. */
    public static (double? Lufs, double? Peak) ParseEbur128(string s)
    {
        var at = s.LastIndexOf("Summary:", StringComparison.Ordinal);
        var tail = at >= 0 ? s[at..] : s;
        var i = Integrated().Match(tail);
        var p = TruePeak().Match(tail);
        double? lufs = i.Success && i.Groups[1].Value != "-inf" ? Js.StringToNumber(i.Groups[1].Value) : null;
        double? peakDb = p.Success && p.Groups[1].Value != "-inf" ? Js.StringToNumber(p.Groups[1].Value) : null;
        return (lufs is double l && double.IsFinite(l) && l > -70 ? l : null,
                peakDb is double pd && double.IsFinite(pd) ? Math.Pow(10, pd / 20) : null);
    }

    /* One file's integrated loudness and true peak, decoded in full. */
    private static async Task<(double? Lufs, double? Peak)> Measure(string file, Action<Process> started)
    {
        var psi = new ProcessStartInfo(Transcoder.Bin) { UseShellExecute = false, RedirectStandardError = true, RedirectStandardOutput = false, RedirectStandardInput = false };
        foreach (var a in new[] { "-hide_banner", "-nostats", "-nostdin", "-i", file, "-map", "0:a:0", "-vn", "-af", Filter, "-f", "null", "-" })
            psi.ArgumentList.Add(a);
        // Below everything else: the cores playback doesn't keep, the lowest priority, its reads last.
        Cpu.Place(psi, CpuKind.Background);
        using var proc = Process.Start(psi) ?? throw new InvalidOperationException("ffmpeg didn't start");
        Cpu.Adopt(proc, CpuKind.Background);
        started(proc);
        var err = new StringBuilder();
        var buf = new char[8192];
        int n;
        while ((n = await proc.StandardError.ReadAsync(buf.AsMemory())) > 0)
        {
            err.Append(buf, 0, n);
            if (err.Length > 64 * 1024) err.Remove(0, err.Length - 16 * 1024);
        }
        await proc.WaitForExitAsync();
        Cpu.Forget(proc);
        var text = err.ToString();
        if (proc.ExitCode != 0)
        {
            var lines = Js.Trim(text).Split('\n');
            var last = lines.Length > 0 && lines[^1].Length > 0 ? lines[^1] : $"ffmpeg exited {(proc.ExitCode == 137 || proc.ExitCode < 0 ? "null" : proc.ExitCode.ToString(CultureInfo.InvariantCulture))}";
            throw new InvalidOperationException(last.Length > 200 ? last[..200] : last);
        }
        return ParseEbur128(text);
    }

    /*
     * For the settings page: the counts (files here only — Qobuz and Tidal
     * tracks apart, as "streamed"), and why it is or isn't measuring now:
     * off, waiting (outside the hours), scanning (the library), identifying
     * (the scan first), measuring, done.
     */
    public JsObj Status(LibState? st)
    {
        double tracks, tagged, measured, failed, streamed;
        using (var c = Db.Open())
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = @"SELECT
                (SELECT COUNT(*) FROM tracks WHERE path NOT LIKE '%://%') AS tracks,
                (SELECT COUNT(*) FROM tracks WHERE rg_track_gain IS NOT NULL AND path NOT LIKE '%://%') AS tagged,
                (SELECT COUNT(*) FROM track_loudness l JOIN tracks t ON t.id = l.track_id WHERE t.rg_track_gain IS NULL AND l.lufs IS NOT NULL) AS measured,
                (SELECT COUNT(*) FROM track_loudness l JOIN tracks t ON t.id = l.track_id WHERE t.rg_track_gain IS NULL AND l.lufs IS NULL) AS failed,
                (SELECT COUNT(*) FROM tracks WHERE path LIKE '%://%') AS streamed";
            using var r = cmd.ExecuteReader();
            r.Read();
            tracks = r.GetInt64(0); tagged = r.GetInt64(1); measured = r.GetInt64(2); failed = r.GetInt64(3); streamed = r.GetInt64(4);
        }
        var left = Math.Max(0, tracks - tagged - measured - failed);
        bool running;
        JsObj? cur;
        string why;
        lock (gate) { running = jobs.Count > 0; cur = current; why = idle; }
        string reason = !On ? "off"
            : left == 0 && !running ? "done"
            : running ? "measuring"
            : !InHours() ? "waiting"
            : st is { Scanning: true } ? "scanning"
            : why == "identifying" ? "identifying"
            : "measuring";
        var o = new JsObj();
        o["settings"] = Settings();
        o["tracks"] = tracks;
        o["tagged"] = tagged;
        o["measured"] = measured;
        o["failed"] = failed;
        o["left"] = left;
        o["streamed"] = streamed;
        o["reason"] = reason;
        o["current"] = reason == "measuring" ? cur : null;
        o["measuring"] = reason == "measuring";
        return o;
    }
}
