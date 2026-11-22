// AlbumMerge.cs — the albums the owner merges into one (bug list item 512): which comes first, and what the one is
// called. A set released as albums of its own ("At The "Golden Circle" Stockholm Volume One", "… Volume Two"; "Motion I",
// "Motion II"; "Kind of Blue (Disc 2)") is merged from the library's selection menu in any order: each album's place is
// the number its title ends on (Volume, Vol., Disc, CD, Part, Book… then a figure, a Roman numeral or the word, or a
// figure or Roman numeral alone at the end), the albums that name none after those that do, in the order chosen. The
// one album is called by what the titles share without their numbers ("At The "Golden Circle" Stockholm"), else by its
// first disc's title. Kept and applied by AlbumMergeRoutes.cs, Scan/Scanner.Merge.cs and IBroadcastMerges.cs.
using System.Globalization;
using System.Text.RegularExpressions;

namespace Mandarin.Server;

internal static partial class AlbumMerge
{
    private static readonly string[] Words = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

    // "Volume One", "Vol. 2", "(Disc 2)", "[CD 3]", "Part II", "Book 1 of 2": the last in the title.
    [GeneratedRegex(@"[\s\-–—:,.(\[]*\b(?:vol(?:ume)?|disc|disk|cd|part|pt|book|chapter)\.?\s*(?<n>[0-9]{1,3}|[ivxlc]{1,7}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b(?:\s*of\s*[0-9]{1,3})?\s*[)\]]?", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.RightToLeft)]
    private static partial Regex Marked();

    // "Motion II", "Motion 2": a figure or Roman numeral alone at the end.
    [GeneratedRegex(@"\s+[(\[]?(?<n>[0-9]{1,3}|[ivx]{1,5})[)\]]?\s*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Ending();

    [GeneratedRegex(@"[\s\-–—:,.;/(\[]+$")]
    private static partial Regex Trailing();

    [GeneratedRegex(@"\s+(?:vol(?:ume)?|disc|disk|cd|part|pt|book|chapter)\.?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex DanglingWord();

    /// <summary>The number [title] names itself by (its volume, disc or part), and the title without it; null when it names none.</summary>
    public static (double N, string Without)? VolumeOf(string title)
    {
        var m = Marked().Match(title);
        if (!m.Success) m = Ending().Match(title);
        if (!m.Success || Number(m.Groups["n"].Value) is not double n) return null;
        var rest = Trailing().Replace((title[..m.Index] + " " + title[(m.Index + m.Length)..]).Trim(), "").Trim();
        return rest.Length == 0 ? null : (n, rest);
    }

    private static double? Number(string s)
    {
        if (double.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var d)) return d;
        var w = Array.IndexOf(Words, s.ToLowerInvariant());
        if (w >= 0) return w + 1;
        return Roman(s.ToLowerInvariant());
    }

    private static double? Roman(string s)
    {
        int total = 0, prev = 0;
        for (var i = s.Length - 1; i >= 0; i--)
        {
            var v = s[i] switch { 'i' => 1, 'v' => 5, 'x' => 10, 'l' => 50, 'c' => 100, _ => 0 };
            if (v == 0) return null;
            total += v < prev ? -v : v;
            prev = Math.Max(prev, v);
        }
        return total > 0 ? total : null;
    }

    /// <summary>The order the albums of [titles] (as chosen) are discs in: indexes into [titles], the first disc first.</summary>
    public static List<int> Order(IReadOnlyList<string> titles) =>
        [.. titles.Select((t, i) => (I: i, N: VolumeOf(t)?.N ?? double.PositiveInfinity)).OrderBy(x => x.N).ThenBy(x => x.I).Select(x => x.I)];

    /// <summary>What the merged album is called, of its albums' [titles] in disc order.</summary>
    public static string TitleOf(IReadOnlyList<string> titles)
    {
        if (titles.Count == 0) return "";
        var rests = titles.Select(t => VolumeOf(t)?.Without ?? t).ToList();
        if (rests.All(r => string.Equals(r, rests[0], StringComparison.OrdinalIgnoreCase))) return rests[0];
        var shared = rests.Aggregate((a, b) =>
        {
            var n = 0;
            while (n < a.Length && n < b.Length && char.ToLowerInvariant(a[n]) == char.ToLowerInvariant(b[n])) n++;
            return a[..n];
        });
        // Whole words only, with nothing left hanging ("Stockholm Volume" → "Stockholm").
        if (rests.Any(r => r.Length > shared.Length && char.IsLetterOrDigit(r[shared.Length])) && shared.LastIndexOf(' ') is var sp && sp > 0) shared = shared[..sp];
        shared = DanglingWord().Replace(Trailing().Replace(shared, ""), "");
        shared = Trailing().Replace(shared, "").Trim();
        return shared.Length >= 3 ? shared : titles[0];
    }
}
