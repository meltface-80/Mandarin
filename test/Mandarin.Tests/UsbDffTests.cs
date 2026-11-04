using System.Buffers.Binary;
using System.Text;

namespace Mandarin.Tests;

/// <summary>
/// A DFF (DSDIFF) to a USB DAC as DSD (bug list item 284, engine/Mandarin.Audio/Dff.cs), as a DSF is (UsbDsdTests):
///   - as DoP: each channel's bits, first bit first (a DFF's bytes are already), 16 a frame under the markers 0x05 and
///     0xFA in turn, at the DSD rate over 16; as native DSD where the DAC takes it: 32 bits a word, big-endian, at the
///     rate over 32. Every byte of its audio checked as the device got it, and nothing of the chunks around it (a
///     comment of odd size before, an ID3 after);
///   - a seek plays on from the word it falls in, what lay between never sent;
///   - one DST-compressed is said, not played as noise.
/// </summary>
public sealed class UsbDffTests
{
    // A DFF of [per] bytes a channel, two channels, at [rate]; its audio DST-compressed where [dst].
    private static (string Path, byte[][] Channels) Dff(string dir, int per, int rate = 2822400, bool dst = false)
    {
        var rnd = new Random(284);
        var ch = new[] { new byte[per], new byte[per] };
        rnd.NextBytes(ch[0]); rnd.NextBytes(ch[1]);
        var audio = new byte[per * 2];
        for (int i = 0; i < per; i++) { audio[2 * i] = ch[0][i]; audio[2 * i + 1] = ch[1][i]; }
        static byte[] Chunk(string id, params byte[][] parts)
        {
            var body = parts.SelectMany(p => p).ToArray();
            var o = new byte[12 + body.Length + (body.Length & 1)];
            Encoding.ASCII.GetBytes(id).CopyTo(o, 0);
            BinaryPrimitives.WriteInt64BigEndian(o.AsSpan(4), body.Length);
            body.CopyTo(o, 12);
            return o;
        }
        static byte[] U32(uint v) { var b = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(b, v); return b; }
        static byte[] U16(ushort v) { var b = new byte[2]; BinaryPrimitives.WriteUInt16BigEndian(b, v); return b; }
        var kind = dst ? "DST " : "DSD ";
        var prop = Chunk("PROP", "SND "u8.ToArray(),
            Chunk("FS  ", U32((uint)rate)),
            Chunk("CHNL", U16(2), "SLFT"u8.ToArray(), "SRGT"u8.ToArray()),
            Chunk("CMPR", Encoding.ASCII.GetBytes(kind), [14], "not compressed"u8.ToArray()));
        var body = new[] { "DSD "u8.ToArray(), Chunk("FVER", U32(0x01050000)), prop, Chunk("COMT", "odd!!"u8.ToArray()),
            Chunk(kind, dst ? Enumerable.Repeat((byte)0xAB, 5000).ToArray() : audio), Chunk("ID3 ", Enumerable.Repeat((byte)0x77, 999).ToArray()) }.SelectMany(p => p).ToArray();
        var file = new byte[12 + body.Length];
        "FRM8"u8.CopyTo(file);
        BinaryPrimitives.WriteInt64BigEndian(file.AsSpan(4), body.Length);
        body.CopyTo(file, 12);
        var path = Path.Combine(dir, dst ? "dst.dff" : "t.dff");
        File.WriteAllBytes(path, file);
        return (path, ch);
    }

    private static async Task<string?> Engine()
    {
        Needs.Server();
        if (!OperatingSystem.IsLinux() && !OperatingSystem.IsMacOS()) Assert.Skip("Linux and a Mac only");
        var found = (await Score.Run(new { fn = "engine", steps = new object[] { new { find = true } } }, new Dictionary<string, string> { ["MANDARIN_APP_DIR"] = ServerProcess.Root }))["results"]![0];
        if (found == null)
        {
            Assert.True(Environment.GetEnvironmentVariable("CI") is not { Length: > 0 }, "CI builds the audio engine before the tests");
            Assert.Skip("no audio engine built (engine/build.sh)");
        }
        return found.Str("bin");
    }

