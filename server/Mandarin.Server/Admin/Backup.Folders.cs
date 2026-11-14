// Backup.Folders.cs — a restore keeps this computer's music folders when the
// backup's aren't here (bug list item 410). A backup made on another install
// carries that install's music folders (the setting music_folders, with the
// settings part or in the whole database); restored as they are on a computer
// where none of them is, every scan said they weren't found, every cover went
// grey and the library's albums pointed nowhere. So once restored, the backup's
// folders are compared with this computer's: those of the backup's that are
// here are kept, with this computer's own; the rest are named in the setting
// restoredAway (Scan/RestoredAway.cs), whose tracks the scan keeps, missing,
// while it finds the same files here (same size, modification time and name)
// and moves each to its new place, its album, plays and edits with it. None of
// the backup's here: this computer's folders kept as they were set. What was
// decided is said in the log and in the restore's answer, for the page.
using System.Text.Json.Nodes;
using Mandarin.Server.Scan;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Admin;

internal static partial class Backup
{
    /// <summary>
    /// After a restore wrote <paramref name="c"/>'s music folders: this computer's (<paramref name="here"/>, as the
    /// scan reads them, and <paramref name="hereSetting"/>, the setting as it was, null for none chosen) kept beside
    /// those of the backup's that are here, the backup's that aren't named as away. What was decided, said; null when
    /// every folder of the backup's is here or is this computer's own (nothing changed).
    /// </summary>
    public static string? KeepFolders(SqliteConnection c, IReadOnlyList<string> here, string? hereSetting, Action<string> log)
    {
        var theirs = FoldersOf(c);
        if (theirs.Count == 0) return null;
        var mine = here.Select(h => NodePath.Resolve(h)).ToList();
        var there = theirs.Where(Directory.Exists).ToList();
        var away = theirs.Where(t => !Directory.Exists(t) && !mine.Contains(t)).ToList();
        if (away.Count == 0) return null;
        string said;
        if (there.Count == 0)
        {
            PutFolders(c, hereSetting);
            said = $"The backup's music folders ({string.Join(", ", away)}) aren't on this computer: this one's ({string.Join(", ", mine)}) kept.";
        }
        else
        {
            var kept = there.Concat(mine).Distinct(StringComparer.Ordinal).ToList();
            PutFolders(c, new JsonArray([.. kept.Select(k => (JsonNode)k)]).ToJsonString());
            said = $"Of the backup's music folders, {string.Join(", ", away)} {(away.Count == 1 ? "isn't" : "aren't")} on this computer: {string.Join(", ", kept)} kept.";
        }
        said += " Its albums are matched to the same files here by the next scan.";
        RestoredAway.Put(c, [.. RestoredAway.Named(c).Concat(away).Distinct(StringComparer.Ordinal)]);
        log("[backup] " + said);
        return said;
    }

    /// <summary>The music folders setting as it is in <paramref name="c"/>: its JSON, null when none is chosen.</summary>
    public static string? FoldersSetting(SqliteConnection c)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT value FROM settings WHERE key = 'music_folders'";
        return cmd.ExecuteScalar() as string;
    }

    /// <summary>The same in a database file (a restore's, staged to be swapped in): <see cref="KeepFolders(SqliteConnection, IReadOnlyList{string}, string?, Action{string})"/>.</summary>
    public static string? KeepFolders(string file, IReadOnlyList<string> here, string? hereSetting, Action<string> log)
    {
        using var c = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = file, Pooling = false }.ToString());
        c.Open();
        return KeepFolders(c, here, hereSetting, log);
    }

    // The folders a database's setting names, each made absolute (as the scan reads them, Scans.Roots).
    private static List<string> FoldersOf(SqliteConnection c)
    {
        JsonNode? v;
        try { v = FoldersSetting(c) is { } raw ? JsonNode.Parse(raw) : null; }
        catch (System.Text.Json.JsonException) { return []; }
        if (v is not JsonArray a) return [];
        return [.. a.OfType<JsonValue>().Select(x => x.TryGetValue<string>(out var s) ? s : "").Where(s => s.Length > 0)
            .Select(s => NodePath.Resolve(s)).Distinct(StringComparer.Ordinal)];
    }

    private static void PutFolders(SqliteConnection c, string? json)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = json == null ? "DELETE FROM settings WHERE key = 'music_folders'"
            : "INSERT INTO settings(key, value) VALUES('music_folders', $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
        if (json != null) cmd.Parameters.AddWithValue("$v", json);
        cmd.ExecuteNonQuery();
    }
}
