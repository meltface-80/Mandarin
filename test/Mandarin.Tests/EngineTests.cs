using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Mandarin's audio engine (v0.8.0): engine/Mandarin.Audio, a native program written in C#, playing a
/// sound device on the server.
///   - it is found and answers its protocol; a program that isn't one is not used;
///   - two tracks go into one open device with nothing between them, every sample untouched at 100%;
///     the position follows the device; pause holds it where it is and play carries on; 50% is 25 dB down;
///   - through the ALSA library itself (its file plugin as the device): the same bit for bit;
///   - a seek is heard at once; a device that isn't there is said in words;
///   - the engine going away mid-track is said, and the next play starts it again.
/// The server's driver (Local/EngineOutput.cs, AudioEngine.cs), run step by step from a script
/// (`mandarin-server score` { fn: "engine" }, Local/EngineCommand.cs). The engine is built by
/// engine/build.sh (CI does it); without one the tests skip (test/engine.test.js, in C#).
/// </summary>
public sealed class EngineTests
{
    private static Dictionary<string, string> App(IDictionary<string, string>? env = null)
    {
        var e = new Dictionary<string, string> { ["MANDARIN_APP_DIR"] = ServerProcess.Root };
        foreach (var (k, v) in env ?? new Dictionary<string, string>()) e[k] = v;
        return e;
    }

    // The steps, run in order on one output at a time; one answer a step.
    private static async Task<JsonArray> Run(object[] steps, IDictionary<string, string>? env = null) =>
        (await Score.Run(new { fn = "engine", steps }, App(env)))["results"]!.AsArray();

    private static readonly Lazy<Task<JsonNode?>> Found = new(async () => (await Run([new { find = true }]))[0]);

    // The engine, or the test skipped (CI always has one).
    private static async Task<(string Bin, string Version)> Need()
    {
        Needs.Server(); Needs.Ffmpeg();
        if (!OperatingSystem.IsLinux() && !OperatingSystem.IsMacOS()) Assert.Skip("Linux and a Mac only");
        var f = await Found.Value;
        if (f == null)
        {
            Assert.True(Environment.GetEnvironmentVariable("CI") is not { Length: > 0 }, "CI builds the audio engine before the tests");
            Assert.Skip("no audio engine built (engine/build.sh)");
        }
        return (f.Str("bin")!, f.Str("version")!);
    }

    // ffmpeg's output, as bytes.
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

    private sealed record Tones(string Dir, string T1, string T2, byte[] Src, byte[] One);

    private static Tones MakeTones()
    {
        var dir = Directory.CreateTempSubdirectory("engine-").FullName;
        string t1 = Path.Combine(dir, "t1.flac"), t2 = Path.Combine(dir, "t2.flac");
        Ffmpeg("-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5:sample_rate=44100", "-ac", "2", "-sample_fmt", "s16", t1);
        // A 24-bit second track: the samples are carried, not converted.
        Ffmpeg("-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=660:duration=1:sample_rate=44100", "-ac", "2", "-sample_fmt", "s32", t2);
        static byte[] Pcm(string f) => Ffmpeg("-loglevel", "error", "-i", f, "-c:a", "pcm_s32le", "-f", "s32le", "-");
        var one = Pcm(t1);
        return new Tones(dir, t1, t2, [.. one, .. Pcm(t2)], one);
    }

