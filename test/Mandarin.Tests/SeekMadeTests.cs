using System.Diagnostics;

namespace Mandarin.Tests;

/// <summary>
/// A seek in a track made as it plays (bug list item 272, Upsample/Resume.cs): the FiiO SR11, sent a DSF made from
/// PCM, seeks by asking for the bytes where the time falls; asked for bytes far past what was made, the server waited
/// for the making to get there, and the SR11 gave up and went silent. Now the making is begun again from there: the
/// bytes come at once, and are the track at that time (a sine's phase where the start puts it); and read again from
/// the start (Back), the whole file is sent, every part of it made, none of the gap left between.
/// </summary>
public sealed class SeekMadeTests
{
    private const int Freq = 330;

    // The phase of the sine at [freq] in [wave] (samples at [rate], the first at [t0] s); and its level.
    private static (double Phase, double Level) Phase(Func<int, double> wave, int count, double rate, double t0)
    {
        double s = 0, c = 0;
        for (var i = 0; i < count; i++)
        {
            var w = 2 * Math.PI * Freq * (t0 + i / rate);
            s += wave(i) * Math.Sin(w);
            c += wave(i) * Math.Cos(w);
        }
        return (Math.Atan2(c, s), 2 * Math.Sqrt(s * s + c * c) / count);
    }

    private static double Apart(double a, double b) { var d = Math.Abs(a - b) % (2 * Math.PI); return Math.Min(d, 2 * Math.PI - d); }

    // A DSF's left channel at [t] s for 0.1 s, as 44.1 kHz samples (each the mean of 64 bits; full scale is half the
    // modulation, so the fixture's sine at 1/8 reads a little under 1/16); the file's bytes in [file].
    private static (double, double) DsfPhase(byte[] file, double t)
    {
        const int dsd = 2822400, per = 64;
        var first = (long)(t * dsd);
        return Phase(i =>
        {
            var ones = 0;
            for (var k = 0; k < per; k++)
            {
                var n = first + (long)i * per + k;
                var at = 92 + n / 32768 * 8192 + n % 32768 / 8;
                ones += (file[at] >> (int)(n % 8)) & 1;
            }
            return (2.0 * ones - per) / per;
        }, 4410, dsd / (double)per, first / (double)dsd);
    }

    // A 24-bit stereo WAV's left channel at [t] s for 0.05 s, at [rate].
    private static (double, double) WavPhase(byte[] file, double t, int rate)
    {
        var first = (long)(t * rate);
        return Phase(i =>
        {
            var at = 68 + (first + i) * 6;
            var v = file[at] | file[at + 1] << 8 | (sbyte)file[at + 2] << 16;
            return v / 8388608.0;
        }, rate / 20, rate, first / (double)rate);
    }

