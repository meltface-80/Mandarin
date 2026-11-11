namespace Mandarin.Tests;

/// <summary>
/// Two rooms, each playing a track made as it plays (audit H2, Upsample/Turns.cs). One making ran at a time, and it
/// kept its turn while Pace held it ahead of its device: a room paused mid-track, or a next track armed and not yet
/// read, kept every other room's making waiting for good, its device sent nothing. Now a making held yields its turn:
/// here one track's start is read and its making held there, another's first bytes come at once, and both, read on,
/// are made to their ends and sent whole. And which making runs is chosen as Turns.Choose says.
/// </summary>
public sealed class TurnsTests
{
    private const long PerSecond = 2822400 * 2 / 8;   // DSD64, two channels, a bit a sample

    [Test]
    public async Task A_making_held_ahead_of_its_device_lets_another_rooms_track_be_made()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        foreach (var (album, title, freq) in new[] { ("Long One", "Long", 330), ("Long Two", "Other", 440) })
            Fixtures.Gen(Path.Combine(lib.Music, "Artist D", album, $"01 {title}.flac"), seconds: 60, freq: freq,
                tags: new Dictionary<string, object> { ["title"] = title, ["artist"] = "Artist D", ["album"] = album, ["track"] = 1 });
        await using var s = await Session.Started(lib: lib, env: new Dictionary<string, string> { ["MANDARIN_MAKE_LEAD_S"] = "2" });
        await Session.Until(async () => (await s.Api("library-stats")).J.Num("albums") == 5, 30000, "the library");
        string Url(string title) => $"/stream/t{s.Server.Rows("SELECT id FROM tracks WHERE title = $1", title)[0]["id"]}.d64.dsf";
        var made = Path.Combine(s.Lib.Data, "transcode");
        long Part() => Directory.Exists(made) ? Directory.GetFiles(made, "*.part").Select(f => new FileInfo(f).Length).DefaultIfEmpty(0).Max() : 0;

        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(3) };
        async Task<(HttpResponseMessage Res, Stream Body)> Open(string url, CancellationToken ct)
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, s.Base + url);
            foreach (var (k, v) in s.H) req.Headers.TryAddWithoutValidation(k, v);
            var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
            return (res, await res.Content.ReadAsStreamAsync(ct));
        }
        var buf = new byte[1 << 16];

        // The first room: its track's start read, then nothing (paused), its making held 2 s of music beyond it.
        var (resA, a) = await Open(Url("Long"), CancellationToken.None);
        using var _a = resA;
        Assert.Equal(200, (int)resA.StatusCode);
        long readA = 0;
        while (readA < 256 * 1024) readA += await a.ReadAsync(buf);
        long held = -1;
        await Session.Until(async () => { var before = Part(); await Task.Delay(1500); return before == (held = Part()); }, 30000, "the first making held");
        Assert.True(held > 0 && held < (resA.Content.Headers.ContentLength ?? 0) / 4, $"held at {held} bytes");

        // The second room asks for another track: its first bytes come, the first room's making still held.
        using var first = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        HttpResponseMessage? resB = null;
        Stream? b = null;
        long readB = 0;
        try
        {
            (resB, b) = await Open(Url("Other"), first.Token);
            while (readB < 64 * 1024) { var n = await b.ReadAsync(buf, first.Token); if (n == 0) break; readB += n; }
        }
        catch (OperationCanceledException) { /* said below */ }
        using var _b = resB;
        Assert.True(readB >= 64 * 1024, $"the second room's track: {readB} bytes in 15 s while the first's making was held");

        // Both read on: each made to its end, every byte its header promised sent.
        static async Task<long> Rest(Stream body, long read)
        {
            var into = new byte[1 << 16];
            for (int n; (n = await body.ReadAsync(into)) > 0;) read += n;
            return read;
        }
        var whole = await Task.WhenAll(Rest(a, readA), Rest(b!, readB));
        Assert.True(resA.Content.Headers.ContentLength > 55 * PerSecond, "a minute of DSD64: " + resA.Content.Headers.ContentLength);
        Assert.Equal((resA.Content.Headers.ContentLength, resB!.Content.Headers.ContentLength), (whole[0], whole[1]));
    }

    // A making as Turns.Choose is given it: its key and place in line, begun or waiting, running, wanting its turn, able
    // to be held, seconds made ahead of its device (null: nothing reads it), what it goes on into, what it follows.
    private static object Seat(string key, int order, bool begun = true, bool running = false, bool wants = true, bool holdable = true,
        double? ahead = null, string? continues = null, string? follows = null) =>
        new { key, order, begun, running, wants, holdable, ahead, continues, follows };

    [Test]
    public async Task The_making_that_runs_is_the_one_whose_device_is_closest_to_running_dry()
    {
        var cases = new (string? Want, object[] Seats, string What)[]
        {
            (null, [], "nothing to make"),
            ("a", [Seat("a", 1, begun: false)], "one waiting: it runs"),
            // Today's case kept: a making held ahead of its device, the next track of its room waiting, nothing runs.
            (null, [Seat("a", 1, wants: false, ahead: 2), Seat("b", 2, begun: false, follows: "a")], "the next track waits for its room's track before it"),
            (null, [Seat("a", 1, wants: false, ahead: 2), Seat("b", 2, begun: false)], "a track nothing reads waits for those before it"),
            ("b", [Seat("a", 1, wants: false, ahead: 2), Seat("b", 2, begun: false, ahead: 0)], "another room's track, read, runs while the first is held"),
            ("b", [Seat("a", 1, wants: false, ahead: 2), Seat("b", 2, begun: false, follows: "x")], "a room's next track runs once its track before is made"),
            ("b", [Seat("a", 1, wants: false, ahead: 2), Seat("b", 2, begun: false, follows: "")], "a next track after one not made as it plays"),
            // A making that goes on into the next track's start: the next waits for it, read or not.
            (null, [Seat("a", 1, wants: false, ahead: 2, continues: "b"), Seat("b", 2, begun: false, ahead: 0)], "a track another goes on into waits for it"),
            // One running, another needing to go on: the one further ahead of its device is held.
            ("b", [Seat("a", 1, running: true, ahead: 1.5), Seat("b", 2, ahead: 0.2)], "the one closer to running dry runs"),
            ("a", [Seat("a", 1, running: true, ahead: 0.5), Seat("b", 2, ahead: 0.2)], "within the margin, the one running goes on"),
            ("a", [Seat("a", 1, running: true, holdable: false, ahead: 9), Seat("b", 2, ahead: 0)], "one that can't be held keeps its turn (Windows)"),
            ("b", [Seat("a", 1, running: true), Seat("b", 2, ahead: 0.1)], "one nothing reads gives way to one read"),
            ("b", [Seat("a", 1, wants: false, ahead: 2), Seat("b", 2, ahead: 1.2), Seat("c", 3, ahead: 1.6)], "the least ahead first"),
            ("c", [Seat("a", 1, running: true, ahead: 1.8), Seat("b", 2, wants: false, ahead: 0.1), Seat("c", 3, ahead: 0.6)], "held by Pace and not caught up: not wanting"),
        };
        var r = await Score.Run(new { fn = "upsample", turns = cases.Select(c => new { seats = c.Seats, margin = 0.5 }) });
        var chosen = r["chosen"]!.AsArray().Select(x => (string?)x).ToList();
        for (var i = 0; i < cases.Length; i++) Assert.True(cases[i].Want == chosen[i], $"{cases[i].What}: {chosen[i] ?? "none"}, not {cases[i].Want ?? "none"}");
    }
}
