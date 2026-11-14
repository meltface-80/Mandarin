// Chromaprint.cs — a track's Chromaprint fingerprint, as AcoustID takes it (bug list item 414c): chromaprint 1.5's
// default algorithm (TEST2) in managed code, step for step, so the string is the one `fpcalc` prints for the same
// audio, byte for byte (test/Mandarin.Tests/ChromaprintTests.cs holds it to fpcalc's own output). No native library.
//
//   audio, 11025 Hz mono 16-bit (Fingerprints.cs decodes it with ffmpeg as fpcalc does), the first 120 s
//   → frames of 4096 every 1365 samples, Hamming-windowed, their power spectrum (KissFft.cs)
//   → 12 chroma bands from 28 Hz to 3520 Hz, smoothed over five frames (0.25, 0.75, 1, 0.75, 0.25), normalised
//   → a rolling integral image, and 16 filters with their quantizers over it: 2 bits each, Gray-coded → one 32-bit
//     sub-fingerprint a frame
//   → compressed (each sub-fingerprint's changed bits as gaps, 3 and 5 bits packed) behind its algorithm and count,
//     in URL-safe base64 without padding.
//
// Chromaprint is Lukas Lalinsky's, MIT-licensed; its classifiers and constants are copied here as they are.
using System.Text;

namespace Mandarin.Server.Identify;

internal sealed class Chromaprint
{
    public const int SampleRate = 11025;
    public const int MaxSeconds = 120;
    public const int Algorithm = 1;             // CHROMAPRINT_ALGORITHM_TEST2, the default
    private const int FrameSize = 4096;
    private const int Increment = FrameSize - (FrameSize - FrameSize / 3);   // 1365: an overlap of 2731
    private const int Bands = 12;
    private const int FilterWidth = 16;         // the widest classifier's
    private const int ImageRows = 256 + 1;      // the rolling image's rows

    private static readonly double[] Smoothing = [0.25, 0.75, 1.0, 0.75, 0.25];

    // TEST2's classifiers: the filter's type, y, height and width; the quantizer's thresholds.
    private static readonly (int Type, int Y, int H, int W, double T0, double T1, double T2)[] Classifiers =
    [
        (0, 4, 3, 15, 1.98215, 2.35817, 2.63523), (4, 4, 6, 15, -1.03809, -0.651211, -0.282167),
        (1, 0, 4, 16, -0.298702, 0.119262, 0.558497), (3, 8, 2, 12, -0.105439, 0.0153946, 0.135898),
        (3, 4, 4, 8, -0.142891, 0.0258736, 0.200632), (4, 0, 3, 5, -0.826319, -0.590612, -0.368214),
        (1, 2, 2, 9, -0.557409, -0.233035, 0.0534525), (2, 7, 3, 4, -0.0646826, 0.00620476, 0.0784847),
        (2, 6, 2, 16, -0.192387, -0.029699, 0.215855), (2, 1, 3, 2, -0.0397818, -0.00568076, 0.0292026),
        (5, 10, 1, 15, -0.53823, -0.369934, -0.190235), (3, 6, 2, 10, -0.124877, 0.0296483, 0.139239),
        (2, 1, 1, 14, -0.101475, 0.0225617, 0.231971), (3, 5, 6, 4, -0.0799915, -0.00729616, 0.063262),
        (1, 9, 2, 12, -0.272556, 0.019424, 0.302559), (3, 4, 2, 14, -0.164292, -0.0321188, 0.0846339),
    ];

    private static readonly float[] Window = MakeWindow();
    private static readonly (int Min, int Max, sbyte[] Notes) Chroma = MakeNotes();

    private readonly KissFft fft = new(FrameSize);
    private readonly short[] pending = new short[FrameSize * 2];
    private int pendingCount;
    private long fed;
    private readonly float[] frame = new float[FrameSize];
    private readonly double[] power = new double[FrameSize / 2 + 1];
    private readonly double[][] recent = [.. Enumerable.Range(0, 8).Select(_ => new double[Bands])];
    private int recentOffset, recentSize = 1;
    private readonly double[] image = new double[ImageRows * Bands];
    private int rows;
    private readonly List<uint> raw = [];

    /* The sub-fingerprints so far. */
    public IReadOnlyList<uint> Raw => raw;

    /* Whether the first 120 s have been fed: what comes after is not looked at. */
    public bool Full => fed >= (long)MaxSeconds * SampleRate;

