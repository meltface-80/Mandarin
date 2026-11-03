// UpsampleCommand.cs — `mandarin-server upsample`: one track upsampled as it plays (bug list items 237, 259), in a
// process of its own so that Cpu.cs can place it and a stopped play can stop it.
//
// Its job is a line of JSON on standard input: { ffmpeg, decode: [args], rate, factor, shape?, frames?, then either
// dsd: rate and out: path (a DSF, item 242), or encode: [args] }. The decode arguments make ffmpeg write the track as
// 64-bit float stereo at [rate] to its standard output (the gain already on it); it is read a block at a time, upsampled
// by [factor] in [shape] (StreamUpsample.cs), and either made DSD, each channel through its own chain (DsdChain.cs),
// written to the DSF as it is made (DsfWriter.cs, the header first, so that it can be sent as it grows), or handed to
// ffmpeg as 64-bit float stereo at rate × factor, which the encode arguments make the file of (the DSP and the
// requantise its own). [frames]: the track's length at [rate], the DSF's header says before the first bit is made; the
// decode is held to it (silence after a track shorter than said, nothing past one longer).
//
// What it did is one line of JSON on standard output: { frames, seconds, peak, held, resets }, or { error }.
using System.Buffers.Binary;
using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Mandarin.Server.Upsample;

internal static class UpsampleCommand
{
    /*
     * Above this in the PCM it is made from (+2.9 dB over full scale), a sample is held to it: 70% of the modulation,
     * inside what the modulator holds (75%, item 255). A track's own peaks, upsampled, fall between its samples and
     * may pass full scale; few pass this.
     */
    public const double Most = 1.4;

    private const int Chunk = 8192;   // frames read at a time

    public static int Run()
    {
        var started = Stopwatch.StartNew();
        try
        {
            var job = JsonNode.Parse(Console.In.ReadLine() ?? "")!.AsObject();
            var r = Make(job);
            Console.WriteLine(new JsonObject
            {
                ["frames"] = r.Frames, ["peak"] = r.Peak, ["held"] = r.Held, ["resets"] = r.Resets,
                ["seconds"] = Math.Round(started.Elapsed.TotalSeconds, 2),
            }.ToJsonString());
            return 0;
        }
        catch (Exception e)
        {
            Console.WriteLine(new JsonObject { ["error"] = e.GetType().Name + ": " + e.Message }.ToJsonString());
            return 1;
        }
    }

    /* What a making did: the frames at the input's rate, the peak at 705.6 kHz (or the plan's rate), the samples held, the modulators' resets. */
    public sealed record Result(long Frames, double Peak, long Held, long Resets);

    private static Result Make(JsonObject job)
    {
        var ffmpeg = (string?)job["ffmpeg"] ?? "ffmpeg";
        var rate = (int)job["rate"]!;
        var factor = (int)job["factor"]!;
        var kind = Shape.Of((string?)job["shape"]);
        long declared = job["frames"] is JsonValue fv ? (long)fv : 0;
        using var decode = Start(ffmpeg, Strings(job["decode"]), input: false, output: true);
        var decodeErr = decode.StandardError.ReadToEndAsync();
        Result r;
        if (job["dsd"] is JsonValue dv)
        {
            if (declared <= 0) throw new InvalidOperationException("a DSF's length must be known before it is made");
            r = Dsd(decode.StandardOutput.BaseStream, factor, kind, (int)dv, (string)job["out"]!, declared);
        }
        else r = Pcm(ffmpeg, Strings(job["encode"]), decode.StandardOutput.BaseStream, factor, kind, declared);
        try { if (!decode.HasExited) decode.Kill(); } catch (InvalidOperationException) { /* ended */ }
        decode.WaitForExit();
        if (decode.ExitCode != 0 && r.Frames == 0) throw new InvalidOperationException("ffmpeg couldn't read the track: " + decodeErr.Result.Trim());
        return r;
    }

