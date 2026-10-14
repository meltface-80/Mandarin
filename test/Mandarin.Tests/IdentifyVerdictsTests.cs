namespace Mandarin.Tests;

/// <summary>
/// Your say on a match (v0.9.1, the audit's T1): POST /api/identify/accept and /api/identify/reject. A
/// proposal waiting for an album: accepted, its title, artist, year and track names laid over the
/// album, what was there kept; rejected once applied, all of that put back; rejected while waiting,
/// declined and nothing applied. An album no longer there, and one with no verdict, say so
/// (test/identify-verdicts.test.js, in C#).
/// </summary>
public sealed class IdentifyVerdictsTests
{
    [Test]
    public async Task A_proposal_accepted_then_rejected_laid_over_the_album_then_put_back_one_declined_while_waiting()
    {
        await using var s = await Session.Started();
        var db = s.Server;
        object? KeyOf(string title) => db.Scalar("SELECT key FROM albums WHERE title = $1", title);
        void Propose(string title, string mbid, object cand) =>
            db.Exec("INSERT INTO album_matches(key, mbid, distance, status, candidate, before, checked_at, applied_at) VALUES($1, $2, 0.1, 'proposed', $3, NULL, $4, NULL)",
                KeyOf(title), mbid, Http.Json(cand), DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        (string?, long) Verdict(string title)
        {
            var r = db.Rows("SELECT status, before IS NOT NULL AS kept FROM album_matches WHERE key = $1", KeyOf(title))[0];
            return ((string?)r["status"], (long)r["kept"]!);
        }
        Dictionary<string, object?>? Edit(string title) => db.Rows("SELECT title, artist, year FROM album_edits WHERE key = $1", KeyOf(title)).FirstOrDefault();
        List<string?> TrackNames(string title) => [.. db.Rows("SELECT title FROM track_edits WHERE key = $1 AND title IS NOT NULL ORDER BY pos", KeyOf(title)).Select(r => (string?)r["title"])];

        Propose("Album One", "m-one", new { mbid = "m-one", artist = "Artist A & Friends", title = "Album One (Deluxe)", year = 1998, parts = new { },
            tracks = new[] { new { title = "First" }, new { title = "Second" }, new { title = "Third" } } });
        Propose("Hi Res", "m-hires", new { mbid = "m-hires", artist = "Artist B", title = "Not This One", year = 2001, parts = new { }, tracks = Array.Empty<object>() });
        var one = (await s.Album("Album One"))!; var hires = (await s.Album("Hi Res"))!; var best = (await s.Album("Best Of"))!;

        // Accepted: the release's names over the album's, what it had kept for an undo.
        var r = await s.Api("identify/accept", new { offset = one.Num("offset") });
        Assert.True(r.Status == 200, r.Text);
        Assert.Equal(("applied", 1L), Verdict("Album One"));
        var e = Edit("Album One")!;
        Assert.Equal(("Album One (Deluxe)", "Artist A & Friends", 1998L), ((string?)e["title"], (string?)e["artist"], (long?)e["year"]));
        Assert.Equal(["First", "Second", "Third"], TrackNames("Album One"));
        await Session.Until(async () => (await s.Album("Album One (Deluxe)")) is { } a && a.Num("year") == 1998 && a.Str("subtitle") == "Artist A & Friends", 15000, "the library to show the match");

        // Rejected once applied: put back as it was, and declined.
        r = await s.Api("identify/reject", new { offset = (await s.Album("Album One (Deluxe)")).Num("offset") });
        Assert.True(r.Status == 200, r.Text);
        Assert.Equal(("rejected", 0L), Verdict("Album One"));
        Assert.Empty(TrackNames("Album One"));
        Assert.True(Edit("Album One")?["title"] == null, "the title the files give");
        await Session.Until(async () => (await s.Album("Album One")) is { } a && a.Num("year") == 1997 && a.Str("subtitle") == "Artist A", 15000, "the library to show the album as it was");

        // Rejected while waiting: declined, nothing laid over it.
        r = await s.Api("identify/reject", new { offset = hires.Num("offset") });
        Assert.True(r.Status == 200, r.Text);
        Assert.Equal(("rejected", 0L), Verdict("Hi Res"));
        Assert.Null(Edit("Hi Res"));

        // No verdict to accept or reject; no such album.
        async Task Says(string path, object? offset, int status, string error)
        {
            var a = await s.Api(path, new { offset });
            Assert.Equal(status, a.Status);
            JsonAssert.Same(Http.Json(new { error }), a.Json);
        }
        await Says("identify/accept", best.Num("offset"), 409, "Nothing to accept for this album");
        await Says("identify/reject", best.Num("offset"), 409, "Nothing to reject for this album");
        await Says("identify/accept", 987654, 404, "No such album");
    }
}
