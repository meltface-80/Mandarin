using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// The cover finder (item 409, Extras/AutoCovers.cs): an album with no cover of its own given the
/// cover Edit album's Find would pick without asking (title, artist and tracks agreeing), kept as an
/// automatic edit; a folder picture, an embedded one and a cover the owner chose or took away never
/// touched; a match short of sure never kept, and remembered so it isn't asked again before its time;
/// the albums asked about a few seconds apart and MusicBrainz's rest kept; the switch. Against the three
/// catalogues stood in for here (AutoCoversTests.Catalogue.cs); the fixture library's Album One has a
/// folder picture, Hi Res and Best Of have none.
/// </summary>
public sealed partial class AutoCoversTests
{
    private static readonly Catalogue.Known HiRes = new(1, "Hi Res", "Artist B", ["Hi 1", "Hi 2"]);
    // Best Of's nearest: the same title by someone else, with other songs: not sure.
    private static readonly Catalogue.Known NotBestOf = new(2, "Best Of", "Somebody Else", ["Elsewhere"]);
    // Sure matches for the albums that have a cover of their own: never to be asked about.
    private static readonly Catalogue.Known AlbumOne = new(3, "Album One", "Artist A", ["Song 1", "Song 2", "Song 3"]);
    private static readonly Catalogue.Known PicturedOne = new(4, "Pictured", "Artist C", ["P 1"]);

    private static Task<Http.Answer> Pass(Session s, bool wide = false) => s.Server.Internal("/internal/jobs/covers" + (wide ? "?wide=1" : ""));

    private static Dictionary<string, object?>? Edit(Session s, string title) =>
        s.Server.Rows("SELECT e.art_source, length(e.art) AS bytes FROM album_edits e JOIN albums a ON a.key = e.key WHERE a.title = $1", title).FirstOrDefault();

    private static string? Remembered(Session s, string title) =>
        s.Server.Scalar("SELECT r.status FROM album_auto_art r JOIN albums a ON a.key = r.key WHERE a.title = $1", title) as string;

    [Test]
    public async Task An_album_with_no_cover_gets_the_sure_cover_and_one_with_a_folder_picture_or_an_embedded_one_is_never_asked_about()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        Pictured(lib);
        await using var cat = await Catalogue.Start(Jpeg(Path.Combine(lib.Root, "web"), 600), HiRes, NotBestOf, AlbumOne, PicturedOne);
        await using var s = await Session.Started(cat.Options(), lib);
        var first = (await Pass(s)).J;   // after the run the first scan started, if it is under way
        await Session.Until(() => Task.FromResult(Edit(s, "Hi Res") != null), 30000, "Hi Res's cover found");

        // Hi Res: the sure cover kept as an automatic edit, drawn at its new address.
        var hi = Edit(s, "Hi Res")!;
        Assert.Equal("auto:itunes", hi["art_source"]);
        Assert.True(Convert.ToInt64(hi["bytes"], System.Globalization.CultureInfo.InvariantCulture) > 1000);
        Assert.Equal("found", Remembered(s, "Hi Res"));
        var album = (await s.Album("Hi Res"))!;
        Assert.Matches(@"^al-\d+-e[0-9a-f]{12}$", album.Str("image_key"));
        var drawn = await Bytes.Get(s.Base + "/api/image/" + album.Str("image_key") + "?size=300", s.H);
        Assert.Equal(200, drawn.Status);
        Assert.Contains(s.Server.Logs, l => l.Contains("[covers] Artist B — Hi Res: cover found on iTunes, sure (title, artist, 2 of 2 tracks)", StringComparison.Ordinal));
        var edit = (await s.Api("album/edit?offset=" + album.Num("offset"))).J;
        JsonAssert.Same("""{ "own": true, "found": true, "source": "auto:itunes" }""", edit["art"]);

