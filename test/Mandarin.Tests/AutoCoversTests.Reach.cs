namespace Mandarin.Tests;

/// <summary>
/// The cover finder when the music can't be reached (bug list item 410, Extras/AutoCovers.Reach.cs): a restored
/// library pointing at folders that aren't on this computer had every run look at all of it again and say "14078 to
/// look at again (a catalogue or a drive didn't answer)". Now the folder that isn't there is named, once, in the run's
/// line and in Settings' (the status's unreachable); its albums are passed over by the runs after without a look,
/// and looked at as soon as it is there again.
/// </summary>
public sealed partial class AutoCoversTests
{
    private static int Said(Session s, string what) => s.Server.Logs.Count(l => l.Contains("[covers] ", StringComparison.Ordinal) && l.Contains(what, StringComparison.Ordinal));

    [Test]
    public async Task When_the_music_folder_cant_be_reached_the_finder_says_so_once_waits_for_it_and_looks_once_it_is_back()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        await using var cat = await Catalogue.Start(Jpeg(Path.Combine(lib.Root, "web"), 600), HiRes, NotBestOf);
        await using var s = await Session.Started(cat.Options(), lib);
        await Pass(s);
        await Session.Until(() => Task.FromResult(Edit(s, "Hi Res") != null && Remembered(s, "Best Of") == "none"), 30000, "the first run");
        var asked = cat.Searched("Best Of");

        // Their tracks changed (so each is due again), and the music folder taken away: nothing can be told about.
        s.Server.Exec("UPDATE album_auto_art SET tracks = '9:0:0'");
        var away = Path.Combine(lib.Root, "away");
        Directory.Move(lib.Music, away);
        var words = $"the music folders can't be reached ({lib.Music} not found): covers will be looked for once they are";
        var first = (await Pass(s)).J;
        await Session.Until(() => Task.FromResult(Said(s, words) == 1), 10000, "the run's line on the folder");
        Assert.Contains(s.Server.Logs, l => l.Contains("[covers] 2 album(s) not looked at: " + words, StringComparison.Ordinal));
        Assert.Equal(0, first.Num("looked"));
        Assert.Equal(0, first.Num("later"));
        Assert.Equal(0, Said(s, "to look at again"));
        Assert.Equal(asked, cat.Searched("Best Of"));
        // Settings → Library Scanner → Find covers says the same.
        var line = (await s.Api("covers/auto")).J;
        Assert.Equal([lib.Music], line.Strs("unreachable").OfType<string>().ToArray());
        // And under the Album Scanner's Progress, where the page and the app say it now (item 411).
        Assert.Equal([lib.Music], (await s.Api("album-scanner")).J.Strs("unreachable").OfType<string>().ToArray());

        // The next runs pass them over quietly: nothing looked at, nothing said again.
        JsonAssert.Same("""{ "ok": true, "looked": 0, "found": 0, "none": 0, "own": 0, "later": 0 }""", (await Pass(s)).J);
        await Pass(s, wide: true);
        Assert.Equal(1, Said(s, words));
        Assert.Equal(asked, cat.Searched("Best Of"));

        // The folder back: looked at by the next run (this one, or one a scan started first), and Settings no longer says it.
        Directory.Move(away, lib.Music);
        await Pass(s);
        string? Mark(string title) => s.Server.Scalar("SELECT r.tracks FROM album_auto_art r JOIN albums a ON a.key = r.key WHERE a.title = $1", title) as string;
        await Session.Until(() => Task.FromResult(cat.Searched("Best Of") == asked + 1 && Mark("Best Of") != "9:0:0" && Mark("Album One") != "9:0:0"), 30000,
            "Best Of and Album One looked at again");
        Assert.Equal("own", Remembered(s, "Album One"));
        Assert.Equal("none", Remembered(s, "Best Of"));
        Assert.Equal(1, Said(s, words));
        Assert.Null((await s.Api("covers/auto")).J["unreachable"]);
    }
}
