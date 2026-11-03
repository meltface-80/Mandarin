using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// PCM sent as DSD (bug list items 243, 259, Upsample/DsdPlan.cs): a device set to PCM as DSD has each track of the
/// library that isn't DSD made DSD as it plays by the modulator of item 242 and sent as a DSF while it is made; where
/// the device takes that multiple and DSF files, from a rate of either family (48 kHz's through 44.1 kHz's, by SoX),
/// never a service's stream or DSD that is DSD already (a DSP setting runs on the PCM it is made from: item 263). The job made for 96 kHz is run
/// and its file read; a track asked for as a DSF never made is sent as it is made, then kept and sent whole.
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
        Assert.Equal("DSD64 from PCM, made as it plays", p[0].Str("reason"));
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
        });
        var keys = r["held_keys"]!.AsArray().Select(k => (string)k!).ToArray();
        Assert.Equal(keys[0] + "-dsd64j", keys[1]);   // "j": joined to its album's neighbours (item 262)

        var dir = Directory.CreateTempSubdirectory("musicd-test-").FullName;
        try
        {
            var src = Path.Combine(dir, "a.flac");
            Fixtures.Gen(src, seconds: 1, freq: 997, rate: 96000);
            var dsf = Path.Combine(dir, "a.dsf");
            var plan = new { transcode = true, hq = true, rate = 96000, bits = 1, dsdUp = 64, inRate = 96000, gain = -3, reason = "" };
            var job = (await Plans(new JsonObject { ["dsd_job"] = JsonNode.Parse(Http.Json(new object[] { new object[] { src, plan, dsf, true, 1.0 } })) }))["dsd_job"]![0]!.AsObject();
            // Decoded at 88.2 kHz by SoX at its finest, the gain on it; made ×8 to 705.6 kHz, then DSD64.
            var decode = string.Join(" ", job["decode"]!.AsArray().Select(x => (string?)x));
            Assert.Contains("-af volume=volume=-3dB:precision=double,aresample=resampler=soxr:precision=33:osr=88200 -ac 2 -ar 88200 ", decode, StringComparison.Ordinal);
            Assert.Equal((88200.0, 8.0, 2822400.0, dsf), (job.Num("rate")!.Value, job.Num("factor")!.Value, job.Num("dsd")!.Value, job.Str("out")));
            // Its length said before it is made, from the track's (a second): the DSF's header written first.
            Assert.Equal(88200.0, job.Num("frames"));
            // Run as MadeAsPlayed runs it: a DSF of the track's length, DSD64, stereo.
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
    public async Task A_96_kHz_track_is_made_DSD256_of_48_kHzs_family_at_its_own_rate_where_the_device_takes_768_kHz()
    {
        // Item 261: 96 kHz went to 88.2 kHz by SoX, then ×8 to 705.6 kHz and DSD256 at 11.2896 MHz; now ×8 to 768 kHz,
        // DSD256 at 12.288 MHz, nothing resampled, where the device takes PCM at the rate DoP carries that on.
        Needs.Server(); Needs.Ffmpeg();
        var hi = J(new { path = "/m/b.flac", codec = "FLAC", sampleRate = 96000, bitsPerSample = 24, channels = 2 });
        var cd = J(new { path = "/m/a.flac", codec = "FLAC", sampleRate = 44100, bitsPerSample = 16, channels = 2 });
        object Wide(int up) => new
        {
            name = "DAC", rates = new[] { 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000 }, maxBits = 24, containers = new[] { "flac", "dsd" },
            dsd = new[] { 64, 128, 256 }, dsdMimes = new { dsf = "audio/dsf", dff = (string?)null }, mode = "original", dsd_out = up,
        };
        var p = (await Plans(new JsonObject { ["dsd_up"] = JsonNode.Parse(Http.Json(new object[][] { [hi, Wide(256)], [hi, Dev(128, [64, 128])], [cd, Wide(256)], [hi, Wide(64)] })) }))["dsd_up"]!.AsArray();
        Assert.Equal((256.0, 48000.0), (p[0].Num("dsdUp")!.Value, p[0].Num("dsdBase")!.Value));
        Assert.Null(p[1].Num("dsdBase"));    // no 384 kHz said for DSD128's DoP: 44.1 kHz's family, as before
        Assert.Equal(128.0, p[1].Num("dsdUp"));
        Assert.Null(p[2].Num("dsdBase"));    // a CD: 44.1 kHz's, as it is
        Assert.Equal(48000.0, p[3].Num("dsdBase"));   // DSD64 rides on 192 kHz
        // A cache file of its own, apart from the 44.1 kHz family's.
        var keys = (await Plans(new JsonObject
        {
            ["held_keys"] = new JsonArray(new JsonArray(7, 5, 96000, 1, true, false, false, false, 0, 256), new JsonArray(7, 5, 96000, 1, true, false, false, false, 0, 256, null, 48000)),
        }))["held_keys"]!.AsArray().Select(k => (string)k!).ToArray();
        Assert.EndsWith("-dsd256j", keys[0], StringComparison.Ordinal);
        Assert.Equal(keys[0][..^1] + "x48j", keys[1]);

        var dir = Directory.CreateTempSubdirectory("musicd-test-").FullName;
        try
        {
            var src = Path.Combine(dir, "b.flac");
            Fixtures.Gen(src, seconds: 1, freq: 997, rate: 96000);
            var dsf = Path.Combine(dir, "b.dsf");
            var plan = new { transcode = true, hq = true, rate = 96000, bits = 1, dsdUp = 256, dsdBase = 48000, inRate = 96000, reason = "" };
            var job = (await Plans(new JsonObject { ["dsd_job"] = JsonNode.Parse(Http.Json(new object[] { new object[] { src, plan, dsf, true, 1.0 } })) }))["dsd_job"]![0]!.AsObject();
            var decode = string.Join(" ", job["decode"]!.AsArray().Select(x => (string?)x));
            Assert.DoesNotContain("aresample", decode, StringComparison.Ordinal);
            Assert.Contains("-ar 96000 ", decode, StringComparison.Ordinal);
            Assert.Equal((96000.0, 8.0, 12288000.0, 96000.0), (job.Num("rate")!.Value, job.Num("factor")!.Value, job.Num("dsd")!.Value, job.Num("frames")!.Value));
            job["ffmpeg"] = "ffmpeg";
            var said = await Upsample(job);
            Assert.True(said["error"] == null, (string?)said["error"]);
            var head = new byte[92];
            using (var f = File.OpenRead(dsf)) f.ReadExactly(head);
            Assert.Equal((12288000, 2), (BitConverter.ToInt32(head, 56), BitConverter.ToInt32(head, 52)));
            Assert.Equal(96000L * 128, BitConverter.ToInt64(head, 64));
        }
        finally { Directory.Delete(dir, true); }
    }

    [Test]
    public async Task A_DSF_never_made_is_sent_as_it_is_made_then_kept_and_sent_whole()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var s = await Session.Started();
        await Session.Until(async () => (await s.Api("library-stats")).J.Num("albums") == 3, 30000, "the library");
        var song = s.Server.Rows("SELECT * FROM tracks WHERE title = $1", "Song 1")[0];
        var seconds = Convert.ToDouble(song["duration"], System.Globalization.CultureInfo.InvariantCulture);
        var url = s.Base + $"/stream/t{song["id"]}.d64.dsf";
        // Asked for before any of it is made: sent as it is made, with its length (item 262: its header's, known
        // before the first bit is made), and a range of it too; the DSF's own header saying it from the first bytes.
        var part = Bytes.Get(url, new Dictionary<string, string>(s.H) { ["Range"] = "bytes=1000-1999" });
        var first = await Bytes.Get(url, s.H);
        Assert.Equal(200, first.Status);
        Assert.Equal((first.Body.LongLength.ToString(System.Globalization.CultureInfo.InvariantCulture), (string?)null), (first.Header("Content-Length"), first.Header("Transfer-Encoding")));
        Assert.Equal("DSD ", System.Text.Encoding.ASCII.GetString(first.Body, 0, 4));
        // Song 1 is joined to Song 2: its file ends on a whole block (512 frames at DSD64), the frames short of one Song 2's.
        var frames = (long)Math.Round(seconds * 44100);
        var samples = (frames - frames % 512) * 64;
        Assert.Equal((2822400, samples), (BitConverter.ToInt32(first.Body, 56), BitConverter.ToInt64(first.Body, 64)));
        // Every block the header promised (4096 bytes a channel), nothing more and nothing filled out.
        Assert.Equal(92 + samples / 8 * 2, first.Body.LongLength);
        var range = await part;
        Assert.Equal((206, $"bytes 1000-1999/{first.Body.LongLength}"), (range.Status, range.Header("Content-Range")));
        Assert.True(range.Body.AsSpan().SequenceEqual(first.Body.AsSpan(1000, 1000)), "the range is those bytes");
        // Kept: the next play the file itself, whole, its length known, the same bytes.
        var again = await Bytes.Get(url, s.H);
        Assert.Equal((200, first.Body.LongLength.ToString(System.Globalization.CultureInfo.InvariantCulture)), (again.Status, again.Header("Content-Length")));
        Assert.True(again.Body.AsSpan().SequenceEqual(first.Body), "the file kept is what was sent");
        // Its speed in the log (said once the making is done, which may be just after its last bytes went).
        await Session.Until(() => Task.FromResult(s.Server.Logs.Any(l => l.Contains("DSD64 from PCM, standard filter (0 reset(s)), made as it played at", StringComparison.Ordinal))), 10000, "its speed in the log");

        // Song 2 next (item 262): its making handed to Song 1's, kept on into Song 2's start, so that the modulators
        // run on from one into the other; its file begins with Song 1's frames short of a block, and ends on a whole
        // block itself, Song 3 after it.
        var two = s.Server.Rows("SELECT * FROM tracks WHERE title = $1", "Song 2")[0];
        var second = await Bytes.Get(s.Base + $"/stream/t{two["id"]}.d64.dsf", s.H);
        Assert.Equal(200, second.Status);
        var frames2 = (long)Math.Round(Convert.ToDouble(two["duration"], System.Globalization.CultureInfo.InvariantCulture) * 44100);
        var carry = frames % 512;
        var samples2 = (carry + frames2 - (carry + frames2) % 512) * 64;
        Assert.Equal(samples2, BitConverter.ToInt64(second.Body, 64));
        Assert.Equal(0, samples2 % (4096 * 8));
        await Session.Until(() => Task.FromResult(s.Server.Logs.Any(l => l.Contains("02 Song 2.flac: DSD64 from PCM", StringComparison.Ordinal) && l.EndsWith(", on from the track before", StringComparison.Ordinal))), 10000, "Song 2 made on from Song 1");
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
