using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// DSD played as PCM, its modulator's noise above the band taken off (bug list item 241, Playback/DsdLowpass.cs).
/// DSD64 carries its noise above the audio band; a device that takes PCM was sent all of it up to the top of the rate
/// it goes at. A device set to a low-pass now has the track pass through SoX's resampler twice, down to a rate a
/// little above the cut and back up: measured here on a real DSD64 file made by a sigma-delta modulator, the noise
/// above the cut gone and the band below it as it was, the same length, no tail.
/// </summary>
public sealed partial class DsdLowpassTests
{
    private static JsonObject J(object o) => JsonNode.Parse(Http.Json(o))!.AsObject();

    private static async Task<JsonNode> Plans(JsonObject job) { job["fn"] = "plans"; return await Score.Run(job); }

    [Test]
    public async Task A_DSD_track_for_a_device_set_to_a_low_pass_is_planned_through_its_rate()
    {
        Needs.Server();
        var dsd = J(new { path = "/m/a.dsf", codec = "DSD", sampleRate = 2822400, bitsPerSample = 1, channels = 2 });
        var cd = J(new { path = "/m/b.flac", codec = "FLAC", sampleRate = 44100, bitsPerSample = 16, channels = 2 });
        object Dev(int[] rates, int? lowpass, int[]? dsdRates = null) => lowpass is { } lp
            ? new { name = "DAC", rates, maxBits = 24, containers = new[] { "flac" }, dsd = dsdRates ?? [], mode = "original", dsd_lowpass = lp }
            : new { name = "DAC", rates, maxBits = 24, containers = new[] { "flac" }, dsd = dsdRates ?? [], mode = "original" };
        int[] hi = [44100, 88200, 176400], lo = [44100, 88200];
        var cases = new object[][]
        {
            [dsd, Dev(hi, 30000)], [dsd, Dev(hi, 50000)], [dsd, Dev(lo, 50000)], [dsd, Dev(lo, 30000)],
            [dsd, Dev(hi, null)], [cd, Dev(hi, 30000)], [dsd, Dev(hi, 30000, [64])],
        };
        var p = (await Plans(new JsonObject { ["dsd_lowpass"] = JsonNode.Parse(Http.Json(cases)) }))["dsd_lowpass"]!.AsArray();
        // DSD as PCM at 176.4 kHz: through 66.15 kHz for a 30 kHz cut, 110.25 kHz for a 50 kHz one; said.
        Assert.Equal((176400.0, 66150.0), (p[0].Num("rate")!.Value, p[0].Num("lowpass")!.Value));
        Assert.EndsWith("(low-passed at 30 kHz)", p[0].Str("reason"), StringComparison.Ordinal);
        Assert.Equal(110250.0, p[1].Num("lowpass"));
        // At 88.2 kHz the rate's own Nyquist frequency is below a 50 kHz cut: nothing to do; a 30 kHz cut still is.
        Assert.Null(p[2].Num("lowpass"));
        Assert.Equal(66150.0, p[3].Num("lowpass"));
        // Not set, not DSD, or DSD the device takes as DSD: as before.
        Assert.Null(p[4].Num("lowpass"));
        Assert.Null(p[5].Num("lowpass"));
        Assert.Null(p[6].Num("lowpass"));
    }

    [Test]
    public async Task A_low_passed_plan_has_its_own_cache_file_and_ffmpeg_resamples_twice()
    {
        Needs.Server();
        var r = await Plans(new JsonObject
        {
            // [id, mtime, rate, bits, hq, exact, wav, whole, lowpass]
            ["held_keys"] = new JsonArray(new JsonArray(7, 5, 176400, 24, true, false, false, false, 0), new JsonArray(7, 5, 176400, 24, true, false, false, false, 66150)),
            // [src, rate, bits, hq, exact, dest, soxr, wav, lowpass]
            ["held_args"] = new JsonArray(new JsonArray("/m/a.dsf", 176400, 24, true, false, "/out.part", true, false, 66150)),
        });
        var keys = r["held_keys"]!.AsArray().Select(k => (string)k!).ToArray();
        Assert.Equal(keys[0] + "-lp66150", keys[1]);
        var args = string.Join(" ", r["held_args"]![0]!.AsArray().Select(x => (string?)x));
        Assert.Contains("aresample=resampler=soxr:precision=33:internal_sample_fmt=dblp:osr=66150,aresample=resampler=soxr:precision=33:internal_sample_fmt=dblp:osr=176400:", args, StringComparison.Ordinal);
    }

    [Test]
    public async Task The_modulators_noise_above_the_cut_is_taken_off_and_the_band_below_left_as_it_was()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        WriteToneDsf(Path.Combine(lib.Music, "Artist D", "DSD Album", "01 Tone.dsf"), seconds: 1.5);
        await using var s = await Session.Started(lib: lib);
        await Session.Until(async () => (await s.Api("library-stats")).J.Num("albums") == 4, 30000, "the library");
        var id = s.Server.Rows("SELECT id FROM tracks WHERE path LIKE $1", "%.dsf")[0]["id"];

