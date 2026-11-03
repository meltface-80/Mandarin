// Convolution.cs — a device's room or headphone correction from an impulse response (bug list item 252).
//
// The owner makes the impulse response elsewhere (REW, Dirac, a headphone measurement), exports it as a WAV, and loads
// it on a device's DSP. It is kept under the data folder by its hash and its facts saved with the DSP setting: the
// file, its name, rate, channels, length and the most its frequency response lifts anything (peak_db, for the
// headroom). A conversion for the device then runs the track through it with ffmpeg's afir, in 64-bit float, at the
// track's own rate, before anything is upsampled (a filter as long as the response at 705.6 kHz would be sixteen
// times the work for nothing): a mono one spread to both channels at unity, the convolution placed before the graph's
// first resample. Without a response the graph is as it was.
//
// A response made at another rate than the track's is resampled to it. Two things are put right on the way: its level
// (a response resampled from fs1 to fs2 has its gain scaled by fs2/fs1, so it is scaled back), and its start (a
// response whose peak is its first sample would lose the part of its band-limited shape before it, so [Lead] samples
// of silence are laid before it, a delay of a millisecond or so). At the track's own rate it is used as it is.
using System.Security.Cryptography;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

internal sealed class ConvolutionError(string message) : Exception(message);

internal static class Convolution
{
    /* The silence laid before a response resampled to another rate, in its own samples. */
    public const int Lead = 64;

    /* The largest file taken, and the longest response. */
    public const int MaxBytes = 32 << 20;
    public const double MaxSeconds = 10;

    /* Where the responses are kept: beside the database. */
    public static string Dir => Path.Combine(Path.GetDirectoryName(Db.File) ?? ".", "impulses");

    /* A response's samples: its rate and each channel's. */
    public sealed record Wave(int Rate, double[][] Channels);

