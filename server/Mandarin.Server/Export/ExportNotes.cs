// ExportNotes.cs — an album's title and artist as the library export writes them (item 442): the title alone, never
// the notes a folder name or a tag carries after it. Mandarin Migration groups rows into albums by title and artist and
// looks the album up on Qobuz by them, so "Still Coming Down (2026)", "Holocene (2023) (2)", "Under A Groove CD2",
// "Brilliant (12 tracks)", "Abbey Road (Original)", "Vienna (16 bit – 44.1 kHz)" were an album no one released. What is
// stripped is said (the export's "stripped" column), for the tags to be put right where they are wrong; the year goes in
// the year column and a disc's number in the disc column, so a set ripped a disc an album is one album again. An
// edition's own words ("(Remastered)", "(Deluxe Edition)") are the title's and stay.
//
// A value taken from a folder's name (no tag said it) is read the way a folder is named: "_" for the ":" a file system
// refuses, "Artist - Title", a year after it, "REM - Discography" for the artist's folder.
using System.Globalization;
using System.Text.RegularExpressions;

namespace Mandarin.Server.Export;

internal static partial class ExportNotes
{
    /// <summary>A title cleaned: its [Text], the [Year] and [Disc] its notes said, and each note [Stripped].</summary>
    public sealed record Title(string Text, long? Year, int? Disc, List<string> Stripped);

    [GeneratedRegex(@"\s*[\(\[]((?:19|20)\d\d)[\)\]]$")] private static partial Regex YearNote();
    [GeneratedRegex(@"\s*\(([1-9]\d?)\)$")] private static partial Regex CopyNote();
    [GeneratedRegex(@"\s*(?:[-–]\s*)?[\(\[]?\s*\b(?:CD|Dis[ck])\s*([1-9]\d?)(?:\s*(?:of|/)\s*\d{1,2})?\s*[\)\]]?$", RegexOptions.IgnoreCase)] private static partial Regex DiscNote();
    [GeneratedRegex(@"\s*[\(\[]\d{1,3}\s+tracks?[\)\]]$", RegexOptions.IgnoreCase)] private static partial Regex TracksNote();
    [GeneratedRegex(@"\s*[\(\[]original[\)\]]$", RegexOptions.IgnoreCase)] private static partial Regex OriginalNote();
    [GeneratedRegex(@"\s*(?:[-–]\s*)?[\(\[][^\(\)\[\]]*\d(?:[.,]\d+)?\s*khz[^\(\)\[\]]*[\)\]]$", RegexOptions.IgnoreCase)] private static partial Regex FormatNote();
    [GeneratedRegex(@"\s*[\(\[]((?:19|20)\d\d)\s+release[\)\]]$", RegexOptions.IgnoreCase)] private static partial Regex ReleaseNote();
    [GeneratedRegex(@"\s*[\(\[]([A-Z]{0,6}[\s-]?\d[\d\s./-]{3,}\d)[\)\]]$")] private static partial Regex CatnoNote();
    [GeneratedRegex(@"^(?:19|20)\d\d\s*[-–/]\s*(?:19|20)?\d\d$")] private static partial Regex YearSpan();
    [GeneratedRegex(@"\s+((?:19|20)\d\d)$")] private static partial Regex BareYear();
    [GeneratedRegex(@"_(?=\s|$)")] private static partial Regex ColonAsUnderscore();
    [GeneratedRegex(@"\s*(?:[-–]\s*)?[\(\[]?\s*(?:the\s+)?(?:complete\s+)?discography\b.*$", RegexOptions.IgnoreCase)] private static partial Regex DiscographyNote();

    /// <summary>[raw] as a title alone, by [artist] (the album's, as exported); [fromPath]: it is a folder's name, not a tag.</summary>
    public static Title Clean(string raw, string artist, bool fromPath)
    {
        var t = raw.Trim();
        var stripped = new List<string>();
        long? year = null;
        int? disc = null;
        if (fromPath)
        {
            if (ColonAsUnderscore().IsMatch(t)) { t = ColonAsUnderscore().Replace(t, ":").TrimEnd(':').Trim(); stripped.Add("\"_\" read as \":\""); }
            // "REM - Murmur": the artist's name before the title, as a folder is named.
            var dash = t.IndexOf(" - ", StringComparison.Ordinal);
            if (dash > 0 && artist.Length > 0 && Library.ExportCanon(t[..dash]) == Library.ExportCanon(artist)) { stripped.Add(t[..(dash + 3)].Trim()); t = t[(dash + 3)..].Trim(); }
            if (BareYear().Match(t) is { Success: true } by && by.Index > 0) { year = Year(by.Groups[1].Value); stripped.Add(by.Value.Trim()); t = t[..by.Index].Trim(); }
        }
        else if (ColonAsUnderscore().IsMatch(t) && t.Contains("_ ", StringComparison.Ordinal)) { t = ColonAsUnderscore().Replace(t, ":").Trim(); stripped.Add("\"_\" read as \":\""); }
        for (var changed = true; changed;)
        {
            changed = false;
            bool Off(Regex re, Action<Match>? said = null)
            {
                var m = re.Match(t);
                if (!m.Success || m.Index == 0) return false;   // never the whole title
                said?.Invoke(m);
                stripped.Add(m.Value.Trim().TrimStart('-', '–').Trim());
                t = t[..m.Index].TrimEnd(' ', '-', '–', ',');
                return changed = true;
            }
            if (Off(YearNote(), m => year ??= Year(m.Groups[1].Value))) continue;
            if (Off(CopyNote())) continue;
            if (Off(DiscNote(), m => disc ??= int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture))) continue;
            if (Off(TracksNote()) || Off(OriginalNote()) || Off(FormatNote())) continue;
            if (Off(ReleaseNote(), m => year ??= Year(m.Groups[1].Value))) continue;
            var cat = CatnoNote().Match(t);
            if (cat.Success && cat.Index > 0 && !YearSpan().IsMatch(cat.Groups[1].Value.Trim()) && cat.Groups[1].Value.Count(char.IsAsciiDigit) >= 4) Off(CatnoNote());
        }
        return new Title(t, year, disc, stripped);
    }

    /// <summary>[raw] as an artist's name; [fromPath]: a folder's name ("REM - Discography"). What was taken off it, else null.</summary>
    public static (string Text, string? Stripped) Artist(string raw, bool fromPath)
    {
        var a = raw.Trim();
        var m = DiscographyNote().Match(a);
        if (m.Success && m.Index > 0) return (a[..m.Index].TrimEnd(' ', '-', '–'), m.Value.Trim());
        if (fromPath && ColonAsUnderscore().IsMatch(a)) return (ColonAsUnderscore().Replace(a, ":").TrimEnd(':').Trim(), "\"_\" read as \":\"");
        return (a, null);
    }

    /// <summary>Whether [title] (as exported) still ends in a note the export strips, or holds what only a folder's name does: the export's own check.</summary>
    public static bool Noted(string title) =>
        YearNote().IsMatch(title) || CopyNote().IsMatch(title) || DiscNote().IsMatch(title) || TracksNote().IsMatch(title) || OriginalNote().IsMatch(title)
        || (title.Contains("bit", StringComparison.OrdinalIgnoreCase) && title.Contains("khz", StringComparison.OrdinalIgnoreCase))
        || title.Contains("Discography", StringComparison.OrdinalIgnoreCase) || title.Contains("_ ", StringComparison.Ordinal);

    private static long Year(string s) => long.Parse(s, CultureInfo.InvariantCulture);
}