    // PrepareHammingWindow, scaled to 1/32767.
    private static float[] MakeWindow()
    {
        var w = new float[FrameSize];
        for (var i = 0; i < FrameSize; i++) w[i] = (float)(1.0 / short.MaxValue * (0.54 - 0.46 * Math.Cos(i * 2.0 * Math.PI / (FrameSize - 1))));
        return w;
    }

    // Each spectrum bin's chroma band, from 28 Hz to 3520 Hz.
    private static (int, int, sbyte[]) MakeNotes()
    {
        static int Index(double freq) => (int)Math.Round(FrameSize * freq / SampleRate, MidpointRounding.AwayFromZero);
        int min = Math.Max(1, Index(28)), max = Math.Min(FrameSize / 2, Index(3520));
        var notes = new sbyte[FrameSize];
        for (var i = min; i < max; i++)
        {
            var freq = (double)i * SampleRate / FrameSize;
            var octave = Math.Log(freq / (440.0 / 16.0)) / Math.Log(2.0);
            notes[i] = (sbyte)(Bands * (octave - Math.Floor(octave)));
        }
        return (min, max, notes);
    }

    /* More audio, 11025 Hz mono; past the first 120 s, none of it is used. */
    public void Feed(ReadOnlySpan<short> samples)
    {
        var left = (long)MaxSeconds * SampleRate - fed;
        if (left <= 0) return;
        if (samples.Length > left) samples = samples[..(int)left];
        fed += samples.Length;
        while (samples.Length > 0)
        {
            var n = Math.Min(samples.Length, pending.Length - pendingCount);
            samples[..n].CopyTo(pending.AsSpan(pendingCount));
            pendingCount += n;
            samples = samples[n..];
            var at = 0;
            while (pendingCount - at >= FrameSize)
            {
                Frame(pending.AsSpan(at, FrameSize));
                at += Increment;
            }
            if (at > 0)
            {
                pending.AsSpan(at, pendingCount - at).CopyTo(pending);
                pendingCount -= at;
            }
        }
    }

    private void Frame(ReadOnlySpan<short> s)
    {
        for (var i = 0; i < FrameSize; i++) frame[i] = s[i] * Window[i];
        fft.Power(frame, power);
        var features = recent[recentOffset];
        Array.Clear(features);
        for (var i = Chroma.Min; i < Chroma.Max; i++) features[Chroma.Notes[i]] += power[i];
        // ChromaFilter: the last five frames, smoothed.
        recentOffset = (recentOffset + 1) % 8;
        if (recentSize < Smoothing.Length) { recentSize++; return; }
        var offset = (recentOffset + 8 - Smoothing.Length) % 8;
        var smoothed = new double[Bands];
        for (var i = 0; i < Bands; i++)
            for (var j = 0; j < Smoothing.Length; j++) smoothed[i] += recent[(offset + j) % 8][i] * Smoothing[j];
        // ChromaNormalizer: to unit length, or nothing under 0.01.
        double squares = 0;
        foreach (var v in smoothed) squares += v * v;
        var norm = squares > 0 ? Math.Sqrt(squares) : 0;
        for (var i = 0; i < Bands; i++) smoothed[i] = norm < 0.01 ? 0.0 : smoothed[i] / norm;
        AddRow(smoothed);
        if (rows >= FilterWidth) raw.Add(Subfingerprint(rows - FilterWidth));
    }

    private Span<double> Row(int r) => image.AsSpan(r % ImageRows * Bands, Bands);

    private void AddRow(double[] features)
    {
        var row = Row(rows);
        double sum = 0;
        for (var i = 0; i < Bands; i++) { sum += features[i]; row[i] = sum; }
        if (rows > 0)
        {
            var last = Row(rows - 1);
            for (var i = 0; i < Bands; i++) row[i] = last[i] + row[i];
        }
        rows++;
    }

    // RollingIntegralImage::Area: rows (time) r1..r2, columns (bands) c1..c2.
    private double Area(int r1, int c1, int r2, int c2)
    {
        if (r1 == r2 || c1 == c2) return 0.0;
        if (r1 == 0)
        {
            var row = Row(r2 - 1);
            return c1 == 0 ? row[c2 - 1] : row[c2 - 1] - row[c1 - 1];
        }
        var row1 = Row(r1 - 1);
        var row2 = Row(r2 - 1);
        return c1 == 0 ? row2[c2 - 1] - row1[c2 - 1] : row2[c2 - 1] - row1[c2 - 1] - row2[c1 - 1] + row1[c1 - 1];
    }

    private static double SubtractLog(double a, double b) => Math.Log((1.0 + a) / (1.0 + b));