        // Best Of: its nearest isn't sure: nothing kept, and remembered as nothing sure.
        Assert.Null(Edit(s, "Best Of"));
        Assert.Equal("none", Remembered(s, "Best Of"));
        // Album One's folder picture and Pictured's embedded one: never asked about, never touched.
        Assert.Equal(0, cat.Searched("Album One"));
        Assert.Equal(0, cat.Searched("Pictured"));
        Assert.Null(Edit(s, "Album One"));
        Assert.Null(Edit(s, "Pictured"));
        Assert.Equal("own", Remembered(s, "Album One"));
        Assert.Equal("own", Remembered(s, "Pictured"));
        // A line for the run, none for each album that found nothing.
        Assert.Contains(s.Server.Logs, l => l.Contains("[covers] ", StringComparison.Ordinal) && l.Contains(" album(s) looked at: ", StringComparison.Ordinal));
        Assert.DoesNotContain(s.Server.Logs, l => l.Contains("[covers] ", StringComparison.Ordinal) && l.Contains("Best Of", StringComparison.Ordinal));
        Assert.True(first.Bool("ok"), first.ToJsonString());

        // The line Settings shows.
        var line = (await s.Api("covers/auto")).J;
        Assert.Equal(new object?[] { true, 1, 0, 1 }, new object?[] { line.Bool("on"), (int?)line.Num("found"), (int?)line.Num("left"), (int?)line.Num("none") });
    }

    [Test]
    public async Task An_album_remembered_isnt_asked_again_before_its_time_or_until_its_tracks_change()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        await using var cat = await Catalogue.Start(Jpeg(Path.Combine(lib.Root, "web"), 600), HiRes, NotBestOf);
        await using var s = await Session.Started(cat.Options(), lib);
        await Pass(s);
        await Session.Until(() => Task.FromResult(Remembered(s, "Best Of") == "none"), 30000, "Best Of looked at");
        var asked = cat.Searched("Best Of");
        Assert.Equal(1, asked);

        // Another run, and the nightly one: neither asks again.
        JsonAssert.Same("""{ "ok": true, "looked": 0, "found": 0, "none": 0, "own": 0, "later": 0 }""", (await Pass(s)).J);
        await Pass(s, wide: true);
        Assert.Equal(1, cat.Searched("Best Of"));
        Assert.Equal(1, cat.Searched("Hi Res"));

        // 61 days on: the nightly run asks again (a run after a scan doesn't).
        s.Server.Exec("UPDATE album_auto_art SET ts = ts - 61 * 86400000 WHERE status = 'none'");
        await Pass(s);
        Assert.Equal(1, cat.Searched("Best Of"));
        Assert.Equal(1, (await Pass(s, wide: true)).J.Num("none"));
        Assert.Equal(2, cat.Searched("Best Of"));

        // Its tracks changed (one added, gone or retagged): asked again after the next scan.
        s.Server.Exec("UPDATE album_auto_art SET tracks = '9:0:0' WHERE status = 'none'");
        await Pass(s);
        Assert.Equal(3, cat.Searched("Best Of"));
        Assert.Equal(1, cat.Searched("Hi Res"));
    }

    [Test]
    public async Task The_owners_cover_replaces_an_automatic_one_and_a_cover_taken_away_isnt_brought_back()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        await using var cat = await Catalogue.Start(Jpeg(Path.Combine(lib.Root, "web"), 600), HiRes, NotBestOf);
        await using var s = await Session.Started(cat.Options(), lib);
        await Pass(s);
        await Session.Until(() => Task.FromResult(Edit(s, "Hi Res") != null), 30000, "Hi Res's cover found");
        var offset = (await s.Album("Hi Res"))!.Num("offset");

        // Edit album → another cover: it takes the automatic one's place, and stays.
        var chosen = await s.Api("album/edit", new { offset, art_url = cat.Base + "/other.jpg", art_source = "Deezer" });
        Assert.Equal(200, chosen.Status);
        Assert.Equal("Deezer", Edit(s, "Hi Res")!["art_source"]);
        await Pass(s, wide: true);
        Assert.Equal("Deezer", Edit(s, "Hi Res")!["art_source"]);

        // Edit album → remove the cover: its placeholder again, and the finder doesn't put one back.
        var removed = (await s.Api("album/edit", new { offset, art = "remove" })).J;
        JsonAssert.Same("""{ "own": false, "found": false, "source": null }""", removed["art"]);
        Assert.Null(Edit(s, "Hi Res"));
        Assert.Equal("owner", Remembered(s, "Hi Res"));
        await Pass(s, wide: true);
        await s.Server.Internal("/internal/jobs/after-scan");
        await Pass(s);
        Assert.Null(Edit(s, "Hi Res"));
        Assert.Equal(1, cat.Searched("Hi Res"));
        // Nor after every edit is undone (Reset).
        Assert.Equal(200, (await s.Api("album/edit/reset", new { offset })).Status);
        await Pass(s, wide: true);
        Assert.Null(Edit(s, "Hi Res"));
        Assert.Equal(1, cat.Searched("Hi Res"));
    }

    [Test]
    public async Task Switched_off_it_stops_and_keeps_nothing_and_switched_on_again_it_goes_on()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        await using var cat = await Catalogue.Start(Jpeg(Path.Combine(lib.Root, "web"), 600), HiRes, NotBestOf);
        // The first album search held until the switch is off.
        var held = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        cat.Before = async ctx =>
        {
            if (ctx.Request.Path.Value == "/search" && held.TrySetResult()) await release.Task;
            return false;
        };
        await using var s = await Session.Started(cat.Options(), lib);
        await held.Task.WaitAsync(TimeSpan.FromSeconds(30));
        var off = (await s.Api("covers/auto", new { on = false })).J;
        Assert.False(off.Bool("on"));
        release.SetResult();
        JsonAssert.Same("""{ "ok": true, "looked": 0, "found": 0, "none": 0, "own": 0, "later": 0 }""", (await Pass(s, wide: true)).J);
        Assert.Null(Edit(s, "Hi Res"));
        Assert.Null(Edit(s, "Best Of"));
        Assert.Single(cat.AlbumSearches());
        Assert.False((await s.Api("covers/auto")).J.Bool("on"));

        // On again: the run it starts finds what is left.
        Assert.True((await s.Api("covers/auto", new { on = true })).J.Bool("on"));
        await Session.Until(() => Task.FromResult(Edit(s, "Hi Res") != null && Remembered(s, "Best Of") == "none"), 30000, "the covers looked for again");
        Assert.Equal("auto:itunes", Edit(s, "Hi Res")!["art_source"]);
        Assert.Equal(400, (await s.Api("covers/auto", new { on = "yes" })).Status);
    }

    [Test]
    public async Task Albums_are_asked_about_a_few_seconds_apart_and_musicbrainzs_rest_is_kept()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        await using var cat = await Catalogue.Start(Jpeg(Path.Combine(lib.Root, "web"), 600), HiRes, NotBestOf);
        // MusicBrainz turns the cover search's first lookup away (503): every lookup rests a "minute", here 5 s.
        var turned = 0;
        cat.Before = async ctx =>
        {
            if (ctx.Request.Path.Value != "/mb/release/" || Interlocked.Exchange(ref turned, 1) == 1) return false;
            ctx.Response.StatusCode = 503;
            await ctx.Response.WriteAsync("{}");
            return true;
        };
        await using var s = await Session.Started(cat.Options(gapMs: 1500), lib, new Dictionary<string, string> { ["MUSICBRAINZ_REST_MS"] = "5000" });
        await Pass(s);
        await Session.Until(() => Task.FromResult(cat.AlbumSearches().Count >= 2 && Edit(s, "Hi Res") != null), 30000, "both albums asked about");
        var searches = cat.AlbumSearches();
        Assert.True(searches[1].At - searches[0].At >= 1400, $"the albums were asked about {searches[1].At - searches[0].At} ms apart");

        // The second album's MusicBrainz lookup came while MusicBrainz rested: not asked.
        Assert.Equal(1, cat.MusicBrainz());
        // Hi Res is sure on iTunes alone; Best Of's look wasn't whole, so it isn't remembered as having nothing.
        Assert.Equal("auto:itunes", Edit(s, "Hi Res")!["art_source"]);
        Assert.Null(Remembered(s, "Best Of"));
        Assert.Contains(s.Server.Logs, l => l.Contains("to look at again (a catalogue or a drive didn't answer)", StringComparison.Ordinal));

        // The rest over, it is asked again, MusicBrainz too, and now remembered.
        await Task.Delay(5500);
        Assert.Equal(1, (await Pass(s)).J.Num("none"));
        Assert.Equal(2, cat.MusicBrainz());
        Assert.Equal("none", Remembered(s, "Best Of"));
    }
}
