using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// DSP (Stage 3): the shared biquad maths, the headroom rule, what a setting becomes as ffmpeg filters
/// and in a renderer's plan — and, with ffmpeg, a tone through the chain measured: a −6 dB band at its
/// frequency takes 6 dB off, and the preamp is what the bands need. The biquad maths is the page's own
/// (public/biquad.js, run here in Chromium, the browser it is written for); the filters and plans the
/// server's (Playback/Dsp.cs, StreamPlans.cs), asked through `mandarin-server score`
/// (test/dsp.test.js, in C#).
/// </summary>
public sealed partial class DspTests
{
    // The page's Biquad, in a browser of its own.
    private sealed class PageBiquad : IAsyncDisposable
    {
        private Browser? b;
        private Page? p;
        public static async Task<PageBiquad> Open()
        {
            Browser.Need();
            var o = new PageBiquad { b = await Browser.Launch() };
            o.p = await o.b.Page("about:blank");
            await o.p.Eval(await File.ReadAllTextAsync(Path.Combine(ServerProcess.Root, "public", "biquad.js")));
            return o;
        }
        // An expression with Biquad in scope: its value.
        public Task<JsonNode?> Of(string expr) => p!.Eval(expr);
        public async Task<double> Num(string expr) => (await Of(expr))!.GetValue<double>();
        // What Biquad.normalise(setting) refuses, in its words (null: taken).
        public async Task<string?> Refusal(string setting) => (string?)await Of($"(() => {{ try {{ Biquad.normalise({setting}); return null; }} catch (e) {{ return e.message; }} }})()");
        public async ValueTask DisposeAsync() { if (b != null) await b.DisposeAsync(); }
    }

    private static void Near(double a, double b, double tol, string what) => Assert.True(Math.Abs(a - b) <= tol, $"{what}: {a} vs {b}");

    // The server's: a setting checked, its preamp and fingerprint, its filters and plan part; a track's plan and ffmpeg's arguments.
    private static async Task<JsonNode?> Dsp(string what, JsonNode arg) => (await Score.Run(new JsonObject { ["fn"] = "dsp", [what] = new JsonArray(arg) }))[what]![0];
    private static Task<JsonNode?> Normalise(string d) => Dsp("normalise", JsonNode.Parse(d)!);
    private static async Task<double> Headroom(JsonNode d, int rate) => (await Dsp("headroom", new JsonArray(d.DeepClone(), rate)))!.GetValue<double>();
    private static async Task<string?> Fingerprint(JsonNode d, int rate) => (string?)await Dsp("fingerprint", new JsonArray(d.DeepClone(), rate));
    private static async Task<List<string>> Filters(JsonNode d, int inRate, int rate, bool soxr) =>
        [.. (await Dsp("filters", new JsonArray(d.DeepClone(), inRate, rate, soxr)))!.AsArray().Select(x => (string)x!)];
    private static Task<JsonNode?> PlanPart(JsonNode d, int rate) => Dsp("plan_part", new JsonArray(d.DeepClone(), rate));
    private static async Task<JsonNode> Plan(JsonNode t, JsonNode target) =>
        (await Score.Run(new JsonObject { ["fn"] = "plans", ["plan"] = new JsonArray(new JsonArray(t.DeepClone(), target.DeepClone())) }))["plan"]![0]!;
    private static async Task<List<string>> FfmpegArgs(string src, JsonNode p, string dest, bool soxr) =>
        [.. (await Score.Run(new JsonObject { ["fn"] = "plans", ["args"] = new JsonArray(new JsonArray(src, p.DeepClone(), dest, soxr)) }))["args"]![0]!.AsArray().Select(x => (string)x!)];

    private static JsonObject With(JsonNode a, string over)
    {
        var o = (JsonObject)a.DeepClone();
        foreach (var (k, v) in JsonNode.Parse(over)!.AsObject()) o[k] = v?.DeepClone();
        return o;
    }

