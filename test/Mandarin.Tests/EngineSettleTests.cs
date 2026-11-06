using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Mandarin's audio engine with Mandarin's continuous PCM (item 322), as Mandarin Bridge for Linux plays it:
///   - a raw PCM stream, its format said after "#pcm=" in its address (no header to read it from), is played with
///     every sample untouched, on into the next of the same format with nothing between them; and one held open (as
///     Mandarin holds a run while it waits for the next track) plays as it comes, not once it ends;
///   - at a change of rate between two tracks (16/44.1 then 24/48) the device is given half a second of silence at the
///     new rate before the next track's first sample, so the DAC settles without a click; the same rate, none.
/// Driven as EngineTests drives it (the server's driver, `mandarin-server score` { fn: "engine" }), onto a file.
/// </summary>
public sealed class EngineSettleTests
{
    private static async Task<JsonArray> Run(object[] steps) =>
        (await Score.Run(new { fn = "engine", steps }, new Dictionary<string, string> { ["MANDARIN_APP_DIR"] = ServerProcess.Root }))["results"]!.AsArray();

    // The engine, or the test skipped (CI always has one).
    private static async Task<string> Need()
    {
        Needs.Server(); Needs.Ffmpeg(); Needs.Engine();
        var f = (await Run([new { find = true }]))[0];
        if (f == null)
        {
            Assert.True(Environment.GetEnvironmentVariable("CI") is not { Length: > 0 }, "CI builds the audio engine before the tests");
            Assert.Skip("no audio engine built (engine/build.sh)");
        }
        return f.Str("bin")!;
    }

    private static byte[] Ffmpeg(params string[] args)
    {
        var psi = new ProcessStartInfo(Fixtures.Ffmpeg) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        var err = p.StandardError.ReadToEndAsync();
        using var ms = new MemoryStream();
        p.StandardOutput.BaseStream.CopyTo(ms);
        p.WaitForExit();
        Assert.True(p.ExitCode == 0, err.Result);
        return ms.ToArray();
    }

    // A tone of [hz] for [seconds] at [rate], in [fmt] ("s16", "s32"), as a FLAC; and its samples as the engine writes them (32-bit words).
    private static (string File, byte[] Pcm) Tone(string dir, string name, int hz, double seconds, int rate, string fmt)
    {
        var f = Path.Combine(dir, name + ".flac");
        Ffmpeg("-loglevel", "error", "-y", "-f", "lavfi", "-i", $"sine=frequency={hz}:duration={seconds}:sample_rate={rate}", "-ac", "2", "-sample_fmt", fmt, f);
        return (f, Ffmpeg("-loglevel", "error", "-i", f, "-c:a", "pcm_s32le", "-f", "s32le", "-"));
    }

    [Test]
    public async Task A_raw_PCM_stream_said_by_its_address_is_played_untouched_on_into_the_next()
    {
        var bin = await Need();
        var dir = Directory.CreateTempSubdirectory("engine-raw-").FullName;
        var (f1, p1) = Tone(dir, "a", 440, 1.0, 44100, "s16");
        var (f2, p2) = Tone(dir, "b", 660, 0.8, 44100, "s32");
        // As Mandarin sends them to a Bridge: the samples alone, 16 bits and 24, no header.
        string r1 = Path.Combine(dir, "a.raw"), r2 = Path.Combine(dir, "b.raw");
        await File.WriteAllBytesAsync(r1, Ffmpeg("-loglevel", "error", "-i", f1, "-c:a", "pcm_s16le", "-f", "s16le", "-"));
        await File.WriteAllBytesAsync(r2, Ffmpeg("-loglevel", "error", "-i", f2, "-c:a", "pcm_s24le", "-f", "s24le", "-"));
        var file = Path.Combine(dir, "out.raw");
        var r = await Run([
            new { open = new { location = "file:" + file, bin } }, new { set = r1 + "#pcm=s16le:44100:2" }, new { next = r2 + "#pcm=s24le:44100:2" }, new { play = true },
            new { until = new { state = "PLAYING" } }, new { until = new { state = "STOPPED" }, ms = 8000 }, new { take_error = true }]);
        Assert.True(r[4]!.GetValue<bool>(), "playing");
        Assert.True(r[5]!.GetValue<bool>(), "played to the end");
        Assert.Null(r[6]);
        var got = await File.ReadAllBytesAsync(file);
        Assert.True(got.AsSpan().SequenceEqual([.. p1, .. p2]), $"both streams' samples untouched, nothing between them ({got.Length} bytes, {p1.Length + p2.Length} expected)");
    }

