// MadeAsPlayed.cs — a track upsampled in a shape, or made DSD from PCM, as it plays (bug list item 259).
//
// Made whole and ahead (items 237, 243), a track's first play was always the standard filter's PCM, and DSD only the
// next time. Now each is `mandarin-server upsample` (UpsampleCommand.cs) begun when the device asks for the track,
// writing its file a block at a time, and the device is sent it as it grows (Transcoder.TailFollow), as a conversion
// is: a DSF's header first, its length known from the track's. One is made at a time, on playback's cores, all but two
// of them while it runs (Cpu.Making.cs, item 260): the next track asked for while one is made waits its turn. A new play stops what was being
// made for the play before (Only). Each making's speed is kept, and Output says it: a DSF made slower than it plays
// would run dry.
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using Mandarin.Server.Tags;
using Jv = Mandarin.Server.Playback.Jv;

namespace Mandarin.Server.Upsample;

internal static class MadeAsPlayed
{
    private static readonly SemaphoreSlim One = new(1, 1);
    private static readonly ConcurrentDictionary<string, Process?> Under = new();   // waiting (null) or being made
    private static readonly ConcurrentDictionary<string, bool> Stopped = new();
    // Why each was stopped on purpose (another play, skipped from…: items 246, 264), for its log (item 332).
    private static readonly ConcurrentDictionary<string, string> Why = new();
    private const string StoppedSaid = "no longer made: ";

    /* What a making's error [err] says where it was stopped on purpose ("no longer made: another play"); null where it failed. */
    public static string? StoppedOnPurpose(string err) => err.StartsWith(StoppedSaid, StringComparison.Ordinal) ? err : null;
    private static readonly ConcurrentDictionary<int, double> Speeds = new();      // DSD's multiple (0: PCM) → × real time
    // A pause between a making's turn and its start: the tests' own, to hold that moment open (items 246, 259).
    private static readonly int Wait = int.TryParse(Environment.GetEnvironmentVariable("MANDARIN_MAKE_WAIT_MS"), out var w) && w > 0 ? w : 0;

    /* Whether track [key]'s making has begun (its file being written, a DSF's header first), not only waiting its turn. */
    public static bool Begun(string key) => Under.TryGetValue(key, out var p) && p != null;

    /* Whether [p] is made so: a DSF from PCM, or PCM upsampled in a shape or with Mandarin's own dither; else ffmpeg makes it. */
    public static bool Takes(ConvPlan p) => p.DsdUp != 0 || p.Shape != null || p.Dither != null || p.RealBits > 0;

    /* Whether [factor] is one the filter takes: 2, 4, 8 or 16. */
    public static bool Power(long factor) => factor is 2 or 4 or 8 or 16;

    /*
     * [plan], made for [target] for the track at [path], given the device's filter where that isn't the standard one
     * (minimum phase, gentle) and it is upsampled by a power of two from a file of the library; a stream of Qobuz's or
     * Tidal's comes as it comes, with the standard filter.
     */
    public static JsObj Mark(JsObj plan, object? target, string path)
    {
        if (target == null || !Jv.T(plan["upsampled"])) return plan;
        if (Playback.StreamPlans.ServiceOf(path) != null) return plan;
        var factor = (long)Jv.Num(plan["upsampled"]);
        if (!Power(factor)) return plan;
        // The device's filter for the track's own rate (item 298): its filter for hi-res sources above 48 kHz, where set.
        var shape = Shape.ForTrack(target, Jv.Num(plan["rate"]) / factor);
        // Its dither (item 301): shaped where the rate leaves room for it, and the DAC's real bits where under the word's.
        var dither = Dither.At(Dither.Of(Jv.Get(target, "dither")), (long)Jv.Num(plan["rate"]));
        var real = Dither.BitsOf(Jv.Get(target, "real_bits")) is var rb && rb < (int)Jv.Num(plan["bits"]) ? rb : 0;
        if (shape == null && dither == null && real == 0) return plan;
        if (shape != null) plan["shape"] = shape;
        if (dither != null) plan["dither"] = dither;
        if (real > 0) plan["real_bits"] = (double)real;
        // The track's own rate, which the job divides by: a plan made for a queue (Playback/Items.cs) carries none of its own.
        plan["inRate"] = Jv.Num(plan["rate"]) / factor;
        if (shape != null) plan["reason"] = Jv.Str(plan["reason"]) + $" ({Shape.Words(shape)})";
        return plan;
    }

