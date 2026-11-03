using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// PCM sent as DSD (bug list item 243, Upsample/DsdPlan.cs): a device set to PCM as DSD has each track of the library
/// that isn't DSD made DSD ahead of playing by the modulator of item 242 and sent as a DSF; where the device takes that
/// multiple and DSF files, from a rate of either family (48 kHz's through 44.1 kHz's, by SoX), never a service's stream,
/// DSD that is DSD already, or a track a DSP setting runs on. The job made for 96 kHz is run and its file read.
/// </summary>
public sealed class DsdPlanTests
{
    private static JsonObject J(object o) => JsonNode.Parse(Http.Json(o))!.AsObject();

    private static async Task<JsonNode> Plans(JsonObject job) { job["fn"] = "plans"; return await Score.Run(job); }

    private static object Dev(int? up, int[] dsd, string? dsf = "audio/dsf") => new
    {
        name = "DAC", rates = new[] { 44100, 48000, 88200, 96000, 176400, 192000 }, maxBits = 24, containers = new[] { "flac", "dsd" },
        dsd, dsdMimes = new { dsf, dff = (string?)null }, mode = "original", dsd_out = (object?)up ?? "off",
    };

    [Test]
    public async Task A_track_is_made_DSD_where_the_device_is_set_to_it_and_takes_it()
    {
        Needs.Server();
        var cd = J(new { path = "/m/a.flac", codec = "FLAC", sampleRate = 44100, bitsPerSample = 16, channels = 2 });
        var hi = J(new { path = "/m/b.flac", codec = "FLAC", sampleRate = 96000, bitsPerSample = 24, channels = 2 });
        var dsd = J(new { path = "/m/c.dsf", codec = "DSD", sampleRate = 2822400, bitsPerSample = 1, channels = 2 });
        var odd = J(new { path = "/m/d.flac", codec = "FLAC", sampleRate = 32000, bitsPerSample = 16, channels = 2 });
        var qobuz = J(new { path = "qobuz://track/1", codec = "FLAC", sampleRate = 44100, bitsPerSample = 16, channels = 2 });
        var cases = new object[][]
        {
            [cd, Dev(64, [64, 128])], [hi, Dev(128, [64, 128])], [cd, Dev(null, [64])], [cd, Dev(256, [64, 128])],
            [cd, Dev(64, [64], dsf: null)], [dsd, Dev(64, [64])], [odd, Dev(64, [64])], [qobuz, Dev(64, [64])],
        };
        var p = (await Plans(new JsonObject { ["dsd_up"] = JsonNode.Parse(Http.Json(cases)) }))["dsd_up"]!.AsArray();
        // A CD at DSD64: a DSF in the device's own word for it, made from the track's own rate.
        Assert.Equal(("dsf", "audio/dsf", 64.0, 64.0, 44100.0), (p[0].Str("ext"), p[0].Str("mime"), p[0].Num("dsd")!.Value, p[0].Num("dsdUp")!.Value, p[0].Num("inRate")!.Value));
        Assert.Equal("DSD64 from PCM, made ahead", p[0].Str("reason"));
        // 96 kHz at DSD128: 48 kHz's family too.
        Assert.Equal((128.0, 96000.0), (p[1].Num("dsdUp")!.Value, p[1].Num("inRate")!.Value));
        // Off; a multiple it doesn't take; no DSF in its words; DSD already (as it is); a rate of neither family; a service: PCM, as before.
        foreach (var i in new[] { 2, 3, 4, 5, 6, 7 }) Assert.Null(p[i].Num("dsdUp"));
        Assert.Equal("DSD64 as it is", p[5].Str("reason"));
    }