    [Test]
    public async Task The_bands_the_cookbooks_responses()
    {
        await using var bq = await PageBiquad.Open();
        Task<double> At(string bands, int f, int fs = 48000) => bq.Num($"Biquad.response({bands}, {fs}, [{f}])[0]");
        const string peak = """[{ type: "peak", freq: 1000, gain: 6, q: 1.41 }]""";
        Near(await At(peak, 1000), 6, 0.01, "a +6 dB peak at its centre");
        Near(await At(peak, 100), 0, 0.1, "and nothing three octaves down");
        Near(await At("""[{ type: "peak", freq: 1000, gain: -6, q: 1.41 }]""", 1000), -6, 0.01, "a −6 dB cut at its centre");
        const string ls = """[{ type: "low_shelf", freq: 1000, gain: 4, q: 0.707 }]""";
        Near(await At(ls, 30), 4, 0.05, "a low shelf's full lift well below its corner");
        Near(await At(ls, 15000), 0, 0.05, "and none well above");
        const string hs = """[{ type: "high_shelf", freq: 2000, gain: -3, q: 0.707 }]""";
        Near(await At(hs, 18000), -3, 0.1, "a high shelf's cut at the top");
        Near(await At(hs, 100), 0, 0.05, "and none at the bottom");
        const string hp = """[{ type: "high_pass", freq: 80, q: 0.707 }]""";
        Near(await At(hp, 80), -3.01, 0.05, "a Butterworth high-pass is −3 dB at its corner");
        Assert.True(await At(hp, 20) < -20, "and well down an octave and more below");
        const string lp = """[{ type: "low_pass", freq: 8000, q: 0.707 }]""";
        Near(await At(lp, 8000), -3.01, 0.05, "a low-pass likewise");
        Assert.True(await At(lp, 20000) < -12, "and down above");
        // The same at 96 kHz: the design is per sample rate.
        Near(await At(peak, 1000, 96000), 6, 0.01, "at 96 kHz too");
    }

    [Test]
    public async Task Headroom_the_combined_peak_not_the_largest_band()
    {
        await using var bq = await PageBiquad.Open();
        const string one = """{ enabled: true, peq: { bands: [{ type: "peak", freq: 1000, gain: 6, q: 1.41 }] }, headroom: "auto" }""";
        Assert.Equal(-6.5, await bq.Num($"Biquad.headroom({one}, 48000)"));
        // Two +3 dB bands an octave apart, wide: together they reach past either.
        const string two = """{ enabled: true, peq: { bands: [{ type: "peak", freq: 800, gain: 3, q: 0.5 }, { type: "peak", freq: 1200, gain: 3, q: 0.5 }] }, headroom: "auto" }""";
        var peak = await bq.Num($"Biquad.peakDb(Biquad.bandsOf({two}), 48000)");
        Assert.True(peak > 5 && peak < 6, "overlapping bands add: " + peak);
        Assert.True(await bq.Num($"Biquad.headroom({two}, 48000)") <= -(peak + 0.5) + 0.05);
        // Only cuts: nothing to take away.
        Assert.Equal(-0.5, await bq.Num("""Biquad.headroom({ enabled: true, peq: { bands: [{ type: "peak", freq: 1000, gain: -6, q: 1.41 }] }, headroom: "auto" }, 48000)"""));
        // A profile's own preamp stands when it covers the peak, else the measured one.
        string Hp(int preamp) => $$"""{ enabled: true, headphone: { name: "x", preamp: {{preamp}}, bands: [{ type: "peak", freq: 1000, gain: 6, q: 1.41 }] }, headroom: "auto" }""";
        Assert.Equal(-8, await bq.Num($"Biquad.headroom({Hp(-8)}, 48000)"));
        Assert.Equal(-6.5, await bq.Num($"Biquad.headroom({Hp(-3)}, 48000)"));
        // Set by hand: as it is.
        Assert.Equal(-2, await bq.Num($"Biquad.headroom(Object.assign({{}}, {one}, {{ headroom: -2 }}), 48000)"));
        // Headphone bands then PEQ bands, in that order.
        JsonAssert.Same("[100, 200]", await bq.Of("""Biquad.bandsOf({ enabled: true, headphone: { bands: [{ type: "peak", freq: 100, gain: 1, q: 1 }] }, peq: { bands: [{ type: "peak", freq: 200, gain: 2, q: 1 }] } }).map(b => b.freq)"""));
    }

