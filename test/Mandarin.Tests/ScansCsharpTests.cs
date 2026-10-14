using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The library scans made by the C# server (v0.8.34; Scans.cs and ScanRoutes.cs):
///   - Settings → Music folders, the folder picker, the music mount and how far the library has been
///     read: answered there, the refusals in the Node server's words;
///   - Rescan, Reindex, a folder added, removed or let go: made there, and /api/status saying how the scan went;
///   - the scan on the timer, and on a change in the music folders.
/// (test/scans-csharp.test.js, in C#: each test's steps, in order, in one test.)
/// </summary>
public sealed class ScansCsharpTests
{
    private sealed record Said(int Status, string? By, JsonNode? J);

    private sealed class Served(TestServer srv, Dictionary<string, string> h) : IAsyncDisposable
    {
        public async Task<Said> Get(string p) { var r = await Http.Get(srv.Base + p, h); return new(r.Status, r.Header("x-mandarin-answered"), r.Json); }
        public async Task<Said> Post(string p, object? body = null) { var r = await Http.Post(srv.Base + p, body ?? new { }, h); return new(r.Status, r.Header("x-mandarin-answered"), r.Json); }
        public async Task<double?> Albums() => (await Get("/api/library-stats")).J.Num("albums");
        public async Task<bool> Idle() { var st = (await Get("/api/status")).J; return st.Bool("library_importing") != true && st?["scan"]?["last"] != null; }
        public ValueTask DisposeAsync() => srv.DisposeAsync();
    }

    // The program, with these environment variables while it starts.
    private static async Task<Served> Serve(Fixtures.Library lib, Dictionary<string, string> env, Dictionary<string, object?>? overrides = null)
    {
        Needs.Server(); Needs.Ffmpeg();
        var o = new Dictionary<string, object?> { ["serverIp"] = "127.0.0.1", ["sonosHosts"] = Array.Empty<string>(), ["upnpMulticast"] = false, ["identify"] = false };
        foreach (var (k, v) in overrides ?? []) o[k] = v;
        var srv = await new TestServer(Ports.Port(), lib.Music, lib.Data, o, env).Start();
        return new Served(srv, new() { ["Authorization"] = "Bearer " + await Session.SignIn(srv.Base) });
    }

    private static void Gen(string file, int freq, string title, string artist, string album, int? track = null)
    {
        var tags = new Dictionary<string, object> { ["title"] = title, ["artist"] = artist, ["album"] = album };
        if (track != null) tags["track"] = track;
        Fixtures.Gen(file, freq: freq, tags: tags);
    }

