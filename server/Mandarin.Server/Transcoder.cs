// Transcoder.cs — conversions made here (v0.8.11), from lib/stream.js
// (Transcoder, ffmpegArgs), setting for setting.
//
// A file a device can't take as it is goes to it as FLAC, made by ffmpeg into
// <data>/transcode under a name that says what it is (track, file time, rate,
// depth, -hq for a streamer's, -d and the DSP's fingerprint, -g and the gain,
// -x for a repack), written as .part and renamed when complete, and sent while
// it is being made. The next tracks are made ahead of play, in the background,
// two at a time (TRANSCODE_CONCURRENCY), and the cache is kept under
// TRANSCODE_CACHE_GB (4), least recently used first.
//
// This side makes the conversions of the music folders' own files: since
// v0.8.40 (stage 3) with a ReplayGain, a zone's DSP and 32-bit output too, the
// name and ffmpeg's arguments as lib/stream.js writes them
// (Playback/StreamPlans.cs). Since v0.8.47 (stage 4.5) a track fetched from
// Qobuz or Tidal too: the service asked where its audio is first
// (Services/ServiceStreams.cs), then copied as it comes or converted like a
// file, Tidal's DASH pieces fed to ffmpeg one after another. While a
// conversion with DSP runs, playback has its second core (Cpu.cs).
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace Mandarin.Server;

using JsObj = Mandarin.Server.Tags.JsObj;
using Jv = Mandarin.Server.Playback.Jv;
using StreamPlans = Mandarin.Server.Playback.StreamPlans;

internal sealed record ConvTrack(long Id, string Path, long Mtime);
internal sealed record ConvPlan(long Rate, int Bits, bool Hq, bool Exact, string Reason)
{
    // A ReplayGain in dB (0: none), and a zone's DSP: the plan's part (lib/dsp.js planPart) and the file's own rate (v0.8.40).
    public double Gain { get; init; }
    public JsObj? Dsp { get; init; }
    public double InRate { get; init; }
    // A Qobuz or Tidal stream already what was planned: its FLAC frames copied as they come (v0.8.47).
    public bool Copy { get; init; }

    /* The plan as lib/stream.js has it, for its name and ffmpeg's arguments. */
    public JsObj ToJs()
    {
        var o = Jv.Obj(("transcode", true), ("rate", (double)Rate), ("bits", (double)Bits), ("reason", Reason));
        if (Copy) o["copy"] = true;
        if (Hq) o["hq"] = true;
        if (Exact) o["exact"] = true;
        if (Dsp != null) { o["dsp"] = Dsp; o["inRate"] = InRate; }
        if (Gain != 0) o["gain"] = Gain;
        return o;
    }