    // Filter0 … Filter5 at time [x]: y and h across the bands, w along the time.
    private double Filter(int type, int x, int y, int h, int w)
    {
        switch (type)
        {
            case 0: return SubtractLog(Area(x, y, x + w, y + h), 0);
            case 1: { var h2 = h / 2; return SubtractLog(Area(x, y + h2, x + w, y + h), Area(x, y, x + w, y + h2)); }
            case 2: { var w2 = w / 2; return SubtractLog(Area(x + w2, y, x + w, y + h), Area(x, y, x + w2, y + h)); }
            case 3:
                {
                    int w2 = w / 2, h2 = h / 2;
                    return SubtractLog(Area(x, y + h2, x + w2, y + h) + Area(x + w2, y, x + w, y + h2),
                        Area(x, y, x + w2, y + h2) + Area(x + w2, y + h2, x + w, y + h));
                }
            case 4:
                {
                    var h3 = h / 3;
                    return SubtractLog(Area(x, y + h3, x + w, y + 2 * h3), Area(x, y, x + w, y + h3) + Area(x, y + 2 * h3, x + w, y + h));
                }
            default:
                {
                    var w3 = w / 3;
                    return SubtractLog(Area(x + w3, y, x + 2 * w3, y + h), Area(x, y, x + w3, y + h) + Area(x + 2 * w3, y, x + w, y + h));
                }
        }
    }

    private static readonly uint[] Gray = [0, 1, 3, 2];

    private uint Subfingerprint(int x)
    {
        uint bits = 0;
        foreach (var c in Classifiers)
        {
            var v = Filter(c.Type, x, c.Y, c.H, c.W);
            var q = v < c.T1 ? (v < c.T0 ? 0 : 1) : (v < c.T2 ? 2 : 3);
            bits = (bits << 2) | Gray[q];
        }
        return bits;
    }

    // ------------------------------------------------------------ the string AcoustID takes

    /* [raw] compressed and in base64, as chromaprint_get_fingerprint gives it. */
    public static string Encode(IReadOnlyList<uint> raw)
    {
        var normal = new List<int>(raw.Count);
        var exceptional = new List<int>();
        for (var i = 0; i < raw.Count; i++)
        {
            var x = i == 0 ? raw[0] : raw[i] ^ raw[i - 1];
            int bit = 1, last = 0;
            for (; x != 0; x >>= 1, bit++)
            {
                if ((x & 1) == 0) continue;
                var gap = bit - last;
                if (gap >= 7) { normal.Add(7); exceptional.Add(gap - 7); }
                else normal.Add(gap);
                last = bit;
            }
            normal.Add(0);
        }
        var bytes = new List<byte> { Algorithm, (byte)(raw.Count >> 16 & 255), (byte)(raw.Count >> 8 & 255), (byte)(raw.Count & 255) };
        Pack(normal, 3, bytes);
        Pack(exceptional, 5, bytes);
        return Base64([.. bytes]);
    }

    // PackInt3Array, PackInt5Array: each value's [bits] low bits, least significant first.
    private static void Pack(List<int> values, int bits, List<byte> into)
    {
        int acc = 0, n = 0;
        foreach (var v in values)
        {
            acc |= (v & ((1 << bits) - 1)) << n;
            n += bits;
            while (n >= 8) { into.Add((byte)(acc & 255)); acc >>= 8; n -= 8; }
        }
        if (n > 0) into.Add((byte)(acc & 255));
    }

    private const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    private static string Base64(byte[] b)
    {
        var sb = new StringBuilder((b.Length * 4 + 2) / 3);
        var i = 0;
        for (; i + 3 <= b.Length; i += 3)
        {
            sb.Append(Alphabet[b[i] >> 2]).Append(Alphabet[((b[i] << 4) | (b[i + 1] >> 4)) & 63])
              .Append(Alphabet[((b[i + 1] << 2) | (b[i + 2] >> 6)) & 63]).Append(Alphabet[b[i + 2] & 63]);
        }
        if (b.Length - i == 2) sb.Append(Alphabet[b[i] >> 2]).Append(Alphabet[((b[i] << 4) | (b[i + 1] >> 4)) & 63]).Append(Alphabet[(b[i + 1] << 2) & 63]);
        else if (b.Length - i == 1) sb.Append(Alphabet[b[i] >> 2]).Append(Alphabet[(b[i] << 4) & 63]);
        return sb.ToString();
    }

    /* The fingerprint of [samples] (11025 Hz mono, the first 120 s of them used). */
    public static string Of(ReadOnlySpan<short> samples)
    {
        var c = new Chromaprint();
        c.Feed(samples);
        return Encode(c.Raw);
    }
}
