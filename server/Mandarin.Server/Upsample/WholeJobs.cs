// WholeJobs.cs — tracks upsampled whole, made in the background (bug list item 237), one at a time.
//
// A whole-track upsample has nothing to give until the whole track has been through it (some 30 seconds for six
// minutes at ×16 on a four-core machine), so it can't be sent as it is made, as a conversion is. A track asked for
// before it is ready plays with the standard filter (SoX, as before) while it is made; the tracks after it in the
// queue are made ahead (Prefetch). Each is `mandarin-server upsample` (UpsampleCommand.cs), in a process of its own on
// the cores playback doesn't keep (Cpu.cs), its file written beside the other conversions and kept and pruned with
// them under the same name a conversion would have, -w added.
using System.Diagnostics;
using System.Text.Json.Nodes;
using Jv = Mandarin.Server.Playback.Jv;

namespace Mandarin.Server.Upsample;

internal static partial class WholeJobs
{
    // A whole track's file, in any shape: "-w", "-w-min", "-w-gentle", then ".flac" or "-wav.wav".
    [System.Text.RegularExpressions.GeneratedRegex(@"-w(-min|-gentle)?(\.flac|-wav\.wav)$")]
    private static partial System.Text.RegularExpressions.Regex MadeFile();

    private static readonly List<(string Key, ConvTrack T, ConvPlan P)> Queue = [];
    private static readonly HashSet<string> Making = [];
    private static readonly HashSet<long> Failed = [];
    private static string? makingName;
    private static bool running;
    // The making under way; those dropped by another play (Only), until when: not made again before then; and those
    // stopped under way to be made later (Skip), whose run ends without a file.
    private static (string Key, Process Proc)? current;
    private static readonly Dictionary<string, DateTime> Skipped = [];
    private static readonly HashSet<string> Halted = [];
    // A pause between a making taken from the queue and its start: the tests' own, to hold that moment open (246).
    private static readonly int Wait = int.TryParse(Environment.GetEnvironmentVariable("MANDARIN_MAKE_WAIT_MS"), out var w) && w > 0 ? w : 0;

    /*
     * The plan to send now for [p]: itself where it isn't whole, or its file is made and this play didn't start on
     * the standard filter's (WholeServed.cs: one play, one file); else the standard filter's, the whole one queued
     * to be made for next time. What went out is kept, for Now playing.
     */
    public static ConvPlan Choose(ConvTrack t, ConvPlan p)
    {
        if (!p.Whole) return p;
        var key = Transcoder.KeyFor(t, p);
        var now = DateTime.UtcNow;
        var whole = File.Exists(Transcoder.FinalPath(key)) && !WholeServed.HeldStandard(key, now);
        if (!whole && !File.Exists(Transcoder.FinalPath(key))) Enqueue(t, p);
        WholeServed.Record(key, t.Id, p.Rate, whole, now);
        return whole ? p : p with { Whole = false };
    }

    /* Track [id]'s making: "making", "queued", "failed" (the last try), or null (made, or never asked). */
    public static string? State(long id)
    {
        lock (Queue)
        {
            if (Making.Count > 0 && Making.Any(k => k.StartsWith(id + "-", StringComparison.Ordinal))) return "making";
            if (Queue.Exists(q => q.T.Id == id)) return "queued";
            return Failed.Contains(id) ? "failed" : null;
        }
    }

    /* How the making goes, for a device's Output: the tracks made and kept, the one being made, and those waiting. */
    public static (int Made, string? Making, int Waiting) Status()
    {
        var dir = Path.GetDirectoryName(Transcoder.FinalPath("x"))!;
        // Whole tracks in any shape (item 248: "-w-min", "-w-gentle"), as FLAC or WAV, and DSFs made from PCM.
        var made = !Directory.Exists(dir) ? 0 : Directory.EnumerateFiles(dir).Count(f => MadeFile().IsMatch(f) || f.EndsWith(".dsf", StringComparison.Ordinal));
        lock (Queue) return (made, makingName, Queue.Count);
    }

    /* Whole plans of [items] queued to be made ahead; the others as conversions are (Transcoder.Prefetch). */
    public static void Prefetch(IEnumerable<(ConvTrack T, ConvPlan P)> items)
    {
        var rest = new List<(ConvTrack, ConvPlan)>();
        foreach (var (t, p) in items)
        {
            if (p.Whole || p.DsdUp != 0) Enqueue(t, p);   // made DSD from PCM too (DsdPlan.cs, item 243)
            else rest.Add((t, p));
        }
        if (rest.Count > 0) Transcoder.Prefetch(rest);
    }

