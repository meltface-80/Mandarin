// LocalDevices.cs — the sound devices on the computer Mandarin runs on
// (lib/local/devices.js, v0.8.49, stage 6 part 4), for Settings → Audio
// Devices.
//
//   Linux   none (item 324): a USB DAC on the computer Mandarin runs on is
//           played by Mandarin Bridge for Linux, installed beside it, as a
//           room of its own (over SlimProto, its DAC read as any Bridge's).
//           The server no longer opens the computer's sound cards itself.
//
// A device's id comes from its name, so it is the same player after a restart
// or a replug.
using System.Text;
using Mandarin.Server.Playback;

namespace Mandarin.Server.Local;

/* list(): every device this computer has, as the register takes them. */
internal sealed class LocalList
{
    public List<SeenInfo> Devices = [];
    public int Hidden;
    public string Platform = "";
    public bool Off;
}

internal static class LocalDevices
{
    public const string Prefix = "LOCAL_";

    public static string IdOf(string key) => Prefix + Convert.ToHexString(Fingerprint.Sha1(Encoding.UTF8.GetBytes(key))).ToLowerInvariant()[..12];

    /* Every device this computer has, as the register takes them; off (none) where local audio is turned off. */
    public static Task<LocalList> List(bool localAudio)
    {
        var platform = OperatingSystem.IsLinux() ? "linux" : Environment.OSVersion.Platform.ToString().ToLowerInvariant();
        // Linux: none (item 324), its USB DAC a Mandarin Bridge's.
        return Task.FromResult(new LocalList { Platform = platform, Off = !localAudio });
    }
}