    [Test]
    public async Task A_setting_as_stored_checked_rounded_refused_when_wrong()
    {
        await using var bq = await PageBiquad.Open();
        const string raw = """{ enabled: "yes", peq: { bands: [{ type: "peak", freq: "1000.04", gain: 2.26, q: "1.4142" }, { type: "low_pass", freq: 120, gain: 5 }] }, headroom: -3.04 }""";
        var d = (await bq.Of($"Biquad.normalise({raw})"))!;
        Assert.True(d.Bool("enabled"));
        JsonAssert.Same("""{ "type": "peak", "freq": 1000, "gain": 2.3, "q": 1.414 }""", d["peq"]?["bands"]?[0]);
        JsonAssert.Same("""{ "type": "low_pass", "freq": 120, "gain": 0, "q": 0.707 }""", d["peq"]?["bands"]?[1], "a pass filter has no gain");
        Assert.Equal(-3, d.Num("headroom"));
        Assert.Null(d["headphone"]);
        JsonAssert.Same("""{ "enabled": false, "headphone": null, "peq": null, "headroom": "auto" }""", await bq.Of("Biquad.normalise(null)"));
        foreach (var (setting, says) in new[]
        {
            ("""{ peq: { bands: [{ type: "notch", freq: 100 }] } }""", "band type"),
            ("""{ peq: { bands: [{ type: "peak", freq: 5, gain: 0 }] } }""", "frequency"),
            ("""{ peq: { bands: [{ type: "peak", freq: 100, gain: 30 }] } }""", "gain"),
            ("""{ peq: { bands: [{ type: "peak", freq: 100, gain: 0, q: 50 }] } }""", "Q"),
            ("{ headroom: 3 }", "headroom"),
            ("""{ peq: { bands: new Array(11).fill({ type: "peak", freq: 100, gain: 0 }) } }""", "at most 10")
        })
        {
            var refused = await bq.Refusal(setting);
            Assert.True(refused != null && refused.Contains(says, StringComparison.Ordinal), setting + ": " + refused);
        }
        // On with no bands does nothing; the same bands fingerprint the same.
        Assert.False((await bq.Of("Biquad.active({ enabled: true, peq: { bands: [] } })"))!.GetValue<bool>());
        Assert.True((await bq.Of($"Biquad.active(Biquad.normalise({raw}))"))!.GetValue<bool>());
        Assert.True((await bq.Of($"(d => Biquad.fingerprint(d, 48000) === Biquad.fingerprint(JSON.parse(JSON.stringify(d)), 48000))(Biquad.normalise({raw}))"))!.GetValue<bool>());
        Assert.True((await bq.Of($"(d => Biquad.fingerprint(d, 48000) !== Biquad.fingerprint(Object.assign({{}}, d, {{ headroom: -4 }}), 48000))(Biquad.normalise({raw}))"))!.GetValue<bool>());
    }

    [Test]
    public async Task The_filters_ffmpeg_runs_and_the_plan_a_renderer_gets()
    {
        Needs.Server();
        await using var bq = await PageBiquad.Open();
        var dsp = (await Normalise("""
            { "enabled": true, "peq": { "bands": [
              { "type": "peak", "freq": 1000, "gain": -6, "q": 1.41 }, { "type": "low_shelf", "freq": 100, "gain": 2, "q": 0.707 }, { "type": "high_pass", "freq": 30, "q": 0.707 } ] } }
            """))!;
        var f = await Filters(dsp, 44100, 88200, true);
        Assert.Equal("aformat=sample_fmts=dbl", f[0]);
        var pre = await Headroom(dsp, 88200);
        Assert.True(pre == await bq.Num($"Biquad.headroom({dsp.ToJsonString()}, 88200)"), "the page's own sum");
        Assert.True(pre < -1 && pre > -3, "the shelf's lift, less what the high-pass takes: " + pre);
        Assert.Equal($"volume={Js(pre)}dB:precision=double", f[1]);
        Assert.Equal("aresample=resampler=soxr:precision=33:internal_sample_fmt=dblp:osr=88200:out_sample_fmt=dbl", f[2]);
        Assert.Equal(["equalizer=f=1000:width_type=q:w=1.41:g=-6", "lowshelf=f=100:width_type=q:w=0.707:g=2", "highpass=f=30:width_type=q:w=0.707"], f.Skip(3));
        // Same rate: no resample stage.
        Assert.Equal(5, (await Filters(dsp, 44100, 44100, true)).Count);

        var cd = JsonNode.Parse("""{ "path": "/m/a.flac", "codec": "flac", "sampleRate": 44100, "bitsPerSample": 16, "channels": 2 }""")!;
        var target = JsonNode.Parse("""{ "name": "WiiM", "rates": [44100, 48000, 88200, 96000], "maxBits": 24, "containers": ["flac"], "mode": "original", "bits": "auto", "id": "UPNP_x" }""")!;
        Assert.True((await Plan(cd, target)).Bool("transcode") == false, "bit-perfect without DSP");
        var withDsp = With(target, "{}"); withDsp["dsp"] = dsp.DeepClone();
        var on = await Plan(cd, withDsp);
        Assert.True(on.Bool("transcode"));
        Assert.True(on.Num("rate") == 44100, "the file's own rate");
        Assert.Equal(24, on.Num("bits"));
        Assert.Equal("DSP", on.Str("reason"));
        Assert.Equal(await Fingerprint(dsp, 44100), on["dsp"].Str("hash"));
        Assert.True(on["dsp"].Str("hash") == (string?)await bq.Of($"Biquad.fingerprint({dsp.ToJsonString()}, 44100)"), "the page's own fingerprint");
        Assert.Equal(44100, on.Num("inRate"));
        var x2 = With(withDsp, """{ "mode": "x2" }""");
        var up = await Plan(cd, x2);
        Assert.Equal((88200.0, 2.0), (up.Num("rate") ?? 0, up.Num("upsampled") ?? 0));
        Assert.NotNull(up["dsp"]);
        // Off, or on with nothing to do: as without.
        var off = With(target, "{}"); off["dsp"] = With(dsp, """{ "enabled": false }""");
        Assert.False((await Plan(cd, off)).Bool("transcode"));
        Assert.False((await Plan(cd, With(target, """{ "dsp": { "enabled": true, "peq": { "bands": [] } } }"""))).Bool("transcode"));
        // The graph: float, preamp, the bands, then the one dithered requantise.
        var args = await FfmpegArgs("in.flac", on, "out.flac", true);
        Assert.Matches(@"^aformat=sample_fmts=dbl,volume=-[\d.]+dB:precision=double,equalizer=.*,aresample=osr=44100:dither_method=triangular$", args[args.IndexOf("-af") + 1]);
        Assert.Equal("s32", args[args.IndexOf("-sample_fmt") + 1]);
        Assert.Equal("24", args[args.IndexOf("-bits_per_raw_sample") + 1]);
    }

