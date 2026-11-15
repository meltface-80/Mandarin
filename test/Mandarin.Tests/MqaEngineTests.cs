using System.Diagnostics;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// A sound device on this server given an MQA track untouched (bug list item 418): the engine applies no volume to a
/// stream whose address says mqa=1 (engine Untouched.cs), whatever the volume, so the DAC is fed the file's samples as
/// they are (16- and 24-bit words padded into the device's 32: the same values), silent only at 0% or muted; the same
/// stream without it is turned down as ever (50%: 25 dB).
/// </summary>
public sealed class MqaEngineTests
{
    private static Dictionary<string, string> App => new() { ["MANDARIN_APP_DIR"] = ServerProcess.Root };

    private static async Task<JsonArray> Run(object[] steps) => (await Score.Run(new { fn = "engine", steps }, App))["results"]!.AsArray();

    private static byte[] Pcm(string file)
    {
        var psi = new ProcessStartInfo(Fixtures.Ffmpeg) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in new[] { "-loglevel", "error", "-i", file, "-c:a", "pcm_s32le", "-f", "s32le", "-" }) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        using var ms = new MemoryStream();
        p.StandardOutput.BaseStream.CopyTo(ms);
        p.WaitForExit();
        return ms.ToArray();
    }

    [Test]
    public async Task An_MQA_stream_is_fed_to_the_DAC_as_it_is_at_any_volume_another_is_turned_down()
    {
        Needs.Server(); Needs.Ffmpeg();
        if (!OperatingSystem.IsLinux()) Assert.Skip("Linux only");
        var found = (await Run([new { find = true }]))[0];
        if (found == null)
        {
            Assert.True(Environment.GetEnvironmentVariable("CI") is not { Length: > 0 }, "CI builds the audio engine before the tests");
            Assert.Skip("no audio engine built (engine/build.sh)");
        }
        var bin = found.Str("bin")!;
        var dir = Directory.CreateTempSubdirectory("mqa-engine-").FullName;
        var track = Path.Combine(dir, "mqa.flac");
        MqaSignals.WriteFlac(track, new MqaSignals.Spec(44100, 24, MqaSignals.CodeOf(352800), 17, SyncAt: 0.2, Seconds: 1.5));
        var src = Pcm(track);
        await using var web = await FakeServer.Start(async ctx =>
        {
            ctx.Response.ContentType = "audio/flac";
            await ctx.Response.Body.WriteAsync(await File.ReadAllBytesAsync(track));
        });
        try
        {
            async Task<byte[]> Played(string query, string name, int volume = 50)
            {
                var file = Path.Combine(dir, name);
                var r = await Run([
                    new { open = new { location = "file:" + file, bin, volume } }, new { set = web.Base + "/stream/t1.orig.flac" + query }, new { play = true },
                    new { until = new { state = "PLAYING" } }, new { until = new { state = "STOPPED" }, ms = 10000 }]);
                Assert.True(r[4]!.GetValue<bool>(), name + ": played to its end");
                return await File.ReadAllBytesAsync(file);
            }
            var untouched = await Played("?mqa=1&s=x", "mqa.raw");
            Assert.True(untouched.Length == src.Length, "every frame");
            Assert.True(untouched.AsSpan().SequenceEqual(src), "at 50% the MQA stream's samples are untouched");
            var silent = await Played("?mqa=1&s=x", "mqa-0.raw", volume: 0);
            Assert.True(silent.Length == src.Length && silent.All(b => b == 0), "at 0% (or muted) it is silent all the same");
            var turned = await Played("?s=x", "plain.raw");
            long peak = 0, srcPeak = 0;
            for (var i = 0; i < turned.Length; i += 4)
            {
                peak = Math.Max(peak, Math.Abs((long)BitConverter.ToInt32(turned, i)));
                srcPeak = Math.Max(srcPeak, Math.Abs((long)BitConverter.ToInt32(src, i)));
            }
            Assert.True(Math.Abs(20 * Math.Log10((double)peak / srcPeak) - -25) < 0.05, "without mqa=1, 50% is 25 dB down");
        }
        finally { Directory.Delete(dir, true); }
    }
}
