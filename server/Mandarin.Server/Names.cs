// Names.cs — folding names so two spellings of one thing meet (v0.8.4):
// lib/library/normalize.js, rule for rule. The library (Library.cs) is built on these; the Node server's
// copy is built on its own, and the two must agree (test/front.test.js).
//
// JavaScript's regular expressions are not .NET's in three places that matter
// here, so the patterns spell them out: \b is ASCII-only there (B below), $
// never matches before a final newline (\z), and \d is ASCII digits ([0-9]).
using System.Text;
using System.Text.RegularExpressions;

namespace Mandarin.Server;

internal static partial class Names
{
    // JavaScript's \b: between an ASCII word character and anything else.
    private const string B = @"(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))";

    /* "Beyoncé & Jay-Z" → "beyonce and jay z": accents, case and punctuation gone. */
    public static string Fold(string? s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        if (Ascii.IsValid(s)) return FoldAscii(s);
        // The rest as the scanner folds it (Scan/ScanNames.cs): JavaScript's
        // toLowerCase there, so a word's last Σ is ς as it is in Node (v0.8.22).
        return Scan.ScanNames.Fold(s);
    }

    // Plain ASCII, most names: already in its decomposed form, so nothing to normalise.
    private static string FoldAscii(string s)
    {
        var sb = new StringBuilder(s.Length + 8);
        bool gap = false;
        foreach (var ch in s)
        {
            if (ch == '&') { if (sb.Length > 0) sb.Append(' '); sb.Append("and"); gap = true; continue; }
            if (char.IsAsciiLetterOrDigit(ch))
            {
                if (gap && sb.Length > 0) sb.Append(' ');
                gap = false;
                sb.Append(char.ToLowerInvariant(ch));
            }
            else gap = true;
        }
        return sb.ToString();
    }

    [GeneratedRegex("^the (?=\\S)")]
    private static partial Regex LeadingThe();
    /* "Beatles" and "The Beatles" are one artist. */
    public static string ArtistKey(string? s) => LeadingThe().Replace(Fold(s), "", 1);

    [GeneratedRegex(@"^(.*),\s*(the|a|an)\z", RegexOptions.IgnoreCase)]
    private static partial Regex TrailingArticle();
    [GeneratedRegex(@"^(the|a|an)\s+", RegexOptions.IgnoreCase)]
    private static partial Regex LeadingArticle();
    /* "The Beatles" and "Beatles, The" sort as "beatles". */
    public static string SortName(string? s)
    {
        var t = JsTrim(s ?? "");
        var m = TrailingArticle().Match(t);
        return Fold(m.Success ? m.Groups[1].Value : LeadingArticle().Replace(t, "", 1));
    }

    // A comma inside a number ("10,000 Maniacs": a digit before it, three after) is not a list's (bug list item 136).
    [GeneratedRegex(@"\s*(?:;|/|(?:(?<!\d),|,(?!\d{3}(?!\d)))(?!\s*(?:the|jr|sr)" + B + @")|\s+feat\.?\s+|\s+featuring\s+|\s+ft\.?\s+|\s+with\s+|\s+&\s+|\s+and\s+|\s+x\s+|\s+vs\.?\s+)\s*", RegexOptions.IgnoreCase)]
    private static partial Regex ArtistSplit();
    /* "A feat. B", "A & B", "A; B" → ["A", "B"]; "10,000 Maniacs" one. */
    public static List<string> SplitArtists(string? credit)
    {
        var s = JsTrim(credit ?? "");
        if (s.Length == 0) return [];
        return ArtistSplit().Split(s).Select(JsTrim).Where(x => x.Length > 0).ToList();
    }

    // String.prototype.trim: white space and line ends, the byte-order mark too.
    public static string JsTrim(string s) => s.Trim().Trim('﻿').Trim();

    // ------------------------------------------------------------ paths (posix)

    /* path.resolve: absolute, no ".", "..", doubled or trailing slashes. */
    public static string Resolve(string p)
    {
        var parts = new List<string>();
        var full = p.StartsWith('/') ? p : Environment.CurrentDirectory + "/" + p;
        foreach (var seg in full.Split('/'))
        {
            if (seg.Length == 0 || seg == ".") continue;
            if (seg == "..") { if (parts.Count > 0) parts.RemoveAt(parts.Count - 1); continue; }
            parts.Add(seg);
        }
        return "/" + string.Join('/', parts);
    }

    public static string Dirname(string p)
    {
        if (p.Length == 0) return ".";
        int end = p.Length;
        while (end > 1 && p[end - 1] == '/') end--;
        int i = p.LastIndexOf('/', end - 1);
        if (i < 0) return ".";
        if (i == 0) return "/";
        int j = i;
        while (j > 1 && p[j - 1] == '/') j--;
        return p[..j];
    }

    public static string Basename(string p)
    {
        int end = p.Length;
        while (end > 1 && p[end - 1] == '/') end--;
        var s = p[..end];
        int i = s.LastIndexOf('/');
        return i < 0 ? s : s[(i + 1)..];
    }
}
