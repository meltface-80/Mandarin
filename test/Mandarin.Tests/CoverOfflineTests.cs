namespace Mandarin.Tests;

/// <summary>
/// A cover asked for while the album's files aren't there (a drive not mounted yet: the server started before it) is
/// not to be had for now (Covers.cs Source), never "no cover": its placeholder was drawn under the album's own address
/// and kept for a week by every browser and phone (immutable), and on the server for good, so the album showed the
/// placeholder long after the drive was back. Once the files are there and the library has been read, its own cover.
/// </summary>
public sealed class CoverOfflineTests
{
    [Test]
    public async Task A_cover_asked_for_while_its_drive_is_away_is_its_own_once_the_drive_is_back()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        await using var s = await Session.Started(lib: lib);
        var key = (await s.Album("Album One")).Str("image_key");
        var folder = Path.Combine(lib.Music, "Artist A", "Album One");
        var away = Path.Combine(lib.Root, "away");
        Directory.Move(folder, away);

        var meanwhile = await Bytes.Get(s.Base + "/api/image/" + key + "?size=300", s.H);
        Assert.Equal(404, meanwhile.Status);
        Assert.Equal("max-age=300", meanwhile.Header("Cache-Control"));

        Directory.Move(away, folder);
        Assert.Equal(200, (await s.Api("library/rescan", new { force = true })).Status);   // or five minutes: a cover missed is asked again after them
        Assert.Equal(key, (await s.Album("Album One")).Str("image_key"));
        Bytes.Answer back = null!;
        await Session.Until(async () => (back = await Bytes.Get(s.Base + "/api/image/" + key + "?size=300", s.H)).Status == 200, 30000, "the cover once the drive is back");
        Assert.Equal("public, max-age=604800, immutable", back.Header("Cache-Control"));
        // Its own: the fixture's red square, not the placeholder's.
        var jpg = Path.Combine(lib.Root, "back.jpg"); var raw = Path.Combine(lib.Root, "back.rgb");
        await File.WriteAllBytesAsync(jpg, back.Body);
        Fixtures.Run(["-y", "-loglevel", "error", "-i", jpg, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
        var reds = await File.ReadAllBytesAsync(raw);
        Assert.True(reds.Length == 3 && reds[0] > 200 && reds[1] < 60 && reds[2] < 60, "the album's own red cover, not a placeholder: " + string.Join(",", reds));
    }
}
