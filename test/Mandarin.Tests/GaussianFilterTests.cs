using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The three Gaussian filters (bug list item 298, Upsample/Gaussian.cs), measured from their own taps against the
/// standard filter's: Gaussian, flat to 19.75 kHz for a CD, half a dB down at 20 kHz, 100 dB down by the source's
/// Nyquist and ringing a quarter as long before a click; Gaussian steep, flat to 21.8 kHz, half down at the Nyquist and
/// keeping every sample of the source as it was; Gaussian hi-res, flat through all of hearing for a 96 kHz source and
/// ringing a fifth of a millisecond. Each runs in the upsampler as the others do: the band through as it was, the
/// channels apart, the same output however the input comes in blocks. And a device's filter for hi-res sources is the
/// one a track of 88.2 kHz and up is planned in, a CD's keeping the device's filter.
/// </summary>
public sealed class GaussianFilterTests
{
    private static async Task<JsonNode> Run(object job) => await Score.Run(job);

    private static async Task<(double[] Gains, double PreMs, double KeepsDb)> Taps(int rate, int factor, string? shape, params int[] at)
    {
        var r = await Run(new { fn = "upsample", taps = true, rate, factor, shape, at });
        return (r["gains_db"]!.AsArray().Select(g => (double)g!).ToArray(), r.Num("pre_ms")!.Value, r.Num("keeps_db")!.Value);
    }

    [Test]
    public async Task Gaussian_is_flat_to_nearly_20_kHz_100_dB_down_at_the_Nyquist_and_rings_a_quarter_as_long()
    {
        var (g, pre, _) = await Taps(44100, 16, "gauss", 1000, 15000, 19500, 20000, 22050, 24000);
        var (_, standardPre, _) = await Taps(44100, 16, null, 1000);
        foreach (var x in g[..3]) Assert.True(x > -0.1, $"the band through: {x} dB");
        Assert.True(g[3] < -0.4 && g[3] > -0.65, $"20 kHz: {g[3]} dB");
        Assert.True(g[4] < -99, $"the source's Nyquist: {g[4]} dB (apodizing)");
        Assert.True(g[5] < -150, $"24 kHz, an image: {g[5]} dB");
        Assert.True(pre < 2.2 && pre < standardPre / 3.5, $"its ringing before a click: {pre} ms, the standard filter's {standardPre} ms");
    }

    [Test]
    public async Task Gaussian_steep_is_flat_to_21_8_kHz_half_down_at_the_Nyquist_and_keeps_the_source_samples()
    {
        var (g, pre, keeps) = await Taps(44100, 16, "gauss-steep", 1000, 21000, 21800, 22050, 22500, 24000);
        foreach (var x in g[..3]) Assert.True(x > -0.1, $"the band through: {x} dB");
        Assert.True(Math.Abs(g[3] + 6.02) < 0.05, $"the Nyquist: {g[3]} dB (not apodizing)");
        Assert.True(g[4] < -100 && g[5] < -200, $"the images: {g[4]} dB at 22.5 kHz, {g[5]} dB at 24 kHz");
        // Every [factor]th tap but the middle is nothing: the source's own samples come out as they went in.
        Assert.True(keeps < -250, $"its taps between the source's samples: {keeps} dB");
        Assert.True(pre < 7, $"its ringing before a click: {pre} ms");
    }

    [Test]
    public async Task Gaussian_hires_is_flat_through_hearing_for_a_96_kHz_source_and_rings_a_fifth_of_a_millisecond()
    {
        var (g, pre, _) = await Taps(96000, 8, "gauss-hires", 1000, 20000, 25000, 48000, 52000);
        foreach (var x in g[..3]) Assert.True(x > -0.12, $"through hearing and past it: {x} dB");
        Assert.True(g[3] < -98 && g[4] < -150, $"its Nyquist {g[3]} dB, an image {g[4]} dB");
        Assert.True(pre < 0.3, $"its ringing before a click: {pre} ms");
    }

    [Test]
    public async Task Each_runs_in_the_upsampler_as_the_others_do()
    {
        foreach (var (shape, rate, factor) in new[] { ("gauss", 44100, 16), ("gauss-steep", 44100, 4), ("gauss-hires", 96000, 8) })
        {
            var r = await Run(new { fn = "upsample", rate, factor, seconds = 3, shape, tones = new[] { new[] { 1000, 0.5 }, new[] { 12000, 0.2 } } });
            Assert.True(r.Num("error_db") < -185, $"{shape}: the band's tones {r.Num("error_db")} dB from exact");
            Assert.True(r.Num("leak_db") < -250, $"{shape}: the channels apart ({r.Num("leak_db")} dB)");
            Assert.True(r.Num("blocks_db") < -280, $"{shape}: other blocks, {r.Num("blocks_db")} dB apart");
            Assert.Equal(3.0 * rate * factor, r.Num("out_frames"));
        }
    }

