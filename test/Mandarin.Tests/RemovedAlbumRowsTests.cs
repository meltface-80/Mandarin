using Microsoft.Data.Sqlite;

namespace Mandarin.Tests;

/// <summary>
/// What an album or a track leaves behind when it goes (bug list item 179). Albums' ids are given out again
/// (INTEGER PRIMARY KEY, no AUTOINCREMENT): rows left under a gone album's id would be a new album's. A gone
/// service's albums take their tracks with them, and the tracks theirs (tags, loudness, tag checks); any album
/// that goes takes its credits; and what was left before, once, as the server starts.
/// </summary>
public sealed class RemovedAlbumRowsTests
{
    // The credits' tables as Credits/CreditStore.cs makes them (made the first time something is kept).
    private const string CreditTables = """
        CREATE TABLE IF NOT EXISTS album_credits (album_id INTEGER NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL, mbid TEXT,
          roles TEXT NOT NULL, tracks TEXT NOT NULL, source TEXT NOT NULL, PRIMARY KEY (album_id, key));
        CREATE TABLE IF NOT EXISTS album_credit_state (album_id INTEGER PRIMARY KEY, release TEXT, status TEXT NOT NULL, ts INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS artist_info (key TEXT PRIMARY KEY, name TEXT NOT NULL, mbid TEXT, type TEXT, about TEXT NOT NULL DEFAULT '{}',
          photo TEXT, photo_source TEXT, fetched INTEGER NOT NULL);
        """;

    // A track's own rows, and an album's credits, under the ids given.
    private static string Rows(long album, long track) => $$"""
        INSERT INTO track_tags(track_id, tags) VALUES({{track}}, '{"TITLE":["Gone"]}');
        INSERT INTO track_loudness(track_id, lufs, peak, measured_at) VALUES({{track}}, -14, 0.9, 1);
        INSERT INTO tag_checks(track_id, outcome, checked_at) VALUES({{track}}, 'same', 1);
        INSERT OR REPLACE INTO album_credits(album_id, key, name, roles, tracks, source) VALUES({{album}}, 'someone', 'Someone', '["producer"]', '[1]', 'tags');
        INSERT OR REPLACE INTO album_credit_state(album_id, release, status, ts) VALUES({{album}}, NULL, 'tags', 1);
        """;

    private static long Count(string db, string sql)
    {
        using var c = SqliteDump.Open(db);
        using var q = c.CreateCommand();
        q.CommandText = sql;
        return (long)q.ExecuteScalar()!;
    }

    private static long Left(string db, long album, long track) =>
        Count(db, $"SELECT (SELECT count(*) FROM tracks WHERE id = {track} OR album_id = {album}) + (SELECT count(*) FROM track_tags WHERE track_id = {track})" +
                  $" + (SELECT count(*) FROM track_loudness WHERE track_id = {track}) + (SELECT count(*) FROM tag_checks WHERE track_id = {track})" +
                  $" + (SELECT count(*) FROM album_credits WHERE album_id = {album}) + (SELECT count(*) FROM album_credit_state WHERE album_id = {album})");

    [Test]
    public async Task A_gone_service_s_album_takes_its_tracks_their_rows_and_its_credits_with_it()
    {
        var lib = Fixtures.MakeLibrary();
        await (await Session.Started(lib: lib)).DisposeAsync();
        var db = Path.Combine(lib.Data, "musicd.db");
        SqliteDump.Exec(db, CreditTables + """
            PRAGMA foreign_keys = OFF;
            INSERT INTO albums(id, key, title, artist, dir, added_at, updated_at) VALUES(7000, 'spotify:a1', 'Gone', 'Someone', 'spotify://album/a1', 1, 2);
            INSERT INTO tracks(id, album_id, path, mtime, size, title) VALUES(7001, 7000, 'spotify://track/t1', 0, 0, 'Gone 1');
            """ + Rows(7000, 7001));
        Assert.Equal(6, Left(db, 7000, 7001));

        await (await Session.Started(lib: lib)).DisposeAsync();
        Assert.Equal(0, Count(db, "SELECT count(*) FROM albums WHERE key LIKE 'spotify:%'"));
        Assert.Equal(0, Left(db, 7000, 7001));
        Assert.Equal(0, Count(db, "SELECT count(*) FROM tracks WHERE album_id NOT IN (SELECT id FROM albums)"));
    }

