// Updater.Platform.cs — the machine an update is for (bug list item 153): which of the release's builds it takes
// (Linux's or a Mac's, Intel or Apple silicon), how it is got again when an update can't put it in place, and a Mac's
// ad hoc signature, without which macOS runs nothing.
using System.Runtime.InteropServices;

namespace Mandarin.Server.Admin;

internal sealed partial class Updater
{
    private static (string Platform, string Arch) Machine() => (
        OperatingSystem.IsLinux() ? "linux" : OperatingSystem.IsMacOS() ? "darwin" : OperatingSystem.IsWindows() ? "win32" : "other",
        RuntimeInformation.ProcessArchitecture switch { Architecture.X64 => "x64", Architecture.Arm64 => "arm64", Architecture.X86 => "ia32", Architecture.Arm => "arm", _ => "other" });

    /* The release's build for this machine, or null where there is none. */
    private static string? Build() => Machine() switch
    {
        ("linux", "x64") => "linux-x64", ("linux", "arm64") => "linux-arm64", ("darwin", "x64") => "osx-x64", ("darwin", "arm64") => "osx-arm64", _ => null
    };

    /* How this install gets a new program when an update can't put one in place. */
    private static string GetAgain(bool mac) => mac ? "run the install line again (README, Install on a Mac)" : "pull the image again (docker pull)";

    /* A Mac runs nothing unsigned: the release's is signed (ad hoc) where it is built, and here again if that didn't come through. */
    private static bool Codesign(string file)
    {
        if (Run("codesign", ["--verify", file], 30000).Code == 0) return true;
        return Run("codesign", ["--force", "--sign", "-", file], 60000).Code == 0;
    }
}
