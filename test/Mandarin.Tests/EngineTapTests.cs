using System.Buffers.Binary;
using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The audio engine's tap (item 412, engine/Mandarin.Audio/Capture.cs, TapSink.cs): what Mandarin Bridge for Linux
/// records for the bit-perfect check is every byte the engine handed the device, as it handed it.
///   - PCM of 16, 24 and 32 bits, each in the engine's 32-bit word: the recording is the device's bytes, all of them,
///     and through ALSA itself (its file plugin as the device) the bytes ALSA was given; at a gain below 1, the scaled
///     words the device was given, not the file's. Its WAV and sidecar as the Android Bridge writes them;
///   - DSD as DoP and as native words, big- and little-endian: the device's bytes, and the sidecar says which;
///   - asked "after_flush" while a track plays, it begins on the first byte after the track is played again (a stop,
///     then a play, as Mandarin's restart is), in parts that follow on byte for byte, each let go when dropped; a second
///     start while one runs is refused.
/// The engine is run on its own, told what to do on its stdin as Mandarin Bridge for Linux tells it (Player.cs).
/// </summary>
public sealed class EngineTapTests
{
    private static string Bin() => Path.Combine(ServerProcess.Root, "engine", "bin", "mandarin-audio");

    // The engine, or the test skipped (CI always builds one).
    private static string Need()
    {
        Needs.Ffmpeg(); Needs.Engine();
        if (File.Exists(Bin())) return Bin();
        Assert.True(Environment.GetEnvironmentVariable("CI") is not { Length: > 0 }, "CI builds the audio engine before the tests");
        Assert.Skip("no audio engine built (engine/build.sh)");
        return "";
    }

    /* The engine running on [device], its events kept as they come. */
    private sealed class Engine : IAsyncDisposable
    {
        private readonly Process p;
        private readonly List<JsonObject> events = [];

        public Engine(string device, string native = "", IDictionary<string, string>? env = null)
        {
            var psi = new ProcessStartInfo(Bin()) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            foreach (var a in new[] { "--device", device, "--ffmpeg", Fixtures.Ffmpeg, "--settle-ms", "0" }) psi.ArgumentList.Add(a);
            if (native.Length > 0) { psi.ArgumentList.Add("--dsd-native"); psi.ArgumentList.Add(native); }
            foreach (var (k, v) in env ?? new Dictionary<string, string>()) psi.Environment[k] = v;
            p = Process.Start(psi)!;
            p.ErrorDataReceived += (_, _) => { };
            p.BeginErrorReadLine();
            _ = Task.Run(async () =>
            {
                string? l;
                while ((l = await p.StandardOutput.ReadLineAsync()) != null)
                    if (JsonNode.Parse(l) is JsonObject o) lock (events) events.Add(o);
            });
        }

        public void Tell(object cmd) { p.StandardInput.WriteLine(System.Text.Json.JsonSerializer.Serialize(cmd)); p.StandardInput.Flush(); }

        /* The first event since [from] that [match]es, waited for. */
        public async Task<JsonObject> Until(Func<JsonObject, bool> match, int ms = 15000, string what = "", int from = 0)
        {
            JsonObject? found = null;
            await Session.Until(() => { lock (events) found = events.Skip(from).FirstOrDefault(match); return Task.FromResult(found != null); }, ms, what);
            return found!;
        }

        public int Count { get { lock (events) return events.Count; } }

        public async ValueTask DisposeAsync()
        {
            try { Tell(new { cmd = "quit" }); await p.WaitForExitAsync(new CancellationTokenSource(3000).Token); }
            catch (Exception e) when (e is IOException or OperationCanceledException or InvalidOperationException) { p.Kill(true); }
            p.Dispose();
        }
    }

    private static bool Capture(JsonObject e, string state) => (string?)e["ev"] == "capture" && (string?)e["state"] == state;

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