    /*
     * [job]'s file for track [t] by [p] begun: once those before it are made, `mandarin-server upsample` writes it to
     * [job].Part; [finish] is given its exit code, [err] what it said went wrong.
     */
    public static void Start(ConvTrack t, ConvPlan p, ConvJob job, Action<int> finish, StringBuilder err) => Begin(job, finish, err, () => Run(t, p, job, err));

    /* [run]'s file by [p] begun (AlbumRun.cs, item 300), as a track's is: the album's tracks made as one, into [job].Part. */
    public static void StartRun(AlbumRun run, ConvPlan p, ConvJob job, Action<int> finish, StringBuilder err) => Begin(job, finish, err, () => RunAlbum(run, p, job, err));

    // [make] given its turn, one making at a time; [finish] told how it ended.
    private static void Begin(ConvJob job, Action<int> finish, StringBuilder err, Func<Task<int>> make)
    {
        Under[job.Key] = null;
        _ = Task.Run(async () =>
        {
            var code = -1;
            await One.WaitAsync();
            try
            {
                if (Wait > 0) await Task.Delay(Wait);
                if (Stopped.TryRemove(job.Key, out _)) { err.Append(StoppedSaid + (Why.TryRemove(job.Key, out var w) ? w : "another play")); return; }
                code = await make();
            }
            catch (Exception e) { err.Append(e.Message); }
            finally
            {
                Under.TryRemove(job.Key, out _);
                Stopped.TryRemove(job.Key, out _);
                // Stopped part made, on purpose: said so, not as a failure (item 332).
                if (Why.TryRemove(job.Key, out var why) && code != 0 && StoppedOnPurpose(err.ToString()) == null) { err.Clear(); err.Append(StoppedSaid + why); }
                One.Release();
                finish(code);
            }
        });
    }

    private static async Task<int> Run(ConvTrack t, ConvPlan p, ConvJob job, StringBuilder err)
    {
        var seconds = Seconds(t.Id);
        // Joined to its album's tracks either side (item 262): a DSF's at its blocks, PCM's at any frame.
        JsonObject spec;
        string? next = null;
        if (p.DsdUp != 0)
        {
            var join = DsdPlan.BlockFrames(p) is > 0 and var b ? Joins.For(t.Id, (long)p.InRate, b) : null;
            spec = DsdPlan.Job(t.Path, p, job.Part, Transcoder.Soxr, seconds, join);
            // Made on into the start of the next track, and kept for its making: the modulators run on into it.
            if (join?.After != null) { spec["continue"] = true; next = Transcoder.KeyFor(new ConvTrack(join.AfterId, join.After, join.AfterMtime), p); }
            job.Resume = Resume.ForDsf(job, p, t.Id, seconds, join?.Before != null ? join.Carry : 0);
        }
        else
        {
            spec = PcmJob(t.Path, p, job.Part, Joins.For(t.Id, (long)p.InRate, 0), seconds);
            if (spec["wav"] != null) job.Resume = Resume.ForWav(job, p, seconds);
        }
        // Begun again where a device seeks to past what is made (item 272).
        if (job.Resume != null) job.Resume.Track = Path.GetFileName(t.Path);
        // Playback, the most of it there is (item 260): its cores kept, all but two while it runs (item 267), and it put on them.
        Cpu.Making(true);
        // Held as Roon holds its DSP, some way ahead of the device, where its length is known (item 271: Pace.cs).
        var bytes = p.DsdUp != 0 ? DsdPlan.FileBytes(t.Id, p, seconds) : p.Wav ? WavHeader.FileBytes(p, seconds) : 0;
        try { return await Made(t, p, job, err, seconds, spec, next, bytes); }
        finally { Cpu.Making(false); }
    }

