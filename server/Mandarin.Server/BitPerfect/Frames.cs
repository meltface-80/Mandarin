// Frames.cs — audio as the bit-perfect check compares it (bug list item 275): what was sent and what reached the DAC,
// each a run of stereo frames, read from its file where it lies (memory-mapped: a whole track at 768 kHz is gigabytes).
//
// PCM is each channel's sample as a left-justified 32-bit word, so that a 16-bit track in a DAC's 32-bit slot reads
// as the same numbers as the file (SQ-tool compares so). DSD is each channel's bits in the order they are played,
// sixteen to a frame (the DoP frame's two bytes; a native word is two frames, a DSF's bytes taken two at a time and
// turned round, a DSF writing each byte's earliest bit lowest). A frame is the two channels' words, left high.
using System.IO.MemoryMappedFiles;

namespace Mandarin.Server.BitPerfect;

internal abstract class Frames : IDisposable
{
    private readonly MemoryMappedFile map;
    protected readonly MemoryMappedViewAccessor View;
    protected readonly long Data;

    /* The frames there are. */
    public long Count { get; protected init; }

    /* Frames a second: the PCM rate, or for DSD its rate over 16. */
    public double Rate { get; protected init; }

    /* Whether it is DSD (else PCM). */
    public bool Dsd { get; protected init; }

    protected Frames(string path, long data)
    {
        Data = data;
        var length = new FileInfo(path).Length;
        map = MemoryMappedFile.CreateFromFile(path, FileMode.Open, null, 0, MemoryMappedFileAccess.Read);
        View = map.CreateViewAccessor(0, length, MemoryMappedFileAccess.Read);
        Bytes = length;
    }

    protected long Bytes { get; }

    /* Frame [i]: its left word in the high 32 bits, its right in the low. */
    public abstract ulong this[long i] { get; }

    /* Whether frame [f] is silence: PCM's zero, or DSD's idle pattern (0x69, as many ones as zeros), or nothing at all. */
    public bool Quiet(ulong f) => f == 0 || Dsd && (f == 0x6969_0000_6969_0000UL || f == 0x9696_0000_9696_0000UL);

    public void Dispose()
    {
        View.Dispose();
        map.Dispose();
    }

    protected static ulong Pair(uint l, uint r) => (ulong)l << 32 | r;

    // A byte with its bits turned round: a DSF's earliest bit is its lowest.
    protected static byte Turned(byte b)
    {
        b = (byte)((b & 0xF0) >> 4 | (b & 0x0F) << 4);
        b = (byte)((b & 0xCC) >> 2 | (b & 0x33) << 2);
        return (byte)((b & 0xAA) >> 1 | (b & 0x55) << 1);
    }
}

/* Interleaved little-endian PCM: [width] bytes a sample ([width] 2, 3 or 4), two channels, from byte [data]. */
internal sealed class PcmFrames : Frames
{
    private readonly int width;

    public PcmFrames(string path, long data, int width, double rate, long frames = -1) : base(path, data)
    {
        this.width = width;
        Rate = rate;
        Count = Math.Min(frames < 0 ? long.MaxValue : frames, (Bytes - data) / (2L * width));
    }

    public override ulong this[long i] => Pair(Word(Data + i * 2 * width), Word(Data + i * 2 * width + width));

    private uint Word(long at) => width switch
    {
        2 => (uint)View.ReadUInt16(at) << 16,
        3 => (uint)(View.ReadByte(at) | View.ReadByte(at + 1) << 8 | View.ReadByte(at + 2) << 16) << 8,
        _ => View.ReadUInt32(at),
    };
}

/* A DSF's bits: its blocks of 4096 bytes a channel, one channel's then the other's, from byte 92 (DsfWriter.cs's layout, any DSF's). */
internal sealed class DsfFrames : Frames
{
    private const int Block = 4096;

    public DsfFrames(string path, double dsdRate, long samples = -1) : base(path, 92)
    {
        Dsd = true;
        Rate = dsdRate / 16;
        var bytes = (Bytes - Data) / 2;
        if (samples >= 0) bytes = Math.Min(bytes, samples / 8);
        Count = bytes / 2;
    }

    public override ulong this[long i] => Pair(Unit(0, i), Unit(1, i));

    private uint Unit(int ch, long i) => (uint)(Byte(ch, 2 * i) << 8 | Byte(ch, 2 * i + 1)) << 16;

    private byte Byte(int ch, long k) => Turned(View.ReadByte(Data + k / Block * 2 * Block + ch * Block + k % Block));
}

/* DSD in a capture: DoP's PCM frames (the two DSD bytes under each marker), or native words of [width] bytes, big- or little-endian. */
internal sealed class CapturedDsdFrames : Frames
{
    private readonly int width;
    private readonly bool dop, little;

    public CapturedDsdFrames(string path, long data, int width, double wavRate, bool dop, bool little) : base(path, data)
    {
        (this.width, this.dop, this.little) = (width, dop, little);
        Dsd = true;
        var frames = (Bytes - data) / (2L * width);
        // DoP: one unit a frame, the rate the DSD's over 16; native: [width] bytes a channel each frame, width / 2 units.
        Count = dop ? frames : frames * width / 2;
        Rate = dop ? wavRate : wavRate * width / 2;
    }

    public override ulong this[long i] => Pair(Unit(0, i), Unit(1, i));

    private uint Unit(int ch, long i)
    {
        if (dop)
        {
            // The sample's top byte is the marker (0x05, 0xFA), then the earlier DSD byte, then the later.
            var at = Data + i * 2 * width + ch * width + (width - 3);
            return (uint)(View.ReadByte(at + 1) << 8 | View.ReadByte(at)) << 16;
        }
        return (uint)(Byte(ch, 2 * i) << 8 | Byte(ch, 2 * i + 1)) << 16;
    }

    // Channel [ch]'s [k]th byte in the order it is played: a big-endian word's first byte first, a little-endian's last.
    private byte Byte(int ch, long k)
    {
        var frame = k / width;
        var within = (int)(k % width);
        return View.ReadByte(Data + frame * 2 * width + ch * width + (little ? width - 1 - within : within));
    }
}
