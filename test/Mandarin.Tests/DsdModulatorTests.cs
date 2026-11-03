using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// PCM made DSD (bug list item 242, Upsample/Dsd*.cs): a seventh-order one-bit delta-sigma modulator, its noise pushed
/// out of the audio band by a noise transfer function of optimal zeros and a gain out of band of 1.3 (DSD64) or 1.25 (item 255). Measured on its
/// own bits: the noise from 20 Hz to 20 kHz below a full-scale sine, the signal at SACD's level (full-scale PCM is
/// half the modulation), the loop never overloaded at that level or above it, on tones and on noise; then a whole
/// track made a DSF file that ffmpeg reads back at the source's level, 6 dB down as SACD has it.
/// </summary>
public sealed partial class DsdModulatorTests
{
    private static async Task<JsonNode> Run(object job) => await Score.Run(job);

    [Test]
    public async Task The_noise_transfer_function_is_the_one_designed()
    {
        var r = await Run(new { fn = "dsdmod", ntf = new object[] { 7, 2822400, 1.4 } });
        Assert.Equal(1.4, r.Num("peak")!.Value, 3);
        Assert.True(r.Bool("on_circle"), "the zeros on the unit circle, where the noise is held down");
        Assert.Equal(4.0, r.Num("sections"));
    }

    [Test]
    public async Task At_DSD64_the_noise_in_the_band_is_126_dB_down_and_the_loop_holds_past_SACDs_highest_level()
    {
        // SACD's level: full-scale PCM, half the modulation.
        var r = await Run(new { fn = "dsdmod", rate = 2822400, amp = 0.5 });
        Assert.True(r.Num("noise_db") < -124, $"in the band: {r.Num("noise_db")} dB");
        Assert.Equal(-6.02, r.Num("tone_db")!.Value, 2);
        Assert.Equal(0.0, r.Num("resets"));
        // SACD's highest, 3.1 dB over its reference (71.4%), and 75% (item 255; the gain of 1.4 broke down at 65%):
        // still steady, still as quiet.
        foreach (var amp in new[] { 0.714, 0.75 })
        {
            var hi = await Run(new { fn = "dsdmod", rate = 2822400, amp });
            Assert.Equal(0.0, hi.Num("resets"));
            Assert.True(hi.Num("noise_db") < -124, $"at {amp}: {hi.Num("noise_db")} dB");
        }
        // Three tones together, and noise as music has it, at SACD's highest: never overloaded.
        foreach (var signal in new[] { "tones", "noise" })
            Assert.Equal(0.0, (await Run(new { fn = "dsdmod", rate = 2822400, amp = 0.714, signal }))["resets"]!.GetValue<double>());
    }

    [Test]
    public async Task At_DSD128_and_DSD256_the_loop_holds_past_SACDs_highest_level_too()
    {
        foreach (var rate in new[] { 5644800, 11289600 })
            foreach (var amp in new[] { 0.714, 0.75 })
            {
                var r = await Run(new { fn = "dsdmod", rate, amp, seconds = 0.25 });
                Assert.True(r.Num("resets") == 0, $"DSD{rate / 44100} at {amp}: {r.Num("resets")} reset(s)");
                Assert.True(r.Num("noise_db") < -150, $"DSD{rate / 44100} at {amp}: {r.Num("noise_db")} dB in the band");
            }
    }

    [Test]
    public async Task At_DSD256_the_noise_in_the_band_is_below_what_64_bit_arithmetic_keeps()
    {
        var r = await Run(new { fn = "dsdmod", rate = 11289600, amp = 0.5, seconds = 0.5 });
        Assert.True(r.Num("noise_db") < -200, $"in the band: {r.Num("noise_db")} dB");
        Assert.Equal(0.0, r.Num("resets"));
    }

    [Test]
    public async Task From_705_6_kHz_the_chain_makes_exactly_the_tracks_length_at_SACDs_level()
    {
        var r = await Run(new { fn = "dsdmod", chain = 2822400, amp = 1, seconds = 1 });
        Assert.Equal(r.Num("frames")!.Value * 4, r.Num("samples"));
        Assert.Equal(-6.02, r.Num("tone_db")!.Value, 2);
        Assert.True(r.Num("noise_db") < -124, $"in the band: {r.Num("noise_db")} dB");
        Assert.Equal(0.0, r.Num("resets"));
    }

    [Test]
    public async Task A_track_made_DSD64_is_a_DSF_ffmpeg_reads_at_the_sources_level_6_dB_down()
    {
        Needs.Server(); Needs.Ffmpeg();
        var dir = Directory.CreateTempSubdirectory("musicd-test-").FullName;
        try
        {
            var src = Path.Combine(dir, "a.flac");
            Fixtures.Gen(src, seconds: 2, freq: 997);
            var dsf = Path.Combine(dir, "a.dsf");
            var job = new JsonObject
            {
                ["ffmpeg"] = "ffmpeg",
                ["decode"] = new JsonArray("-hide_banner", "-nostdin", "-loglevel", "error", "-i", src, "-map", "0:a:0", "-vn", "-ac", "2", "-ar", "44100", "-f", "f64le", "-c:a", "pcm_f64le", "pipe:1"),
                // Its length said before it is made (item 259): the DSF's header written first, as it plays.
                ["rate"] = 44100, ["factor"] = 16, ["dsd"] = 2822400, ["out"] = dsf, ["frames"] = 2L * 44100,
            };
            var said = await Upsample(job);
            Assert.True(said["error"] == null, (string?)said["error"]);
            Assert.Equal(0.0, said.Num("resets"));
            // Its header: DSD64, stereo, the track's samples sixty-four times over.
            var head = new byte[92];
            using (var f = File.OpenRead(dsf)) f.ReadExactly(head);
            Assert.Equal(("DSD ", "fmt ", "data"), (Ascii(head, 0), Ascii(head, 28), Ascii(head, 80)));
            Assert.Equal((2822400, 2, 1), (BitConverter.ToInt32(head, 56), BitConverter.ToInt32(head, 52), BitConverter.ToInt32(head, 60)));
            Assert.Equal(2L * 44100 * 64, BitConverter.ToInt64(head, 64));
            Assert.Equal(new FileInfo(dsf).Length, BitConverter.ToInt64(head, 12));
            // Read back by ffmpeg: the source's tone, 6.02 dB down (SACD's level), the same length.
            var (a, b) = (Level(src), Level(dsf));
            Assert.True(Math.Abs(a - b - 6.02) < 0.05, $"the source {a:F3} dB, the DSD {b:F3} dB");
        }
        finally { Directory.Delete(dir, true); }
    }

    private static string Ascii(byte[] b, int at) => System.Text.Encoding.ASCII.GetString(b, at, 4);

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

    [GeneratedRegex(@"RMS level dB: (-?[0-9.]+)")] private static partial Regex RmsLevel();

    // The tone's RMS level in [file], read at 88.2 kHz and held to the audio band, in dBFS.
    private static double Level(string file)
    {
        var r = Fixtures.Run(["-hide_banner", "-nostats", "-i", file, "-af",
            "aresample=resampler=soxr:precision=33:osr=88200,lowpass=f=20000:p=2,lowpass=f=20000:p=2,atrim=start=0.25:end=1.75,astats=measure_perchannel=none", "-f", "null", "-"]);
        Assert.True(r.Code == 0, r.Err);
        var m = RmsLevel().Matches(r.Err);
        Assert.True(m.Count > 0, r.Err);
        return double.Parse(m[^1].Groups[1].Value, CultureInfo.InvariantCulture);
    }
}
