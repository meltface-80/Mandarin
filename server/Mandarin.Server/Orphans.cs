// Orphans.cs — what gone albums and tracks left behind, taken away as the server starts (bug list item 179).
//
// Albums' and tracks' ids are given out again (INTEGER PRIMARY KEY, no AUTOINCREMENT), so a row left under a gone
// one's id is the next one's: its tracks, tags, loudness (counted as measured, never measured), tag checks, credits
// (looked up already). Deletes made with foreign keys off (a gone service's albums, until this item) left tracks and
// their rows; credits never went with their album. Once, as the server starts (settings.orphans_v): every such row
// goes. From then on nothing is left: albums go with foreign keys on, and their credits by CreditStore's trigger,
// made here for a database whose credits' tables were made before it.
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static class Orphans
{
    private const string Done = "orphans_v";

    // Each table, and what in it names a track or an album no longer there (tracks first: theirs go after them).
    private static readonly (string Table, string Where)[] Left =
    [
        ("tracks", "album_id NOT IN (SELECT id FROM albums)"),
        ("track_tags", "track_id NOT IN (SELECT id FROM tracks)"),
        ("track_loudness", "track_id NOT IN (SELECT id FROM tracks)"),
        ("tag_checks", "track_id NOT IN (SELECT id FROM tracks)"),
        ("album_credits", "album_id NOT IN (SELECT id FROM albums)"),
        ("album_credit_state", "album_id NOT IN (SELECT id FROM albums)"),
    ];

    /// <summary>
    /// The credits' trigger made where their tables are, then, the first time only, every row under a gone album's
    /// or track's id deleted. A database that can't be read or written is left as it is, and said.
    /// </summary>
    public static void Sweep(Action<string> log)
    {
        try
        {
            using var c = Db.Open();
            if (!Has(c, "albums") || !Has(c, "settings")) return;
            Credits.CreditStore.FollowAlbums(c);
            if (Library.Rows(c, "SELECT 1 FROM settings WHERE key = $1", Done).Count > 0) return;
            using var tx = c.BeginTransaction();
            var n = 0;
            foreach (var (table, where) in Left)
                if (Has(c, table)) n += Run(c, $"DELETE FROM {table} WHERE {where}");
            Run(c, $"INSERT INTO settings(key, value) VALUES('{Done}', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
            tx.Commit();
            if (n > 0) log($"[library] {n} row(s) left by albums and tracks no longer here taken away");
        }
        catch (SqliteException e) { log($"[library] what gone albums left: {e.Message}"); }
    }

    private static bool Has(SqliteConnection c, string table) =>
        Library.Rows(c, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $1", table).Count > 0;

    private static int Run(SqliteConnection c, string sql)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        return cmd.ExecuteNonQuery();
    }
}
