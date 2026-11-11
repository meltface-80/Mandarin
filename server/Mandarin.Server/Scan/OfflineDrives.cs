// Scan/OfflineDrives.cs — drives that are not there right now are not music that
// is gone. A drive mounted anywhere under a watched folder is remembered
// (the setting musicMounts); while one remembered is not mounted (its folder
// empty: the machine started before it, or it was unplugged), the scan keeps
// the tracks under it as they were, as it keeps a watched folder that is
// missing. A folder that is no longer there at all was taken away on purpose:
// it is forgotten, and its tracks go as any others do.
//
// The rest of "not there now": the watched folders not read (the setting not
// to be read: no track is in no watched folder), and loudness that couldn't
// be measured because the file wasn't there, measured again at the next scan.
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Scan;

internal static class OfflineDrives
{
    /// <summary>What a loudness failure says when the file wasn't there: measured again at the next scan.</summary>
    public const string Offline = "the file wasn't there";

    /// <summary>
    /// The drives remembered under these watched folders that are not mounted now (the scan keeps their tracks), the
    /// ones mounted now remembered with them; loudness the file wasn't there for asked for again.
    /// </summary>
    public static HashSet<string> Now(SqliteConnection db, IReadOnlyList<string> roots, string mountinfo)
    {
        var mounted = Mounted(mountinfo);
        var kept = new SortedSet<string>(StringComparer.Ordinal);
        if (Db.Setting(db, "musicMounts") is JsonArray a)
            foreach (var n in a) if (n is JsonValue v && v.TryGetValue<string>(out var s) && s.Length > 0) kept.Add(s);
        foreach (var m in mounted) if (roots.Any(r => m != r && NodePath.IsInside(m, r))) kept.Add(m);
        // Taken away on purpose: no longer a folder at all, or no longer under a watched one.
        kept.RemoveWhere(m => !PosixFs.Exists(m) || !roots.Any(r => m != r && NodePath.IsInside(m, r)));
        Put(db, "musicMounts", new JsonArray([.. kept.Select(m => (JsonNode)m)]));
        using (var again = db.CreateCommand())
        {
            again.CommandText = "DELETE FROM track_loudness WHERE error = $e";
            again.Parameters.AddWithValue("$e", Offline);
            again.ExecuteNonQuery();
        }
        return [.. kept.Where(m => !mounted.Contains(m))];
    }

    /// <summary>The same, from the machine's own mount table.</summary>
    public static HashSet<string> Now(SqliteConnection db, IReadOnlyList<string> roots)
    {
        string text;
        try { text = File.ReadAllText("/proc/self/mountinfo"); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { text = ""; }
        return Now(db, roots, text);
    }

    /// <summary>The drive not mounted now that `path` is on, if any (the innermost).</summary>
    public static string? Above(string path, HashSet<string> offline) =>
        offline.Where(m => NodePath.IsInside(path, m) && path != m).OrderByDescending(m => m.Length).FirstOrDefault();

    /// <summary>
    /// Whether the watched folders were read as chosen: none chosen, or a list. False where the setting couldn't be
    /// read; the folders then are the music folder alone, and a track in no watched folder is not taken for one let go.
    /// </summary>
    public static bool FoldersRead(SqliteConnection db)
    {
        try { return SettingIsJson(db, "music_folders") && Db.Setting(db, "music_folders") is null or JsonArray; }
        catch (SqliteException) { return false; }
    }

    /// <summary>The loudness failure to keep for `file`: what went wrong, or that it wasn't there (measured again later).</summary>
    public static string Failure(string file, string message) =>
        PosixFs.Exists(file) ? (message.Length > 200 ? message[..200] : message) : Offline;

    /* The points something real is mounted on (an automount stand-in with nothing on it is not). */
    private static HashSet<string> Mounted(string mountinfo)
    {
        var points = new HashSet<string>(StringComparer.Ordinal);
        foreach (var line in mountinfo.Split('\n'))
        {
            var halves = line.Split(" - ");
            if (halves.Length < 2) continue;
            var a = halves[0].Split(' ');
            var type = halves[1].Split(' ')[0];
            if (a.Length < 5 || type == "autofs") continue;
            points.Add(Mounts.Unescape(a[4]));
        }
        return points;
    }

    /* A setting that is there is JSON (Db.Setting reads anything else as not there). */
    private static bool SettingIsJson(SqliteConnection db, string key)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT value FROM settings WHERE key = $k";
        cmd.Parameters.AddWithValue("$k", key);
        if (cmd.ExecuteScalar() is not string v) return true;
        try { JsonNode.Parse(v); return true; } catch (System.Text.Json.JsonException) { return false; }
    }

    private static void Put(SqliteConnection db, string key, JsonNode value)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = "INSERT OR REPLACE INTO settings(key, value) VALUES($k, $v)";
        cmd.Parameters.AddWithValue("$k", key);
        cmd.Parameters.AddWithValue("$v", value.ToJsonString());
        cmd.ExecuteNonQuery();
    }
}
