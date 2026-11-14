// Extras/AutoCovers.Reach.cs — the cover finder when the music can't be reached
// (bug list item 410). An album whose folder isn't there can't be told about
// (Covers.Own: a picture of its own may be only out of reach), so it was left
// "to look at again" — and with a whole library pointing at folders that
// aren't on this computer (a backup from another install restored), every run
// looked at all of it again and said "14078 to look at again (a catalogue or a
// drive didn't answer)". Now the folder that isn't there is named instead (the
// music folder it is in when that is what's missing, else the highest folder
// missing on the way down to it), said once ("the music folders can't be
// reached (… not found): covers will be looked for once they are"), and its
// albums passed over quietly by the runs after, without a look at their files,
// until it is there again or the scan has found their files elsewhere (their
// folder then another). Settings → Library Scanner → Find covers says the same.
using System.Text.Json.Nodes;
using Mandarin.Server.Scan;

namespace Mandarin.Server.Extras;

internal sealed partial class AutoCovers
{
    // The folders found out of reach by the runs so far.
    private volatile string[] outOfReach = [];

    /* The folders out of reach still not there, as Settings says them. */
    private string[] StillOutOfReach() => [.. outOfReach.Where(f => !Directory.Exists(f))];

    /* What Settings says of them (added to the status): none when every folder is there. */
    private void SayReach(JsonObject status)
    {
        var away = StillOutOfReach();
        if (away.Length > 0) status["unreachable"] = new JsonArray([.. away.Select(f => (JsonNode)f)]);
    }

    /* One run's view of the folders out of reach: those found before and still missing, those found now. */
    private sealed class Reach(string[] before)
    {
        private readonly string[] known = [.. before.Where(f => !Directory.Exists(f))];
        private readonly List<string> folders = MusicFolders();
        private readonly Dictionary<string, int> found = new(StringComparer.Ordinal);

        /* Albums found out of reach in this run. */
        public int Found => found.Values.Sum();

        /* Every folder out of reach now, for the next run. */
        public string[] All => [.. known.Concat(found.Keys).Distinct(StringComparer.Ordinal)];

        /* Whether [al] can't be looked at for its folder being out of reach: one found before, passed over quietly. */
        public bool Away(Album al)
        {
            if (string.IsNullOrEmpty(al.Dir)) return false;
            if (known.Any(f => NodePath.IsInside(al.Dir, f))) return true;
            if (Missing(al.Dir, folders) is not { } m) return false;
            found[m] = found.GetValueOrDefault(m) + 1;
            return true;
        }

        /* The run's line on them, or none. */
        public string? Said() => found.Count == 0 ? null
            : $"{Found} album(s) not looked at: {Words([.. found.Keys])}";
    }

    /// <summary>"the music folders can't be reached (A, B not found): covers will be looked for once they are".</summary>
    internal static string Words(IReadOnlyList<string> away) =>
        $"the music folders can't be reached ({string.Join(", ", away.Take(3))}{(away.Count > 3 ? ", …" : "")} not found): covers will be looked for once they are";

    /// <summary>
    /// The folder that isn't there for an album in <paramref name="dir"/>: the music folder it is in (of
    /// <paramref name="folders"/>) when that is what's missing, else the highest folder missing on the way down to
    /// it. Null when its folder is there.
    /// </summary>
    internal static string? Missing(string dir, IReadOnlyList<string> folders)
    {
        if (Directory.Exists(dir)) return null;
        var top = folders.Where(f => NodePath.IsInside(dir, f)).OrderByDescending(f => f.Length).FirstOrDefault();
        if (top != null && !Directory.Exists(top)) return top;
        var d = dir;
        for (var up = Path.GetDirectoryName(d); up != null && up != top && !Directory.Exists(up); up = Path.GetDirectoryName(up)) d = up;
        return d;
    }

    /* The folders the library's albums are in: the scan's, and a restored backup's not on this computer. */
    private static List<string> MusicFolders()
    {
        var folders = Scans.Roots();
        try { using var c = Db.Open(); folders.AddRange(RestoredAway.Named(c)); }
        catch (Microsoft.Data.Sqlite.SqliteException) { /* the scan's alone */ }
        return folders;
    }
}
