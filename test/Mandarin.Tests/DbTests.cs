using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Mandarin.Tests;

/// <summary>The database in the data volume, opened as the server opens it (`mandarin-server db &lt;dir&gt;`; test/db.test.js, in C#).</summary>
public sealed class DbTests
{
    /* Opened, and what it came to: { ok, existed, aside, version }. */
    private static async Task<JsonNode> Open(string dir)
    {
        Needs.Server();
        var psi = new ProcessStartInfo(ServerProcess.Bin) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        psi.ArgumentList.Add("db");
        psi.ArgumentList.Add(dir);
        using var p = Process.Start(psi)!;
        var output = p.StandardOutput.ReadToEndAsync();
        var err = p.StandardError.ReadToEndAsync();
        await p.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(60));
        Assert.True(p.ExitCode == 0, await output + await err);
        return JsonNode.Parse((await output).Split('\n', StringSplitOptions.RemoveEmptyEntries).Last())!;
    }

    private static SqliteConnection Db(string dir)
    {
        var c = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(dir, "musicd.db"), Pooling = false }.ToString());
        c.Open();
        return c;
    }

    private static object? Scalar(SqliteConnection c, string sql) { using var cmd = c.CreateCommand(); cmd.CommandText = sql; return cmd.ExecuteScalar(); }

    [Test]
    public async Task A_database_left_in_the_volume_by_another_program_is_moved_aside_not_crashed_on()
    {
        var dir = Directory.CreateTempSubdirectory("musicd-db-").FullName;
        using (var old = Db(dir))
        {
            Scalar(old, "CREATE TABLE tracks (id INTEGER PRIMARY KEY, path TEXT, title TEXT); INSERT INTO tracks(path, title) VALUES('x', 'y');");
            Scalar(old, "CREATE TABLE albums (id INTEGER PRIMARY KEY, title TEXT);");
        }
        var said = await Open(dir);
        var aside = said.Str("aside");
        Assert.True(aside != null && Regex.IsMatch(Path.GetFileName(aside), @"^musicd\.old-\d+\.db$"), said.ToJsonString());
        Assert.True(File.Exists(aside));
        using var db = Db(dir);
        Assert.Equal(0L, Scalar(db, "SELECT COUNT(*) n FROM tracks"));
        Assert.Equal((long)said.Num("version")!, Scalar(db, "PRAGMA user_version"));
        Assert.True(said.Num("version") > 0);
    }

    [Test]
    public async Task Our_own_database_is_kept_across_restarts()
    {
        var dir = Directory.CreateTempSubdirectory("musicd-db-").FullName;
        Assert.False((await Open(dir)).Bool("existed"));
        using (var db = Db(dir)) Scalar(db, "INSERT INTO settings(key, value) VALUES('k', '42')");
        var said = await Open(dir);
        Assert.True(said.Bool("existed"));
        Assert.Null(said["aside"]);
        using (var db = Db(dir)) Assert.Equal("42", Scalar(db, "SELECT value FROM settings WHERE key = 'k'"));
        Assert.DoesNotContain(Directory.GetFiles(dir), f => Path.GetFileName(f).Contains("old", StringComparison.Ordinal));
    }
}
