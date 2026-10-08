// Waveforms.cs — the shape of a track for the progress bar (v0.8.19):
// lib/waveform.js and lib/waveform-decode.js, rule for rule, with the
// /api/waveform and /api/settings/waveform routes of lib/server/api-library.js.
//
// ffmpeg decodes the file to signed 16-bit PCM, both channels, at 44.1 kHz
// (DECODE_RATE, DECODE_CHANNELS); a level is taken every 10 ms — the RMS of
// that slice — and the levels are resampled to 4,000 buckets by the same
// statistic (the RMS of the whole span), then scaled so the loudest is 255.
// The numbers are the Node server's to the last one: the same sums, in the
// same order, in doubles. Each track's is kept in the cache table (namespace
// "waveform", by track id and mtime) as the Node server kept it, base64.
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static class Waveforms
{
    public const int Buckets = 4000;
    public const int LevelMs = 10;
    public const int DecodeRate = 44100;
    public const int DecodeChannels = 2;
    public const double MinCoverage = 0.9;
    public const int TimeoutMs = 90000;
    public static readonly int Stride = Math.Max(1, (int)TJs.Round(DecodeRate * DecodeChannels * LevelMs / 1000.0));

    /* createPeaks: one RMS level per stride samples, fed PCM as it arrives. */
    public sealed class Peaks(int stride)
    {
        public readonly List<double> Raw = [];
        private double sum;
        private int n;
        private int odd = -1;

        private double Level() => n > 0 ? Math.Sqrt(sum / n) : 0;

        private void Sample(int v)
        {
            sum += (double)v * v;
            if (++n >= stride) { Raw.Add(Level()); sum = 0; n = 0; }
        }

        /* Signed 16-bit little-endian PCM, interleaved; a sample split between two chunks is put back together. */
        public void Push(ReadOnlySpan<byte> buf)
        {
            if (buf.Length == 0) return;
            var i = 0;
            if (odd >= 0)
            {
                Sample((short)((buf[0] << 8) | odd));
                odd = -1;
                i = 1;
            }
            var end = buf.Length - 1;
            for (; i < end; i += 2) Sample((short)(buf[i] | (buf[i + 1] << 8)));
            if (i == buf.Length - 1) odd = buf[i];
        }

        public byte[] Finish(int buckets = Buckets)
        {
            if (n > 0) Raw.Add(Level());   // the partial stride at the end is still audio
            return Normalise(Resample(Raw, buckets));
        }
    }

    /* Exactly `buckets` values, by the same statistic: the RMS of the span; shorter input stretched (nearest). */
    public static double[] Resample(List<double> peaks, int buckets)
    {
        var o = new double[buckets];
        if (peaks.Count == 0) return o;
        long len = peaks.Count;
        if (len <= buckets)
        {
            for (var i = 0; i < buckets; i++) o[i] = peaks[(int)Math.Min(len - 1, i * len / buckets)];
            return o;
        }
        for (var i = 0; i < buckets; i++)
        {
            var a = i * len / buckets;
            var b = Math.Min(len, Math.Max(a + 1, (i + 1) * len / buckets));
            double sum = 0;
            for (var j = a; j < b; j++) sum += peaks[(int)j] * peaks[(int)j];
            o[i] = Math.Sqrt(sum / (b - a));
        }
        return o;
    }

    /* Scaled so the loudest bucket is 255; silence stays silence. */
    public static byte[] Normalise(double[] peaks)
    {
        var o = new byte[peaks.Length];
        double max = 0;
        foreach (var p in peaks) if (p > max) max = p;
        if (max <= 0) return o;
        for (var i = 0; i < peaks.Length; i++) o[i] = (byte)Math.Max(0, Math.Min(255, TJs.Round(peaks[i] * 255 / max)));
        return o;
    }

    private static string lastError = "";
    public static string LastDecodeError => lastError;

    /* A file's waveform, or null when it can't be decoded (never an exception). */
    public static async Task<byte[]?> Decode(string file, double expectSeconds)
    {
        Process proc;
        try
        {
            var psi = new ProcessStartInfo(Transcoder.Bin) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (var a in new[] { "-v", "error", "-nostdin", "-i", file, "-map", "0:a:0", "-f", "s16le", "-ac", DecodeChannels.ToString(CultureInfo.InvariantCulture),
                "-ar", DecodeRate.ToString(CultureInfo.InvariantCulture), "-" }) psi.ArgumentList.Add(a);
            proc = Process.Start(psi)!;
        }
        catch (Exception) { return null; }   // no ffmpeg at all
        using (proc)
        {
            var acc = new Peaks(Stride);
            long bytes = 0;
            var stderr = new System.Text.StringBuilder();
            using var cts = new CancellationTokenSource(TimeoutMs);
            var errTask = Task.Run(async () =>
            {
                var buf = new char[4096];
                int n;
                try
                {
                    while ((n = await proc.StandardError.ReadAsync(buf.AsMemory(), cts.Token)) > 0)
                        if (stderr.Length < 4096) stderr.Append(buf, 0, Math.Min(n, 4096 - stderr.Length));
                }
                catch (Exception) { /* stopped */ }
            });
            try
            {
                var buf = new byte[65536];
                var stdout = proc.StandardOutput.BaseStream;
                int n;
                while ((n = await stdout.ReadAsync(buf.AsMemory(), cts.Token)) > 0)
                {
                    bytes += n;
                    acc.Push(buf.AsSpan(0, n));
                }
                await proc.WaitForExitAsync(cts.Token);
                await errTask;
            }
            catch (OperationCanceledException)
            {
                try { proc.Kill(); } catch (Exception) { /* gone */ }
                return null;
            }
            var err = stderr.ToString();
            string First(string s) => TJs.Trim(s).Split('\n')[0];
            if (bytes == 0)
            {
                if (proc.ExitCode != 0 && err.Length > 0) lastError = First(err);
                return null;
            }
            // How much of the track came through: two bytes a sample, DecodeChannels a frame, DecodeRate frames a second.
            var secs = bytes / (2.0 * DecodeChannels * DecodeRate);
            var want = double.IsFinite(expectSeconds) ? expectSeconds : 0;
            if (want > 0 && secs < want * MinCoverage)
            {
                lastError = "decoded " + secs.ToString("F1", CultureInfo.InvariantCulture) + "s of a " + want.ToString("F1", CultureInfo.InvariantCulture) +
                    "s track — the shape would be stretched over the whole bar" + (err.Length > 0 ? ": " + First(err) : "");
                return null;
            }
            return acc.Finish(Buckets);
        }
    }

    private static readonly ConcurrentDictionary<string, Lazy<Task<JsObj?>>> Inflight = new();

    /* A track's waveform from the cache, or decoded now (once, however many ask) and kept. */
    public static async Task<JsObj?> For(double id, string path, object? mtime, double duration, string title)
    {
        // A streamed track is never read as a file: the plain bar.
        if (path.StartsWith("qobuz://track/", StringComparison.Ordinal) || path.StartsWith("tidal://track/", StringComparison.Ordinal)) return null;
        var key = $"t{TJs.Num(id)}-{TJs.Str(mtime)}";
        using (var c = Db.Open())
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = "SELECT value FROM cache WHERE ns = 'waveform' AND key = $k";
            cmd.Parameters.AddWithValue("$k", key);
            if (cmd.ExecuteScalar() is string v)
            {
                object? hit = null;
                try { hit = Scan.JsJson.Parse(v); } catch (Exception) { /* not ours */ }
                if (TJs.Truthy(hit))
                {
                    var o = new JsObj();
                    o["cached"] = true;
                    if (hit is JsObj h) foreach (var k in h.Keys) o[k] = h[k];
                    return o;
                }
            }
        }
        var job = Inflight.GetOrAdd(key, k0 => new Lazy<Task<JsObj?>>(async () =>
        {
            try
            {
                var peaks = await Decode(path, duration);
                if (peaks == null)
                {
                    Front.Log($"[waveform] no waveform for {title}: {(LastDecodeError.Length > 0 ? LastDecodeError : "undecodable")}");
                    return null;
                }
                var v = new JsObj();
                v["peaks"] = Convert.ToBase64String(peaks);
                v["n"] = (double)peaks.Length;
                using (var c = Db.Open())
                {
                    using var cmd = c.CreateCommand();
                    cmd.CommandText = "INSERT INTO cache(ns, key, value, ts) VALUES('waveform', $k, $v, $t) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, ts = excluded.ts";
                    cmd.Parameters.AddWithValue("$k", key);
                    cmd.Parameters.AddWithValue("$v", TJs.Json(v));
                    cmd.Parameters.AddWithValue("$t", (double)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                    cmd.ExecuteNonQuery();
                }
                var o = new JsObj();
                o["cached"] = false;
                foreach (var k in v.Keys) o[k] = v[k];
                return o;
            }
            finally { Inflight.TryRemove(key, out _); }
        }));
        return await job.Value;
    }
}

