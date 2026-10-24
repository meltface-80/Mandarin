using System.Diagnostics;
using Microsoft.Data.Sqlite;

namespace Mandarin.Tests;

/// <summary>
/// A server made busy as a big library makes it: the database's write lock held by another program
/// (a scan, a job) for a while, and a library of many albums whose copy takes a while to read again.
/// </summary>
public static class Busy
{
    /// <summary>
    /// <paramref name="meanwhile"/> run while the database's write lock is held from here, as another
    /// program's write holds it, let go after <paramref name="ms"/> whether or not it has finished.
    /// </summary>
    public static async Task<T> Holding<T>(TestServer srv, int ms, Func<Task<T>> meanwhile)
    {
        using var c = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(srv.DataDir, "musicd.db"), Pooling = false }.ToString());
        c.Open();
        // BEGIN IMMEDIATE, and a write in it: the lock is ours until the rollback.
        var tx = c.BeginTransaction(deferred: false);
        using (var cmd = c.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "INSERT INTO settings(key, value) VALUES('held', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value";
            cmd.ExecuteNonQuery();
        }
        var release = Task.Run(async () => { await Task.Delay(ms); tx.Rollback(); tx.Dispose(); });
        try { return await meanwhile(); }
        finally { await release; }
    }

    /// <summary>A request timed: what it was, its status, how long it took.</summary>
    public static async Task<(string What, int Status, long Ms)> Timed(string what, Func<Task<Http.Answer>> ask)
    {
        var t = Stopwatch.StartNew();
        var r = await ask();
        return (what, r.Status, t.ElapsedMilliseconds);
    }

    /// <summary><paramref name="n"/> albums written straight into the library ("Many 1" … by "Artist 1" …, keys many:1 …), no tracks.</summary>
    public static void ManyAlbums(TestServer srv, int n)
    {
        using var tx = srv.Db.BeginTransaction();
        using var cmd = srv.Db.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "INSERT INTO albums(key, title, artist, year, genres, added_at, updated_at) VALUES($k, $t, $a, $y, $g, $at, $at)";
        var k = cmd.Parameters.Add("$k", SqliteType.Text);
        var t = cmd.Parameters.Add("$t", SqliteType.Text);
        var a = cmd.Parameters.Add("$a", SqliteType.Text);
        var y = cmd.Parameters.Add("$y", SqliteType.Integer);
        var g = cmd.Parameters.Add("$g", SqliteType.Text);
        cmd.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        for (int i = 1; i <= n; i++)
        {
            k.Value = "many:" + i; t.Value = "Many " + i; a.Value = "Artist " + (i % 997); y.Value = 1960 + i % 60;
            g.Value = "[\"Genre " + (i % 40) + "\"]";
            cmd.ExecuteNonQuery();
        }
        tx.Commit();
    }
}
