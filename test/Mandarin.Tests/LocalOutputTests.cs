using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// A sound device on the computer Mandarin runs on (v0.6.18): a USB DAC, the built-in speakers.
///   - the devices are found: ALSA cards (a USB DAC's own rates and depths);
///   - the volume is on an audio taper (untouched at 100%);
///   - end to end: off until turned on, then a zone; an album plays to it, the next track follows, the
///     volume is kept.
/// The C# server's (Local/LocalDevices.cs, EngineOutput.cs); how the engine plays a device is
/// EngineTests. The "device" here is a file the PCM is written to at the speed it would play (file:)
/// (test/local-output.test.js, in C#).
/// </summary>
public sealed class LocalOutputTests
{
    private static async Task<JsonNode> Local(JsonObject job) { job["fn"] = "local"; return await Score.Run(job); }

    private static async Task<JsonNode> Effective(JsonNode record) =>
        (await Score.Run(new JsonObject { ["fn"] = "profiles", ["records"] = new JsonArray(new JsonObject { ["record"] = record.DeepClone() }) }))["effective"]![0]!;

    private static (string Root, string Dev) FakeAsound()
    {
        var root = Directory.CreateTempSubdirectory("asound-").FullName;
        var dev = Path.Combine(root, "dev");
        void W(string f, string t) { var p = Path.Combine(root, f); Directory.CreateDirectory(Path.GetDirectoryName(p)!); File.WriteAllText(p, t); }
        W("cards", string.Join("\n",
            " 0 [PCH            ]: HDA-Intel - HDA Intel PCH",
            "                      HDA Intel PCH at 0xf7f10000 irq 32",
            " 1 [Mojo           ]: USB-Audio - Chord Mojo",
            "                      Chord Electronics Ltd Chord Mojo at usb-0000:00:14.0-2, high speed",
            " 2 [Hidden         ]: USB-Audio - Hidden DAC",
            "                      Someone Hidden DAC at usb-0000:00:14.0-3, full speed", ""));
        W("card0/pcm0p/info", "card: 0\ndevice: 0\nname: ALC892 Analog\n");
        W("card0/pcm3p/info", "card: 0\ndevice: 3\nname: HDMI 0\n");
        W("card0/pcm0c/info", "name: ALC892 Analog\n");
        W("card1/pcm0p/info", "name: USB Audio\n");
        W("card1/usbid", "20b1:301f\n");
        W("card1/stream0", string.Join("\n",
            "Chord Electronics Ltd Chord Mojo at usb-0000:00:14.0-2, high speed : USB Audio", "",
            "Playback:", "  Status: Stop",
            "  Interface 1", "    Altset 1", "    Format: S32_LE", "    Channels: 2", "    Bits: 32",
            "    Rates: 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000",
            "  Interface 1", "    Altset 2", "    Format: S24_3LE", "    Bits: 24", "    Rates: 44100, 48000, 96000", ""));
        W("card1/pcm0p/sub0/hw_params", "access: RW_INTERLEAVED\nformat: S32_LE\nsubformat: STD\nchannels: 2\nrate: 96000 (96000/1)\n");
        W("card2/pcm0p/info", "name: USB Audio\n");
        Directory.CreateDirectory(dev);
        foreach (var n in new[] { "pcmC0D0p", "pcmC0D3p", "pcmC1D0p" }) File.WriteAllText(Path.Combine(dev, n), "");
        return (root, dev);
    }

    // A record with fields laid over it (Object.assign).
    private static JsonObject With(JsonNode a, object over)
    {
        var o = (JsonObject)a.DeepClone();
        foreach (var (k, v) in JsonNode.Parse(Http.Json(over))!.AsObject()) o[k] = v?.DeepClone();
        return o;
    }

    [Test]
    public async Task A_Macs_sound_devices_its_Core_Audio_outputs()
    {
        Needs.Server();
        // What system_profiler SPAudioDataType -json says (item 153): outputs only, each by its name.
        var mac = (await Local(new JsonObject { ["mac"] = """
            { "SPAudioDataType": [{ "_items": [
              { "_name": "MacBook Pro Microphone", "coreaudio_device_input": 1, "coreaudio_device_srate": 48000 },
              { "_name": "MacBook Pro Speakers", "coreaudio_device_output": 2, "coreaudio_device_srate": 48000,
                "coreaudio_device_transport": "coreaudio_device_type_builtin", "coreaudio_default_audio_output_device": "spaudio_yes" },
              { "_name": "Topping E30", "coreaudio_device_output": 2, "coreaudio_device_srate": 96000,
                "coreaudio_device_transport": "coreaudio_device_type_usb", "coreaudio_device_manufacturer": "Topping" }
            ] }] }
            """ }))["mac"]!.AsArray();
        Assert.Equal(["MacBook Pro Speakers|Built-in|48000", "Topping E30|USB audio|96000"],
            mac.Select(d => $"{d.Str("network_name")}|{d.Str("model")}|{d!["caps"]!["advertised"]!["rates"]![0]}").ToArray());
        Assert.Equal("coreaudio:Topping E30", mac[1].Str("location"));
        Assert.Equal("Topping", mac[1].Str("manufacturer"));
    }

