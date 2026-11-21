namespace Mandarin.Tests;

/// <summary>
/// The upgrade that tells albums apart by their folder (album_key_v 2) leaves a streamed album's key as its service
/// wrote it (item 499): Spotify's import, quicker than a new library's first scan, had its albums renamed with the
/// folder they don't have, then added them again over their own tracks ("UNIQUE constraint failed: tracks.path").
/// </summary>
public sealed class StreamedKeysTests
{
    [Test]
    public async Task A_streamed_album_keeps_its_key_through_the_folder_upgrade_the_library_s_own_gain_theirs()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        await using var s = await LibraryServer.Start(lib);
        var db = s.Server;
        foreach (var (svc, id) in new[] { ("spotify", "a0"), ("tidal", "77"), ("qobuz", "q1") })
        {
            db.Exec("INSERT INTO albums(key, title, artist, dir, track_count, added_at, updated_at) VALUES($1, 'Streamed', 'Someone', $2, 1, 1, 2)", svc + ":" + id, svc + "://album/" + id);
            db.Exec("INSERT INTO tracks(album_id, path, mtime, size, title) VALUES((SELECT id FROM albums WHERE key = $1), $2, 0, 0, 'One')", svc + ":" + id, svc + "://track/" + id + "t1");
        }
        // As a library from before the upgrade: the library's own keys without their folder, the upgrade not made.
        foreach (var a in db.Rows("SELECT id, key FROM albums WHERE dir NOT LIKE '%://%'"))
            db.Exec("UPDATE albums SET key = $1 WHERE id = $2", string.Join('\u0001', ((string)a["key"]!).Split('\u0001').Take(2)), a["id"]);
        db.SetSetting("album_key_v", 1);

        await s.Restart();
        Assert.Equal(2, db.Setting("album_key_v")?.GetValue<int>());
        Assert.Equal(["qobuz:q1", "spotify:a0", "tidal:77"], db.Rows("SELECT key FROM albums WHERE dir LIKE '%://%' ORDER BY key").Select(r => (string)r["key"]!));
        Assert.All(db.Rows("SELECT key FROM albums WHERE dir NOT LIKE '%://%'"), r => Assert.Equal(3, ((string)r["key"]!).Split('\u0001').Length));
    }
}
