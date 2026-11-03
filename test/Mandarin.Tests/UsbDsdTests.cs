using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// DSD to a USB DAC on the server (bug list item 256, engine/Mandarin.Audio/Dsd.cs, Local/UsbFormats.cs):
///   - what a DAC takes, read from its descriptor as the kernel lists it: its PCM rates from its PCM altsets only,
///     its native DSD from a DSD_U32 altset (88.2 kHz words are DSD64) and on; a DAC with none offered DSD (DoP), off;
///   - a DSF played as DoP: each channel's bits, first bit first, 16 a frame under the markers 0x05 and 0xFA in turn,
///     at the DSD rate over 16; as native DSD where the DAC takes it: 32 bits a word, big-endian, at the rate over 32.
///     Every byte of the file's audio checked as the device got it; nothing scaled (the volume at 50%).
/// </summary>
public sealed class UsbDsdTests
{
    private static (string Root, string Dev) FakeAsound()
    {
        var root = Directory.CreateTempSubdirectory("asound-").FullName;
        var dev = Path.Combine(root, "dev");
        void W(string f, string t) { var p = Path.Combine(root, f); Directory.CreateDirectory(Path.GetDirectoryName(p)!); File.WriteAllText(p, t); }
        W("cards", string.Join("\n",
            " 1 [Spring3        ]: USB-Audio - May DAC",
            "                      Holo Audio May DAC at usb-0000:00:14.0-2, high speed",
            " 2 [Mojo           ]: USB-Audio - Chord Mojo",
            "                      Chord Electronics Ltd Chord Mojo at usb-0000:00:14.0-3, high speed", ""));
        W("card1/pcm0p/info", "name: USB Audio\n");
        W("card1/usbid", "3542:0004\n");
        // A DAC that takes native DSD: its DSD_U32_BE altset's rates are words a second (705.6 kHz is DSD512, not offered).
        W("card1/stream0", string.Join("\n",
            "Holo Audio May DAC at usb-0000:00:14.0-2, high speed : USB Audio", "", "Playback:",
            "  Interface 1", "    Altset 1", "    Format: S32_LE", "    Channels: 2", "    Bits: 32",
            "    Rates: 44100, 48000, 96000, 176400, 192000, 352800, 384000, 705600, 768000",
            "  Interface 1", "    Altset 2", "    Format: DSD_U32_BE", "    Channels: 2", "    Bits: 32",
            "    Rates: 88200, 176400, 352800, 705600", ""));
        W("card2/pcm0p/info", "name: USB Audio\n");
        W("card2/usbid", "2fc6:f06b\n");
        W("card2/stream0", string.Join("\n",
            "Chord Electronics Ltd Chord Mojo at usb-0000:00:14.0-3, high speed : USB Audio", "", "Playback:",
            "  Interface 1", "    Altset 1", "    Format: S32_LE", "    Channels: 2", "    Bits: 32",
            "    Rates: 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000", ""));
        Directory.CreateDirectory(dev);
        foreach (var n in new[] { "pcmC1D0p", "pcmC2D0p" }) File.WriteAllText(Path.Combine(dev, n), "");
        return (root, dev);
    }

