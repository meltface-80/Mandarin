// ScanNames.cs — the names the scan gives albums (v0.8.18), as the Node
// server's scan gives them: lib/library/normalize.js (fold, key, sortName) and
// lib/library/names.js (what the folders and file names say of a track whose
// tags don't), rule for rule. An album's key is made of these, so they keep
// JavaScript's own rules: its lower-casing (Final_Sigma and all, Tags/Case.cs),
// its white space, \d as ASCII digits, \b and /i as ASCII-only, and $ at the
// very end.
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Scan;

// The tag reader's JavaScript, not Mandarin.Server's JSON helpers of the same name.
using Js = Mandarin.Server.Tags.Js;

internal static partial class ScanNames
{
    // JavaScript's \s, and the . that stops at a line end.
    public const string Ws = @"[\t\n\v\f\r    -     　﻿]";
    public const string NotWs = @"[^\t\n\v\f\r    -     　﻿]";
    public const string Dot = @"[^\n\r  ]";
    // \b after a word character: the next is not one (ASCII words, as JavaScript has them).
    private const string WordEnd = @"(?![A-Za-z0-9_])";

    // ------------------------------------------------------------ normalize.js

    /* String.prototype.normalize("NFKD"), which leaves a lone surrogate as it is (.NET would throw). */
    public static string Nfkd(string s)
    {
        var lone = false;
        for (var i = 0; i < s.Length; i++)
        {
            if (char.IsHighSurrogate(s[i]) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) { i++; continue; }
            if (char.IsSurrogate(s[i])) { lone = true; break; }
        }
        if (!lone) return s.Normalize(NormalizationForm.FormKD);
        var sb = new StringBuilder(s.Length);
        var start = 0;
        for (var i = 0; i < s.Length; i++)
        {
            if (char.IsHighSurrogate(s[i]) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) { i++; continue; }
            if (!char.IsSurrogate(s[i])) continue;
            if (i > start) sb.Append(s[start..i].Normalize(NormalizationForm.FormKD));
            sb.Append(s[i]);
            start = i + 1;
        }
        if (start < s.Length) sb.Append(s[start..].Normalize(NormalizationForm.FormKD));
        return sb.ToString();
    }

    private static bool LetterOrNumber(int cp) => CharUnicodeInfo.GetUnicodeCategory(cp) switch
    {
        UnicodeCategory.UppercaseLetter or UnicodeCategory.LowercaseLetter or UnicodeCategory.TitlecaseLetter
            or UnicodeCategory.ModifierLetter or UnicodeCategory.OtherLetter
            or UnicodeCategory.DecimalDigitNumber or UnicodeCategory.LetterNumber or UnicodeCategory.OtherNumber => true,
        _ => false
    };

    /*
     * fold: .normalize("NFKD"), the marks U+0300–U+036F dropped, .toLowerCase(),
     * & as " and ", every run of what isn't a letter or a number one space,
     * .trim(), runs of white space one space.
     */
    public static string Fold(string? s)
    {
        var t = Nfkd(s ?? "");
        var noMarks = new StringBuilder(t.Length);
        foreach (var c in t) if (c < '̀' || c > 'ͯ') noMarks.Append(c);
        t = Js.Lower(noMarks.ToString()).Replace("&", " and ", StringComparison.Ordinal);
        var sb = new StringBuilder(t.Length);
        var inRun = false;
        for (var i = 0; i < t.Length; i++)
        {
            int cp = t[i];
            var width = 1;
            if (char.IsHighSurrogate(t[i]) && i + 1 < t.Length && char.IsLowSurrogate(t[i + 1])) { cp = char.ConvertToUtf32(t[i], t[i + 1]); width = 2; }
            var keep = !(cp >= 0xD800 && cp <= 0xDFFF) && LetterOrNumber(cp);
            if (keep) { sb.Append(t, i, width); inRun = false; }
            else if (!inRun) { sb.Append(' '); inRun = true; }
            i += width - 1;
        }
        t = Js.Trim(sb.ToString());
        return WsRun().Replace(t, " ");
    }

