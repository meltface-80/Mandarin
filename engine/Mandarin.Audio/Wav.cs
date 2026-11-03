// Wav.cs — the decoder's WAV header, read for the rate, the channels and where the samples start.
namespace Mandarin.Audio;

internal static class Wav
{
    internal sealed record Format(int Channels, int Rate, int Bits, int Start);

    // The decoder's WAV header: rate, channels, and where the samples start.
    public static Format? Parse(ReadOnlySpan<byte> b)
    {
        if (b.Length < 12) return null;
        if (!b[..4].SequenceEqual("RIFF"u8) || !b.Slice(8, 4).SequenceEqual("WAVE"u8)) throw new Exception("not WAV");
        int at = 12;
        Format? fmt = null;
        while (at + 8 <= b.Length)
        {
            var id = b.Slice(at, 4);
            uint size = BitConverter.ToUInt32(b.Slice(at + 4, 4));
            if (id.SequenceEqual("data"u8)) return fmt == null ? null : fmt with { Start = at + 8 };
            if (at + 8 + (long)size > b.Length) return null;
            if (id.SequenceEqual("fmt "u8))
                fmt = new Format(BitConverter.ToUInt16(b.Slice(at + 10, 2)), (int)BitConverter.ToUInt32(b.Slice(at + 12, 4)),
                    BitConverter.ToUInt16(b.Slice(at + 22, 2)), 0);
            at += 8 + (int)size + (int)(size & 1);
        }
        return null;
    }
}