    private static async Task<(int Status, long Length)> Read(HttpClient http, Session s, string url, long from, byte[] into, long upTo = long.MaxValue, Stopwatch? first = null)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, s.Base + url);
        foreach (var (k, v) in s.H) req.Headers.TryAddWithoutValidation(k, v);
        if (from > 0) req.Headers.TryAddWithoutValidation("Range", $"bytes={from}-");
        using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
        var body = await res.Content.ReadAsStreamAsync();
        var pos = from;
        for (int n; pos < upTo && (n = await body.ReadAsync(into.AsMemory((int)pos, (int)Math.Min(1 << 16, into.Length - pos)))) > 0;)
        {
            first?.Stop();
            pos += n;
        }
        return ((int)res.StatusCode, pos);
    }

    private static async Task<(Session S, long Id)> Started(int seconds)
    {
        var lib = Fixtures.MakeLibrary();
        Fixtures.Gen(Path.Combine(lib.Music, "Artist D", "Long One", "01 Long.flac"), seconds: seconds, freq: Freq,
            tags: new Dictionary<string, object> { ["title"] = "Long", ["artist"] = "Artist D", ["album"] = "Long One", ["track"] = 1 });
        var s = await Session.Started(lib: lib, env: new Dictionary<string, string> { ["MANDARIN_MAKE_LEAD_S"] = "2" });
        await Session.Until(async () => (await s.Api("library-stats")).J.Num("albums") == 4, 30000, "the library");
        return (s, Convert.ToInt64(s.Server.Rows("SELECT id FROM tracks WHERE title = $1", "Long")[0]["id"], System.Globalization.CultureInfo.InvariantCulture));
    }

    [Test]
    public async Task A_DSF_made_as_it_plays_sought_far_past_what_is_made_is_made_from_there_and_whole_read_from_the_start()
    {
        Needs.Server(); Needs.Ffmpeg();
        var (s, id) = await Started(90);
        await using var session = s;
        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(3) };
        var url = $"/stream/t{id}.d64.dsf";
        using (var head = new HttpRequestMessage(HttpMethod.Head, s.Base + url))
        {
            foreach (var (k, v) in s.H) head.Headers.TryAddWithoutValidation(k, v);
            using var hr = await http.SendAsync(head);
            Assert.Equal(200, (int)hr.StatusCode);
        }
        const long perSecond = 2822400 * 2 / 8;
        var file = new byte[92 + 91 * perSecond];
        // Its start read, as a device does, then a seek to 75 s, far past what is made (2 s ahead of the device).
        var (status, length) = await Read(http, s, url, 0, file, upTo: 512 * 1024);
        Assert.Equal(200, status);
        var (early, level) = DsfPhase(file, 0.2);
        Assert.True(level > 0.02, "the sine at the start: " + level);
        var at = 92 + 75 * perSecond + 1234;
        var first = Stopwatch.StartNew();
        var seek = Read(http, s, url, at, file, upTo: at + 2 * perSecond, first: first);
        (status, _) = await seek;
        Assert.Equal(206, status);
        Assert.True(first.Elapsed < TimeSpan.FromSeconds(8), "the bytes sought to came in " + first.Elapsed);
        Assert.Contains(s.Server.Logs, l => l.Contains("[upsample] 01 Long.flac: made again from 75", StringComparison.Ordinal));
        var (there, level2) = DsfPhase(file, 75.5);
        Assert.True(level2 > 0.02 && Apart(early, there) < 0.3, $"the track at 75.5 s: phase {there} (at the start {early}), level {level2}");

        // Back: read from the start, the whole file, and every part of it the track where it falls.
        Array.Clear(file);
        (status, length) = await Read(http, s, url, 0, file);
        Assert.Equal(200, status);
        Assert.True(length > 92 + 89 * perSecond, "the whole file: " + length);
        for (var t = 1.0; t < 89; t += 4)
        {
            var (p, l) = DsfPhase(file, t);
            Assert.True(l > 0.02 && Apart(early, p) < 0.3, $"the track at {t} s: phase {p} (at the start {early}), level {l}");
        }
    }

    [Test]
    public async Task A_WAV_upsampled_x16_as_it_plays_sought_far_past_what_is_made_is_made_from_there()
    {
        Needs.Server(); Needs.Ffmpeg();
        var (s, id) = await Started(40);
        await using var session = s;
        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(3) };
        var url = $"/stream/t{id}.705600-24.wav?f=min";
        const int rate = 705600;
        const long perSecond = rate * 6L;
        var file = new byte[68 + 41 * perSecond];
        var (status, _) = await Read(http, s, url, 0, file, upTo: 4 << 20);
        Assert.Equal(200, status);
        var (early, level) = WavPhase(file, 0.3, rate);
        Assert.True(level > 0.05, "the sine at the start: " + level);
        var at = 68 + 30 * perSecond + 7;
        var first = Stopwatch.StartNew();
        (status, _) = await Read(http, s, url, at, file, upTo: at + perSecond, first: first);
        Assert.Equal(206, status);
        Assert.True(first.Elapsed < TimeSpan.FromSeconds(8), "the bytes sought to came in " + first.Elapsed);
        Assert.Contains(s.Server.Logs, l => l.Contains("[upsample] 01 Long.flac: made again from 30", StringComparison.Ordinal));
        var (there, level2) = WavPhase(file, 30.3, rate);
        Assert.True(level2 > 0.05 && Apart(early, there) < 0.3, $"the track at 30.3 s: phase {there} (at the start {early}), level {level2}");
    }
}
