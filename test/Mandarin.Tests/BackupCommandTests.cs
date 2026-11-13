using System.IO.Compression;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// `mandarin-server backup &lt;label&gt;` (item 405, Admin/BackupCommand.cs): Mandarin OS's Reinstall Mandarin makes one
/// before it moves Mandarin between its releases and dev's builds. It is Mandarin's own backup, made beside the running
/// server: kept in its backups folder with the label given, every part and the database in it, readable by the server's
/// user alone, listed by Settings → Backup and downloaded from it as any other. With no database yet, nothing is made.
/// </summary>
public sealed class BackupCommandTests
{
    [Test]
    public async Task A_backup_made_by_the_command_is_one_the_running_server_lists_with_everything_in_it()
    {
        Needs.Server(); Needs.Ffmpeg();
        var empty = Directory.CreateTempSubdirectory("musicd-backup-cmd-").FullName;
        var none = await ServerCommand.Run(["backup", "Before development builds"], new Dictionary<string, string> { ["DATA_DIR"] = empty });
        Assert.True(none.Code == 0, none.Out + none.Err);
        Assert.Equal(false, JsonNode.Parse(none.Out)!.Bool("made"));
        Assert.False(Directory.Exists(Path.Combine(empty, "backups")), "nothing made where there is no database");

        await using var s = await Session.Started();
        var r = await ServerCommand.Run(["backup", "Before development builds"], new Dictionary<string, string> { ["DATA_DIR"] = s.Server.DataDir });
        Assert.True(r.Code == 0, r.Out + r.Err);
        var made = JsonNode.Parse(r.Out)!;
        var id = made.Str("id")!;
        Assert.Equal(("auto", "Before development builds"), (made.Str("kind"), made.Str("label")));
        Assert.Equal(["settings", "devices", "collection", "keys", "database"], made["parts"]!.AsArray().Select(p => (string)p!).ToArray());

        var file = Path.Combine(s.Server.DataDir, "backups", id + ".tar.gz");
        if (!OperatingSystem.IsWindows()) Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(file));
        var listed = (await s.Api("backup")).J["backups"]!.AsArray().FirstOrDefault(b => b.Str("id") == id);
        Assert.True(listed != null && listed.Str("label") == "Before development builds", "Settings → Backup lists it");
        var got = await Bytes.Get(s.Base + "/api/backup/download/" + id, s.H);
        Assert.Equal(200, got.Status);
        var names = new List<string>();
        await using (var tar = new System.Formats.Tar.TarReader(new GZipStream(new MemoryStream(got.Body), CompressionMode.Decompress)))
            while (await tar.GetNextEntryAsync() is { } e) names.Add(e.Name);
        Assert.Contains("manifest.json", names);
        Assert.Contains("musicd.db", names);
        Assert.Contains("server.json", names);
    }
}
