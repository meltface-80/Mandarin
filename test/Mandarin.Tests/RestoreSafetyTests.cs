using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Tests;

/// <summary>
/// Restoring a backup made safe (bug list item 410). A backup from another install, its music folders not on this
/// computer, used to be restored as it was: every album pointed at folders that aren't here. Now this computer's
/// music folders are kept (Admin/Backup.Folders.cs), said in the restore's answer and the log, and the scan after the
/// restart moves the restored library onto the same files here, each album keeping its id, its edits, its favourite
/// and its plays; an album whose files aren't here is kept, missing, until it is found or forgotten
/// (Scan/RestoredAway.cs). Some of the backup's folders here: those kept with this computer's. And the copies of the
/// database kept before a restore or a switch of builds (Admin/Backup.Copies.cs) listed, restored and deleted.
/// </summary>
public sealed class RestoreSafetyTests
{
    private static readonly Dictionary<string, object?> Quiet = new() { ["serverIp"] = "127.0.0.1", ["sonosHosts"] = Array.Empty<string>(), ["upnpMulticast"] = false, ["identify"] = false };

    private static Dictionary<string, string> H(string token) => new() { ["Authorization"] = "Bearer " + token };

    // The restart a restore makes, and the first scan after it, waited for.
    private static async Task Restarted(TestServer srv, string token, string? before)
    {
        async Task<string?> Boot() { try { return (string?)(await Http.Get(srv.Base + "/server-info")).Json?["boot"]; } catch (HttpRequestException) { return null; } }
        await Session.Until(async () => await Boot() is { } b && b != before, 30000, "the server started again");
        await Session.Until(async () =>
        {
            var st = (await Http.Get(srv.Base + "/api/status", H(token))).Json?["scan"];
            return st?["last"] != null && st["running"]?.GetValue<bool>() != true;
        }, 60000, "its first scan");
    }

    private static async Task<string?> BootOf(TestServer srv) => (string?)(await Http.Get(srv.Base + "/server-info")).Json?["boot"];

    private static long Id(TestServer srv, string title) => (long)srv.Scalar("SELECT id FROM albums WHERE title = $1", title)!;

    private static List<string> Paths(TestServer srv, string title) =>
        [.. srv.Rows("SELECT t.path FROM tracks t JOIN albums a ON a.id = t.album_id WHERE a.title = $1 ORDER BY t.path", title).Select(r => (string)r["path"]!)];

    [Test]
    public async Task A_backup_whose_music_folders_arent_here_keeps_this_computers_and_the_scan_moves_its_library_onto_the_files_here()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        // The install the backup was made on: its music folder chosen in Settings, an album renamed, one a favourite, a play.
        string id;
        long one, hi, best;
        await using (var s = await Session.Started(lib: lib))
        {
            s.Server.SetSetting("music_folders", new[] { lib.Music });
            Assert.Equal(200, (await s.Api("album/edit", new { offset = (await s.Album("Hi Res"))!.Num("offset"), title = "Hi Res, Edited" })).Status);
            Assert.Equal(200, (await s.Api("favourites", new { offset = (await s.Album("Album One"))!.Num("offset"), on = true })).Status);
            (one, hi, best) = (Id(s.Server, "Album One"), Id(s.Server, "Hi Res"), Id(s.Server, "Best Of"));
            s.Server.InsertPlay(hi, s.Server.Scalar("SELECT id FROM tracks WHERE album_id = $1 LIMIT 1", hi), "Hi 1", "Artist B", "Hi Res", "Kitchen", 1760000000000);
            var made = await s.Api("backup/save", new { include = new[] { "settings", "collection", "database" } });
            Assert.True(made.Status == 200, made.Text);
            id = made.J["backup"].Str("id")!;
        }

        // This computer: the same files somewhere else (the same sizes, times and names), but for Best Of's, not here at all.
        var here = Path.Combine(lib.Root, "Storage", "Music");
        Directory.CreateDirectory(Path.GetDirectoryName(here)!);
        Directory.Move(lib.Music, here);
        Directory.Move(Path.Combine(here, "Comp"), Path.Combine(lib.Root, "Comp"));
        var data = Path.Combine(lib.Root, "data-here");
        await using var srv = await new TestServer(Ports.Port(), here, data, Quiet).Start();
        var token = await Session.SignIn(srv.Base);
        await Session.Until(async () => (await Http.Get(srv.Base + "/api/library-stats", H(token))).J.Num("albums") == 2, 30000, "this computer's first scan");
        var backups = Path.Combine(data, "backups");
        Directory.CreateDirectory(backups);
        foreach (var ext in new[] { ".tar.gz", ".json" }) File.Copy(Path.Combine(lib.Data, "backups", id + ext), Path.Combine(backups, id + ext));