    [Test]
    public async Task A_Macs_devices_take_every_rate_the_engine_lists()
    {
        Needs.Server();
        // With the engine here (item 155), each device's rates as Core Audio lists them; a rate Mandarin doesn't
        // send (8 kHz) left out; a device the engine didn't list keeps the one it is set to.
        var mac = (await Local(new JsonObject
        {
            ["mac"] = """
                { "SPAudioDataType": [{ "_items": [
                  { "_name": "MacBook Pro Speakers", "coreaudio_device_output": 2, "coreaudio_device_srate": 48000 },
                  { "_name": "Topping E30", "coreaudio_device_output": 2, "coreaudio_device_srate": 96000, "coreaudio_device_transport": "coreaudio_device_type_usb" }
                ] }] }
                """,
            ["mac_engine"] = "{\"name\":\"Topping E30\",\"rates\":\"8000,44100,48000,88200,96000,176400,192000,352800,384000\"}\nnot a line\n",
        }))["mac"]!.AsArray();
        Assert.Equal("48000", string.Join(",", mac[0]!["caps"]!["advertised"]!["rates"]!.AsArray().Select(r => r!.ToString())));
        Assert.Equal("44100,48000,88200,96000,176400,192000,352800,384000", string.Join(",", mac[1]!["caps"]!["advertised"]!["rates"]!.AsArray().Select(r => r!.ToString())));
    }

    [Test]
    public async Task This_computers_sound_devices_ALSA_cards()
    {
        Needs.Server();
        var (root, dev) = FakeAsound();
        var found = await Local(new JsonObject { ["linux"] = new JsonArray(root, dev) });
        Assert.True(found.Num("hidden") == 1, "a card /dev/snd doesn't let us open is counted, not listed");
        var devices = found["devices"]!.AsArray();
        Assert.Equal(["HDA Intel PCH (ALC892 Analog)", "HDA Intel PCH (HDMI 0)", "Chord Mojo"], devices.Select(d => d.Str("network_name")));
        var mojo = devices[2]!;
        Assert.Equal("local", mojo.Str("kind"));
        Assert.Equal("alsa:plughw:CARD=Mojo,DEV=0", mojo.Str("location"));
        Assert.Equal("Chord Electronics Ltd", mojo.Str("manufacturer"));
        Assert.Equal("USB audio", mojo.Str("model"));
        JsonAssert.Same("[44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000]", mojo["caps"]?["advertised"]?["rates"]);
        JsonAssert.Same("[24, 32]", mojo["caps"]?["advertised"]?["bits"]);
        Assert.True(mojo.Str("id") == (await Local(new JsonObject { ["linux"] = new JsonArray(root, dev) }))["devices"]![2].Str("id"), "the same id every time");
        Assert.Matches("^LOCAL_[0-9a-f]{12}$", mojo.Str("id"));
        JsonAssert.Same("[]", devices[0]!["caps"]?["advertised"]?["rates"], "an internal card says nothing: 44.1 and 48 kHz until ticked");
        JsonAssert.Same("""{"rate":96000,"format":"S32_LE"}""", (await Local(new JsonObject { ["hw"] = new JsonArray(new JsonArray(mojo.Str("location"), root)) }))["hw"]![0]);

        // The chips: the Mojo's own rates are on as advertised; the HDA's are the floor.
        var chips = await Effective(With(JsonNode.Parse("""{"playable":true}""")!, mojo));
        Assert.Equal("local", chips["profile"].Str("id"));
        Assert.All(chips["rates"].Items(), r => Assert.True(r.Bool("on") == true && r.Str("source") == "advertised"));
        Assert.Equal([16.0, 24, 32], chips["bits"].Items().Where(b => b.Bool("on") == true).Select(b => b.Num("n") ?? 0));
        var hda = await Effective(With(JsonNode.Parse("""{"playable":true}""")!, devices[0]!));
        Assert.Equal([44100.0, 48000], hda["rates"].Items().Where(r => r.Bool("on") == true).Select(r => r.Num("hz") ?? 0));
    }

    [Test]
    public async Task The_volume_is_an_audio_taper()
    {
        Needs.Server();
        var a = (await Local(new JsonObject { ["amplitude"] = JsonNode.Parse("[[100], [0], [80, true], [50], [10], [5]]") }))["amplitude"]!.AsArray().Select(x => x!.GetValue<double>()).ToArray();
        var (full, none, muted, half, tenth, five) = (a[0], a[1], a[2], a[3], a[4], a[5]);
        Assert.Equal(1, full);
        Assert.Equal(0, none);
        Assert.True(muted == 0, "muted");
        Assert.True(Math.Abs(20 * Math.Log10(half) - -25) < 1e-9, "50% is −25 dB");
        Assert.True(Math.Abs(20 * Math.Log10(tenth) - -45) < 1e-9, "10% is −45 dB");
        Assert.True(five > 0 && five < tenth);
    }

