using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// The Album Scanner (bug list item 411, Identify/AlbumScanner.cs and AlbumProgress.cs): one switch over
/// identification (iTunes asked too), measuring ReplayGain and the cover finder. Off, none of them runs; on, all three
/// do, and the one Progress readout counts the albums with every step done. Never while music plays; outside
/// Scheduling's hours only with Scheduling off. The older page's and app's own requests (Identify albums, Ask iTunes
/// too, Measure ReplayGain, Find covers) are this switch now, and a server from before it is on when any of them was.
/// Against catalogues that know nothing (every album unidentified, no cover found), on the fixture library: Album One
/// (its folder's cover), Hi Res and Best Of, seven tracks with no ReplayGain tags.
/// </summary>
public sealed class AlbumScannerTests
{
    /* MusicBrainz, iTunes, Deezer and the Cover Art Archive stood in for, knowing nothing; every request noted. [Hold]: answered once it is let go. */
    private sealed class Nothing : IAsyncDisposable
    {
        private FakeServer? srv;
        public readonly ConcurrentQueue<string> Asked = new();
        public TaskCompletionSource? Hold;
        public TaskCompletionSource Held { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public string Base => srv!.Base;

        public static async Task<Nothing> Start()
        {
            var me = new Nothing();
            me.srv = await FakeServer.Start(me.Answer);
            return me;
        }

        private async Task Answer(HttpContext ctx)
        {
            var path = ctx.Request.Path.Value ?? "";
            Asked.Enqueue(path);
            if (path.StartsWith("/mb/", StringComparison.Ordinal) && Hold is { } h) { Held.TrySetResult(); await h.Task; }
            JsonNode body = path.StartsWith("/mb/", StringComparison.Ordinal) ? new JsonObject { ["releases"] = new JsonArray(), ["count"] = 0 }
                : path.StartsWith("/dz/", StringComparison.Ordinal) ? new JsonObject { ["data"] = new JsonArray() }
                : path is "/search" or "/lookup" ? new JsonObject { ["results"] = new JsonArray(), ["resultCount"] = 0 }
                : new JsonObject();
            ctx.Response.ContentType = "application/json";
            await ctx.Response.WriteAsync(body.ToJsonString());
        }

        public int MusicBrainz => Asked.Count(p => p.StartsWith("/mb/", StringComparison.Ordinal));

        /* The server's options: every job there is, against these catalogues, quickly. */
        public Dictionary<string, object?> Options() => new()
        {
            ["identify"] = true, ["identifyTickMs"] = 100, ["loudness"] = true, ["loudnessTickMs"] = 100, ["autoCovers"] = true, ["autoCoversGapMs"] = 0,
            ["mbBaseUrl"] = Base + "/mb", ["itunesBaseUrl"] = Base, ["deezerBaseUrl"] = Base + "/dz", ["coverartBaseUrl"] = Base + "/caa"
        };

        public ValueTask DisposeAsync() => srv?.DisposeAsync() ?? ValueTask.CompletedTask;
    }

    private static long Count(Session s, string table) =>
        s.Server.Scalar("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = $1", table) is long n && n > 0
            ? (long)s.Server.Scalar($"SELECT count(*) FROM {table}")! : 0;

    /* What has been done: MusicBrainz asked, tracks measured, covers looked for. */
    private static (int Mb, long Measured, long Covers) Done(Session s, Nothing cat) => (cat.MusicBrainz, Count(s, "track_loudness"), Count(s, "album_auto_art"));

    private static async Task<JsonNode> Scanner(Session s, object? body = null) => (body == null ? await s.Api("album-scanner") : await s.Api("album-scanner", body)).J;

    private static string? Reason(JsonNode j) => j["now"].Str("reason");

