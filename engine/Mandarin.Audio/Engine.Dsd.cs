// Engine.Dsd.cs — a DSF (bug list item 256) or a DFF (item 284) played to the device as DSD: read here, not decoded by
// ffmpeg (which would make it PCM), and handed on as native DSD where the DAC takes it at that rate, else as DoP
// (Dsd.cs, Dff.cs).
using System.Net.Http;

namespace Mandarin.Audio;

internal sealed partial class Engine
{
    private static readonly HttpClient Http = new() { Timeout = Timeout.InfiniteTimeSpan };

    /* The DSD multiples the DAC takes natively (64 for DSD64), and the format it takes them in; DoP for any other. */
    public HashSet<int> NativeDsd { get; init; } = [];
    public OutFormat NativeFormat { get; init; } = OutFormat.Pcm;

    // The DoP marker the next frame carries, kept across blocks and tracks so that it goes on alternating.
    private bool dopMarker;

    /* How the device is sent DSD at [dsdRate]: natively where it says it takes that rate (44.1 kHz's family), else DoP (48 kHz's always: item 261). */
    public OutFormat DsdFormat(int dsdRate) => NativeFormat != OutFormat.Pcm && dsdRate % 44100 == 0 && NativeDsd.Contains(dsdRate / 44100) ? NativeFormat : OutFormat.Dop;

    // One DSF or DFF into the buffer from [offset] s: true when read to the end.
    private bool DecodeDsd(int gen, string uri, double offset) => Dsd.IsDff(uri) ? DecodeDff(gen, uri, offset) : DecodeDsf(gen, uri, offset);

    // One DFF into the buffer from [offset] s, as a DSF is: true when read to the end.
    private bool DecodeDff(int gen, string uri, double offset)
    {
        using var input = OpenDsf(uri);
        var dff = Dff.ReadHeader(input);
        var fmt = DsdFormat(dff.Rate);
        long perChannel = dff.Bytes / dff.Channels;
        // A seek: from the whole word it falls in (4 bytes a channel, a frame sent either way).
        long start = Math.Clamp((long)(offset * dff.Rate / 8) / 4 * 4, 0, perChannel / 4 * 4);
        Skip(input, start * dff.Channels);
        lock (gate)
        {
            if (gen != generation) return false;
            marks.Add(new Mark(writeBytes, uri, (double)start * 8 / dff.Rate, Dsd.FrameRate(dff.Rate, fmt), dff.Channels, fmt));
            Monitor.PulseAll(gate);
        }
        const int block = 4096;
        var buf = new byte[block * dff.Channels];
        var frames = new byte[block / Dsd.BytesPerFrame(fmt) * 4 * dff.Channels];
        // Only the DSD chunk's own bytes: a chunk after it (ID3) is never played.
        long left = (perChannel - start) * dff.Channels;
        while (left > 0)
        {
            int want = (int)Math.Min(buf.Length, left);
            int filled = 0;
            while (filled < want)
            {
                int n = input.Read(buf, filled, want - filled);
                if (n <= 0) break;
                filled += n;
            }
            left -= filled;
            int bytes = Dsd.Pack(fmt, buf, dff.Channels, block, filled / dff.Channels, frames, ref dopMarker, interleaved: true);
            if (Put(gen, frames.AsSpan(0, bytes)) < 0) return false;
            if (filled < want) break;
        }
        return true;
    }

    // One DSF into the buffer from [offset] s: true when read to the end.
    private bool DecodeDsf(int gen, string uri, double offset)
    {
        using var input = OpenDsf(uri);
        var head = new byte[4096];
        int got = 0;
        Dsd.Dsf? dsf = null;
        while (dsf == null && got < head.Length)
        {
            int n = input.Read(head, got, head.Length - got);
            if (n <= 0) break;
            got += n;
            dsf = Dsd.Parse(head.AsSpan(0, got));
        }
        if (dsf == null) throw new Exception("the DSD file can't be read: not a DSF");
        var fmt = DsdFormat(dsf.Rate);
        long perChannel = (dsf.Samples + 7) / 8;
        long groups = (perChannel + dsf.Block - 1) / dsf.Block;
        // A seek: from the block group it falls in.
        long start = Math.Clamp((long)(offset * dsf.Rate / 8 / dsf.Block), 0, Math.Max(0, groups - 1));
        int group = dsf.Block * dsf.Channels;
        long skip = dsf.DataStart + start * group;
        // What came with the header first, then the rest of the way there.
        var pending = new MemoryStream();
        if (got > skip) pending.Write(head, (int)skip, got - (int)skip);
        else Skip(input, skip - got);
        lock (gate)
        {
            if (gen != generation) return false;
            marks.Add(new Mark(writeBytes, uri, (double)start * dsf.Block * 8 / dsf.Rate, Dsd.FrameRate(dsf.Rate, fmt), dsf.Channels, fmt));
            Monitor.PulseAll(gate);
        }
        var buf = new byte[group];
        var frames = new byte[dsf.Block / Dsd.BytesPerFrame(fmt) * 4 * dsf.Channels];
        pending.Position = 0;
        for (long g = start; g < groups; g++)
        {
            int filled = pending.Read(buf, 0, group);
            while (filled < group)
            {
                int n = input.Read(buf, filled, group - filled);
                if (n <= 0) break;
                filled += n;
            }
            if (filled < group) Array.Clear(buf, filled, group - filled);
            // The last block of each channel holds only what is left of the track.
            int valid = (int)Math.Min(dsf.Block, perChannel - g * dsf.Block);
            int bytes = Dsd.Pack(fmt, buf, dsf.Channels, dsf.Block, valid, frames, ref dopMarker);
            if (Put(gen, frames.AsSpan(0, bytes)) < 0) return false;
            if (filled < group) break;
        }
        return true;
    }

    // The DSF or DFF at [uri]: the server's stream (http) or a file here.
    private static Stream OpenDsf(string uri) =>
        uri.StartsWith("http://", StringComparison.Ordinal) || uri.StartsWith("https://", StringComparison.Ordinal)
            ? Http.GetStreamAsync(uri).GetAwaiter().GetResult()
            : new FileStream(uri.StartsWith("file://", StringComparison.Ordinal) ? new Uri(uri).LocalPath : uri, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16);

    // [n] bytes of [s] read and let go (a stream that can't seek).
    private static void Skip(Stream s, long n)
    {
        if (s.CanSeek) { s.Seek(n, SeekOrigin.Current); return; }
        var b = new byte[1 << 16];
        while (n > 0)
        {
            int r = s.Read(b, 0, (int)Math.Min(b.Length, n));
            if (r <= 0) return;
            n -= r;
        }
    }
}