    // An album's run (item 300): its tracks read one after the other, made as one track is, its list gone after.
    private static async Task<int> RunAlbum(AlbumRun run, ConvPlan p, ConvJob job, StringBuilder err)
    {
        var list = run.List(job.Final);
        Cpu.Making(true);
        try { return await Made(run.Tracks[0], p, job, err, run.Total, run.Job(p, job.Part, list), null, run.Bytes(p), $", an album's {run.Tracks.Count} track(s) as one"); }
        finally
        {
            Cpu.Making(false);
            try { File.Delete(list); } catch (IOException) { /* gone */ }
        }
    }

    private static async Task<int> Made(ConvTrack t, ConvPlan p, ConvJob job, StringBuilder err, double seconds, JsonObject spec, string? next, long bytes, string run = "")
    {
        // The making that went on into this track's start, where there is one waiting for it; else one of its own.
        var warm = Warm.Take(job.Key);
        var (proc, trace) = warm ?? Spawn();
        var resume = job.Resume;
        var whole = spec;   // each restart's from the track's own job
        string? said;
        double heldFor = 0;
        while (true)
        {
            Under[job.Key] = proc;
            resume?.Writing(proc);
            if (Stopped.TryRemove(job.Key, out _)) Stop(proc);
            try
            {
                await proc.StandardInput.WriteLineAsync(spec.ToJsonString());
                await proc.StandardInput.FlushAsync();
                if (next == null) proc.StandardInput.Close();
            }
            catch (IOException) { /* stopped before it read its job; its exit says so */ }
            using (var hold = Pace.Hold(proc, job, bytes, seconds)) { said = await Said(proc, job.Key); heldFor += hold.HeldSeconds; }
            // A device sought past what was made: begun again from there (item 272: Resume.cs).
            if (resume == null || !resume.Again(out var at)) break;
            Stop(proc);
            await proc.WaitForExitAsync();
            Cpu.Forget(proc);
            await trace;
            proc.Dispose();
            spec = resume.From(whole, at);
            (proc, trace) = Spawn();
        }
        KeepingUp.Finished(job.Key, 0);   // made, or stopped: no longer going (item 346)
        var r = said is { Length: > 0 } ? JsonNode.Parse(said) as JsonObject : null;
        if (r == null || r["error"] != null || next == null || proc.HasExited)
        {
            if (next != null) proc.StandardInput.Close();
            await proc.WaitForExitAsync();
            Cpu.Forget(proc);
            var code = proc.ExitCode;
            var tr = (await trace).Trim();
            proc.Dispose();
            if (code != 0 || r == null || r["error"] != null)
            {
                err.Append((string?)r?["error"] ?? (tr.Length > 0 ? tr[..Math.Min(300, tr.Length)] : "stopped"));
                return code == 0 ? 1 : code;
            }
        }
        else Warm.Keep(proc, next, trace);
        var took = (double?)r["seconds"] ?? 0;
        // Its speed by the time it worked, not the time it was held.
        var speed = took - heldFor > 0 && seconds > 0 ? seconds / (took - heldFor) : 0;
        if (speed > 0 && resume?.Restarted != true) { Speeds[p.DsdUp] = speed; KeepingUp.Finished(job.Key, speed); }
        // What it clipped, and its peak kept as the track's own for Headroom when upsampling (item 348).
        var clipped = (long?)r["clipped"] ?? 0;
        Headroom.Finished(job.Key, clipped, (double?)r["peak"] ?? 0);
        if (resume?.Restarted != true && warm == null) Headroom.Measured(t.Id, p, (double?)r["peak"] ?? 0);   // a run's peak is its whole run's
        var held = (long?)r["held"] ?? 0;
        var what = p.DsdUp != 0 ? $"DSD{p.DsdUp} from PCM, {Shape.Words(p.Shape)} ({(long?)r["resets"] ?? 0} reset(s){(held > 0 ? $", {held} sample(s) over +2.9 dB held" : "")})" : $"×{p.Rate / Math.Max(1, (long)p.InRate)}, {Shape.Words(p.Shape)}";
        Server.Log($"[upsample] {Path.GetFileName(t.Path)}: {what}, made as it played at {Math.Round(speed, 2).ToString(System.Globalization.CultureInfo.InvariantCulture)}× real time ({took} s{(heldFor >= 1 ? $", {Math.Round(heldFor)} s of it held ahead of the device" : "")}){(warm != null ? ", on from the track before" : "")}{(clipped > 0 ? $", {clipped} sample(s) clipped" : "")}{run}");
        return 0;
    }

