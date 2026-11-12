// Mounts.cs — what the server can see of the machine it runs on (v0.8.34),
// from lib/server/mounts.js: the drives and shares mounted into the system,
// read from /proc/self/mountinfo — for Settings → Music folders to offer. A
// share mounted only when it's first opened (DietPi's Drive Manager, an fstab
// line with x-systemd.automount) is said to be waiting until it is.
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mandarin.Server.Scan;

namespace Mandarin.Server;

internal static partial class Mounts
{
    internal sealed record Mount(string Path, string Type, string Source, bool Automount, bool Waiting, bool Follows)
    {
        public JsonObject ToJson() => new()
        {
            ["path"] = Path, ["type"] = Type, ["source"] = Source, ["automount"] = Automount, ["waiting"] = Waiting, ["follows"] = Follows
        };
    }

    // Mount points that are the system's own, never music.
    [GeneratedRegex(@"^/(proc|sys|dev|run|etc|boot|tmp|var/lib/docker|usr|lib|lib64|bin|sbin|opt/[^/]*)(/|$)|^/etc/")]
    private static partial Regex SystemPoint();
    private static readonly HashSet<string> Pseudo = ["proc", "sysfs", "devtmpfs", "devpts", "tmpfs", "cgroup", "cgroup2", "mqueue", "overlay",
        "securityfs", "debugfs", "tracefs", "pstore", "bpf", "configfs", "fusectl", "hugetlbfs", "nsfs", "binfmt_misc", "squashfs"];

    // "\040" and friends, as mountinfo writes spaces and tabs in paths.
    [GeneratedRegex(@"\\([0-7]{3})")]
    private static partial Regex Octal();
    internal static string Unescape(string s) => Octal().Replace(s, m => ((char)Convert.ToInt32(m.Groups[1].Value, 8)).ToString());

    private sealed record Line(string Point, bool Follows, string Type, string Source);

    private static List<Line> Parse(string text)
    {
        var outList = new List<Line>();
        foreach (var line in text.Split('\n'))
        {
            if (line.Trim().Length == 0) continue;
            var halves = line.Split(" - ");
            if (halves.Length < 2 || halves[1].Length == 0) continue;
            var a = halves[0].Split(' ');
            var b = halves[1].Split(' ');
            if (a.Length < 5) continue;
            outList.Add(new Line(Unescape(a[4]),
                // Optional fields: "shared:N", "master:N" (a slave: the host's later mounts follow).
                a.Skip(6).Any(f => f.StartsWith("master:", StringComparison.Ordinal) || f.StartsWith("shared:", StringComparison.Ordinal)),
                b[0], Unescape(b.Length > 1 ? b[1] : "")));
        }
        return outList;
    }

    /*
     * The music-looking mounts. [Waiting]: an automount stand-in with nothing
     * mounted on it yet (the share is mounted when it is first opened).
     */
    public static List<Mount> MusicMounts(string dataDir)
    {
        string text;
        try { text = File.ReadAllText("/proc/self/mountinfo"); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return []; }
        return MusicMounts(dataDir, text);
    }

    /* The same, from a mountinfo's text (`mandarin-server score` { fn: "mounts" }). */
    public static List<Mount> MusicMounts(string dataDir, string text)
    {
        var data = dataDir.Length > 0 ? NodePath.Resolve(dataDir) : null;
        var byPoint = new Dictionary<string, Mount>(StringComparer.Ordinal);
        var order = new List<string>();
        foreach (var m in Parse(text))
        {
            if (m.Point == "/" || SystemPoint().IsMatch(m.Point) || Pseudo.Contains(m.Type)) continue;
            if (data != null && (m.Point == data || m.Point.StartsWith(data + "/", StringComparison.Ordinal))) continue;
            byPoint.TryGetValue(m.Point, out var prev);
            if (prev == null) order.Add(m.Point);
            // Mounted over (an automount, then the share on it): the last one is what's seen.
            byPoint[m.Point] = new Mount(m.Point, m.Type, m.Source, m.Type == "autofs" || prev is { Automount: true }, m.Type == "autofs", m.Follows);
        }
        return order.Select(p => byPoint[p]).OrderBy(x => x.Path, Comparer<string>.Create(Library.Lc)).ToList();
    }
}
