using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// The order a track goes through (bug list item 263): decode → 64-bit float → volume levelling → headroom → DSP, at
/// the track's own rate → upsampling → out. A conversion to another rate runs its bands before the resample, not after;
/// a track upsampled as it plays, or made DSD, has them in its decode, before the upsampler, and nothing after it but
/// the requantise; a device set to PCM as DSD is sent DSD with its DSP on (before, the DSP kept it on PCM). And the
/// headroom is what the DSP lifts the track by less what levelling has left it under full scale: a quiet track levelled
/// up 6 dB that still peaks 12 dB down has none taken off, measured on the file the server makes.
/// </summary>
public sealed partial class DspOrderTests
{
    private static JsonObject J(object o) => JsonNode.Parse(Http.Json(o))!.AsObject();
    private static async Task<JsonNode> Plans(JsonObject job) { job["fn"] = "plans"; return await Score.Run(job); }
    private static async Task<JsonNode> Dsp(JsonObject job) { job["fn"] = "dsp"; return await Score.Run(job); }

    private static readonly object Setting = new { enabled = true, peq = new { bands = new object[] { new { type = "peak", freq = 200, gain = 6, q = 1 } } } };

    // The bands' and the resample's places in a graph: (first band, resample), -1 for none.
    private static (int Band, int Resample) Places(string graph)
    {
        var parts = graph.Split(',');
        return (Array.FindIndex(parts, x => x.StartsWith("equalizer=", StringComparison.Ordinal)), Array.FindIndex(parts, x => x.StartsWith("aresample=", StringComparison.Ordinal) && x.Contains("osr=", StringComparison.Ordinal) && !x.Contains("dither", StringComparison.Ordinal)));
    }

    [Test]
    public async Task The_DSP_runs_at_the_tracks_own_rate_before_it_is_upsampled_or_made_DSD()
    {
        Needs.Server();
        var dsp = (await Dsp(new JsonObject { ["normalise"] = new JsonArray(J(Setting)) }))["normalise"]![0]!;
        var hi = J(new { path = "/m/b.flac", codec = "FLAC", sampleRate = 96000, bitsPerSample = 24, channels = 2 });
        var dac = J(new
        {
            name = "DAC", id = "UPNP_dac", rates = new[] { 44100, 48000, 88200, 96000, 176400, 192000 }, maxBits = 24, containers = new[] { "flac", "dsd" },
            dsd = new[] { 64, 128 }, dsdMimes = new { dsf = "audio/dsf", dff = (string?)null }, mode = "x2", bits = "auto", dsd_out = "off",
        });
        dac["dsp"] = dsp.DeepClone();
        // A conversion upsampled ×2: the bands, at 96 kHz, before the resample to 192 kHz; its headroom worked out at 96 kHz.
        var up = (await Plans(new JsonObject { ["plan"] = new JsonArray(new JsonArray(hi.DeepClone(), dac.DeepClone())) }))["plan"]![0]!.AsObject();
        Assert.Equal((192000.0, 96000.0), (up.Num("rate") ?? 0, up.Num("inRate") ?? 0));
        var part96 = (await Dsp(new JsonObject { ["plan_part"] = new JsonArray(new JsonArray(dsp.DeepClone(), 192000, 96000)) }))["plan_part"]![0]!;
        Assert.Equal(part96.Str("hash"), up["dsp"].Str("hash"));
        var args = (await Plans(new JsonObject { ["args"] = new JsonArray(new JsonArray("in.flac", up.DeepClone(), "out.flac", true)) }))["args"]![0]!.AsArray().Select(x => (string)x!).ToList();
        var graph = args[args.IndexOf("-af") + 1];
        var (band, resample) = Places(graph);
        Assert.True(band > 0 && resample > band, "the bands before the resample: " + graph);
        Assert.Contains($"volume={Js(up["dsp"].Num("headroom") ?? 0)}dB", graph);

        // Upsampled as it plays (a filter of its own shape): the gain, the headroom and the bands in the decode at 96 kHz; after the upsampler, the requantise alone.
        var shaped = up.DeepClone().AsObject();
        shaped["shape"] = "min"; shaped["gain"] = -2;
        var job = (await Plans(new JsonObject { ["pcm_job"] = new JsonArray(new JsonArray("in.flac", shaped, "out.flac")) }))["pcm_job"]![0]!;
        var decode = job["decode"]!.AsArray().Select(x => (string)x!).ToList();
        var pre = decode[decode.IndexOf("-af") + 1];
        Assert.Matches(@"^volume=volume=-2dB:precision=double,aformat=sample_fmts=dbl,volume=-[\d.]+dB:precision=double,equalizer=f=200:", pre);
        Assert.Equal("96000", decode[decode.IndexOf("-ar") + 1]);
        var encode = job["encode"]!.AsArray().Select(x => (string)x!).ToList();
        var after = encode[encode.IndexOf("-af") + 1];
        Assert.DoesNotContain("equalizer", after);
        Assert.DoesNotContain("volume", after);

        // Set to PCM as DSD: made DSD with the DSP on, which names its file; the bands at 96 kHz, then SoX to 88.2 kHz, before the modulator's upsampler.
        var dsdDac = dac.DeepClone().AsObject();
        dsdDac["mode"] = "original"; dsdDac["dsd_out"] = 64;
        dsdDac["rates"] = new JsonArray(44100, 48000, 88200, 96000, 176400);   // not 192 kHz, DSD64 in 48 kHz's family (item 261)
        var made = (await Plans(new JsonObject { ["dsd_up"] = new JsonArray(new JsonArray(hi.DeepClone(), dsdDac)) }))["dsd_up"]![0]!.AsObject();
        Assert.Equal(("dsf", 64.0), (made.Str("ext"), made.Num("dsdUp") ?? 0));
        Assert.Equal(part96.Str("hash"), made["dsp"].Str("hash"));
        var keys = (await Plans(new JsonObject { ["keys"] = new JsonArray(new JsonArray(J(new { id = 7, mtime = 5 }), made.DeepClone())) }))["keys"]![0]!;
        Assert.Contains("-d" + part96.Str("hash"), (string)keys!);
        var dsdJob = (await Plans(new JsonObject { ["dsd_job"] = new JsonArray(new JsonArray("in.flac", made.DeepClone(), "out.dsf", true, 4.0)) }))["dsd_job"]![0]!;
        var dsdDecode = dsdJob["decode"]!.AsArray().Select(x => (string)x!).ToList();
        var dsdPre = dsdDecode[dsdDecode.IndexOf("-af") + 1];
        var (b2, r2) = Places(dsdPre);
        Assert.True(b2 > 0 && r2 > b2 && dsdPre.Contains("osr=88200", StringComparison.Ordinal), "the bands at 96 kHz, then to 88.2 kHz: " + dsdPre);
        Assert.Equal(88200, dsdJob.Num("rate"));
    }