    [Test]
    public async Task Off_none_of_the_three_runs_on_all_three_do_while_nothing_plays_and_the_progress_counts_the_albums_with_every_step_done()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var cat = await Nothing.Start();
        await using var s = await Session.Started(cat.Options());
        // Off, and at any hour.
        var off = await Scanner(s, new { on = false, schedule = false });
        Assert.Equal((false, false, "off"), (off.Bool("on"), off["schedule"].Bool("on"), Reason(off)));
        Assert.Equal((false, false, false), ((await s.Api("identify")).J["settings"].Bool("enabled"), (await s.Api("loudness")).J["settings"].Bool("measure"), (await s.Api("covers/auto")).J.Bool("on")));
        Assert.Equal("off", (await s.Api("identify")).J.Str("reason"));
        Assert.Equal("off", (await s.Api("loudness")).J.Str("reason"));
        await Task.Delay(1500);   // anything begun as it started, ended
        var before = Done(s, cat);
        await Task.Delay(3000);
        Assert.Equal(before, Done(s, cat));

        // On, while a phone plays: still nothing begins, and the readout says why.
        await s.Api("phone/hello", new { name = "Pixel 8" });
        Assert.Equal(200, (await s.Api("phone/state", new { index = 0, position = 3, duration = 60, state = "playing", volume = 40 })).Status);
        var playing = await Scanner(s, new { on = true });
        Assert.Equal((true, "playing"), (playing.Bool("on"), Reason(playing)));
        Assert.Equal(("playing", false), ((await s.Api("identify")).J.Str("reason"), (await s.Api("identify")).J.Bool("active")));
        await Task.Delay(3000);
        Assert.Equal(before, Done(s, cat));
        Assert.Equal("playing", (await s.Api("loudness")).J.Str("reason"));

        // The phone stops: all three run. MusicBrainz held at first: the readout names the album and the step.
        cat.Hold = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        await s.Api("phone/state", new { index = 0, position = 3, duration = 60, state = "stopped", volume = 40 });
        await cat.Held.Task.WaitAsync(TimeSpan.FromSeconds(30));
        // (The cover finder asks MusicBrainz too: whichever was held, the readout names what is under way.)
        var working = await Scanner(s);
        Assert.Equal("working", Reason(working));
        Assert.True(new[] { "identifying", "measuring loudness", "finding a cover" }.Contains(working["now"].Str("step")), working.ToJsonString());
        Assert.True(new[] { "Album One", "Hi Res", "Best Of" }.Contains(working["now"]!["album"].Str("title")), working.ToJsonString());
        cat.Hold.SetResult();
        cat.Hold = null;

        // Every album identified (unidentified here, iTunes asked too), every track measured, every cover settled.
        await Session.Until(async () => await Scanner(s) is var j && j.Num("done") == 3, 120000, "every step of every album done");
        var all = await Scanner(s);
        Assert.Equal((3.0, 3.0, 3.0, 0.0, "done"), (all.Num("albums")!.Value, all.Num("done")!.Value, all.Num("unidentified")!.Value, all.Num("proposed")!.Value, Reason(all)));
        Assert.Equal(3L, (long)s.Server.Scalar("SELECT count(*) FROM album_matches WHERE status = 'unidentified' AND itunes = 'asked'")!);
        Assert.Equal(7L, Count(s, "track_loudness"));
        Assert.Equal(3L, Count(s, "album_auto_art"));
        Assert.Contains(cat.Asked, p => p == "/search");   // iTunes asked too

        // Each step counts: an album's tracks not measured, then its cover not settled, then its verdict gone: one fewer each time.
        Assert.Equal(3.0, (await Scanner(s, new { on = false })).Num("done"));
        var hiRes = (long)(await s.Album("Hi Res"))!.Num("offset")!.Value;
        s.Server.Exec("DELETE FROM track_loudness WHERE track_id IN (SELECT id FROM tracks WHERE album_id = $1)", hiRes);
        Assert.Equal(2.0, (await Scanner(s, new { on = false })).Num("done"));
        s.Server.Exec("DELETE FROM album_auto_art WHERE key = (SELECT key FROM albums WHERE title = 'Best Of')");
        Assert.Equal(1.0, (await Scanner(s, new { on = false })).Num("done"));
        s.Server.Exec("DELETE FROM album_matches WHERE key = (SELECT key FROM albums WHERE title = 'Album One')");
        var none = await Scanner(s, new { on = false });
        Assert.Equal((0.0, 2.0, "off"), (none.Num("done")!.Value, none.Num("unidentified")!.Value, Reason(none)));
    }

