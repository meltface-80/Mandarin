using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The Album Scanner and a track made as it plays (bug list item 417, Cpu.Making.cs, Upsample/Pace.cs). A making is
/// music playing for the background (items 409, 411): no album is started while one runs, nor for a while after. But a
/// making held ahead of its device stays under way for as long as the device is paused, and the Album Scanner said
/// "Paused while music plays" all that while: the owner's, on 14 Nov, with the rooms and the phone paused. Now a making
/// counts while it goes on (more made, or more of it read) and for a while after it last did (here 3 s); one ended
/// counts for its while after (here 6 s), as before. Its cores stay kept, held or not: the device may go on at once.
/// </summary>
public sealed class ScannerMakingTests
{
    private static async Task<string?> Reason(Session s) => (await s.Api("album-scanner")).J["now"].Str("reason");

    [Test]
    public async Task A_making_held_ahead_of_a_paused_device_is_no_music_playing_and_one_read_on_or_just_ended_is()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        Fixtures.Gen(Path.Combine(lib.Music, "Artist D", "Long One", "01 Long.flac"), seconds: 60, freq: 330,
            tags: new Dictionary<string, object> { ["title"] = "Long", ["artist"] = "Artist D", ["album"] = "Long One", ["track"] = 1 });
        await using var s = await Session.Started(lib: lib, env: new Dictionary<string, string>
        {
            ["MANDARIN_MAKE_LEAD_S"] = "2", ["MANDARIN_MAKING_QUIET_MS"] = "3000", ["MANDARIN_CPU_MAKING_HOLD_MS"] = "6000"
        });
        await Session.Until(async () => (await s.Api("library-stats")).J.Num("albums") == 4, 30000, "the library");
        // On, at any hour: nothing plays yet.
        Assert.Equal(200, (await s.Api("album-scanner", new { on = true, schedule = false })).Status);
        Assert.NotEqual("playing", await Reason(s));
        var track = s.Server.Rows("SELECT * FROM tracks WHERE title = $1", "Long")[0];
        var made = Path.Combine(s.Lib.Data, "transcode");
        long Part() => Directory.Exists(made) ? Directory.GetFiles(made, "*.part").Select(f => new FileInfo(f).Length).DefaultIfEmpty(0).Max() : 0;

        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
        using var req = new HttpRequestMessage(HttpMethod.Get, s.Base + $"/stream/t{track["id"]}.d64.dsf");
        foreach (var (k, v) in s.H) req.Headers.TryAddWithoutValidation(k, v);
        using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
        Assert.Equal(200, (int)res.StatusCode);
        var length = res.Content.Headers.ContentLength ?? 0;
        var body = await res.Content.ReadAsStreamAsync();
        var buf = new byte[1 << 16];
        long read = 0;
        while (read < 256 * 1024) read += await body.ReadAsync(buf);
        // Made as it plays, its start read: music playing.
        Assert.Equal("playing", await Reason(s));

        // Then nothing read (the device paused): the making held 2 s of music ahead, under way still, its cores kept;
        // once it has made nothing more for 3 s, no music plays.
        await Session.Until(async () => { var before = Part(); await Task.Delay(1500); return before == Part(); }, 30000, "the making held");
        await Session.Until(async () => await Reason(s) != "playing", 15000, "the held making no longer taken for music playing");
        Assert.True(Part() < length / 4, $"held at {Part()} of {length} bytes");
        Assert.Equal(true, (await s.Api("cpu")).J.Bool("making"));
        await Task.Delay(2000);
        Assert.NotEqual("playing", await Reason(s));

        // Read on (the device goes on), as a device reads, a little at a time: music playing again while it is read.
        var reading = Task.Run(async () =>
        {
            while (true)
            {
                var n = await body.ReadAsync(buf.AsMemory(0, 16 * 1024));
                if (n == 0) return;
                read += n;
                await Task.Delay(5);
            }
        });
        await Session.Until(async () => await Reason(s) == "playing" || reading.IsCompleted, 20000, "music playing again as it is read");
        Assert.False(reading.IsCompleted, "read to its end before it was taken for music playing again");
        await reading;
        Assert.Equal(length, read);
        // Made to its end: music playing for its while after (6 s), then not.
        Assert.Equal("playing", await Reason(s));
        await Session.Until(async () => await Reason(s) != "playing", 30000, "the while after the making ended");
    }
}
