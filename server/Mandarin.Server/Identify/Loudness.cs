// Loudness.cs — measuring loudness (v0.8.19): the measuring half of
// lib/loudness.js, rule for rule. Files without ReplayGain tags are measured
// (EBU R128 integrated loudness and true peak, by ffmpeg's ebur128 filter)
// when "Measure loudness" is on, in the background: a file at a time on each
// core playback doesn't keep, at the lowest priority. What's measured goes
// into track_loudness, which the Node server reads for each track's gain.
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
    private readonly object gate = new();
    private readonly Dictionary<double, Process?> jobs = [];   // track id → its ffmpeg, being measured now
    private Timer? timer;
    private int ticking;

    /* While the C# server doesn't hold the work (the Node server restarting): nothing is started. */
    public Func<bool> Ready = () => true;

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

    // ------------------------------------------------------------ measuring

    public void Start()
    {
        lock (gate)
        {
            if (timer != null || !Js.Truthy(Settings()["measure"])) return;
            timer = new Timer(_ => Tick(), null, tickMs, tickMs);
        }
        ThreadPool.QueueUserWorkItem(_ => Tick());
    }

    public void Stop()
    {
        lock (gate)
        {
            timer?.Dispose();
            timer = null;
            foreach (var p in jobs.Values)
            {
                try { p?.Kill(); } catch (Exception) { /* gone */ }
            }
        }
    }

    private bool On { get { lock (gate) return timer != null; } }

    /* As many files at once as there are cores for the rest (fewer while DSP has playback's second). */
    private void Tick()
    {
        if (!Ready() || Interlocked.Exchange(ref ticking, 1) == 1) return;
        try
        {
            while (true)
            {
                string busy;
                lock (gate)
                {
                    if (timer == null || jobs.Count >= Cpu.Slots) return;
                    busy = "[" + string.Join(",", jobs.Keys.Select(Js.Num)) + "]";
                }
                object?[]? row;
                using (var c = Db.Open())
                {
                    using var cmd = c.CreateCommand();
                    cmd.CommandText = @"SELECT t.id, t.path FROM tracks t LEFT JOIN track_loudness l ON l.track_id = t.id
                        WHERE t.rg_track_gain IS NULL AND l.track_id IS NULL AND t.path NOT LIKE '%://%'
                        AND t.id NOT IN (SELECT value FROM json_each($1)) ORDER BY t.id LIMIT 1";
                    cmd.Parameters.AddWithValue("$1", busy);
                    using var r = cmd.ExecuteReader();
                    row = r.Read() ? [Convert.ToDouble(r.GetValue(0), CultureInfo.InvariantCulture), r.IsDBNull(1) ? "" : r.GetString(1)] : null;
                }
                if (row == null) return;
                var id = (double)row[0]!;
                lock (gate) jobs[id] = null;
                _ = Run(id, (string)row[1]!);
            }
        }
        catch (Exception e) { log($"[loudness] {e.GetType().Name}: {e.Message}"); }
        finally { Interlocked.Exchange(ref ticking, 0); }
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
            // Stopped on purpose: measured again next time.
            if (On) { var m = e.Message; Put(id, null, null, m.Length > 200 ? m[..200] : m); }
        }
        finally
        {
            lock (gate) jobs.Remove(id);
        }
        if (On) ThreadPool.QueueUserWorkItem(_ => Tick());
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
        foreach (var a in new[] { "-hide_banner", "-nostats", "-nostdin", "-i", file, "-map", "0:a:0", "-vn", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-" })
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

    /* For the settings page. */
    public JsObj Status()
    {
        double tracks, tagged, measured, failed;
        using (var c = Db.Open())
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = @"SELECT
                (SELECT COUNT(*) FROM tracks) AS tracks,
                (SELECT COUNT(*) FROM tracks WHERE rg_track_gain IS NOT NULL) AS tagged,
                (SELECT COUNT(*) FROM track_loudness l JOIN tracks t ON t.id = l.track_id WHERE t.rg_track_gain IS NULL AND l.lufs IS NOT NULL) AS measured,
                (SELECT COUNT(*) FROM track_loudness l JOIN tracks t ON t.id = l.track_id WHERE t.rg_track_gain IS NULL AND l.lufs IS NULL) AS failed";
            using var r = cmd.ExecuteReader();
            r.Read();
            tracks = r.GetInt64(0); tagged = r.GetInt64(1); measured = r.GetInt64(2); failed = r.GetInt64(3);
        }
        var left = Math.Max(0, tracks - tagged - measured - failed);
        var o = new JsObj();
        o["settings"] = Settings();
        o["tracks"] = tracks;
        o["tagged"] = tagged;
        o["measured"] = measured;
        o["failed"] = failed;
        o["left"] = left;
        o["measuring"] = On && left > 0;
        return o;
    }
}
