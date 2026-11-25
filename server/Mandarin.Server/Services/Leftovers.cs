// Leftovers.cs — what a service Mandarin no longer has left behind, taken away as the server starts (bug list items
// 152 and 525, Spotify's, Spotify Connect's Soloist and its downloads in the folder among them; item 531, iBroadcast's,
// the covers and booklets kept of its uploaded albums in its folder): its albums (with their edits, hearts, Listen
// later, matches, merges, covers found and kept ids; plays stay, as text, as Clean up leaves them), its
// marks, its settings (its sign-in among them), and its folder in the data folder. Once done, it finds nothing. Its
// albums are deleted with foreign keys on, as Clean up deletes them (Rows.cs OpenRows): their tracks go with them, and
// the tracks' tags, loudness and tag checks with those (item 179; with them off, a Spotify track stayed under its
// album's id, and the next album given that id had it).
//
// And what the playlists left when they were taken out: the playlists made here and imported from Qobuz and Tidal
// (the setting userPlaylists), the dynamic playlists (smartPlaylists), and the marks that kept a service's album in
// the library because one of its playlists named it (the cache, ns <service>-held). Taken away at every start, so a
// whole database put back from an older backup loses them too; once done, it finds nothing.
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Services;

internal static class Leftovers
{
    private static readonly string[] Gone = ["spotify", "ibroadcast"];

    /* Each gone service's leftovers taken away from the database and [dataDir]; true when any albums went. */
    public static bool Remove(string dataDir, Action<string> log)
    {
        var albums = 0;
        foreach (var id in Gone)
        {
            try { albums += FromDatabase(id, log); }
            catch (Exception e) when (e is SqliteException or InvalidOperationException) { log($"[leftovers] {id}: {e.Message}"); }
            var dir = Path.Combine(dataDir, id);
            try { if (Directory.Exists(dir)) { Directory.Delete(dir, recursive: true); log($"[leftovers] {id}: its folder removed"); } }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { log($"[leftovers] {id}: its folder: {e.Message}"); }
        }
        return albums > 0;
    }

    private static int FromDatabase(string id, Action<string> log)
    {
        using var c = Db.Open();
        using (var fk = c.CreateCommand()) { fk.CommandText = "PRAGMA foreign_keys = ON"; fk.ExecuteNonQuery(); }
        using var tx = c.BeginTransaction();
        var albums = 0;
        if (Has(c, "albums"))
        {
            foreach (var t in Keyed)
                if (Has(c, t)) Run(c, $"DELETE FROM {t} WHERE key LIKE $v", id + ":%");
            if (Has(c, "album_merges")) Run(c, "DELETE FROM album_merges WHERE into_key LIKE $v", id + ":%");
            albums = Run(c, "DELETE FROM albums WHERE key LIKE $v", id + ":%");
        }
        var marks = Has(c, "cache") ? Run(c, "DELETE FROM cache WHERE ns LIKE $v", id + "%") : 0;
        if (Has(c, "settings"))
        {
            var settings = Run(c, "DELETE FROM settings WHERE key LIKE $v", id + "%");
            if (albums + marks + settings > 0)
                log($"[leftovers] {id}: {albums} album(s), {settings} setting(s) and {marks} mark(s) removed");
        }
        tx.Commit();
        return albums;
    }

    // The tables that name an album by its key: a gone service's rows in each go with its albums.
    private static readonly string[] Keyed = ["album_edits", "favourites", "listen_later", "track_edits", "album_matches", "album_merges", "album_auto_art", "album_ids", "album_declines"];

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
