// Leftovers.cs — what a service Mandarin no longer has left behind, taken away as the server starts (bug list item
// 152): its albums (with their edits, hearts and Listen later; plays stay, as text, as Clean up leaves them), its
// marks, its settings (its sign-in among them), its playlists, and its folder in the data folder. Once done, it finds
// nothing.
using Microsoft.Data.Sqlite;
using System.Text.Json.Nodes;

namespace Mandarin.Server.Services;

internal static class Leftovers
{
    private static readonly string[] Gone = ["spotify"];

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
        using var tx = c.BeginTransaction();
        var albums = 0;
        if (Has(c, "albums"))
        {
            foreach (var t in new[] { "album_edits", "favourites", "listen_later", "track_edits" })
                if (Has(c, t)) Run(c, $"DELETE FROM {t} WHERE key LIKE $v", id + ":%");
            albums = Run(c, "DELETE FROM albums WHERE key LIKE $v", id + ":%");
        }
        var marks = Has(c, "cache") ? Run(c, "DELETE FROM cache WHERE ns LIKE $v", id + "%") : 0;
        if (Has(c, "settings"))
        {
            var settings = Run(c, "DELETE FROM settings WHERE key LIKE $v", id + "%");
            var playlists = 0;
            if (Db.Setting(c, "userPlaylists") is JsonArray all)
            {
                foreach (var p in all.Where(p => p is JsonObject o && o["service"] is JsonValue v && v.TryGetValue<string>(out var s) && s == id).ToList()) { all.Remove(p); playlists++; }
                if (playlists > 0) Run(c, "UPDATE settings SET value = $v WHERE key = 'userPlaylists'", all.ToJsonString());
            }
            if (albums + marks + settings + playlists > 0)
                log($"[leftovers] {id}: {albums} album(s), {playlists} playlist(s), {settings} setting(s) and {marks} mark(s) removed");
        }
        tx.Commit();
        return albums;
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
