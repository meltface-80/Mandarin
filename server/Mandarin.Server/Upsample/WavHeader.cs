// WavHeader.cs — a WAV's length said in its header (bug list item 270).
//
// PCM above FLAC's rates goes as WAV (×16 to 705.6 kHz: Playback/HighRates.cs), written by ffmpeg with -seekable 0 so
// that a device can read it as it is made: and so its header said 4 GB of data, the RIFF's and the data chunk's sizes
// left at 0xFFFFFFFF, even once the file was whole. A renderer (the FiiO SR11) told every track was 17 minutes long
// didn't know where one ended, and waited at the end of each before going on to the next: no gapless album at ×16.
//
// Now a WAV made as it plays (Upsample/MadeAsPlayed.cs) is written by the making itself, behind a header that says
// its length, known before its first byte from the track's (as a DSF's is: item 262), and sent with it; and a WAV
// ffmpeg makes has its header's sizes put right once it is whole, for the next track and every play after.
// A file over 4 GB (a track of 17 minutes and more at 24/705.6) says 0xFFFFFFFF, as before: no size fits.
using System.Buffers.Binary;

namespace Mandarin.Server.Upsample;

internal static class WavHeader
{
    /* The header's length: RIFF (12), fmt as WAVE_FORMAT_EXTENSIBLE as ffmpeg writes deeper than 16 bits (8 + 40), data (8). */
    public const int Size = 68;

    private static readonly byte[] PcmGuid = [1, 0, 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xAA, 0, 0x38, 0x9B, 0x71];

    /* The header of a stereo WAV at [rate] Hz, [bits] a sample, holding [dataBytes] of samples. */
    public static byte[] For(int rate, int bits, long dataBytes)
    {
        var bytes = bits / 8;
        var b = new byte[Size];
        var s = b.AsSpan();
        "RIFF"u8.CopyTo(s);
        BinaryPrimitives.WriteUInt32LittleEndian(s[4..], Fit(dataBytes + Size - 8));
        "WAVE"u8.CopyTo(s[8..]);
        "fmt "u8.CopyTo(s[12..]);
        BinaryPrimitives.WriteUInt32LittleEndian(s[16..], 40);
        BinaryPrimitives.WriteUInt16LittleEndian(s[20..], 0xFFFE);
        BinaryPrimitives.WriteUInt16LittleEndian(s[22..], 2);
        BinaryPrimitives.WriteUInt32LittleEndian(s[24..], (uint)rate);
        BinaryPrimitives.WriteUInt32LittleEndian(s[28..], (uint)(rate * 2 * bytes));
        BinaryPrimitives.WriteUInt16LittleEndian(s[32..], (ushort)(2 * bytes));
        BinaryPrimitives.WriteUInt16LittleEndian(s[34..], (ushort)(bytes * 8));
        BinaryPrimitives.WriteUInt16LittleEndian(s[36..], 22);
        BinaryPrimitives.WriteUInt16LittleEndian(s[38..], (ushort)bits);
        BinaryPrimitives.WriteUInt32LittleEndian(s[40..], 3);       // front left, front right
        PcmGuid.CopyTo(s[44..]);
        "data"u8.CopyTo(s[60..]);
        BinaryPrimitives.WriteUInt32LittleEndian(s[64..], Fit(dataBytes));
        return b;
    }

    /* The file's length for track [p] made as it plays, [seconds] long: its frames as its making is held to (Joins.Frames), upsampled. */
    public static long FileBytes(ConvPlan p, double seconds)
    {
        var own = (long)p.InRate;
        if (own <= 0 || seconds <= 0) return -1;
        return Size + Joins.Frames(seconds, own) * (p.Rate / own) * 2 * (p.Bits / 8);
    }

    /* A whole WAV at [path] (ffmpeg's, its sizes left open): the RIFF's and the data chunk's sizes put right. */
    public static void Patch(string path)
    {
        try
        {
            using var f = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.Read);
            var head = new byte[(int)Math.Min(f.Length, 4096)];
            f.ReadExactly(head);
            if (head.Length < 12 || !head.AsSpan(0, 4).SequenceEqual("RIFF"u8) || !head.AsSpan(8, 4).SequenceEqual("WAVE"u8)) return;
            for (var at = 12; at + 8 <= head.Length;)
            {
                var size = BinaryPrimitives.ReadUInt32LittleEndian(head.AsSpan(at + 4));
                if (head.AsSpan(at, 4).SequenceEqual("data"u8))
                {
                    Write(f, 4, Fit(f.Length - 8));
                    Write(f, at + 4, Fit(f.Length - at - 8));
                    return;
                }
                at += 8 + (int)Math.Min(size + (size & 1), int.MaxValue - 16);
            }
        }
        catch (IOException) { /* gone, or not ours to change: as it was */ }
    }

    private static void Write(FileStream f, long at, uint v)
    {
        var b = new byte[4];
        BinaryPrimitives.WriteUInt32LittleEndian(b, v);
        f.Position = at;
        f.Write(b);
    }

    // A size as a 32-bit field: over 4 GB, 0xFFFFFFFF (unknown).
    private static uint Fit(long n) => n is >= 0 and < uint.MaxValue ? (uint)n : uint.MaxValue;
}
