// Scan/RestoredAway.cs — the music folders of a backup restored here that aren't
// on this computer (bug list item 410). A restore keeps this computer's music
// folders when the backup's aren't here (Admin/Backup.Folders.cs) and names the
// backup's in the setting restoredAway. The restored library's tracks still at
// those paths are not tracks "in no watched folder" (taken away in Settings):
// the scan keeps them as a missing folder's are, while it finds the same files
// here by their size, modification time and name (Scanner.cs, Relocate) and
// moves each, its album, plays and edits with it. A folder none of whose
// tracks is left is forgotten; one let go from the notice (Forget) takes its
// tracks with it, as a missing music folder's are.
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Scan;

/// <summary>The backup's music folders that weren't on this computer, their tracks kept until found here.</summary>
internal static class RestoredAway
{
    /// <summary>The setting that names them: a JSON list of folders.</summary>
    public const string Key = "restoredAway";

    /// <summary>The folders named, as the setting holds them (none when it holds no list).</summary>
    public static List<string> Named(SqliteConnection db)
    {
        JsonNode? v;
        try { v = Db.Setting(db, Key); }
        catch (SqliteException) { return []; }
        return v is JsonArray a ? [.. a.OfType<JsonValue>().Select(x => x.TryGetValue<string>(out var s) ? s : "").Where(s => s.Length > 0).Distinct(StringComparer.Ordinal)] : [];
    }

    /// <summary>
    /// The folders still holding tracks of the library (the scan keeps them); those holding none forgotten, and the
    /// setting with them once none is left.
    /// </summary>
    public static List<string> Now(SqliteConnection db)
    {
        var named = Named(db);
        if (named.Count == 0) return named;
        var left = named.Where(d => Holds(db, d)).ToList();
        if (left.Count != named.Count) Put(db, left);
        return left;
    }

    /// <summary>The folder of <paramref name="away"/> that <paramref name="path"/> is in (the innermost), or null.</summary>
    public static string? Holding(string path, IReadOnlyList<string> away) =>
        away.Where(d => NodePath.IsInside(path, d)).OrderByDescending(d => d.Length).FirstOrDefault();

    /// <summary>The setting written: <paramref name="folders"/>, or taken away when there are none.</summary>
    public static void Put(SqliteConnection db, IReadOnlyCollection<string> folders)
    {
        using var cmd = db.CreateCommand();
        if (folders.Count == 0)
        {
            cmd.CommandText = "DELETE FROM settings WHERE key = $k";
            cmd.Parameters.AddWithValue("$k", Key);
        }
        else
        {
            cmd.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
            cmd.Parameters.AddWithValue("$k", Key);
            cmd.Parameters.AddWithValue("$v", new JsonArray([.. folders.Select(f => (JsonNode)f)]).ToJsonString());
        }
        cmd.ExecuteNonQuery();
    }

    // Whether a track's path is in the folder: a range of the path index, the folder's own "/" to the next character.
    private static bool Holds(SqliteConnection db, string dir)
    {
        var from = dir.EndsWith('/') ? dir : dir + "/";
        using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT 1 FROM tracks WHERE path >= $a AND path < $b LIMIT 1";
        cmd.Parameters.AddWithValue("$a", from);
        cmd.Parameters.AddWithValue("$b", from[..^1] + "0");
        return cmd.ExecuteScalar() != null;
    }
}
