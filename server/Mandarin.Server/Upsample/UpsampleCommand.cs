// UpsampleCommand.cs — `mandarin-server upsample`: one track upsampled whole (bug list item 237), in a process of
// its own so the gigabytes it takes are given back the moment it ends, and Cpu.cs can keep it off playback's cores.
//
// Its job is a line of JSON on standard input: { ffmpeg, decode: [args], encode: [args], rate, factor,
// max_out_bits? }. The decode arguments make ffmpeg write the track as 64-bit float stereo at [rate] to its
// standard output (the gain already on it); the encode arguments make it read 64-bit float stereo at rate × factor
// from its standard input and write the file (the DSP and the requantise its own). In between, WholeTrack.cs.
// What it did is one line of JSON on standard output: { frames, sections, peak, gain, seconds, resets }, or { error }.
// With { dsd: rate, out: path } it makes a DSF instead (DsdOut.cs, item 242): no encode, the bits written itself.
using System.Buffers.Binary;
using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Mandarin.Server.Upsample;

internal static class UpsampleCommand
{
    public static int Run()
    {
        var started = Stopwatch.StartNew();
        try
        {
            var job = JsonNode.Parse(Console.In.ReadLine() ?? "")!.AsObject();
            var ffmpeg = (string?)job["ffmpeg"] ?? "ffmpeg";
            var rate = (int)job["rate"]!;
            var factor = (int)job["factor"]!;
            var maxBits = job["max_out_bits"] is JsonValue mb ? (int)mb : 28;
            var (left, right) = Decode(ffmpeg, Strings(job["decode"]));
            // Made DSD (item 242): { dsd: its rate, out: the DSF }, the whole track at 705.6 kHz on the way.
            long resets = 0;
            var r = job["dsd"] is JsonValue dv
                ? Dsd(left, right, rate, (int)dv, maxBits, (string)job["out"]!, out resets)
                : Encode(ffmpeg, Strings(job["encode"]), write => WholeTrack.Run(left, right, rate, new WholeTrack.Options(factor, MaxOutBits: maxBits), write));
            Console.WriteLine(new JsonObject
            {
                ["frames"] = r.Frames, ["sections"] = r.Sections, ["peak"] = r.Peak, ["gain"] = r.Gain,
                ["seconds"] = Math.Round(started.Elapsed.TotalSeconds, 1), ["resets"] = resets,
            }.ToJsonString());
            return 0;
        }
        catch (Exception e)
        {
            Console.WriteLine(new JsonObject { ["error"] = e.GetType().Name + ": " + e.Message }.ToJsonString());
            return 1;
        }
    }

    private static WholeTrack.Result Dsd(double[] left, double[] right, int rate, int dsdRate, int maxBits, string path, out long resets)
    {
        var (r, x) = DsdOut.Make(left, right, rate, dsdRate, maxBits, path);
        resets = x;
        return r;
    }

    private static List<string> Strings(JsonNode? n) => n is JsonArray a ? a.Select(x => (string)x!).ToList() : [];

    private static Process Start(string ffmpeg, List<string> args, bool input, bool output)
    {
        var psi = new ProcessStartInfo(ffmpeg) { UseShellExecute = false, RedirectStandardInput = input, RedirectStandardOutput = output, RedirectStandardError = true };
        foreach (var a in args) psi.ArgumentList.Add(a);
        return Process.Start(psi)!;
    }

    // The track as 64-bit float stereo: the two channels apart.
    private static (double[] Left, double[] Right) Decode(string ffmpeg, List<string> args)
    {
        using var p = Start(ffmpeg, args, input: false, output: true);
        var err = p.StandardError.ReadToEndAsync();
        var chunks = new List<byte[]>();
        var stream = p.StandardOutput.BaseStream;
        long total = 0;
        while (true)
        {
            var buf = new byte[1 << 24];
            int filled = 0, got;
            while (filled < buf.Length && (got = stream.Read(buf, filled, buf.Length - filled)) > 0) filled += got;
            if (filled == 0) break;
            chunks.Add(filled == buf.Length ? buf : buf[..filled]);
            total += filled;
            if (filled < buf.Length) break;
        }
        p.WaitForExit();
        if (p.ExitCode != 0) throw new InvalidOperationException("ffmpeg couldn't read the track: " + err.Result.Trim());
        var frames = total / 16;
        double[] left = new double[frames], right = new double[frames];
        long f = 0;
        var carry = new byte[16];
        var carried = 0;
        foreach (var c in chunks)
        {
            var i = 0;
            if (carried > 0)
            {
                var take = Math.Min(16 - carried, c.Length);
                Array.Copy(c, 0, carry, carried, take); carried += take; i = take;
                if (carried == 16 && f < frames) { left[f] = BinaryPrimitives.ReadDoubleLittleEndian(carry); right[f] = BinaryPrimitives.ReadDoubleLittleEndian(carry.AsSpan(8)); f++; carried = 0; }
            }
            for (; i + 16 <= c.Length && f < frames; i += 16, f++)
            {
                left[f] = BinaryPrimitives.ReadDoubleLittleEndian(c.AsSpan(i));
                right[f] = BinaryPrimitives.ReadDoubleLittleEndian(c.AsSpan(i + 8));
            }
            if (i < c.Length) { carried = c.Length - i; Array.Copy(c, i, carry, 0, carried); }
        }
        return (left, right);
    }

    // ffmpeg started to make the file, and [make] given what writes the frames to it, as 64-bit float stereo.
    private static WholeTrack.Result Encode(string ffmpeg, List<string> args, Func<Action<double[], double[], long, long, double>, WholeTrack.Result> make)
    {
        using var p = Start(ffmpeg, args, input: true, output: false);
        var err = p.StandardError.ReadToEndAsync();
        var stream = p.StandardInput.BaseStream;
        var buf = new byte[16 << 16];
        WholeTrack.Result r;
        try
        {
            r = make((re, im, from, count, gain) =>
            {
                for (long done = 0; done < count;)
                {
                    var n = (int)Math.Min(1 << 16, count - done);
                    for (var i = 0; i < n; i++)
                    {
                        BinaryPrimitives.WriteDoubleLittleEndian(buf.AsSpan(i * 16), re[from + done + i] * gain);
                        BinaryPrimitives.WriteDoubleLittleEndian(buf.AsSpan(i * 16 + 8), im[from + done + i] * gain);
                    }
                    stream.Write(buf, 0, n * 16);
                    done += n;
                }
            });
        }
        finally { try { stream.Close(); } catch (IOException) { /* ffmpeg gone: said below */ } }
        p.WaitForExit();
        if (p.ExitCode != 0) throw new InvalidOperationException("ffmpeg couldn't write the file: " + err.Result.Trim());
        return r;
    }
}