    [Test]
    public async Task Music_folders_Rescan_and_the_rest_answered_by_the_CSharp_server()
    {
        var lib = Fixtures.MakeLibrary();
        var other = Path.Combine(lib.Root, "nas", "Music");
        Directory.CreateDirectory(other);
        Directory.Move(Path.Combine(lib.Music, "Comp"), Path.Combine(other, "Comp"));
        // Not watched here (a quiet longer than the test): each scan is the one asked for.
        await using var s = await Serve(lib, new() { ["MANDARIN_WATCH_QUIET_MS"] = "600000" });
        // The first scan, made as the server starts.
        await Session.Until(async () => await s.Albums() == 2 && await s.Idle(), 30000, "the first scan");
        var st = (await s.Get("/api/status")).J;
        Assert.Equal(2, st.Num("index_count"));
        Assert.True(st?["scan"]?["last"].Str("status") == "updated", st?["scan"]?.ToJsonString());
        Assert.Equal(5, st?["scan"].Num("files_seen"));

        // What's read: answered here.
        foreach (var p in new[] { "/api/library/folders", "/api/music-mount", "/api/search-status", "/api/library/browse?path=" + Uri.EscapeDataString(lib.Root),
            "/api/library/browse?path=" + Uri.EscapeDataString(Path.Combine(lib.Root, "nas")), "/api/library/browse?path=/", "/api/library/browse" })
        {
            var r = await s.Get(p);
            Assert.True((r.Status, r.By) == (200, "C#"), p + ": " + r.J?.ToJsonString());
        }
        var f = (await s.Get("/api/library/folders")).J;
        Assert.Equal([(lib.Music, 5.0, true)], f!["folders"].Items().Select(x => (x.Str("path"), x.Num("tracks") ?? -1, x.Bool("default") ?? false)));
        JsonAssert.Same(Http.Json(new { mounted = true, path = lib.Music, paths = new[] { lib.Music } }), (await s.Get("/api/music-mount")).J);
        var ss = (await s.Get("/api/search-status")).J;
        Assert.Equal((2.0, false, true, 2.0), (ss.Num("indexed") ?? -1, ss.Bool("building") ?? true, ss.Bool("ready") ?? false, ss.Num("count") ?? -1));
        JsonAssert.Same(Http.Json(new[] { new { name = "Music", path = other } }), (await s.Get("/api/library/browse?path=" + Uri.EscapeDataString(Path.Combine(lib.Root, "nas")))).J?["dirs"]);
        JsonAssert.Same((await s.Get("/api/library/browse?path=/")).J!.ToJsonString(), (await s.Get("/api/library/browse")).J, "no path: the top");
        var nowhere = Path.Combine(lib.Root, "nowhere");
        var none = await s.Get("/api/library/browse?path=" + Uri.EscapeDataString(nowhere));
        Assert.Equal(400, none.Status);
        JsonAssert.Same(Http.Json(new { error = "Can't open " + nowhere }), none.J);

        // A folder that can't be added or removed: said why, as the Node server said it.
        foreach (var (body, status, error) in new (object, int, string)[]
        {
            (new { add = Path.Combine(lib.Music, "Artist A") }, 400, "Already in the library, as part of " + lib.Music),
            (new { add = lib.Data }, 400, "That's Mandarin's own data folder"),
            (new { add = nowhere }, 400, "Can't read " + nowhere),
            (new { add = "/proc" }, 400, "Not that folder — choose the one your music is in"),
            (new { add = "/" }, 400, "Not that folder — choose the one your music is in"),
            (new { remove = other }, 404, "Not one of the music folders"),
            (new { remove = lib.Music }, 400, "It's the only music folder — add another first"),
            (new { }, 400, "add or remove"), (new { add = "" }, 400, "add or remove")
        })
        {
            var r = await s.Post("/api/library/folders", body);
            Assert.True((r.By, r.Status) == ("C#", status), Http.Json(body) + ": " + r.Status + " " + r.J?.ToJsonString());
            JsonAssert.Same(Http.Json(new { error }), r.J, Http.Json(body));
        }
        var forget = await s.Post("/api/library/forget-folder", new { dir = other });
        Assert.Equal(("C#", 400), (forget.By, forget.Status));
        JsonAssert.Same("""{"error":"Not one of the music folders"}""", forget.J);

        // A folder added: read at once, its albums join; removed: they leave with it.
        var added = await s.Post("/api/library/folders", new { add = other });
        Assert.True((added.By, added.Status, added.J.Bool("scanning")) == ("C#", 200, true), added.J?.ToJsonString());
        await Session.Until(async () => await s.Albums() == 3, 20000, "the added folder's albums");
        await Session.Until(s.Idle, 15000, "the scan to end");
        var both = new[] { (lib.Music, 5.0), (other, 2.0) }.OrderBy(x => x.Item1, StringComparer.Ordinal);
        Assert.Equal(both, (await s.Get("/api/library/folders")).J!["folders"].Items().Select(x => (x.Str("path")!, x.Num("tracks") ?? -1)));
        Assert.True((await s.Get("/api/status")).J!["music_dirs"].Items().Select(x => (string?)x).SequenceEqual(new[] { lib.Music, other }.Order(StringComparer.Ordinal)), "the status says the same folders");
        var removed = await s.Post("/api/library/folders", new { remove = other });
        Assert.True((removed.By, removed.Status, removed.J.Num("removed"), removed.J.Num("count")) == ("C#", 200, 2, 2), removed.J?.ToJsonString());
        Assert.True(await s.Albums() == 2, "gone at once");
        Assert.True((await s.Get("/api/status")).J.Num("index_count") == 2, "and from what the status counts");

        // Rescan: 'fresh' when nothing changed, 'rebuilt' when something did; Reindex reads every file.
        var r1 = await s.Post("/api/library/rescan");
        Assert.Equal("C#", r1.By);
        Assert.True((r1.Status, r1.J.Str("status"), r1.J.Str("scan_status"), r1.J.Num("count"), r1.J?["services"]?.ToJsonString()) == (200, "fresh", "unchanged", 2, "[]"), r1.J?.ToJsonString());
        Gen(Path.Combine(lib.Music, "Artist C", "New One", "01 N1.flac"), 330, "N1", "Artist C", "New One", 1);
        r1 = await s.Post("/api/library/rescan", new { force = false });
        Assert.True((r1.J.Str("status"), r1.J.Num("count")) == ("rebuilt", 3), r1.J?.ToJsonString());
        Assert.True(await s.Albums() == 3, "the library read again");
        Assert.Equal("updated", (await s.Get("/api/status")).J?["scan"]?["last"].Str("status"));
        r1 = await s.Post("/api/reindex");
        Assert.True((r1.By, r1.Status, r1.J.Bool("ok"), r1.J.Num("indexed"), r1.J.Str("status"), r1.J?["services"]?.ToJsonString()) == ("C#", 200, true, 3, "updated", "[]"), r1.J?.ToJsonString());
        Assert.True(r1.J.Num("changed") == 6, "every file read again: " + r1.J?.ToJsonString());

        // A folder gone from the music folder: kept until let go, then its albums go.
        Directory.Delete(Path.Combine(lib.Music, "Artist C"), true);
        r1 = await s.Post("/api/library/rescan");
        Assert.True(r1.J.Num("count") == 3, "kept: " + r1.J?.ToJsonString());
        var gone = Path.Combine(lib.Music, "Artist C");
        var last = (await s.Get("/api/status")).J?["scan"]?["last"];
        Assert.True(last?["offline_dirs"].Items().Select(d => (d.Str("dir"), d.Str("reason"))).SequenceEqual([(gone, "missing")]), last?.ToJsonString());
        r1 = await s.Post("/api/library/forget-folder", new { dir = gone });
        Assert.Equal(("C#", 200), (r1.By, r1.Status));
        JsonAssert.Same("""{"ok":true,"removed":1,"count":2}""", r1.J);
        last = (await s.Get("/api/status")).J?["scan"]?["last"];
        Assert.True(!last?["offline_dirs"].Items().Any() ?? false, "no longer offered");
        Assert.Equal(2, await s.Albums());
    }