    /* [frames] of [pcm] (64-bit float stereo) upsampled by [factor] in [kind] and made DSD at [dsdRate] into [path]: the header first, then each block of bits as both channels have them. */
    public static Result Dsd(Stream pcm, int factor, Shape.Kind kind, int dsdRate, string path, long frames)
    {
        var ntf = DsdOut.Ntf(dsdRate);
        var outFrames = frames * factor;
        using var file = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read, 1 << 16);
        var gate = new object();
        DsfWriter? w = null;
        DsdChain l = new(dsdRate, ntf, x => { lock (gate) w!.Write(0, x); });
        DsdChain rch = new(dsdRate, ntf, x => { lock (gate) w!.Write(1, x); });
        w = new DsfWriter(file, dsdRate, outFrames * l.Factor);
        double peak = 0;
        long held = 0;
        using var toChains = new System.Collections.Concurrent.BlockingCollection<(double[], double[])>(boundedCapacity: 2);
        var up = new StreamUpsample(factor, kind, (a, b, n) =>
        {
            for (var i = 0; i < n; i++)
            {
                peak = Math.Max(peak, Math.Max(Math.Abs(a[i]), Math.Abs(b[i])));
                if (Math.Abs(a[i]) > Most) { a[i] = Math.CopySign(Most, a[i]); held++; }
                if (Math.Abs(b[i]) > Most) { b[i] = Math.CopySign(Most, b[i]); held++; }
            }
            toChains.Add((a.AsSpan(0, n).ToArray(), b.AsSpan(0, n).ToArray()));
        });
        // The doublings on a thread of their own, fed through a short queue: the upsampling of the next block goes on meanwhile.
        var doubling = Task.Factory.StartNew(() =>
        {
            foreach (var (x, y) in toChains.GetConsumingEnumerable())
            {
                Parallel.Invoke(() => l.Push(x), () => rch.Push(y));
                lock (gate) file.Flush();
            }
        }, TaskCreationOptions.LongRunning);
        try
        {
            Read(pcm, frames, up);
            up.Finish();
        }
        finally { toChains.CompleteAdding(); }
        doubling.Wait();
        Parallel.Invoke(() => l.Finish(outFrames), () => rch.Finish(outFrames));
        lock (gate) w.Dispose();
        return new Result(frames, peak, held, l.Modulator.Resets + rch.Modulator.Resets);
    }

    // Made PCM by ffmpeg from the upsampled 64-bit float stereo, written to it as it comes.
    private static Result Pcm(string ffmpeg, List<string> args, Stream pcm, int factor, Shape.Kind kind, long frames)
    {
        using var p = Start(ffmpeg, args, input: true, output: false);
        var err = p.StandardError.ReadToEndAsync();
        var into = p.StandardInput.BaseStream;
        var buf = new byte[16 * Chunk * factor];
        double peak = 0;
        var up = new StreamUpsample(factor, kind, (a, b, n) =>
        {
            if (buf.Length < n * 16) buf = new byte[n * 16];
            for (var i = 0; i < n; i++)
            {
                peak = Math.Max(peak, Math.Max(Math.Abs(a[i]), Math.Abs(b[i])));
                BinaryPrimitives.WriteDoubleLittleEndian(buf.AsSpan(i * 16), a[i]);
                BinaryPrimitives.WriteDoubleLittleEndian(buf.AsSpan(i * 16 + 8), b[i]);
            }
            into.Write(buf, 0, n * 16);
        });
        long read;
        try
        {
            read = Read(pcm, frames, up);
            up.Finish();
        }
        finally { try { into.Close(); } catch (IOException) { /* ffmpeg gone: said below */ } }
        p.WaitForExit();
        if (p.ExitCode != 0) throw new InvalidOperationException("ffmpeg couldn't write the file: " + err.Result.Trim());
        return new Result(read, peak, 0, 0);
    }

    // The decoded track into [up] a block at a time: [frames] of it where that is said (made up with silence, or cut
    // short), else all of it. The frames read.
    private static long Read(Stream pcm, long frames, StreamUpsample up)
    {
        var bytes = new byte[Chunk * 16];
        var l = new double[Chunk];
        var r = new double[Chunk];
        long done = 0;
        var have = 0;
        while (frames <= 0 || done < frames)
        {
            var got = pcm.Read(bytes, have, bytes.Length - have);
            if (got <= 0) break;
            have += got;
            var n = have / 16;
            if (frames > 0) n = (int)Math.Min(n, frames - done);
            for (var i = 0; i < n; i++)
            {
                l[i] = BinaryPrimitives.ReadDoubleLittleEndian(bytes.AsSpan(i * 16));
                r[i] = BinaryPrimitives.ReadDoubleLittleEndian(bytes.AsSpan(i * 16 + 8));
            }
            up.Push(l.AsSpan(0, n), r.AsSpan(0, n));
            done += n;
            var rest = have - n * 16;
            Array.Copy(bytes, n * 16, bytes, 0, rest);
            have = rest;
        }
        // A track shorter than its length said: silence to the length.
        Array.Clear(l); Array.Clear(r);
        while (frames > 0 && done < frames)
        {
            var n = (int)Math.Min(Chunk, frames - done);
            up.Push(l.AsSpan(0, n), r.AsSpan(0, n));
            done += n;
        }
        return done;
    }

    private static List<string> Strings(JsonNode? n) => n is JsonArray a ? a.Select(x => (string)x!).ToList() : [];

    private static Process Start(string ffmpeg, List<string> args, bool input, bool output)
    {
        var psi = new ProcessStartInfo(ffmpeg) { UseShellExecute = false, RedirectStandardInput = input, RedirectStandardOutput = output, RedirectStandardError = true };
        foreach (var a in args) psi.ArgumentList.Add(a);
        return Process.Start(psi)!;
    }
}
