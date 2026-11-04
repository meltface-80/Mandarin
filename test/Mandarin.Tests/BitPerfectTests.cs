using System.Buffers.Binary;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The bit-perfect check's comparison (bug list item 275, BitPerfect/Compare.cs, `mandarin-server bitperfect`): what
/// a DAC was fed, recorded as SQ-tool records it (a WAV in the DAC's slot, its sidecar saying PCM, DoP or native DSD),
/// against what was sent. Bit-perfect however the samples are packed and wherever the recording starts; an underrun,
/// lost frames, a changed level, one changed sample, another track and another rate each told for what they are; DSD as DoP and as
/// native words, either way round, the same.
/// </summary>
public sealed class BitPerfectTests
{
    private const int Rate = 44100, Frames = 60000;

    // Noise, not a tone: a tone repeats, and a recording could be found at more than one place in it.
    private static int[] Noise(int n, int seed)
    {
        var r = new Random(seed);
        var o = new int[n * 2];
        for (var i = 0; i < o.Length; i++) o[i] = r.Next(-(1 << 22), 1 << 22);   // 24-bit samples, well inside full scale
        return o;
    }

    // A stereo WAV of [samples] (24-bit values), each in a [width]-byte slot, left-justified; at [rate].
    private static string Wav(string dir, string name, IReadOnlyList<int> samples, int width, int rate = Rate)
    {
        var path = Path.Combine(dir, name);
        var data = new byte[samples.Count * width];
        for (var i = 0; i < samples.Count; i++)
        {
            var word = (uint)samples[i] << 8;   // left-justified in 32 bits
            for (var b = 0; b < width; b++) data[i * width + b] = (byte)(word >> (8 * (4 - width + b)));
        }
        File.WriteAllBytes(path, [.. Header(rate, width, data.Length), .. data]);
        return path;
    }

    private static byte[] Header(int rate, int width, int bytes)
    {
        var h = new byte[44];
        "RIFF"u8.CopyTo(h); BinaryPrimitives.WriteUInt32LittleEndian(h.AsSpan(4), (uint)(36 + bytes)); "WAVE"u8.CopyTo(h.AsSpan(8));
        "fmt "u8.CopyTo(h.AsSpan(12)); BinaryPrimitives.WriteUInt32LittleEndian(h.AsSpan(16), 16); BinaryPrimitives.WriteUInt16LittleEndian(h.AsSpan(20), 1);
        BinaryPrimitives.WriteUInt16LittleEndian(h.AsSpan(22), 2); BinaryPrimitives.WriteUInt32LittleEndian(h.AsSpan(24), (uint)rate);
        BinaryPrimitives.WriteUInt32LittleEndian(h.AsSpan(28), (uint)(rate * 2 * width)); BinaryPrimitives.WriteUInt16LittleEndian(h.AsSpan(32), (ushort)(2 * width));
        BinaryPrimitives.WriteUInt16LittleEndian(h.AsSpan(34), (ushort)(8 * width)); "data"u8.CopyTo(h.AsSpan(36)); BinaryPrimitives.WriteUInt32LittleEndian(h.AsSpan(40), (uint)bytes);
        return h;
    }

    private static async Task<JsonObject> Check(object job)
    {
        var r = await ServerCommand.Run(["bitperfect"], stdin: System.Text.Json.JsonSerializer.Serialize(job) + "\n");
        Assert.True(r.Code == 0, r.Err + r.Out);
        return (JsonObject)JsonNode.Parse(r.Out)!;
    }

    private static List<int> Frames0(int[] s, int from, int to) => [.. s.Skip(from * 2).Take((to - from) * 2)];

    [Test]
    public async Task PCM_bit_perfect_in_any_slot_and_from_anywhere_and_each_fault_told_for_what_it_is()
    {
        Needs.Server(); Needs.Ffmpeg();
        var dir = Directory.CreateTempSubdirectory("musicd-test-bitperfect-").FullName;
        try
        {
            var sent = Noise(Frames, 1);
            var file = Wav(dir, "sent.wav", sent, 3);
            async Task<JsonObject> Of(string wav) => await Check(new { sent = file, rate = Rate, bits = 24, seconds = Frames / (double)Rate, parts = new[] { new { wav } } });

            // The whole track in a 32-bit slot, silence either side: bit-perfect, every sample.
            var whole = new List<int>(new int[2000]); whole.AddRange(sent); whole.AddRange(new int[1000]);
            var r = await Of(Wav(dir, "whole.wav", whole, 4));
            Assert.Equal(("bit-perfect", 1.0), ((string)r["verdict"]!, (double)r["coverage"]!));
            Assert.StartsWith("Bit-perfect: every sample", (string)r["says"]!);

            // From the middle, packed in three bytes: bit-perfect, from where it starts.
            r = await Of(Wav(dir, "middle.wav", Frames0(sent, 20000, Frames), 3));
            Assert.Equal("bit-perfect", (string)r["verdict"]!);
            Assert.Equal(20000 / (double)Rate, (double)r["parts"]![0]!["from"]!, 3);

            // An underrun: 300 frames of silence put in at 30000.
            var under = Frames0(sent, 0, 30000); under.AddRange(new int[600]); under.AddRange(Frames0(sent, 30000, Frames));
            r = await Of(Wav(dir, "under.wav", under, 4));
            Assert.Equal(("dropouts", "silence"), ((string)r["verdict"]!, (string)r["dropouts"]![0]!["kind"]!));
            Assert.Equal(30000 / (double)Rate, (double)r["dropouts"]![0]!["at"]!, 2);

            // Frames lost: 1000 of them at 40000.
            var lost = Frames0(sent, 0, 40000); lost.AddRange(Frames0(sent, 41000, Frames));
            r = await Of(Wav(dir, "lost.wav", lost, 4));
            Assert.Equal(("dropouts", "skip"), ((string)r["verdict"]!, (string)r["dropouts"]![0]!["kind"]!));

            // One sample changed: altered, and where.
            var one = sent.ToArray(); one[2 * 25000] ^= 1 << 4;
            r = await Of(Wav(dir, "one.wav", one, 4));
            Assert.Equal("altered", (string)r["verdict"]!);
            Assert.Equal(25000 / (double)Rate, (double)r["first_difference"]!, 3);

            // A level 1 dB down: not bit-perfect, and by how much.
            r = await Of(Wav(dir, "level.wav", sent.Select(x => (int)Math.Round(x * Math.Pow(10, -1 / 20.0))).ToArray(), 4));
            Assert.Equal("not-bit-perfect", (string)r["verdict"]!);
            Assert.Equal(-1.0, (double)r["level_db"]!, 1);

            // Another track altogether: not the track that was sent (not "a level" of it).
            r = await Of(Wav(dir, "other.wav", Noise(Frames, 2), 4));
            Assert.Equal("not-found", (string)r["verdict"]!);

            // Another rate: resampled.
            r = await Of(Wav(dir, "rate.wav", sent, 4, 48000));
            Assert.Equal("resampled", (string)r["verdict"]!);
        }
        finally { Directory.Delete(dir, true); }
    }

