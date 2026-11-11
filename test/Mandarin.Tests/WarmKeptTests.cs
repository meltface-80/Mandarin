namespace Mandarin.Tests;

/// <summary>
/// A making kept on for the next track's, one for each track (audit H2, Upsample/Warm.cs). A DSF made as it plays,
/// joined to the next track on its album, goes on into that track's start and waits for its making (item 262); only
/// one was kept, and the next making of anything else stopped it, so that a second room's track broke the first
/// room's join. Here an album that runs on is begun, then another room's track is made (a 96 kHz track as DSD64, no
/// making kept for it), and the album's second track is still made on from its first.
/// </summary>
public sealed class WarmKeptTests
{
    [Test]
    public async Task A_making_kept_for_one_rooms_next_track_is_kept_while_another_rooms_track_is_made()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var s = await Session.Started();
        await Session.Until(async () => (await s.Api("library-stats")).J.Num("albums") == 3, 30000, "the library");
        string Url(string title) => s.Base + $"/stream/t{s.Server.Rows("SELECT id FROM tracks WHERE title = $1", title)[0]["id"]}.d64.dsf";
        bool Made(string file, bool onFrom) => s.Server.Logs.Any(l => l.Contains($"{file}: DSD64 from PCM", StringComparison.Ordinal)
            && l.Contains("made as it played", StringComparison.Ordinal) && (!onFrom || l.EndsWith(", on from the track before", StringComparison.Ordinal)));

        // The first room's first track, kept on for its next; then the second room's, made in its turn.
        foreach (var (title, file) in new[] { ("Song 1", "01 Song 1.flac"), ("Hi 1", "01 Hi 1.flac") })
        {
            Assert.Equal(200, (await Bytes.Get(Url(title), s.H)).Status);
            await Session.Until(() => Task.FromResult(Made(file, false)), 15000, title + " made");
        }
        // The first room's second track: made on from its first, the making kept for it still there.
        Assert.Equal(200, (await Bytes.Get(Url("Song 2"), s.H)).Status);
        await Session.Until(() => Task.FromResult(Made("02 Song 2.flac", false)), 15000, "Song 2 made");
        Assert.True(Made("02 Song 2.flac", true), "Song 2 made on from the track before it: " + string.Join(" | ", s.Server.Logs.Where(l => l.Contains("Song 2", StringComparison.Ordinal))));
    }
}