    [GeneratedRegex(Ws + "+")]
    private static partial Regex WsRun();

    /* Library identity: case, accents and punctuation do not make a new album. */
    public static string Key(string? s) => Fold(s);

    [GeneratedRegex("^(" + Dot + "*)," + Ws + "*([tT][hH][eE]|[aA]|[aA][nN])\\z")]
    private static partial Regex TrailingArticle();

    [GeneratedRegex("^([tT][hH][eE]|[aA]|[aA][nN])" + Ws + "+")]
    private static partial Regex LeadingArticle();

    /* "The Beatles" and "Beatles, The" sort as "beatles". */
    public static string SortName(string? s)
    {
        var t = Js.Trim(s ?? "");
        var m = TrailingArticle().Match(t);
        var b = m.Success ? m.Groups[1].Value : LeadingArticle().Replace(t, "", 1);
        return Fold(b);
    }

    // ---------------------------------------------------------------- names.js

    // "CD1", "Disc 2", "DISC 1", "cd 2", "Side 1": one album split across folders.
    [GeneratedRegex("^([cC][dD]|[dD][iI][sS][cC]|[dD][iI][sS][kK]|[sS][iI][dD][eE])" + Ws + "*[-_.]?" + Ws + "*([0-9]+)" + WordEnd)]
    public static partial Regex DiscDir();

    // Folders that hold artists rather than being one, never taken for an artist's name.
    [GeneratedRegex("^([mM][uU][sS][iI][cC]|[mM][yY] ?[mM][uU][sS][iI][cC]|[mM][uU][sS][iI][cC] [lL][iI][bB][rR][aA][rR][yY]|[lL][iI][bB][rR][aA][rR][yY]|[fF][lL][aA][cC]|[mM][pP]3"
        + "|[hH][iI]-?[rR][eE][sS]|[lL][oO][sS][sS][lL][eE][sS][sS]|[aA][lL][bB][uU][mM][sS]?|[aA][rR][tT][iI][sS][tT][sS]?|[dD][oO][wW][nN][lL][oO][aA][dD][sS]?|[mM][eE][dD][iI][aA]"
        + "|[aA][uU][dD][iI][oO]|[rR][iI][pP][sS]?|[cC][dD][sS]?|[vV][iI][nN][yY][lL]|[vV][aA][rR][iI][oO][uU][sS]|[cC][oO][mM][pP][iI][lL][aA][tT][iI][oO][nN][sS]?"
        + "|[sS][oO][uU][nN][dD][tT][rR][aA][cC][kK][sS]?|[0-9]+ ?[tTgG][bB]|[a-zA-Z]:?)\\z")]
    private static partial Regex NotArtist();

    /* names.js fold: lower-cased, decomposed, then only a–z and 0–9 kept. */
    private static string FoldAz(string? s)
    {
        var t = Nfkd(Js.Lower(s ?? ""));
        var sb = new StringBuilder(t.Length);
        foreach (var c in t) if (c is >= 'a' and <= 'z' or >= '0' and <= '9') sb.Append(c);
        return sb.ToString();
    }

    [GeneratedRegex(Ws + "*[(\\[]([0-9]{4})[)\\]]" + Ws + "*\\z")]
    private static partial Regex YearAtEnd();

    [GeneratedRegex("^[(\\[]?([0-9]{4})[)\\]]?" + Ws + "*[-–.]" + Ws + "+(" + Dot + "+)\\z")]
    private static partial Regex YearAtStart();

