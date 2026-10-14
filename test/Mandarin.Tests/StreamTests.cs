using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// What a track is sent as: Sonos's 24/48 ceiling, a renderer's plan within its own, native DSD, the
/// 64-bit float pipeline and its cache key, and a repack that is sample for sample
/// (Playback/StreamPlans.cs, asked through `mandarin-server score` { fn: "plans" };
/// test/stream.test.js, in C#).
/// </summary>
public sealed class StreamTests
{
    private static async Task<JsonNode> Plans(JsonObject job) { job["fn"] = "plans"; return await Score.Run(job); }

    // plan(track, target): each [track, target?] → its plan; no target is Sonos.
    private static async Task<JsonArray> Plan(params object[][] calls) =>
        (await Plans(new JsonObject { ["plan"] = JsonNode.Parse(Http.Json(calls)) }))["plan"]!.AsArray();

    private static (double?, double?, double?) Pick(JsonNode? p) => (p.Num("rate"), p.Num("bits"), p.Num("upsampled"));

    // A track or target with fields laid over another's (Object.assign).
    private static JsonObject With(JsonObject a, object over)
    {
        var o = (JsonObject)a.DeepClone();
        foreach (var (k, v) in JsonNode.Parse(Http.Json(over))!.AsObject()) o[k] = v?.DeepClone();
        return o;
    }

    private static JsonObject J(object o) => JsonNode.Parse(Http.Json(o))!.AsObject();

