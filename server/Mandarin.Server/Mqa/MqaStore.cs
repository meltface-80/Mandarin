// MqaStore.cs — what was found of each track's MQA signalling (bug list item 418: MqaDetect.cs), kept and read.
//
// Kept in track_mqa by the file's path, with the size and time it had (as tracks has them): a file changed since is
// looked at again (MqaPass.cs), as the fingerprints are (Identify/Fingerprints.cs). Only a stereo 16- or 24-bit PCM
// file at 44.1, 48, 88.2 or 96 kHz can carry MQA as the identifiers read it; any other is never looked at. The tags
// (MQAENCODER, ORIGINALSAMPLERATE, MQASAMPLERATE) are a hint only: a tagged file is looked at first, and whether it
// was is kept (tagged), but a track is MQA only where its samples carry the sync word.
//
// Read by track (the album page, Now playing, the plan: MqaPlan.cs) and by album (the Focus's MQA, the versions):
// an album is MQA where every track of it looked at is, MQA Studio where every one is that; its original rate the
// highest of its tracks'. The albums' are read again whenever something new was kept (Generation).
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Mqa;

/* An album's MQA: Studio where every track is; the highest original rate; the depth its files are. */
internal sealed record AlbumMqa(bool Studio, int OriginalRate, int Bits);

internal static class MqaStore
{
    private const string Table = """
        CREATE TABLE IF NOT EXISTS track_mqa (path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime INTEGER NOT NULL,
          mqa INTEGER NOT NULL DEFAULT 0, studio INTEGER NOT NULL DEFAULT 0, original_rate INTEGER, tagged INTEGER NOT NULL DEFAULT 0,
          error TEXT, checked_at INTEGER NOT NULL);
        """;

    /* A track that can carry MQA (t: tracks). */
    public const string CanCarry = "t.path NOT LIKE '%://%' AND t.lossless = 1 AND t.channels = 2 AND t.bits IN (16, 24) AND t.sample_rate IN (44100, 48000, 88200, 96000)";
    /* Its row kept for the file as it is now (m: track_mqa). */
    public const string Join = "LEFT JOIN track_mqa m ON m.path = t.path AND m.size = t.size AND m.mtime = t.mtime";

    private static int generation;
    private static (int Gen, Dictionary<long, AlbumMqa> Albums)? albums;
    private static readonly object gate = new();

    /* Bumped whenever something is kept: what is read by album is read again. */
    public static int Generation => Volatile.Read(ref generation);

    public static void Ensure(SqliteConnection c)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = Table;
        cmd.ExecuteNonQuery();
    }

    /* What was found of the file at [path] as it was ([size], [mtime]). */
    public static void Keep(string path, double size, double mtime, MqaInfo found, bool tagged, string? error)
    {
        using var c = Db.Open();
        Ensure(c);
        bool was;
        using (var get = c.CreateCommand())
        {
            get.CommandText = "SELECT mqa FROM track_mqa WHERE path = $p";
            get.Parameters.AddWithValue("$p", path);
            was = get.ExecuteScalar() is long m && m == 1;
        }
        using var cmd = c.CreateCommand();
        cmd.CommandText = @"INSERT INTO track_mqa(path, size, mtime, mqa, studio, original_rate, tagged, error, checked_at) VALUES($p, $s, $m, $q, $st, $r, $tg, $e, $at)
            ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, mqa = excluded.mqa, studio = excluded.studio,
            original_rate = excluded.original_rate, tagged = excluded.tagged, error = excluded.error, checked_at = excluded.checked_at";
        cmd.Parameters.AddWithValue("$p", path);
        cmd.Parameters.AddWithValue("$s", size);
        cmd.Parameters.AddWithValue("$m", mtime);
        cmd.Parameters.AddWithValue("$q", found.Mqa ? 1 : 0);
        cmd.Parameters.AddWithValue("$st", found.Studio ? 1 : 0);
        cmd.Parameters.AddWithValue("$r", found.OriginalRate > 0 ? found.OriginalRate : DBNull.Value);
        cmd.Parameters.AddWithValue("$tg", tagged ? 1 : 0);
        cmd.Parameters.AddWithValue("$e", (object?)error ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        cmd.ExecuteNonQuery();
        Interlocked.Increment(ref generation);
        // The lists kept show it (an album's mqa, the Focus's MQA): made again where a track is MQA, or was.
        if (found.Mqa || was) Library.ForgetAllKept();
    }

    /* The MQA tracks among [ids] (the file as it is now): each one's signalling and depth. */
    public static Dictionary<long, (MqaInfo Info, int Bits)> Of(SqliteConnection c, IEnumerable<long> ids)
    {
        var list = ids.Distinct().ToList();
        var o = new Dictionary<long, (MqaInfo, int)>();
        if (list.Count == 0) return o;
        Ensure(c);
        using var cmd = c.CreateCommand();
        cmd.CommandText = $"SELECT t.id, m.studio, m.original_rate, t.bits FROM tracks t {Join} WHERE m.mqa = 1 AND t.id IN (SELECT value FROM json_each($ids))";
        cmd.Parameters.AddWithValue("$ids", "[" + string.Join(",", list) + "]");
        using var r = cmd.ExecuteReader();
        while (r.Read())
            o[r.GetInt64(0)] = (new MqaInfo(true, r.GetInt64(1) == 1, r.IsDBNull(2) ? 0 : (int)r.GetInt64(2)), r.IsDBNull(3) ? 0 : (int)r.GetDouble(3));
        return o;
    }

    /* As the album page, the lists and Now playing give it: { studio, original_rate, bits } (the page and the app word it). */
    public static System.Text.Json.Nodes.JsonObject Json(bool studio, int originalRate, int bits) =>
        new() { ["studio"] = studio, ["original_rate"] = originalRate > 0 ? originalRate : null, ["bits"] = bits > 0 ? bits : null };

    /* One track's, or null where it isn't MQA (or hasn't been looked at). */
    public static (MqaInfo Info, int Bits)? Track(long id)
    {
        try
        {
            using var c = Db.Open();
            return Of(c, [id]).TryGetValue(id, out var m) ? m : null;
        }
        catch (SqliteException) { return null; }
    }

    /* The MQA albums, by id: every track of it looked at MQA. */
    public static Dictionary<long, AlbumMqa> Albums()
    {
        var gen = Generation;
        lock (gate) if (albums is { } a && a.Gen == gen) return a.Albums;
        var o = new Dictionary<long, AlbumMqa>();
        try
        {
            using var c = Db.Open();
            Ensure(c);
            using var cmd = c.CreateCommand();
            cmd.CommandText = $@"SELECT t.album_id, MIN(COALESCE(m.mqa, 0)), MIN(COALESCE(m.studio, 0)), MAX(m.original_rate), MAX(t.bits)
                FROM tracks t {Join} WHERE t.album_id IS NOT NULL GROUP BY t.album_id HAVING MIN(COALESCE(m.mqa, 0)) = 1";
            using var r = cmd.ExecuteReader();
            while (r.Read())
                o[(long)r.GetDouble(0)] = new AlbumMqa(r.GetInt64(2) == 1, r.IsDBNull(3) ? 0 : (int)r.GetInt64(3), r.IsDBNull(4) ? 0 : (int)r.GetDouble(4));
        }
        catch (SqliteException) { return o; }
        lock (gate) albums = (gen, o);
        return o;
    }
}