    /* "Album (1993)", "Album [1993]", "1993 - Album": the album and its year. */
    public static (string Album, double? Year) AlbumAndYear(string? name)
    {
        var album = Js.Trim(name ?? "");
        double? year = null;
        var m = YearAtEnd().Match(album);
        if (m.Success) { year = double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture); album = Js.Trim(album[..m.Index]); }
        else if ((m = YearAtStart().Match(album)).Success) { year = double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture); album = Js.Trim(m.Groups[2].Value); }
        // (A year of 0 is kept, as there: falsy, it is never used.)
        if (year is double y && y != 0 && (y < 1900 || y > 2100)) year = null;
        return (album, year);
    }

    [GeneratedRegex("^(?:[cC][dD]|[dD][iI][sS][cC]|[dD][iI][sS][kK])" + Ws + "*[-_.]?" + Ws + "*([0-9]+)" + Ws + "*[-–—:_.]" + Ws + "*(" + NotWs + Dot + "*)\\z")]
    private static partial Regex NamedDisc();

    [GeneratedRegex("^(" + Dot + "+?)" + Ws + "+[-–]" + Ws + "+" + NotWs)]
    private static partial Regex LeadArtist();

    [GeneratedRegex("^(" + Dot + "+?)" + Ws + "+[-–]" + Ws + "+(" + Dot + "+)\\z")]
    private static partial Regex ArtistDashAlbum();

    [GeneratedRegex("^(?:([0-9]{1,2})[-.]([0-9]{1,3})|([0-9]{1,3}))(?:" + Ws + "*[-._]" + Ws + "*|" + Ws + "+)(" + Dot + "+)\\z")]
    private static partial Regex FileName();

    internal sealed record FromNamesResult(string? Artist, string? Album, double? Year, double? Disc, double? Track, string? Title);

    /*
     * What the names say: { artist, album, year, disc, track, title }, each null
     * where they say nothing. roots: the music folders, never read as an artist.
     */
    public static FromNamesResult FromNames(string file, IReadOnlyList<string> roots)
    {
        var dir = NodePath.Dirname(file);
        double? disc = null;
        // "Disc 4 - Tales From Topographic Oceans (1973)": a box set's disc that
        // is an album of its own (v0.6.3) — its name and year are this folder's.
        var named = NamedDisc().Match(NodePath.Basename(dir));
        var dm = DiscDir().Match(NodePath.Basename(dir));
        if (dm.Success) { disc = double.Parse(dm.Groups[2].Value, CultureInfo.InvariantCulture); dir = NodePath.Dirname(dir); }
        bool IsRoot(string d) => roots.Any(r => NodePath.Resolve(r) == NodePath.Resolve(d)) || NodePath.Dirname(d) == d;
        var inRoot = roots.Count == 0 || roots.Any(r => NodePath.IsInside(NodePath.Resolve(dir), NodePath.Resolve(r)));
        string? album;
        double? year;
        if (named.Success) (album, year) = AlbumAndYear(named.Groups[2].Value);
        else if (IsRoot(dir)) (album, year) = (null, null);
        else (album, year) = AlbumAndYear(NodePath.Basename(dir));
        var parent = NodePath.Dirname(dir);
        string? artist = !IsRoot(dir) && inRoot && !IsRoot(parent) && !NotArtist().IsMatch(NodePath.Basename(parent)) ? NodePath.Basename(parent) : null;
        // A named disc's artist: the box folder's "Artist - " (v0.6.3), else the folder above the box.
        if (named.Success)
        {
            var lead = LeadArtist().Match(NodePath.Basename(dir));
            if (lead.Success) artist = Js.Trim(lead.Groups[1].Value);
            else if (!IsRoot(dir) && inRoot && !IsRoot(parent) && !NotArtist().IsMatch(NodePath.Basename(parent))) artist = NodePath.Basename(parent);
        }
        // "Artist - Album" as the album's folder: when the parent isn't the artist already, or says the same name.
        if (!string.IsNullOrEmpty(album) && !named.Success)
        {
            var m = ArtistDashAlbum().Match(album);
            if (m.Success && (string.IsNullOrEmpty(artist) || FoldAz(m.Groups[1].Value) == FoldAz(artist)))
            {
                artist = Js.Trim(m.Groups[1].Value);
                var r = AlbumAndYear(m.Groups[2].Value);
                album = r.Album;
                year = r.Year is double ry && ry != 0 ? ry : year;
            }
        }
        // The file: "1-01 - Title", "01 - Title", "01. Title", "01 Title"; an
        // "Artist - " in front of the title is the artist again, not the title.
        var baseName = NodePath.Basename(file, NodePath.Extname(file));
        var fm = FileName().Match(baseName);
        var title = fm.Success ? Js.Trim(fm.Groups[4].Value) : Js.Trim(baseName);
        if (!string.IsNullOrEmpty(artist)) title = StripLeadingArtist(title, artist);
        double? trackNo = null;
        if (fm.Success) trackNo = double.Parse(fm.Groups[2].Success && fm.Groups[2].Value.Length > 0 ? fm.Groups[2].Value : fm.Groups[3].Value, CultureInfo.InvariantCulture);
        double? discNo = disc is double dd && dd != 0 ? dd
            : fm.Success && fm.Groups[1].Success && fm.Groups[1].Value.Length > 0 ? double.Parse(fm.Groups[1].Value, CultureInfo.InvariantCulture) : null;
        return new FromNamesResult(
            string.IsNullOrEmpty(artist) ? null : artist,
            string.IsNullOrEmpty(album) ? null : album,
            year,
            discNo,
            trackNo,
            string.IsNullOrEmpty(title) ? null : title);
    }

    /* JavaScript's /i without the u flag: a code unit as its upper case, if that is one code unit (and stays above ASCII). */
    private static char Canonicalize(char ch)
    {
        var u = Js.Upper(ch.ToString());
        if (u.Length != 1) return ch;
        var cu = u[0];
        if (ch >= 128 && cu < 128) return ch;
        return cu;
    }

    /* title.replace(new RegExp("^" + escaped(artist) + "\\s+[-–]\\s+", "i"), "") */
    private static string StripLeadingArtist(string title, string artist)
    {
        if (title.Length < artist.Length) return title;
        for (var i = 0; i < artist.Length; i++) if (Canonicalize(title[i]) != Canonicalize(artist[i])) return title;
        var j = artist.Length;
        var w = j;
        while (j < title.Length && Js.IsWs(title[j])) j++;
        if (j == w || j >= title.Length || (title[j] != '-' && title[j] != '–')) return title;
        j++;
        w = j;
        while (j < title.Length && Js.IsWs(title[j])) j++;
        if (j == w) return title;
        return title[j..];
    }

    /*
     * A track's tags with what they lack filled from the names. tagged says what
     * the file itself carried (readTags). The fields filled, by name.
     */
    public static List<string> Fill(JsObj row, string file, IReadOnlyList<string> roots, JsObj tagged)
    {
        var n = FromNames(file, roots);
        var from = new List<string>();
        if (!Js.Truthy(tagged["artist"]) && n.Artist != null) { row["artist"] = n.Artist; row["album_artist"] = n.Artist; from.Add("artist"); }
        if (!Js.Truthy(tagged["album"]) && n.Album != null) { row["album"] = n.Album; from.Add("album"); }
        if (!Js.Truthy(tagged["title"]) && n.Title != null) { row["title"] = n.Title; from.Add("title"); }
        if (!Js.Truthy(tagged["track"]) && n.Track is double t && t != 0) { row["track_no"] = t; from.Add("track"); }
        if (!Js.Truthy(tagged["disc"]) && n.Disc is double d && d != 0) { row["disc_no"] = d; from.Add("disc"); }
        if (!Js.Truthy(tagged["year"]) && n.Year is double y && y != 0)
        {
            row["year"] = y;
            row["date"] = Js.Truthy(row["date"]) ? row["date"] : Js.Num(y);
            from.Add("year");
        }
        row["names_from"] = from.Count > 0 ? string.Join(",", from) : null;
        return from;
    }
}
