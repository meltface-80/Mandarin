// Updater.Platform.cs — the machine an update is for (bug list item 153): which of the release's builds it takes
// (Linux's, Intel or Arm), and how it is got again when an update can't put it in place.
using System.Runtime.InteropServices;

namespace Mandarin.Server.Admin;

internal sealed partial class Updater
{
    private static (string Platform, string Arch) Machine() => (
        OperatingSystem.IsLinux() ? "linux" : OperatingSystem.IsWindows() ? "win32" : "other",
        RuntimeInformation.ProcessArchitecture switch { Architecture.X64 => "x64", Architecture.Arm64 => "arm64", Architecture.X86 => "ia32", Architecture.Arm => "arm", _ => "other" });

    /* The release's build for this machine, or null where there is none. */
    private static string? Build() => Machine() switch
    {
        ("linux", "x64") => "linux-x64", ("linux", "arm64") => "linux-arm64", _ => null
    };

    /*
     * How this install gets a new program when an update can't put one in place ([env]: this process's, or a case's).
     * Mandarin OS (item 389) has no shell for an install line: its system page puts Mandarin back from its release.
     */
    internal static string GetAgain(Func<string, string?>? env = null)
    {
        env ??= Environment.GetEnvironmentVariable;
        return env("MANDARIN_OS") is { Length: > 0 } ? "use Reinstall Mandarin on Mandarin OS's system page (http://mandarin/, Support)"
            : env("MANDARIN_SYSTEMD") is { Length: > 0 } ? "run the install line again (README, Install on Linux without Docker)"
            : "pull the image again (docker pull)";
    }
}
