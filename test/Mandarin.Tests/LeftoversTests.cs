namespace Mandarin.Tests;

/// <summary>
/// What a service Mandarin no longer has left behind went as the server started (bug list item 152, Spotify's); since
/// Spotify is back (item 497) its albums, marks, settings and folder stay. And what the playlists left when they were
/// taken out: their settings and the albums the services' playlists held.
/// </summary>
public sealed class LeftoversTests
{
    [Test]
    public async Task Spotify_s_albums_settings_and_folder_stay_as_the_server_starts_now_it_is_back()
    {
        var lib = Fixtures.MakeLibrary();
        await (await Session.Started(lib: lib)).DisposeAsync();
        var db = Path.Combine(lib.Data, "musicd.db");
        SqliteDump.Exec(db, """
            INSERT INTO albums(id, key, title, artist, dir, added_at, updated_at) VALUES(7000, 'spotify:a1', 'Kept', 'Someone', 'spotify://album/a1', 1, 2);
            INSERT INTO tracks(id, album_id, path, mtime, size, title) VALUES(7001, 7000, 'spotify://track/t1', 0, 0, 'Kept 1');
            INSERT INTO favourites(key, added_at) VALUES('spotify:a1', 1);
            INSERT INTO cache(ns, key, value, ts) VALUES('spotify-kept', 'spotify:a1', '{}', 1);
            INSERT INTO settings(key, value) VALUES('spotify', '{"token":"t"}');
            INSERT INTO settings(key, value) VALUES('spotifySettings', '{"import":true}');
            INSERT INTO settings(key, value) VALUES('displaySeconds', '30');
            """);
        var folder = Path.Combine(lib.Data, "spotify", "soloist");
        Directory.CreateDirectory(folder);
        File.WriteAllText(Path.Combine(folder, "soloist"), "");

        await using (var s = await Session.Started(lib: lib)) Assert.NotNull(await s.Album("Album One"));
        using var c = SqliteDump.Open(db);
        string[] Col(string sql) => SqliteDump.All(c, sql).Select(r => (string)r!.AsObject().First().Value!).ToArray();
        Assert.Equal(["spotify:a1"], Col("SELECT key FROM albums WHERE key LIKE 'spotify:%'"));
        Assert.Equal(["spotify:a1"], Col("SELECT key FROM favourites WHERE key LIKE 'spotify:%'"));
        Assert.Equal(["spotify-kept"], Col("SELECT ns FROM cache WHERE ns LIKE 'spotify%'"));
        Assert.Equal(["spotify", "spotifySettings"], Col("SELECT key FROM settings WHERE key LIKE 'spotify%' ORDER BY key"));
        Assert.Equal(["30"], Col("SELECT value FROM settings WHERE key = 'displaySeconds'"));
        Assert.True(File.Exists(Path.Combine(folder, "soloist")));
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
