using System.Globalization;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Room correction (bug list items 252, 258, Playback/Convolution.cs, ImpulseRoutes.cs): impulse responses loaded on a
/// renderer's DSP as WAVs, or a zip of them, are checked, measured (the most each lifts anything, for the headroom) and
/// kept, one a rate; anything but a WAV is refused; Remove takes one rate's off, or all. A track runs through the one
/// at its rate, else the nearest of its family, resampled. Played, the track is run through it at its own rate: a response of −1 turns a
/// conversion upside down, the auto headroom's half a dB taken, on the stream as it is made and on a whole track made
/// ahead alike.
/// </summary>
public sealed class ConvolutionTests
{
    private const string Dev = "UPNP_test-conv";

    // A WAV of [samples] at [rate]: 32-bit float, one channel or, with [stereo], the same on both.
    private static byte[] Wav(double[] samples, int rate, bool stereo = false, bool pcm24 = false)
    {
        var ch = stereo ? 2 : 1;
        var width = pcm24 ? 3 : 4;
        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        var data = samples.Length * ch * width;
        w.Write("RIFF"u8); w.Write(36 + data); w.Write("WAVE"u8);
        w.Write("fmt "u8); w.Write(16); w.Write((short)(pcm24 ? 1 : 3)); w.Write((short)ch); w.Write(rate); w.Write(rate * ch * width); w.Write((short)(ch * width)); w.Write((short)(width * 8));
        w.Write("data"u8); w.Write(data);
        foreach (var x in samples)
            for (var c = 0; c < ch; c++)
            {
                if (!pcm24) { w.Write((float)x); continue; }
                var v = (int)Math.Round(Math.Clamp(x, -1, 1) * 8388607);
                w.Write((byte)v); w.Write((byte)(v >> 8)); w.Write((byte)(v >> 16));
            }
        w.Flush();
        return ms.ToArray();
    }

    private static async Task<Session> Started()
    {
        var s = await Session.Started();
        await Session.Until(async () => (await s.Api("library-stats")).J.Num("albums") == 3, 30000, "the library");
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        s.Server.Exec("INSERT INTO audio_devices(id, kind, network_name, first_seen, last_seen) VALUES($1, $2, $3, $4, $5)", Dev, "upnp", Dev, now, now);
        return s;
    }

    private static Task<Http.Answer> Load(Session s, byte[] wav, string name) =>
        Http.Send(HttpMethod.Post, s.Base + $"/api/audio-devices/{Dev}/impulse?name={Uri.EscapeDataString(name)}", new ByteArrayContent(wav), s.H);

    private static Task<Http.Answer> Patch(Session s, object body) =>
        Http.Send(HttpMethod.Patch, s.Base + $"/api/audio-devices/{Dev}", new StringContent(Http.Json(body), System.Text.Encoding.UTF8, "application/json"), s.H);

    // A FLAC's samples, both channels in turn, as 64-bit floats.
    private static double[] Decode(byte[] flac)
    {
        var path = Path.Combine(Path.GetTempPath(), "mandarin-conv-" + Guid.NewGuid().ToString("N") + ".flac");
        File.WriteAllBytes(path, flac);
        try
        {
            var (code, b, err) = FfmpegOut.Run(["-hide_banner", "-loglevel", "error", "-i", path, "-f", "f64le", "-c:a", "pcm_f64le", "-"]);
            Assert.True(code == 0, err);
            var x = new double[b.Length / 8];
            Buffer.BlockCopy(b, 0, x, 0, x.Length * 8);
            return x;
        }
        finally { File.Delete(path); }
    }

    // The most [a] differs from [b] turned over and scaled by [g], away from the ends.
    private static double Inverted(double[] a, double[] b, double g)
    {
        Assert.Equal(b.Length, a.Length);
        double worst = 0;
        for (var i = 4096; i < a.Length - 4096; i++) worst = Math.Max(worst, Math.Abs(a[i] + g * b[i]));
        return worst;
    }