    // Noise for [seconds] at [rate], written as [codec] ("flac" with [fmt] s16 or s32, or "pcm_s32le" in a WAV): its path.
    private static string Noise(string dir, string name, double seconds, int rate, string fmt, string codec = "flac")
    {
        var f = Path.Combine(dir, name);
        Ffmpeg("-loglevel", "error", "-y", "-f", "lavfi", "-i", $"anoisesrc=d={seconds}:r={rate}:a=0.4:s=7", "-ac", "2", "-sample_fmt", fmt, "-c:a", codec, f);
        return f;
    }

    private static byte[] Pcm32(string f) => Ffmpeg("-loglevel", "error", "-i", f, "-c:a", "pcm_s32le", "-f", "s32le", "-");

    // A recording's WAV: its rate, channels, container and valid bits, and its samples.
    private static (int Rate, int Channels, int Container, int Valid, byte[] Data) Wav(string path)
    {
        var b = File.ReadAllBytes(path);
        Assert.True(b.AsSpan(0, 4).SequenceEqual("RIFF"u8) && b.AsSpan(8, 4).SequenceEqual("WAVE"u8), "a RIFF WAV");
        Assert.Equal(0xFFFE, BinaryPrimitives.ReadUInt16LittleEndian(b.AsSpan(20)));
        Assert.True(b.AsSpan(60, 4).SequenceEqual("data"u8), "its samples after a 68-byte header, as the Android Bridge's");
        var data = (int)BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(64));
        Assert.Equal(b.Length - 68, data);
        return ((int)BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(24)), BinaryPrimitives.ReadUInt16LittleEndian(b.AsSpan(22)),
            BinaryPrimitives.ReadUInt16LittleEndian(b.AsSpan(34)), BinaryPrimitives.ReadUInt16LittleEndian(b.AsSpan(38)), b[68..]);
    }

    private static JsonObject Sidecar(string wav) => (JsonNode.Parse(File.ReadAllText(wav + ".json"))!["capture"] as JsonObject)!;

    // [track] played by an engine on [device] with a recording asked for first, in one piece: the recording's WAV.
    private static async Task<string> Recorded(string device, string track, string dir, string native = "", double gain = 1, IDictionary<string, string>? env = null)
    {
        var cap = Path.Combine(dir, "cap-" + Guid.NewGuid().ToString("N")[..8]);
        await using var e = new Engine(device, native, env);
        await e.Until(x => (string?)x["ev"] == "hello" && x["capture"]?.GetValue<bool>() == true, what: "its hello, saying it records");
        if (gain != 1) e.Tell(new { cmd = "gain", value = gain });
        e.Tell(new { cmd = "capture", dir = cap, seconds = 60, tool = "Mandarin Bridge test", about = new { device = new { device = "Stand-in DAC" }, dsd_setting = "native" } });
        var ok = await e.Until(x => (string?)x["answer"] == "start", what: "its answer");
        Assert.True(ok["ok"]!.GetValue<bool>(), ok.ToJsonString());
        Assert.Equal("armed", (string?)ok["state"]);
        e.Tell(new { cmd = "play", uri = track, offset = 0 });
        // The queue played out: the device drained, the stream ended, and with it the recording.
        var done = await e.Until(x => Capture(x, "done") || Capture(x, "failed"), 20000, "the recording done");
        Assert.Equal("done", (string?)done["state"]);
        Assert.Equal("the stream ended", (string?)done["reason"]);
        Assert.Equal("/capture.wav", (string?)done["wav"]);
        return Path.Combine(cap, "capture.wav");
    }

    [Test]
    public async Task PCM_of_16_24_and_32_bits_is_recorded_as_every_byte_the_device_took_and_through_ALSA_the_bytes_ALSA_was_given()
    {
        Need();
        var dir = Directory.CreateTempSubdirectory("engine-tap-").FullName;
        try
        {
            foreach (var (name, fmt, codec, rate) in new[] { ("t16.flac", "s16", "flac", 44100), ("t24.flac", "s32", "flac", 96000), ("t32.wav", "s32", "pcm_s32le", 48000) })
            {
                var track = Noise(dir, name, 1.2, rate, fmt, codec);
                var raw = Path.Combine(dir, name + ".raw");
                var wav = await Recorded("file:" + raw, track, dir);
                var (r, ch, container, valid, data) = Wav(wav);
                Assert.Equal((rate, 2, 32, 32), (r, ch, container, valid));
                var device = await File.ReadAllBytesAsync(raw);
                Assert.True(data.AsSpan().SequenceEqual(device), $"{name}: the recording is every byte the device took ({data.Length} of {device.Length})");
                Assert.True(data.AsSpan().SequenceEqual(Pcm32(track)), $"{name}: the track's own samples, untouched");
                var said = Sidecar(wav);
                Assert.Equal(("pcm", 32, 32, rate, 0L), ((string?)said["kind"], (int)said["container_bits"]!, (int)said["valid_bits"]!, (int)said["rate"]!, (long)said["first_frame"]!));
                Assert.Equal(data.Length / 8, (long)said["frames"]!);
                Assert.Equal("Stand-in DAC", (string?)said["device"]?["device"]);
            }

            // Through libasound itself: the tap's bytes are the bytes ALSA was given.
            var t = Noise(dir, "alsa.flac", 1.0, 96000, "s32");
            var alsaRaw = Path.Combine(dir, "alsa.raw");
            var conf = Path.Combine(dir, "asound.conf");
            await File.WriteAllTextAsync(conf, $"pcm.mandtap {{ type file slave {{ pcm {{ type null }} }} file \"{alsaRaw}\" format \"raw\" }}\n");
            var viaAlsa = await Recorded("alsa:mandtap", t, dir, env: new Dictionary<string, string> { ["ALSA_CONFIG_PATH"] = conf });
            var given = await File.ReadAllBytesAsync(alsaRaw);
            Assert.True(given.Length > 0 && Wav(viaAlsa).Data.AsSpan().SequenceEqual(given), "through ALSA, every byte it was given");

            // At half the gain: the words the device was given, scaled, not the file's.
            var halfRaw = Path.Combine(dir, "half.raw");
            var half = Wav(await Recorded("file:" + halfRaw, t, dir, gain: 0.5)).Data;
            var halfDevice = await File.ReadAllBytesAsync(halfRaw);
            Assert.True(half.AsSpan().SequenceEqual(halfDevice), "the scaled words the device took");
            Assert.False(half.AsSpan().SequenceEqual(Pcm32(t)), "not the file's");
        }
        finally { Directory.Delete(dir, true); }
    }

    // A DSF of noise, [blocks] blocks of 4096 bytes a channel at DSD64.
    private static string Dsf(string dir, int blocks)
    {
        const int block = 4096;
        var data = new byte[blocks * block * 2];
        new Random(412).NextBytes(data);
        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        w.Write("DSD "u8); w.Write(28L); w.Write(92L + data.Length); w.Write(0L);
        w.Write("fmt "u8); w.Write(52L); w.Write(1); w.Write(0); w.Write(2); w.Write(2); w.Write(2822400); w.Write(1); w.Write((long)blocks * block * 8); w.Write(block); w.Write(0);
        w.Write("data"u8); w.Write(12L + data.Length); w.Write(data);
        w.Flush();
        var path = Path.Combine(dir, "t.dsf");
        File.WriteAllBytes(path, ms.ToArray());
        return path;
    }

    [Test]
    public async Task DSD_as_DoP_and_as_native_words_either_way_round_is_recorded_as_the_device_took_it()
    {
        Need();
        var dir = Directory.CreateTempSubdirectory("engine-tap-dsd-").FullName;
        try
        {
            var dsf = Dsf(dir, 60);
            foreach (var (native, kind, setting, rate, format) in new[] { ("", "dop", "dop", 176400, "S32_LE"), ("DSD_U32_BE:64", "dsd", "native", 88200, "DSD_U32_BE"), ("DSD_U32_LE:64", "dsd", "native_le", 88200, "DSD_U32_LE") })
            {
                var raw = Path.Combine(dir, kind + setting + ".raw");
                var wav = await Recorded("file:" + raw, dsf, dir, native);
                var (r, _, container, valid, data) = Wav(wav);
                Assert.Equal((rate, 32, 32), (r, container, valid));
                var device = await File.ReadAllBytesAsync(raw);
                Assert.True(data.Length > 0 && data.AsSpan().SequenceEqual(device), $"{setting}: every byte the device took ({data.Length} of {device.Length})");
                var said = Sidecar(wav);
                Assert.Equal((kind, setting, format, true), ((string?)said["kind"], (string?)said["dsd_setting"], (string?)said["format"], (bool)said["dsd"]!));
            }
        }
        finally { Directory.Delete(dir, true); }
    }

    [Test]
    public async Task After_a_flush_it_begins_on_the_first_byte_played_again_in_parts_that_follow_on()
    {
        Need();
        var dir = Directory.CreateTempSubdirectory("engine-tap-flush-").FullName;
        try
        {
            var track = Noise(dir, "t.flac", 3.0, 44100, "s16");
            var cap = Path.Combine(dir, "cap");
            await using var e = new Engine("file:" + Path.Combine(dir, "out.raw"));
            e.Tell(new { cmd = "play", uri = track, offset = 0 });
            await e.Until(x => (string?)x["ev"] == "pos" && (double)x["seconds"]! > 0.6, what: "the track under way");
            // Asked while it plays: armed, nothing recorded until the track is played again from its start.
            var asked = e.Count;
            e.Tell(new { cmd = "capture", dir = cap, seconds = 4, part = 1, after_flush = true });
            Assert.True((await e.Until(x => (string?)x["answer"] == "start", from: asked))["ok"]!.GetValue<bool>());
            var before = e.Count;
            await Task.Delay(500);
            Assert.False(await Saw(e, x => Capture(x, "recording"), asked), "nothing recorded before the flush");
            e.Tell(new { cmd = "capture", dir = cap, seconds = 4 });
            Assert.False((await e.Until(x => (string?)x["answer"] == "start", from: before))["ok"]!.GetValue<bool>(), "a second start refused while one is armed");
            // Mandarin's restart: a stop, then the track from its start.
            e.Tell(new { cmd = "stop" });
            e.Tell(new { cmd = "play", uri = track, offset = 0 });
            var done = await e.Until(x => Capture(x, "done") || Capture(x, "failed"), 20000, "the recording done");
            Assert.Equal("the stream ended", (string?)done["reason"]);
            var parts = done["parts"]!.AsArray().Select(x => (int)x!["n"]!).ToList();
            Assert.Equal([1, 2, 3], parts);

            // The parts, one on from the other, are the track from its very first byte: none of what played before the flush.
            var got = new List<byte>();
            long frames = 0;
            foreach (var n in parts)
            {
                var wav = Path.Combine(cap, $"capture-{n}.wav");
                var said = Sidecar(wav);
                Assert.Equal((n, frames), ((int)said["part"]!, (long)said["first_frame"]!));
                var data = Wav(wav).Data;
                frames += data.Length / 8;
                got.AddRange(data);
            }
            var want = Pcm32(track);
            Assert.Equal(want.Length, got.Count);
            Assert.True(got.ToArray().AsSpan().SequenceEqual(want), "the track played again, every byte from its first, in order");

            // A part let go once fetched; one that isn't there, refused.
            e.Tell(new { cmd = "capture_drop", n = 1 });
            var dropped = await e.Until(x => (string?)x["answer"] == "drop");
            Assert.True(dropped["ok"]!.GetValue<bool>());
            Assert.False(File.Exists(Path.Combine(cap, "capture-1.wav")) || File.Exists(Path.Combine(cap, "capture-1.wav.json")), "its files gone");
            Assert.Equal([2, 3], dropped["parts"]!.AsArray().Select(x => (int)x!["n"]!).ToList());
            var after = e.Count;
            e.Tell(new { cmd = "capture_drop", n = 1 });
            Assert.False((await e.Until(x => (string?)x["answer"] == "drop", from: after))["ok"]!.GetValue<bool>());
        }
        finally { Directory.Delete(dir, true); }
    }

    private static Task<bool> Saw(Engine e, Func<JsonObject, bool> match, int from) =>
        e.Until(match, 1, from: from).ContinueWith(t => t.IsCompletedSuccessfully, TaskScheduler.Default);
}
