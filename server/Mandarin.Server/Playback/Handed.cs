// Handed.cs — the addresses this server has handed out, so a speaker asking by its own address gets those and nothing
// else (item 369, the security audit's eighth finding).
//
// A speaker (a Sonos room, as the hub knows its address) is let have a stream or a cover unsigned (Images.FromSpeaker):
// a queue it keeps may carry an address it has written again, and v0.8.49 let it through rather than leave it silent.
// That was every stream and every cover, so a speaker that was not to be trusted could copy the whole library. Now it
// is only the paths of the addresses handed out (Signing.SignUntil notes each one, for as long as its signature is
// good), kept in the database too, so a queue made before a restart still plays.
using System.Collections.Concurrent;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Playback;

internal static class Handed
{
    private static readonly ConcurrentDictionary<string, long> Paths = new(StringComparer.Ordinal);
    private static readonly ConcurrentQueue<(string Path, long Until)> Unwritten = new();
    private static int loaded, flushing;
    private static Timer? flush;
    private const int Most = 200_000;

    /* [path] (as the address has it, before its query) handed out, good until [until] (Unix seconds). */
    public static void Note(string path, long until)
    {
        var p = Plain(path);
        if (p == null) return;
        Paths.AddOrUpdate(p, until, (_, was) => Math.Max(was, until));
        Unwritten.Enqueue((p, until));
        if (Interlocked.CompareExchange(ref flushing, 1, 0) == 0) Later();
    }

    // A write two seconds on, to take in the rest of a queue's addresses (the timer kept, or it may be collected first).
    private static void Later()
    {
        var was = Interlocked.Exchange(ref flush, new Timer(_ => Flush(), null, 2000, Timeout.Infinite));
        was?.Dispose();
    }

    /* Whether [rawPath] (a request's path as it wrote it, its query left out) was handed out and is good at [now]. */
    public static bool Has(string? rawPath, long now)
    {
        if (Plain(rawPath) is not { } p) return false;
        Load(now);
        return Paths.TryGetValue(p, out var until) && now < until;
    }

    /* A path as it is compared: its query and fragment left out, decoded once, as written in the address or the request. */
    internal static string? Plain(string? path)
    {
        if (string.IsNullOrEmpty(path)) return null;
        var q = path.IndexOfAny(['?', '#']);
        if (q >= 0) path = path[..q];
        try { path = Uri.UnescapeDataString(path); } catch (UriFormatException) { return null; }
        return path.StartsWith('/') ? path : null;
    }

    // What was handed out before this start, as long as it is good.
    private static void Load(long now)
    {
        if (Interlocked.Exchange(ref loaded, 1) == 1) return;
        try
        {
            using var c = Db.Open();
            Ensure(c);
            using var cmd = c.CreateCommand();
            cmd.CommandText = "SELECT path, until FROM handed_paths WHERE until > $now";
            cmd.Parameters.AddWithValue("$now", now);
            using var r = cmd.ExecuteReader();
            while (r.Read()) Paths.AddOrUpdate(r.GetString(0), r.GetInt64(1), (_, was) => Math.Max(was, r.GetInt64(1)));
        }
        catch (Exception e) when (e is SqliteException or InvalidOperationException or ArgumentException) { Server.Log("[links] couldn't read the addresses handed out: " + e.Message); }
    }

    // The addresses noted since the last time written in one go, and those past their time let go.
    private static void Flush()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var batch = new List<(string Path, long Until)>();
        while (Unwritten.TryDequeue(out var x)) batch.Add(x);
        Volatile.Write(ref flushing, 0);
        if (!Unwritten.IsEmpty && Interlocked.CompareExchange(ref flushing, 1, 0) == 0) Later();
        if (Paths.Count > Most)
            foreach (var (k, v) in Paths) if (v <= now) Paths.TryRemove(k, out _);
        if (batch.Count == 0 || string.IsNullOrEmpty(Db.File)) return;
        try
        {
            using var c = Db.Open();
            Ensure(c);
            using var tx = c.BeginTransaction();
            using (var cmd = c.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = "INSERT INTO handed_paths(path, until) VALUES($p, $u) ON CONFLICT(path) DO UPDATE SET until = MAX(until, excluded.until)";
                var p = cmd.Parameters.Add("$p", SqliteType.Text);
                var u = cmd.Parameters.Add("$u", SqliteType.Integer);
                foreach (var (path, until) in batch) { p.Value = path; u.Value = until; cmd.ExecuteNonQuery(); }
            }
            using (var cmd = c.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = "DELETE FROM handed_paths WHERE until <= $now";
                cmd.Parameters.AddWithValue("$now", now);
                cmd.ExecuteNonQuery();
            }
            tx.Commit();
        }
        catch (Exception e) when (e is SqliteException or InvalidOperationException or ArgumentException) { Server.Log("[links] couldn't keep the addresses handed out: " + e.Message); }
    }

    // The table, made where it isn't yet (Schema.cs is full).
    private static volatile bool made;
    private static void Ensure(SqliteConnection c)
    {
        if (made) return;
        using var cmd = c.CreateCommand();
        cmd.CommandText = "CREATE TABLE IF NOT EXISTS handed_paths (path TEXT PRIMARY KEY, until INTEGER NOT NULL)";
        cmd.ExecuteNonQuery();
        made = true;
    }
}