    /* A plan of lib/stream.js's (or Playback/StreamPlans.cs's) for a conversion. */
    public static ConvPlan Of(JsObj p) => new((long)Jv.Num(p["rate"]), (int)Jv.Num(p["bits"]), Jv.T(p["hq"]), Jv.T(p["exact"]), Jv.Str(Jv.Or(p["reason"], "")))
    {
        Gain = Jv.T(p["gain"]) ? Jv.Num(p["gain"]) : 0,
        Dsp = Jv.T(p["dsp"]) ? p["dsp"] as JsObj : null,
        InRate = Jv.T(p["inRate"]) ? Jv.Num(p["inRate"]) : 0
    };
}

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
    internal static readonly ConcurrentDictionary<string, ConvJob> Jobs = new();
    private static readonly List<(string Key, ConvTrack T, ConvPlan P)> Queue = [];
    private static int running;
    private static readonly Lazy<(string Bin, bool Ok, bool Soxr, bool Flac32)> Ff = new(Probe);
    // DSP conversions running here, and what the Node server last heard of them (told as the first
    // starts and the last ends, never twice the same: its own count, lib/cpu.js dsp(), is kept by both).
    private static int dspRunning;
    private static bool dspTold;
    private static readonly SemaphoreSlim DspTelling = new(1, 1);

    public static void Init(string dataDir)
    {
        dir = Path.Combine(dataDir, "transcode");
        Directory.CreateDirectory(dir);
        maxBytes = (long)((double.TryParse(Environment.GetEnvironmentVariable("TRANSCODE_CACHE_GB"), NumberStyles.Float, CultureInfo.InvariantCulture, out var gb) && gb > 0 ? gb : 4) * 1024 * 1024 * 1024);
        concurrency = Math.Max(1, int.TryParse(Environment.GetEnvironmentVariable("TRANSCODE_CONCURRENCY"), out var c) ? c : 2);
        // A .part left from a crash is never complete (none can be this run's yet).
        foreach (var f in Directory.EnumerateFiles(dir, "*.part")) { try { File.Delete(f); } catch (IOException) { /* gone */ } }
    }

    /* ffmpeg.js info: where ffmpeg is, whether it has libsoxr, and whether it writes 32-bit FLAC. */
    private static (string, bool, bool, bool) Probe()
    {
        var bin = Environment.GetEnvironmentVariable("FFMPEG_PATH") is { Length: > 0 } b ? b : "ffmpeg";
        bool ok, soxr;
        try
        {
            var psi = new ProcessStartInfo(bin) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            psi.ArgumentList.Add("-hide_banner"); psi.ArgumentList.Add("-buildconf");
            using var p = Process.Start(psi)!;
            var stdout = p.StandardOutput.ReadToEndAsync();
            _ = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(10000)) { try { p.Kill(); } catch { /* gone */ } return (bin, false, false, false); }
            ok = p.ExitCode == 0;
            soxr = stdout.Result.Contains("--enable-libsoxr", StringComparison.Ordinal);
        }
        catch (Exception) { return (bin, false, false, false); }
        return (bin, ok, soxr, ok && Writes32(bin));
    }

    /*
     * Can this ffmpeg write 32-bit FLAC? (6.1 quietly caps the encoder at 24.)
     * A fifth of a second of silence is encoded and its STREAMINFO read back,
     * as lib/ffmpeg.js asks it.
     */
    private static bool Writes32(string bin)
    {
        try
        {
            var psi = new ProcessStartInfo(bin) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            foreach (var a in new[] { "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "0.2",
                "-sample_fmt", "s32", "-bits_per_raw_sample", "32", "-c:a", "flac", "-f", "flac", "-" }) psi.ArgumentList.Add(a);
            using var p = Process.Start(psi)!;
            using var ms = new MemoryStream();
            var copy = p.StandardOutput.BaseStream.CopyToAsync(ms);
            _ = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(10000)) { try { p.Kill(); } catch { /* gone */ } return false; }
            copy.Wait(5000);
            var b = ms.ToArray();
            if (p.ExitCode != 0 || b.Length <= 42 || Encoding.ASCII.GetString(b, 0, 4) != "fLaC") return false;
            var si = b.AsSpan(8, 34);
            return (((si[12] & 1) << 4) | (si[13] >> 4)) + 1 == 32;
        }
        catch (Exception) { return false; }
    }

    public static bool Soxr => Ff.Value.Soxr;
    /* This ffmpeg writes 32-bit FLAC (ffmpeg.js info().flac32). */
    public static bool Flac32 => Ff.Value.Flac32;
    public static string Bin => Ff.Value.Bin;
    /* ffmpeg is there and runs (ffmpeg.js info().ok). */
    public static bool FfOk => Ff.Value.Ok;

    /* The cache as /api/health says it (lib/stream.js cacheStats): its FLAC files, their size, what is being made and what waits. */
    public static (int Files, double Bytes, int Running, int Queued) CacheStats()
    {
        try
        {
            var files = new DirectoryInfo(dir).GetFiles().Where(f => f.Name.EndsWith(".flac", StringComparison.Ordinal)).ToList();
            int queued;
            lock (Queue) queued = Queue.Count;
            return (files.Count, files.Sum(f => (double)f.Length), Jobs.Count, queued);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return (0, 0, 0, 0); }
    }

    /* The Transcoder's keyFor (lib/stream.js), as Playback/StreamPlans.cs writes it. */
    public static string KeyFor(ConvTrack t, ConvPlan p) => StreamPlans.KeyFor(Jv.Obj(("id", (double)t.Id), ("mtime", (double)t.Mtime)), p.ToJs());
    public static string FinalPath(string key) => Path.Combine(dir, key + ".flac");

    /* stream.js ffmpegArgs (Playback/StreamPlans.cs): the gain first, the DSP before the requantise. */
    public static List<string> Args(string src, ConvPlan p, string dest) => Args(src, p, dest, Ff.Value.Soxr);

    /* The same with soxr said (whether ffmpeg has libsoxr), as the tests ask it. */
    public static List<string> Args(string src, ConvPlan p, string dest, bool soxr) =>
        StreamPlans.FfmpegArgs(src, p.ToJs(), dest, soxr).Select(Jv.Str).ToList();

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
        var dspOn = false;
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
            if (dspOn) { dspOn = false; DspEnded(); }
            if (job.Failed) Server.Log($"[stream] transcode failed for {t.Path}: {err.ToString().Trim()[..Math.Min(300, err.ToString().Trim().Length)]}");
            Jobs.TryRemove(key, out _);
            job.Wake();
            job.Finished.TrySetResult();
            Prune();
        }
        void Begin(string src, ConvPlan plan, List<string>? pieces)
        {
            try
            {
                var psi = new ProcessStartInfo(Ff.Value.Bin) { UseShellExecute = false, RedirectStandardError = true, RedirectStandardInput = true };
                foreach (var a in Args(src, plan, job.Part)) psi.ArgumentList.Add(a);
                // On playback's cores (Cpu.cs): made ahead, not waited for, just below what a device is waiting for.
                var kind = background ? CpuKind.Ahead : CpuKind.Playback;
                Cpu.Place(psi, kind);
                var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
                proc.ErrorDataReceived += (_, e) => { if (e.Data != null && err.Length < 4000) lock (err) err.AppendLine(e.Data); };
                proc.Exited += (_, _) => { proc.WaitForExit(); Cpu.Forget(proc); Finish(proc.ExitCode); proc.Dispose(); };
                // DSP: playback has a second core while it runs, and for a while after (lib/cpu.js, the Node server's to decide).
                if (plan.Dsp != null) { dspOn = true; DspStarted(); }
                proc.Start();
                Cpu.Adopt(proc, kind);
                // Tidal's DASH: its pieces written in, one after another, as ffmpeg reads them.
                if (pieces != null) _ = Services.Catalogue.FeedDash(proc.StandardInput, pieces);
                else proc.StandardInput.Close();
                proc.BeginErrorReadLine();
                Server.Log($"[stream] {Path.GetFileName(t.Path)}: {plan.Reason} → FLAC {plan.Bits}/{(plan.Rate / 1000.0).ToString(CultureInfo.InvariantCulture)} kHz{(plan.Copy ? " (as it comes)" : "")}");
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
        }
        // A track whose audio has to be asked for first (Qobuz's, Tidal's): the
        // service says where it is, and whether it can be copied as it is.
        if (Services.Catalogue.IsStreamed(t.Path))
        {
            _ = Task.Run(async () =>
            {
                (string Src, ConvPlan Plan, List<string>? Pieces) from;
                try { from = await Services.Catalogue.Source(t, p); }
                catch (Exception e)
                {
                    err.Append(Services.Catalogue.Said(e));
                    Finish(-1);
                    return;
                }
                Begin(from.Src, from.Plan, from.Pieces);
            });
        }
        else Begin(t.Path, p, null);
        return job;
    }

    private static void DspStarted() { if (Interlocked.Increment(ref dspRunning) == 1) _ = TellDsp(); }
    private static void DspEnded() { if (Interlocked.Decrement(ref dspRunning) == 0) _ = TellDsp(); }

    /*
     * The split told whether a DSP conversion runs here (Cpu.cs), one word at a
     * time and only when that changes (on, then off).
     */
    private static async Task TellDsp()
    {
        await DspTelling.WaitAsync();
        try
        {
            var on = Volatile.Read(ref dspRunning) > 0;
            if (on == dspTold) return;
            dspTold = on;
            Cpu.Dsp(on);
        }
        finally { DspTelling.Release(); }
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
}
