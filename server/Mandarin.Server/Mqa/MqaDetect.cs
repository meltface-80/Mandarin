// MqaDetect.cs — whether a track's samples carry MQA's signalling, and what it says (bug list item 418). Detection
// only: nothing here decodes or unfolds MQA, which is licensed and proprietary; a DAC that decodes MQA does that.
//
// The method is the open identifiers' (purpl3F0x's MQA_identifier, mqa_identifier.h, Apache 2.0, 2019; and its
// Python port, Dniel97's MQA-identifier-python), read and written again here, none of their code taken:
//   - the samples of a stereo 16- or 24-bit PCM stream, each left-justified in a 32-bit word (16-bit << 16, 24-bit
//     << 8: as ffmpeg's s32le gives them), left XOR right;
//   - of that, bit 16, 17 or 18 of the word (the 16-bit word's lowest bit and the two above it: the C++ tool's
//     bps − 16, + 1, + 2), each read as its own stream of one bit a frame, the newest bit lowest of a 36-bit register;
//   - MQA's sync word, 0xbe0498c88 (36 bits), in one of the three: the stream is MQA's;
//   - the frames after the one that completes it, counted from it: frames 3 to 6, the original sample rate's code
//     (4 bits, the first the highest; its lowest bit the family, 48 kHz's when set, 44.1's when not; bits 3, 2 and 1,
//     in that order, the power of two it is multiplied by, doubled again above ×16 for DSD); frames 29 to 33, the
//     provenance (5 bits, the first the highest): above 8, MQA Studio.
// The tools' later change (February 2026, reading the code from frames 4 to 7) is not followed: it reads a fifth bit
// it then drops, and moves the rate code a frame; the code as the tool read it for six years, and as its Python port
// reads it, is the one here.
namespace Mandarin.Server.Mqa;

/* What the signalling says: MQA or not, MQA Studio (its provenance), the original sample rate (Hz, 0: not read). */
internal sealed record MqaInfo(bool Mqa, bool Studio, int OriginalRate)
{
    public static readonly MqaInfo None = new(false, false, 0);
}

/* The detector, fed frames as they are decoded: Done once it has found the sync word and read what follows it. */
internal sealed class MqaDetect
{
    public const ulong SyncWord = 0xbe0498c88;
    private const ulong Mask = 0xFFFFFFFFF;   // 36 bits
    private const int Lowest = 16, Ways = 3, After = 33;

    private readonly ulong[] reg = new ulong[Ways];
    private readonly uint[] tail = new uint[After];   // left XOR right of the frames after the sync, once found
    private int found = -1, have;
    private long frames;

    public bool Done => found >= 0 && have == After;
    public long Frames => frames;
    /* The frame that completed the sync word (from the first fed), or -1. */
    public long SyncAt { get; private set; } = -1;

    /* Frames of interleaved stereo, left-justified 32-bit words. */
    public void Feed(ReadOnlySpan<int> stereo)
    {
        for (var i = 0; i + 1 < stereo.Length && !Done; i += 2)
        {
            var x = (uint)stereo[i] ^ (uint)stereo[i + 1];
            if (found >= 0) { tail[have++] = x; continue; }
            for (var w = 0; w < Ways; w++)
            {
                reg[w] = ((reg[w] << 1) | ((x >> (Lowest + w)) & 1u)) & Mask;
                if (reg[w] == SyncWord && found < 0) { found = w; SyncAt = frames; }
            }
            frames++;
        }
    }

    /* Bytes of s32le stereo (whole frames). */
    public void Feed(ReadOnlySpan<byte> s32le) => Feed(System.Runtime.InteropServices.MemoryMarshal.Cast<byte, int>(s32le[..(s32le.Length / 8 * 8)]));

    /* What was found: None until the sync word and the 33 frames after it have been seen. */
    public MqaInfo Result()
    {
        if (!Done) return MqaInfo.None;
        int Bit(int k) => (int)((tail[k - 1] >> (Lowest + found)) & 1u);
        var code = 0;
        for (var k = 3; k <= 6; k++) code = (code << 1) | Bit(k);
        var provenance = 0;
        for (var k = 29; k <= 33; k++) provenance = (provenance << 1) | Bit(k);
        return new MqaInfo(true, provenance > 8, Rate(code));
    }

    /* The original sample rate from its 4-bit code (the identifiers' OriginalSampleRateDecoder). */
    public static int Rate(int code)
    {
        var family = (code & 1) != 0 ? 48000 : 44100;
        var power = ((code >> 3) & 1) | (((code >> 2) & 1) << 1) | (((code >> 1) & 1) << 2);
        var times = 1 << power;
        if (times > 16) times *= 2;
        return family * times;
    }

    /* The 4-bit code of [rate] (Rate's inverse, for the tests' signals); -1 for a rate it can't say. */
    public static int Code(int rate)
    {
        for (var c = 0; c < 16; c++) if (Rate(c) == rate) return c;
        return -1;
    }
}
