// ReleaseNotes.cs — what Settings → Updates shows of a release (item 223): its short lines alone.
//
// A release's notes are its CHANGELOG.md section (release.yml), which opens with one short line for each change
// ("- Fixed - track times now show on albums", "- New - …", "- Redesign - …", "- Tweaks - …") above the entries the repository keeps
// (each branch, its item, what it changed and why). The update page shows the short lines, a bullet each, and none of
// the rest; a release without them shows no notes. tools/release-notes.js reads the same lines for the Android app's.
using System.Text.RegularExpressions;

namespace Mandarin.Server.Admin;

internal static partial class ReleaseNotes
{
    /// <summary>The kinds of change a short line names, as the update page writes them.</summary>
    public static readonly string[] Kinds = ["Fixed", "New", "Redesign", "Improved", "Changed", "Removed", "Tweaks"];

    /// <summary>The short lines of a release's notes ([body], markdown), "• Fixed - …" one to a line; null when it has none.</summary>
    public static string? Short(string? body)
    {
        var lines = new List<string>();
        foreach (var raw in (body ?? "").Split('\n'))
        {
            var m = Line().Match(raw.TrimEnd('\r'));
            if (!m.Success) continue;
            var kind = Kinds.First(k => k.Equals(m.Groups[1].Value, StringComparison.OrdinalIgnoreCase));
            var words = m.Groups[2].Value.Replace("**", "").Replace("`", "").Trim();
            if (words.Length > 0) lines.Add($"• {kind} - {words}");
        }
        return lines.Count > 0 ? string.Join("\n", lines) : null;
    }

    // A list line at the left edge (an entry's own points are indented), its kind, a dash or colon, its words.
    [GeneratedRegex(@"^[-*•]\s+(fixed|new|redesign|improved|changed|removed|tweaks)\s*[-–—:]\s+(.+)$", RegexOptions.IgnoreCase)]
    private static partial Regex Line();
}