    [Test]
    public async Task A_DFF_goes_to_the_DAC_as_DoP_or_as_native_DSD_every_bit_as_the_file_has_it()
    {
        var bin = await Engine();
        var dir = Directory.CreateTempSubdirectory("usbdff-").FullName;
        try
        {
            var (dff, ch) = Dff(dir, 40 * 4096 + 1000);
            int per = ch[0].Length;

            var (dop, dopSink) = await UsbDsdTests.Play(bin!, dir, dff, "", per / 2 * 2 * 4);
            Assert.Equal((176400.0, "S32_LE (DoP)"), (dopSink.Num("rate")!.Value, dopSink.Str("format")!));
            Assert.Equal(per / 2 * 2 * 4, dop.Length);
            for (int i = 0; i < per / 2; i++)
                for (int c = 0; c < 2; c++)
                {
                    int o = (i * 2 + c) * 4;
                    byte[] want = [0, ch[c][2 * i + 1], ch[c][2 * i], i % 2 == 0 ? (byte)0x05 : (byte)0xFA];
                    if (!dop.AsSpan(o, 4).SequenceEqual(want)) Assert.Fail($"DoP frame {i}, channel {c}: {Convert.ToHexString(dop, o, 4)}, not {Convert.ToHexString(want)}");
                }

            var (nat, natSink) = await UsbDsdTests.Play(bin!, dir, dff, "DSD_U32_BE:64", per / 4 * 2 * 4);
            Assert.Equal((88200.0, "DSD_U32_BE"), (natSink.Num("rate")!.Value, natSink.Str("format")!));
            Assert.Equal(per / 4 * 2 * 4, nat.Length);
            for (int i = 0; i < per / 4; i++)
                for (int c = 0; c < 2; c++)
                {
                    int o = (i * 2 + c) * 4;
                    byte[] want = [ch[c][4 * i], ch[c][4 * i + 1], ch[c][4 * i + 2], ch[c][4 * i + 3]];
                    if (!nat.AsSpan(o, 4).SequenceEqual(want)) Assert.Fail($"native word {i}, channel {c}: {Convert.ToHexString(nat, o, 4)}, not {Convert.ToHexString(want)}");
                }

            // 48 kHz's family goes as DoP at 192 kHz (item 261), though the DAC takes DSD64 natively.
            var (dff48, _) = Dff(dir, 4096, 3072000);
            var (_, sink48) = await UsbDsdTests.Play(bin!, dir, dff48, "DSD_U32_BE:64", 4096 / 2 * 2 * 4);
            Assert.Equal((192000.0, "S32_LE (DoP)"), (sink48.Num("rate")!.Value, sink48.Str("format")!));
        }
        finally { Directory.Delete(dir, true); }
    }

    [Test]
    public async Task A_DFF_seeks_to_the_word_it_falls_in_and_one_DST_compressed_is_said_not_played()
    {
        var bin = await Engine();
        var dir = Directory.CreateTempSubdirectory("usbdff-").FullName;
        try
        {
            // Three seconds of DSD64 a channel; a seek to 1.5 s, on the paced device, as native DSD.
            var (dff, ch) = Dff(dir, 3 * 352800);
            int per = ch[0].Length;
            var file = Path.Combine(dir, "seek.raw");
            var env = new Dictionary<string, string> { ["MANDARIN_APP_DIR"] = ServerProcess.Root };
            var s = (await Score.Run(new
            {
                fn = "engine",
                steps = new object[]
                {
                    new { open = new { location = "file:" + file, bin, volume = 50, dsd_native = "DSD_U32_BE:64" } }, new { set = dff }, new { play = true },
                    new { until = new { above = 0.2 } }, new { seek = 1.5 }, new { until = new { between = new[] { 1.5, 1.8 } }, ms = 600 },
                    new { until = new { state = "STOPPED" }, ms = 8000 },
                },
            }, env))["results"]!.AsArray();
            Assert.True(s[5]!.GetValue<bool>(), "the position jumped there");
            Assert.True(s[6]!.GetValue<bool>(), "played to the end");
            int from = 529200;   // 1.5 s of 352800 bytes a second, a whole word
            int words = (per - from) / 4;
            var b = await File.ReadAllBytesAsync(file);
            var tail = new byte[words * 2 * 4];
            for (int i = 0; i < words; i++)
                for (int c = 0; c < 2; c++)
                    Array.Copy(ch[c], from + 4 * i, tail, (i * 2 + c) * 4, 4);
            Assert.True(b.Length >= tail.Length && b.AsSpan(b.Length - tail.Length).SequenceEqual(tail), "after the seek, the track from the word it fell in");
            Assert.True(b.Length < per * 2, $"skipped over: {b.Length} bytes played of the track's {per * 2}");

            // DST-compressed: said, nothing sent.
            var (dst, _) = Dff(dir, 4096, dst: true);
            var none = Path.Combine(dir, "dst.raw");
            var d = (await Score.Run(new
            {
                fn = "engine",
                steps = new object[]
                {
                    new { open = new { location = "file:" + none, bin, volume = 50, dsd_native = "" } }, new { set = dst }, new { play = true },
                    new { until = new { error = true }, ms = 8000 }, new { state = true },
                },
            }, env))["results"]!.AsArray();
            Assert.Matches("DST-compressed", d[3]?.ToString() ?? "");
            Assert.Equal("STOPPED", (string?)d[4]);
            Assert.True(!File.Exists(none) || new FileInfo(none).Length == 0, "nothing played");
        }
        finally { Directory.Delete(dir, true); }
    }
}