    [Test]
    public async Task End_to_end_a_sound_device_on_this_computer_is_a_zone_an_album_plays_to_it()
    {
        Needs.Server(); Needs.Ffmpeg(); Needs.Engine();
        var lib = Fixtures.MakeLibrary();
        var output = Path.Combine(lib.Data, "dac.raw");
        var id = (string)(await Local(new JsonObject { ["ids"] = new JsonArray("test:dac") }))["ids"]![0]!;
        var dacDevice = new
        {
            id, kind = "local", family = "local", network_name = "Test DAC", manufacturer = "Test", model = "USB audio",
            location = "file:" + output, playable = true, caps = new { advertised = new { containers = new[] { "flac" }, rates = new[] { 44100, 48000, 96000 }, bits = new[] { 16, 24, 32 } } }
        };
        // The device stands in for this computer's own (local_devices): its file the sound card.
        await using var s = await Session.Started(new Dictionary<string, object?> { ["localDevices"] = new { devices = new[] { dacDevice }, platform = "linux", hidden = 0 } }, lib);
        async Task<JsonNode> Api(string p, object? body = null, string? method = null)
        {
            var r = body == null && method == null ? await s.Api(p)
                : await Http.Send(new HttpMethod(method ?? "POST"), s.Base + "/api/" + p, new StringContent(Http.Json(body ?? new { }), System.Text.Encoding.UTF8, "application/json"), s.H);
            var o = r.Json as JsonObject ?? [];
            o["status"] = r.Status;
            return o;
        }
        await Session.Until(async () => (await Api("status")).Num("index_count") >= 3, 15000, "the library");
        JsonNode? listed = null;
        await Session.Until(async () => (listed = (await Api("audio-devices"))["devices"].Items().FirstOrDefault(d => d.Str("id") == id)) != null, 15000, "the device listed");
        Assert.Equal("local", listed.Str("kind"));
        Assert.True(listed.Bool("enabled") == false, "off until turned on");
        Assert.DoesNotContain((await Api("zones"))["zones"].Items(), z => z.Str("zone_id") == id);
        var d = await Api("audio-devices/" + id, new { enabled = true }, "PATCH");
        Assert.Equal(200, d.Num("status"));
        Assert.Equal("This computer (ALSA)", d.Str("found_by"));
        Assert.Equal(output, d.Str("location"));
        Assert.True(d.Bool("can_fix_volume"));
        Assert.True(d["dsp"] != null, "it has DSP, run on the server");
        JsonNode? z = null;
        await Session.Until(async () => (z = (await Api("zones"))["zones"].Items().FirstOrDefault(x => x.Str("zone_id") == id)) != null, 15000, "the zone");
        Assert.True(z!["outputs"]![0]!["volume"].Num("value") == 50, "starts at 50%");

        var cd = (await Api("library/albums?sort=album"))["albums"].Items().First(a => a.Str("title") == "Album One");
        var r = await Api("play", new { offset = cd.Num("offset"), zone_or_output_id = id, kind = "play_now" });
        Assert.True(r.Bool("ok"), r.ToJsonString());
        async Task<JsonNode?> Zone() => (await Api("zone-state?zone=" + id))["zone"];
        JsonNode? s1 = null;
        await Session.Until(async () => (s1 = await Zone()) is { } x && x.Str("state") == "playing" && x["now_playing"] != null, 15000, "playing");
        Assert.Equal("Song 1", s1!["now_playing"].Str("line1"));
        await Session.Until(() => Task.FromResult(File.Exists(output) && new FileInfo(output).Length > 0), 15000, "the device written to");
        Assert.True((await Api("volume", new { output_id = id, value = 30 })).Bool("ok"));
        // The next track follows by itself.
        await Session.Until(async () => await Zone() is { } x && x.Str("state") == "playing" && x["now_playing"].Str("line1") == "Song 2", 15000, "the next track");
        Assert.True(!s.Server.Logs.Any(l => l.Contains("started by hand", StringComparison.Ordinal)),
            "the device moved on by itself: " + string.Join("; ", s.Server.Logs.Where(l => l.Contains("Test DAC", StringComparison.Ordinal))));
        var p = await Api("control", new { zone_or_output_id = id, command = "pause" });
        Assert.True(p.Bool("ok"), p.ToJsonString());
        await Session.Until(async () => (await Zone()).Str("state") == "paused", 15000, "paused");
        double? Kept() => s.Server.Scalar("SELECT settings FROM audio_devices WHERE id = $1", id) is string j ? JsonNode.Parse(j).Num("local_volume") : null;
        try { await Session.Until(() => Task.FromResult(Kept() == 30), 15000); } catch (TimeoutException) { }
        Assert.True(Kept() == 30, "the volume is kept");
    }
}
