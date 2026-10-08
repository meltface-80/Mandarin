// Transcoder.cs — conversions made here (v0.8.11), from lib/stream.js
// (Transcoder, ffmpegArgs), setting for setting.
//
// A file a device can't take as it is goes to it as FLAC, made by ffmpeg into
// <data>/transcode under a name that says what it is (track, file time, rate,
// depth, -hq for a streamer's, -x for a repack), written as .part and renamed
// when complete, and sent while it is being made. The next tracks are made
// ahead of play, in the background, two at a time (TRANSCODE_CONCURRENCY), and
// the cache is kept under TRANSCODE_CACHE_GB (4), least recently used first.
//
// This side makes the conversions of the music folders' own files. The Node
// server still makes those it alone can: a zone's DSP, a ReplayGain, 32-bit
// output, and a track fetched from Qobuz or Tidal. Their names never meet
// (a DSP or gain is in the name; a service's track has its own id). The Node
// server hands its "make these next" for the rest to this side
// (POST /internal/transcode/prefetch), so one file is only ever made by one.
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal sealed record ConvTrack(long Id, string Path, long Mtime);
internal sealed record ConvPlan(long Rate, int Bits, bool Hq, bool Exact, string Reason);

internal sealed class ConvJob
{
    public required string Key, Part, Final;
    public volatile bool Done, Failed;
    public readonly TaskCompletionSource Finished = new(TaskCreationOptions.RunContinuationsAsynchronously);
    // Woken whenever ffmpeg writes (a reader waits on it rather than polling fast).
    private TaskCompletionSource more = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public Task More => Volatile.Read(ref more).Task;
    public void Wake() => Interlocked.Exchange(ref more, new(TaskCreationOptions.RunContinuationsAsynchronously)).TrySetResult();
}

internal static partial class Transcoder
{
    private static string dir = "";
    private static long maxBytes;
    private static int concurrency;
    private static readonly ConcurrentDictionary<string, ConvJob> Jobs = new();
    private static readonly List<(string Key, ConvTrack T, ConvPlan P)> Queue = [];
    private static int running;
    private static readonly Lazy<(string Bin, bool Ok, bool Soxr)> Ff = new(Probe);

    public static void Init(string dataDir)
    {
        dir = Path.Combine(dataDir, "transcode");
        Directory.CreateDirectory(dir);
        maxBytes = (long)((double.TryParse(Environment.GetEnvironmentVariable("TRANSCODE_CACHE_GB"), NumberStyles.Float, CultureInfo.InvariantCulture, out var gb) && gb > 0 ? gb : 4) * 1024 * 1024 * 1024);
        concurrency = Math.Max(1, int.TryParse(Environment.GetEnvironmentVariable("TRANSCODE_CONCURRENCY"), out var c) ? c : 2);
        // A .part left from a crash is never complete (none can be this run's yet).
        foreach (var f in Directory.EnumerateFiles(dir, "*.part")) { try { File.Delete(f); } catch (IOException) { /* gone */ } }
    }