internal static partial class Library
{
    /* db.setting("waveformEnabled", false), as JSON.parse reads it. */
    private static object? WaveformOn()
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT value FROM settings WHERE key = 'waveformEnabled'";
        if (cmd.ExecuteScalar() is not string v) return false;
        try { return Scan.JsJson.Parse(v); } catch (Exception) { return false; }
    }

    /* GET /api/waveform?track_id= | ?track=&album=&artist= */
    private static async Task<bool> Waveform(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!TJs.Truthy(WaveformOn())) { var off = new JsObj(); off["peaks"] = null; off["reason"] = "off"; return await SendJs(ctx, off); }
        var title = Names.JsTrim(Q(ctx, "track") ?? "");
        var trackId = Q(ctx, "track_id");
        if (title.Length == 0 && string.IsNullOrEmpty(trackId)) return await JsError(ctx, 400, "track required");
        (double Id, string Path, object? Mtime, double Duration, string Title)? t = null;
        using (var c = Db.Open())
        {
            double id = double.NaN;
            if (!string.IsNullOrEmpty(trackId)) id = Num(trackId);
            else
            {
                var al = Relocate(s, Q(ctx, "album") ?? "", Q(ctx, "artist") ?? "") ?? Relocate(s, Q(ctx, "album") ?? "", null);
                if (al != null)
                {
                    var want = Names.Fold(title);
                    var hit = Tracks(c, s, al).FirstOrDefault(x => Names.Fold(x.Title) == want);
                    if (hit != null) id = hit.Id;
                }
            }
            if (!double.IsNaN(id))
            {
                using var cmd = c.CreateCommand();
                cmd.CommandText = "SELECT id, path, mtime, duration, title FROM tracks WHERE id = $id";
                cmd.Parameters.AddWithValue("$id", id);
                using var r = cmd.ExecuteReader();
                if (r.Read())
                {
                    object? Val(int i) => r.IsDBNull(i) ? null : r.GetValue(i) switch { long l => (double)l, var v => v };
                    var du = Val(3);
                    t = (Convert.ToDouble(r.GetValue(0), CultureInfo.InvariantCulture), Val(1) as string ?? "", Val(2),
                        TJs.Truthy(du) ? TJs.ToNumber(du) : 0, TJs.Str(Val(4) ?? ""));
                }
            }
        }
        if (t == null) { var none = new JsObj(); none["peaks"] = null; none["reason"] = "no-local-file"; return await SendJs(ctx, none); }
        var o = await Waveforms.For(t.Value.Id, t.Value.Path, t.Value.Mtime, t.Value.Duration, t.Value.Title);
        if (o == null) { var bad = new JsObj(); bad["peaks"] = null; bad["reason"] = "undecodable"; return await SendJs(ctx, bad); }
        ctx.Response.Headers.CacheControl = "public, max-age=604800, immutable";
        var res = new JsObj();
        res["peaks"] = o["peaks"];
        res["n"] = o["n"];
        res["cached"] = o["cached"];
        return await SendJs(ctx, res);
    }

    /* GET /api/settings/waveform */
    private static Task<bool> WaveformSettings(HttpContext ctx, Snapshot s, LibState st)
    {
        var o = new JsObj();
        o["enabled"] = WaveformOn();
        o["decoder"] = Transcoder.FfOk;
        o["qobuz_secret_set"] = false;
        o["qobuz_sign_app_id"] = null;
        o["qobuz_sign_token_set"] = false;
        o["qobuz_connected"] = false;
        o["qobuz_user"] = "";
        o["qobuz_ready"] = false;
        return SendJs(ctx, o);
    }

    /* POST /api/settings/waveform { enabled } */
    private static async Task<bool> SaveWaveformSettings(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        if (!b.ContainsKey("enabled")) return await JsError(ctx, 400, "enabled required");
        var on = TJs.Truthy(FromNode(b["enabled"]));
        using (var c = Db.Open()) SetSetting(c, "waveformEnabled", on);
        var o = new JsObj();
        o["ok"] = true;
        o["enabled"] = on;
        o["qobuz_secret_set"] = false;
        return await SendJs(ctx, o);
    }

    // --------------------------------------------------------------- loudness

    /* GET /api/loudness: the switch and how far the measuring has got. */
    private static Task<bool> LoudnessState(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!Jobs.Held || Jobs.Loudness is not { } l) return Task.FromResult(false);
        return SendJs(ctx, l.Status());
    }

    /* POST /api/loudness { measure } */
    private static async Task<bool> SaveLoudness(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!Jobs.Held || Jobs.Loudness is not { } l) return false;
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        l.Set(FromNode(b) as JsObj ?? new JsObj());
        return await SendJs(ctx, l.Status());
    }
}
