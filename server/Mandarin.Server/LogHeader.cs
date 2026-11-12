// LogHeader.cs — what opens each of the server's log files, and the line it adds every five minutes (logs, item 389):
// enough to read a log sent in without asking what it came from. Which Mandarin, installed how, on what; where the
// music and data are, and the mounts under them; the time zone, as every line is in UTC. Scrubbed as any line is.
using System.Globalization;
using System.Runtime.InteropServices;

namespace Mandarin.Server;

internal static class LogHeader
{
    private static readonly DateTime started = DateTime.UtcNow;
    private static Timer? timer;

    /* How this server is installed: Mandarin OS, the Linux installer, or by hand. */
    public static string Kind() =>
        Environment.GetEnvironmentVariable("MANDARIN_OS") is { Length: > 0 } os ? "Mandarin OS " + os
        : Environment.GetEnvironmentVariable("MANDARIN_SYSTEMD") is { Length: > 0 } ? "Linux (installer, systemd)"
        : "native";

    /* How it is installed, as the page words what to do (the login's forgotten password, an empty library): "mandarin-os",
       "linux" (tools/linux/install.sh's systemd service) or "native" (by hand). */
    public static string InstallKey() =>
        Environment.GetEnvironmentVariable("MANDARIN_OS") is { Length: > 0 } ? "mandarin-os"
        : Environment.GetEnvironmentVariable("MANDARIN_SYSTEMD") is { Length: > 0 } ? "linux"
        : "native";

    /* The lines that open a file, each "# " before it. */
    public static string Text()
    {
        var lines = new List<string>
        {
            $"Mandarin Server {Server.Version} log, begun {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC",
            $"Installed as: {Kind()}",
            $"System: {RuntimeInformation.OSDescription} ({RuntimeInformation.OSArchitecture}), .NET {Environment.Version}",
            $"CPU: {Environment.ProcessorCount} cores; memory: {Mb(GC.GetGCMemoryInfo().TotalAvailableMemoryBytes)}",
            $"Time zone: {TimeZoneInfo.Local.Id} (UTC{Offset()}); every time below is UTC",
            $"Data: {Server.DataDir} ({Free(Server.DataDir)} free)",
            $"Music: {Environment.GetEnvironmentVariable("MUSIC_DIR") ?? "/music"}",
            $"Running since {started:yyyy-MM-dd HH:mm:ss} UTC",
        };
        lines.AddRange(Mounts());
        return string.Concat(lines.Select(l => "# " + LogScrub.Line(l) + "\n"));
    }

    /* Filesystems mounted, as /proc/self/mounts has them, but the system's own (Linux alone). */
    private static IEnumerable<string> Mounts()
    {
        if (!OperatingSystem.IsLinux()) yield break;
        string[] all;
        try { all = File.ReadAllLines("/proc/self/mounts"); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { yield break; }
        string[] system = ["proc", "sysfs", "tmpfs", "devpts", "mqueue", "cgroup", "cgroup2", "overlay", "devtmpfs", "securityfs", "pstore", "debugfs", "tracefs", "bpf", "hugetlbfs", "configfs", "fusectl", "autofs", "binfmt_misc", "nsfs", "ramfs", "efivarfs"];
        foreach (var l in all)
        {
            var f = l.Split(' ');
            if (f.Length < 4 || system.Contains(f[2])) continue;
            yield return $"Mount: {f[1]} ({f[2]}, {(f[3].Split(',').Contains("ro") ? "read-only" : "read/write")}{(Directory.Exists(f[1]) ? ", " + Free(f[1]) + " free" : "")})";
        }
    }

    /* Every five minutes, a line on how the server is: its memory, threads and the data folder's free space. */
    public static void StartSnapshots()
    {
        timer ??= new Timer(_ =>
        {
            try { Server.Log(Snapshot()); }
            catch (Exception e) { Console.Error.WriteLine("[snapshot] " + e.Message); }
        }, null, TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(5));
    }

    public static string Snapshot()
    {
        using var p = System.Diagnostics.Process.GetCurrentProcess();
        var up = DateTime.UtcNow - started;
        return $"[snapshot] up {(int)up.TotalHours}h{up.Minutes:00}m, memory {Mb(p.WorkingSet64)} (heap {Mb(GC.GetTotalMemory(false))}), " +
               $"threads {p.Threads.Count} (pool {ThreadPool.ThreadCount}, queued {ThreadPool.PendingWorkItemCount}), data {Free(Server.DataDir)} free";
    }

    private static string Offset()
    {
        var o = TimeZoneInfo.Local.GetUtcOffset(DateTime.UtcNow);
        return (o < TimeSpan.Zero ? "-" : "+") + o.ToString(@"hh\:mm", CultureInfo.InvariantCulture);
    }

    private static string Free(string dir)
    {
        try { return dir.Length == 0 ? "?" : Mb(new DriveInfo(Path.GetFullPath(dir)).AvailableFreeSpace); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException) { return "?"; }
    }

    private static string Mb(long bytes) => bytes >= 1L << 30
        ? (bytes / (double)(1L << 30)).ToString("0.0", CultureInfo.InvariantCulture) + " GB"
        : (bytes >> 20).ToString(CultureInfo.InvariantCulture) + " MB";
}
