// Mounts.cs — what the server can see of the machine it runs on (v0.8.34),
// from lib/server/mounts.js: the drives and shares mounted into its container
// (or, outside Docker, into the system), read from /proc/self/mountinfo — for
// Settings → Music folders to offer, and to say why a folder looks empty.
//
// The usual trap (DietPi's Drive Manager, and any fstab line with
// x-systemd.automount): a network share the host mounts only when it's first
// opened. Inside a container started with a plain -v /mnt:/mnt, that later
// mount never arrives — the folder stays an empty "autofs" stand-in — unless
// the -v line ends in :rslave (mounts made on the host afterwards then follow).
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
    private static string Unescape(string s) => Octal().Replace(s, m => ((char)Convert.ToInt32(m.Groups[1].Value, 8)).ToString());

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
     * mounted on it inside here — the share is on the host, but this container
     * can't see it.
     */
    public static List<Mount> MusicMounts(string dataDir)
    {
        string text;
        try { text = File.ReadAllText("/proc/self/mountinfo"); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return []; }
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

    /* A word about a folder being browsed, when there's something to say. */
    public static string? HintFor(string dir, List<Mount> mounts, int entries, bool docker)
    {
        var d = NodePath.Resolve(dir);
        var m = mounts.FirstOrDefault(x => x.Path == d);
        const string Fix = "Add :rslave to its -v line (e.g. -v /mnt:/mnt:ro,rslave) and re-create the container.";
        if (m is { Waiting: true })
            return "This is a share the machine mounts only when it's opened (DietPi's Drive Manager does this), and this container can't see it. " + Fix;
        if (entries == 0 && docker)
        {
            var inside = mounts.Any(x => x.Path == d || d.StartsWith(x.Path + "/", StringComparison.Ordinal));
            return inside
                ? "Empty here. If a drive or share is mounted at this folder on the machine after the container started, the container doesn't see it. " + Fix
                : "Nothing from the machine is mounted here. The server sees only what its container is given — add a -v line for your drives (e.g. -v /mnt:/mnt:ro,rslave).";
        }
        return null;
    }
}