    /* Whether this ffmpeg's afir takes precision=double (5.1's may not; asked once). */
    private static readonly Lazy<bool> Precise = new(() =>
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo(Transcoder.Bin) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            foreach (var a in new[] { "-hide_banner", "-h", "filter=afir" }) psi.ArgumentList.Add(a);
            using var p = System.Diagnostics.Process.Start(psi)!;
            var o = p.StandardOutput.ReadToEnd();
            p.WaitForExit(5000);
            return o.Contains("precision", StringComparison.Ordinal);
        }
        catch (Exception) { return false; }
    });

    /*
     * [b], a WAV file: its rate and samples, each channel's, scaled to ±1. PCM of 16, 24 or 32 bits, or floating point
     * of 32 or 64, plain or WAVE_FORMAT_EXTENSIBLE; one or two channels. Throws a ConvolutionError saying what is wrong.
     */
    public static Wave Parse(byte[] b)
    {
        if (b.Length < 44 || b.AsSpan(0, 4).SequenceEqual("RIFF"u8) == false || b.AsSpan(8, 4).SequenceEqual("WAVE"u8) == false)
            throw new ConvolutionError("not a WAV file");
        int format = 0, channels = 0, rate = 0, bits = 0, at = 12;
        ReadOnlySpan<byte> data = default;
        var found = false;
        while (at + 8 <= b.Length)
        {
            var id = b.AsSpan(at, 4);
            var size = BitConverter.ToInt32(b, at + 4);
            var body = at + 8;
            if (size < 0 || body + size > b.Length) size = b.Length - body;
            if (id.SequenceEqual("fmt "u8) && size >= 16)
            {
                format = BitConverter.ToUInt16(b, body);
                channels = BitConverter.ToUInt16(b, body + 2);
                rate = BitConverter.ToInt32(b, body + 4);
                bits = BitConverter.ToUInt16(b, body + 14);
                if (format == 0xFFFE && size >= 26) format = BitConverter.ToUInt16(b, body + 24);   // the sub-format's own tag
            }
            else if (id.SequenceEqual("data"u8)) { data = b.AsSpan(body, size); found = true; }
            at = body + size + (size & 1);
        }
        if (!found || channels == 0) throw new ConvolutionError("not a WAV file: no format or no samples");
        if (channels > 2) throw new ConvolutionError("a response has one channel or two");
        if (rate < 8000 || rate > 768000) throw new ConvolutionError("a response's rate must be 8 kHz to 768 kHz");
        var width = bits / 8;
        if (!(format == 1 && bits is 16 or 24 or 32 || format == 3 && bits is 32 or 64)) throw new ConvolutionError("a response must be 16, 24 or 32-bit PCM, or 32 or 64-bit floating point");
        var frames = data.Length / (width * channels);
        if (frames < 1) throw new ConvolutionError("the response has no samples");
        if (frames > MaxSeconds * rate) throw new ConvolutionError($"a response is at most {MaxSeconds} seconds long");
        var ch = new double[channels][];
        for (var c = 0; c < channels; c++) ch[c] = new double[frames];
        for (var i = 0; i < frames; i++)
            for (var c = 0; c < channels; c++)
            {
                var s = data.Slice((i * channels + c) * width, width);
                ch[c][i] = (format, bits) switch
                {
                    (3, 32) => BitConverter.ToSingle(s),
                    (3, _) => BitConverter.ToDouble(s),
                    (_, 16) => BitConverter.ToInt16(s) / 32768.0,
                    (_, 24) => ((s[2] << 24 | s[1] << 16 | s[0] << 8) >> 8) / 8388608.0,
                    _ => BitConverter.ToInt32(s) / 2147483648.0,
                };
            }
        return new Wave(rate, ch);
    }

    /* The most [w]'s frequency response lifts anything from 20 Hz to 20 kHz (or its Nyquist frequency), in dB. */
    public static double PeakDb(Wave w)
    {
        var len = w.Channels[0].Length;
        var bits = Math.Max(16, (int)Math.Ceiling(Math.Log2(Math.Max(2, len) * 2)));
        var fft = new Upsample.Fft(bits);
        var n = fft.Length;
        var top = Math.Min(20000.0, w.Rate / 2.0);
        double most = 0;
        foreach (var x in w.Channels)
        {
            double[] re = new double[n], im = new double[n];
            Array.Copy(x, re, x.Length);
            fft.Forward(re, im);
            for (long k = 1; k < n / 2; k++)
            {
                var hz = (double)k * w.Rate / n;
                if (hz < 20 || hz > top) continue;
                var at = fft.BitReverse(k);
                most = Math.Max(most, re[at] * re[at] + im[at] * im[at]);
            }
        }
        return most <= 0 ? -200 : 10 * Math.Log10(most);
    }

    /*
     * [b], a WAV named [name], checked, measured and kept by its hash: the setting's "convolution", { file, name, rate,
     * channels, seconds, peak_db }.
     */
    public static JsObj Store(byte[] b, string name)
    {
        var w = Parse(b);
        var file = Convert.ToHexString(SHA256.HashData(b))[..16].ToLowerInvariant() + ".wav";
        Directory.CreateDirectory(Dir);
        var path = Path.Combine(Dir, file);
        if (!File.Exists(path)) File.WriteAllBytes(path, b);
        return Jv.Obj(("file", file), ("name", Clip(name, 120)), ("rate", (double)w.Rate), ("channels", (double)w.Channels.Length),
            ("seconds", Math.Round((double)w.Channels[0].Length / w.Rate, 3)), ("peak_db", Math.Round(PeakDb(w), 1)));
    }

    /* A setting's "convolution" as stored, or null where it isn't one (Biquad.Normalise). */
    public static JsObj? Normalise(object? c)
    {
        if (!Jv.T(c) || Jv.Get(c, "file") is not string file || !System.Text.RegularExpressions.Regex.IsMatch(file, "^[0-9a-f]{16}\\.wav$")) return null;
        var channels = Jv.Num(Jv.Get(c, "channels"));
        return Jv.Obj(("file", file), ("name", Clip(Jv.Str(Jv.Or(Jv.Get(c, "name"), "")), 120)), ("rate", Jv.Num(Jv.Get(c, "rate"))),
            ("channels", channels == 2 ? 2.0 : 1.0), ("seconds", Jv.Num(Jv.Get(c, "seconds"))), ("peak_db", Jv.Num(Jv.Get(c, "peak_db"))));
    }

    /* The response a DSP setting [dsp] runs, where its file is here; null for none. */
    public static JsObj? Of(object? dsp) =>
        Jv.T(dsp) && Jv.Get(dsp, "convolution") is JsObj c && Jv.Get(c, "file") is string f && File.Exists(Path.Combine(Dir, f)) ? c : null;

    /* The most the response of [dsp] lifts anything, in dB; 0 with none. */
    public static double Peak(object? dsp) => Jv.T(dsp) && Jv.Get(dsp, "convolution") is JsObj c ? Jv.Num(Jv.Get(c, "peak_db")) : 0;

    /*
     * ffmpeg's arguments [args] with [c]'s response run on the track at [inRate] before the graph's first resample (at
     * the track's own rate); [args] as they are with none, or no "-af".
     */
    public static List<string> Args(List<string> args, JsObj? c, double inRate, bool soxr)
    {
        if (c == null || inRate <= 0) return args;
        var at = args.IndexOf("-af");
        if (at < 0 || at + 1 >= args.Count) return args;
        var copy = new List<string>(args);
        copy[at + 1] = Graph(args[at + 1], c, inRate, soxr);
        return copy;
    }

    /* [graph], a chain, with [c]'s response run before its first resample (or after it all, where there is none). */
    public static string Graph(string graph, JsObj c, double inRate, bool soxr)
    {
        var cut = graph.IndexOf("aresample=", StringComparison.Ordinal);
        var before = (cut < 0 ? graph : graph[..cut]).TrimEnd(',');
        var after = cut < 0 ? "anull" : graph[cut..];
        var rate = Jv.Str((double)(long)inRate);
        var spread = Jv.Num(Jv.Get(c, "channels")) == 2 ? "" : ",pan=stereo|c0=c0|c1=c0";   // one channel, both sides, at unity
        var own = Jv.Num(Jv.Get(c, "rate"));
        var to = own == (long)inRate ? ""
            : $",adelay=delays={Lead}S:all=1,aresample={(soxr ? "resampler=soxr:precision=33:" : "")}osr={rate},volume={Jv.Str(own / (long)inRate)}:precision=double";
        var ir = $"amovie={Escape(Path.Combine(Dir, Jv.Str(Jv.Get(c, "file"))))},aformat=sample_fmts=dbl{to}{spread}[ir]";
        var main = $"[in]{(before.Length > 0 ? before + "," : "")}aformat=sample_fmts=dbl:channel_layouts=stereo[pre]";
        return $"{ir};{main};[pre][ir]afir=gtype=none{(Precise.Value ? ":precision=double" : "")},{after}[out]";
    }

    // A path as a filter's option value inside a graph: its own escaping (\ ' :), then the graph's (\ ' [ ] , ;).
    private static string Escape(string path)
    {
        var o = path.Replace("\\", "\\\\").Replace("'", "\\'").Replace(":", "\\:");
        return o.Replace("\\", "\\\\").Replace("'", "\\'").Replace("[", "\\[").Replace("]", "\\]").Replace(",", "\\,").Replace(";", "\\;");
    }

    private static string Clip(string s, int n) => s.Length > n ? s[..n] : s;
}