    [Test]
    public async Task The_older_switches_requests_are_the_one_switch_and_scheduling_off_runs_at_any_hour()
    {
        await using var s = await Session.Started();
        // Nothing kept: on, as Identify albums and Find covers were by default; Scheduling on, 01:00 to 06:00.
        var first = await Scanner(s);
        Assert.Equal((true, true, "01:00", "06:00"), (first.Bool("on")!.Value, first["schedule"].Bool("on")!.Value, first["schedule"].Str("start"), first["schedule"].Str("end")));
        async Task<(bool?, bool?, bool?, bool?)> Each() => ((await Scanner(s)).Bool("on"), (await s.Api("identify")).J["settings"].Bool("enabled"),
            (await s.Api("loudness")).J["settings"].Bool("measure"), (await s.Api("covers/auto")).J.Bool("on"));

        // Measure ReplayGain, Find covers and Identify albums from before: each switches all of it.
        Assert.Equal(false, (await s.Api("loudness", new { measure = false })).J["settings"].Bool("measure"));
        Assert.Equal((false, false, false, false), await Each());
        Assert.Equal(true, (await s.Api("covers/auto", new { on = true })).J.Bool("on"));
        Assert.Equal((true, true, true, true), await Each());
        var id = await s.Api("identify/settings", new { enabled = false, itunes = false });
        Assert.Equal(200, id.Status);
        Assert.Equal((false, true, "off"), (id.J["settings"].Bool("enabled"), id.J["settings"].Bool("itunes"), id.J.Str("reason")));   // iTunes is no choice now
        Assert.Equal((false, false, false, false), await Each());
        Assert.Equal(200, (await s.Api("identify/settings", new { enabled = true })).Status);
        Assert.Equal((true, true, true, true), await Each());
        Assert.Equal(true, (await s.Api("identify")).J["settings"].Bool("itunes"));

        // Scheduling on, its hours not now: waiting, and what waits says so; its times kept.
        static string At(int hours) => DateTime.Now.AddHours(hours).ToString("HH:mm", System.Globalization.CultureInfo.InvariantCulture);
        var waiting = await Scanner(s, new { schedule = true, start = At(2), end = At(3) });
        Assert.Equal(("waiting", true, At(2), At(3)), (Reason(waiting), waiting["schedule"].Bool("on")!.Value, waiting["schedule"].Str("start"), waiting["schedule"].Str("end")));
        Assert.Equal("waiting", (await s.Api("identify")).J.Str("reason"));
        Assert.Equal("waiting", (await s.Api("loudness")).J.Str("reason"));
        // Off: at any hour, the times kept for next time.
        var any = await Scanner(s, new { schedule = false });
        Assert.NotEqual("waiting", Reason(any));
        Assert.Equal((false, At(2)), (any["schedule"].Bool("on")!.Value, any["schedule"].Str("start")));
        Assert.Equal(false, (await s.Api("identify")).J["settings"].Bool("schedule"));
        Assert.NotEqual("waiting", (await s.Api("identify")).J.Str("reason"));

        // What isn't a switch or a time is refused, and changes nothing.
        Assert.Equal(400, (await s.Api("album-scanner", new { on = "yes" })).Status);
        Assert.Equal(400, (await s.Api("album-scanner", new { start = "25:00" })).Status);
        Assert.Equal(400, (await s.Api("album-scanner", new { end = "nope" })).Status);
        Assert.Equal((true, false), ((await Scanner(s)).Bool("on")!.Value, (await Scanner(s))["schedule"].Bool("on")!.Value));
    }

