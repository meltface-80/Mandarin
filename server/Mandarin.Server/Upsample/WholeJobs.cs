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

internal static class WholeJobs
{
    private static readonly List<(string Key, ConvTrack T, ConvPlan P)> Queue = [];
    private static readonly HashSet<string> Making = [];
    private static readonly HashSet<long> Failed = [];
    private static string? makingName;
    private static bool running;

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
        var made = !Directory.Exists(dir) ? 0 : Directory.EnumerateFiles(dir).Count(f => f.EndsWith("-w.flac", StringComparison.Ordinal) || f.EndsWith("-w-wav.wav", StringComparison.Ordinal));
        lock (Queue) return (made, makingName, Queue.Count);
    }

    /* Whole plans of [items] queued to be made ahead; the others as conversions are (Transcoder.Prefetch). */
    public static void Prefetch(IEnumerable<(ConvTrack T, ConvPlan P)> items)
    {
        var rest = new List<(ConvTrack, ConvPlan)>();
        foreach (var (t, p) in items)
        {
            if (p.Whole) Enqueue(t, p);
            else rest.Add((t, p));
        }
        if (rest.Count > 0) Transcoder.Prefetch(rest);
    }

    private static void Enqueue(ConvTrack t, ConvPlan p)
    {
        var key = Transcoder.KeyFor(t, p);
        lock (Queue)
        {
            if (Making.Contains(key) || Queue.Exists(q => q.Key == key) || File.Exists(Transcoder.FinalPath(key))) return;
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
            try { await Make(next.Key, next.T, next.P); }
            catch (Exception e) { Fail(next.T.Id); Server.Log($"[upsample] {Path.GetFileName(next.T.Path)}: couldn't be upsampled whole ({e.GetType().Name}: {e.Message})"); }
            finally { lock (Queue) { Making.Remove(next.Key); makingName = null; } }
        }
    }

    // One track made: the job handed to `mandarin-server upsample`, its file moved into place once whole.
    private static async Task Make(string key, ConvTrack t, ConvPlan p)
    {
        var final = Transcoder.FinalPath(key);
        var part = final + ".part";
        var job = Job(t.Path, p, part);
        var psi = new ProcessStartInfo(Environment.ProcessPath ?? "mandarin-server") { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        psi.ArgumentList.Add("upsample");
        Cpu.Place(psi, CpuKind.Ahead);
        using var proc = Process.Start(psi)!;
        Cpu.Adopt(proc, CpuKind.Ahead);
        await proc.StandardInput.WriteLineAsync(job.ToJsonString());
        proc.StandardInput.Close();
        var said = await proc.StandardOutput.ReadToEndAsync();
        _ = await proc.StandardError.ReadToEndAsync();
        await proc.WaitForExitAsync();
        Cpu.Forget(proc);
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
        Server.Log($"[upsample] {Path.GetFileName(t.Path)}: ×{(int)(p.Rate / Math.Max(1, p.InRate))} whole in {(double?)r["seconds"]} s, {(int?)r["sections"]} section(s){(gain < 1 ? $", {Math.Round(20 * Math.Log10(gain), 2)} dB to keep its peaks under full scale" : "")}");
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
        if (p.Gain != 0) { decode.Add("-af"); decode.Add($"volume=volume={Jv.Str(p.Gain)}dB:precision=double"); }
        foreach (var a in new[] { "-ac", "2", "-ar", inRate.ToString(System.Globalization.CultureInfo.InvariantCulture), "-f", "f64le", "-c:a", "pcm_f64le", "pipe:1" }) decode.Add(a);
        // The conversion's own arguments, from 64-bit float at the plan's rate on standard input (nothing to resample,
        // no gain twice), the source's tags beside it.
        var conv = Transcoder.Args(src, p with { Gain = 0, Whole = false, InRate = p.Rate }, dest);
        var rate = p.Rate.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var encode = new JsonArray();
        for (var i = 0; i < conv.Count; i++)
        {
            if (conv[i] == "-i" && i + 1 < conv.Count && conv[i + 1] == src)
            {
                foreach (var a in new[] { "-f", "f64le", "-ar", rate, "-ac", "2", "-i", "pipe:0", "-i", src }) encode.Add(a);
                i++;
            }
            else if (conv[i] == "-map_metadata" && i + 1 < conv.Count) { encode.Add("-map_metadata"); encode.Add("1"); i++; }
            else encode.Add(conv[i]);
        }
        return new JsonObject
        {
            ["ffmpeg"] = Transcoder.Bin, ["decode"] = decode, ["encode"] = encode,
            ["rate"] = inRate, ["factor"] = p.Rate / Math.Max(1, inRate), ["max_out_bits"] = MaxOutBits(),
        };
    }

    // The largest transform the machine's memory allows (16 bytes a point, and room left): 2^28 from 12 GB.
    private static int MaxOutBits()
    {
        var bytes = GC.GetGCMemoryInfo().TotalAvailableMemoryBytes;
        return bytes >= 12L << 30 ? 28 : bytes >= 6L << 30 ? 27 : 26;
    }
}
