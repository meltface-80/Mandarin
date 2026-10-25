using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Music added while a scan is under way, where that scan has already looked (bug list item 181): the folder
/// watcher's scan, turned away because one is running, is made once that one ends. It was dropped, and the
/// music waited for the next timed scan, six hours on. The scan under way is held at its first write by the
/// test keeping the database's write lock (it has listed the music folder by then); the new album goes in a
/// folder of its own at the top, which that scan will never see.
/// </summary>
public sealed class ScanAgainTests
{
    [Test]
    public async Task Music_added_while_a_scan_runs_is_read_by_one_more_scan_once_it_ends()
    {
        var lib = Fixtures.MakeLibrary();
        await using var s = await Session.Started(lib: lib, env: new Dictionary<string, string> { ["MANDARIN_WATCH_QUIET_MS"] = "300", ["MANDARIN_WATCH_GAP_MS"] = "0" });
        int Heard() => s.Server.Logs.Count(l => l.Contains("in the music folders", StringComparison.Ordinal) && l.Contains("[watch]", StringComparison.Ordinal));
        async Task<JsonNode?> Scan() => (await s.Api("status")).Json?["scan"];
        var db = Path.Combine(lib.Data, "musicd.db");

        // The device's last sight written just now, so no request here needs to write while the lock is held.
        SqliteDump.Exec(db, $"UPDATE devices SET last_seen = {DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}");
        using var held = SqliteDump.Open(db, readOnly: false);
        using (var begin = held.CreateCommand()) { begin.CommandText = "BEGIN IMMEDIATE"; begin.ExecuteNonQuery(); }
        var locked = true;
        try
        {
            var rescan = s.Api("library/rescan", new { force = true });
            await Session.Until(async () => await Scan() is { } st && st["running"]?.GetValue<bool>() == true && (st["files_seen"]?.GetValue<double>() ?? 0) > 0, 20000, "the scan held at its first write");

            // An album where the scan has looked already: heard, and its scan turned away.
            var heard = Heard();
            Fixtures.Gen(Path.Combine(lib.Music, "Late Artist", "Late Album", "01 Late.flac"), seconds: 1,
                tags: new Dictionary<string, object> { ["title"] = "Late", ["artist"] = "Late Artist", ["album"] = "Late Album", ["track"] = 1 });
            await Session.Until(() => Task.FromResult(Heard() > heard), 15000, "the change heard");
            Assert.True((await Scan())?["running"]?.GetValue<bool>() == true, "the held scan still under way");

            using (var commit = held.CreateCommand()) { commit.CommandText = "COMMIT"; commit.ExecuteNonQuery(); }
            locked = false;
            Assert.Equal(200, (await rescan).Status);
        }
        finally
        {
            if (locked) { using var rollback = held.CreateCommand(); rollback.CommandText = "ROLLBACK"; rollback.ExecuteNonQuery(); }
        }
        // One more scan once it ended: the album read.
        await Session.Until(async () => await s.Album("Late Album") != null, 30000, "the album added during the scan");
    }
}