    /*
     * Track [t]'s making by [p] put after the tracks still to come, waiting, about to start or under way (one sent as
     * PCM this time, item 243): they are made first, then it, for its next play (item 254; dropped for ten minutes
     * before, Now playing's "next play" was never so). One under way is stopped and begun again in its turn. A play
     * queues its tracks to be made before it starts the first (Items.PlayTracks), so the first's may be on its way (246).
     */
    public static void Skip(ConvTrack t, ConvPlan p)
    {
        var key = Transcoder.KeyFor(t, p);
        lock (Queue)
        {
            var waiting = Queue.RemoveAll(q => q.Key == key) > 0;
            var under = Making.Contains(key);
            if (!waiting && !under) return;   // made already, or never asked for
            if (under)
            {
                Halted.Add(key);
                if (current is { } c && c.Key == key) Stop(c.Proc);
            }
            Queue.Add((key, t, p));
        }
    }

    /*
     * A new play, of [items] (item 246): the makings of what was playing before and isn't now are dropped, waiting or
     * under way; an album played after another had the other's tracks made first, minutes each at DSD256.
     */
    public static void Only(IEnumerable<(ConvTrack T, ConvPlan P)> items)
    {
        var keep = items.Where(x => x.P.Whole || x.P.DsdUp != 0).Select(x => Transcoder.KeyFor(x.T, x.P)).ToHashSet();
        if (keep.Count == 0) return;   // a play of nothing made ahead (a phone's, a room's) leaves a streamer's alone
        lock (Queue)
        {
            var dropped = Queue.RemoveAll(q => !keep.Contains(q.Key));
            // Taken from the queue, starting or under way: stopped; long enough to end, then free to be made again.
            foreach (var k in Making.Where(k => !keep.Contains(k))) { Skipped[k] = DateTime.UtcNow + TimeSpan.FromSeconds(30); dropped++; }
            if (current is { } c && !keep.Contains(c.Key)) Stop(c.Proc);
            if (dropped > 0) Server.Log($"[upsample] {dropped} track(s) no longer made: another play");
        }
    }

    // Under the lock: whether [key] was dropped and isn't free again yet.
    private static bool WasSkipped(string key) => Skipped.TryGetValue(key, out var until) && DateTime.UtcNow < until;

    private static void Stop(Process proc)
    {
        try { proc.Kill(true); } catch (InvalidOperationException) { /* ended already */ }
    }

    private static void Enqueue(ConvTrack t, ConvPlan p)
    {
        var key = Transcoder.KeyFor(t, p);
        lock (Queue)
        {
            if (Making.Contains(key) || Queue.Exists(q => q.Key == key) || File.Exists(Transcoder.FinalPath(key)) || WasSkipped(key)) return;
            Queue.Add((key, t, p));
            if (running) return;
            running = true;
        }
        _ = Task.Run(Work);
    }

    private static async Task Work()
    {
        while (true)
        {
            (string Key, ConvTrack T, ConvPlan P) next;
            lock (Queue)
            {
                if (Queue.Count == 0) { running = false; return; }
                next = Queue[0];
                Queue.RemoveAt(0);
                Making.Add(next.Key);
                makingName = Path.GetFileNameWithoutExtension(next.T.Path);
            }
            if (Wait > 0) await Task.Delay(Wait);
            try { await Make(next.Key, next.T, next.P); }
            catch (Exception e) { Fail(next.T.Id); Server.Log($"[upsample] {Path.GetFileName(next.T.Path)}: couldn't be upsampled whole ({e.GetType().Name}: {e.Message})"); }
            finally { lock (Queue) { Making.Remove(next.Key); makingName = null; } }
        }
    }