        var boot = await BootOf(srv);
        var r = await Http.Post(srv.Base + "/api/backup/restore/" + id, new { include = new[] { "database" } }, H(token));
        Assert.True(r.Status == 200, r.Text);
        var said = $"The backup's music folders ({lib.Music}) aren't on this computer: this one's ({here}) kept. Its albums are matched to the same files here by the next scan.";
        Assert.Equal(said, r.J.Str("folders"));
        Assert.True(r.J.Bool("restarting"));
        Assert.Contains(srv.Logs, l => l.Contains("[backup] " + said, StringComparison.Ordinal));
        await Restarted(srv, token, boot);

        // This computer's folders kept (none chosen: its music folder), the backup's named as away.
        Assert.Null(srv.Setting("music_folders"));
        Assert.Equal([lib.Music], srv.Setting("restoredAway")!.AsArray().Select(x => (string?)x).OfType<string>().ToArray());
        // The restored library on the files here: the same albums, ids, edit, favourite and play.
        Assert.Equal((one, hi), (Id(srv, "Album One"), Id(srv, "Hi Res")));
        Assert.All(Paths(srv, "Album One").Concat(Paths(srv, "Hi Res")), p => Assert.StartsWith(here + "/", p, StringComparison.Ordinal));
        Assert.Equal(5, Paths(srv, "Album One").Count + Paths(srv, "Hi Res").Count);
        Assert.NotNull(await AlbumNamed(srv, token, "Hi Res, Edited"));
        Assert.Equal(["Album One"], (await Http.Get(srv.Base + "/api/favourites", H(token))).J["albums"].Items().Select(a => a.Str("title")).OfType<string>().ToArray());
        Assert.Equal(1L, srv.Scalar("SELECT COUNT(*) FROM plays WHERE album_id = $1", hi));
        Assert.Contains(srv.Logs, l => l.Contains("[scan] updated:", StringComparison.Ordinal) && l.Contains(" moved 5 files", StringComparison.Ordinal));
        // Best Of, whose files aren't here: kept, missing, not dropped as a folder removed in Settings would be.
        Assert.Equal(best, Id(srv, "Best Of"));
        Assert.All(Paths(srv, "Best Of"), p => Assert.StartsWith(lib.Music + "/", p, StringComparison.Ordinal));
        Assert.Contains(srv.Logs, l => l.Contains($"[scan] {lib.Music} is missing — kept its 2 tracks as they were", StringComparison.Ordinal));
        var last = (await Http.Get(srv.Base + "/api/status", H(token))).J["scan"]!["last"];
        Assert.Contains(last!["offline_dirs"].Items(), d => d.Str("dir") == lib.Music && d.Str("reason") == "missing");