    [Test]
    public async Task A_DSD_plan_has_its_own_cache_file_and_a_96_kHz_track_is_made_DSD64_from_88_2_kHz()
    {
        Needs.Server(); Needs.Ffmpeg();
        var r = await Plans(new JsonObject
        {
            // [id, mtime, rate, bits, hq, exact, wav, whole, lowpass, dsdUp]
            ["held_keys"] = new JsonArray(new JsonArray(7, 5, 96000, 1, true, false, false, false, 0, 0), new JsonArray(7, 5, 96000, 1, true, false, false, false, 0, 64)),
            ["dsd_badge"] = new JsonArray(new JsonArray(64, "making"), new JsonArray(128, "failed"), new JsonArray(256, null)),
        });
        var keys = r["held_keys"]!.AsArray().Select(k => (string)k!).ToArray();
        Assert.Equal(keys[0] + "-dsd64", keys[1]);
        Assert.Equal([" · DSD64 being made", " · DSD128 failed: see the log", " · DSD256 next play"], r["dsd_badge"]!.AsArray().Select(x => (string)x!).ToArray());

        var dir = Directory.CreateTempSubdirectory("musicd-test-").FullName;
        try
        {
            var src = Path.Combine(dir, "a.flac");
            Fixtures.Gen(src, seconds: 1, freq: 997, rate: 96000);
            var dsf = Path.Combine(dir, "a.dsf");
            var plan = new { transcode = true, hq = true, rate = 96000, bits = 1, dsdUp = 64, inRate = 96000, gain = -3, reason = "" };
            var job = (await Plans(new JsonObject { ["dsd_job"] = JsonNode.Parse(Http.Json(new object[] { new object[] { src, plan, dsf, true } })) }))["dsd_job"]![0]!.AsObject();
            // Decoded at 88.2 kHz by SoX at its finest, the gain on it; made ×8 to 705.6 kHz, then DSD64.
            var decode = string.Join(" ", job["decode"]!.AsArray().Select(x => (string?)x));
            Assert.Contains("-af volume=volume=-3dB:precision=double,aresample=resampler=soxr:precision=33:osr=88200 -ac 2 -ar 88200 ", decode, StringComparison.Ordinal);
            Assert.Equal((88200.0, 8.0, 2822400.0, dsf), (job.Num("rate")!.Value, job.Num("factor")!.Value, job.Num("dsd")!.Value, job.Str("out")));
            // Run as WholeJobs runs it: a DSF of the track's length, DSD64, stereo.
            job["ffmpeg"] = "ffmpeg";
            var said = await Upsample(job);
            Assert.True(said["error"] == null, (string?)said["error"]);
            var head = new byte[92];
            using (var f = File.OpenRead(dsf)) f.ReadExactly(head);
            Assert.Equal("DSD ", System.Text.Encoding.ASCII.GetString(head, 0, 4));
            Assert.Equal((2822400, 2), (BitConverter.ToInt32(head, 56), BitConverter.ToInt32(head, 52)));
            Assert.Equal(88200L * 32, BitConverter.ToInt64(head, 64));
        }
        finally { Directory.Delete(dir, true); }
    }

    [Test]
    public async Task While_its_DSF_is_made_a_track_goes_with_the_standard_filter_never_a_whole_tracks()
    {
        Needs.Server();
        // A device set to Whole track and to DSD256 (item 246): the PCM that stands in for the DSF is the standard
        // filter's; a whole track's is made in the same queue, behind the DSFs, and was never there to be armed.
        var whole = new { transcode = true, hq = true, mime = "audio/wav", ext = "wav", wav = true, rate = 705600, bits = 24, upsampled = 16, whole = true, inRate = 44100, reason = "upsampled ×16 to 705.6 kHz for SR11 (whole track)" };
        var p = (await Plans(new JsonObject { ["dsd_waiting"] = JsonNode.Parse(Http.Json(new object[] { new object[] { whole, 256 } })) }))["dsd_waiting"]![0]!;
        Assert.Null(p["whole"]);
        Assert.Equal((256.0, 705600.0, true), (p.Num("dsdMaking")!.Value, p.Num("rate")!.Value, (bool?)p["wav"] ?? false));
        Assert.Equal("upsampled ×16 to 705.6 kHz for SR11 (DSD256 being made)", p.Str("reason"));
    }

    // `mandarin-server upsample` given [job]: its line of JSON.
    private static async Task<JsonNode> Upsample(JsonObject job)
    {
        var psi = new ProcessStartInfo(ServerProcess.Bin) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        psi.ArgumentList.Add("upsample");
        using var p = Process.Start(psi)!;
        var output = p.StandardOutput.ReadToEndAsync();
        _ = p.StandardError.ReadToEndAsync();
        await p.StandardInput.WriteLineAsync(job.ToJsonString());
        p.StandardInput.Close();
        await p.WaitForExitAsync();
        return JsonNode.Parse((await output).Trim().Split('\n')[^1])!;
    }
}