    /* What the making says it did, its line of JSON; what it says as it goes (what it has clipped: item 348) kept for [key] meanwhile. */
    private static async Task<string?> Said(Process proc, string key)
    {
        while (true)
        {
            var line = await proc.StandardOutput.ReadLineAsync();
            if (line == null || !line.StartsWith("{\"progress\"", StringComparison.Ordinal)) return line;
            if (JsonNode.Parse(line) is JsonObject o) Headroom.Saw(key, (long?)o["clipped"] ?? 0, (double?)o["peak"] ?? 0);
        }
    }

    // `mandarin-server upsample`, on playback's cores; what it says wrong read beside it.
    private static (Process, Task<string>) Spawn()
    {
        var psi = new ProcessStartInfo(Environment.ProcessPath ?? "mandarin-server") { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        psi.ArgumentList.Add("upsample");
        Cpu.Place(psi, CpuKind.Playback);
        var proc = Process.Start(psi)!;
        Cpu.Adopt(proc, CpuKind.Playback);
        return (proc, proc.StandardError.ReadToEndAsync());
    }

    /* An album run's key ("a<tracks>-<its first track's key>", AlbumRun.KeyFor): its first track's key; null for a track's own. */
    private static string? RunOf(string key) => key.StartsWith('a') && key.IndexOf('-') is var d and > 0 ? key[(d + 1)..] : null;

    /* What was being made, or waited to be, for a play other than the one of [keep] (their keys): stopped (item 246); [why] said. */
    public static void Only(IEnumerable<string> keep, string why = "another play")
    {
        var k = keep.ToHashSet();
        if (k.Count == 0) return;
        Warm.Unless(k);
        var n = 0;
        foreach (var (key, proc) in Under)
        {
            if (k.Contains(key) || RunOf(key) is { } first && k.Contains(first)) continue;   // an album's run, kept by its first track (item 337)
            Stopped[key] = true;
            Why[key] = why;
            if (proc != null) Stop(proc);
            n++;
        }
        if (n > 0) Server.Log($"[upsample] {n} track(s) no longer made: {why}");
    }

    /* The last making's speed at DSD[n] (0: PCM in a shape), × real time; null before the first. */
    public static double? Speed(int n) => Speeds.TryGetValue(n, out var s) ? s : null;

    /* Output's words on making DSD[n] (0: PCM in a shape) as it plays: how fast the last was, and whether that keeps up. */
    public static string Note(int n)
    {
        var what = n != 0 ? $"DSD{n}" : "it";
        if (Speed(n) is not { } s) return $"Made as it plays. How fast this server makes {what} shows here after its first track.";
        var x = Math.Round(s, 1).ToString(System.Globalization.CultureInfo.InvariantCulture);
        if (s >= 1.15) return $"Made as it plays: this server made the last at {x}× real time, fast enough to keep up.";
        return $"Made as it plays: this server made the last at {x}× real time, too slow to keep up{(n > 64 ? $"; DSD{n / 2} is half the work" : "")}.";
    }

    private static void Stop(Process proc)
    {
        try { Pace.Release(proc.Id); proc.Kill(true); } catch (InvalidOperationException) { /* ended already */ }
    }

    // Track [id]'s length in seconds, as the library has it.
    private static double Seconds(long id)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT duration FROM tracks WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        return cmd.ExecuteScalar() is { } v and not DBNull ? Convert.ToDouble(v, System.Globalization.CultureInfo.InvariantCulture) : 0;
    }

