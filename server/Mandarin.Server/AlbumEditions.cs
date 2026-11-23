// AlbumEditions.cs — an album's title as the album and its edition (bug list items 522, 523): "Second Wind (Deluxe
// Edition)", "Second Wind [2011 Remaster]" and "Second Wind - Remastered 2011" are all Second Wind, as the stores
// write the same album's editions. Taken off the end only, a part at a time: a bracketed part or a part
// after " - " that names an edition (Music Assistant's VERSION_PARTS, and a year alone), or credits another artist
// ("feat. …", dropped without being kept as the edition). The title itself is never cut: "Live at Leeds" stays.
using System.Text.RegularExpressions;
using Mandarin.Server.Extras;

namespace Mandarin.Server;

internal static partial class AlbumEditions
{
    // An edition's words, whole words of the part: Music Assistant's (helpers/util.py VERSION_PARTS), with the editions
    // the stores name most (expanded, special, super, legacy, collector's, reissue, mono) and a year on its own.
    [GeneratedRegex(@"\b(version|versie|live|edit|remix|mix|acoustic|akoestisch|instrumental|karaoke|remaster|remastered|unplugged|deluxe|video|radio|extended|single|edition|anniversary|stereo|mono|album|bonus|release|expanded|special|super|legacy|collector'?s|reissue|hi-?res|\d{4})\b", RegexOptions.IgnoreCase)]
    private static partial Regex EditionWords();

    [GeneratedRegex(@"^(feat\.?|featuring|ft\.?|with)\s", RegexOptions.IgnoreCase)]
    private static partial Regex Credit();

    /* [title] as its album ("Second Wind") and its edition ("Deluxe Edition", "Remastered 2011"; "" for none). */
    public static (string Album, string Edition) Split(string title)
    {
        var rest = title.Trim();
        var editions = new List<string>();
        for (;;)
        {
            var (before, part) = LastPart(rest);
            if (part == null || before.Length == 0) break;
            if (Credit().IsMatch(part)) { rest = before; continue; }
            if (!EditionWords().IsMatch(part)) break;
            editions.Insert(0, part);
            rest = before;
        }
        return (rest, string.Join(" ", editions));
    }

    // Editions that make another album, not another edition of it (Music Assistant keeps them apart too): kept in the key.
    [GeneratedRegex(@"\b(live|remix(es)?|acoustic|akoestisch|unplugged|instrumental|karaoke|demos?|sessions?|covers?)\b", RegexOptions.IgnoreCase)]
    private static partial Regex OtherAlbum();

    /*
     * What two titles are compared by: the album's name without its edition, folded as the library folds names; a
     * live, remixed, acoustic or instrumental edition's words kept, so "Album (Live)" is not "Album".
     */
    public static string Key(string title)
    {
        var (album, edition) = Split(title);
        var other = string.Join(" ", OtherAlbum().Matches(edition).Select(m => m.Value.ToLowerInvariant()));
        return Similar.Normalize(other.Length > 0 ? album + " " + other : album);
    }

    // The last part of [s]: a bracketed one at its end, else what follows its last " - "; the rest before it, trimmed.
    private static (string Before, string? Part) LastPart(string s)
    {
        if (s.Length > 2 && s[^1] is ')' or ']')
        {
            char close = s[^1], open = close == ')' ? '(' : '[';
            int depth = 0;
            for (int i = s.Length - 1; i >= 0; i--)
            {
                if (s[i] == close) depth++;
                else if (s[i] == open && --depth == 0) return (s[..i].TrimEnd(' ', '-', '–'), s[(i + 1)..^1].Trim());
            }
            return (s, null);
        }
        var dash = Math.Max(s.LastIndexOf(" - ", StringComparison.Ordinal), s.LastIndexOf(" – ", StringComparison.Ordinal));
        return dash > 0 ? (s[..dash].TrimEnd(), s[(dash + 3)..].Trim()) : (s, null);
    }
}
