// Dff.cs — a DFF (DSDIFF, item 284) read as a DSF is (Dsd.cs), never made PCM: its chunks walked in the order they come,
// so that the server's stream is read once from its start, up to its audio.
//
//   FRM8 "DSD "        the file: a 12-byte chunk head (its ID, then its size, 64 bits big-endian), then its form type
//     FVER, COMT, …    chunks of no use here, let go (each padded to an even size, the pad not in its size)
//     PROP "SND "      its facts: FS (the DSD rate, 32 bits), CHNL (the channels, 16 bits), CMPR ("DSD " or "DST ")
//     DSD              the audio: one byte of each channel in turn, each byte's first bit its most significant
//     DST              the audio DST-compressed, which the engine can't unpack: said, not played as noise
using System.Buffers.Binary;
using System.Text;

namespace Mandarin.Audio;

internal static class Dff
{
    /* A DFF's facts: its channels, DSD rate (2822400 for DSD64), and how many bytes its audio is, every channel's. */
    internal sealed record Info(int Channels, int Rate, long Bytes);

    private const string NotDff = "the DSD file can't be read: not a DFF";
    private const string Dst = "the DFF is DST-compressed, which can't be played as DSD";

    /* [s] read up to the first byte of its audio: its facts. A file that isn't a DFF, or is DST-compressed, said. */
    public static Info ReadHeader(Stream s)
    {
        var head = new byte[16];
        if (!Fill(s, head) || !head.AsSpan(0, 4).SequenceEqual("FRM8"u8) || !head.AsSpan(12, 4).SequenceEqual("DSD "u8)) throw new InvalidDataException(NotDff);
        int channels = 0, rate = 0;
        string compression = "DSD ";
        var chunk = new byte[12];
        for (;;)
        {
            if (!Fill(s, chunk)) throw new InvalidDataException("the DSD file can't be read: the DFF has no audio");
            var id = Encoding.ASCII.GetString(chunk, 0, 4);
            long size = BinaryPrimitives.ReadInt64BigEndian(chunk.AsSpan(4));
            if (size < 0) throw new InvalidDataException(NotDff);
            switch (id)
            {
                case "PROP":
                    if (size > 1 << 20) throw new InvalidDataException(NotDff);
                    var prop = new byte[size];
                    if (!Fill(s, prop)) throw new InvalidDataException(NotDff);
                    (channels, rate, compression) = Prop(prop, channels, rate, compression);
                    Discard(s, size & 1);
                    break;
                case "DST ":
                    throw new InvalidDataException(Dst);
                case "DSD ":
                    if (compression != "DSD ") throw new InvalidDataException(Dst);
                    if (channels is < 1 or > 8 || rate <= 0 || rate % 44100 != 0 && rate % 48000 != 0) throw new InvalidDataException(NotDff);
                    return new Info(channels, rate, size);
                default:
                    Discard(s, size + (size & 1));
                    break;
            }
        }
    }

    // The facts in a PROP chunk's body ("SND ", then its own chunks), over those known so far.
    private static (int Channels, int Rate, string Compression) Prop(byte[] p, int channels, int rate, string compression)
    {
        if (p.Length < 4 || !p.AsSpan(0, 4).SequenceEqual("SND "u8)) return (channels, rate, compression);
        long at = 4;
        while (at + 12 <= p.Length)
        {
            var id = Encoding.ASCII.GetString(p, (int)at, 4);
            long size = BinaryPrimitives.ReadInt64BigEndian(p.AsSpan((int)at + 4));
            long body = at + 12;
            if (size < 0 || body + size > p.Length) break;
            var b = p.AsSpan((int)body, (int)size);
            if (id == "FS  " && b.Length >= 4) rate = (int)BinaryPrimitives.ReadUInt32BigEndian(b);
            else if (id == "CHNL" && b.Length >= 2) channels = BinaryPrimitives.ReadUInt16BigEndian(b);
            else if (id == "CMPR" && b.Length >= 4) compression = Encoding.ASCII.GetString(b[..4]);
            at = body + size + (size & 1);
        }
        return (channels, rate, compression);
    }

    // [into] filled from [s]: false where it ends first.
    private static bool Fill(Stream s, byte[] into)
    {
        int got = 0;
        while (got < into.Length)
        {
            int n = s.Read(into, got, into.Length - got);
            if (n <= 0) return false;
            got += n;
        }
        return true;
    }

    // [n] bytes of [s] let go (the server's stream can't seek).
    private static void Discard(Stream s, long n)
    {
        if (n <= 0) return;
        if (s.CanSeek) { s.Seek(n, SeekOrigin.Current); return; }
        var b = new byte[(int)Math.Min(n, 1 << 16)];
        while (n > 0)
        {
            int r = s.Read(b, 0, (int)Math.Min(b.Length, n));
            if (r <= 0) return;
            n -= r;
        }
    }
}