    [Test]
    public async Task The_engine_is_found_and_answers_its_protocol_something_else_is_not_used()
    {
        var (bin, version) = await Need();
        var pkg = (string?)JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(ServerProcess.Root, "package.json")))!["version"];
        Assert.True(version == pkg, "built at the server's version");
        var r = await Run([new { probe = bin }, new { probe = "/bin/true" }, new { probe = "/no/such/file" },
            new { plays = "alsa:plughw:CARD=Mojo,DEV=0" }, new { plays = "coreaudio:MacBook Pro Speakers" }, new { plays = "airplay:Kitchen" }]);
        Assert.Equal(version, (string?)r[0]);
        Assert.True(r[1] == null, "a program that doesn't answer the protocol");
        Assert.Null(r[2]);
        Assert.True(r[3]!.GetValue<bool>());
        Assert.True(r[4]!.GetValue<bool>(), "a Mac's, through Core Audio (item 155)");
        Assert.False(r[5]!.GetValue<bool>(), "a location that isn't a device of this computer isn't the engine's");
        Assert.True((await Run([new { find = true }], new Dictionary<string, string> { ["AUDIO_ENGINE"] = "0" }))[0] == null, "AUDIO_ENGINE=0 turns it off");
    }

    [Test]
    public async Task Two_tracks_into_one_open_device_untouched_paused_where_it_is_scaled_below_100()
    {
        var (bin, _) = await Need();
        var t = MakeTones();
        var file = Path.Combine(t.Dir, "out.raw");
        var r = await Run([
            new { open = new { location = "file:" + file, bin } }, new { set = t.T1 }, new { next = t.T2 }, new { play = true },
            new { until = new { state = "PLAYING" } }, new { sink = true }, new { until = new { track = t.T1 }, ms = 0 },
            new { until = new { track = t.T2 }, ms = 8000 }, new { next_uri = true }, new { until = new { state = "STOPPED" }, ms = 8000 }, new { take_error = true }]);
        Assert.True(r[4]!.GetValue<bool>(), "playing");
        Assert.True(r[5].Num("rate") == 44100, "the device's format, as the hardware check reads it");
        Assert.True(r[6]!.GetValue<bool>(), "on the first track");
        Assert.True(r[7]!.GetValue<bool>(), "then the second");
        Assert.True((string?)r[8] == "", "the next track taken up, gapless");
        Assert.True(r[9]!.GetValue<bool>(), "and stopped at the end");
        Assert.Null(r[10]);
        var got = await File.ReadAllBytesAsync(file);
        Assert.True(got.Length == t.Src.Length, "every frame of both, nothing added between them");
        Assert.True(got.AsSpan().SequenceEqual(t.Src), "at 100% the samples are untouched");

        var file2 = Path.Combine(t.Dir, "out2.raw");
        var p = await Run([
            new { open = new { location = "file:" + file2, bin, volume = 50 } }, new { set = t.T1 }, new { play = true },
            new { until = new { above = 0.3 } }, new { pause = true }, new { wait = 400 }, new { position = true }, new { wait = 700 },
            new { state = true }, new { position = true }, new { play = true }, new { until = new { state = "STOPPED" }, ms = 8000 }]);
        var at = p[6]!.GetValue<double>();
        Assert.Equal("PAUSED_PLAYBACK", (string?)p[8]);
        Assert.True(Math.Abs(p[9]!.GetValue<double>() - at) < 0.01, $"held where it is ({at} → {p[9]})");
        Assert.True(p[11]!.GetValue<bool>(), "played on to the end");
        var b = await File.ReadAllBytesAsync(file2);
        Assert.True(b.Length == t.One.Length, "all of it, after the pause");
        long peak = 0, srcPeak = 0;
        for (int i = 0; i < b.Length; i += 4)
        {
            peak = Math.Max(peak, Math.Abs((long)BitConverter.ToInt32(b, i)));
            srcPeak = Math.Max(srcPeak, Math.Abs((long)BitConverter.ToInt32(t.One, i)));
        }
        Assert.True(Math.Abs(20 * Math.Log10((double)peak / srcPeak) - -25) < 0.01, "50% is 25 dB down");
    }

    [Test]
    public async Task Through_ALSA_itself_bit_for_bit_a_seek_is_heard_at_once_a_missing_device_is_said()
    {
        var (bin, _) = await Need();
        if (!OperatingSystem.IsLinux()) Assert.Skip("ALSA is Linux's");
        var t = MakeTones();
        var raw = Path.Combine(t.Dir, "alsa.raw");
        var conf = Path.Combine(t.Dir, "asound.conf");
        await File.WriteAllTextAsync(conf, $"pcm.mandtest {{ type file slave {{ pcm {{ type null }} }} file \"{raw}\" format \"raw\" }}\n");
        // The engine inherits ALSA_CONFIG_PATH from the program that starts it.
        var r = await Run([
            new { open = new { location = "alsa:mandtest", bin } }, new { set = t.T1 }, new { next = t.T2 }, new { play = true },
            new { until = new { size = new object[] { raw, t.Src.Length } }, ms = 15000 }, new { until = new { state = "STOPPED" }, ms = 15000 }, new { take_error = true },
            // A device that isn't there.
            new { open = new { location = "alsa:plughw:CARD=NoSuchCard,DEV=0", bin } }, new { set = t.T1 }, new { play = true },
            new { until = new { error = true } }, new { state = true }], new Dictionary<string, string> { ["ALSA_CONFIG_PATH"] = conf });
        Assert.True(r[5]!.GetValue<bool>(), "played to the end");
        Assert.Null(r[6]);
        Assert.True((await File.ReadAllBytesAsync(raw)).AsSpan().SequenceEqual(t.Src), "through libasound, every sample as it was");
        Assert.Matches("isn't there|stopped", r[10]?.ToString() ?? "");
        Assert.Equal("STOPPED", (string?)r[11]);

        // A seek, on the paced device: the position jumps there at once (played from the start, it would
        // take a second to get there) and plays on from it.
        var file = Path.Combine(t.Dir, "seek.raw");
        var s = await Run([
            new { open = new { location = "file:" + file, bin } }, new { set = t.T1 }, new { play = true },
            new { until = new { above = 0.2 } }, new { seek = 1.0 }, new { until = new { between = new[] { 1.0, 1.3 } }, ms = 600 }, new { until = new { state = "STOPPED" }, ms = 8000 }]);
        Assert.True(s[5]!.GetValue<bool>(), "the position jumped there");
        Assert.True(s[6]!.GetValue<bool>());
        // What played after the seek is the track from 1.0 s on, and what lay between was never played.
        var tail = Ffmpeg("-loglevel", "error", "-ss", "1", "-i", t.T1, "-c:a", "pcm_s32le", "-f", "s32le", "-");
        var b = await File.ReadAllBytesAsync(file);
        Assert.True(b.AsSpan(b.Length - tail.Length).SequenceEqual(tail), "after the seek, the track from where it was sent");
        Assert.True(b.Length < t.One.Length, $"skipped over: {b.Length} bytes played of the track's {t.One.Length}");
    }

    [Test]
    public async Task On_a_Mac_its_devices_are_listed_and_one_that_isnt_there_is_said()
    {
        var (bin, _) = await Need();
        if (!OperatingSystem.IsMacOS()) Assert.Skip("Core Audio is a Mac's (item 155)");
        // Every line `--devices` prints is a device with its name and rates (a runner may have none).
        using (var p = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(bin, "--devices") { RedirectStandardOutput = true })!)
        {
            var lines = (await p.StandardOutput.ReadToEndAsync()).Split('\n', StringSplitOptions.RemoveEmptyEntries);
            await p.WaitForExitAsync();
            Assert.Equal(0, p.ExitCode);
            Assert.All(lines, l => Assert.Matches("^\\{\"name\":\".*\",\"rates\":\"[0-9,]*\"\\}$", l));
        }
        var t = MakeTones();
        var r = await Run([new { open = new { location = "coreaudio:No Such DAC", bin } }, new { set = t.T1 }, new { play = true },
            new { until = new { error = true } }, new { state = true }]);
        Assert.Matches("isn't there", r[3]?.ToString() ?? "");
        Assert.Equal("STOPPED", (string?)r[4]);
    }

    [Test]
    public async Task The_engine_going_away_mid_track_is_said_the_next_play_starts_it_again()
    {
        var (bin, _) = await Need();
        var t = MakeTones();
        var r = await Run([
            new { open = new { location = "file:" + Path.Combine(t.Dir, "k.raw"), bin } }, new { set = t.T1 }, new { play = true },
            new { until = new { state = "PLAYING" } }, new { kill = true }, new { until = new { error = true } }, new { state = true },
            new { set = t.T1 }, new { play = true }, new { until = new { state = "PLAYING" } }]);
        Assert.True(r[3]!.GetValue<bool>());
        Assert.True(r[4]!.GetValue<bool>(), "the engine was there to kill");
        Assert.Matches("audio engine", r[5]?.ToString() ?? "");
        Assert.Equal("STOPPED", (string?)r[6]);
        Assert.True(r[9]!.GetValue<bool>(), "started again");
    }
}
