// Leftovers.cs — what the playlists left when they were taken out: the playlists made here and imported from Qobuz and
// Tidal (the setting userPlaylists), the dynamic playlists (smartPlaylists), and the marks that kept a service's album
// in the library because one of its playlists named it (the cache, ns <service>-held). Taken away at every start, so a
// whole database put back from an older backup loses them too; once done, it finds nothing.
//
// What a service Mandarin no longer had left behind was taken away here too (item 152, Spotify's); Spotify is back
// (item 497) and no service is gone, so that went.
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Services;

internal static class Leftovers
{
    private static readonly string[] GoneSettings = ["userPlaylists", "smartPlaylists"];
    private static readonly string[] GoneMarks = ["qobuz-held", "tidal-held"];

    /* The playlists' settings and the services' held marks deleted; a database that can't be read or written is left as it is, and said. */
    public static void RemovePlaylists(Action<string> log)
    {
        try
        {
            using var c = Db.Open();
            using var tx = c.BeginTransaction();
            int settings = 0, marks = 0;
            if (Has(c, "settings")) foreach (var k in GoneSettings) settings += Run(c, "DELETE FROM settings WHERE key = $v", k);
            if (Has(c, "cache")) foreach (var ns in GoneMarks) marks += Run(c, "DELETE FROM cache WHERE ns = $v", ns);
            tx.Commit();
            if (settings + marks > 0) log($"[leftovers] playlists: {settings} setting(s) and {marks} mark(s) removed");
        }
        catch (SqliteException e) { log($"[leftovers] playlists: {e.Message}"); }
    }

    private static bool Has(SqliteConnection c, string table) =>
        Library.Rows(c, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $1", table).Count > 0;

    private static int Run(SqliteConnection c, string sql, string value)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("$v", value);
        return cmd.ExecuteNonQuery();
    }
}