    [Test]
    public async Task The_headroom_is_what_the_DSP_lifts_less_what_levelling_has_left_under_full_scale()
    {
        Needs.Server();
        // [auto, peak, gain]: a track at full scale levelled down 8 dB needs none of the 6.5; one peaking 6 dB down turned
        // up 3 dB, 3.5 of it; one not levelled, all of it; one whose peak isn't known, all of it; never above 0 dB.
        var got = (await Dsp(new JsonObject { ["levelled"] = JsonNode.Parse("[[-6.5, 1, -8], [-6.5, 0.5, 3], [-6.5, 1, 0], [-6.5, 0, -8], [0, 1, 2]]") }))["levelled"]!.AsArray();
        JsonAssert.Same("[0, -3.5, -6.5, -6.5, -2]", got);
    }

    [GeneratedRegex(@"Peak level dB:\s*(-?[\d.]+)")] private static partial Regex PeakDb();

    // A file's peak in dBFS.
    private static double Peak(string file)
    {
        var r = Fixtures.Run(["-hide_banner", "-i", file, "-af", "astats=measure_overall=Peak_level:measure_perchannel=none", "-f", "null", "-"]);
        var m = PeakDb().Match(r.Err);
        Assert.True(m.Success, "astats: " + r.Err[Math.Max(0, r.Err.Length - 400)..]);
        return double.Parse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
    }

    [Test]
    public async Task A_quiet_track_levelled_up_has_only_the_headroom_it_still_needs_taken_off()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var s = await Session.Started();
        await Session.Until(async () => (await s.Api("library-stats")).J.Num("albums") == 3, 30000, "the library");
        var song = s.Server.Rows("SELECT * FROM tracks WHERE title = $1", "Song 1")[0];   // a 200 Hz tone at ffmpeg's −18 dB
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        s.Server.Exec("INSERT INTO audio_devices(id, kind, network_name, first_seen, last_seen) VALUES($1, $2, $3, $4, $5)", "UPNP_order", "upnp", "UPNP_order", now, now);
        var set = await Http.Send(HttpMethod.Patch, s.Base + "/api/audio-devices/UPNP_order", new StringContent(Http.Json(new { dsp = Setting }), System.Text.Encoding.UTF8, "application/json"), s.H);
        Assert.True(set.Status == 200, set.Text);
        var made = Path.Combine(s.Lib.Data, "transcode");
        var source = Peak((string)song["path"]!);
        // Levelled up 6 dB, the tone lifted 6 dB by the band: made, its file's peak read; the cache emptied between.
        async Task<double> Made(object? peak)
        {
            s.Server.Exec("UPDATE tracks SET rg_track_gain = -8, rg_track_peak = $1 WHERE id = $2", peak!, song["id"]!);
            foreach (var f in Directory.Exists(made) ? Directory.GetFiles(made) : []) File.Delete(f);
            var got = await Bytes.Get(s.Base + $"/stream/t{song["id"]}.44100-24.flac?o=UPNP_order&g=6", s.H);
            Assert.True(got.Status == 200, "the stream: " + got.Status);
            var file = Path.Combine(s.Lib.Root, $"order-{Guid.NewGuid():N}.flac");
            await File.WriteAllBytesAsync(file, got.Body);
            return Peak(file);
        }
        // Its peak not known: the 6.5 dB the band needs, as before.
        var unknown = await Made(DBNull.Value);
        Assert.True(Math.Abs(unknown - (source + 6 + 6 - 6.5)) < 0.3, $"peak unknown: {unknown:F2} dBFS from {source:F2}");
        // Known (the tone's own): levelled, it peaks 12 dB down, room enough for the band; nothing taken off, nothing clipped.
        var known = await Made(Math.Pow(10, source / 20));
        Assert.True(Math.Abs(known - (source + 6 + 6)) < 0.3, $"peak known: {known:F2} dBFS from {source:F2}");
        Assert.True(known < -0.5, "under full scale: " + known);
    }

    // A number as JavaScript writes it into a string.
    private static string Js(double v) => JsonValue.Create(v).ToJsonString();
}
