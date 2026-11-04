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
    private static readonly ConcurrentDictionary<int, double> Speeds = new();      // DSD's multiple (0: PCM) → × real time
    // A pause between a making's turn and its start: the tests' own, to hold that moment open (items 246, 259).
    private static readonly int Wait = int.TryParse(Environment.GetEnvironmentVariable("MANDARIN_MAKE_WAIT_MS"), out var w) && w > 0 ? w : 0;

    /* Whether track [key]'s making has begun (its file being written, a DSF's header first), not only waiting its turn. */
    public static bool Begun(string key) => Under.TryGetValue(key, out var p) && p != null;

    /* Whether [p] is made so: a DSF from PCM, or PCM upsampled in a shape; else ffmpeg makes it. */
    public static bool Takes(ConvPlan p) => p.DsdUp != 0 || p.Shape != null;

    /* Whether [factor] is one the filter takes: 2, 4, 8 or 16. */
    public static bool Power(long factor) => factor is 2 or 4 or 8 or 16;

    /*
     * [plan], made for [target] for the track at [path], given the device's filter where that isn't the standard one
     * (minimum phase, gentle) and it is upsampled by a power of two from a file of the library; a stream of Qobuz's or
     * Tidal's comes as it comes, with the standard filter.
     */
    public static JsObj Mark(JsObj plan, object? target, string path)
    {
        if (target == null || Shape.OfFilter(Jv.Get(target, "filter")) is not { } shape || !Jv.T(plan["upsampled"])) return plan;
        if (Playback.StreamPlans.ServiceOf(path) != null) return plan;
        var factor = (long)Jv.Num(plan["upsampled"]);
        if (!Power(factor)) return plan;
        plan["shape"] = shape;
        // The track's own rate, which the job divides by: a plan made for a queue (Playback/Items.cs) carries none of its own.
        plan["inRate"] = Jv.Num(plan["rate"]) / factor;
        plan["reason"] = Jv.Str(plan["reason"]) + $" ({Shape.Words(shape)})";
        return plan;
    }

    /*
     * [job]'s file for track [t] by [p] begun: once those before it are made, `mandarin-server upsample` writes it to
     * [job].Part; [finish] is given its exit code, [err] what it said went wrong.
     */
    public static void Start(ConvTrack t, ConvPlan p, ConvJob job, Action<int> finish, StringBuilder err)
    {
        Under[job.Key] = null;
        _ = Task.Run(async () =>
        {
            var code = -1;
            await One.WaitAsync();
            try
            {
                if (Wait > 0) await Task.Delay(Wait);
                if (Stopped.TryRemove(job.Key, out _)) { err.Append("another play"); return; }
                code = await Run(t, p, job, err);
            }
            catch (Exception e) { err.Append(e.Message); }
            finally
            {
                Under.TryRemove(job.Key, out _);
                Stopped.TryRemove(job.Key, out _);
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
        try { return await Made(t, p, job, err, seconds, spec, next); }
        finally { Cpu.Making(false); }
    }

    private static async Task<int> Made(ConvTrack t, ConvPlan p, ConvJob job, StringBuilder err, double seconds, JsonObject spec, string? next)
    {
        // The making that went on into this track's start, where there is one waiting for it; else one of its own.
        var warm = Warm.Take(job.Key);
        var (proc, trace) = warm ?? Spawn();
        var resume = job.Resume;
        var whole = spec;   // each restart's from the track's own job
        // Held as Roon holds its DSP, some way ahead of the device, where its length is known (item 271: Pace.cs).
        var bytes = p.DsdUp != 0 ? DsdPlan.FileBytes(t.Id, p, seconds) : p.Wav ? WavHeader.FileBytes(p, seconds) : 0;
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
            using (var hold = Pace.Hold(proc, job, bytes, seconds)) { said = await proc.StandardOutput.ReadLineAsync(); heldFor += hold.HeldSeconds; }
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
        if (speed > 0 && resume?.Restarted != true) Speeds[p.DsdUp] = speed;
        var held = (long?)r["held"] ?? 0;
        var what = p.DsdUp != 0 ? $"DSD{p.DsdUp} from PCM, {Shape.Words(p.Shape)} ({(long?)r["resets"] ?? 0} reset(s){(held > 0 ? $", {held} sample(s) over +2.9 dB held" : "")})" : $"×{p.Rate / Math.Max(1, (long)p.InRate)}, {Shape.Words(p.Shape)}";
        Server.Log($"[upsample] {Path.GetFileName(t.Path)}: {what}, made as it played at {Math.Round(speed, 2).ToString(System.Globalization.CultureInfo.InvariantCulture)}× real time ({took} s{(heldFor >= 1 ? $", {Math.Round(heldFor)} s of it held ahead of the device" : "")}){(warm != null ? ", on from the track before" : "")}");
        return 0;
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

    /* What was being made, or waited to be, for a play other than the one of [keep] (their keys): stopped (item 246); [why] said. */
    public static void Only(IEnumerable<string> keep, string why = "another play")
    {
        var k = keep.ToHashSet();
        if (k.Count == 0) return;
        Warm.Unless(k);
        var n = 0;
        foreach (var (key, proc) in Under)
        {
            if (k.Contains(key)) continue;
            Stopped[key] = true;
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
        var convArgs = Transcoder.Args(src, p with { Gain = 0, Shape = null, InRate = p.Rate, Dsp = null }, dest, Transcoder.Soxr, convolve: false);
        var rate = p.Rate.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var encode = new JsonArray();
        for (var i = 0; i < convArgs.Count; i++)
        {
            if (convArgs[i] == "-i" && i + 1 < convArgs.Count && convArgs[i + 1] == src)
            {
                foreach (var a in new[] { "-f", "f64le", "-ar", rate, "-ac", "2", "-i", "pipe:0", "-i", src }) encode.Add(a);
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
