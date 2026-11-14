// Scanner.Discs.cs — one album whose tags name its discs (item 414; out of Scanner.cs, which only shrinks). Disc
// folders ("CD1", "Disc 2"…) were one album already, so long as their tracks' album tags agree; a rip that writes the
// disc into the album tag ("The Wall (Disc 1)", "The Wall CD2") made one album of each disc, and identification then
// looked each up apart. Two discs or more of one title in one folder are now one album under the title without its
// disc, each track with no disc number of its own given the one its tag names. A single disc stays as it was named.
using System.Globalization;
using System.Text.RegularExpressions;

namespace Mandarin.Server.Scan;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Scanner
{
    // "The Wall (Disc 1)", "The Wall [CD 2]", "The Wall - Disc 2 of 2", "The Wall CD2": the title, and which disc.
    [GeneratedRegex(@"^(.*?)[\s\-–—:,(\[]*\b(?:cd|disc|disk)\s*0?([0-9]{1,2})(?:\s*of\s*[0-9]{1,2})?\s*[)\]]?\s*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex DiscTitle();

    /* The title without the disc it names, and the disc; null when it names none. */
    internal static (string Title, double Disc)? DiscOfTitle(string title)
    {
        var m = DiscTitle().Match(title);
        if (!m.Success || m.Groups[1].Value.Trim().Length == 0) return null;
        return (m.Groups[1].Value.Trim(), double.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture));
    }

    /* A folder's groups with each set of discs of one title made one, in the place of its first disc. */
    private static List<Group> DiscSets(List<Group> groups)
    {
        var named = groups.Select(g => (Group: g, Of: DiscOfTitle(g.Title))).ToList();
        var outList = new List<Group>();
        var done = new HashSet<Group>();
        foreach (var (g, of) in named)
        {
            if (done.Contains(g)) continue;
            var set = of is { } o ? named.Where(x => x.Of is { } xo && ScanNames.Key(xo.Title) == ScanNames.Key(o.Title)).ToList() : [];
            if (set.Select(x => x.Of!.Value.Disc).Distinct().Count() < 2) { outList.Add(g); continue; }
            var one = new Group { Title = of!.Value.Title };
            foreach (var (part, partOf) in set)
            {
                done.Add(part);
                foreach (var r in part.Rows)
                {
                    if (!Js.Truthy(r["disc_no"])) r["disc_no"] = partOf!.Value.Disc;
                    one.Rows.Add(r);
                }
            }
            outList.Add(one);
        }
        return outList;
    }
}
