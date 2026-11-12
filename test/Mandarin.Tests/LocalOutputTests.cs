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

    private static JsonObject With(JsonNode a, object over)
    {
        var o = (JsonObject)a.DeepClone();
        foreach (var (k, v) in JsonNode.Parse(Http.Json(over))!.AsObject()) o[k] = v?.DeepClone();
        return o;
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