    /*
     * The job for [src] by [p] into [dest]: ffmpeg decoding it to 64-bit float stereo at its own rate, levelled, the
     * headroom taken off and the DSP run on it there (a room or headphone correction and the bands: item 263, before
     * the upsampling, which had the bands after it), and ffmpeg making the file from 64-bit float at the plan's rate
     * (the requantise alone, as a conversion's). A WAV ([p] above FLAC's rates) is written by the making, behind a header
     * of its length, [seconds] long at its rate as the track is held to (item 270: WavHeader.cs); ffmpeg makes its samples.
     */
    public static JsonObject PcmJob(string src, ConvPlan p, string dest, Joins.Join? join = null, double seconds = 0)
    {
        var inRate = (long)p.InRate;
        if (inRate <= 0 || p.Rate % inRate != 0) throw new InvalidOperationException($"no rate of the track's own to upsample from ({p.InRate} Hz to {p.Rate} Hz)");
        var decode = new JsonArray("-hide_banner", "-nostdin", "-loglevel", "error", "-i", src, "-map", "0:a:0", "-vn");
        var conv = p.Dsp != null ? Playback.Convolution.For(Jv.Get(p.Dsp, "dsp"), inRate) : null;   // the one at its rate (item 258)
        if (DsdPlan.Before(p, inRate, null, Transcoder.Soxr) is { } pre) { decode.Add("-af"); decode.Add(conv != null ? Playback.Convolution.Graph(pre, conv, inRate, Transcoder.Soxr) : pre); }
        foreach (var a in new[] { "-ac", "2", "-ar", inRate.ToString(System.Globalization.CultureInfo.InvariantCulture), "-f", "f64le", "-c:a", "pcm_f64le", "pipe:1" }) decode.Add(a);
        // The conversion's own arguments, from 64-bit float at the plan's rate on standard input (nothing to resample,
        // no gain or DSP twice), the source's tags beside it.
        var own = p.Dither != null || p.RealBits > 0;   // Mandarin's own dither (item 301): ffmpeg's none, its samples as they come
        var convArgs = Transcoder.Args(src, p with { Gain = 0, Shape = null, InRate = p.Rate, Dsp = null, Exact = p.Exact || own }, dest, Transcoder.Soxr, convolve: false);
        var rate = p.Rate.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var encode = new JsonArray();
        for (var i = 0; i < convArgs.Count; i++)
        {
            if (convArgs[i] == "-i" && i + 1 < convArgs.Count && convArgs[i + 1] == src)
            {
                foreach (var a in new[] { "-f", own ? "s32le" : "f64le", "-ar", rate, "-ac", "2", "-i", "pipe:0", "-i", src }) encode.Add(a);
                i++;
            }
            else if (convArgs[i] == "-map_metadata" && i + 1 < convArgs.Count) { encode.Add("-map_metadata"); encode.Add("1"); i++; }
            else encode.Add(convArgs[i]);
        }
        var o = new JsonObject
        {
            ["ffmpeg"] = Transcoder.Bin, ["decode"] = decode, ["encode"] = encode,
            ["rate"] = inRate, ["factor"] = p.Rate / Math.Max(1, inRate), ["shape"] = p.Shape,
        };
        if (own) o["dither"] = new JsonObject { ["shape"] = p.Dither, ["real"] = p.RealBits, ["bits"] = p.Bits, ["rate"] = p.Rate };
        if (p.Wav && seconds > 0 && encode.Count > 5 && (string?)encode[^5] == "-f" && (string?)encode[^4] == "wav")
        {
            // ffmpeg's -f wav -seekable 0 <file> (HighRates.Args) made its bare samples on its standard output.
            for (var k = 0; k < 5; k++) encode.RemoveAt(encode.Count - 1);
            foreach (var a in new[] { "-f", p.Bits == 16 ? "s16le" : p.Bits == 32 ? "s32le" : "s24le", "pipe:1" }) encode.Add(a);
            o["wav"] = new JsonObject { ["out"] = dest, ["rate"] = p.Rate, ["bits"] = p.Bits };
            o["frames"] = Joins.Frames(seconds, inRate);
        }
        // Joined to its neighbours (item 262), but not through a room correction, whose own filter isn't carried across.
        if (conv == null) Joins.Into(o, join, decode, src, inRate);
        return o;
    }
}
