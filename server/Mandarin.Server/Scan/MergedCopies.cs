// MergedCopies.cs — telling two copies of a record apart where they are one album (bug list item 424): the ways Edit
// album's Split… offers to lay an album's tracks out in parts, and whether an album looks like two copies merged, for
// Settings → Library Scanner → Library clean-up. Only what the tracks say is read here; Scanner.Split.cs makes a split.
//   - By the version words in their titles: "Moanin' (Remastered 2013)" and "Moanin' (SACD Version)" (the words an
//     album's title names its edition with, ShelfFacts.SplitVersion), else in their files' names.
//   - By their format: 24/192 FLAC beside 24/88.2 FLAC.
//   - By a repeated track number, where nothing above tells them apart: the first track 1 of a disc is the first
//     copy's, the second the second's, by name.
// A way is offered only where it makes two parts or more, each of two tracks or more (a repeated number's of one or more).
using System.Globalization;
using System.Text.RegularExpressions;

namespace Mandarin.Server.Scan;

internal static partial class MergedCopies
{
    /* A track as the ways read it. */
    public sealed record Track(long Id, string Path, string Title, double? Disc, double? No, double? Rate, double? Bits, string? Codec);

    /* A way to split: its kind ("words", "format", "numbers"), what it is called, and its parts, each named, biggest first. */
    public sealed record Way(string By, string Name, List<(string Name, List<Track> Tracks)> Parts);

    [GeneratedRegex(@"^\s*(?:[0-9]+[-.]?)?[0-9]+\s*[-._)]*\s*")] private static partial Regex Numbered();

    /* A track's version words: its title's, else its file name's; "" where neither has any. */
    private static string Words(Track t) =>
        ShelfFacts.SplitVersion(t.Title)?.Version ?? ShelfFacts.SplitVersion(Numbered().Replace(NodePath.Basename(t.Path, NodePath.Extname(t.Path)), ""))?.Version ?? "";

    /* A track's format: "24/192 FLAC", "16/44.1 MP3". */
    private static string Format(Track t)
    {
        var rate = t.Rate is double r && r > 0 ? ShelfFacts.RateShort((long)r) : "?";
        var q = t.Bits is double b && b > 0 ? b.ToString("0", CultureInfo.InvariantCulture) + "/" + rate : rate + " kHz";
        return string.IsNullOrEmpty(t.Codec) ? q : q + " " + t.Codec!.ToUpperInvariant();
    }

    /* Its disc: the tag's, else the disc folder's ("CD2"), else 1. */
    private static double DiscOf(Track t)
    {
        if (t.Disc is double d && d > 0) return d;
        var m = ScanNames.DiscDir().Match(NodePath.Basename(NodePath.Dirname(t.Path)));
        return m.Success && double.TryParse(m.Groups[2].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : 1;
    }

    /* Whether a track number comes twice on one disc. */
    public static bool Repeats(IEnumerable<Track> tracks)
    {
        var seen = new HashSet<(double, double)>();
        foreach (var t in tracks) if (t.No is double n && n > 0 && !seen.Add((DiscOf(t), n))) return true;
        return false;
    }

    /* The ways [tracks] (one album's) can be split, each a different layout. */
    public static List<Way> Ways(IReadOnlyList<Track> tracks)
    {
        var ways = new List<Way>();
        void Offer(string by, string name, Func<Track, string> partOf, int least, Func<string, string>? named = null)
        {
            var parts = tracks.GroupBy(partOf).Select(g => (Name: named?.Invoke(g.Key) ?? g.Key, Tracks: g.ToList()))
                .OrderByDescending(p => p.Tracks.Count).ThenBy(p => p.Name, StringComparer.Ordinal).ToList();
            if (parts.Count < 2 || parts.Any(p => p.Tracks.Count < least)) return;
            // The same layout as a way already offered: once.
            var layout = string.Join("|", parts.Select(p => string.Join(",", p.Tracks.Select(t => t.Id).Order())).Order(StringComparer.Ordinal));
            if (ways.Any(w => string.Join("|", w.Parts.Select(p => string.Join(",", p.Tracks.Select(t => t.Id).Order())).Order(StringComparer.Ordinal)) == layout)) return;
            ways.Add(new Way(by, name, parts));
        }
        Offer("words", "By the version words in the titles", Words, 2, w => w.Length > 0 ? w : "No version words");
        Offer("format", "By format", Format, 2);
        if (ways.Count == 0 && Repeats(tracks))   // only where nothing else tells the copies apart
        {
            var copy = new Dictionary<long, int>();
            var count = new Dictionary<(double, double), int>();
            foreach (var t in tracks.OrderBy(t => t.Path, StringComparer.Ordinal))
            {
                var k = (DiscOf(t), t.No is double n && n > 0 ? n : -t.Id);
                copy[t.Id] = count[k] = count.GetValueOrDefault(k) + 1;
            }
            Offer("numbers", "By the repeated track numbers", t => copy[t.Id].ToString(CultureInfo.InvariantCulture), 1, c => "Copy " + c);
        }
        return ways;
    }

    /* A part's name as a key may hold it: no control characters, trimmed, 60 characters at most, never empty. */
    public static string PartName(string name)
    {
        var s = new string([.. name.Where(c => !char.IsControl(c))]).Trim();
        if (s.Length > 60) s = s[..60].Trim();
        return s.Length > 0 ? s : "Part";
    }
}
