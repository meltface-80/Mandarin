// MadeAsPlayed.cs — a track upsampled in a shape, or made DSD from PCM, as it plays (bug list item 259).
//
// Made whole and ahead (items 237, 243), a track's first play was always the standard filter's PCM, and DSD only the
// next time. Now each is `mandarin-server upsample` (UpsampleCommand.cs) begun when the device asks for the track,
// writing its file a block at a time, and the device is sent it as it grows (Transcoder.TailFollow), as a conversion
// is: a DSF's header first, its length known from the track's. One is made at a time, on every core (the most the
// modulators can be given): the next track asked for while one is made waits its turn. A new play stops what was being
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
        var spec = p.DsdUp != 0 ? DsdPlan.Job(t.Path, p, job.Part, Transcoder.Soxr, seconds) : PcmJob(t.Path, p, job.Part);
        var psi = new ProcessStartInfo(Environment.ProcessPath ?? "mandarin-server") { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        psi.ArgumentList.Add("upsample");
        using var proc = Process.Start(psi)!;
        Under[job.Key] = proc;
        if (Stopped.TryRemove(job.Key, out _)) Stop(proc);
        try { await proc.StandardInput.WriteLineAsync(spec.ToJsonString()); proc.StandardInput.Close(); }
        catch (IOException) { /* stopped before it read its job; its exit says so */ }
        var said = await proc.StandardOutput.ReadToEndAsync();
        var trace = await proc.StandardError.ReadToEndAsync();
        await proc.WaitForExitAsync();
        var r = said.Trim().Split('\n')[^1] is { Length: > 0 } last ? JsonNode.Parse(last) as JsonObject : null;
        if (proc.ExitCode != 0 || r == null || r["error"] != null)
        {
            err.Append((string?)r?["error"] ?? (trace.Trim() is { Length: > 0 } tr ? tr[..Math.Min(300, tr.Length)] : "stopped"));
            return proc.ExitCode == 0 ? 1 : proc.ExitCode;
        }
        var took = (double?)r["seconds"] ?? 0;
        var speed = took > 0 && seconds > 0 ? seconds / took : 0;
        if (speed > 0) Speeds[p.DsdUp] = speed;
        var held = (long?)r["held"] ?? 0;
        var what = p.DsdUp != 0 ? $"DSD{p.DsdUp} from PCM, {Shape.Words(p.Shape)} ({(long?)r["resets"] ?? 0} reset(s){(held > 0 ? $", {held} sample(s) over +2.9 dB held" : "")})" : $"×{p.Rate / Math.Max(1, (long)p.InRate)}, {Shape.Words(p.Shape)}";
        Server.Log($"[upsample] {Path.GetFileName(t.Path)}: {what}, made as it played at {Math.Round(speed, 2).ToString(System.Globalization.CultureInfo.InvariantCulture)}× real time ({took} s)");
        return 0;
    }

    /* What was being made, or waited to be, for a play other than the one of [keep] (their keys): stopped (item 246). */
    public static void Only(IEnumerable<string> keep)
    {
        var k = keep.ToHashSet();
        if (k.Count == 0) return;
        var n = 0;
        foreach (var (key, proc) in Under)
        {
            if (k.Contains(key)) continue;
            Stopped[key] = true;
            if (proc != null) Stop(proc);
            n++;
        }
        if (n > 0) Server.Log($"[upsample] {n} track(s) no longer made: another play");
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
        try { proc.Kill(true); } catch (InvalidOperationException) { /* ended already */ }
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
     * The job for [src] by [p] into [dest]: ffmpeg decoding it to 64-bit float stereo at its own rate (the gain on it,
     * and a room or headphone correction at that rate), and ffmpeg making the file from 64-bit float at the plan's rate
     * (the DSP and the requantise, as a conversion's).
     */
    public static JsonObject PcmJob(string src, ConvPlan p, string dest)
    {
        var inRate = (long)p.InRate;
        if (inRate <= 0 || p.Rate % inRate != 0) throw new InvalidOperationException($"no rate of the track's own to upsample from ({p.InRate} Hz to {p.Rate} Hz)");
        var decode = new JsonArray("-hide_banner", "-nostdin", "-loglevel", "error", "-i", src, "-map", "0:a:0", "-vn");
        var conv = p.Dsp != null ? Playback.Convolution.For(Jv.Get(p.Dsp, "dsp"), inRate) : null;   // the one at its rate (item 258)
        var pre = p.Gain != 0 ? $"volume=volume={Jv.Str(p.Gain)}dB:precision=double" : conv != null ? "anull" : null;
        if (pre != null) { decode.Add("-af"); decode.Add(conv != null ? Playback.Convolution.Graph(pre, conv, inRate, Transcoder.Soxr) : pre); }
        foreach (var a in new[] { "-ac", "2", "-ar", inRate.ToString(System.Globalization.CultureInfo.InvariantCulture), "-f", "f64le", "-c:a", "pcm_f64le", "pipe:1" }) decode.Add(a);
        // The conversion's own arguments, from 64-bit float at the plan's rate on standard input (nothing to resample,
        // no gain twice, the correction already on it), the source's tags beside it.
        var convArgs = Transcoder.Args(src, p with { Gain = 0, Shape = null, InRate = p.Rate }, dest, Transcoder.Soxr, convolve: false);
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
        return new JsonObject
        {
            ["ffmpeg"] = Transcoder.Bin, ["decode"] = decode, ["encode"] = encode,
            ["rate"] = inRate, ["factor"] = p.Rate / Math.Max(1, inRate), ["shape"] = p.Shape,
        };
    }
}