    /* ffmpeg.js info: where ffmpeg is, and whether it has libsoxr. */
    private static (string, bool, bool) Probe()
    {
        var bin = Environment.GetEnvironmentVariable("FFMPEG_PATH") is { Length: > 0 } b ? b : "ffmpeg";
        try
        {
            var psi = new ProcessStartInfo(bin) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            psi.ArgumentList.Add("-hide_banner"); psi.ArgumentList.Add("-buildconf");
            using var p = Process.Start(psi)!;
            var stdout = p.StandardOutput.ReadToEndAsync();
            _ = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(10000)) { try { p.Kill(); } catch { /* gone */ } return (bin, false, false); }
            return (bin, p.ExitCode == 0, stdout.Result.Contains("--enable-libsoxr", StringComparison.Ordinal));
        }
        catch (Exception) { return (bin, false, false); }
    }

    public static bool Soxr => Ff.Value.Soxr;
    public static string Bin => Ff.Value.Bin;
    /* ffmpeg is there and runs (ffmpeg.js info().ok). */
    public static bool FfOk => Ff.Value.Ok;

    public static string KeyFor(ConvTrack t, ConvPlan p) => $"{t.Id}-{t.Mtime}-{p.Rate}-{p.Bits}{(p.Hq ? "-hq" : "")}{(p.Exact ? "-x" : "")}";
    public static string FinalPath(string key) => Path.Combine(dir, key + ".flac");

    /* stream.js ffmpegArgs, for a conversion with no DSP and no gain. */
    public static List<string> Args(string src, ConvPlan p, string dest)
    {
        var soxr = Ff.Value.Soxr;
        var resampler = soxr ? (p.Hq ? "resampler=soxr:precision=33:" : "resampler=soxr:precision=28:") : "";
        var internalFmt = p.Hq ? "internal_sample_fmt=dblp:" : "";
        var dither = p.Exact || p.Bits == 32 ? "dither_method=0" : p.Bits == 16 ? "dither_method=triangular_hp" : "dither_method=triangular";
        var graph = $"aresample={resampler}{internalFmt}osr={p.Rate}:{dither}";
        return
        [
            "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
            "-i", src,
            "-map", "0:a:0",
            "-vn",
            "-af", graph,
            "-ar", p.Rate.ToString(CultureInfo.InvariantCulture),
            "-ac", "2",
            "-sample_fmt", p.Bits == 16 ? "s16" : "s32",
            "-bits_per_raw_sample", p.Bits.ToString(CultureInfo.InvariantCulture),
            "-map_metadata", "0",
            "-c:a", "flac", "-compression_level", "5",
            "-f", "flac",
            dest
        ];
    }

    /* Start (or join) a conversion now. */
    public static ConvJob Start(ConvTrack t, ConvPlan p, bool background = false)
    {
        var key = KeyFor(t, p);
        var dest = FinalPath(key);
        if (File.Exists(dest))
        {
            var now = DateTime.UtcNow;
            try { File.SetLastWriteTimeUtc(dest, now); File.SetLastAccessTimeUtc(dest, now); } catch (IOException) { /* best effort */ }
            var done = new ConvJob { Key = key, Part = dest, Final = dest, Done = true };
            done.Finished.TrySetResult();
            return done;
        }
        var job = new ConvJob { Key = key, Part = dest + ".part", Final = dest };
        var existing = Jobs.GetOrAdd(key, job);
        if (existing != job) return existing;

        var err = new StringBuilder();
        void Finish(int code)
        {
            if (code == 0 && File.Exists(job.Part))
            {
                try { File.Move(job.Part, dest, overwrite: true); }
                catch (IOException e) { job.Failed = true; err.Append(e.Message); }
            }
            else
            {
                job.Failed = true;
                try { File.Delete(job.Part); } catch (IOException) { /* never made */ }
            }
            job.Done = true;
            if (job.Failed) Front.Log($"[stream] transcode failed for {t.Path}: {err.ToString().Trim()[..Math.Min(300, err.ToString().Trim().Length)]}");
            Jobs.TryRemove(key, out _);
            job.Wake();
            job.Finished.TrySetResult();
            Prune();
        }
        try
        {
            var psi = new ProcessStartInfo(Ff.Value.Bin) { UseShellExecute = false, RedirectStandardError = true, RedirectStandardInput = true };
            foreach (var a in Args(t.Path, p, job.Part)) psi.ArgumentList.Add(a);
            // On playback's cores (Cpu.cs): made ahead, not waited for, just below what a device is waiting for.
            var kind = background ? CpuKind.Ahead : CpuKind.Playback;
            Cpu.Place(psi, kind);
            var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            proc.ErrorDataReceived += (_, e) => { if (e.Data != null && err.Length < 4000) lock (err) err.AppendLine(e.Data); };
            proc.Exited += (_, _) => { proc.WaitForExit(); Cpu.Forget(proc); Finish(proc.ExitCode); proc.Dispose(); };
            proc.Start();
            Cpu.Adopt(proc, kind);
            proc.StandardInput.Close();
            proc.BeginErrorReadLine();
            Front.Log($"[stream] {Path.GetFileName(t.Path)}: {p.Reason} → FLAC {p.Bits}/{(p.Rate / 1000.0).ToString(CultureInfo.InvariantCulture)} kHz");
            // A reader waiting for more is woken as the .part grows.
            _ = Task.Run(async () =>
            {
                long last = -1;
                while (!job.Done)
                {
                    await Task.Delay(100);
                    long len = 0;
                    try { len = new FileInfo(job.Part).Length; } catch (IOException) { /* not there yet */ }
                    if (len != last) { last = len; job.Wake(); }
                }
            });
        }
        catch (Exception e)
        {
            err.Append(e.Message);
            Finish(-1);
        }
        return job;
    }

    /* Queue conversions to be made in the background, in order. */
    public static void Prefetch(IEnumerable<(ConvTrack T, ConvPlan P)> items)
    {
        lock (Queue)
        {
            foreach (var (t, p) in items)
            {
                var key = KeyFor(t, p);
                if (Jobs.ContainsKey(key) || File.Exists(FinalPath(key)) || Queue.Any(q => q.Key == key)) continue;
                Queue.Add((key, t, p));
            }
        }
        Pump();
    }

    private static void Pump()
    {
        while (true)
        {
            (string Key, ConvTrack T, ConvPlan P) next;
            lock (Queue)
            {
                if (running >= concurrency || Queue.Count == 0) return;
                next = Queue[0];
                Queue.RemoveAt(0);
            }
            var job = Start(next.T, next.P, background: true);
            if (job.Done) continue;
            Interlocked.Increment(ref running);
            job.Finished.Task.ContinueWith(_ => { Interlocked.Decrement(ref running); Pump(); });
        }
    }

    /* Keep the cache under its ceiling, least recently used first. */
    private static void Prune()
    {
        try
        {
            var files = new DirectoryInfo(dir).GetFiles("*.flac").OrderBy(f => f.LastWriteTimeUtc).ToList();
            long total = files.Sum(f => f.Length);
            while (total > maxBytes && files.Count > 1)
            {
                var f = files[0];
                files.RemoveAt(0);
                try { var n = f.Length; f.Delete(); total -= n; } catch (IOException) { /* in use or gone */ }
            }
        }
        catch (IOException) { /* no cache yet */ }
    }

    /*
     * A file still being made: what there is, then the rest as it comes, until
     * ffmpeg is done (stream.js tailFollow). No length is known yet, so it goes
     * out chunked, the way an internet radio stream does, without ranges.
     */
    public static async Task TailFollow(HttpContext ctx, ConvJob job, string mime)
    {
        ctx.Response.StatusCode = 200;
        ctx.Response.ContentType = mime;
        ctx.Response.Headers.CacheControl = "no-store";
        ctx.Response.Headers.AcceptRanges = "none";
        ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
        if (HttpMethods.IsHead(ctx.Request.Method)) return;
        var buf = new byte[256 * 1024];
        long pos = 0;
        var aborted = ctx.RequestAborted;
        FileStream? fs = null;
        try
        {
            while (!aborted.IsCancellationRequested)
            {
                if (fs == null)
                {
                    // The .part, or the finished file it was renamed to (the same bytes, at the same place).
                    foreach (var f in new[] { job.Part, job.Final })
                    {
                        try { fs = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete); fs.Position = pos; break; }
                        catch (IOException) { fs = null; }
                    }
                    if (fs == null)
                    {
                        if (job.Done) { if (job.Failed) ctx.Abort(); return; }
                        await Task.WhenAny(job.More, Task.Delay(100, aborted));
                        continue;
                    }
                }
                var more = job.More;
                int n = await fs.ReadAsync(buf, aborted);
                if (n > 0)
                {
                    pos += n;
                    await ctx.Response.Body.WriteAsync(buf.AsMemory(0, n), aborted);
                    continue;
                }
                if (job.Done)
                {
                    // Finished while this was reading: anything written last is read before the end.
                    n = await fs.ReadAsync(buf, aborted);
                    if (n > 0) { pos += n; await ctx.Response.Body.WriteAsync(buf.AsMemory(0, n), aborted); continue; }
                    if (job.Failed) ctx.Abort();
                    return;
                }
                await ctx.Response.Body.FlushAsync(aborted);
                await Task.WhenAny(more, Task.Delay(200, aborted));
            }
        }
        catch (OperationCanceledException) { /* the device went away */ }
        finally { fs?.Dispose(); }
    }

    // ------------------------------------------------------ from the Node server

    /*
     * POST /internal/transcode/prefetch, from this machine with the key: the
     * Node server's "make these next" for the conversions this side makes.
     * Before the gate (which turns /internal/ away at the door).
     */
    public static void UseInternal(WebApplication app)
    {
        app.Use(async (ctx, next) =>
        {
            if (ctx.Request.Path.Value != "/internal/transcode/prefetch") { await next(); return; }
            var from = ctx.Connection.RemoteIpAddress;
            var key = ctx.Request.Headers["X-Mandarin-Front-Key"].ToString();
            if (from == null || !System.Net.IPAddress.IsLoopback(from) || !HttpMethods.IsPost(ctx.Request.Method)
                || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(key), Encoding.UTF8.GetBytes(Library.FrontKey)))
            {
                ctx.Response.StatusCode = 404;
                return;
            }
            JsonArray? items = null;
            try { items = await JsonNode.ParseAsync(ctx.Request.Body) as JsonArray; } catch (System.Text.Json.JsonException) { /* none */ }
            var work = new List<(ConvTrack, ConvPlan)>();
            foreach (var it in items ?? [])
            {
                if (it is not JsonObject o || o["track"] is not JsonObject t || o["plan"] is not JsonObject p) continue;
                if (Parse(t, p) is { } w) work.Add(w);
            }
            Prefetch(work);
            ctx.Response.StatusCode = 204;
        });
    }

    /* A track and plan as the Node server sends them, when this side makes such a conversion. */
    private static (ConvTrack, ConvPlan)? Parse(JsonObject t, JsonObject p)
    {
        static double Num(JsonNode? n) => n is JsonValue v && v.GetValueKind() == System.Text.Json.JsonValueKind.Number ? double.Parse(v.ToJsonString(), CultureInfo.InvariantCulture) : double.NaN;
        static bool Truthy(JsonNode? n) => Js.Truthy(n);
        var path = Js.Str(t["path"]);
        var id = Num(t["id"]);
        var rate = Num(p["rate"]);
        var bits = Num(p["bits"]);
        if (path.Length == 0 || path.Contains("://", StringComparison.Ordinal) || double.IsNaN(id) || !Truthy(p["transcode"])) return null;
        if (Truthy(p["dsp"]) || Truthy(p["gain"]) || Truthy(p["copy"])) return null;   // the Node server's
        if (bits is not (16 or 24) || !(rate >= 8000 && rate <= 768000)) return null;
        var mtime = Num(t["mtime"]);
        return (new ConvTrack((long)id, path, double.IsNaN(mtime) ? 0 : (long)Math.Floor(mtime)),
                new ConvPlan((long)rate, (int)bits, Truthy(p["hq"]), Truthy(p["exact"]), Js.Str(p["reason"])));
    }
}