        // The setting, said back; one there isn't, refused.
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        s.Server.Exec("INSERT INTO audio_devices(id, kind, network_name, first_seen, last_seen) VALUES($1, $2, $3, $4, $5)", "UPNP_test-dsd", "upnp", "UPNP_test-dsd", now, now);
        async Task<Http.Answer> Patch(object body) => await Http.Send(HttpMethod.Patch, s.Base + "/api/audio-devices/UPNP_test-dsd",
            new StringContent(Http.Json(body), System.Text.Encoding.UTF8, "application/json"), s.H);
        var set = await Patch(new { output = new { dsd_lowpass = 30000 } });
        Assert.True(set.Status == 200, set.Text);
        Assert.Equal(30000.0, set.J["output"].Num("dsd_lowpass"));
        var bad = await Patch(new { output = new { dsd_lowpass = 40000 } });
        Assert.Equal((400, "dsd_lowpass must be off, 30000 or 50000"), (bad.Status, bad.J.Str("error")));

        // The same track as PCM at 176.4 kHz, as it was and low-passed at 30 kHz.
        var plain = await Bytes.Get(s.Base + $"/stream/t{id}.176400-24.flac", s.H);
        var cut = await Bytes.Get(s.Base + $"/stream/t{id}.176400-24.flac?lp=66150", s.H);
        Assert.Equal((200, 200), (plain.Status, cut.Status));
        var dir = Directory.CreateTempSubdirectory("musicd-test-").FullName;
        try
        {
            string Save(string name, byte[] b) { var f = Path.Combine(dir, name); File.WriteAllBytes(f, b); return f; }
            var a = Save("plain.flac", plain.Body);
            var b = Save("cut.flac", cut.Body);
            // Above 45 kHz: the modulator's noise, gone.
            const string above = "highpass=f=45000:p=2,highpass=f=45000:p=2,highpass=f=45000:p=2";
            var (noiseA, noiseB) = (Rms(a, above), Rms(b, above));
            Assert.True(noiseA - noiseB > 30, $"above 45 kHz: {noiseA:F1} dB as it was, {noiseB:F1} dB low-passed");
            // Below 15 kHz: the tone, as it was.
            const string below = "lowpass=f=15000:p=2,lowpass=f=15000:p=2,lowpass=f=15000:p=2";
            var (toneA, toneB) = (Rms(a, below), Rms(b, below));
            Assert.True(Math.Abs(toneA - toneB) < 0.05, $"below 15 kHz: {toneA:F3} dB as it was, {toneB:F3} dB low-passed");
            // As long as it was: no tail, so gapless play stays gapless.
            Assert.Equal(Frames(plain.Body), Frames(cut.Body));
        }
        finally { Directory.Delete(dir, true); }
    }

    [GeneratedRegex(@"RMS level dB: (-?[0-9.]+|-inf)")] private static partial Regex RmsLevel();

    // The overall RMS level of [file] after [filters], in dBFS.
    private static double Rms(string file, string filters)
    {
        var r = Fixtures.Run(["-hide_banner", "-nostats", "-i", file, "-af", filters + ",astats=measure_perchannel=none", "-f", "null", "-"]);
        Assert.True(r.Code == 0, r.Err);
        var m = RmsLevel().Matches(r.Err);
        Assert.True(m.Count > 0, "astats said nothing: " + r.Err);
        var v = m[^1].Groups[1].Value;
        return v == "-inf" ? -400 : double.Parse(v, CultureInfo.InvariantCulture);
    }

    // A FLAC's STREAMINFO frame count (36 bits from byte 21's low half).
    private static long Frames(byte[] f) => ((long)(f[21] & 0x0F) << 32) | ((long)f[22] << 24) | ((long)f[23] << 16) | ((long)f[24] << 8) | f[25];

    /*
     * A DSD64 DSF of a 1 kHz tone at half scale, both channels, made by a sigma-delta modulator (four integrators): its
     * noise shaped above the audio band as a real DSD64 file's is. Bits least significant first, 4096-byte blocks per
     * channel, as DSF lays them out.
     */
    private static void WriteToneDsf(string file, double seconds)
    {
        const int rate = 2822400, block = 4096;
        var n = (long)(seconds * rate);
        var perCh = (n / 8 + block - 1) / block * block;
        var ch = new byte[perCh];
        double i1 = 0, i2 = 0, i3 = 0, i4 = 0, q = 1;
        for (long k = 0; k < n; k++)
        {
            var v = 0.5 * Math.Sin(2 * Math.PI * 1000 * k / rate);
            i1 += v - q; i2 += i1 - q; i3 += i2 * 0.5; i4 += i3 * 0.25;
            q = i1 + 0.5 * i2 + 0.25 * i3 + 0.06 * i4 >= 0 ? 1 : -1;
            if (q > 0) ch[k / 8] |= (byte)(1 << (int)(k % 8));
        }
        var data = new byte[perCh * 2];
        for (long b = 0; b < perCh / block; b++)
        {
            Array.Copy(ch, b * block, data, b * 2 * block, block);
            Array.Copy(ch, b * block, data, b * 2 * block + block, block);
        }
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        using var w = new BinaryWriter(File.Create(file));
        w.Write("DSD "u8); w.Write(28L); w.Write(28L + 52 + 12 + data.Length); w.Write(0L);
        w.Write("fmt "u8); w.Write(52L); w.Write(1); w.Write(0); w.Write(2); w.Write(2); w.Write(rate); w.Write(1); w.Write(n); w.Write(block); w.Write(0);
        w.Write("data"u8); w.Write(12L + data.Length);
        w.Write(data);
    }
}