    private static object Dev(string filter, string? hires, int? dsdOut = null) => new
    {
        name = "SMSL SU-1", rates = new[] { 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000 }, maxBits = 32,
        containers = new[] { "flac", "wav", "dsd" }, dsd = new[] { 64, 128, 256 }, dsdMimes = new { dsf = "audio/dsf", dff = (string?)null },
        mode = "x2", filter, filter_hires = hires, dsd_out = (object?)dsdOut ?? "off",
    };

    [Test]
    public async Task A_hi_res_track_is_planned_in_the_devices_filter_for_hi_res_sources_a_CDs_in_its_filter()
    {
        Needs.Server();
        JsonObject Track(int rate) => JsonNode.Parse(Http.Json(new { path = "/m/a.flac", codec = "FLAC", sampleRate = rate, bitsPerSample = 24, channels = 2 }))!.AsObject();
        var r = await Score.Run(new JsonObject
        {
            ["fn"] = "plans",
            ["shaped"] = JsonNode.Parse(Http.Json(new object[][]
            {
                [Track(44100), Dev("gaussian", "gaussian-hires")], [Track(96000), Dev("gaussian", "gaussian-hires")],
                [Track(96000), Dev("gaussian", null)], [Track(96000), Dev("gaussian", "standard")], [Track(48000), Dev("gaussian-steep", "gaussian-hires")],
            })),
            ["dsd_up"] = JsonNode.Parse(Http.Json(new object[][] { [Track(44100), Dev("gaussian", "gaussian-hires", 256)], [Track(96000), Dev("gaussian", "gaussian-hires", 256)] })),
        });
        var p = r["shaped"]!.AsArray();
        Assert.Equal(("gauss", 44100.0), (p[0].Str("shape"), p[0].Num("inRate")!.Value));
        Assert.Equal(("gauss-hires", 96000.0), (p[1].Str("shape"), p[1].Num("inRate")!.Value));
        Assert.EndsWith("(Gaussian hi-res filter)", p[1].Str("reason"), StringComparison.Ordinal);
        // None set for hi-res sources: the device's filter for every track.
        Assert.Equal("gauss", p[2].Str("shape"));
        // The standard filter for hi-res sources is a choice too: none of the device's filter for them.
        Assert.Null(p[3].Str("shape"));
        // 48 kHz is a CD's family's rate: the device's filter.
        Assert.Equal("gauss-steep", p[4].Str("shape"));
        // Made DSD: the way to 705.6 or 768 kHz in the filter for the track's rate.
        var d = r["dsd_up"]!.AsArray();
        Assert.Equal((256.0, "gauss"), (d[0].Num("dsdUp")!.Value, d[0].Str("shape")));
        Assert.Equal((256.0, "gauss-hires"), (d[1].Num("dsdUp")!.Value, d[1].Str("shape")));
    }

    [Test]
    public async Task A_devices_filter_for_hi_res_sources_is_set_kept_and_cleared_by_same()
    {
        Needs.Server();
        await using var s = await Session.Started();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        s.Server.Exec("INSERT INTO audio_devices(id, kind, network_name, first_seen, last_seen) VALUES($1, $2, $3, $4, $5)", "UPNP_test-hires", "upnp", "UPNP_test-hires", now, now);
        Task<Http.Answer> Patch(object output) => Http.Send(HttpMethod.Patch, s.Base + "/api/audio-devices/UPNP_test-hires",
            new StringContent(Http.Json(new { output }), System.Text.Encoding.UTF8, "application/json"), s.H);
        var set = await Patch(new { mode = "x2", filter = "gaussian", filter_hires = "gaussian-hires" });
        Assert.Equal((200, "gaussian", "gaussian-hires"), (set.Status, set.J["output"].Str("filter"), set.J["output"].Str("filter_hires")));
        // Kept: read again, and through a change of something else.
        Assert.Equal("gaussian-hires", (await Patch(new { mode = "x4" })).J["output"].Str("filter_hires"));
        Assert.Equal("gaussian-hires", (await s.Api("audio-devices/UPNP_test-hires")).J["output"].Str("filter_hires"));
        // The standard one is a choice of its own; "same" clears it.
        Assert.Equal("standard", (await Patch(new { filter_hires = "standard" })).J["output"].Str("filter_hires"));
        var same = await Patch(new { filter_hires = "same" });
        Assert.Equal((200, (string?)null), (same.Status, same.J["output"].Str("filter_hires")));
        Assert.Equal("gaussian", same.J["output"].Str("filter"));
        // Only a filter, or the same.
        Assert.Equal(400, (await Patch(new { filter_hires = "whole" })).Status);
        Assert.Equal(400, (await Patch(new { filter = "same" })).Status);
    }
}