    // A DSF of [bytes] a channel (random bits), at DSD64.
    private static string Dsf(string dir, byte[][] ch)
    {
        var n = ch[0].Length;
        using var o = new BinaryWriter(File.Create(Path.Combine(dir, "sent.dsf")));
        var data = n * 2L;
        o.Write("DSD "u8); o.Write(28L); o.Write(92 + data); o.Write(0L);
        o.Write("fmt "u8); o.Write(52L); o.Write(1); o.Write(0); o.Write(2); o.Write(2); o.Write(2822400); o.Write(1); o.Write(n * 8L); o.Write(4096); o.Write(0);
        o.Write("data"u8); o.Write(12 + data);
        for (var b = 0; b < n / 4096; b++) for (var c = 0; c < 2; c++) o.Write(ch[c], b * 4096, 4096);
        return Path.Combine(dir, "sent.dsf");
    }

    private static byte Turn(byte b) { byte o = 0; for (var i = 0; i < 8; i++) if ((b & (1 << i)) != 0) o |= (byte)(0x80 >> i); return o; }

    [Test]
    public async Task DSD_bit_perfect_as_DoP_and_as_native_words_either_way_round_and_a_changed_byte_told()
    {
        Needs.Server(); Needs.Ffmpeg();
        var dir = Directory.CreateTempSubdirectory("musicd-test-bitperfect-").FullName;
        try
        {
            var r0 = new Random(7);
            var ch = new[] { new byte[4096 * 40], new byte[4096 * 40] };
            r0.NextBytes(ch[0]); r0.NextBytes(ch[1]);
            var file = Dsf(dir, ch);
            // Each channel's bytes in the order they are played: a DSF holds each byte's first bit lowest.
            var played = ch.Select(c => c.Select(Turn).ToArray()).ToArray();
            var n = played[0].Length;
            async Task<JsonObject> Of(string name, byte[] data, int rate, int width, object said) =>
                await Check(new { sent = file, rate = 2822400, dsd = 64, dsd_base = 44100, seconds = n * 8 / 2822400.0,
                    parts = new[] { new { wav = Write(name, data, rate, width), said } } });
            string Write(string name, byte[] data, int rate, int width)
            {
                var path = Path.Combine(dir, name);
                File.WriteAllBytes(path, [.. Header(rate, width, data.Length), .. data]);
                return path;
            }

            // DoP in 32-bit slots: each frame [0, later byte, earlier byte, marker], the markers 0x05 and 0xFA by turns.
            byte[] Dop(byte[][] p)
            {
                var o = new byte[n / 2 * 2 * 4];
                for (var f = 0; f < n / 2; f++) for (var c = 0; c < 2; c++)
                {
                    var at = (f * 2 + c) * 4;
                    (o[at + 1], o[at + 2], o[at + 3]) = (p[c][2 * f + 1], p[c][2 * f], (byte)(f % 2 == 0 ? 0x05 : 0xFA));
                }
                return o;
            }
            var dop = Dop(played);
            var r = await Of("dop.wav", dop, 2822400 / 16, 4, new { kind = "dop", dsd_setting = "dop" });
            Assert.Equal(("bit-perfect", 1.0), ((string)r["verdict"]!, (double)r["coverage"]!));

            // Native 32-bit words, big-endian (the first byte played first) and little-endian.
            byte[] Native(bool little)
            {
                var o = new byte[n * 2];
                for (var w = 0; w < n / 4; w++) for (var c = 0; c < 2; c++) for (var k = 0; k < 4; k++)
                    o[(w * 2 + c) * 4 + (little ? 3 - k : k)] = played[c][w * 4 + k];
                return o;
            }
            r = await Of("be.wav", Native(false), 2822400 / 32, 4, new { kind = "dsd", dsd_setting = "native" });
            Assert.Equal("bit-perfect", (string)r["verdict"]!);
            r = await Of("le.wav", Native(true), 2822400 / 32, 4, new { kind = "dsd", dsd_setting = "native_le" });
            Assert.Equal("bit-perfect", (string)r["verdict"]!);

            // One byte changed in the DoP: altered.
            dop[(20000 * 2) * 4 + 2] ^= 0x10;
            r = await Of("dop1.wav", dop, 2822400 / 16, 4, new { kind = "dop", dsd_setting = "dop" });
            Assert.Equal("altered", (string)r["verdict"]!);
        }
        finally { Directory.Delete(dir, true); }
    }
}