    // One track made: the job handed to `mandarin-server upsample`, its file moved into place once whole.
    private static async Task Make(string key, ConvTrack t, ConvPlan p)
    {
        lock (Queue) { if (WasSkipped(key) || Halted.Remove(key)) return; }   // dropped or put back on its way here
        var final = Transcoder.FinalPath(key);
        if (File.Exists(final)) return;   // made while it waited
        var part = final + ".part";
        var job = p.DsdUp != 0 ? DsdPlan.Job(t.Path, p, part, Transcoder.Soxr, MaxOutBits()) : Job(t.Path, p, part);
        var psi = new ProcessStartInfo(Environment.ProcessPath ?? "mandarin-server") { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        psi.ArgumentList.Add("upsample");
        Cpu.Place(psi, CpuKind.Ahead);
        using var proc = Process.Start(psi)!;
        lock (Queue) { current = (key, proc); if (WasSkipped(key) || Halted.Contains(key)) Stop(proc); }
        Cpu.Adopt(proc, CpuKind.Ahead);
        try { await proc.StandardInput.WriteLineAsync(job.ToJsonString()); proc.StandardInput.Close(); }
        catch (IOException) { /* stopped before it read its job (Skip); its exit says so */ }
        var said = await proc.StandardOutput.ReadToEndAsync();
        _ = await proc.StandardError.ReadToEndAsync();
        await proc.WaitForExitAsync();
        Cpu.Forget(proc);
        lock (Queue)
        {
            current = null;
            if (Halted.Remove(key) | WasSkipped(key))
            {
                try { File.Delete(part); } catch (IOException) { /* never made */ }
                return;
            }
        }
        var r = JsonNode.Parse(said.Trim().Split('\n')[^1]) as JsonObject;
        if (proc.ExitCode != 0 || r == null || r["error"] != null)
        {
            try { File.Delete(part); } catch (IOException) { /* never made */ }
            Fail(t.Id);
            Server.Log($"[upsample] {Path.GetFileName(t.Path)}: couldn't be upsampled whole ({(string?)r?["error"] ?? "exit " + proc.ExitCode})");
            return;
        }
        File.Move(part, final, overwrite: true);
        lock (Queue) Failed.Remove(t.Id);
        var gain = (double?)r["gain"] ?? 1;
        Server.Log($"[upsample] {Path.GetFileName(t.Path)}: {(p.DsdUp != 0 ? $"DSD{p.DsdUp} from PCM ({(long?)r["resets"] ?? 0} reset(s))" : $"×{(int)(p.Rate / Math.Max(1, p.InRate))} whole")} in {(double?)r["seconds"]} s, {(int?)r["sections"]} section(s){(gain < 1 ? $", {Math.Round(20 * Math.Log10(gain), 2)} dB to keep its peaks under full scale" : "")}");
        Transcoder.Prune();
    }

    private static void Fail(long id) { lock (Queue) Failed.Add(id); }

    /*
     * The job for [src] by [p] into [dest]: ffmpeg decoding it to 64-bit float stereo at its own rate (the gain on it),
     * and ffmpeg making the file from 64-bit float at the plan's rate (the DSP and the requantise, as a conversion's).
     */
    public static JsonObject Job(string src, ConvPlan p, string dest)
    {
        var inRate = (long)p.InRate;
        if (inRate <= 0 || p.Rate % inRate != 0) throw new InvalidOperationException($"no rate of the track's own to upsample from ({p.InRate} Hz to {p.Rate} Hz)");
        var decode = new JsonArray("-hide_banner", "-nostdin", "-loglevel", "error", "-i", src, "-map", "0:a:0", "-vn");
        // The gain, and a room or headphone correction (item 252) at the track's own rate, before it is upsampled; the
        // encode below then leaves the correction out.
        var conv = p.Dsp != null ? Playback.Convolution.Of(Jv.Get(p.Dsp, "dsp")) : null;
        var pre = p.Gain != 0 ? $"volume=volume={Jv.Str(p.Gain)}dB:precision=double" : conv != null ? "anull" : null;
        if (pre != null) { decode.Add("-af"); decode.Add(conv != null ? Playback.Convolution.Graph(pre, conv, inRate, Transcoder.Soxr) : pre); }
        foreach (var a in new[] { "-ac", "2", "-ar", inRate.ToString(System.Globalization.CultureInfo.InvariantCulture), "-f", "f64le", "-c:a", "pcm_f64le", "pipe:1" }) decode.Add(a);
        // The conversion's own arguments, from 64-bit float at the plan's rate on standard input (nothing to resample,
        // no gain twice), the source's tags beside it.
        var convArgs = Transcoder.Args(src, p with { Gain = 0, Whole = false, InRate = p.Rate }, dest, Transcoder.Soxr, convolve: false);
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
            ["rate"] = inRate, ["factor"] = p.Rate / Math.Max(1, inRate), ["max_out_bits"] = MaxOutBits(), ["shape"] = p.Shape,
        };
    }

    // The largest transform the machine's memory allows (16 bytes a point, and room left): 2^28 from 12 GB.
    private static int MaxOutBits()
    {
        var bytes = GC.GetGCMemoryInfo().TotalAvailableMemoryBytes;
        return bytes >= 12L << 30 ? 28 : bytes >= 6L << 30 ? 27 : 26;
    }
}
