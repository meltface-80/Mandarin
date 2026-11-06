// Engine.Raw.cs — Mandarin's continuous PCM (item 322) read by the engine itself, not by ffmpeg: the samples alone,
// their format on their address (RawPcm.cs), each widened to the 32-bit word the buffer holds as ffmpeg widens it
// (16 bits up by 16, 24 by 8, 32 as they are), so the DAC is given exactly what it would have been given, with no
// decoder to start and none to wait on (ffmpeg reads ahead to look at a stream it was told the format of, and a run
// Mandarin holds open while it waits to be told the next track gives it nothing more to look at). A read that waits
// lets go at once for a new play or a stop.
using System.Buffers.Binary;

namespace Mandarin.Audio;

internal sealed partial class Engine
{
    // A DSF, a DFF or a raw stream: read here, never made PCM or looked at by ffmpeg. True when read to the end.
    private bool DecodeHere(int gen, string uri, double offset) => RawPcm.Of(uri) is { } raw ? DecodeRaw(gen, uri, raw, offset) : DecodeDsd(gen, uri, offset);

    private bool DecodeRaw(int gen, string uri, (string Format, int Rate, int Channels, string Address) raw, double offset)
    {
        int width = raw.Format[1] == '1' ? 2 : raw.Format[1] == '2' ? 3 : 4;
        bool big = raw.Format.EndsWith("be", StringComparison.Ordinal);
        int inFrame = width * raw.Channels;
        using var cancel = new CancellationTokenSource();
        using var input = OpenDsf(raw.Address);
        if (offset > 0) Skip(input, (long)(offset * raw.Rate) * inFrame);
        lock (gate)
        {
            if (gen != generation) return false;
            marks.Add(new Mark(writeBytes, uri, offset, raw.Rate, raw.Channels));
            Monitor.PulseAll(gate);
        }
        const int block = 4096;   // frames
        var buf = new byte[block * inFrame];
        var words = new byte[block * raw.Channels * 4];
        int have = 0;
        long wrote = 0;
        for (;;)
        {
            int n;
            var read = input.ReadAsync(buf.AsMemory(have), cancel.Token).AsTask();
            try
            {
                while (!read.Wait(200))
                    lock (gate) if (gen != generation) { cancel.Cancel(); return false; }
                n = read.Result;
            }
            catch (AggregateException e)
            {
                if (wrote == 0) throw new Exception("couldn't play the track: " + (e.InnerException?.Message ?? e.Message));
                break;   // broken off part-way: what came plays out
            }
            if (n <= 0) break;
            have += n;
            int frames = have / inFrame;
            Widen(buf, frames * raw.Channels, width, big, words);
            if (Put(gen, words.AsSpan(0, frames * raw.Channels * 4)) < 0) return false;
            wrote += frames;
            int used = frames * inFrame;
            Buffer.BlockCopy(buf, used, buf, 0, have - used);
            have -= used;
        }
        return true;
    }

    // [samples] of [width] bytes each in [src] as 32-bit little-endian words, the sample in the top bits, into [dst].
    private static void Widen(byte[] src, int samples, int width, bool big, byte[] dst)
    {
        for (int i = 0; i < samples; i++)
        {
            int s = i * width;
            int v = width switch
            {
                2 => big ? (src[s] << 24) | (src[s + 1] << 16) : (src[s + 1] << 24) | (src[s] << 16),
                3 => big ? (src[s] << 24) | (src[s + 1] << 16) | (src[s + 2] << 8) : (src[s + 2] << 24) | (src[s + 1] << 16) | (src[s] << 8),
                _ => big ? BinaryPrimitives.ReadInt32BigEndian(src.AsSpan(s)) : BinaryPrimitives.ReadInt32LittleEndian(src.AsSpan(s)),
            };
            BinaryPrimitives.WriteInt32LittleEndian(dst.AsSpan(i * 4), v);
        }
    }
}
