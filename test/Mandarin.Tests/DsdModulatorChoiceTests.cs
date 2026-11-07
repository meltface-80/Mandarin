using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The modulators a device can choose for PCM made DSD (bug list item 303, Upsample/DsdOut.cs): the seventh order
/// (Mandarin's default), the seventh held quiet to 50 kHz ("7w", at DSD128 and DSD256) and the ninth ("9", at DSD64 and
/// DSD128). Each, as it is made, measured on its own bits: what it does where it is offered (the wide one quieter from
/// 20 to 50 kHz than the seventh by 20 dB and more; the ninth quieter in the band), and the loop held past SACD's
/// highest level with no reset. A device set to one is made it where it is offered, in a cache file of its own, its
/// address saying it; where it isn't, the seventh order, as before.
/// </summary>
public sealed class DsdModulatorChoiceTests
{
    private static async Task<JsonNode> Mod(string mod, int rate, double amp, string signal = "tone") =>
        await Score.Run(new { fn = "dsdmod", rate, amp, mod, signal, seconds = 0.25 });

    private static async Task<JsonNode> Plans(JsonObject job) { job["fn"] = "plans"; return await Score.Run(job); }

    [Test]
    public async Task The_wide_seventh_is_quieter_from_20_to_50_kHz_by_20_dB_and_more_at_DSD128_and_DSD256()
    {
        Needs.Server();
        foreach (var (rate, band, wide) in new[] { (5644800, -105.0, -103.0), (11289600, -148.0, -148.0) })
        {
            var w = await Mod("7w", rate, 0.5);
            var s = await Mod("7", rate, 0.5);
            Assert.True(w.Num("noise_db") < band, $"DSD{rate / 44100} wide, in the band: {w.Num("noise_db")} dB");
            Assert.True(w.Num("noise_50k_db") < wide, $"DSD{rate / 44100} wide, 20 to 50 kHz: {w.Num("noise_50k_db")} dB");
            Assert.True(s.Num("noise_50k_db") - w.Num("noise_50k_db") > 20, $"DSD{rate / 44100}: {s.Num("noise_50k_db")} against {w.Num("noise_50k_db")} dB");
        }
    }

    [Test]
    public async Task The_ninth_is_quieter_in_the_band_than_the_seventh_at_DSD64_and_DSD128()
    {
        Needs.Server();
        foreach (var (rate, ninth) in new[] { (2822400, -134.0), (5644800, -176.0) })
        {
            var n = await Mod("9", rate, 0.5);
            var s = await Mod("7", rate, 0.5);
            Assert.True(n.Num("noise_db") < ninth, $"DSD{rate / 44100} ninth, in the band: {n.Num("noise_db")} dB");
            Assert.True(n.Num("noise_db") < s.Num("noise_db") - 6, $"DSD{rate / 44100}: {n.Num("noise_db")} against the seventh's {s.Num("noise_db")} dB");
            Assert.Equal(-6.02, n.Num("tone_db")!.Value, 1);
        }
    }

    [Test]
    public async Task Each_holds_past_SACDs_highest_level_where_it_is_offered()
    {
        Needs.Server();
        foreach (var (mod, rate) in new[] { ("7w", 5644800), ("7w", 11289600), ("9", 2822400), ("9", 5644800) })
        {
            foreach (var amp in new[] { 0.714, 0.75 })
                Assert.True((await Mod(mod, rate, amp)).Num("resets") == 0, $"{mod} at DSD{rate / 44100}, {amp}: reset");
            Assert.True((await Mod(mod, rate, 0.714, "tones")).Num("resets") == 0, $"{mod} at DSD{rate / 44100}, three tones: reset");
        }
    }

