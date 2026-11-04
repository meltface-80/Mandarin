// Recording.cs — a recording of what a DAC was fed, as the bit-perfect check reads it (bug list item 275): a WAV as
// SQ-tool writes a USB capture (WAVE_FORMAT_EXTENSIBLE, the container the DAC's slot, the samples as the DAC took
// them) beside its sidecar (.wav.json), whose "capture" says what it holds: PCM, DoP (DSD framed in PCM), or native
// DSD words, big-endian ("native") or little-endian ("native_le"). Mandarin Bridge writes them so (its /capture), and
// so does this server's own recording of a DAC on its USB bus.
using System.Buffers.Binary;
using System.Text.Json.Nodes;

namespace Mandarin.Server.BitPerfect;

internal static class Recording
{
    /* A WAV's format and where its samples are. */
    public sealed record Wav(int Channels, int Rate, int ContainerBits, long Data, long DataBytes);

    /* [path]'s header: null where it isn't a WAV this reads (PCM, or WAVE_FORMAT_EXTENSIBLE). */
    public static Wav? Header(string path)
    {
        using var f = File.OpenRead(path);
        var head = new byte[Math.Min(f.Length, 1 << 16)];
        f.ReadExactly(head);
        if (head.Length < 12 || !head.AsSpan(0, 4).SequenceEqual("RIFF"u8) || !head.AsSpan(8, 4).SequenceEqual("WAVE"u8)) return null;
        int channels = 0, rate = 0, bits = 0;
        for (var at = 12; at + 8 <= head.Length;)
        {
            var size = BinaryPrimitives.ReadUInt32LittleEndian(head.AsSpan(at + 4));
            var id = head.AsSpan(at, 4);
            if (id.SequenceEqual("fmt "u8) && at + 24 <= head.Length)
            {
                channels = BinaryPrimitives.ReadUInt16LittleEndian(head.AsSpan(at + 10));
                rate = (int)BinaryPrimitives.ReadUInt32LittleEndian(head.AsSpan(at + 12));
                bits = BinaryPrimitives.ReadUInt16LittleEndian(head.AsSpan(at + 22));
            }
            else if (id.SequenceEqual("data"u8))
            {
                if (channels == 0) return null;
                var bytes = size == uint.MaxValue || at + 8 + size > f.Length ? f.Length - at - 8 : size;
                return new Wav(channels, rate, bits, at + 8, bytes);
            }
            // A chunk said to run past what was read: not a WAV this reads (item 286: never a check left hanging).
            if (8L + size + (size & 1) > head.Length - at) return null;
            at += 8 + (int)(size + (size & 1));
        }
        return null;
    }

    /* The recording at [wav], its sidecar's "capture" [said]: its frames, or why they can't be read. */
    public static (Frames? Frames, string? Why) Open(string wav, JsonObject? said)
    {
        var h = Header(wav);
        if (h == null) return (null, "the recording isn't a WAV");
        if (h.Channels != 2) return (null, $"the recording has {h.Channels} channels; the check compares two");
        var width = h.ContainerBits / 8;
        if (width is < 1 or > 4) return (null, $"the recording's samples are {h.ContainerBits}-bit");
        var kind = (string?)said?["kind"] ?? "pcm";
        var setting = (string?)said?["dsd_setting"] ?? "";
        if (kind == "dop") return width < 3 ? (null, "DoP in less than 24 bits") : (new CapturedDsdFrames(wav, h.Data, width, h.Rate, dop: true, little: false), null);
        if (kind == "dsd") return (new CapturedDsdFrames(wav, h.Data, width, h.Rate, dop: false, little: setting == "native_le"), null);
        if (width < 2) return (null, "8-bit PCM");
        return (new PcmFrames(wav, h.Data, width, h.Rate, h.DataBytes / (2L * width)), null);
    }
}
