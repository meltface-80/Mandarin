// IBroadcastMerges.cs — iBroadcast albums merged into one from the library's selection menu (bug list item 512,
// AlbumMerge.cs). Merged: the first disc's album keeps its id and key; each other's tracks are moved into it, their
// discs after its own, and the merge kept (album_merges, as for your own files: Scan/Scanner.Merge.cs). Every reading
// of the library after (IBroadcastLibrary.Write) keeps to it: a merged album's tracks written under the album it was
// merged into, while that is in iBroadcast too, its discs after the same disc. Its kept cover and booklets stay kept.
// Unmerged: the merge forgotten and the library read again, each album its own again.
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Services.IBroadcast;

internal static class IBroadcastMerges
{
    /// <summary>One album's merge: the key of the album it is in, the disc it starts after.</summary>
    public sealed record Joined(string Into, double Disc);

    /// <summary>The iBroadcast albums merged, each album's key → its merge (the album kept has one of its own, into itself).</summary>
    public static Dictionary<string, Joined> Read(SqliteConnection c)
    {
        try
        {
            return Library.Rows(c, "SELECT key, into_key, disc FROM album_merges WHERE key LIKE 'ibroadcast:%'")
                .ToDictionary(r => (string)r[0]!, r => new Joined((string)r[1]!, Convert.ToDouble(r[2], System.Globalization.CultureInfo.InvariantCulture)), StringComparer.Ordinal);
        }
        catch (SqliteException) { return []; }   // a database from before item 512, until the server opens it
    }

    /// <summary>The keys of the albums merged into [key]'s, in disc order (none where it is no merge).</summary>
    public static List<string> MembersOf(string key)
    {
        using var c = Db.Open();
        return [.. Read(c).Where(m => m.Value.Into == key && m.Key != key).OrderBy(m => m.Value.Disc).Select(m => m.Key)];
    }

    private static double MaxDisc(SqliteConnection c, long albumId) =>
        Library.Rows(c, "SELECT MAX(COALESCE(disc_no, 1)) FROM tracks WHERE album_id = $1", albumId)[0][0] is { } n and not DBNull ? Convert.ToDouble(n, System.Globalization.CultureInfo.InvariantCulture) : 1;

    private static void Run(SqliteConnection c, string sql, params (string Name, object? Value)[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in args) cmd.Parameters.AddWithValue(n, v ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    /// <summary>The albums [albums] (id and key, the first disc's first) merged into the first, called [title], now.</summary>
    public static void Merge(IReadOnlyList<(long Id, string Key)> albums, string title)
    {
        using var c = Db.Open();
        Run(c, "PRAGMA foreign_keys = ON");
        using var tx = c.BeginTransaction();
        var (keepId, into) = albums[0];
        var at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var offset = MaxDisc(c, keepId);
        Run(c, @"INSERT INTO album_merges(key, into_key, disc, title, dirs, made_at) VALUES($k, $k, 0, $t, NULL, $at)
                 ON CONFLICT(key) DO UPDATE SET into_key = excluded.into_key, disc = 0, title = excluded.title, made_at = excluded.made_at", ("$k", into), ("$t", title), ("$at", at));
        foreach (var (id, key) in albums.Skip(1))
        {
            var max = MaxDisc(c, id);
            // An album merged before: what was merged into it comes too, after it.
            Run(c, "UPDATE album_merges SET into_key = $into, disc = disc + $off WHERE into_key = $k AND key != $k", ("$into", into), ("$off", offset), ("$k", key));
            Run(c, @"INSERT INTO album_merges(key, into_key, disc, title, dirs, made_at) VALUES($k, $into, $off, NULL, NULL, $at)
                     ON CONFLICT(key) DO UPDATE SET into_key = excluded.into_key, disc = excluded.disc, title = NULL, made_at = excluded.made_at", ("$k", key), ("$into", into), ("$off", offset), ("$at", at));
            Run(c, "UPDATE tracks SET album_id = $a, disc_no = COALESCE(disc_no, 1) + $off WHERE album_id = $o", ("$a", keepId), ("$off", offset), ("$o", id));
            Run(c, "UPDATE plays SET album_id = $a WHERE album_id = $o", ("$a", keepId), ("$o", id));
            Run(c, "DELETE FROM albums WHERE id = $o", ("$o", id));
            offset += max;
        }
        Run(c, @"UPDATE albums SET track_count = (SELECT COUNT(*) FROM tracks WHERE album_id = $a), duration = (SELECT COALESCE(SUM(duration), 0) FROM tracks WHERE album_id = $a),
                 lossless = (SELECT COALESCE(MIN(lossless), 0) FROM tracks WHERE album_id = $a), updated_at = $at WHERE id = $a", ("$a", keepId), ("$at", at));
        tx.Commit();
    }

    /// <summary>The merge of [key]'s album forgotten (the library's next reading lays its albums apart); whether it was one.</summary>
    public static bool Unmerge(string key)
    {
        using var c = Db.Open();
        if (!Read(c).Any(m => m.Value.Into == key && m.Key != key)) return false;
        Run(c, "DELETE FROM album_merges WHERE into_key = $k", ("$k", key));
        return true;
    }
}