    [Test]
    public async Task A_raw_stream_held_open_plays_as_it_comes_not_once_it_ends()
    {
        var bin = await Need();
        var dir = Directory.CreateTempSubdirectory("engine-held-").FullName;
        var (f1, p1) = Tone(dir, "a", 440, 1.0, 44100, "s16");
        var raw = Ffmpeg("-loglevel", "error", "-i", f1, "-c:a", "pcm_s16le", "-f", "s16le", "-");
        // As Mandarin holds a run open while it waits to be told the next track: a second of samples, then nothing, still open.
        var listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
        listener.Start();
        var port = ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;
        var serve = Task.Run(async () =>
        {
            using var c = await listener.AcceptTcpClientAsync();
            var n = c.GetStream();
            var head = new byte[4096];
            _ = await n.ReadAsync(head);
            await n.WriteAsync(System.Text.Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n"));
            await n.WriteAsync(raw);
            await Task.Delay(8000);
        });
        var file = Path.Combine(dir, "out.raw");
        var r = await Run([
            new { open = new { location = "file:" + file, bin } }, new { set = $"http://127.0.0.1:{port}/run.pcm#pcm=s16le:44100:2" }, new { play = true },
            new { until = new { size = new object[] { file, p1.Length / 2 } }, ms = 3000 }, new { state = true }, new { halt = true }]);
        listener.Stop();
        Assert.True(r[3]!.GetValue<bool>(), "half the second played within three, the stream still open");
        Assert.Equal("PLAYING", (string?)r[4]);
        var got = await File.ReadAllBytesAsync(file);
        Assert.True(got.AsSpan(0, p1.Length / 2).SequenceEqual(p1.AsSpan(0, p1.Length / 2)), "its samples untouched");
    }

    [Test]
    public async Task A_change_of_rate_is_given_half_a_second_of_silence_at_the_new_rate_the_same_rate_none()
    {
        var bin = await Need();
        var dir = Directory.CreateTempSubdirectory("engine-settle-").FullName;
        var (f1, p1) = Tone(dir, "cd", 440, 1.0, 44100, "s16");
        var (f2, p2) = Tone(dir, "hi", 660, 0.8, 48000, "s32");
        var file = Path.Combine(dir, "out.raw");
        var r = await Run([
            new { open = new { location = "file:" + file, bin } }, new { set = f1 }, new { next = f2 }, new { play = true },
            new { until = new { track = f2 }, ms = 8000 }, new { until = new { state = "STOPPED" }, ms = 8000 }, new { take_error = true }]);
        Assert.True(r[4]!.GetValue<bool>(), "on to the second track");
        Assert.True(r[5]!.GetValue<bool>(), "played to the end");
        Assert.Null(r[6]);
        var got = await File.ReadAllBytesAsync(file);
        var silence = new byte[48000 / 2 * 8];   // 0.5 s at 48 kHz, stereo, 32-bit words
        Assert.True(got.AsSpan().SequenceEqual([.. p1, .. silence, .. p2]),
            $"the first track whole, then {silence.Length} bytes of silence at 48 kHz, then the second whole ({got.Length} bytes, {p1.Length + silence.Length + p2.Length} expected)");
    }
}
