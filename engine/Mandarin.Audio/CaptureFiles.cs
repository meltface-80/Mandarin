// CaptureFiles.cs — what a capture (Capture.cs, item 412) writes, as Mandarin Bridge for Android writes it (its
// CaptureWav.kt and Capture.kt) and SQ-tool reads it: a WAV, WAVE_FORMAT_EXTENSIBLE, its container the word the engine
// hands the device (32 bits: S32_LE for PCM and DoP, DSD_U32_BE or DSD_U32_LE for native DSD) and its valid bits that
// format's, all 32; beside it a sidecar (.wav.json) saying how it was made. The server's bit-perfect check reads the
// sidecar's "capture": its kind (pcm, dop, dsd), for native DSD which way round its words are ("dsd_setting":
// native or native_le), where a part begins in the whole ("first_frame"), the flushes while it ran ("interruptions"),
// and the device's underruns ("usb", as the Android Bridge names them).
using System.Buffers.Binary;
using System.Text.Json.Nodes;

namespace Mandarin.Audio;

internal static class CaptureFiles
{
    public const int HeaderSize = 68;

    private static readonly byte[] PcmGuidTail = [0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71];

    /* The header of a capture of stream [o], [dataBytes] of samples after it. */
    public static byte[] Header(Capture.Fed o, long dataBytes)
    {
        const int slot = 4;
        var b = new byte[HeaderSize];
        var s = b.AsSpan();
        int block = o.Channels * slot;
        "RIFF"u8.CopyTo(s); BinaryPrimitives.WriteUInt32LittleEndian(s[4..], (uint)(HeaderSize - 8 + dataBytes)); "WAVE"u8.CopyTo(s[8..]);
        "fmt "u8.CopyTo(s[12..]); BinaryPrimitives.WriteUInt32LittleEndian(s[16..], 40);
        BinaryPrimitives.WriteUInt16LittleEndian(s[20..], 0xFFFE);
        BinaryPrimitives.WriteUInt16LittleEndian(s[22..], (ushort)o.Channels);
        BinaryPrimitives.WriteUInt32LittleEndian(s[24..], (uint)o.Rate);
        BinaryPrimitives.WriteUInt32LittleEndian(s[28..], (uint)(o.Rate * block));
        BinaryPrimitives.WriteUInt16LittleEndian(s[32..], (ushort)block);
        BinaryPrimitives.WriteUInt16LittleEndian(s[34..], slot * 8);
        BinaryPrimitives.WriteUInt16LittleEndian(s[36..], 22);
        BinaryPrimitives.WriteUInt16LittleEndian(s[38..], slot * 8);   // valid bits: every one of the format's
        BinaryPrimitives.WriteUInt32LittleEndian(s[40..], o.Channels == 2 ? 0x3u : 0);
        BinaryPrimitives.WriteUInt16LittleEndian(s[44..], 1);
        PcmGuidTail.CopyTo(s[46..]);
        "data"u8.CopyTo(s[60..]); BinaryPrimitives.WriteUInt32LittleEndian(s[64..], (uint)dataBytes);
        return b;
    }

    /* What a part says of itself. */
    public sealed record Part(int N, long FirstFrame, long Bytes, string Reason, int AskedSeconds, double Started, long Underruns,
        IReadOnlyList<(long Frame, string Why)> Interruptions);

    /* The sidecar of part [p] of stream [o], made by [tool]; [about], what the program that asked said of where it was made. */
    public static string Sidecar(string tool, JsonObject about, Capture.Fed o, Part p)
    {
        var frames = p.Bytes / o.FrameBytes;
        var flushes = new JsonArray();
        foreach (var (frame, why) in p.Interruptions)
            flushes.Add((JsonNode)new JsonObject { ["frame"] = frame, ["seconds"] = Math.Round(frame / (double)o.Rate, 3), ["why"] = why });
        var capture = new JsonObject
        {
            ["method"] = "engine-tap", ["rate"] = o.Rate, ["channels"] = o.Channels, ["container_bits"] = 32, ["valid_bits"] = 32,
            ["dsd"] = o.Format != OutFormat.Pcm, ["kind"] = o.Kind, ["format"] = Dsd.AlsaName(o.Format),
            ["frames"] = frames, ["seconds"] = Math.Round(frames / (double)o.Rate, 3), ["asked_seconds"] = p.AskedSeconds,
            ["part"] = p.N, ["first_frame"] = p.FirstFrame, ["started"] = p.Started, ["stop_reason"] = p.Reason,
            ["interruptions"] = flushes, ["player"] = "Mandarin",
            ["usb"] = new JsonObject { ["underruns"] = p.Underruns, ["errors"] = 0, ["dac_rate_set"] = o.Rate, ["feedback"] = null, ["max_packet"] = null },
        };
        foreach (var (k, v) in about) capture[k] = v?.DeepClone();
        // How its DSD went, as it went (the server reads native words' order from it), whatever the setting was.
        if (o.Format != OutFormat.Pcm) capture["dsd_setting"] = o.Format switch { OutFormat.Dop => "dop", OutFormat.DsdU32Le => "native_le", _ => "native" };
        return new JsonObject { ["tool"] = tool, ["capture"] = capture }.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
    }
}
