namespace Mandarin.Tests;

public sealed partial class AutoCoversTests
{
    private static readonly Catalogue.Known Streamed = new(5, "Streamed Set", "Artist S", ["S 1", "S 2"]);
    private static readonly Catalogue.Known Served = new(6, "Served Set", "Artist Q", ["Q 1"]);

    // A streamed album written as its service's reading writes one: [service]'s key, its tracks its addresses, none with a cover.
    private static void StreamedAlbum(Session s, string service, int id, Catalogue.Known k)
    {
        var key = service + ":" + id;
        s.Server.Exec(@"INSERT INTO albums(key, title, artist, sort_title, sort_artist, dir, track_count, duration, max_rate, max_bits, lossless, container,
                        compilation, added_at, updated_at) VALUES($1, $2, $3, $2, $3, $4, $5, 60, 44100, 16, 1, 'flac', 0, 1, 1)",
            key, k.Title, k.Artist, service + "://album/" + id, (double)k.Tracks.Length);
        var album = Convert.ToInt64(s.Server.Scalar("SELECT id FROM albums WHERE key = $1", key), System.Globalization.CultureInfo.InvariantCulture);
        for (int i = 0; i < k.Tracks.Length; i++)
            s.Server.Exec(@"INSERT INTO tracks(album_id, path, mtime, size, title, artist, album_artist, album, track_no, disc_no, duration, codec, container, channels,
                            lossless, has_picture) VALUES($1, $2, 0, 1000, $3, $4, $4, $5, $6, 1, 30, 'flac', 'flac', 2, 1, 0)",
                album, service + "://track/" + (id * 10 + i), k.Tracks[i], k.Artist, k.Title, (double)(i + 1));
        s.Server.Exec("INSERT INTO cache(ns, key, value, ts) VALUES($1, $2, '{\"why\":\"library\"}', 1)", service + "-kept", key);
    }

    [Test]
    public async Task An_iBroadcast_album_with_no_cover_is_given_one_and_another_services_isnt_asked_about()
    {
        // Item 504: an iBroadcast album with only iBroadcast's stand-in has none kept (IBroadcastArt.cs); the finder looks
        // for one, as for an album of files. Its folder is none of the music folders': never "out of reach".
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        await using var cat = await Catalogue.Start(Jpeg(Path.Combine(lib.Root, "web"), 600), HiRes, NotBestOf, AlbumOne, Streamed, Served);
        await using var s = await Session.Started(cat.Options(), lib);
        await Pass(s);
        // Signed in to both, their albums in the library (Library.cs shows a service's albums only so).
        s.Server.SetSetting("ibroadcast", new { access_token = "stood-in" });
        s.Server.SetSetting("qobuz", new { token = "stood-in" });
        s.Server.SetSetting("qobuzSettings", new { import = true });
        StreamedAlbum(s, "ibroadcast", 900, Streamed);
        StreamedAlbum(s, "qobuz", 901, Served);
        await s.Server.Reload();
        await Session.Until(async () => await s.Album("Streamed Set") != null, 15000, "the iBroadcast album in the library");
        await Pass(s);
        await Session.Until(() => Task.FromResult(Edit(s, "Streamed Set") != null), 30000, "the iBroadcast album's cover found");
        Assert.Equal("auto:itunes", Edit(s, "Streamed Set")!["art_source"]);
        Assert.Equal("found", Remembered(s, "Streamed Set"));
        // Qobuz's albums come with Qobuz's covers: never asked about.
        Assert.Equal(0, cat.Searched("Served Set"));
        Assert.Null(Edit(s, "Served Set"));
    }
}
