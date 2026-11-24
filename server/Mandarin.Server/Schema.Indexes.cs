// Schema.Indexes.cs — the indexes this server added beyond the Node server's
// tables (Schema.cs keeps those as db.js wrote them), made with them, so a
// database from before gets them as it opens.
//
//   - plays_album_ts: the play history by album and time, the whole of what
//     Home's Not played, Most played and the radio ask of it, read from the
//     index alone. Through plays(album_id) SQLite read every play's row for
//     them: 40–60 ms each on 40,000 plays, 3–13 with this (under a MB).
//   - album_splits and album_joins (bug list item 424, Scan/Scanner.Split.cs): Edit album's hand splits (each
//     track's part, by its path) and Join back's joins (a folder's tracks the album of that key), kept to by every
//     scan, kept in backups and carried over with what you did.
//   - album_merges (bug list item 512, AlbumMerge.cs): the albums merged into one from the library's selection menu,
//     each album's key, the one it is in, the disc it starts after; the one's own row its title.
namespace Mandarin.Server;

internal static partial class Schema
{
    private const string Indexes = """

CREATE INDEX IF NOT EXISTS plays_album_ts ON plays(album_id, ts);
""";

    private const string SplitTables = """

CREATE TABLE IF NOT EXISTS album_splits (path TEXT PRIMARY KEY, part TEXT NOT NULL, made_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS album_joins (dir TEXT PRIMARY KEY, key TEXT NOT NULL, made_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS album_merges (key TEXT PRIMARY KEY, into_key TEXT NOT NULL, disc INTEGER NOT NULL, title TEXT, dirs TEXT, made_at INTEGER NOT NULL);
""";
}