    [Test]
    public async Task A_change_in_the_music_folders_read_once_it_has_been_quiet()
    {
        var lib = Fixtures.MakeLibrary();
        await using var s = await Serve(lib, new() { ["MANDARIN_WATCH_QUIET_MS"] = "500", ["MANDARIN_WATCH_GAP_MS"] = "1000" });
        await Session.Until(async () => await s.Albums() == 3 && await s.Idle(), 30000, "the first scan");
        for (int i = 1; i <= 2; i++) Gen(Path.Combine(lib.Music, "Artist W", "Watched", $"0{i} W{i}.flac"), 300 + 50 * i, $"W{i}", "Artist W", "Watched", i);
        await Session.Until(async () => await s.Albums() == 4, 20000, "the new album, unasked");
        // Any scan still to follow the album's files done with (the watch's quiet and gap, and more).
        await Task.Delay(2000);
        await Session.Until(s.Idle, 15000, "the scan to end");
        // The last scan as it was said (another scan says itself again, its time at least).
        var last = (await s.Get("/api/status")).J?["scan"]?["last"]?.ToJsonString();
        Assert.True(last is { Length: > 0 } && last != "null");
        // Into a hidden folder: not a change.
        Gen(Path.Combine(lib.Music, ".hidden", "x.flac"), 500, "X", "X", "X");
        // A window longer than the watch's quiet and gap: nothing may be read in it.
        await Task.Delay(2500);
        Assert.True((await s.Get("/api/status")).J?["scan"]?["last"]?.ToJsonString() == last, "nothing read for a hidden folder");
    }

    [Test]
    public async Task The_timer_every_SCAN_INTERVAL_HOURS()
    {
        var lib = Fixtures.MakeLibrary();
        // Not watched (a quiet longer than the test), so only the timer can find it: two seconds.
        await using var s = await Serve(lib, new() { ["MANDARIN_WATCH_QUIET_MS"] = "600000" }, new() { ["scanHours"] = 2.0 / 3600 });
        await Session.Until(async () => await s.Albums() == 3 && await s.Idle(), 30000, "the first scan");
        Gen(Path.Combine(lib.Music, "Artist T", "Timed", "01 T1.flac"), 410, "T1", "Artist T", "Timed", 1);
        await Session.Until(async () => await s.Albums() == 4, 15000, "the new album, on the timer");
    }
}