    [Test]
    public async Task A_renderers_plan_Original_within_its_ceiling_upsampling_in_the_files_family()
    {
        Needs.Server();
        var wiim = J(new { name = "WiiM", rates = new[] { 44100, 48000, 88200, 96000, 176400, 192000 }, maxBits = 24, containers = new[] { "flac", "wav" } });
        var poly = J(new { name = "Poly", rates = new[] { 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000 }, maxBits = 32, containers = new[] { "flac" } });
        var cd = J(new { path = "/m/a.flac", codec = "FLAC", sampleRate = 44100, bitsPerSample = 16, channels = 2 });
        var hi = With(cd, new { sampleRate = 96000, bitsPerSample = 24 });
        var dsf = J(new { path = "/m/a.dsf", codec = "DSD", sampleRate = 2822400, bitsPerSample = 1 });
        var dff = With(dsf, new { path = "/m/a.dff" });
        // Native DSD (Stage 9.3): a device that takes DSD64 gets the DSF as it is; DSD128 beyond it is PCM as before.
        var dsdDac = With(wiim, new { dsd = new[] { 64 } });
        // A renderer that names its own DSD type is told the file in those words (v0.6.0-RC3).
        var named = With(dsdDac, new { dsdMimes = new { dsf = "audio/dsf", dff = (string?)null } });
        JsonObject Mode(string m, JsonObject target, object? more = null) { var o = With(target, new { mode = m }); return more == null ? o : With(o, more); }
        var low = J(new { rates = new[] { 44100, 48000 }, containers = new[] { "flac" } });
        var p = await Plan([cd, wiim], [hi, wiim], [With(cd, new { sampleRate = 352800 }), wiim], [hi, low],
            [cd, Mode("x2", wiim)], [cd, Mode("x4", wiim)], [cd, Mode("max", wiim)], [hi, Mode("x4", wiim)], [With(hi, new { sampleRate = 192000 }), Mode("max", wiim)],
            [cd, Mode("max", poly, new { bits = "auto" })], [cd, Mode("max", poly, new { bits = 24 })], [With(cd, new { sampleRate = 48000 }), Mode("max", poly)],
            // A lossy file follows the same rules; DSD is PCM at the top of the 44.1 ladder ≤ 176.4.
            [J(new { path = "/m/a.mp3", codec = "MPEG 1 Layer 3", sampleRate = 44100 }), Mode("x2", wiim)], [dsf, Mode("max", wiim)],
            [dsf, dsdDac], [dff, dsdDac], [dsf, named], [dff, named], [With(dsf, new { sampleRate = 5644800 }), dsdDac],
            [hi], [hi, low]);
        Assert.False(p[0].Bool("transcode"));
        Assert.False(p[1].Bool("transcode"));
        Assert.Equal((176400, 24, null), Pick(p[2]));
        Assert.Equal((48000, 24, null), Pick(p[3]));
        Assert.Equal((88200, 24, 2), Pick(p[4]));
        Assert.Equal((176400, 24, 4), Pick(p[5]));
        Assert.Equal((176400, 24, 4), Pick(p[6]));
        Assert.True(Pick(p[7]) == (192000, 24, 2), "capped at the top of the 48 k family");
        Assert.True(p[8].Bool("transcode") == false, "already at the top: as it is");
        Assert.Equal((705600, 32, 16), Pick(p[9]));
        Assert.Equal((705600, 24, 16), Pick(p[10]));
        Assert.Equal((768000, 32, 16), Pick(p[11]));
        Assert.Equal((88200, 24, 2), Pick(p[12]));
        Assert.Equal((176400, 24, null), Pick(p[13]));
        Assert.Equal((false, "audio/x-dsf", "dsf", 64.0), (p[14].Bool("transcode") ?? true, p[14].Str("mime"), p[14].Str("ext"), p[14].Num("dsd") ?? 0));
        Assert.Equal("audio/x-dff", p[15].Str("mime"));
        Assert.Equal("audio/dsf", p[16].Str("mime"));
        Assert.Equal("audio/x-dff", p[17].Str("mime"));
        Assert.Equal((176400, 24, null), Pick(p[18]));
        // The 64-bit float pipeline, and its own cache key. SoX's resampler where ffmpeg has it, swr where
        // it hasn't (Homebrew's, on a Mac): both.
        var (x4, sonos) = (p[5]!, p[19]!);
        var args = (await Plans(new JsonObject
        {
            ["args"] = new JsonArray(
                new JsonArray("/m/a.flac", x4.DeepClone(), "/out.flac", true), new JsonArray("/m/a.flac", x4.DeepClone(), "/out.flac", false),
                new JsonArray("/m/a.flac", sonos.DeepClone(), "/out.flac", true), new JsonArray("/m/a.flac", sonos.DeepClone(), "/out.flac", false))
        }))["args"]!.AsArray().Select(a => string.Join(" ", a!.AsArray().Select(x => (string?)x))).ToList();
        Assert.Contains(" -af aresample=resampler=soxr:precision=33:internal_sample_fmt=dblp:osr=176400:dither_method=triangular ", args[0], StringComparison.Ordinal);
        Assert.Contains(" -af aresample=internal_sample_fmt=dblp:osr=176400:dither_method=triangular ", args[1], StringComparison.Ordinal);
        Assert.True(args[2].Contains(" -af aresample=resampler=soxr:precision=28:osr=48000:", StringComparison.Ordinal), "the Sonos conversion is as it was");
        Assert.True(args[3].Contains(" -af aresample=osr=48000:", StringComparison.Ordinal), "the Sonos conversion is as it was");
        var keys = (await Plans(new JsonObject
        {
            ["keys"] = new JsonArray(new JsonArray(J(new { id = 1, mtime = 5 }), sonos.DeepClone()), new JsonArray(J(new { id = 1, mtime = 5 }), p[20]!.DeepClone()))
        }))["keys"]!.AsArray();
        Assert.NotEqual(keys[0]!.ToJsonString(), keys[1]!.ToJsonString());
    }

