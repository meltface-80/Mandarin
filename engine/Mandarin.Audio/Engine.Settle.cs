// Engine.Settle.cs — the DAC let settle at a change of format (item 322). Where one track goes on into another of a
// different format (16/44.1 then 24/96, PCM then DSD), the device is reopened at the new one and given silence first,
// SettleMs of it (500 by default, --settle-ms; 0 none), so the DAC locks to the new rate on nothing and the music's
// first moment is heard whole, with no click or pop as it locks. Silence as the format has it: zeros for PCM, DSD's
// idle pattern (0x69) for native DSD, and DoP's under its alternating markers, an even number of frames so that they
// alternate on into the music's first. Tracks of the same format follow one another with nothing between them, as
// ever. Here too, the gain's scaling, the playback thread's.
namespace Mandarin.Audio;

internal sealed partial class Engine
{
    /* The silence a change of format is given, in milliseconds. */
    public int SettleMs { get; init; } = 500;

    private const byte DopA = 0x05, DopB = 0xFA, DsdIdle = 0x69;

    // Silence written to the device, just opened at [mark]'s format, ahead of [first], the music's first frame.
    private unsafe void Settle(Mark mark, byte* first)
    {
        if (SettleMs <= 0) return;
        int frameBytes = 4 * mark.Channels;
        long left = (long)mark.Rate * SettleMs / 1000;
        if (mark.Fmt == OutFormat.Dop) left &= ~1L;
        const int chunk = 4096;   // frames, even
        var buf = GC.AllocateArray<byte>(chunk * frameBytes, pinned: true);
        if (mark.Fmt is OutFormat.DsdU32Be or OutFormat.DsdU32Le) buf.AsSpan().Fill(DsdIdle);
        else if (mark.Fmt == OutFormat.Dop)
        {
            // The music's first marker on the first frame of silence: the last of it then carries the other one.
            byte m = first[3] == DopB ? DopB : DopA, other = m == DopA ? DopB : DopA;
            for (int i = 0; i < chunk; i++)
                for (int c = 0; c < mark.Channels; c++)
                {
                    int o = (i * mark.Channels + c) * 4;
                    buf[o] = 0; buf[o + 1] = DsdIdle; buf[o + 2] = DsdIdle; buf[o + 3] = i % 2 == 0 ? m : other;
                }
        }
        fixed (byte* p = buf)
        {
            while (left > 0)
            {
                int n = (int)Math.Min(chunk, left), done = 0;
                while (done < n) done += sink.Write(p + (long)done * frameBytes, n - done);
                left -= n;
            }
        }
        log($"the device given {SettleMs} ms of silence at its new format ({mark.Rate} Hz), to settle");
    }

    // Scaled below 1, rounded half up (as Math.round in the page's player).
    private static unsafe void Scale(byte* p, int bytes, float g)
    {
        int* s = (int*)p;
        int n = bytes / 4;
        double gd = g;
        for (int i = 0; i < n; i++) s[i] = (int)Math.Floor(s[i] * gd + 0.5);
    }
}
