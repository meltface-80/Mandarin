using System.Globalization;

namespace Mandarin.Tests;

/// <summary>
/// Signals that carry MQA's signalling as the open identifiers read it (bug list item 418; the server's
/// Mqa/MqaDetect.cs), made here, since real MQA audio can't be shipped: a 997 Hz tone at half scale, dithered, on both
/// channels alike but for one bit, which carries a stream: zeros, then the sync word (0xbe0498c88, 36 bits, the first
/// the highest), then 33 frames: frames 3 to 6 the original rate's 4-bit code, frames 29 to 33 the provenance
/// (5 bits; above 8, MQA Studio), the rest random. The bit is the 16-bit word's lowest (bit 8 of a 24-bit sample, bit
/// 0 of a 16-bit one) or, for a near miss, one the identifiers don't look at.
/// </summary>
public static class MqaSignals
{
    /// <summary>MQA's sync word.</summary>
    public const ulong Sync = 0xbe0498c88;

    /// <summary>What a signal carries.</summary>
    /// <param name="Rate">The file's rate.</param>
    /// <param name="Bits">16 or 24.</param>
    /// <param name="Code">The original rate's 4-bit code; -1 for none (a plain signal: the channels differ at random).</param>
    /// <param name="Provenance">5 bits: above 8, MQA Studio.</param>
    /// <param name="SyncAt">Seconds in where the sync word begins.</param>
    /// <param name="Seconds">Its length.</param>
    /// <param name="Shift">Bits above the 16-bit word's lowest the stream is carried at (3: past the identifiers' three).</param>
    /// <param name="Flip">A bit of the sync word flipped (its index from the first), or -1.</param>
    public sealed record Spec(int Rate, int Bits, int Code, int Provenance, double SyncAt = 0.5, double Seconds = 4, int Shift = 0, int Flip = -1);

    /// <summary>The 4-bit code of an original rate (the identifiers' decoding, inverted).</summary>
    public static int CodeOf(int rate)
    {
        for (var c = 0; c < 16; c++)
        {
            var family = (c & 1) != 0 ? 48000 : 44100;
            var power = ((c >> 3) & 1) | (((c >> 2) & 1) << 1) | (((c >> 1) & 1) << 2);
            var times = 1 << power;
            if (times > 16) times *= 2;
            if (family * times == rate) return c;
        }
        throw new ArgumentException("no code for " + rate.ToString(CultureInfo.InvariantCulture));
    }

    /// <summary>Interleaved stereo samples, each in its own depth (not left-justified).</summary>
    public static int[] Samples(Spec s)
    {
        var frames = (int)(s.Rate * s.Seconds);
        var rng = new Random(s.Rate + s.Bits + s.Code * 7 + s.Shift * 31 + s.Flip);
        var full = (1 << (s.Bits - 1)) - 1;
        var lowest = s.Bits - 16 + s.Shift;
        var stream = new byte[frames];
        if (s.Code >= 0)
        {
            var start = (int)(s.SyncAt * s.Rate);
            for (var i = 0; i < 36; i++) stream[start + i] = (byte)((Sync >> (35 - i)) & 1);
            if (s.Flip >= 0) stream[start + s.Flip] ^= 1;
            var end = start + 35;
            for (var k = 1; k <= 33; k++)
                stream[end + k] = k is >= 3 and <= 6 ? (byte)((s.Code >> (6 - k)) & 1)
                    : k is >= 29 ? (byte)((s.Provenance >> (33 - k)) & 1) : (byte)rng.Next(2);
        }
        var o = new int[frames * 2];
        for (var n = 0; n < frames; n++)
        {
            var l = (int)Math.Round(Math.Sin(2 * Math.PI * 997 * n / s.Rate) * full / 2) + rng.Next(-3, 4);
            o[2 * n] = l;
            // A plain signal: the right channel dithered on its own; MQA's: the left's but for the stream's bit.
            o[2 * n + 1] = s.Code < 0 ? (int)Math.Round(Math.Sin(2 * Math.PI * 997 * n / s.Rate) * full / 2) + rng.Next(-3, 4) : l ^ (stream[n] << lowest);
        }
        return o;
    }

    /// <summary>The signal as a WAV file (PCM, its depth).</summary>
    public static void WriteWav(string file, Spec s)
    {
        var x = Samples(s);
        var bytes = s.Bits / 8;
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        using var w = new BinaryWriter(File.Create(file));
        w.Write("RIFF"u8); w.Write(36 + x.Length * bytes); w.Write("WAVE"u8);
        w.Write("fmt "u8); w.Write(16); w.Write((short)1); w.Write((short)2); w.Write(s.Rate); w.Write(s.Rate * 2 * bytes); w.Write((short)(2 * bytes)); w.Write((short)s.Bits);
        w.Write("data"u8); w.Write(x.Length * bytes);
        foreach (var v in x)
        {
            w.Write((byte)(v & 0xFF)); w.Write((byte)((v >> 8) & 0xFF));
            if (bytes == 3) w.Write((byte)((v >> 16) & 0xFF));
        }
    }

    /// <summary>The signal as a FLAC file, by way of its WAV (ffmpeg's FLAC: the same samples), with [tags].</summary>
    public static void WriteFlac(string file, Spec s, IDictionary<string, string>? tags = null)
    {
        var wav = file + ".wav";
        WriteWav(wav, s);
        var args = new List<string> { "-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-c:a", "flac" };
        foreach (var (k, v) in tags ?? new Dictionary<string, string>()) args.AddRange(["-metadata", k + "=" + v]);
        args.Add(file);
        var r = Fixtures.Run(args);
        File.Delete(wav);
        if (r.Code != 0) throw new InvalidOperationException("ffmpeg: " + r.Err);
    }

    /// <summary>
    /// The open identifier's own logic (MQA-identifier-python's MqaIdentifier.detect, the C++ tool's detect before 2026),
    /// as it is written there, over [s32] (interleaved stereo, left-justified 32-bit words): MQA, Studio, the original
    /// rate; read for [frames] frames at most.
    /// </summary>
    public static (bool Mqa, bool Studio, int Rate) Reference(int[] s32, long frames)
    {
        var buffer = new Dictionary<int, long> { [16] = 0, [17] = 0, [18] = 0 };
        var n = Math.Min(s32.Length / 2, frames);
        for (var i = 0; i < n; i++)
        {
            foreach (var key in buffer.Keys.ToList()) buffer[key] |= ((long)(s32[2 * i] ^ s32[2 * i + 1]) >> key) & 1;
            var pos = buffer.FirstOrDefault(kv => kv.Value == (long)Sync).Key;
            if (pos != 0)
            {
                long Bit(int k) => ((long)(s32[2 * (i + k)] ^ s32[2 * (i + k) + 1]) >> pos) & 1;
                var org = 0L;
                for (var k = 3; k < 7; k++) org |= Bit(k) << (6 - k);
                var c = (int)org;
                var baseRate = (c & 1) == 1 ? 48000 : 44100;
                var multiplier = 1 << (((c >> 3) & 1) | (((c >> 2) & 1) << 1) | (((c >> 1) & 1) << 2));
                var provenance = 0L;
                for (var k = 29; k < 34; k++) provenance |= Bit(k) << (33 - k);
                return (true, provenance > 8, baseRate * multiplier);
            }
            foreach (var key in buffer.Keys.ToList()) buffer[key] = (buffer[key] << 1) & 0xFFFFFFFFFL;
        }
        return (false, false, 0);
    }
}
