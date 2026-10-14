using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Answers kept once made (v0.9.3, the audit's P1 and P2; LibraryRoutes.Kept.cs, Pages.Kept.cs). The
/// library's lists are made once for a copy of the library and the hearts it shows, then sent as kept
/// (X-Mandarin-Kept), a 304 for a copy still current; a heart changed or an album edited makes them
/// afresh. The Android app's page and stylesheet are made once for the files they come from; a file
/// changed makes them afresh (test/library-kept.test.js, in C#).
/// </summary>
public sealed class LibraryKeptTests
{
    private sealed record Asked(int Status, string? Kept, string? Tag, string Text);

    private static async Task<Asked> Ask(string url, IDictionary<string, string> h, IDictionary<string, string>? more = null)
    {
        var headers = new Dictionary<string, string>(h);
        foreach (var (k, v) in more ?? new Dictionary<string, string>()) headers[k] = v;
        var r = await Http.Get(url, headers);
        return new Asked(r.Status, r.Header("x-mandarin-kept"), r.Header("etag"), r.Status == 200 ? r.Text : "");
    }

    [Test]
    public async Task The_librarys_lists_kept_for_the_copy_and_the_hearts_they_were_made_from_made_afresh_when_either_moves()
    {
        await using var s = await Session.Started();
        await s.Api("settings/shelf", new { enabled = true });   // a new install: Shelf off until switched on (v1.0.2)
        Task<Asked> Get(string p, IDictionary<string, string>? more = null) => Ask(s.Base + p, s.H, more);
        foreach (var p in new[] { "/api/shelf/albums", "/api/library/albums?sort=album", "/api/artists?sort=az", "/api/library/facets" })
        {
            var first = await Get(p);
            Assert.True(first.Status == 200, p);
            Assert.True(first.Kept == null, p + ": made the first time");
            var again = await Get(p);
            Assert.True(again == first with { Kept = "1" }, p + ": sent as kept");
            var current = await Get(p, new Dictionary<string, string> { ["If-None-Match"] = first.Tag! });
            Assert.True((current.Status, current.Kept) == (304, "1"), p + ": a copy still current");
        }
        // Another query is another answer, made for itself.
        Assert.True((await Get("/api/library/albums?sort=year")).Kept == null, "another query");

        // A heart: the lists show it, made afresh.
        var before = await Get("/api/library/albums?sort=album");
        Assert.Equal("1", before.Kept);
        var one = (await s.Album("Album One"))!;
        Assert.Null(one["favourite"]);
        Assert.Equal(200, (await s.Api("favourites", new { offset = one.Num("offset"), on = true })).Status);
        Asked? hearted = null;
        await Session.Until(async () => (hearted = await Get("/api/library/albums?sort=album")).Kept == null, 15000, "the list made again");
        Assert.NotEqual(before.Tag, hearted!.Tag);
        Assert.True(JsonNode.Parse(hearted.Text)!["albums"].Items().First(a => a.Str("title") == "Album One").Bool("favourite"));
        Assert.True((await Get("/api/library/albums?sort=album")).Kept == "1", "and kept again");

        // An album edited: a new copy of the library, every list made afresh.
        Assert.True((await Get("/api/shelf/albums")).Kept == null, "made again for the heart, as every list is");
        var shelf = await Get("/api/shelf/albums");
        Assert.Equal("1", shelf.Kept);
        Assert.Equal(200, (await s.Api("album/edit", new { offset = one.Num("offset"), title = "Album One, Edited" })).Status);
        Asked? edited = null;
        await Session.Until(async () => (edited = await Get("/api/shelf/albums")).Text.Contains("Album One, Edited", StringComparison.Ordinal), 15000, "the Shelf made again");
        Assert.Null(edited!.Kept);
        Assert.NotEqual(shelf.Tag, edited.Tag);
    }

    [Test]
    public async Task What_the_play_history_decides_isnt_kept_past_a_play_Most_played_the_Played_filter_the_facets()
    {
        await using var s = await Session.Started();
        async Task<(string? Kept, JsonNode J)> Get(string p) { var r = await Http.Get(s.Base + p, s.H); return (r.Header("x-mandarin-kept"), r.J); }
        static List<string?> Titles((string?, JsonNode J) r) => [.. r.J["albums"].Items().Select(a => a.Str("title"))];
        // Nothing played yet: each answered twice, as the page asks.
        foreach (var p in new[] { "/api/library/albums?sort=plays&dir=desc", "/api/library/albums?sort=album&played=played", "/api/library/facets" }) { await Get(p); await Get(p); }
        Assert.False((await Get("/api/library/facets")).J.Bool("hasPlays"));
        Assert.True((await Get("/api/library/facets")).Kept == "1", "the facets kept while nothing changes");
        Assert.Empty(Titles(await Get("/api/library/albums?sort=album&played=played")));
        // A play (as the server writes one): no scan, no heart, so the library's copy is the same.
        var hi = (await s.Album("Hi Res"))!;
        s.Server.InsertPlay((long)hi.Num("offset")!.Value, null, "Song", "Artist B", "Hi Res", "TEST", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        var most = await Get("/api/library/albums?sort=plays&dir=desc");
        Assert.True(most.Kept == null, "Most played is never sent as kept");
        Assert.True(Titles(most)[0] == "Hi Res", "the album just played comes first");
        Assert.True(Titles(await Get("/api/library/albums?sort=album&played=played")).SequenceEqual(["Hi Res"]), "the Played filter has it");
        var facets = await Get("/api/library/facets");
        Assert.True(facets.J.Bool("hasPlays"), "the facets know something has been played");
        Assert.Null(facets.Kept);
        Assert.True((await Get("/api/library/facets")).Kept == "1", "and are kept again for that");
    }

    [Test]
    public async Task The_Android_apps_page_and_stylesheet_kept_for_the_files_they_come_from_made_afresh_when_one_changes()
    {
        Needs.Server(); Needs.Ffmpeg();
        var app = Directory.CreateTempSubdirectory("mandarin-app-").FullName;
        try
        {
            Copy(Path.Combine(ServerProcess.Root, "public"), Path.Combine(app, "public"));
            await using var s = await Session.Started(new Dictionary<string, object?> { ["appDir"] = app });
            var asApp = new Dictionary<string, string>(s.H) { ["User-Agent"] = "Mozilla/5.0 MusicDAndroid/0.9.3" };
            Task<Asked> Get(string p) => Ask(s.Base + p, asApp);
            foreach (var p in new[] { "/style.css", "/" })
            {
                var first = await Get(p);
                Assert.True(first.Status == 200, p);
                Assert.True(first.Kept == null, p + ": made the first time");
                var again = await Get(p);
                Assert.True((again.Kept, again.Tag, again.Text) == ("1", first.Tag, first.Text), p + ": sent as kept");
            }
            // The app's own rules changed (an update puts new files in place): made afresh, with them.
            var before = await Get("/style.css");
            await File.AppendAllTextAsync(Path.Combine(app, "public", "android.css"), "\n.kept-test { color: red; }\n");
            var after = await Get("/style.css");
            Assert.Null(after.Kept);
            Assert.NotEqual(before.Tag, after.Tag);
            Assert.Contains(".kept-test { color: red; }", after.Text, StringComparison.Ordinal);
            Assert.True((await Get("/style.css")).Kept == "1", "and kept again");
        }
        finally { Directory.Delete(app, true); }
    }

    private static void Copy(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var f in Directory.GetFiles(from)) File.Copy(f, Path.Combine(to, Path.GetFileName(f)));
        foreach (var d in Directory.GetDirectories(from)) Copy(d, Path.Combine(to, Path.GetFileName(d)));
    }
}