    // A zip of [files]: each name and its bytes.
    private static byte[] Zip(params (string Name, byte[] Bytes)[] files)
    {
        using var ms = new MemoryStream();
        using (var z = new System.IO.Compression.ZipArchive(ms, System.IO.Compression.ZipArchiveMode.Create, true))
            foreach (var (name, bytes) in files) { using var e = z.CreateEntry(name).Open(); e.Write(bytes); }
        return ms.ToArray();
    }

    // The device's responses as its page has them: each "name@rate".
    private static string[] Set(JsonNode? dsp) =>
        dsp?["convolution"] is JsonArray a ? a.Select(c => $"{c.Str("name")}@{c.Num("rate")}").ToArray() : [];

    [Test]
    public async Task Responses_are_checked_measured_and_kept_one_a_rate_and_taken_off_one_or_all()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var s = await Started();
        // Half a sample's height: 6 dB down everywhere.
        var half = new double[480]; half[0] = 0.5;
        var r = await Load(s, Wav(half, 48000), "half.wav");
        Assert.True(r.Status == 200, r.Text);
        var c = r.J["dsp"]?["convolution"]?[0];
        Assert.Equal(("half.wav", 48000.0, 1.0, -6.0), (c.Str("name"), c.Num("rate")!.Value, c.Num("channels")!.Value, c.Num("peak_db")!.Value));
        Assert.Matches("^[0-9a-f]{16}\\.wav$", c.Str("file")!);
        Assert.True(File.Exists(Path.Combine(s.Lib.Data, "impulses", c.Str("file")!)), "kept beside the database");
        // 24-bit PCM, two channels, full scale, at 44.1 kHz: beside it, in the order of their rates (item 258).
        var unit = new double[441]; unit[10] = 1;
        r = await Load(s, Wav(unit, 44100, stereo: true, pcm24: true), "room.wav");
        Assert.Equal(["room.wav@44100", "half.wav@48000"], Set(r.J["dsp"]));
        Assert.Equal((2.0, 0.0), (r.J["dsp"]?["convolution"]?[0].Num("channels")!.Value, r.J["dsp"]?["convolution"]?[0].Num("peak_db")!.Value));
        // Not a WAV: refused, the ones before kept.
        r = await Load(s, "Preamp: -6 dB"u8.ToArray(), "eq.txt");
        Assert.Equal((400, "not a WAV file"), (r.Status, r.J.Str("error")));
        Assert.Equal(["room.wav@44100", "half.wav@48000"], Set((await s.Api($"audio-devices/{Dev}")).J["dsp"]));
        // Another at 48 kHz takes that one's place.
        r = await Load(s, Wav(unit, 48000), "room48.wav");
        Assert.Equal(["room.wav@44100", "room48.wav@48000"], Set(r.J["dsp"]));
        // A zip of a set, as REW exports one: each WAV in it by its own name; anything else in it let be.
        r = await Load(s, Zip(("room88.wav", Wav(unit, 88200)), ("room96.wav", Wav(unit, 96000)), ("readme.txt", "x"u8.ToArray())), "set.zip");
        Assert.True(r.Status == 200, r.Text);
        Assert.Equal(["room.wav@44100", "room48.wav@48000", "room88.wav@88200", "room96.wav@96000"], Set(r.J["dsp"]));
        r = await Load(s, Zip(("readme.txt", "x"u8.ToArray())), "notes.zip");
        Assert.Equal((400, "the zip holds no WAV file"), (r.Status, r.J.Str("error")));
        // One rate taken off; then all.
        r = await Http.Send(HttpMethod.Delete, s.Base + $"/api/audio-devices/{Dev}/impulse?rate=48000", null, s.H);
        Assert.Equal(["room.wav@44100", "room88.wav@88200", "room96.wav@96000"], Set(r.J["dsp"]));
        var kept = r.J["dsp"]?["convolution"]?[0]!.DeepClone();
        r = await Http.Send(HttpMethod.Delete, s.Base + $"/api/audio-devices/{Dev}/impulse", null, s.H);
        Assert.True(r.Status == 200, r.Text);
        Assert.Null(r.J["dsp"]?["convolution"]);
        // One response as item 252 kept it (an object, not a list): read as a set of one.
        s.Server.Exec("UPDATE audio_devices SET settings = $1 WHERE id = $2", Http.Json(new { dsp = new { enabled = true, convolution = kept } }), Dev);
        Assert.Equal(["room.wav@44100"], Set((await s.Api($"audio-devices/{Dev}")).J["dsp"]));
    }

    [Test]
    public async Task Played_the_track_is_run_through_it_as_made_and_made_ahead()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var s = await Started();
        var song = s.Server.Rows("SELECT * FROM tracks WHERE title = $1", "Song 1")[0];
        Assert.True((await Patch(s, new { output = new { mode = "x2" }, dsp = new { enabled = true } })).Status == 200);
        var flip = new double[441]; flip[0] = -1;
        var same = new double[480]; same[0] = 1;
        var loaded = await Load(s, Wav(flip, 44100), "flip.wav");
        Assert.True(loaded.Status == 200, loaded.Text);
        // The auto headroom: the response lifts nothing, so half a dB under 0.
        Assert.Equal(-0.5, loaded.J["dsp_info"].Num("headroom"));
        var g = Math.Pow(10, -0.5 / 20);
        // One at 48 kHz beside it that leaves the track as it is (item 258): a 44.1 kHz track takes the one at its rate.
        await Load(s, Wav(same, 48000), "same48.wav");

        // As it is made: the conversion with the responses against the same without them, the DSP then doing nothing.
        var addr = $"/stream/t{song["id"]}.88200-24.flac?o={Dev}";
        var with = await Bytes.Get(s.Base + addr, s.H);
        Assert.Equal(200, with.Status);
        // With none at its rate, the nearest of its family (88.2 kHz's, over 48 kHz's), resampled to its own.
        await Http.Send(HttpMethod.Delete, s.Base + $"/api/audio-devices/{Dev}/impulse?rate=44100", null, s.H);
        await Load(s, Wav(new double[882].Select((_, i) => i == 0 ? -1.0 : 0).ToArray(), 88200), "flip88.wav");
        var family = await Bytes.Get(s.Base + addr, s.H);
        await Http.Send(HttpMethod.Delete, s.Base + $"/api/audio-devices/{Dev}/impulse", null, s.H);
        var without = await Bytes.Get(s.Base + addr, s.H);
        var worst = Inverted(Decode(with.Body), Decode(without.Body), g);
        Assert.True(worst < 1e-4, string.Create(CultureInfo.InvariantCulture, $"its own rate's, turned over, half a dB down: {worst}"));
        // Resampled from 88.2 kHz, on time (it came out 0.7 ms late before: 0.07 off), and as near as the resampler's
        // band edge allows: what an 88.2 kHz response holds above 22 kHz a 44.1 kHz track can't (some −72 dB here).
        var fworst = Inverted(Decode(family.Body), Decode(without.Body), g);
        Assert.True(fworst < 1e-3, string.Create(CultureInfo.InvariantCulture, $"its family's, resampled, turned over: {fworst}"));

        // Made ahead, the whole track: the response in its decoding, before it is upsampled.
        await Load(s, Wav(flip, 44100), "flip.wav");
        Assert.True((await Patch(s, new { output = new { filter = "whole" } })).Status == 200);
        var made = Path.Combine(s.Lib.Data, "transcode");
        var whole = addr.Replace("88200-24.", "88200-24w.", StringComparison.Ordinal);
        await Bytes.Get(s.Base + whole, s.H);
        string? first = null;
        await Session.Until(() => Task.FromResult((first = Directory.Exists(made) ? Directory.GetFiles(made, "*-w.flac").FirstOrDefault() : null) != null), 60000, "the whole track made");
        await Http.Send(HttpMethod.Delete, s.Base + $"/api/audio-devices/{Dev}/impulse", null, s.H);
        await Bytes.Get(s.Base + whole, s.H);
        string? second = null;
        await Session.Until(() => Task.FromResult((second = Directory.GetFiles(made, "*-w.flac").FirstOrDefault(f => f != first)) != null), 60000, "the whole track made again");
        var wworst = Inverted(Decode(await File.ReadAllBytesAsync(first!)), Decode(await File.ReadAllBytesAsync(second!)), g);
        Assert.True(wworst < 1e-4, string.Create(CultureInfo.InvariantCulture, $"made ahead, turned over: {wworst}"));
    }
}
