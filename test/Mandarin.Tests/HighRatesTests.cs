using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// A rate above what FLAC carries (bug list item 238, Playback/HighRates.cs). On 2 November every track planned for a
/// FiiO SR11 at ×16 (705.6 and 768 kHz) failed in ffmpeg ("705600 Hz not supported") and the SR11 was given nothing
/// while the screen counted on. Above 655,350 Hz a plan now goes out as WAV where the device takes WAV, its length
/// left open in its header so it plays as it is made; where it doesn't, at the highest rate FLAC carries.
/// </summary>
public sealed class HighRatesTests
{
    private static JsonObject J(object o) => JsonNode.Parse(Http.Json(o))!.AsObject();

    private static async Task<JsonNode> Plans(JsonObject job) { job["fn"] = "plans"; return await Score.Run(job); }

    private static readonly int[] Rates = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000];

    [Test]
    public async Task Above_FLACs_rates_WAV_where_the_device_takes_it_else_the_highest_FLAC_carries()
    {
        Needs.Server();
        var cd = J(new { path = "/m/a.flac", codec = "FLAC", sampleRate = 44100, bitsPerSample = 16, channels = 2 });
        var dat = J(new { path = "/m/b.flac", codec = "FLAC", sampleRate = 48000, bitsPerSample = 24, channels = 2 });
        // As the SR11 says it plays: WAV among its formats.
        var sr11 = J(new { name = "FiiO SR11", rates = Rates, maxBits = 24, containers = new[] { "flac", "wav", "aiff" }, mode = "max" });
        var flacOnly = J(new { name = "Poly", rates = Rates, maxBits = 24, containers = new[] { "flac" }, mode = "max" });
        var x8 = J(new { name = "FiiO SR11", rates = Rates, maxBits = 24, containers = new[] { "flac", "wav" }, mode = "x4" });
        // As a renderer's queue item is planned (Playback/Items.cs): the renderer's plan, then fitted.
        var p = (await Plans(new JsonObject { ["fit"] = JsonNode.Parse(Http.Json(new object[][] { [cd, sr11], [dat, sr11], [cd, flacOnly], [dat, flacOnly], [cd, x8] })) }))["fit"]!.AsArray();

        // ×16 as WAV: 705.6 and 768 kHz.
        Assert.Equal((705600.0, "audio/wav", "wav", true, 16.0), (p[0].Num("rate")!.Value, p[0].Str("mime"), p[0].Str("ext"), p[0].Bool("wav") ?? false, p[0].Num("upsampled")!.Value));
        Assert.Equal((768000.0, "audio/wav"), (p[1].Num("rate")!.Value, p[1].Str("mime")));
        Assert.Contains("as WAV", p[0].Str("reason"), StringComparison.Ordinal);
        // A device without WAV: ×8, FLAC, and said why.
        Assert.Equal((352800.0, "audio/flac", 8.0), (p[2].Num("rate")!.Value, p[2].Str("mime"), p[2].Num("upsampled")!.Value));
        Assert.Equal((384000.0, "audio/flac"), (p[3].Num("rate")!.Value, p[3].Str("mime")));
        Assert.Null(p[2].Bool("wav"));
        Assert.Contains("needs WAV", p[2].Str("reason"), StringComparison.Ordinal);
        // Within FLAC's rates nothing changes.
        Assert.Equal((176400.0, "audio/flac"), (p[4].Num("rate")!.Value, p[4].Str("mime")));
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
