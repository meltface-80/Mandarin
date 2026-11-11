namespace Mandarin.Tests;

/// <summary>
/// A backup kept on the server holds the services' sign-ins, Last.fm's included, and the Tailscale node's state: its
/// file is the server's own user's alone (0600), never readable by everyone else on the machine as a file made with
/// the usual 0644 was (AdminRoutes.cs Private). A backup uploaded to restore from is kept the same way while it's read.
/// </summary>
public sealed class BackupPrivateTests
{
    [Test]
    public async Task A_backup_kept_on_the_server_is_readable_by_its_own_user_alone()
    {
        Needs.Server(); Needs.Ffmpeg();
        if (OperatingSystem.IsWindows()) Assert.Skip("Unix file modes");
        await using var s = await Session.Started();
        var r = await s.Api("backup/save", new { include = new { settings = true, keys = true }, label = "kept" });
        Assert.Equal(200, r.Status);
        var files = Directory.GetFiles(s.Server.DataDir, "*.tar.gz", SearchOption.AllDirectories);
        Assert.Single(files);
        var mode = OperatingSystem.IsWindows() ? default : File.GetUnixFileMode(files[0]);
        Assert.True(mode == (UnixFileMode.UserRead | UnixFileMode.UserWrite), files[0] + ": " + mode);
    }
}
