// Dsd.cs — DSD to a USB DAC (bug list item 256): a DSF file read as it is, and its bits handed to the device in one of
// two ways, never made PCM on the way.
//
//   native   the DAC says it takes DSD itself (its USB descriptor, as the kernel lists it: "Format: DSD_U32_BE"): the
//            device opened in that format at the DSD rate over 32, each 32-bit word 32 of the track's bits in turn.
//   DoP      DSD over PCM (the DoP 1.1 standard): 24-bit PCM frames at the DSD rate over 16, each carrying 16 of the
//            track's bits under a marker byte, 0x05 and 0xFA in turn, which a DAC that knows DoP looks for and then
//            plays the bits as DSD. Sent as 32-bit samples (the bits in the top 24), as the engine sends all PCM.
//
// A DSF holds each channel in blocks of its own (4096 bytes a channel, one after another), the first bit of each byte
// its least significant; DoP and native DSD both want the first bit first (the most significant), so each byte is
// turned round. Nothing else is done to the bits: no volume, no filter.
namespace Mandarin.Audio;

/* How a track's samples go to the device. */
internal enum OutFormat { Pcm, Dop, DsdU32Be, DsdU32Le }

internal static class Dsd
{
    /* A DSF's facts: its channels, DSD rate (2822400 for DSD64), where the bits start, how many a channel, the block size. */
    internal sealed record Dsf(int Channels, int Rate, long DataStart, long Samples, int Block);

    /* The DoP markers, in turn, frame by frame. */
    public const byte MarkerA = 0x05, MarkerB = 0xFA;

    // Each byte turned round: the DSF's first bit (its least significant) first in the byte DoP and native DSD send.
    private static readonly byte[] Reversed = Enumerable.Range(0, 256).Select(b =>
    {
        int r = 0;
        for (int i = 0; i < 8; i++) if ((b & (1 << i)) != 0) r |= 0x80 >> i;
        return (byte)r;
    }).ToArray();

    /* Whether [uri] is a DSF, by its name (the server's streams say .dsf before any query). */
    public static bool IsDsf(string uri)
    {
        var path = uri.Split('?', 2)[0];
        return path.EndsWith(".dsf", StringComparison.OrdinalIgnoreCase);
    }

    /* The native format the engine is told a DAC takes ("DSD_U32_BE"), or Pcm where it isn't one it sends. */
    public static OutFormat NativeOf(string name) => name switch
    {
        "DSD_U32_BE" => OutFormat.DsdU32Be,
        "DSD_U32_LE" => OutFormat.DsdU32Le,
        _ => OutFormat.Pcm,
    };

    /* The ALSA name of [f]'s sample format. */
    public static string AlsaName(OutFormat f) => f switch { OutFormat.DsdU32Be => "DSD_U32_BE", OutFormat.DsdU32Le => "DSD_U32_LE", _ => "S32_LE" };

    /* The device's frame rate for DSD at [dsdRate] sent as [f]: over 16 for DoP, over 32 for native 32-bit words. */
    public static int FrameRate(int dsdRate, OutFormat f) => f == OutFormat.Dop ? dsdRate / 16 : dsdRate / 32;

    /* The track's bytes a channel in each frame sent as [f]. */
    public static int BytesPerFrame(OutFormat f) => f == OutFormat.Dop ? 2 : 4;

    /* A DSF's header ("DSD ", "fmt ", then "data"): its facts, or null where it isn't one. */
    public static Dsf? Parse(ReadOnlySpan<byte> b)
    {
        if (b.Length < 92 || !b[..4].SequenceEqual("DSD "u8) || !b.Slice(28, 4).SequenceEqual("fmt "u8)) return null;
        long fmtSize = BitConverter.ToInt64(b.Slice(32, 8));
        int channels = BitConverter.ToInt32(b.Slice(52, 4));
        int rate = BitConverter.ToInt32(b.Slice(56, 4));
        int bits = BitConverter.ToInt32(b.Slice(60, 4));
        long samples = BitConverter.ToInt64(b.Slice(64, 8));
        int block = BitConverter.ToInt32(b.Slice(72, 4));
        long data = 28 + fmtSize;
        if (bits != 1 || channels is < 1 or > 8 || rate % 44100 != 0 && rate % 48000 != 0 || block <= 0 || data + 12 > b.Length) return null;
        if (!b.Slice((int)data, 4).SequenceEqual("data"u8)) return null;
        return new Dsf(channels, rate, data + 12, samples, block);
    }

    /*
     * One block group of a DSF ([group]: each channel's [Block] bytes in turn) into the frames of [f] in [into]: the
     * first [valid] bytes of each channel's block, in whole frames. [marker]: the DoP marker the next frame carries,
     * kept from one call (and one track) to the next so that they go on alternating. The bytes written.
     */
    public static int Pack(OutFormat f, ReadOnlySpan<byte> group, int channels, int block, int valid, Span<byte> into, ref bool marker)
    {
        int per = BytesPerFrame(f);
        int frames = valid / per;
        int o = 0;
        for (int i = 0; i < frames; i++)
        {
            byte mk = marker ? MarkerB : MarkerA;
            for (int c = 0; c < channels; c++)
            {
                var src = group.Slice(c * block + i * per, per);
                switch (f)
                {
                    case OutFormat.Dop:
                        // A 32-bit little-endian sample: nothing, the second byte, the first, the marker on top.
                        into[o] = 0; into[o + 1] = Reversed[src[1]]; into[o + 2] = Reversed[src[0]]; into[o + 3] = mk;
                        break;
                    case OutFormat.DsdU32Be:
                        into[o] = Reversed[src[0]]; into[o + 1] = Reversed[src[1]]; into[o + 2] = Reversed[src[2]]; into[o + 3] = Reversed[src[3]];
                        break;
                    default:
                        into[o] = Reversed[src[3]]; into[o + 1] = Reversed[src[2]]; into[o + 2] = Reversed[src[1]]; into[o + 3] = Reversed[src[0]];
                        break;
                }
                o += 4;
            }
            if (f == OutFormat.Dop) marker = !marker;
        }
        return o;
    }
}
