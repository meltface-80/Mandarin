// Schema.Indexes.cs — the indexes this server added beyond the Node server's
// tables (Schema.cs keeps those as db.js wrote them), made with them, so a
// database from before gets them as it opens.
//
//   - plays_album_ts: the play history by album and time, the whole of what
//     Home's Not played, Most played and the radio ask of it, read from the
//     index alone. Through plays(album_id) SQLite read every play's row for
//     them: 40–60 ms each on 40,000 plays, 3–13 with this (under a MB).
namespace Mandarin.Server;

internal static partial class Schema
{
    private const string Indexes = """

CREATE INDEX IF NOT EXISTS plays_album_ts ON plays(album_id, ts);
""";
}