    [Test]
    public async Task An_album_that_leaves_the_library_takes_its_credits_with_it()
    {
        var lib = Fixtures.MakeLibrary();
        await (await Session.Started(lib: lib)).DisposeAsync();
        var db = Path.Combine(lib.Data, "musicd.db");
        var album = Count(db, "SELECT id FROM albums WHERE title = 'Album One'");
        var other = Count(db, "SELECT id FROM albums WHERE title = 'Hi Res'");
        SqliteDump.Exec(db, CreditTables + $"""
            INSERT INTO album_credits(album_id, key, name, roles, tracks, source) VALUES({album}, 'someone', 'Someone', '["producer"]', '[1]', 'tags');
            INSERT INTO album_credit_state(album_id, release, status, ts) VALUES({album}, NULL, 'tags', 1);
            INSERT INTO album_credits(album_id, key, name, roles, tracks, source) VALUES({other}, 'someone', 'Someone', '["producer"]', '[1]', 'tags');
            INSERT INTO album_credit_state(album_id, release, status, ts) VALUES({other}, NULL, 'tags', 1);
            """);

        await using (var s = await Session.Started(lib: lib))
        {
            // Its folder gone: kept as missing until let go, then the album goes.
            var gone = Path.Combine(lib.Music, "Artist A");
            Directory.Delete(gone, true);
            Assert.Equal(200, (await s.Api("library/rescan", new { force = true })).Status);
            await Session.Until(async () => (await s.Api("status")).Json?["scan"]?["running"]?.GetValue<bool>() != true, 30000, "the scan");
            Assert.Equal(200, (await s.Api("library/forget-folder", new { dir = gone })).Status);
            Assert.Null(await s.Album("Album One"));
        }
        Assert.Equal(0, Count(db, $"SELECT count(*) FROM albums WHERE id = {album}"));
        Assert.Equal(0, Count(db, $"SELECT (SELECT count(*) FROM album_credits WHERE album_id = {album}) + (SELECT count(*) FROM album_credit_state WHERE album_id = {album})"));
        Assert.True(Count(db, $"SELECT (SELECT count(*) FROM album_credits WHERE album_id = {other}) + (SELECT count(*) FROM album_credit_state WHERE album_id = {other})") >= 2,
            "the albums still here keep theirs");
    }

    [Test]
    public async Task What_gone_albums_and_tracks_left_before_is_taken_away_once_as_the_server_starts()
    {
        var lib = Fixtures.MakeLibrary();
        await (await Session.Started(lib: lib)).DisposeAsync();
        var db = Path.Combine(lib.Data, "musicd.db");
        // As a server before this one left them: a track under an album no longer there, and rows under a track and an album no longer there.
        SqliteDump.Exec(db, CreditTables + """
            PRAGMA foreign_keys = OFF;
            DELETE FROM settings WHERE key = 'orphans_v';
            INSERT INTO tracks(id, album_id, path, mtime, size, title) VALUES(8001, 8000, 'spotify://track/t2', 0, 0, 'Left');
            """ + Rows(8000, 8001) + Rows(8100, 8101));
        var kept = Count(db, "SELECT count(*) FROM tracks");
        Assert.Equal(6, Left(db, 8000, 8001));

        await (await Session.Started(lib: lib)).DisposeAsync();
        Assert.Equal(0, Left(db, 8000, 8001));
        Assert.Equal(0, Left(db, 8100, 8101));
        Assert.Equal(kept - 1, Count(db, "SELECT count(*) FROM tracks"));
        Assert.Equal(0, Count(db, "SELECT count(*) FROM track_tags WHERE track_id NOT IN (SELECT id FROM tracks)"));
        Assert.Equal(1, Count(db, "SELECT count(*) FROM settings WHERE key = 'orphans_v'"));
    }
}