    [Test]
    public async Task A_DACs_native_DSD_is_read_from_its_descriptor_and_one_with_none_is_offered_DSD_off()
    {
        Needs.Server();
        var (root, dev) = FakeAsound();
        try
        {
            var devices = (await Score.Run(new JsonObject { ["fn"] = "local", ["linux"] = new JsonArray(root, dev) }))["devices"]!.AsArray();
            var may = devices.First(d => d.Str("network_name") == "May DAC")!;
            var mojo = devices.First(d => d.Str("network_name") == "Chord Mojo")!;
            var adv = may["caps"]!["advertised"]!;
            // Its PCM rates are its PCM altset's: 88.2 kHz is only its DSD's (DSD64's words), so not among them.
            Assert.Equal([44100.0, 48000, 96000, 176400, 192000, 352800, 384000, 705600, 768000], adv["rates"]!.AsArray().Select(x => (double)x!).ToArray());
            Assert.Equal([64.0, 128, 256], adv["dsd"]!.AsArray().Select(x => (double)x!).ToArray());
            Assert.Equal("DSD_U32_BE", adv.Str("dsd_format"));
            Assert.Contains("dsd", adv["containers"]!.AsArray().Select(x => (string?)x));
            // Its DSD chips: on, as it says (no tick needed).
            var effective = (await Score.Run(new JsonObject { ["fn"] = "profiles", ["records"] = new JsonArray(new JsonObject { ["record"] = may.DeepClone() }) }))["effective"]![0]!;
            Assert.Equal(["64:advertised", "128:advertised", "256:advertised"],
                effective["dsd"]!.AsArray().Where(c => c!["on"]!.GetValue<bool>()).Select(c => $"{c.Num("n")}:{c.Str("source")}").ToArray());
            // A DAC with no DSD altset takes the rates DoP needs: offered DSD, every multiple off until ticked.
            var madv = mojo["caps"]!["advertised"]!;
            Assert.Null(madv["dsd"]);
            Assert.Contains("dsd", madv["containers"]!.AsArray().Select(x => (string?)x));
            var me = (await Score.Run(new JsonObject { ["fn"] = "profiles", ["records"] = new JsonArray(new JsonObject { ["record"] = mojo.DeepClone() }) }))["effective"]![0]!;
            Assert.Equal(3, me["dsd"]!.AsArray().Count(c => !c!["on"]!.GetValue<bool>()));
        }
        finally { Directory.Delete(root, true); }
    }

    // A DSF of [blocks] whole 4096-byte blocks a channel and [tail] bytes more, both channels: its path and each
    // channel's bytes as the file holds them (first bit the least significant).
    private static (string Path, byte[][] Channels) Dsf(string dir, int blocks, int tail, int rate = 2822400)
    {
        const int block = 4096;
        int per = blocks * block + tail;
        var rnd = new Random(256);
        var ch = new[] { new byte[per], new byte[per] };
        rnd.NextBytes(ch[0]); rnd.NextBytes(ch[1]);
        int groups = blocks + (tail > 0 ? 1 : 0);
        var data = new byte[groups * block * 2];
        for (int g = 0; g < groups; g++)
            for (int c = 0; c < 2; c++)
                Array.Copy(ch[c], g * block, data, (g * 2 + c) * block, Math.Min(block, per - g * block));
        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        w.Write("DSD "u8); w.Write(28L); w.Write(92L + data.Length); w.Write(0L);
        w.Write("fmt "u8); w.Write(52L); w.Write(1); w.Write(0); w.Write(2); w.Write(2); w.Write(rate); w.Write(1); w.Write((long)per * 8); w.Write(block); w.Write(0);
        w.Write("data"u8); w.Write(12L + data.Length); w.Write(data);
        w.Flush();
        var path = System.IO.Path.Combine(dir, "t.dsf");
        File.WriteAllBytes(path, ms.ToArray());
        return (path, ch);
    }

    private static byte Rev(byte b) { int r = 0; for (int i = 0; i < 8; i++) if ((b & (1 << i)) != 0) r |= 0x80 >> i; return (byte)r; }

    // The engine playing [dsf] to a file at the volume [volume], told the DAC takes [native]: the bytes and the format it opened at.
    private static async Task<(byte[] Out, JsonNode? Sink)> Play(string bin, string dir, string dsf, string native, int bytes)
    {
        var file = Path.Combine(dir, "out-" + Guid.NewGuid().ToString("N") + ".raw");
        var r = (await Score.Run(new
        {
            fn = "engine",
            steps = new object[]
            {
                new { open = new { location = "file:" + file, bin, volume = 50, dsd_native = native } }, new { set = dsf }, new { play = true },
                new { until = new { state = "STOPPED" }, ms = 15000 }, new { opened = true },
            },
        }, new Dictionary<string, string> { ["MANDARIN_APP_DIR"] = ServerProcess.Root }))["results"]!.AsArray();
        Assert.True(r[3]?.GetValue<bool>() == true, "played to the end");
        await Session.Until(() => Task.FromResult(new FileInfo(file).Length >= bytes), 5000, "every frame written");
        return (File.ReadAllBytes(file), r[4]);
    }