    [Test]
    public async Task Sonos_24_48_is_the_ceiling_what_it_cant_read_becomes_FLAC_what_it_reads_goes_untouched()
    {
        Needs.Server();
        static object[] T(string path, string codec, int sampleRate, int? bitsPerSample = null)
        {
            var o = J(new { path, codec, sampleRate, channels = 2 });
            if (bitsPerSample != null) o["bitsPerSample"] = bitsPerSample;
            return [o];
        }
        int[] above = [88200, 96000, 176400, 192000, 352800];
        var p = await Plan([T("/m/a.flac", "FLAC", 44100, 16), T("/m/a.flac", "FLAC", 48000, 24), .. above.Select(rate => T("/m/a.flac", "FLAC", rate, 24)),
            T("/m/a.wav", "PCM", 48000, 32), T("/m/a.m4a", "ALAC", 96000, 24), T("/m/a.dsf", "DSD", 2822400, 1),
            T("/m/a.mp3", "MPEG 1 Layer 3", 44100), T("/m/a.m4a", "AAC", 44100), T("/m/a.ogg", "Vorbis", 44100),
            T("/m/a.ape", "Monkey's Audio", 44100, 16), T("/m/a.wav", "PCM", 44100, 24)]);
        // A CD-quality FLAC goes untouched; 24/48 too, still bit-perfect.
        Assert.Equal((false, "audio/flac"), (p[0].Bool("transcode") ?? true, p[0].Str("mime")));
        Assert.False(p[1].Bool("transcode"));
        // Anything above 24/48 is brought down to 24/48 FLAC.
        for (int i = 0; i < above.Length; i++)
            Assert.True((p[2 + i].Bool("transcode"), p[2 + i].Num("rate"), p[2 + i].Num("bits"), p[2 + i].Str("mime")) == (true, 48000, 24, "audio/flac"), above[i].ToString(System.Globalization.CultureInfo.InvariantCulture));
        // 32-bit at 48k to 24-bit, the rate kept; hi-res ALAC resampled too; DSD to 24/48 FLAC.
        Assert.Equal((true, 48000, 24), (p[7].Bool("transcode"), p[7].Num("rate"), p[7].Num("bits")));
        Assert.Equal((true, 48000), (p[8].Bool("transcode"), p[8].Num("rate")));
        Assert.Equal((true, 48000, 24), (p[9].Bool("transcode"), p[9].Num("rate"), p[9].Num("bits")));
        // Lossy formats Sonos reads pass straight through.
        Assert.False(p[10].Bool("transcode"));
        Assert.Equal("audio/mp4", p[11].Str("mime"));
        Assert.Equal("audio/ogg", p[12].Str("mime"));
        // Formats Sonos cannot read become FLAC at their own rate when within the ceiling; a 24-bit WAV is repacked as FLAC.
        Assert.Equal((true, 44100, 16), (p[13].Bool("transcode"), p[13].Num("rate"), p[13].Num("bits")));
        Assert.Equal((true, 44100, 24), (p[14].Bool("transcode"), p[14].Num("rate"), p[14].Num("bits")));
    }

    // A repack is sample for sample (v0.7.6). A WAV a device won't take goes as FLAC at its own rate and
    // depth, and the samples must come out exactly as they went in.
    private static readonly JsonObject Dac = J(new { name = "DAC", rates = new[] { 44100, 48000, 96000 }, maxBits = 24, containers = new[] { "flac" } });

    [Test]
    public async Task A_container_only_conversion_is_marked_exact_and_gets_no_dither_a_gain_or_a_resample_is_not()
    {
        Needs.Server();
        var wav = J(new { path = "/m/a.wav", codec = "pcm_s24le", sampleRate = 96000, bitsPerSample = 24, channels = 2 });
        var r = await Plan([wav, Dac], [J(new { path = "/m/b.wav", codec = "pcm_s16le", sampleRate = 44100, bitsPerSample = 16, channels = 2 }), Dac],
            [J(new { path = "/m/c.wav", codec = "PCM", sampleRate = 44100, bitsPerSample = 24, channels = 2 })], [wav, J(new { name = "DAC", rates = new[] { 44100, 48000 }, maxBits = 24, containers = new[] { "flac" } })],
            [J(new { path = "/m/a.ape", codec = "Monkey's Audio", sampleRate = 44100, bitsPerSample = 16, channels = 2 }), Dac],
            [J(new { path = "/m/a.mp3", codec = "mp3", sampleRate = 44100, bitsPerSample = 0, channels = 2 }), J(new { name = "DAC", rates = new[] { 44100 }, maxBits = 24, containers = new[] { "flac" } })]);
        var (p, cd, sonos, resampled, ape, mp3) = (r[0]!, r[1]!, r[2]!, r[3]!, r[4]!, r[5]!);
        Assert.Equal((true, 96000, 24), (p.Bool("transcode"), p.Num("rate"), p.Num("bits")));
        Assert.True(p.Bool("exact"), "a WAV repacked at its own rate and depth");
        var o = await Plans(new JsonObject
        {
            ["args"] = new JsonArray(new JsonArray("/m/a.wav", p.DeepClone(), "/t/x.flac", true)),
            ["with_gain"] = new JsonArray(new JsonArray(p.DeepClone(), wav.DeepClone(), Dac.DeepClone(), -3))
        });
        Assert.Contains("dither_method=0", string.Join(" ", o["args"]![0]!.AsArray().Select(x => (string?)x)), StringComparison.Ordinal);
        var gained = o["with_gain"]![0];
        // 16-bit too, where the output stays 16.
        Assert.Equal(16, cd.Num("bits"));
        Assert.True(cd.Bool("exact"));
        // Sonos: a 24-bit WAV is repacked exactly too (WAV above 16 bits is not sent as it is).
        Assert.True(sonos.Bool("transcode"));
        Assert.True(sonos.Bool("exact"));
        // Not exact: a gain, a resample, a lossy source.
        Assert.True(gained?["exact"] == null, "a gain changes the samples");
        Assert.True(resampled["exact"] == null, "resampled to 48 kHz");
        Assert.True(ape.Bool("exact"), "a lossless codec decodes to integers: exact");
        Assert.True(mp3["exact"] == null, "a lossy source decodes to float: dithered");
    }

