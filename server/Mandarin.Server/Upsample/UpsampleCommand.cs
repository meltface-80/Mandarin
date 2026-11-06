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
// Joined to its album's neighbours (Joins.cs, item 262): before: [args] decode the end of the track before, after:
// [args] the start of the track after, as the track's own decode is. The upsampler and the chains are run on the last
// of the one before, then the track, then the first of the one after, and the file holds only the track's frames:
// [carry] of the one before's last first, then its own but its last [cut], which the next file begins with.
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
            if (job["dsd"] is JsonValue) { Dsds(job); return 0; }
            Said(Make(job), started);
            return 0;
        }
        catch (Exception e)
        {
            Console.WriteLine(new JsonObject { ["error"] = e.GetType().Name + ": " + e.Message }.ToJsonString());
            return 1;
        }
    }

    /*
     * A track's neighbours as its making has them (item 262): the last frames of the one before (left, right; null:
     * none) of which the file begins with the last [Carry], and the first of the one after (null: none); the track's
     * own last [Cut] frames are left for the next file.
     */
    public sealed record Around(double[][]? Before, long Carry, double[][]? After, long Cut)
    {
        public static readonly Around None = new(null, 0, null, 0);
        public long Lead => Before?[0].Length ?? 0;
        public long Lag => After?[0].Length ?? 0;
        /* The frames the file holds of a track of [frames]. */
        public long Kept(long frames) => Carry + frames - Cut;
    }

    private static void Said(Result r, Stopwatch started)
    {
        Console.WriteLine(new JsonObject
        {
            ["frames"] = r.Frames, ["peak"] = r.Peak, ["held"] = r.Held, ["resets"] = r.Resets,
            ["seconds"] = Math.Round(started.Elapsed.TotalSeconds, 2),
        }.ToJsonString());
        Console.Out.Flush();
    }

    /*
     * DSFs made from [job] and the jobs after it (item 262): one run of the upsampler and the modulators (DsdRun.cs).
     * A job with continue: true and an after is made to the end of its file with the start of the track after it
     * already in the run, and said done; then the next job is waited for on standard input. Given the track it looked
     * ahead to, the run goes on into it, the modulators as they were, its file where the one before ended; given
     * another, or nothing more, the run ends there.
     */
    private static void Dsds(JsonObject? job)
    {
        DsdRun? run = null;
        string? expect = null;   // the decode the run has the start of
        long ahead = 0;          // and how many of its frames
        while (job != null)
        {
            var started = Stopwatch.StartNew();
            var ffmpeg = (string?)job["ffmpeg"] ?? "ffmpeg";
            var factor = (int)job["factor"]!;
            var dsdRate = (int)job["dsd"]!;
            long frames = job["frames"] is JsonValue fv ? (long)fv : 0;
            if (frames <= 0) throw new InvalidOperationException("a DSF's length must be known before it is made");
            var carry = job["carry"] is JsonValue cv ? (long)cv : 0;
            var cut = job["cut"] is JsonValue kv ? (long)kv : 0;
            var decodeArgs = Strings(job["decode"]);
            var same = run != null && expect == string.Join("\u0001", decodeArgs);
            long skip = 0;
            if (same) skip = ahead;
            else
            {
                run?.Finish();
                run = new DsdRun(factor, Shape.Of((string?)job["shape"]), dsdRate, (string?)job["mod"]);
                // The one before's end, to start the filters and the modulators on (its carry silence where it can't be read).
                var before = job["before"] is JsonArray ba ? Neighbour(ffmpeg, Strings(ba), carry + Joins.History, tail: true) : null;
                if (before == null && carry > 0) before = [new double[carry + Joins.History], new double[carry + Joins.History]];
                if (before != null) { run.Skip(before[0].Length - carry); run.Push(before[0], before[1]); }
            }
            var w = run!.Add((string)job["out"]!, carry + frames - cut, job["at"] is JsonValue at ? (long)at : -1);
            using (var decode = Start(ffmpeg, decodeArgs, input: false, output: true))
            {
                var decodeErr = decode.StandardError.ReadToEndAsync();
                var read = Read(decode.StandardOutput.BaseStream, frames, run.Push, skip);
                try { if (!decode.HasExited) decode.Kill(); } catch (InvalidOperationException) { /* ended */ }
                decode.WaitForExit();
                if (decode.ExitCode != 0 && read == 0) throw new InvalidOperationException("ffmpeg couldn't read the track: " + decodeErr.Result.Trim());
            }
            var go = job["continue"] is JsonValue gv && (bool)gv && job["after"] is JsonArray;
            var afterArgs = job["after"] is JsonArray aa ? Strings(aa) : null;
            var head = afterArgs != null ? Neighbour(ffmpeg, afterArgs, go ? Joins.Ahead : Joins.History, tail: false) : null;
            if (head != null) run.Push(head[0], head[1]);
            if (go && head != null)
            {
                w.Done.Task.Wait();
                Said(new Result(carry + frames - cut, run.Peak, run.Held, run.Resets), started);
                // What it looked ahead to, as its own decode will read it: the same arguments, but from its start.
                expect = string.Join("\u0001", Joins.Whole(afterArgs!));
                ahead = head[0].Length;
                var next = Console.In.ReadLine();
                job = string.IsNullOrWhiteSpace(next) ? null : JsonNode.Parse(next)!.AsObject();
                if (job == null) run.Finish();
            }
            else
            {
                run.Finish();
                w.Done.Task.Wait();
                Said(new Result(carry + frames - cut, run.Peak, run.Held, run.Resets), started);
                job = null;
            }
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
        var carry = job["carry"] is JsonValue cv ? (long)cv : 0;
        var cut = job["cut"] is JsonValue kv ? (long)kv : 0;
        // The neighbours' frames, decoded first (a second or so of each): the last of the one before, the first of the one after.
        var before = job["before"] is JsonArray ba ? Neighbour(ffmpeg, Strings(ba), carry + Joins.History, tail: true) : null;
        var after = job["after"] is JsonArray aa ? Neighbour(ffmpeg, Strings(aa), Joins.History, tail: false) : null;
        // The one before unread: its carry silence, so that the file is the length its neighbours count on.
        if (before == null && carry > 0) before = [new double[carry + Joins.History], new double[carry + Joins.History]];
        var join = new Around(before, carry, after, cut);
        using var decode = Start(ffmpeg, Strings(job["decode"]), input: false, output: true);
        var decodeErr = decode.StandardError.ReadToEndAsync();
        var r = Pcm(ffmpeg, Strings(job["encode"]), decode.StandardOutput.BaseStream, factor, kind, declared, join, job["wav"] as JsonObject, Quantisers(job["dither"] as JsonObject));
        try { if (!decode.HasExited) decode.Kill(); } catch (InvalidOperationException) { /* ended */ }
        decode.WaitForExit();
        if (decode.ExitCode != 0 && r.Frames == 0) throw new InvalidOperationException("ffmpeg couldn't read the track: " + decodeErr.Result.Trim());
        return r;
    }

    /*
     * [frames] of [pcm] (64-bit float stereo) upsampled by [factor] in [kind] and made DSD at [dsdRate] into [path]: the
     * header first, then each block of bits as both channels have them. [around]: its neighbours (item 262), run
     * through before and after it and not kept. [mod]: the modulator (DsdOut.cs; null, the seventh order).
     */
    public static Result Dsd(Stream pcm, int factor, Shape.Kind kind, int dsdRate, string path, long frames, Around? around = null, string? mod = null)
    {
        var a = around ?? Around.None;
        var run = new DsdRun(factor, kind, dsdRate, mod);
        if (a.Before != null) { run.Skip(a.Lead - a.Carry); run.Push(a.Before[0], a.Before[1]); }
        var w = run.Add(path, a.Kept(frames));
        Read(pcm, frames, run.Push);
        if (a.After != null) run.Push(a.After[0], a.After[1]);
        run.Finish();
        w.Done.Task.Wait();
        return new Result(a.Kept(frames), run.Peak, run.Held, run.Resets);
    }

    // Made PCM by ffmpeg from the upsampled 64-bit float stereo, written to it as it comes: the track's own frames,
    // its neighbours' ([around]) run through before and after it and not kept. A [wav] (item 270): ffmpeg's bare samples
    // written to its file here, behind a header of their length ([frames] at the input's rate, upsampled).
    // Mandarin's own dither (item 301), where the job asks it: the two channels' quantisers; null for ffmpeg's.
    private static (Dither.Channel L, Dither.Channel R)? Quantisers(JsonObject? d) =>
        d == null ? null : Dither.For((long)d["rate"]!, (int)d["bits"]!, (string?)d["shape"], d["real"] is JsonValue r ? (int)r : 0);

    private static Result Pcm(string ffmpeg, List<string> args, Stream pcm, int factor, Shape.Kind kind, long frames, Around around, JsonObject? wav = null,
        (Dither.Channel L, Dither.Channel R)? q = null)
    {
        var size = q == null ? 16 : 8;   // a frame's bytes: two 64-bit floats, or two 32-bit words on the dither's grid
        using var p = Start(ffmpeg, args, input: true, output: wav != null);
        var err = p.StandardError.ReadToEndAsync();
        var written = wav == null ? Task.CompletedTask : Task.Run(() => WriteWav(p.StandardOutput.BaseStream, wav, around.Kept(frames) * factor));
        var into = p.StandardInput.BaseStream;
        var buf = new byte[size * Chunk * factor];
        double peak = 0;
        // Its length, where none is said, known once it is read: until then everything after the one before's is kept.
        var keepFrom = (around.Lead - around.Carry) * factor;
        var keepTo = frames > 0 ? keepFrom + around.Kept(frames) * factor : long.MaxValue;
        long made = 0;
        var up = new StreamUpsample(factor, kind, (a, b, n) =>
        {
            var from = (int)Math.Clamp(keepFrom - made, 0, n);
            var to = (int)Math.Clamp(keepTo - made, 0, n);
            made += n;
            if (to <= from) return;
            if (buf.Length < (to - from) * size) buf = new byte[(to - from) * size];
            for (var i = from; i < to; i++)
            {
                peak = Math.Max(peak, Math.Max(Math.Abs(a[i]), Math.Abs(b[i])));
                if (q is var (ql, qr))
                {
                    BinaryPrimitives.WriteInt32LittleEndian(buf.AsSpan((i - from) * 8), Dither.Word(ql.Next(a[i])));
                    BinaryPrimitives.WriteInt32LittleEndian(buf.AsSpan((i - from) * 8 + 4), Dither.Word(qr.Next(b[i])));
                }
                else
                {
                    BinaryPrimitives.WriteDoubleLittleEndian(buf.AsSpan((i - from) * 16), a[i]);
                    BinaryPrimitives.WriteDoubleLittleEndian(buf.AsSpan((i - from) * 16 + 8), b[i]);
                }
            }
            into.Write(buf, 0, (to - from) * size);
        });
        long read;
        try
        {
            Push(around.Before, up);
            read = Read(pcm, frames, up);
            // The outputs of what is pushed after come after the track's: they are only looked ahead to.
            keepTo = keepFrom + around.Kept(read) * factor;
            Push(around.After, up);
            up.Finish();
            read = around.Kept(read);
        }
        finally { try { into.Close(); } catch (IOException) { /* ffmpeg gone: said below */ } }
        p.WaitForExit();
        written.Wait();
        if (p.ExitCode != 0) throw new InvalidOperationException("ffmpeg couldn't write the file: " + err.Result.Trim());
        return new Result(read, peak, q is var (hl, hr) ? hl.Held + hr.Held : 0, 0);
    }

    // The decoded track into [up] a block at a time: [frames] of it where that is said (made up with silence, or cut
    // short), else all of it. The frames read.
    private static long Read(Stream pcm, long frames, StreamUpsample up) => Read(pcm, frames, up.Push);

    // The same into [push], the first [skip] frames read and passed over (the run has them already: item 262).
    private delegate void Into(ReadOnlySpan<double> left, ReadOnlySpan<double> right);
    private static long Read(Stream pcm, long frames, Into push, long skip = 0)
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
            // Those the run has already, passed over; the rest pushed.
            var pass = (int)Math.Clamp(skip - done, 0, n);
            if (n > pass) push(l.AsSpan(pass, n - pass), r.AsSpan(pass, n - pass));
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
            var pass = (int)Math.Clamp(skip - done, 0, n);
            if (n > pass) push(l.AsSpan(pass, n - pass), r.AsSpan(pass, n - pass));
            done += n;
        }
        return done;
    }

    // A neighbour's frames ([pairs]: left, right) into [up], as they are.
    private static void Push(double[][]? pairs, StreamUpsample up)
    {
        if (pairs != null && pairs[0].Length > 0) up.Push(pairs[0], pairs[1]);
    }

    // A neighbour decoded by [args] (its end, or its start): [frames] of it, the last or the first; null where it
    // can't be read. Fewer than [frames] at its end are made up with silence before them, so that the carry is there.
    private static double[][]? Neighbour(string ffmpeg, List<string> args, long frames, bool tail)
    {
        try
        {
            using var p = Start(ffmpeg, args, input: false, output: true);
            var err = p.StandardError.ReadToEndAsync();
            using var ms = new MemoryStream();
            p.StandardOutput.BaseStream.CopyTo(ms);
            p.WaitForExit();
            var bytes = ms.GetBuffer().AsSpan(0, (int)ms.Length);
            var have = bytes.Length / 16;
            if (p.ExitCode != 0 || have == 0) return null;
            var n = (int)Math.Min(frames, have);
            var first = tail ? have - n : 0;
            var pad = tail ? (int)frames - n : 0;
            var l = new double[n + pad];
            var r = new double[n + pad];
            for (var i = 0; i < n; i++)
            {
                l[pad + i] = BinaryPrimitives.ReadDoubleLittleEndian(bytes[((first + i) * 16)..]);
                r[pad + i] = BinaryPrimitives.ReadDoubleLittleEndian(bytes[((first + i) * 16 + 8)..]);
            }
            return [l, r];
        }
        catch (Exception e) when (e is IOException or InvalidOperationException or System.ComponentModel.Win32Exception) { return null; }
    }

    private static List<string> Strings(JsonNode? n) => n is JsonArray a ? a.Select(x => (string)x!).ToList() : [];

    // A WAV of [frames] stereo frames at the [wav] job's rate and depth: its header, then ffmpeg's samples as they come.
    private static void WriteWav(Stream samples, JsonObject wav, long frames)
    {
        var bits = (int)wav["bits"]!;
        // Restarted part way into the file (item 272): from that byte on, its header already there.
        var at = wav["at"] is JsonValue av ? (long)av : -1;
        using var f = new FileStream((string)wav["out"]!, at >= 0 ? FileMode.OpenOrCreate : FileMode.Create, FileAccess.Write, FileShare.Read, 1 << 16);
        if (at >= 0) f.Position = at;
        else f.Write(WavHeader.For((int)wav["rate"]!, bits, frames * 2 * (bits / 8)));
        var buf = new byte[1 << 16];
        for (int n; (n = samples.Read(buf)) > 0;) { f.Write(buf, 0, n); f.Flush(); }
    }

    private static Process Start(string ffmpeg, List<string> args, bool input, bool output)
    {
        var psi = new ProcessStartInfo(ffmpeg) { UseShellExecute = false, RedirectStandardInput = input, RedirectStandardOutput = output, RedirectStandardError = true };
        foreach (var a in args) psi.ArgumentList.Add(a);
        return Process.Start(psi)!;
    }
}
