using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// A rate above what FLAC's frames name (bug list items 238, 305, Playback/HighRates.cs). On 2 November every track
/// planned for a FiiO SR11 at ×16 (705.6 and 768 kHz) failed in ffmpeg ("705600 Hz not supported"), and those plans
/// went out as WAV, their length left open; a WAV says no more than 4 GB, and a Chord Poly played nothing of an album
/// sent as one (item 305). Above 655,350 Hz a device that takes FLAC is now sent FLAC at the rate itself, one stream,
/// the rate in its header; one that takes WAV and not FLAC, WAV; one that takes neither, the highest rate FLAC's frames carry.
/// </summary>
public sealed class HighRatesTests
{
    private static JsonObject J(object o) => JsonNode.Parse(Http.Json(o))!.AsObject();

    private static async Task<JsonNode> Plans(JsonObject job) { job["fn"] = "plans"; return await Score.Run(job); }

    private static readonly int[] Rates = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000];

    [Test]
    public async Task Above_FLACs_frame_rates_FLAC_where_the_device_takes_it_else_WAV_else_the_highest_FLAC_carries()
    {
        Needs.Server();
        var cd = J(new { path = "/m/a.flac", codec = "FLAC", sampleRate = 44100, bitsPerSample = 16, channels = 2 });
        var dat = J(new { path = "/m/b.flac", codec = "FLAC", sampleRate = 48000, bitsPerSample = 24, channels = 2 });
        // As the SR11 says it plays: FLAC and WAV among its formats; a Poly, FLAC.
        var sr11 = J(new { name = "FiiO SR11", rates = Rates, maxBits = 24, containers = new[] { "flac", "wav", "aiff" }, mode = "max" });
        var poly = J(new { name = "Poly", rates = Rates, maxBits = 24, containers = new[] { "flac" }, mode = "max" });
        var wavOnly = J(new { name = "Old", rates = Rates, maxBits = 24, containers = new[] { "wav" }, mode = "max" });
        var neither = J(new { name = "Other", rates = Rates, maxBits = 24, containers = new[] { "aiff" }, mode = "max" });
        var x8 = J(new { name = "FiiO SR11", rates = Rates, maxBits = 24, containers = new[] { "flac", "wav" }, mode = "x4" });
        // As a renderer's queue item is planned (Playback/Items.cs): the renderer's plan, then fitted.
        var p = (await Plans(new JsonObject { ["fit"] = JsonNode.Parse(Http.Json(new object[][] { [cd, sr11], [dat, sr11], [cd, poly], [cd, wavOnly], [cd, neither], [dat, neither], [cd, x8] })) }))["fit"]!.AsArray();

        // ×16 as FLAC: 705.6 and 768 kHz, said so.
        Assert.Equal((705600.0, "audio/flac", "flac", false, 16.0), (p[0].Num("rate")!.Value, p[0].Str("mime"), p[0].Str("ext"), p[0].Bool("wav") ?? false, p[0].Num("upsampled")!.Value));
        Assert.Equal((768000.0, "audio/flac"), (p[1].Num("rate")!.Value, p[1].Str("mime")));
        Assert.Contains("one FLAC stream", p[0].Str("reason"), StringComparison.Ordinal);
        Assert.Equal((705600.0, "audio/flac"), (p[2].Num("rate")!.Value, p[2].Str("mime")));
        // WAV and not FLAC: WAV, as before.
        Assert.Equal((705600.0, "audio/wav", "wav", true), (p[3].Num("rate")!.Value, p[3].Str("mime"), p[3].Str("ext"), p[3].Bool("wav") ?? false));
        // Neither: ×8, and said why.
        Assert.Equal((352800.0, 8.0), (p[4].Num("rate")!.Value, p[4].Num("upsampled")!.Value));
        Assert.Equal(384000.0, p[5].Num("rate"));
        Assert.Null(p[4].Bool("wav"));
        Assert.Contains("needs FLAC or WAV", p[4].Str("reason"), StringComparison.Ordinal);
        // Within FLAC's frame rates nothing changes.
        Assert.Equal((176400.0, "audio/flac"), (p[6].Num("rate")!.Value, p[6].Str("mime")));
    }

    [Test]
    public async Task FLAC_at_705_6_and_768_kHz_is_written_and_read_at_its_rate()
    {
        Needs.Server(); Needs.Ffmpeg();
        var dir = Directory.CreateTempSubdirectory("musicd-test-").FullName;
        try
        {
            var src = Path.Combine(dir, "a.flac");
            Fixtures.Gen(src, freq: 1000, seconds: 1);
            foreach (var rate in new[] { 705600, 768000 })
            {
                // [src, rate, bits, hq, exact, dest, soxr, wav]
                var dest = Path.Combine(dir, $"out{rate}.flac");
                var argsJ = (await Plans(new JsonObject
                {
                    ["held_args"] = new JsonArray(new JsonArray(src, rate, 24, true, false, dest, true, false)),
                }))["held_args"]![0]!.AsArray().Select(x => (string)x!).ToList();
                var psi = new System.Diagnostics.ProcessStartInfo("ffmpeg") { RedirectStandardError = true, UseShellExecute = false };
                foreach (var x in argsJ) psi.ArgumentList.Add(x);
                using (var ff = System.Diagnostics.Process.Start(psi)!)
                {
                    var err = ff.StandardError.ReadToEnd();
                    ff.WaitForExit();
                    Assert.True(ff.ExitCode == 0, err);
                }
                var probe = new System.Diagnostics.ProcessStartInfo("ffprobe") { RedirectStandardOutput = true, UseShellExecute = false };
                foreach (var x in new[] { "-v", "error", "-show_entries", "stream=codec_name,sample_rate", "-of", "csv=p=0", dest }) probe.ArgumentList.Add(x);
                using var pr = System.Diagnostics.Process.Start(probe)!;
                var said = pr.StandardOutput.ReadToEnd().Trim();
                pr.WaitForExit();
                Assert.Equal($"flac,{rate}", said);
            }
        }
        finally { Directory.Delete(dir, true); }
    }

    [Test]
    public async Task A_WAV_plan_has_its_own_cache_file_and_ffmpeg_writes_PCM_with_its_length_open()
    {
        Needs.Server();
        var r = await Plans(new JsonObject
        {
            // [id, mtime, rate, bits, hq, exact, wav]
            ["held_keys"] = new JsonArray(new JsonArray(7, 5, 705600, 24, true, false, false), new JsonArray(7, 5, 705600, 24, true, false, true)),
            // [src, rate, bits, hq, exact, dest, soxr, wav]
            ["held_args"] = new JsonArray(new JsonArray("/m/a.flac", 705600, 24, true, false, "/out.part", true, true),
                new JsonArray("/m/a.flac", 352800, 24, true, false, "/out.part", true, false)),
        });
        var keys = r["held_keys"]!.AsArray().Select(k => (string)k!).ToArray();
        Assert.NotEqual(keys[0], keys[1]);
        Assert.EndsWith("-wav", keys[1], StringComparison.Ordinal);
        var args = r["held_args"]!.AsArray().Select(a => string.Join(" ", a!.AsArray().Select(x => (string?)x))).ToArray();
        Assert.Contains(" -c:a pcm_s24le -f wav -seekable 0 /out.part", args[0], StringComparison.Ordinal);
        Assert.DoesNotContain("flac", args[0].Replace("/m/a.flac", "", StringComparison.Ordinal), StringComparison.Ordinal);
        Assert.Contains(" -c:a flac -compression_level 5 -f flac /out.part", args[1], StringComparison.Ordinal);
    }

    [Test]
    public async Task The_WAV_ffmpeg_writes_at_705_6_kHz_is_read_as_705_6_kHz_with_its_length_open()
    {
        Needs.Server(); Needs.Ffmpeg();
        var dir = Directory.CreateTempSubdirectory("musicd-test-").FullName;
        try
        {
            var src = Path.Combine(dir, "a.flac");
            Fixtures.Gen(src, freq: 1000, seconds: 1);
            var argsJ = (await Plans(new JsonObject
            {
                ["held_args"] = new JsonArray(new JsonArray(src, 705600, 24, true, false, Path.Combine(dir, "out.part"), true, true)),
            }))["held_args"]![0]!.AsArray().Select(x => (string)x!).ToList();
            var psi = new System.Diagnostics.ProcessStartInfo("ffmpeg") { RedirectStandardError = true, UseShellExecute = false };
            foreach (var x in argsJ) psi.ArgumentList.Add(x);
            using var ff = System.Diagnostics.Process.Start(psi)!;
            var err = await ff.StandardError.ReadToEndAsync();
            await ff.WaitForExitAsync();
            Assert.True(ff.ExitCode == 0, "ffmpeg wrote it: " + err);
            var bytes = await File.ReadAllBytesAsync(Path.Combine(dir, "out.part"));
            Assert.Equal("RIFF", System.Text.Encoding.ASCII.GetString(bytes, 0, 4));
            Assert.Equal(0xFFFFFFFFu, BitConverter.ToUInt32(bytes, 4));      // its length open: read to its end
            Assert.Equal(705600u, BitConverter.ToUInt32(bytes, 24));         // the rate in its fmt chunk
        }
        finally { Directory.Delete(dir, true); }
    }
}
