namespace Mandarin.Tests;

/// <summary>
/// The library's copy read again in the background (Library.Copy.cs): once there is a copy, a library
/// request is answered from it while a job's steps (a scan's, the release days') are being read in,
/// never kept waiting for the reading (seconds at ten thousand albums and more); and steps told close
/// together make one reading. Any other change is still waited for by the next request, as the rest of
/// the suite holds it (an edit, a merge, a scan's end read at once).
/// </summary>
public sealed class LibraryCopyTests
{
    private const int Albums = 20000;

    /* A server on the fixture library with many more albums written in, its copy read with them. */
    private static async Task<Session> Big()
    {
        // Two seconds' quiet before a reading, not 300 ms: ten steps told one after another never leave that much
        // between them, however busy the machine.
        var s = await Session.Started(env: new Dictionary<string, string> { ["MANDARIN_LIBRARY_QUIET_MS"] = "2000" });
        Busy.ManyAlbums(s.Server, Albums);
        await s.Server.Reload();
        var all = (await s.Api("library/albums?count=1")).J;
        Assert.True(all.Num("total") > Albums, all.Num("total")?.ToString());
        return s;
    }

    [Test]
    public async Task A_library_request_while_the_copy_is_read_again_is_answered_from_the_one_there_is()
    {
        await using var s = await Big();
        var id = Convert.ToInt64(s.Server.Scalar("SELECT id FROM albums WHERE key = 'many:7'"), System.Globalization.CultureInfo.InvariantCulture);
        Assert.Equal("Many 7", (await s.Api("album?offset=" + id)).J["album"].Str("title"));
        s.Server.Exec("UPDATE albums SET title = 'Renamed' WHERE key = 'many:7'");
        // Told as a job tells it (a scan's step, a batch of release days): nobody waits for the reading.
        await s.Server.Internal("/internal/library/changed", new { lookups = true, background = true });
        var t = System.Diagnostics.Stopwatch.StartNew();
        var during = (await s.Api("album?offset=" + id)).J["album"].Str("title");
        Assert.True(during == "Many 7", $"answered from the copy there was, not after reading the new one ({t.ElapsedMilliseconds} ms): {during}");
        // And the new copy takes its place once read.
        await Session.Until(async () => (await s.Api("album?offset=" + id)).J["album"].Str("title") == "Renamed", 30000, "the new copy");
    }

    [Test]
    public async Task A_jobs_steps_told_close_together_make_one_reading()
    {
        await using var s = await Big();
        var before = (await s.Server.Internal("/internal/library/changed", new { lookups = true })).J.Num("reads");
        // Ten changes told as a storm of them comes (a scan's steps, release days found), the library asked for between them.
        for (int i = 0; i < 10; i++)
        {
            await s.Server.Internal("/internal/library/changed", new { lookups = true, background = true });
            Assert.Equal(200, (await Http.Get(s.Base + "/api/health")).Status);
        }
        // The copy with all of them waited for: one reading made it.
        var after = (await s.Server.Internal("/internal/library/changed", new { })).J.Num("reads");
        Assert.Equal(before + 1, after);
    }
}
