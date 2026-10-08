// WriteUps.cs — what the library doesn't say about a record (v0.8.21): the
// decisions of lib/meta.js, lib/wiki-match.js and lib/qobuz-deeplink.js, rule
// for rule, with no fetching (WriteUpSources.cs fetches). Each takes a page or
// an answer as the source sends it and says what it holds: a year from
// MusicBrainz, Qobuz's editorial review with the year and label, a Wikipedia
// article that is about THIS album or THIS act, Pitchfork's score and Best New
// Music (never its words: UK law), the three made one, Pitchfork's lists, and
// the id that opens the Qobuz app on the right record.
//
// The JavaScript's patterns are kept to the letter: its \s, its \b (ASCII
// word characters), its . (not across a line end), $ as the very end, and /i
// as JavaScript folds case.
using System.Globalization;
using System.Numerics;
using System.Text;
using System.Text.RegularExpressions;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal static partial class WriteUps
{
    // JavaScript's \s inside a class, its \b, and . (no s flag).
    private const string WsIn = @"\t\n\v\f\r    -     　﻿";
    private const string W = "[" + WsIn + "]";
    private const string B = "(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))";
    private const string Dot = @"[^\n\r  ]";

    /* A word as /i reads it: [aA] for each ASCII letter, the rest as it is (escaped). */
    private static string CI(string word)
    {
        var sb = new StringBuilder();
        foreach (var c in word)
        {
            if (c is >= 'a' and <= 'z' or >= 'A' and <= 'Z') sb.Append('[').Append(char.ToLowerInvariant(c)).Append(char.ToUpperInvariant(c)).Append(']');
            else sb.Append(Regex.Escape(c.ToString()));
        }
        return sb.ToString();
    }
    private static Regex Rx(string pattern) => new(pattern, RegexOptions.CultureInvariant);

    private static string S(object? v) => Js.Truthy(v) ? Js.Str(v) : "";

    // ------------------------------------------------------------ text

    /* meta.js normalize: String(s || ""), lower case, accents gone, letters and digits, single spaces. */
    public static string Normalize(object? s) => Similar.Normalize(S(s));

    private static readonly Dictionary<string, string> Named = new()
    {
        ["amp"] = "&", ["lt"] = "<", ["gt"] = ">", ["quot"] = "\"", ["apos"] = "'",
        ["copy"] = "©", ["reg"] = "®", ["trade"] = "™",
        ["nbsp"] = " ", ["hellip"] = "...", ["mdash"] = "—", ["ndash"] = "–",
        ["lsquo"] = "‘", ["rsquo"] = "’", ["ldquo"] = "“", ["rdquo"] = "”",
        ["deg"] = "°"
    };
    private static readonly Regex HexRef = Rx("&#[xX]([0-9a-fA-F]+);?");
    private static readonly Regex DecRef = Rx("&#([0-9]+);?");
    private static readonly Regex NamedRef = Rx("&([a-zA-Z][a-zA-Z0-9]*);?");

    /* String.fromCodePoint(n), "" for what isn't one. */
    private static string CodePoint(BigInteger n)
    {
        if (n < 0 || n > 0x10FFFF) return "";
        var v = (int)n;
        return v is >= 0xD800 and <= 0xDFFF ? ((char)v).ToString() : char.ConvertFromUtf32(v);
    }

    /* Named (a short list) and numeric entities, the semicolon optional; unknown ones as they were. */
    public static string DecodeEntities(object? input)
    {
        if (!Js.Truthy(input)) return "";
        var s = Js.Str(input);
        s = HexRef.Replace(s, m => CodePoint(BigInteger.Parse("0" + m.Groups[1].Value, NumberStyles.HexNumber, CultureInfo.InvariantCulture)));
        s = DecRef.Replace(s, m => CodePoint(BigInteger.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture)));
        return NamedRef.Replace(s, m => Named.TryGetValue(m.Groups[1].Value.ToLowerInvariant(), out var v) ? v : m.Value);
    }

    private static readonly Regex ScriptBlock = Rx("<" + CI("script") + @"[\s\S]*?</" + CI("script") + ">");
    private static readonly Regex StyleBlock = Rx("<" + CI("style") + @"[\s\S]*?</" + CI("style") + ">");
    private static readonly Regex BrTag = Rx("<" + CI("br") + W + "*/?" + W + "*>");
    private static readonly Regex PTag = Rx("</?" + CI("p") + "[^>]*>");
    private static readonly Regex AnyTag = Rx("<[^>]+>");
    private static readonly Regex LineIndent = Rx("\n[ \t]+");
    private static readonly Regex ManyLines = Rx("\n{3,}");
    private static readonly Regex Blanks = Rx("[ \t]+");

    /* The text of some HTML: scripts and styles gone, a break a line, a paragraph two, entities decoded. */
    public static string StripHtml(object? html)
    {
        var s = S(html);
        s = ScriptBlock.Replace(s, " ");
        s = StyleBlock.Replace(s, " ");
        s = BrTag.Replace(s, "\n");
        s = PTag.Replace(s, "\n\n");
        s = AnyTag.Replace(s, "");
        s = DecodeEntities(s);
        s = LineIndent.Replace(s, "\n");
        s = ManyLines.Replace(s, "\n\n");
        s = Blanks.Replace(s, " ");
        return Js.Trim(s);
    }

    /* The first word that counts: "the who" → "who". */
    public static string FirstSignificantToken(object? s)
    {
        var toks = Normalize(s).Split(' ').Where(t => t.Length > 0).ToList();
        if (toks.Count > 1 && toks[0] is "the" or "a" or "an") return toks[1];
        return toks.Count > 0 ? toks[0] : "";
    }

    /* Whole-phrase overlap either way, a leading "the" discounted. */
    public static bool NamesOverlap(object? a0, object? b0)
    {
        string a = Normalize(a0), b = Normalize(b0);
        if (a.Length == 0 || b.Length == 0) return false;
        if ((" " + a + " ").Contains(" " + b + " ", StringComparison.Ordinal) || (" " + b + " ").Contains(" " + a + " ", StringComparison.Ordinal)) return true;
        static string Strip(string x) => x.StartsWith("the ", StringComparison.Ordinal) ? x[4..] : x;
        return Strip(a) == Strip(b);
    }

    private static readonly Regex LeadArtist = Rx("^(" + Dot + "{2,60}?)" + W + "[-–—]" + W);

    /* The artist of a leading "Artist - Album …" dateline, or null. */
    public static string? LeadArtistOf(object? text)
    {
        var m = LeadArtist.Match(Js.Trim(S(text)));
        return m.Success ? Js.Trim(m.Groups[1].Value) : null;
    }

    private static readonly Regex NotSlug = Rx("[^a-z0-9" + WsIn + "-]");
    private static readonly Regex SlugSpaces = Rx(W + "+");
    private static readonly Regex Hyphens = Rx("-+");
    private static readonly Regex EdgeHyphens = Rx(@"^-+|-+\z");

    /* Pitchfork's slug: "Don't Stop" → "dont-stop". */
    public static string SlugifyForPitchfork(object? s)
    {
        var t = Js.Lower(S(s)).Replace("'", "", StringComparison.Ordinal);
        t = NotSlug.Replace(t, " ");
        t = SlugSpaces.Replace(t, "-");
        t = Hyphens.Replace(t, "-");
        return EdgeHyphens.Replace(t, "");
    }

    private static readonly Regex TrailingParen = Rx(W + @"*\([^()]*\)" + W + @"*\z");

    /* A title without one trailing parenthetical: "Camel (band)" → "Camel". */
    public static string WikiTitleBase(object? t) => Js.Trim(TrailingParen.Replace(S(t), "", 1));

    private static readonly Regex LeadingThe = Rx("^the" + W + "+");

    /* The same name, whatever a leading "the": "Verve" and "The Verve". */
    public static bool NamesEqualLoose(object? a, object? b)
    {
        string na = LeadingThe.Replace(Normalize(a), "", 1), nb = LeadingThe.Replace(Normalize(b), "", 1);
        return na.Length > 0 && na == nb;
    }

    // ------------------------------------------------------------ wiki-match.js

    /* A Wikipedia page title without its trailing disambiguator: "Low (David Bowie album)" → "Low". */
    public static string StripDisambiguator(object? pageTitle) =>
        Js.Trim(TrailingParen.Replace(Js.IsNullish(pageTitle) ? "" : Js.Str(pageTitle), "", 1));

    /* Whether a page title names this album, as whole words, before the disambiguator. */
    public static bool AlbumPageTitleMatches(object? albumTitle, object? pageTitle)
    {
        var want = Similar.Normalize(albumTitle);
        if (want.Length == 0) return false;
        var main = Similar.Normalize(StripDisambiguator(pageTitle));
        var hay = main.Length > 0 ? main : Similar.Normalize(pageTitle);
        if (hay.Length == 0) return false;
        return (" " + hay + " ").Contains(" " + want + " ", StringComparison.Ordinal);
    }

    // ------------------------------------------------------------ MusicBrainz's year

    /* The year of the earliest release group in a search's answer (sorted as localeCompare sorts), or null. */
    public static string? PickAlbumYear(object? json)
    {
        var rgs = (json as JsObj)?["release-groups"] as List<object?> ?? [];
        string D(object? rg) => rg is JsObj o && Js.Truthy(o["first-release-date"]) ? Js.Str(o["first-release-date"]) : "9999";
        var sorted = Library.Sorted(rgs, (a, b) => Library.Lc(D(a), D(b)));
        var first = sorted.Count > 0 ? sorted[0] as JsObj : null;
        var date = first != null && Js.Truthy(first["first-release-date"]) ? Js.Str(first["first-release-date"]) : null;
        return date != null ? (date.Length > 4 ? date[..4] : date) : null;
    }

    // ------------------------------------------------------------ Qobuz's pages

    private static readonly Regex QobuzAlbumLink = Rx(@"/(?:us-en/)?album/([^""'/" + WsIn + @"]+)/([a-z0-9]+)");

    /* The search page's album that is this record: (slug, id), or null. */
    public static (string Slug, string Id)? QobuzPick(string searchHtml, object? title, object? artist)
    {
        var seen = new List<(string Id, string Slug)>();
        var ids = new HashSet<string>();
        foreach (Match m in QobuzAlbumLink.Matches(searchHtml))
            if (ids.Add(m.Groups[2].Value)) seen.Add((m.Groups[2].Value, m.Groups[1].Value));
        if (seen.Count == 0) return null;
        var artistFirst = FirstSignificantToken(S(artist));
        var titleTokens = Normalize(title).Split(' ').Where(w => w.Length > 3).ToList();
        var titleCheck = titleTokens.Count > 0 ? titleTokens : new[] { FirstSignificantToken(title) }.Where(x => x.Length > 0).ToList();
        int bestScore = -1;
        string? chosenSlug = null, chosenId = null;
        foreach (var (id, slug) in seen)
        {
            var sn = Js.Lower(slug);
            if (artistFirst.Length > 0 && !sn.Contains(artistFirst, StringComparison.Ordinal)) continue;
            var score = titleCheck.Count(tok => sn.Contains(tok, StringComparison.Ordinal));
            if (score > bestScore) { bestScore = score; chosenSlug = slug; chosenId = id; }
        }
        var minScore = Math.Max(1, Math.Min(titleCheck.Count, 2));
        if (chosenSlug == null || bestScore < minScore) return null;
        return (chosenSlug, chosenId!);
    }

    private static readonly Regex ReviewStart = Rx(CI("Album Review") + "[:" + WsIn + "]");
    private static readonly Regex ReviewHeading = Rx("^" + CI("Album Review") + "[:" + WsIn + @"]+([^\n]+)");
    private static readonly Regex ReviewHeadingLine = Rx("^" + CI("Album Review") + @"[^\n]*\n?");
    private static readonly Regex Attribution = Rx(W + "*©" + W + @"*[^\n]*/(?:" + CI("tivo") + "|" + CI("rovi") + "|" + CI("allmusic") + "|" + CI("qobuz") + ")" + W + @"*\z");
    private static readonly Regex ReviewBy = Rx(W + "*" + CI("Review by") + W + @"+[^\n]+\z");
    private static readonly Regex Released = Rx(CI("Released") + W + "+" + CI("on") + W + "+([0-9/]+)" + W + "*" + CI("by") + W + "*<[^>]*>([^<]+)<");

    /* JavaScript's /i: a code unit as it folds (toUpperCase, kept when that's not one unit or crosses into ASCII). */
    private static char Fold(char c)
    {
        var u = Js.Upper(c.ToString());
        if (u.Length != 1) return c;
        return c >= 128 && u[0] < 128 ? c : u[0];
    }
    private static int SkipWs(string s, int i) { while (i < s.Length && Js.IsWs(s[i])) i++; return i; }
    private static bool MatchFolded(string s, ref int i, string lit)
    {
        if (i + lit.Length > s.Length) return false;
        for (var k = 0; k < lit.Length; k++) if (Fold(s[i + k]) != Fold(lit[k])) return false;
        i += lit.Length;
        return true;
    }
    /* \s* then a literal, as a backtracking engine takes it: the spaces it can spare, most first. → past the literal, or -1. */
    private static int WsThen(string s, int at, string lit)
    {
        for (var j = SkipWs(s, at); j >= at; j--)
        {
            var i = j;
            if (MatchFolded(s, ref i, lit)) return i;
        }
        return -1;
    }
    // The "Artist - Album" dateline a review opens with: the artist, a dash, the title, each with the spaces around
    // it, matched as the JavaScript's case-insensitive pattern of the two literals matches. → its length, or -1.
    private static int DatelineLength(string s, string artist, string title)
    {
        var i = WsThen(s, 0, artist);
        if (i < 0) return -1;
        i = SkipWs(s, i);
        if (i >= s.Length || s[i] is not ('-' or '\u2013' or '\u2014')) return -1;
        i = WsThen(s, i + 1, title);
        return i < 0 ? -1 : SkipWs(s, i);
    }

    /* What a Qobuz album page says: { description, year, label, url, source }, or null (nothing, or another act's review). */
    public static JsObj? QobuzAlbumPage(string albumHtml, object? title, object? artist, string albumUrl)
    {
        string? review = null;
        var startMatch = ReviewStart.Match(albumHtml);
        if (startMatch.Success)
        {
            var start = startMatch.Index;
            var ends = new[]
            {
                albumHtml.IndexOf("About the album", start, StringComparison.Ordinal),
                albumHtml.IndexOf("Improve album information", start, StringComparison.Ordinal),
                albumHtml.IndexOf("Why buy on Qobuz", start, StringComparison.Ordinal),
                start + 8000
            }.Where(n => n > start);
            var end = Math.Min(ends.Min(), albumHtml.Length);
            var text = StripHtml(albumHtml[start..end]);
            var headingMatch = ReviewHeading.Match(text);
            var headingLine = headingMatch.Success ? Js.Trim(headingMatch.Groups[1].Value) : "";
            text = Js.Trim(ReviewHeadingLine.Replace(text, "", 1));
            text = Js.Trim(Attribution.Replace(text, "", 1));
            text = Js.Trim(ReviewBy.Replace(text, "", 1));
            var leadArtist = LeadArtistOf(headingLine) ?? LeadArtistOf(text);
            var wanted = S(artist);
            if (wanted.Length > 0 && leadArtist != null && !NamesOverlap(leadArtist, wanted)) return null;
            if (leadArtist != null)
            {
                var n = DatelineLength(text, leadArtist, Js.Str(title));
                if (n >= 0) text = Js.Trim(text[n..]);
            }
            if (text.Length > 60) review = text;
        }
        string? year = null, label = null;
        var rel = Released.Match(albumHtml);
        if (rel.Success)
        {
            var parts = rel.Groups[1].Value.Split('/');
            var yp = parts[^1];
            if (yp.Length == 2)
            {
                var n = int.Parse(yp, CultureInfo.InvariantCulture);
                var cur2 = DateTime.Now.Year % 100;
                year = (n <= cur2 ? 2000 + n : 1900 + n).ToString(CultureInfo.InvariantCulture);
            }
            else year = yp;
            label = Js.Trim(rel.Groups[2].Value);
        }
        if (review == null && string.IsNullOrEmpty(year) && string.IsNullOrEmpty(label)) return null;
        var o = new JsObj();
        o["description"] = review;
        o["year"] = year;
        o["label"] = label;
        o["url"] = albumUrl;
        o["source"] = "Qobuz";
        return o;
    }

    // ------------------------------------------------------------ Wikipedia

    /* An extracts query's answer: { title, description, url } of its first page, or null. */
    public static JsObj? WikiExtractOf(object? data)
    {
        var pages = (data as JsObj)?["query"] is JsObj q && q["pages"] is JsObj p ? p : null;
        var first = pages?.Keys.FirstOrDefault();
        var page = first != null ? pages![first] as JsObj : null;
        if (page == null || !Js.Truthy(page["extract"])) return null;
        var o = new JsObj();
        o["title"] = page["title"];
        o["description"] = page["extract"];
        o["url"] = Js.Truthy(page["fullurl"]) ? page["fullurl"]
            : "https://en.wikipedia.org/wiki/" + Identify.Lookups.Encode(Js.Str(page["title"]).Replace(" ", "_", StringComparison.Ordinal));
        return o;
    }
    private static string Head(object? description, int n) { var d = Js.Str(description); return d.Length > n ? d[..n] : d; }

    private static readonly Regex PersonDates = Rx(@"\(" + W + "*(" + CI("born") + W + "+)?[0-9]{1,2}" + W + "+[A-Za-z0-9_]+" + W + "+[0-9]{4}" + B);
    private static readonly Regex Lifespan = Rx(B + "[0-9]{4}" + W + "*[–—-]" + W + "*[0-9]{4}" + B);
    private static readonly Regex PersonWords = Rx(B + "(" + CI("is") + "|" + CI("was") + ")" + W + "+(" + CI("a") + "(" + CI("n") + ")?" + W + "+)?("
        + string.Join("|", new[] { "scottish", "american", "english", "british", "irish", "welsh", "canadian", "australian" }.Select(CI)) + "|[a-zA-Z]+)?" + W + "*("
        + string.Join("|", new[] { "singer", "songwriter", "musician", "guitarist", "drummer", "rapper", "composer", "producer", "vocalist", "bassist", "pianist", "dj", "band", "duo" }.Select(CI)) + ")" + B);
    private static readonly Regex ReleaseWords = Rx(B + "(" + CI("is") + "|" + CI("was") + ")" + B + "[^.]{0,80}" + B + "("
        + string.Join("|", new[] { "album", "ep", "record", "mixtape", "soundtrack", "single" }.Select(CI)) + ")" + B);

    /* Whether a search result's article (its title, its extract) is about this album. */
    public static bool WikiAlbumAccepts(object? pageTitle, JsObj ext, object? title, object? artist)
    {
        var artistFirst = Normalize(S(artist)).Split(' ')[0];
        var lead = Head(ext["description"], 400);
        var headNorm = Normalize(Head(ext["description"], 800));
        if (!AlbumPageTitleMatches(title, pageTitle)) return false;
        if (PersonDates.IsMatch(lead) || Lifespan.IsMatch(lead) || PersonWords.IsMatch(lead)) return false;
        if (!ReleaseWords.IsMatch(lead)) return false;
        if (artistFirst.Length > 2 && !headNorm.Contains(artistFirst, StringComparison.Ordinal)) return false;
        return true;
    }

    private static readonly Regex CreditSplit = Rx(W + "+/" + W + "+|,");
    private static readonly Regex NotArtistPage = Rx(B + "(" + string.Join("|", new[] { "album", "song", "tour", "discography" }.Select(CI)) + ")" + B);
    private static readonly Regex Disambiguation = Rx(@"\(" + CI("disambiguation") + @"\)");
    private static readonly Regex MayReferTo = Rx(B + CI("may") + " (" + CI("also") + " )?" + CI("refer to") + B);
    private static readonly Regex MusicWords = Rx(B + "(" + string.Join("|", new[] { "band", "musician", "singer", "songwriter", "group", "musical", "guitarist", "drummer", "pianist",
        "composer", "rapper", "vocalist", "recording artist", "duo", "trio", "quartet", "ensemble", "orchestra" }.Select(CI)) + ")" + B);

    /* The first act of a credit (the spaced " / " or a comma; AC/DC stays whole). */
    public static string WikiArtistPrimary(string name) => Js.Trim(CreditSplit.Split(name)[0]);

    /* Whether a search result's title can be the artist's own article. */
    public static bool WikiArtistTitleOk(object? pageTitle, string primary)
    {
        var t = S(pageTitle);
        if (NotArtistPage.IsMatch(t) || Disambiguation.IsMatch(t)) return false;
        return NamesEqualLoose(WikiTitleBase(t), primary);
    }

    /* Whether the article reads like a musician's or a band's. */
    public static bool WikiArtistExtractOk(JsObj ext) =>
        !MayReferTo.IsMatch(Head(ext["description"], 200)) && MusicWords.IsMatch(Head(ext["description"], 800));

    // ------------------------------------------------------------ Pitchfork's review page

    private static readonly Regex LdJson = Rx("<" + CI("script") + "[^>]+" + CI("type") + "=[\"']" + CI("application/ld+json") + "[\"'][^>]*>([\\s\\S]*?)</" + CI("script") + ">");
    private static readonly Regex MusicRating = Rx("\"musicRating\"" + W + "*:" + W + @"*\{[^}]*?""score""" + W + "*:" + W + @"*([0-9]+(?:\.[0-9]+)?)");
    private static readonly Regex BestNew = Rx("\"isBestNewMusic\"" + W + "*:" + W + "*(true|false)");

    /* A review page's body (internal only: never sent), its score and Best New Music. */
    public static (string? Description, double? Score, bool IsBestNewMusic) ParsePitchforkReviewHtml(string html)
    {
        string? description = null;
        foreach (Match m in LdJson.Matches(html))
        {
            object? obj;
            try { obj = JsJson.Parse(m.Groups[1].Value); } catch (Exception) { continue; }
            if (obj is JsObj o && Js.StrictEq(o["@type"], "Review") && Js.Truthy(o["reviewBody"]))
            {
                var d = Js.Trim(StripHtml(o["reviewBody"]));
                description = d.Length > 0 ? d : null;
                break;
            }
        }
        double? score = null;
        var sm = MusicRating.Match(html);
        if (sm.Success) { var v = Js.ParseFloat(sm.Groups[1].Value); score = double.IsFinite(v) ? v : null; }
        var bm = BestNew.Match(html);
        return (description, score, bm.Success && bm.Groups[1].Value == "true");
    }

    private static readonly Regex PitchforkCredit = Rx(W + "*[/,&]" + W + "*|" + W + "+" + CI("feat") + @"\." + W + "+");

    /* The act a review is looked up by: the credit's first. */
    public static string PitchforkPrimary(object? artist) => Js.Trim(PitchforkCredit.Split(S(artist))[0]);

    /* What a review page gives: { description, score, isBestNewMusic, url, source }, or null. */
    public static JsObj? PitchforkVerdict(string html, string primaryArtist, string url)
    {
        var (description, score, bnm) = ParsePitchforkReviewHtml(html);
        if (description == null && score == null) return null;
        if (description != null)
        {
            var artistFirst = FirstSignificantToken(primaryArtist);
            if (artistFirst.Length > 0 && !Normalize(description).Contains(artistFirst, StringComparison.Ordinal)) return null;
        }
        var o = new JsObj();
        o["description"] = description;
        o["score"] = score;
        o["isBestNewMusic"] = bnm;
        o["url"] = url;
        o["source"] = "Pitchfork";
        return o;
    }

    // ------------------------------------------------------------ the three made one

    private static object? Get(object? o, string k) => o is JsObj j ? j[k] : Undef.V;
    private static object? Or(object? a, object? b) => Js.Truthy(a) ? a : b;
    private static readonly Regex FourDigits = Rx("([0-9]{4})");

    /* fetchAlbumBios's answer from its three sources: the album's write-up and its link, the artist's, every page found. */
    public static JsObj CombineBios(object? pitchfork, object? qobuz, object? wiki, object? artist)
    {
        var wikiAlbum = Get(wiki, "album");
        var wikiText = Or(Get(wikiAlbum, "description"), null);
        var wikiUrl = Or(Get(wikiAlbum, "url"), null);
        var qobuzText = Or(Get(qobuz, "description"), null);
        var pfText = Or(wikiText, qobuzText);
        var pfSource = Js.Truthy(wikiText) ? "Wikipedia" : Js.Truthy(qobuzText) ? "Qobuz" : null;
        var pfUrl = Js.Truthy(wikiText) ? wikiUrl : Js.Truthy(qobuzText) ? Or(Get(qobuz, "url"), null) : null;

        JsObj? album = null;
        JsObj A(object? description, object? source, object? descUrl, object? year, object? label, object? url, object? src, object? score, object? bnm)
        {
            var o = new JsObj();
            o["description"] = description;
            o["description_source"] = source;
            o["description_url"] = descUrl;
            o["year"] = year;
            o["label"] = label;
            o["url"] = url;
            o["source"] = src;
            o["score"] = score;
            o["isBestNewMusic"] = bnm;
            return o;
        }
        if (Js.Truthy(pitchfork) && Js.Truthy(Get(pitchfork, "description")))
            album = A(pfText, pfSource, pfUrl, Or(Js.Truthy(qobuz) ? Get(qobuz, "year") : null, null), Or(Js.Truthy(qobuz) ? Get(qobuz, "label") : null, null),
                Get(pitchfork, "url"), "Pitchfork", Get(pitchfork, "score"), Get(pitchfork, "isBestNewMusic"));
        else if (Js.Truthy(qobuz) && Js.Truthy(Get(qobuz, "description")))
        {
            object? wy = null;
            if (Js.Truthy(wiki) && Js.Truthy(wikiAlbum))
            {
                var m = FourDigits.Match(S(Get(wikiAlbum, "description")));
                wy = m.Success ? m.Groups[1].Value : null;
            }
            album = A(Get(qobuz, "description"), "Qobuz", Or(Get(qobuz, "url"), null), Or(Or(Get(qobuz, "year"), wy), null), Or(Get(qobuz, "label"), null),
                Get(qobuz, "url"), "Qobuz", null, false);
        }
        else if (Js.Truthy(wiki) && Js.Truthy(wikiAlbum))
            album = A(Get(wikiAlbum, "description"), "Wikipedia", Or(Get(wikiAlbum, "url"), null), null,
                Js.Truthy(qobuz) && Js.Truthy(Get(qobuz, "label")) ? Get(qobuz, "label") : null, Get(wikiAlbum, "url"), "Wikipedia", null, false);
        else if (Js.Truthy(qobuz))
            album = A(null, null, null, Get(qobuz, "year"), Get(qobuz, "label"), Get(qobuz, "url"), "Qobuz", null, false);

        JsObj? artistObj = null;
        var wikiArtist = Get(wiki, "artist");
        if (Js.Truthy(wiki) && Js.Truthy(wikiArtist))
        {
            artistObj = new JsObj();
            artistObj["name"] = Or(Or(Get(wikiArtist, "name"), artist), null);
            artistObj["description"] = Get(wikiArtist, "description");
            artistObj["url"] = Get(wikiArtist, "url");
            artistObj["source"] = "Wikipedia";
        }

        if (album != null && Js.Truthy(album["description"]))
        {
            album["description"] = Js.Trim(DecodeEntities(album["description"]));
            var lead = LeadArtistOf(album["description"]);
            if (Js.Truthy(artist) && lead != null && !NamesOverlap(lead, artist)) album["description"] = null;
            if (!Js.Truthy(album["description"])) album["description"] = null;
            if (!Js.Truthy(album["description"])) { album["description_source"] = null; album["description_url"] = null; }
        }

        var urls = new JsObj();
        urls["wikipediaAlbum"] = Or(Js.Truthy(wiki) && Js.Truthy(wikiAlbum) ? Get(wikiAlbum, "url") : null, null);
        urls["wikipediaArtist"] = Or(artistObj != null ? artistObj["url"] : null, null);
        urls["pitchfork"] = Or(Js.Truthy(pitchfork) ? Get(pitchfork, "url") : null, null);
        var outObj = new JsObj();
        outObj["album"] = album;
        outObj["artist"] = artistObj;
        outObj["urls"] = urls;
        return outObj;
    }

    // ------------------------------------------------------------ the Qobuz app's link

    private static readonly Regex QobuzHref = Rx(@"href=""/([a-z]{2}-[a-z]{2})/album/([a-z0-9-]+)/([A-Za-z0-9]+)""");
    private static readonly Regex NotCanon = Rx("[^a-z0-9]+");

    /* Letters and digits only, accents folded: "AC/DC" and "ac-dc" agree. */
    public static string Canon(object? s)
    {
        var t = ScanNames.Nfkd(Js.Lower(Js.IsNullish(s) ? "" : Js.Str(s)));
        var sb = new StringBuilder(t.Length);
        foreach (var c in t) if (c < 0x300 || c > 0x36F) sb.Append(c);
        return NotCanon.Replace(sb.ToString(), "");
    }

    /* The id of the search result that is recognisably the record asked for, or null. */
    public static string? PickAlbumId(object? html, string store, object? artist, object? album)
    {
        var wantAlbum = Canon(album);
        if (wantAlbum.Length == 0) return null;
        var wantArtist = Canon(S(artist));
        var exact = wantAlbum + wantArtist;
        string? loose = null;
        foreach (Match m in QobuzHref.Matches(S(html)))
        {
            if (m.Groups[1].Value != store) continue;
            var slug = Canon(m.Groups[2].Value);
            var id = m.Groups[3].Value;
            if (slug == exact) return id;
            if (loose == null && wantArtist.Length > 0 && slug.StartsWith(wantAlbum, StringComparison.Ordinal) && slug.Contains(wantArtist, StringComparison.Ordinal)) loose = id;
        }
        return loose;
    }

    public static string? DeepLink(string? id) => !string.IsNullOrEmpty(id) ? "https://open.qobuz.com/album/" + id : null;
}
