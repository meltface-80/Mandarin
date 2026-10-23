namespace Mandarin.Tests;

/// <summary>
/// What a service Mandarin no longer has left behind goes as the server starts (bug list item 152): its albums with
/// their hearts, its marks, its settings, its playlists and its folder; the library's own albums, playlists and settings stay.
/// </summary>
public sealed class LeftoversTests
{
    [Test]
    public async Task A_gone_service_s_albums_playlists_settings_and_folder_go_as_the_server_starts()
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
            INSERT INTO settings(key, value) VALUES('userPlaylists', '[{"id":"spotify-pl-1","name":"Theirs","service":"spotify"},{"id":"qobuz-pl-1","name":"Q","service":"qobuz"},{"id":"mine","name":"Mine"}]');
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
        Assert.DoesNotContain("spotify", Col("SELECT value FROM settings WHERE key = 'userPlaylists'")[0], StringComparison.Ordinal);
        Assert.Contains("\"mine\"", Col("SELECT value FROM settings WHERE key = 'userPlaylists'")[0], StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(lib.Data, "spotify")));
    }
}