    private static byte[] Ffmpeg(IEnumerable<string> args)
    {
        var psi = new ProcessStartInfo(Fixtures.Ffmpeg) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var proc = Process.Start(psi)!;
        var err = proc.StandardError.ReadToEndAsync();
        using var ms = new MemoryStream();
        proc.StandardOutput.BaseStream.CopyTo(ms);
        proc.WaitForExit();
        Assert.True(proc.ExitCode == 0, err.Result);
        return ms.ToArray();
    }

    [Test]
    public async Task The_repack_really_is_bit_for_bit_a_24_96_WAV_through_the_conversion_comes_back_sample_for_sample()
    {
        Needs.Server(); Needs.Ffmpeg();
        var dir = Directory.CreateTempSubdirectory("musicd-exact-").FullName;
        try
        {
            string wav = Path.Combine(dir, "ref.wav"), flac = Path.Combine(dir, "out.flac");
            // A tone, pink noise and silence, as a test file would be; 24-bit, 96 kHz.
            Ffmpeg(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=1000:duration=1:sample_rate=96000",
                "-f", "lavfi", "-i", "anoisesrc=d=1:c=pink:r=96000:a=0.3", "-filter_complex", "[0][1]concat=n=2:v=0:a=1,adelay=200|200,apad=pad_dur=0.2,volume=0.5,aformat=channel_layouts=stereo",
                "-ar", "96000", "-c:a", "pcm_s24le", wav]);
            var p = (await Plan([J(new { path = wav, codec = "pcm_s24le", sampleRate = 96000, bitsPerSample = 24, channels = 2 }), Dac]))[0]!;
            Assert.True(p.Bool("exact"));
            var args = (await Plans(new JsonObject { ["args"] = new JsonArray(new JsonArray(wav, p.DeepClone(), flac, Fixtures.HaveSoxr)) }))["args"]![0]!.AsArray().Select(x => (string)x!);
            Ffmpeg(args);
            // Decoded the way the local output decodes (32-bit PCM), both of them.
            static byte[] Pcm(string f) => Ffmpeg(["-hide_banner", "-loglevel", "error", "-i", f, "-map", "0:a:0", "-vn", "-ac", "2", "-c:a", "pcm_s32le", "-f", "s32le", "pipe:1"]);
            var (a, b) = (Pcm(wav), Pcm(flac));
            Assert.True(b.Length == a.Length, "the same number of samples");
            Assert.True(a.AsSpan().SequenceEqual(b), "every sample identical");
            int lowBytes = 0;
            for (int i = 0; i < b.Length; i += 4) if (b[i] != 0) lowBytes++;
            Assert.True(lowBytes == 0, "24-bit samples in a 32-bit container: the low byte is zero");
        }
        finally { Directory.Delete(dir, true); }
    }
}