        // Gone for good: forgotten from the notice, and the backup's folder with it.
        Http.Answer forgot = null!;
        await Session.Until(async () => (forgot = await Http.Post(srv.Base + "/api/library/forget-folder", new { dir = lib.Music }, H(token))).Status != 409, 30000, "no scan running");
        Assert.True(forgot.Status == 200, forgot.Text);
        Assert.Equal(2, forgot.J.Num("removed"));
        Assert.Null(srv.Setting("restoredAway"));
        Assert.Equal(0L, srv.Scalar("SELECT COUNT(*) FROM albums WHERE title = 'Best Of'"));
    }

    private static async Task<JsonNode?> AlbumNamed(TestServer srv, string token, string title) =>
        (await Http.Get(srv.Base + "/api/library/albums?sort=album", H(token))).J["albums"].Items().FirstOrDefault(a => a.Str("title") == title);

    [Test]
    public async Task Some_of_the_backups_music_folders_here_those_kept_with_this_computers()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        var nas = Path.Combine(lib.Root, "nas", "Music");
        Directory.CreateDirectory(nas);
        var nowhere = Path.Combine(lib.Root, "usb", "4tb", "Music");
        await using var s = await Session.Started(lib: lib);
        s.Server.SetSetting("music_folders", new[] { nas, nowhere });
        var made = await s.Api("backup/save", new { include = new[] { "settings" } });
        Assert.True(made.Status == 200, made.Text);
        s.Server.SetSetting("music_folders", new[] { lib.Music });

        var boot = await BootOf(s.Server);
        s.Server.CloseDb();
        var r = await s.Api("backup/restore/" + made.J["backup"].Str("id"), new { include = new[] { "settings" } });
        Assert.True(r.Status == 200, r.Text);
        string[] kept = [nas, lib.Music];
        Assert.Equal($"Of the backup's music folders, {nowhere} isn't on this computer: {string.Join(", ", kept)} kept. Its albums are matched to the same files here by the next scan.",
            r.J.Str("folders"));
        await Restarted(s.Server, s.Token, boot);
        Assert.Equal(kept, s.Server.Setting("music_folders")!.AsArray().Select(x => (string?)x).ToArray());
        Assert.Equal(kept.Order(StringComparer.Ordinal).ToArray(), (await s.Api("library/folders")).J["folders"].Items().Select(f => f.Str("path")).ToArray());
        // None of the library is in the folder that isn't here: forgotten by the scan.
        Assert.Null(s.Server.Setting("restoredAway"));
        Assert.Equal(3, (await s.Api("library-stats")).J.Num("albums"));

        // A backup whose folders are all here is restored as it was: nothing said.
        s.Server.SetSetting("music_folders", new[] { nas, lib.Music });
        var same = await s.Api("backup/save", new { include = new[] { "settings" } });
        boot = await BootOf(s.Server);
        var again = await s.Api("backup/restore/" + same.J["backup"].Str("id"), new { include = new[] { "settings" } });
        Assert.True(again.Status == 200, again.Text);
        Assert.Null(again.J["folders"]);
        await Restarted(s.Server, s.Token, boot);
    }

    // A consistent copy of the server's database, as the reinstaller's or a restore's would be.
    private static void CopyDatabase(TestServer srv, string to)
    {
        using var dst = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = to, Pooling = false }.ToString());
        dst.Open();
        srv.Db.BackupDatabase(dst);
    }

    private static long Local(string stamp) =>
        new DateTimeOffset(DateTime.ParseExact(stamp, "yyyy-MM-dd-HHmmss", CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal)).ToUnixTimeMilliseconds();

    [Test]
    public async Task The_copies_kept_before_a_restore_or_a_switch_of_builds_are_listed_restored_and_deleted()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var s = await Session.Started();
        var backups = Path.Combine(s.Server.DataDir, "backups");
        Directory.CreateDirectory(backups);
        s.Server.SetSetting("marker410", "before");
        const string restore = "before-restore-2026-11-14-003225", dev = "before-dev-2026-11-13-101010";
        CopyDatabase(s.Server, Path.Combine(backups, restore + ".db"));
        CopyDatabase(s.Server, Path.Combine(backups, dev + ".db"));
        File.WriteAllText(Path.Combine(backups, dev + ".db-shm"), "");
        // Not a copy: passed over.
        File.WriteAllText(Path.Combine(backups, "before-restore-today.db"), "x");
        File.WriteAllText(Path.Combine(backups, "musicd.db"), "x");
        s.Server.SetSetting("marker410", "after");

        var list = (await s.Api("backup")).J;
        var copies = list["copies"].Items().ToList();
        Assert.Equal([restore, dev], copies.Select(c => c.Str("id")).OfType<string>().ToArray());
        Assert.Equal(["restore", "dev"], copies.Select(c => c.Str("kind")).OfType<string>().ToArray());
        Assert.Equal([Local("2026-11-14-003225"), Local("2026-11-13-101010")], copies.Select(c => (long)c.Num("created")!).ToArray());
        Assert.Equal(new FileInfo(Path.Combine(backups, restore + ".db")).Length, (long)copies[0].Num("bytes")!);
        Assert.All(copies, c => Assert.Equal(["database"], c.Strs("parts").OfType<string>().ToArray()));
        Assert.DoesNotContain(list["backups"].Items(), b => b.Str("id") == restore);

        // Restored as a backup's database is: staged, swapped in at the next start, the one there kept aside.
        var boot = await BootOf(s.Server);
        s.Server.CloseDb();   // the file is put aside at the next start: read afresh after it
        var r = await s.Api("backup/restore/" + restore, new { include = new[] { "database" } });
        Assert.True(r.Status == 200, r.Text);
        JsonAssert.Same("""{ "ok": true, "restored": ["database"], "restarting": true }""", r.J);
        await Restarted(s.Server, s.Token, boot);
        Assert.Equal("before", (string?)s.Server.Setting("marker410"));
        Assert.Contains(s.Server.Logs, l => l.Contains("[backup] restored the database from a backup; the one before it is kept as ", StringComparison.Ordinal));
        var after = (await s.Api("backup")).J["copies"].Items().Select(c => c.Str("id")!).ToList();
        Assert.Equal(3, after.Count);
        Assert.Contains(restore, after);
        var aside = after.Single(c => c != restore && c != dev);
        Assert.StartsWith("before-restore-", aside, StringComparison.Ordinal);
        using (var kept = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(backups, aside + ".db"), Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString()))
        {
            kept.Open();
            using var q = kept.CreateCommand();
            q.CommandText = "SELECT value FROM settings WHERE key = 'marker410'";
            Assert.Equal("\"after\"", q.ExecuteScalar());
        }

        // Deleted as a backup is, the files beside it with it; one not there, or not a copy, is not.
        var del = await Http.Send(HttpMethod.Delete, s.Base + "/api/backup/" + dev, null, s.H);
        Assert.True(del.J.Bool("ok"), del.Text);
        Assert.False(File.Exists(Path.Combine(backups, dev + ".db")));
        Assert.False(File.Exists(Path.Combine(backups, dev + ".db-shm")));
        Assert.False((await Http.Send(HttpMethod.Delete, s.Base + "/api/backup/" + dev, null, s.H)).J.Bool("ok"));
        Assert.False((await Http.Send(HttpMethod.Delete, s.Base + "/api/backup/musicd", null, s.H)).J.Bool("ok"));
        Assert.True(File.Exists(Path.Combine(backups, "musicd.db")));
        Assert.Equal(404, (await s.Api("backup/restore/" + dev, new { include = new[] { "database" } })).Status);
    }
}
