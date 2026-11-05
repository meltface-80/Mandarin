namespace Mandarin.Tests;

/// <summary>
/// A making held ahead of the device as Roon holds its DSP (bug list item 271, Upsample/Pace.cs): a track made DSD as it
/// plays was made as fast as the processor allowed, flat out on every core given it until the end, however little the
/// device had read. Now it goes some way (here 2 s of music) beyond what is read, waits there while the device reads
/// nothing, and goes on as it reads: here a minute's track, its first bytes read and then none for a while, is made
/// only that far; read on, it is made to its end, and sent whole, its length the header's.
/// </summary>
public sealed class PaceTests
{
    [Test]
    public async Task A_DSF_made_as_it_plays_goes_only_so_far_ahead_of_what_the_device_has_read()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        Fixtures.Gen(Path.Combine(lib.Music, "Artist D", "Long One", "01 Long.flac"), seconds: 60, freq: 330,
            tags: new Dictionary<string, object> { ["title"] = "Long", ["artist"] = "Artist D", ["album"] = "Long One", ["track"] = 1 });
        await using var s = await Session.Started(lib: lib, env: new Dictionary<string, string> { ["MANDARIN_MAKE_LEAD_S"] = "2" });
        await Session.Until(async () => (await s.Api("library-stats")).J.Num("albums") == 4, 30000, "the library");
        var track = s.Server.Rows("SELECT * FROM tracks WHERE title = $1", "Long")[0];
        var made = Path.Combine(s.Lib.Data, "transcode");
        long Part() => Directory.Exists(made) ? Directory.GetFiles(made, "*.part").Select(f => new FileInfo(f).Length).DefaultIfEmpty(0).Max() : 0;

        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
        using var req = new HttpRequestMessage(HttpMethod.Get, s.Base + $"/stream/t{track["id"]}.d64.dsf");
        foreach (var (k, v) in s.H) req.Headers.TryAddWithoutValidation(k, v);
        using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
        Assert.Equal(200, (int)res.StatusCode);
        var length = res.Content.Headers.ContentLength ?? 0;
        var perSecond = 2822400 * 2 / 8;   // DSD64, two channels, a bit a sample
        Assert.True(length > 55 * perSecond, "a minute of DSD64: " + length);
        var body = await res.Content.ReadAsStreamAsync();
        // Its start read, then nothing: the making goes 2 s of music beyond it (a socket's buffers more) and waits.
        var buf = new byte[1 << 16];
        long read = 0;
        while (read < 256 * 1024) read += await body.ReadAsync(buf);
        // Where it stops: the socket's buffers, which a busy machine fills slowly, take a few seconds to fill (item 277).
        long held = -1;
        await Session.Until(async () => { var before = Part(); await Task.Delay(1500); return before == (held = Part()); }, 30000, "the making held");
        Assert.True(held > 0 && held < length / 4, $"held at {held} of {length} bytes, {read} read");
        // Read on: made to its end, every byte of it sent.
        while (true) { var n = await body.ReadAsync(buf); if (n == 0) break; read += n; }
        Assert.Equal(length, read);
    }
}
