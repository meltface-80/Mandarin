namespace Mandarin.Tests;

/// <summary>
/// What a service Mandarin no longer has left behind goes as the server starts (bug list items 152, 525, 531): its albums with
/// their hearts, its marks, its settings and its folder; the library's own albums and settings stay. And what the
/// playlists left when they were taken out: their settings and the albums the services' playlists held.
/// </summary>
public sealed class LeftoversTests
{
    [Test]
    public async Task A_gone_service_s_albums_settings_and_folder_go_as_the_server_starts()
    {
        var lib = Fixtures.MakeLibrary();
        await (await Session.Started(lib: lib)).DisposeAsync();
        var db = Path.Combine(lib.Data, "musicd.db");
        SqliteDump.Exec(db, """
            INSERT INTO albums(key, title, artist, dir, added_at, updated_at) VALUES('spotify:a1', 'Gone', 'Someone', 'spotify://album/a1', 1, 2);
            INSERT INTO favourites(key, added_at) VALUES('spotify:a1', 1);
            INSERT INTO cache(ns, key, value, ts) VALUES('spotify-kept', 'spotify:a1', '{}', 1);
            INSERT INTO settings(key, value) VALUES('spotify', '{"token":"t"}');
            INSERT INTO settings(key, value) VALUES('spotifySettings', '{"import":true}');
            INSERT INTO settings(key, value) VALUES('displaySeconds', '30');
            """);
        var folder = Path.Combine(lib.Data, "spotify", "soloist");
        Directory.CreateDirectory(folder);
        File.WriteAllText(Path.Combine(folder, "soloist"), "");

        await using (var s = await Session.Started(lib: lib))
        {
            Assert.Null(await s.Album("Gone"));
            Assert.NotNull(await s.Album("Album One"));
        }
        using var c = SqliteDump.Open(db);
        string[] Col(string sql) => SqliteDump.All(c, sql).Select(r => (string)r!.AsObject().First().Value!).ToArray();
        Assert.Empty(Col("SELECT key FROM albums WHERE key LIKE 'spotify:%'"));
        Assert.Empty(Col("SELECT key FROM favourites WHERE key LIKE 'spotify:%'"));
        Assert.Empty(Col("SELECT ns FROM cache WHERE ns LIKE 'spotify%'"));
        Assert.Empty(Col("SELECT key FROM settings WHERE key LIKE 'spotify%'"));
        Assert.Equal(["30"], Col("SELECT value FROM settings WHERE key = 'displaySeconds'"));
        Assert.False(Directory.Exists(Path.Combine(lib.Data, "spotify")));
    }

