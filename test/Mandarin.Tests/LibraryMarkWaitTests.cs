using System.Diagnostics;

namespace Mandarin.Tests;

/// <summary>
/// Albums added show up at once (bug list item 232): the mark of which albums there are (/api/library/mark,
/// v0.8.43) can be waited on. Asked with <c>wait_for</c> the mark a screen has, it answers the moment a new copy
/// of the library holds other albums, or the same mark once its timeout passes. The Android app holds it while
/// it is on screen, and the page while it is left alone, so an album copied into a watched folder reaches the
/// Library wall sorted by Recently added with nothing touched. Before, the app never asked at all, and the page
/// asked every ten seconds once nothing else had been asked for twenty.
/// </summary>
public sealed class LibraryMarkWaitTests
{
    [Test]
    public async Task Waited_on_the_mark_answers_as_soon_as_an_album_is_added_and_holds_until_then()
    {
        var lib = Fixtures.MakeLibrary();
        await using var s = await Session.Started(lib: lib, env: new Dictionary<string, string> { ["MANDARIN_WATCH_QUIET_MS"] = "300", ["MANDARIN_WATCH_GAP_MS"] = "0" });
        static string? Mark(Http.Answer a) => (string?)a.Json?["albums"];
        var first = Mark(await s.Api("library/mark"));
        Assert.True(first is { Length: > 0 }, "a mark to wait on");

        // Nothing changed: held for the time asked, then the same mark.
        var t0 = Stopwatch.StartNew();
        var same = await s.Api("library/mark?wait_for=" + Uri.EscapeDataString(first!) + "&timeout=1500");
        Assert.True(t0.ElapsedMilliseconds >= 1300, $"held while nothing changed ({t0.ElapsedMilliseconds} ms)");
        Assert.Equal(first, Mark(same));

        // A mark other than the library's: answered at once, with the library's.
        t0.Restart();
        var behind = await s.Api("library/mark?wait_for=0-0&timeout=20000");
        Assert.True(t0.ElapsedMilliseconds < 5000, $"a mark behind answered at once ({t0.ElapsedMilliseconds} ms)");
        Assert.Equal(first, Mark(behind));

        // An album copied in while one waits: answered once the folder's scan has read it, well before the timeout.
        t0.Restart();
        var waiting = s.Api("library/mark?wait_for=" + Uri.EscapeDataString(first!) + "&timeout=25000");
        await Task.Delay(500);
        Assert.False(waiting.IsCompleted, "still held before anything was added");
        Fixtures.Gen(Path.Combine(lib.Music, "Fresh Artist", "Fresh Album", "01 Fresh.flac"), seconds: 1,
            tags: new Dictionary<string, object> { ["title"] = "Fresh", ["artist"] = "Fresh Artist", ["album"] = "Fresh Album", ["track"] = 1 });
        var moved = await waiting;
        Assert.True(t0.ElapsedMilliseconds < 20000, $"answered as the album came, not at the timeout ({t0.ElapsedMilliseconds} ms)");
        Assert.True(Mark(moved) is { Length: > 0 } m && m != first, "the new mark");
        Assert.True(await s.Album("Fresh Album") != null, "the album the new mark counts is in the library's answers");
    }
}
