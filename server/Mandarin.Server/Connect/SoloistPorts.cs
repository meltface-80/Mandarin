// SoloistPorts.cs — the TCP ports Soloist listens on (bug list item 502), for the log: the Spotify app finds Soloist by
// mDNS and then talks to it on a port of its own, which the system hands it; Mandarin OS's firewall lets in only the
// ports the system hands out (32768–60999) from the home network. Said once Soloist is up, so a Mandarin that the
// Spotify app doesn't show says why (a port outside that range, or none). Read from /proc: the process's sockets
// (/proc/<pid>/fd) matched with the listening ones in /proc/net/tcp and tcp6. Its own WebSocket (loopback) is left out.
using System.Globalization;

namespace Mandarin.Server.Connect;

internal static class SoloistPorts
{
    /* The range the system hands ports out from, which Mandarin OS opens to the home network. */
    public const int First = 32768, Last = 60999;

    /* The ports process [pid] listens on, on an address other than loopback; empty where /proc can't say. */
    public static List<int> Of(int pid, string proc = "/proc")
    {
        var inodes = new HashSet<string>(StringComparer.Ordinal);
        try
        {
            foreach (var fd in Directory.EnumerateFileSystemEntries(Path.Combine(proc, pid.ToString(CultureInfo.InvariantCulture), "fd")))
            {
                try
                {
                    var target = new FileInfo(fd).LinkTarget ?? "";
                    if (target.StartsWith("socket:[", StringComparison.Ordinal)) inodes.Add(target[8..^1]);
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* gone, or not ours */ }
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return []; }
        var ports = new SortedSet<int>();
        foreach (var table in new[] { "tcp", "tcp6" })
        {
            string[] lines;
            try { lines = File.ReadAllLines(Path.Combine(proc, "net", table)); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { continue; }
            foreach (var line in lines.Skip(1))
                if (Listening(line) is { } l && inodes.Contains(l.Inode) && !l.Loopback) ports.Add(l.Port);
        }
        return [.. ports];
    }

    /* A row of /proc/net/tcp(6): its port, inode and whether it is on loopback, when it is a listening socket (state 0A). */
    internal static (int Port, string Inode, bool Loopback)? Listening(string row)
    {
        var f = row.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (f.Length < 10 || f[3] != "0A") return null;
        var colon = f[1].LastIndexOf(':');
        if (colon < 0 || !int.TryParse(f[1][(colon + 1)..], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var port)) return null;
        var addr = f[1][..colon];
        // 127.x in /proc's byte order ends in 7F; ::1 is all zeros but the last 32 bits, 01000000.
        var loopback = addr.Length == 8 ? addr.EndsWith("7F", StringComparison.Ordinal) : addr == "00000000000000000000000001000000";
        return (port, f[9], loopback);
    }

    /* What the log says of [ports]. */
    public static string Words(IReadOnlyList<int> ports, string name)
    {
        if (ports.Count == 0) return $"Soloist isn't listening for the Spotify app yet: if {name} doesn't show in the Spotify app's devices, it can't be reached";
        var list = string.Join(", ", ports.Select(p => p.ToString(CultureInfo.InvariantCulture)));
        var outside = ports.Where(p => p is < First or > Last).ToList();
        return outside.Count == 0
            ? $"Soloist answers the Spotify app on TCP {list}"
            : $"Soloist answers the Spotify app on TCP {list}; Mandarin OS's firewall lets in {First}–{Last} only, so {name} may not show in the Spotify app";
    }
}