    [Test]
    public async Task IBroadcast_s_albums_and_all_it_kept_go_as_the_server_starts()
    {
        // Item 531: iBroadcast taken out. What it left: its albums (their tracks with them) and every row naming one by
        // its key, its marks (the albums kept, their covers decided, the uploads sent), its sign-in and settings, and the
        // covers and booklets kept of its uploaded albums in its folder.
        var lib = Fixtures.MakeLibrary();
        await (await Session.Started(lib: lib)).DisposeAsync();
        var db = Path.Combine(lib.Data, "musicd.db");
        SqliteDump.Exec(db, """
            INSERT INTO albums(key, title, artist, dir, added_at, updated_at) VALUES('ibroadcast:7', 'Uploaded', 'Someone', 'ibroadcast://album/7', 1, 2);
            INSERT INTO albums(key, title, artist, dir, added_at, updated_at) VALUES('ibroadcast:8', 'Uploaded Too', 'Someone', 'ibroadcast://album/8', 1, 2);
            INSERT INTO tracks(album_id, path, mtime, size, title) SELECT id, 'ibroadcast://track/70', 0, 1, 'T' FROM albums WHERE key = 'ibroadcast:7';
            INSERT INTO favourites(key, added_at) VALUES('ibroadcast:7', 1);
            INSERT INTO listen_later(key, added_at) VALUES('ibroadcast:7', 1);
            INSERT INTO album_edits(key, title, updated_at) VALUES('ibroadcast:7', 'Edited', 1);
            INSERT INTO album_matches(key, mbid, distance, status, checked_at) VALUES('ibroadcast:7', 'mb', 0.1, 'matched', 1);
            INSERT INTO album_merges(key, into_key, disc, made_at) VALUES('ibroadcast:8', 'ibroadcast:7', 2, 1);
            INSERT INTO album_ids(key, id) VALUES('ibroadcast:7', 99999);
            INSERT INTO cache(ns, key, value, ts) VALUES('ibroadcast-kept', 'ibroadcast:7', '{}', 1);
            INSERT INTO cache(ns, key, value, ts) VALUES('ibroadcast-art2', '7', '"folder"', 1);
            INSERT INTO cache(ns, key, value, ts) VALUES('ibroadcast-sent', '/music/a.flac', '{}', 1);
            INSERT INTO settings(key, value) VALUES('ibroadcast', '{"token":{"access":"a","refresh":"r"}}');
            INSERT INTO settings(key, value) VALUES('ibroadcastUpload', '{"on":true}');
            INSERT INTO settings(key, value) VALUES('displaySeconds', '30');
            """);
        foreach (var kept in new[] { Path.Combine("art", "7-folder.jpg"), Path.Combine("booklets", "7", "Booklet.pdf") })
        {
            var file = Path.Combine(lib.Data, "ibroadcast", kept);
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            File.WriteAllText(file, "");
        }

        await using (var s = await Session.Started(lib: lib))
        {
            Assert.Null(await s.Album("Uploaded"));
            Assert.NotNull(await s.Album("Album One"));
        }
        using var c = SqliteDump.Open(db);
        string[] Col(string sql) => SqliteDump.All(c, sql).Select(r => (string)r!.AsObject().First().Value!).ToArray();
        Assert.Empty(Col("SELECT key FROM albums WHERE key LIKE 'ibroadcast:%'"));
        Assert.Empty(Col("SELECT path FROM tracks WHERE path LIKE 'ibroadcast:%'"));
        foreach (var t in new[] { "favourites", "listen_later", "album_edits", "album_matches", "album_merges", "album_ids" })
            Assert.Empty(Col($"SELECT key FROM {t} WHERE key LIKE 'ibroadcast:%'"));
        Assert.Empty(Col("SELECT ns FROM cache WHERE ns LIKE 'ibroadcast%'"));
        Assert.Empty(Col("SELECT key FROM settings WHERE key LIKE 'ibroadcast%'"));
        Assert.Equal(["30"], Col("SELECT value FROM settings WHERE key = 'displaySeconds'"));
        Assert.False(Directory.Exists(Path.Combine(lib.Data, "ibroadcast")));
    }

    [Test]
    public async Task The_playlists_settings_and_the_albums_they_held_go_as_the_server_starts()
    {
        var lib = Fixtures.MakeLibrary();
        await (await Session.Started(lib: lib)).DisposeAsync();
        var db = Path.Combine(lib.Data, "musicd.db");
        SqliteDump.Exec(db, """
            INSERT INTO settings(key, value) VALUES('userPlaylists', '[{"id":"qobuz-pl-1","name":"Q","service":"qobuz"},{"id":"mine","name":"Mine"}]');
            INSERT INTO settings(key, value) VALUES('smartPlaylists', '[{"id":"s1","name":"Dyn","view":{}}]');
            INSERT INTO settings(key, value) VALUES('displaySeconds', '30');
            INSERT INTO cache(ns, key, value, ts) VALUES('qobuz-held', 'qobuz:1', '1', 1);
            INSERT INTO cache(ns, key, value, ts) VALUES('tidal-held', 'tidal:2', '1', 1);
            INSERT INTO cache(ns, key, value, ts) VALUES('qobuz-kept', 'qobuz:1', '{}', 1);
            """);
        await (await Session.Started(lib: lib)).DisposeAsync();
        using var c = SqliteDump.Open(db);
        string[] Col(string sql) => SqliteDump.All(c, sql).Select(r => (string)r!.AsObject().First().Value!).ToArray();
        Assert.Empty(Col("SELECT key FROM settings WHERE key IN ('userPlaylists', 'smartPlaylists')"));
        Assert.Empty(Col("SELECT ns FROM cache WHERE ns LIKE '%-held'"));
        Assert.Equal(["qobuz-kept"], Col("SELECT ns FROM cache WHERE ns LIKE 'qobuz%' OR ns LIKE 'tidal%'"));
        Assert.Equal(["30"], Col("SELECT value FROM settings WHERE key = 'displaySeconds'"));
    }
}
