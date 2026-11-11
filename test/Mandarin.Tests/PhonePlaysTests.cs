using System.Globalization;

namespace Mandarin.Tests;

/// <summary>
/// The phone's offline plays sent again (DownloadListRoutes.cs PhonePlays): the phone clears them only when it hears the
/// answer, which a network change can lose after the server has written them, so the same batch comes again. Each
/// play (the track, the phone, the moment) is kept once, and so scrobbled once, never twice in the history and on Last.fm.
/// </summary>
public sealed class PhonePlaysTests
{
    [Test]
    public async Task Offline_plays_sent_again_are_kept_once()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var s = await Session.Started();
        var cd = (await s.Album("Album One"))!;
        var tracks = (await s.Api("album?offset=" + cd.Num("offset"))).J!["tracks"]!.AsArray();
        var dayAgo = DateTimeOffset.UtcNow.AddDays(-1).ToUnixTimeMilliseconds();
        var batch = new { plays = new[] { new { track_id = tracks[0].Num("track_id"), ts = dayAgo }, new { track_id = tracks[1].Num("track_id"), ts = dayAgo + 200000 } } };
        Assert.Equal(2.0, (await s.Api("phone/plays", batch)).J.Num("recorded"));
        Assert.Equal(0.0, (await s.Api("phone/plays", batch)).J.Num("recorded"));
        Assert.Equal(2L, Convert.ToInt64(s.Server.Scalar("SELECT COUNT(*) FROM plays"), CultureInfo.InvariantCulture));
        // Played again later: a play of its own.
        Assert.Equal(1.0, (await s.Api("phone/plays", new { plays = new[] { new { track_id = tracks[0].Num("track_id"), ts = dayAgo + 400000 } } })).J.Num("recorded"));
    }
}