    [Test]
    public async Task A_server_from_before_it_is_on_when_any_of_the_four_switches_was()
    {
        await using var s = await Session.Started();
        void Kept(string identify, string replaygain, string autoCovers)
        {
            s.Server.Exec("DELETE FROM settings WHERE key IN ('albumScanner', 'identify', 'replaygain', 'autoCovers')");
            s.Server.Exec("INSERT INTO settings(key, value) VALUES('identify', $1), ('replaygain', $2), ('autoCovers', $3)", identify, replaygain, autoCovers);
        }
        const string IdOff = """{"enabled":false,"schedule":true,"start":"01:00","end":"06:00","itunes":false}""";
        Kept(IdOff, """{"measure":false}""", "false");
        Assert.Equal(false, (await Scanner(s)).Bool("on"));
        Kept("""{"enabled":true,"itunes":false}""", """{"measure":false}""", "false");
        Assert.Equal(true, (await Scanner(s)).Bool("on"));
        Kept("""{"enabled":false,"itunes":true}""", """{"measure":false}""", "false");
        Assert.Equal(true, (await Scanner(s)).Bool("on"));
        Kept(IdOff, """{"measure":true}""", "false");
        Assert.Equal(true, (await Scanner(s)).Bool("on"));
        Kept(IdOff, """{"measure":false}""", "true");
        Assert.Equal(true, (await Scanner(s)).Bool("on"));
        // A change of the schedule keeps what they said; the Album Scanner switched, its own word from then on.
        Kept(IdOff, """{"measure":false}""", "false");
        Assert.Equal(false, (await Scanner(s, new { schedule = false })).Bool("on"));
        Assert.Equal(true, (await Scanner(s, new { on = true })).Bool("on"));
        Assert.Equal("true", s.Server.Scalar("SELECT value FROM settings WHERE key = 'albumScanner'"));
        Assert.Equal(true, (await s.Api("identify")).J["settings"].Bool("enabled"));
    }

    [Test]
    public async Task A_phone_told_to_play_that_never_answers_holds_it_half_a_minute_at_most()
    {
        await using var s = await Session.Started();
        await Scanner(s, new { schedule = false });
        var phone = (await s.Api("phone/hello", new { name = "Pixel 8" })).J;
        var album = (await s.Album("Album One"))!;
        Assert.Equal(200, (await s.Api("play", new { offset = album.Num("offset"), zone_or_output_id = phone.Str("zone_id"), kind = "play_now" })).Status);
        Assert.Equal("playing", Reason(await Scanner(s)));
        // Its app closed, say: it never says it plays, nor that it stopped.
        var t0 = DateTime.UtcNow;
        await Session.Until(async () => Reason(await Scanner(s)) != "playing", 60000, "the phone let go");
        Assert.True(DateTime.UtcNow - t0 > TimeSpan.FromSeconds(20), "held while it loaded");
        Assert.Equal(1.0, (await Http.Get(s.Base + "/api/health")).J["busy"].Num("playing"));   // as Mandarin OS's upkeep still counts it
    }

    [Test]
    public async Task The_cover_finder_keeps_to_schedulings_hours_and_runs_once_they_come()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var cat = await Nothing.Start();
        var o = cat.Options();
        o["identify"] = false;
        o["loudness"] = false;
        await using var s = await Session.Started(o);
        static string At(int hours) => DateTime.Now.AddHours(hours).ToString("HH:mm", System.Globalization.CultureInfo.InvariantCulture);
        await Scanner(s, new { schedule = true, start = At(2), end = At(3) });
        await Task.Delay(1500);   // a run begun as it started, ended
        if (Count(s, "album_auto_art") > 0) s.Server.Exec("DELETE FROM album_auto_art");
        // A library scan's run, outside the hours: put off.
        await s.Server.Internal("/internal/jobs/after-scan");
        await Task.Delay(3000);
        Assert.Equal(0L, Count(s, "album_auto_art"));
        // Scheduling off: the run put off is made.
        await Scanner(s, new { schedule = false });
        await Session.Until(() => Task.FromResult(Count(s, "album_auto_art") == 3), 60000, "the covers looked for");
    }
}
