namespace Mandarin.Tests;

/// <summary>
/// What the server can see of the machine's drives and shares (server/Mandarin.Server/Mounts.cs;
/// test/mounts.test.js, in C#).
/// </summary>
public sealed class MountsTests
{
    private static readonly string Info = string.Join("\n",
        "23 28 0:22 / /proc rw - proc proc rw",
        "28 1 0:40 / / rw - overlay overlay rw",
        "40 28 8:1 /srv/music /music ro,relatime - ext4 /dev/sda1 ro",
        "41 28 179:2 /mnt /mnt ro,relatime master:1 - ext4 /dev/mmcblk0p2 ro",
        "42 41 0:50 / /mnt/nas rw,relatime - autofs systemd-1 rw",
        "43 41 8:17 / /mnt/usb\\040drive rw - ext4 /dev/sdb1 rw",
        "44 41 0:52 / /mnt/share rw - autofs systemd-1 rw",
        "45 44 0:53 / /mnt/share rw - cifs //nas/music rw",
        "46 28 8:1 /data /app/data rw - ext4 /dev/sda1 rw",
        "47 28 8:1 /x /etc/hosts rw - ext4 /dev/sda1 rw");

    [Test]
    public async Task The_drives_and_shares_mounted_into_the_container_and_a_share_it_cant_see()
    {
        var r = await Score.Run(new
        {
            fn = "mounts", mountinfo = Info, dataDir = "/app/data",
            hints = new object[] { new object[] { "/mnt/nas", 0, true }, new object[] { "/mnt/share", 3, true }, new object[] { "/srv", 0, true }, new object[] { "/srv", 0, false } }
        });
        Assert.Equal(
        [
            ("/mnt", "ext4", false),
            ("/mnt/nas", "autofs", true),          // DietPi's on-demand share, not here
            ("/mnt/share", "cifs", false),         // the same kind, mounted: fine
            ("/mnt/usb drive", "ext4", false),
            ("/music", "ext4", false)
        ], r["mounts"].Items().Select(m => (m.Str("path"), m.Str("type"), m.Bool("waiting") ?? false)).ToList());
        var hints = r["hints"].Items().Select(h => (string?)h).ToList();
        Assert.Matches("rslave", hints[0]);
        Assert.Null(hints[1]);
        Assert.Matches("Nothing from the machine is mounted here", hints[2]);
        Assert.Null(hints[3]);
    }
}
