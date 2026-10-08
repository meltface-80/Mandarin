// Score.cs — how far a MusicBrainz release is from an album in the library
// (v0.8.19): lib/identify/score.js, rule for rule — beets' distance, a
// weighted sum over the album's title and artist, its year, its track count,
// and each track's title and length, divided by the weights (0 identical, 1
// nothing alike). The verdicts it gives are written to album_matches and read
// back by the page, so the numbers and the parts must be the Node server's to
// the last digit: the values are the tag reader's JavaScript ones (Tags/Js.cs),
// and the patterns keep JavaScript's \s, \d, \b and /i (ASCII-only), and $.
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal static partial class Score
{
    public const double WAlbum = 2, WArtist = 2, WYear = 0.5, WTrackTitle = 2, WTrackLength = 3,
        WMissingTrack = 0.9, WUnmatchedTrack = 0.6, WNote = 0.5, WEdition = 1.5;
    private const double LengthGrace = 15, LengthMax = 30;
    public const int ApplyPercent = 95;
    public const double Propose = 0.15, Ambiguous = 0.02;
    public static readonly double Apply = 1 - (ApplyPercent - 0.5) / 100;

    private const string Ws = ScanNames.Ws, Dot = ScanNames.Dot;
    // \b as JavaScript has it: between an ASCII word character and anything else.
    private const string B = @"(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))";

    /* An ASCII word, matched as /i matches it (JavaScript's: ASCII letters only). */
    private static string Ci(string word)
    {
        var sb = new StringBuilder();
        foreach (var c in word)
        {
            if (c is >= 'a' and <= 'z') sb.Append('[').Append(c).Append(char.ToUpperInvariant(c)).Append(']');
            else sb.Append(c);
        }
        return sb.ToString();
    }

    public static double Similarity(double d) => Js.Round((1 - d) * 100);

    private static readonly HashSet<string> Suspect = ["", "various artists", "various", "va", "v a", "unknown", "unknown artist", "artist", "compilation", "soundtrack", "original soundtrack"];

    private static string S(object? v) => Js.IsNullish(v) ? "" : Js.Str(v);
    // String(s || "")
    private static string SOr(object? v) => Js.Truthy(v) ? Js.Str(v) : "";

    /* An artist tag not worth scoring against. */
    public static bool ArtistSuspect(object? artist, object? title)
    {
        var a = ScanNames.Fold(Tidy(artist));
        return Suspect.Contains(a) || (a.Length > 0 && a == ScanNames.Fold(S(title)));
    }

    public static double Levenshtein(string a, string b)
    {
        if (a == b) return 0;
        if (a.Length == 0) return b.Length;
        if (b.Length == 0) return a.Length;
        var prev = new int[b.Length + 1];
        var cur = new int[b.Length + 1];
        for (var j = 0; j <= b.Length; j++) prev[j] = j;
        for (var i = 1; i <= a.Length; i++)
        {
            cur[0] = i;
            for (var j = 1; j <= b.Length; j++)
                cur[j] = Math.Min(Math.Min(prev[j] + 1, cur[j - 1] + 1), prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
            (prev, cur) = (cur, prev);
        }
        return prev[b.Length];
    }

    private static readonly Dictionary<string, double> Roman = new()
    {
        ["i"] = 1, ["ii"] = 2, ["iii"] = 3, ["iv"] = 4, ["v"] = 5, ["vi"] = 6, ["vii"] = 7, ["viii"] = 8, ["ix"] = 9, ["x"] = 10,
        ["xi"] = 11, ["xii"] = 12, ["xiii"] = 13, ["xiv"] = 14, ["xv"] = 15, ["xvi"] = 16, ["xvii"] = 17, ["xviii"] = 18, ["xix"] = 19, ["xx"] = 20
    };
    private static readonly Dictionary<string, string> Abbr = new()
    {
        ["pt"] = "part", ["vol"] = "volume", ["no"] = "number", ["nr"] = "number", ["st"] = "saint", ["mr"] = "mister", ["dr"] = "doctor", ["vs"] = "versus", ["v"] = "versus"
    };
    private static readonly HashSet<string> Counted = ["part", "volume", "number", "chapter", "act", "book", "movement", "op", "opus", "disc", "side", "symphony", "suite"];
    // ABBR is a plain object there, so a word that is a property of every object finds one:
    // "constructor" becomes Object itself, and is written as JavaScript writes the function.
    private const string ObjectFunction = "function Object() { [native code] }";

    [GeneratedRegex("(^| )n(?= |\\z)")]
    private static partial Regex LoneN();
    [GeneratedRegex("^[0-9]|^[ivx]+\\z")]
    private static partial Regex NumberNext();

    private static bool IsLetter(int cp) => CharUnicodeInfo.GetUnicodeCategory(cp) is UnicodeCategory.UppercaseLetter or UnicodeCategory.LowercaseLetter
        or UnicodeCategory.TitlecaseLetter or UnicodeCategory.ModifierLetter or UnicodeCategory.OtherLetter;
    private static bool IsNumber(int cp) => CharUnicodeInfo.GetUnicodeCategory(cp) is UnicodeCategory.DecimalDigitNumber or UnicodeCategory.LetterNumber or UnicodeCategory.OtherNumber;

    /* .replace(/(\p{L}{2,})ing(?![\p{L}\p{N}])/gu, "$1in") on a folded name (letters, numbers and single spaces). */
    private static string DroppedG(string s)
    {
        var sb = new StringBuilder(s.Length);
        var i = 0;
        while (i < s.Length)
        {
            // A run of letters, by code point.
            var start = i;
            var cps = 0;
            while (i < s.Length)
            {
                int cp = s[i], w = 1;
                if (char.IsHighSurrogate(s[i]) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) { cp = char.ConvertToUtf32(s[i], s[i + 1]); w = 2; }
                if (char.IsSurrogate(s[i]) && w == 1 || !IsLetter(cp)) break;
                i += w;
                cps++;
            }
            if (i > start)
            {
                var run = s[start..i];
                var nextIsNumber = false;
                if (i < s.Length)
                {
                    int cp = s[i];
                    if (char.IsHighSurrogate(s[i]) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) cp = char.ConvertToUtf32(s[i], s[i + 1]);
                    nextIsNumber = !(char.IsSurrogate(s[i]) && cp == s[i]) && IsNumber(cp);
                }
                if (cps >= 5 && run.EndsWith("ing", StringComparison.Ordinal) && !nextIsNumber) sb.Append(run, 0, run.Length - 3).Append("in");
                else sb.Append(run);
                continue;
            }
            // Anything else, one code point.
            var width = char.IsHighSurrogate(s[i]) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1]) ? 2 : 1;
            sb.Append(s, i, width);
            i += width;
        }
        return sb.ToString();
    }

    /*
     * A name folded for comparing: case, accents and punctuation as always,
     * "+" and "'n'" as "and", a dropped g the same word, the usual abbreviations,
     * a Roman numeral after "Part"… (or ending a title of several words) a number.
     */
    public static string Cmp(object? s)
    {
        var folded = ScanNames.Fold(S(s).Replace("+", " and ", StringComparison.Ordinal));
        folded = LoneN().Replace(folded, "$1and");
        folded = DroppedG(folded);
        var words = folded.Split(' ').Where(w => w.Length > 0).ToList();
        for (var i = 0; i < words.Count; i++)
        {
            if (words[i] == "constructor") { words[i] = ObjectFunction; continue; }
            if (Abbr.TryGetValue(words[i], out var full) && (words[i] != "v" || i > 0) && (words[i] != "no" || NumberNext().IsMatch(i + 1 < words.Count ? words[i + 1] : "")))
                words[i] = full;
            if (Roman.TryGetValue(words[i], out var n) && ((i > 0 && Counted.Contains(words[i - 1])) || (i == words.Count - 1 && i > 0 && words[i].Length > 1)))
                words[i] = Js.Num(n);
        }
        return string.Join(" ", words);
    }

    [GeneratedRegex(Ws + "*[(\\[][^)\\]]*[)\\]]")]
    private static partial Regex Bracketed();
    [GeneratedRegex(Ws + "+[-–—]" + Ws + "+" + Dot + "*\\z")]
    private static partial Regex DashTail();

    /* The name without anything in brackets or after a " - " or a slash: the song itself. */
    public static string Core(object? s) => Cmp(DashTail().Replace(Bracketed().Replace(SOr(s), " "), " ", 1));

    private static string NoSpace(string s) => s.Replace(" ", "", StringComparison.Ordinal);

    /* 0..1: how unlike two names are, after folding. */
    public static double StringDist(object? a, object? b)
    {
        string x = Cmp(a), y = Cmp(b);
        if (x == y || NoSpace(x) == NoSpace(y)) return 0;
        var n = Math.Max(x.Length, y.Length);
        return n != 0 ? Levenshtein(x, y) / n : 0;
    }

    private static readonly string EditionWordPattern = B + "(?:" + Ci("remaster") + "(?:" + Ci("ed") + "|" + Ci("ing") + ")?|" + Ci("deluxe") + "|" + Ci("edition") + "|" + Ci("expanded")
        + "|" + Ci("anniversary") + "|" + Ci("bonus") + "|" + Ci("reissue") + "|" + Ci("re") + "-?" + Ci("issue") + "|" + Ci("version") + "|" + Ci("mono") + "|" + Ci("stereo")
        + "|" + Ci("explicit") + "|" + Ci("clean") + "|" + Ci("digital") + "|" + Ci("special") + "|" + Ci("limited") + "|" + Ci("collector") + "'?[sS]?|" + Ci("super")
        + "|" + Ci("legacy") + "|" + Ci("redux") + "|" + Ci("remix") + "(?:" + Ci("ed") + ")?|" + Ci("mix") + ")" + B + "|" + B + "(?:19|20)[0-9]{2}" + B;
    private static readonly Regex EditionWord = new(EditionWordPattern, RegexOptions.CultureInvariant);

    [GeneratedRegex(Ws + "*[(\\[][^)\\]]*[)\\]]" + Ws + "*\\z")]
    private static partial Regex Paren();
    [GeneratedRegex(Ws + "+[-–—]" + Ws + "+([^-–—]*)\\z")]
    private static partial Regex Dash();

    private static readonly Regex Feat = new(Ws + "+(?:" + Ci("feat") + "|" + Ci("featuring") + "|" + Ci("ft") + ")\\.?" + Ws + "+" + Dot + "*\\z", RegexOptions.CultureInvariant);
    private static readonly Regex Credit = new("^" + Ws + "*[(\\[]" + Ws + "*(?:" + Ci("feat") + "|" + Ci("featuring") + "|" + Ci("ft") + "|" + Ci("with") + "|" + Ci("live") + "|" + Ci("demo") + "|" + Ci("edit") + ")" + B, RegexOptions.CultureInvariant);
    private static readonly Regex Remaster = new(B + "(?:" + Ci("remaster") + "(?:" + Ci("ed") + "|" + Ci("ing") + ")?|" + Ci("reissue") + "|" + Ci("re") + "-?" + Ci("issue") + ")" + B, RegexOptions.CultureInvariant);

    private static string StripTail(object? s, Func<string, bool> test)
    {
        var t = SOr(s);
        for (var i = 0; i < 3; i++)
        {
            var p = Paren().Match(t);
            if (p.Success && test(p.Value)) { t = t[..p.Index]; continue; }
            var d = Dash().Match(t);
            if (d.Success && test(d.Groups[1].Value)) { t = t[..d.Index]; continue; }
            break;
        }
        return Js.Trim(t);
    }

    // A ripper's template with nothing to fill it: "null: Line Up (null)", "Line Up - undefined", "(Unknown)".
    private static readonly string Nothing = "(?:" + Ci("null") + "|" + Ci("undefined") + "|" + Ci("nan") + "|" + Ci("none") + "|" + Ci("unknown") + "|" + Ci("n") + "/" + Ci("a") + ")";
    private static readonly Regex Junk0 = new("^" + Ws + "*" + Nothing + Ws + "*[:\\-–—]" + Ws + "*", RegexOptions.CultureInvariant);
    private static readonly Regex Junk1 = new(Ws + "*[(\\[]" + Ws + "*" + Nothing + Ws + "*[)\\]]" + Ws + "*", RegexOptions.CultureInvariant);
    private static readonly Regex Junk2 = new(Ws + "*[-–—:]" + Ws + "*" + Nothing + Ws + "*\\z", RegexOptions.CultureInvariant);
    private static readonly Regex Junk3 = new("^" + Ws + "*" + Nothing + Ws + "*\\z", RegexOptions.CultureInvariant);
    [GeneratedRegex(Ws + "+")]
    private static partial Regex WsRun();

    public static string Tidy(object? s)
    {
        var t = SOr(s);
        t = Junk0.Replace(t, " ", 1);
        t = Junk1.Replace(t, " ");
        t = Junk2.Replace(t, " ", 1);
        t = Junk3.Replace(t, " ", 1);
        return Js.Trim(WsRun().Replace(t, " "));
    }

    // "CD2", "Disc 2", "(Disk 02)" at the end of an album's title: which disc of a set the folder is.
    private static readonly Regex DiscTail = new("[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff\\-–—(:,]*" + B
        + "(?:" + Ci("cd") + "|" + Ci("disc") + "|" + Ci("disk") + ")" + Ws + "*0?[0-9]{1,2}" + B + Ws + "*\\)?" + Ws + "*\\z", RegexOptions.CultureInvariant);
    private static readonly Regex DiscMark = new(B + "(?:" + Ci("cd") + "|" + Ci("disc") + "|" + Ci("disk") + ")" + Ws + "*0?([0-9]{1,2})" + B, RegexOptions.CultureInvariant);

    /* The disc a title or a folder names ("CD2", "Disc 2"), or null. */
    public static double? DiscOf(object? s)
    {
        var m = DiscMark.Match(SOr(s));
        return m.Success ? double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : null;
    }

    /* The name alone, for comparing. */
    public static string Bare(object? s)
    {
        var t = StripTail(Tidy(s), x => EditionWord.IsMatch(x) || Credit.IsMatch(x));
        t = Feat.Replace(t, "", 1);
        t = DiscTail.Replace(t, "", 1);
        return Js.Trim(t);
    }

    /* The name as it should be written: only the remaster/reissue tail goes. */
    public static string Clean(object? s)
    {
        var t = StripTail(s, x => Remaster.IsMatch(x));
        return t.Length > 0 ? t : Js.Trim(SOr(s));
    }

    private static readonly Regex EditionYearRe = new(B + "((?:19|20)[0-9]{2})" + B + "(?=[^()\\[\\]]*(?:" + Ci("remaster") + "|" + Ci("edition") + "|" + Ci("version") + "|" + Ci("reissue") + "|" + Ci("anniversary") + "|" + Ci("mix") + "))", RegexOptions.CultureInvariant);

    /* A year named in an edition tail ("2015 Remaster"): the version's, not the record's. */
    public static double? EditionYear(object? s)
    {
        var m = EditionYearRe.Match(SOr(s));
        return m.Success ? double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : null;
    }

    [GeneratedRegex("^" + Ws + "*[0-9]{1,2}[.\\-\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+(?=" + ScanNames.NotWs + ")")]
    private static partial Regex LeadingNumber();
    [GeneratedRegex(Ws + "*/" + Ws + "*")]
    private static partial Regex Slash();

    public static double TitleDist(object? a0, object? b0)
    {
        var a = Tidy(a0);
        var b = Tidy(b0);
        if (Cmp(a) == Cmp(b) || NoSpace(Cmp(a)) == NoSpace(Cmp(b))) return 0;
        string Strip(string s) => Bare(LeadingNumber().Replace(s, "", 1));
        string x = Strip(a), y = Strip(b);
        if (Cmp(x) == Cmp(y) || NoSpace(Cmp(x)) == NoSpace(Cmp(y))) return 0.05;
        // The same song once what's in brackets is set aside, or one name the other's part.
        string cx = Core(a), cy = Core(b);
        if (cx.Length > 0 && cx == cy) return 0.1;
        List<string> Parts(string t) => Slash().Split(t).Select(p => Core(p)).Where(p => p.Length > 0).ToList();
        if (cx.Length > 0 && cy.Length > 0 && (Parts(b).Contains(cx) || Parts(a).Contains(cy))) return 0.15;
        return Math.Min(1, StringDist(x, y) + 0.05);
    }

    public static double LengthDist(object? a, object? b)
    {
        if (Js.IsNullish(a) || Js.IsNullish(b)) return 0.5;
        var off = Math.Abs(Js.ToNumber(a) - Js.ToNumber(b));
        if (off <= LengthGrace) return 0;
        return Math.Min(1, (off - LengthGrace) / LengthMax);
    }

    private static readonly Regex Marks = new(B + "(live|remix(?:ed|es)?|re-?mix|demos?|instrumentals?|karaoke|acoustic|unplugged)" + B, RegexOptions.CultureInvariant);
    [GeneratedRegex("(?:ed|es|s)\\z")]
    private static partial Regex MarkSuffix();
    [GeneratedRegex("^remix" + Dot + "*")]
    private static partial Regex RemixAny();

    private static string MarkOf(string w) => RemixAny().Replace(MarkSuffix().Replace(w.Replace("-", "", StringComparison.Ordinal), "", 1), "remix", 1);

    private static HashSet<string> MarksIn(string t)
    {
        var set = new List<string>();
        foreach (Match m in Marks.Matches(Js.Lower(t)))
        {
            var k = MarkOf(m.Value);
            if (!set.Contains(k)) set.Add(k);
        }
        return [.. set];
    }

    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static string Join(params object?[] parts) => string.Join(" ", parts.Select(p => Js.IsNullish(p) ? "" : Js.Str(p)));

    public sealed record Scored(JsObj Candidate, double Distance, JsObj Parts, List<object?> Pairs);

    /*
     * The distance between an album — { title, artist, year, tracks: [{ title,
     * length }] } — and a candidate. Also the parts, so the page can say why.
     */
    public static (double Distance, JsObj Parts, List<object?> Pairs) Distance(JsObj album, JsObj cand)
    {
        var parts = new JsObj();
        double sum = 0, weight = 0;
        void Add(string name, double w, double d) { parts[name] = d; sum += w * d; weight += w; }

        Add("album", WAlbum, Math.Min(TitleDist(album["title"], cand["title"]), Js.Truthy(cand["release_title"]) ? TitleDist(album["title"], cand["release_title"]) : 1));
        if (!ArtistSuspect(album["artist"], album["title"])) Add("artist", WArtist, StringDist(album["artist"], cand["artist"]));
        else parts["artist"] = null;
        var years = new List<double>();
        foreach (var y in new object?[] { cand["year"], cand["release_year"], EditionYear(album["title"]) })
            if (Js.Truthy(y)) { var n = Js.ToNumber(y); if (!years.Contains(n)) years.Add(n); }
        Add("year", WYear, Js.Truthy(album["year"]) && years.Count > 0 && !years.Contains(Js.ToNumber(album["year"])) ? 1 : 0);
        var theirsMarks = MarksIn(Join(cand["edition"], cand["group_note"], cand["title"], cand["release_title"]));
        var ours = MarksIn(Join(album["title"], album["context"]));
        Add("note", WNote, theirsMarks.Any(m => !ours.Contains(m)) || ours.Any(m => !theirsMarks.Contains(m)) ? 1 : 0);

        var mine = L(album["tracks"]).Cast<JsObj>().ToList();
        var theirs = L(cand["tracks"]).Cast<JsObj>().ToList();
        // A folder that is one disc of a set ("CD2") is scored against that disc of the release alone.
        var disc = DiscOf(album["title"]) ?? DiscOf(album["context"]);
        if (disc is double dn && dn != 0)
        {
            var discs = new List<object?>();
            foreach (var t in theirs) if (!discs.Any(x => Js.StrictEq(x, t["disc"]))) discs.Add(t["disc"]);
            if (discs.Count > 1 && theirs.Any(t => Js.StrictEq(t["disc"], dn)))
            {
                theirs = theirs.Where(t => Js.StrictEq(t["disc"], dn)).ToList();
                parts["disc"] = dn;
            }
        }
        var (pairs, cost) = PairTracks(mine, theirs);
        var noLengths = theirs.Count > 0 && theirs.All(t => Js.IsNullish(t["length"]));
        var lengthW = noLengths ? 0 : WTrackLength;
        double titles = 0, lengths = 0, n2 = 0;
        for (var i = 0; i < pairs.Count; i++)
        {
            if (pairs[i] == null) { sum += WUnmatchedTrack; weight += WUnmatchedTrack; continue; }
            n2++;
            titles += cost[i]!.Value.Title;
            lengths += cost[i]!.Value.Length;
            sum += WTrackTitle * cost[i]!.Value.Title + lengthW * cost[i]!.Value.Length;
            weight += WTrackTitle + lengthW;
        }
        var missing = theirs.Count - n2;
        var whole = n2 > 0 && n2 == mine.Count && !noLengths && cost.All(c => c != null && c.Value.Title <= 0.05 && c.Value.Length == 0);
        parts["edition"] = missing != 0 && whole;
        if (missing != 0 && whole) { sum += WEdition; weight += WEdition; }
        else { sum += WMissingTrack * missing; weight += WMissingTrack * missing; }
        parts["track_titles"] = n2 != 0 ? titles / n2 : 1.0;
        parts["track_lengths"] = noLengths ? null : (n2 != 0 ? lengths / n2 : 1.0);
        parts["no_lengths"] = noLengths;
        parts["missing_tracks"] = missing;
        parts["extra_tracks"] = mine.Count - n2;
        return (weight != 0 ? sum / weight : 1, parts, pairs);
    }

    /*
     * Which of the release's tracks each of the copy's tracks is: the nearest
     * by title and length, in order, each used once.
     */
    public static (List<object?> Pairs, List<(double Title, double Length)?> Cost) PairTracks(List<JsObj> mine, List<JsObj> theirs)
    {
        var used = new HashSet<int>();
        var pairs = new List<object?>();
        var cost = new List<(double Title, double Length)?>();
        const double Unpaired = WUnmatchedTrack + WMissingTrack;
        var after = -1;
        for (var i = 0; i < mine.Count; i++)
        {
            var m = mine[i];
            int? best = null;
            var bestC = double.PositiveInfinity;
            (double Title, double Length)? bestParts = null;
            for (var j = 0; j < theirs.Count; j++)
            {
                if (used.Contains(j)) continue;
                var t = theirs[j];
                double td = TitleDist(m["title"], t["title"]), ld = LengthDist(m["length"], t["length"]);
                var c = WTrackTitle * td + WTrackLength * ld + (j > after ? j - after - 1 : theirs.Count) * 0.001;
                if (c < bestC) { bestC = c; best = j; bestParts = (td, ld); }
            }
            // The same length to a few seconds in the same place is the same track whatever it's called.
            if ((best == null || !(bestC < Unpaired || bestParts!.Value.Title <= 0.15)) && !used.Contains(i) && i < theirs.Count &&
                !Js.IsNullish(m["length"]) && !Js.IsNullish(theirs[i]["length"]) && Math.Abs(Js.ToNumber(m["length"]) - Js.ToNumber(theirs[i]["length"])) <= 3)
            {
                best = i;
                bestParts = (TitleDist(m["title"], theirs[i]["title"]), 0);
                bestC = 0;
            }
            if (best != null && (bestC < Unpaired || bestParts!.Value.Title <= 0.15))
            {
                used.Add(best.Value);
                after = best.Value;
                pairs.Add((double)best.Value);
                cost.Add(bestParts);
            }
            else { pairs.Add(null); cost.Add(null); }
        }
        return (pairs, cost);
    }

    public sealed record Verdict(string Status, Scored? Best, List<Scored> ScoredList, bool Ambiguous);

    /*
     * The candidates scored and sorted, and the verdict: which one, and whether
     * it is applied, proposed, or nothing. Another pressing of the same record
     * is not a rival.
     */
    public static Verdict Decide(JsObj album, IEnumerable<JsObj> candidates)
    {
        double HasLengths(Scored s) => Js.Truthy(s.Parts["no_lengths"]) ? 0 : 1;
        string Date(Scored s) => Js.Truthy(s.Candidate["release_date"]) ? Js.Str(s.Candidate["release_date"]) : Js.Truthy(s.Candidate["date"]) ? Js.Str(s.Candidate["date"]) : "9999";
        var scored = candidates.Select(c => { var (d, p, pr) = Distance(album, c); return new Scored(c, d, p, pr); }).ToList();
        scored = Library.Sorted(scored, (a, b) =>
        {
            var x = a.Distance - b.Distance;
            if (x != 0 && !double.IsNaN(x)) return x < 0 ? -1 : 1;
            var h = HasLengths(b) - HasLengths(a);
            if (h != 0) return h < 0 ? -1 : 1;
            return string.CompareOrdinal(Date(a), Date(b)) switch { < 0 => -1, > 0 => 1, _ => 0 };
        });
        if (scored.Count == 0) return new Verdict("unidentified", null, scored, false);
        var best = scored[0];
        bool Same(Scored a, Scored b)
        {
            if (Js.Truthy(a.Candidate["group_mbid"]) && Js.StrictEq(a.Candidate["group_mbid"], b.Candidate["group_mbid"])) return true;
            if (ScanNames.Fold(S(a.Candidate["artist"])) != ScanNames.Fold(S(b.Candidate["artist"])) || ScanNames.Fold(S(a.Candidate["title"])) != ScanNames.Fold(S(b.Candidate["title"]))) return false;
            string Name(Scored s, int i)
            {
                var j = i < s.Pairs.Count ? s.Pairs[i] : null;
                if (j == null) return "";
                var list = L(s.Candidate["tracks"]);
                var k = (int)Js.ToNumber(j);
                var t = k >= 0 && k < list.Count ? list[k] as JsObj : null;
                return ScanNames.Fold(t != null && Js.Truthy(t["title"]) ? Js.Str(t["title"]) : "");
            }
            var mine = L(album["tracks"]);
            for (var i = 0; i < mine.Count; i++) if (Name(a, i) != Name(b, i)) return false;
            return true;
        }
        var rival = scored.Skip(1).FirstOrDefault(s => s.Distance - best.Distance < Ambiguous && !Same(s, best));
        string status;
        if (best.Distance > Propose) status = "unidentified";
        else if (AppliesUnasked(best.Distance)) status = "applied";
        else status = "proposed";
        return new Verdict(status, best, scored, rival != null);
    }

    /* Applied without asking: 95 % alike or better, as the page shows it. */
    public static bool AppliesUnasked(double? distance) => distance is double d && Similarity(d) >= ApplyPercent;

    /* Why a match is short of 100 %, in words for the page. */
    public static List<string> Why(object? parts0, object? year)
    {
        var p = parts0 as JsObj ?? new JsObj();
        var outList = new List<string>();
        bool Gt(string k, double v) => p[k] is double d && d > v;
        if (Gt("track_lengths", 0)) outList.Add("track lengths differ");
        if (Gt("track_titles", 0.05)) outList.Add("track names differ");
        if (Gt("album", 0.05)) outList.Add("the title differs");
        if (Gt("artist", 0)) outList.Add("the artist is spelt differently");
        if (p["year"] is double y1 && y1 == 1) outList.Add("the year differs" + (Js.Truthy(year) ? " (" + Js.Str(year) + " here)" : ""));
        if (p["note"] is double n1 && n1 == 1) outList.Add("MusicBrainz marks it as another version");
        if (Js.Truthy(p["no_lengths"])) outList.Add("MusicBrainz has no track lengths");
        if (Js.Truthy(p["edition"])) outList.Add("a bigger pressing of the same record");
        if (outList.Count == 0 && (Gt("album", 0) || Gt("track_titles", 0))) outList.Add("edition notes in the names");
        return outList;
    }

    /* A fit with nothing left to doubt: what a second source (iTunes) needs before it's applied unasked. */
    public static bool Exact(JsObj? parts)
    {
        if (parts == null || Js.Truthy(parts["no_lengths"])) return false;
        return !Js.Truthy(parts["missing_tracks"]) && !Js.Truthy(parts["extra_tracks"]) && parts["track_lengths"] is double tl && tl == 0 &&
            parts["album"] is double al && al <= 0.05 && parts["track_titles"] is double tt && tt <= 0.05;
    }

    /* A scored match as the album_matches row keeps it: its candidate with the parts, the pairs and whether it was close. */
    public static JsObj Kept(Scored s, params (string Key, object? Value)[] extra)
    {
        var o = new JsObj();
        foreach (var k in s.Candidate.Keys) o[k] = s.Candidate[k];
        o["parts"] = s.Parts;
        o["pairs"] = s.Pairs;
        foreach (var (k, v) in extra) o[k] = v;
        return o;
    }
}