    // A number as JavaScript writes it into a string.
    private static string Js(double v) => JsonValue.Create(v).ToJsonString();

    [GeneratedRegex(@"RMS level dB:\s*(-?[\d.]+)")] private static partial Regex Rms();

    private static double Level(string file, string? filter = null)
    {
        var r = Fixtures.Run(["-hide_banner", "-i", file, "-af", (filter != null ? filter + "," : "") + "astats=measure_overall=RMS_level:measure_perchannel=none", "-f", "null", "-"]);
        var m = Rms().Match(r.Err);
        Assert.True(m.Success, "astats: " + r.Err[Math.Max(0, r.Err.Length - 400)..]);
        return double.Parse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
    }

    [Test]
    public async Task Through_ffmpeg_a_tone_at_the_bands_frequency_comes_out_6_dB_down_and_the_preamp_is_applied()
    {
        Needs.Server(); Needs.Ffmpeg();
        var soxr = Fixtures.HaveSoxr;
        var dir = Directory.CreateTempSubdirectory("musicd-dsp-").FullName;
        try
        {
            var src = Path.Combine(dir, "tone.flac");
            Fixtures.Gen(src, seconds: 2, freq: 1000, rate: 44100, fmt: "s16");
            var before = Level(src);
            async Task<JsonObject> Part(string setting, int rate) => JsonNode.Parse(
                $$"""{ "transcode": true, "hq": true, "rate": {{rate}}, "bits": 24, "inRate": 44100, "dsp": {{(await PlanPart((await Normalise(setting))!, rate))!.ToJsonString()}} }""")!.AsObject();
            async Task Convert(JsonNode plan, string output)
            {
                var r = Fixtures.Run(await FfmpegArgs(src, plan, output, soxr));
                Assert.True(r.Code == 0, r.Err);
            }
            // A −6 dB band on the tone: 6 dB off, and the preamp (no lift, so −0.5) too.
            const string cutSetting = """{ "enabled": true, "peq": { "bands": [{ "type": "peak", "freq": 1000, "gain": -6, "q": 1.41 }] } }""";
            var cut = await Part(cutSetting, 44100);
            var outCut = Path.Combine(dir, "cut.flac");
            await Convert(cut, outCut);
            Near(Level(outCut), before - 6.5, 0.15, "−6 dB band and −0.5 dB headroom");
            Assert.Equal((44100, 2, 24), Fixtures.Probe(await File.ReadAllBytesAsync(outCut)));
            // A +6 dB band elsewhere: the tone is untouched by the band but the preamp takes the 6.5 dB the
            // band would add at its own frequency.
            var lift = await Part("""{ "enabled": true, "peq": { "bands": [{ "type": "peak", "freq": 8000, "gain": 6, "q": 4 }] } }""", 44100);
            var outLift = Path.Combine(dir, "lift.flac");
            await Convert(lift, outLift);
            Near(Level(outLift), before - 6.5, 0.15, "the preamp alone");
            // Upsampled ×2 with DSP: 88.2 kHz out, the band still at work.
            var up = With(cut, """{ "rate": 88200, "upsampled": 2 }""");
            up["dsp"] = (await PlanPart(cut["dsp"]!["dsp"]!, 88200))!.DeepClone();
            var outUp = Path.Combine(dir, "up.flac");
            await Convert(up, outUp);
            Assert.Equal((88200, 2, 24), Fixtures.Probe(await File.ReadAllBytesAsync(outUp)));
            Near(Level(outUp), before - 6.5, 0.2, "at 88.2 kHz too");
        }
        finally { Directory.Delete(dir, true); }
    }
}