    [Test]
    public async Task A_device_set_to_one_is_made_it_where_it_is_offered_in_a_file_of_its_own()
    {
        Needs.Server();
        var cd = JsonNode.Parse(Http.Json(new { path = "/m/a.flac", codec = "FLAC", sampleRate = 44100, bitsPerSample = 16, channels = 2 }))!;
        object Dev(int up, string? mod) => new
        {
            name = "DAC", rates = new[] { 44100, 88200, 176400, 352800, 705600 }, maxBits = 24, containers = new[] { "flac", "dsd" },
            dsd = new[] { 64, 128, 256 }, dsdMimes = new { dsf = "audio/dsf", dff = (string?)null }, mode = "original", dsd_out = up, dsd_mod = mod,
        };
        var cases = new object[][] { [cd, Dev(256, "7w")], [cd, Dev(64, "9")], [cd, Dev(256, "9")], [cd, Dev(64, "7w")], [cd, Dev(128, null)], [cd, Dev(128, "x")] };
        var p = (await Plans(new JsonObject { ["dsd_up"] = JsonNode.Parse(Http.Json(cases)) }))["dsd_up"]!.AsArray();
        Assert.Equal(("7w", "9"), (p[0].Str("mod"), p[1].Str("mod")));
        // Not offered there (the ninth at DSD256, the wide seventh at DSD64), none set, or no such one: the seventh order, by its absence.
        foreach (var i in new[] { 2, 3, 4, 5 }) Assert.Null(p[i]!["mod"]);
        // Its own file in the cache, the mark before the DSF's ending; the seventh's as before.
        var keys = (await Plans(new JsonObject
        {
            ["held_keys"] = new JsonArray(new JsonArray(7, 5, 44100, 1, true, false, false, false, 0, 256), new JsonArray(7, 5, 44100, 1, true, false, false, false, 0, 256, null, 44100, "7w")),
        }))["held_keys"]!.AsArray().Select(k => (string)k!).ToArray();
        Assert.Equal(keys[0][..^"-dsd256j".Length] + "-m7w-dsd256j", keys[1]);
        // The job says it to the making (UpsampleCommand.cs's DsdRun).
        var plan = new { transcode = true, hq = true, rate = 44100, bits = 1, dsdUp = 256, inRate = 44100, mod = "7w", reason = "" };
        var job = (await Plans(new JsonObject { ["dsd_job"] = JsonNode.Parse(Http.Json(new object[] { new object[] { "/m/a.flac", plan, "/tmp/x.dsf", true, 1.0 } })) }))["dsd_job"]![0]!;
        Assert.Equal("7w", job.Str("mod"));
    }

    [Test]
    public async Task The_setting_is_said_back_and_a_track_asked_for_by_one_is_made_by_it()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var s = await Session.Started();
        var id = s.Server.Rows("SELECT id FROM tracks WHERE path LIKE $1 AND sample_rate = 44100 ORDER BY id LIMIT 1", "%.flac")[0]["id"];
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        s.Server.Exec("INSERT INTO audio_devices(id, kind, network_name, first_seen, last_seen) VALUES($1, $2, $3, $4, $5)", "UPNP_test-mod", "upnp", "UPNP_test-mod", now, now);
        async Task<Http.Answer> Patch(object body) => await Http.Send(HttpMethod.Patch, s.Base + "/api/audio-devices/UPNP_test-mod",
            new StringContent(Http.Json(body), System.Text.Encoding.UTF8, "application/json"), s.H);
        var set = await Patch(new { output = new { dsd_out = 128, dsd_mod = "7w" } });
        Assert.True(set.Status == 200, set.Text);
        Assert.Equal("7w", set.J["output"].Str("dsd_mod"));
        var bad = await Patch(new { output = new { dsd_mod = "5" } });
        Assert.Equal((400, "dsd_mod must be 7, 7w or 9"), (bad.Status, bad.J.Str("error")));
        // The seventh order: the setting cleared, said by its absence.
        Assert.Null((await Patch(new { output = new { dsd_mod = "7" } })).J["output"]!["dsd_mod"]);

        // ?mod=: the wide seventh's DSF, its length the seventh's, its bits its own; the ninth not made at DSD256 (the seventh's instead).
        var seventh = await Bytes.Get(s.Base + $"/stream/t{id}.d128.dsf", s.H);
        var wide = await Bytes.Get(s.Base + $"/stream/t{id}.d128.dsf?mod=7w", s.H);
        Assert.Equal((200, 200), (seventh.Status, wide.Status));
        Assert.Equal(seventh.Body.Length, wide.Body.Length);
        Assert.False(seventh.Body.AsSpan().SequenceEqual(wide.Body), "the wide seventh's bits are its own");
        var at256 = await Bytes.Get(s.Base + $"/stream/t{id}.d256.dsf", s.H);
        var ninthAt256 = await Bytes.Get(s.Base + $"/stream/t{id}.d256.dsf?mod=9", s.H);
        Assert.True(at256.Body.AsSpan().SequenceEqual(ninthAt256.Body), "the ninth isn't made at DSD256: the seventh's file");
    }
}
