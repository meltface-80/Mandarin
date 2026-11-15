// AutoCoverStore.cs — what the cover finder (AutoCovers.cs, item 409) has
// looked at, so it doesn't ask the catalogues again on every run: a table of
// its own beside the library's, made the first time something is kept (as
// Credits/CreditStore.cs makes its own) and read as empty until then.
//
//   album_auto_art  one row an album, by its identity (albums.key, as
//                   album_edits is keyed): its tracks as they were when it was
//                   looked at (Tracks), and what came of it:
//     found   a sure cover kept (album_edits.art, art_source "auto:…")
//     none    nothing sure: asked again after 60 days, or once its tracks change
//     own     a cover of its own (folder or tracks): looked at again once its tracks change
//     owner   a cover chosen or taken away by hand (Edit album): never touched again
//
// An album's key changes with its tags, so a retagged album is looked at
// afresh. All of it can be found again but the owner's word, which an edit
// says again.
using System.Globalization;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Extras;

internal static class AutoCoverStore
{
    private const string Table = """
CREATE TABLE IF NOT EXISTS album_auto_art (
  key     TEXT PRIMARY KEY,
  tracks  TEXT NOT NULL,
  status  TEXT NOT NULL,
  source  TEXT,
  ts      INTEGER NOT NULL
);
""";

    /* One album's row: its tracks when looked at, what came of it, and when. */
    public sealed record Row(string Tracks, string Status, string? Source, long Ts);

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private static SqliteConnection Writing()
    {
        var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = Table;
        cmd.ExecuteNonQuery();
        return c;
    }

    /* Every row, by album key; none while the table isn't there yet. */
    public static Dictionary<string, Row> All()
    {
        var rows = new Dictionary<string, Row>(StringComparer.Ordinal);
        using var c = Db.Open();
        using (var has = c.CreateCommand())
        {
            has.CommandText = "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'album_auto_art'";
            if (Convert.ToInt64(has.ExecuteScalar(), CultureInfo.InvariantCulture) == 0) return rows;
        }
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT key, tracks, status, source, ts FROM album_auto_art";
        using var r = cmd.ExecuteReader();
        while (r.Read()) rows[r.GetString(0)] = new Row(r.GetString(1), r.GetString(2), r.IsDBNull(3) ? null : r.GetString(3), r.GetInt64(4));
        return rows;
    }

    /* What came of looking at an album, kept. */
    public static void Put(string key, string tracks, string status, string? source = null)
    {
        using var c = Writing();
        using var cmd = c.CreateCommand();
        cmd.CommandText = @"INSERT INTO album_auto_art(key, tracks, status, source, ts) VALUES($k, $t, $s, $src, $ts)
                            ON CONFLICT(key) DO UPDATE SET tracks = excluded.tracks, status = excluded.status, source = excluded.source, ts = excluded.ts";
        cmd.Parameters.AddWithValue("$k", key);
        cmd.Parameters.AddWithValue("$t", tracks);
        cmd.Parameters.AddWithValue("$s", status);
        cmd.Parameters.AddWithValue("$src", (object?)source ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$ts", NowMs());
        cmd.ExecuteNonQuery();
    }

    /* A cover chosen or taken away by hand (Edit album): the album's cover is the owner's from now on. */
    public static void Owner(string key) => Put(key, "", "owner");

    /* Whether the owner has had the last word on this album's cover. */
    public static bool IsOwners(string key)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'album_auto_art'";
        if (cmd.ExecuteScalar() == null) return false;
        cmd.CommandText = "SELECT 1 FROM album_auto_art WHERE key = $k AND status = 'owner'";
        cmd.Parameters.AddWithValue("$k", key);
        return cmd.ExecuteScalar() != null;
    }

    /*
     * Each album's tracks as one short mark, by album id: how many, and the
     * newest and oldest file times. A track added, gone or retagged moves it.
     */
    public static Dictionary<long, string> Tracks()
    {
        var marks = new Dictionary<long, string>();
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT album_id, COUNT(*), MAX(mtime), MIN(mtime) FROM tracks GROUP BY album_id";
        using var r = cmd.ExecuteReader();
        while (r.Read())
            marks[r.GetInt64(0)] = string.Create(CultureInfo.InvariantCulture, $"{r.GetInt64(1)}:{(r.IsDBNull(2) ? 0 : r.GetInt64(2))}:{(r.IsDBNull(3) ? 0 : r.GetInt64(3))}");
        return marks;
    }
}