    [Test]
    public async Task A_DSF_goes_to_the_DAC_as_DoP_or_as_native_DSD_every_bit_as_the_file_has_it()
    {
        Needs.Server();
        if (!OperatingSystem.IsLinux() && !OperatingSystem.IsMacOS()) Assert.Skip("Linux and a Mac only");
        var found = (await Score.Run(new { fn = "engine", steps = new object[] { new { find = true } } }, new Dictionary<string, string> { ["MANDARIN_APP_DIR"] = ServerProcess.Root }))["results"]![0];
        if (found == null)
        {
            Assert.True(Environment.GetEnvironmentVariable("CI") is not { Length: > 0 }, "CI builds the audio engine before the tests");
            Assert.Skip("no audio engine built (engine/build.sh)");
        }
        var dir = Directory.CreateTempSubdirectory("usbdsd-").FullName;
        try
        {
            // 40 whole blocks and part of one more a channel: the last block's padding never sent.
            var (dsf, ch) = Dsf(dir, 40, 1000);
            int per = ch[0].Length;

            // DoP: 16 bits a frame a channel, the second byte under the first, the marker on top, 0x05 and 0xFA in turn.
            var (dop, dopSink) = await Play(found.Str("bin")!, dir, dsf, "", per / 2 * 2 * 4);
            Assert.Equal((176400.0, "S32_LE (DoP)"), (dopSink.Num("rate")!.Value, dopSink.Str("format")!));
            Assert.Equal(per / 2 * 2 * 4, dop.Length);
            for (int i = 0; i < per / 2; i++)
                for (int c = 0; c < 2; c++)
                {
                    int o = (i * 2 + c) * 4;
                    byte[] want = [0, Rev(ch[c][2 * i + 1]), Rev(ch[c][2 * i]), i % 2 == 0 ? (byte)0x05 : (byte)0xFA];
                    if (!dop.AsSpan(o, 4).SequenceEqual(want)) Assert.Fail($"DoP frame {i}, channel {c}: {Convert.ToHexString(dop, o, 4)}, not {Convert.ToHexString(want)}");
                }

            // Native: 32 bits a word a channel, in time order, at the rate over 32.
            var (nat, natSink) = await Play(found.Str("bin")!, dir, dsf, "DSD_U32_BE:64", per / 4 * 2 * 4);
            Assert.Equal((88200.0, "DSD_U32_BE"), (natSink.Num("rate")!.Value, natSink.Str("format")!));
            Assert.Equal(per / 4 * 2 * 4, nat.Length);
            for (int i = 0; i < per / 4; i++)
                for (int c = 0; c < 2; c++)
                {
                    int o = (i * 2 + c) * 4;
                    byte[] want = [Rev(ch[c][4 * i]), Rev(ch[c][4 * i + 1]), Rev(ch[c][4 * i + 2]), Rev(ch[c][4 * i + 3])];
                    if (!nat.AsSpan(o, 4).SequenceEqual(want)) Assert.Fail($"native word {i}, channel {c}: {Convert.ToHexString(nat, o, 4)}, not {Convert.ToHexString(want)}");
                }

            // Told it takes DSD128 natively only: DSD64 goes as DoP.
            var (_, other) = await Play(found.Str("bin")!, dir, dsf, "DSD_U32_BE:128", per / 2 * 2 * 4);
            Assert.Equal("S32_LE (DoP)", other.Str("format"));

            // 48 kHz's family (item 261): 3.072 MHz goes as DoP at 192 kHz, every bit as the file has it, though the
            // DAC takes DSD64 natively (its native rates are 44.1 kHz's).
            var (dsf48, ch48) = Dsf(dir, 40, 1000, 3072000);
            var (dop48, sink48) = await Play(found.Str("bin")!, dir, dsf48, "DSD_U32_BE:64", per / 2 * 2 * 4);
            Assert.Equal((192000.0, "S32_LE (DoP)"), (sink48.Num("rate")!.Value, sink48.Str("format")!));
            Assert.Equal(per / 2 * 2 * 4, dop48.Length);
            for (int i = 0; i < per / 2; i++)
                for (int c = 0; c < 2; c++)
                {
                    int o = (i * 2 + c) * 4;
                    byte[] want = [0, Rev(ch48[c][2 * i + 1]), Rev(ch48[c][2 * i]), i % 2 == 0 ? (byte)0x05 : (byte)0xFA];
                    if (!dop48.AsSpan(o, 4).SequenceEqual(want)) Assert.Fail($"48 kHz family DoP frame {i}, channel {c}: {Convert.ToHexString(dop48, o, 4)}, not {Convert.ToHexString(want)}");
                }
        }
        finally { Directory.Delete(dir, true); }
    }
}
