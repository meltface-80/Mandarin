// DsfWriter.cs — DSD bits written as a DSF file (bug list item 242), the format DSD-capable streamers and DACs read.
//
// A DSF is three chunks: "DSD " (the file's size), "fmt " (the rate, the channels, the samples a channel, the block
// size) and "data": blocks of 4096 bytes, one channel's then the other's, each byte eight samples, the earliest in the
// least significant bit. The samples are known before the first is made (the track's frames times the factor), so
// the header is written first and the file can be read as it is written. A last block is filled out with DSD's
// silence (0x69: as many ones as zeros), which a player reads past the sample count in any case.
namespace Mandarin.Server.Upsample;

internal sealed class DsfWriter : IDisposable
{
    public const int Block = 4096;
    private const byte Silence = 0x69;

    private readonly Stream o;
    private readonly List<byte>[] ch = [[], []];

    /* The size in bytes of a stereo DSF of [samples] a channel: its header and its whole blocks. */
    public static long Size(long samples) => HeaderSize + (samples / 8 + Block - 1) / Block * Block * 2;

    /* The bytes before a DSF's first block: its header. */
    public const int HeaderSize = 28 + 52 + 12;

    /* A stereo DSF at [rate] Hz of [samples] a channel, to [o]; [header]: its header written first (not by a making restarted part way: item 272). */
    public DsfWriter(Stream o, int rate, long samples, bool header = true)
    {
        this.o = o;
        if (!header) return;
        var blocks = (samples / 8 + Block - 1) / Block;
        var data = blocks * Block * 2;
        using var w = new BinaryWriter(o, System.Text.Encoding.ASCII, leaveOpen: true);
        w.Write("DSD "u8); w.Write(28L); w.Write(28L + 52 + 12 + data); w.Write(0L);
        w.Write("fmt "u8); w.Write(52L); w.Write(1); w.Write(0); w.Write(2); w.Write(2); w.Write(rate); w.Write(1); w.Write(samples); w.Write(Block); w.Write(0);
        w.Write("data"u8); w.Write(12L + data);
    }

    /* Channel [c]'s next bytes. */
    public void Write(int c, ReadOnlySpan<byte> bytes)
    {
        ch[c].AddRange(bytes.ToArray());
        Flush(false);
    }

    // Whole blocks of both channels written; at the end, what is left filled out with silence.
    private void Flush(bool end)
    {
        while (ch[0].Count >= Block && ch[1].Count >= Block || end && (ch[0].Count > 0 || ch[1].Count > 0))
        {
            foreach (var l in ch)
            {
                var take = Math.Min(Block, l.Count);
                var b = new byte[Block];
                l.CopyTo(0, b, 0, take);
                for (var i = take; i < Block; i++) b[i] = Silence;
                l.RemoveRange(0, take);
                o.Write(b);
            }
        }
    }

    public void Dispose()
    {
        Flush(true);
        o.Flush();
    }
}
