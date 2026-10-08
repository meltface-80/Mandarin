// PitchforkLists.cs — Pitchfork's Latest and Best New Music lists (v0.8.21),
// read as lib/meta.js reads them: the listing page's preloaded state (title,
// artist, score, Best New Music, a square cover), newest first; for Latest,
// when that fails, the RSS feed (covers and titles, the artist from the
// address, no score). Pure: pages in, items out.
using System.Text.RegularExpressions;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal static class PitchforkLists
{
    private const string WsIn = @"\t\n\v\f\r    -     　﻿";
    private const string W = "[" + WsIn + "]";
    private const string B = "(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))";
    private static Regex Rx(string pattern) => new(pattern, RegexOptions.CultureInvariant);

    private static readonly Regex CdataOpen = Rx("^" + W + @"*<!\[CDATA\[");
    private static readonly Regex CdataClose = Rx(@"\]\]>" + W + @"*\z");
    private static readonly Regex ReviewPath = Rx(@"/reviews/albums/([^/?#]+)");
    private static readonly Regex Item = Rx("<[iI][tT][eE][mM]" + B + @"[\s\S]*?</[iI][tT][eE][mM]>");
    private static readonly Regex Link = Rx(@"<[lL][iI][nN][kK]>([\s\S]*?)</[lL][iI][nN][kK]>");
    private static readonly Regex Title = Rx(@"<[tT][iI][tT][lL][eE]>([\s\S]*?)</[tT][iI][tT][lL][eE]>");
    private static readonly Regex PubDate = Rx(@"<[pP][uU][bB][dD][aA][tT][eE]>([\s\S]*?)</[pP][uU][bB][dD][aA][tT][eE]>");
    private static readonly Regex Thumbnail = Rx("<[mM][eE][dD][iI][aA]:[tT][hH][uU][mM][bB][nN][aA][iI][lL][^>]*" + B + "[uU][rR][lL]=[\"']([^\"']+)[\"']");
    private static readonly Regex AlbumsPath = Rx("/reviews/albums/");
    private static readonly Regex QueryOrHash = Rx("[?#]");
    private static readonly Regex Stars = Rx(@"\*");

    private static string? UnCdata(string? s) => s == null ? null : Js.Trim(CdataClose.Replace(CdataOpen.Replace(s, "", 1), "", 1));

    /* A review address's artist, when the listing gave none: the slug less the album's, title-cased. */
    public static string? ArtistFromReviewUrl(object? url, object? albumTitle)
    {
        var m = ReviewPath.Match(Js.Truthy(url) ? Js.Str(url) : "");
        if (!m.Success) return null;
        var artistSlug = m.Groups[1].Value;
        var albumSlug = WriteUps.SlugifyForPitchfork(Js.Truthy(albumTitle) ? albumTitle : "");
        if (albumSlug.Length > 0 && artistSlug.EndsWith("-" + albumSlug, StringComparison.Ordinal))
            artistSlug = artistSlug[..(artistSlug.Length - albumSlug.Length - 1)];
        var words = artistSlug.Split('-').Where(w => w.Length > 0).ToList();
        if (words.Count == 0) return null;
        return string.Join(" ", words.Select(w => Js.Upper(w[0].ToString()) + w[1..]));
    }

    /* The RSS feed's reviews: { url, album, cover, date }. */
    public static List<JsObj> ParseRss(string xml)
    {
        var items = new List<JsObj>();
        foreach (Match im in Item.Matches(xml))
        {
            var block = im.Value;
            string? Pick(Regex re) { var x = re.Match(block); return x.Success ? UnCdata(x.Groups[1].Value) : null; }
            var link = Pick(Link);
            if (string.IsNullOrEmpty(link) || !AlbumsPath.IsMatch(link)) continue;
            var album = Js.Trim(WriteUps.StripHtml(Pick(Title) ?? ""));
            var tm = Thumbnail.Match(block);
            var cover = tm.Success ? tm.Groups[1].Value : null;
            var date = Pick(PubDate);
            if (album.Length == 0) continue;
            var o = new JsObj();
            o["url"] = QueryOrHash.Split(link)[0];
            o["album"] = album;
            o["cover"] = cover;
            o["date"] = date;
            items.Add(o);
        }
        return items;
    }

    /* window.__PRELOADED_STATE__ = {…}, its braces matched. */
    public static string? ExtractPreloadedState(string html)
    {
        var marker = html.IndexOf("__PRELOADED_STATE__", StringComparison.Ordinal);
        if (marker == -1) return null;
        var start = html.IndexOf('{', marker);
        if (start == -1) return null;
        int depth = 0;
        bool inStr = false, esc = false;
        for (var i = start; i < html.Length; i++)
        {
            var c = html[i];
            if (inStr)
            {
                if (esc) esc = false;
                else if (c == '\\') esc = true;
                else if (c == '"') inStr = false;
            }
            else if (c == '"') inStr = true;
            else if (c == '{') depth++;
            else if (c == '}') { if (--depth == 0) return html[start..(i + 1)]; }
        }
        return null;
    }

    private static object? Get(object? o, string k) => o is JsObj j ? j[k] : Undef.V;
    private static bool IsObject(object? v) => v is JsObj or List<object?>;

    /* A listing item's square cover: lg first, then xxl, md, sm. */
    private static object? Cover(JsObj node)
    {
        var s = Js.Truthy(node["image"]) ? Get(node["image"], "sources") : node["image"];
        if (!Js.Truthy(s) || !IsObject(s)) return null;
        foreach (var size in new[] { "lg", "xxl", "md", "sm" })
        {
            var v = Get(s, size);
            if (Js.Truthy(v) && Js.Truthy(Get(v, "url"))) return Get(v, "url");
        }
        return null;
    }

    /* Every review in the state, found wherever it sits: { url, album, artist, score, isBestNewMusic, cover, date }. */
    public static List<JsObj> CollectReviewItems(object? state)
    {
        var outList = new List<JsObj>();
        var seen = new HashSet<string>();
        var stack = new Stack<object?>();
        stack.Push(state);
        var guard = 0;
        while (stack.Count > 0 && guard++ < 500000)
        {
            var node0 = stack.Pop();
            if (!Js.Truthy(node0) || !IsObject(node0)) continue;
            if (node0 is List<object?> list) { foreach (var x in list) if (Js.Truthy(x) && IsObject(x)) stack.Push(x); continue; }
            if (node0 is not JsObj node) continue;
            if (Js.StrictEq(node["contentType"], "review") && Js.Truthy(node["ratingValue"]) && node["url"] is string url)
            {
                var full = QueryOrHash.Split(url.StartsWith("http", StringComparison.Ordinal) ? url : "https://pitchfork.com" + url)[0];
                if (seen.Add(full))
                {
                    var album = "";
                    if (node["dangerousHed"] is string hed) album = Js.Trim(WriteUps.StripHtml(hed));
                    if (album.Length == 0 && Js.Truthy(node["source"]) && Get(node["source"], "hed") is string sh) album = Js.Trim(Stars.Replace(sh, ""));
                    var artist = Js.Truthy(node["subHed"]) && Get(node["subHed"], "name") is string an ? Js.Trim(an) : null;
                    var rv = node["ratingValue"];
                    var sc = Get(rv, "score");
                    double? score = null;
                    if (!Js.IsNullish(sc) && !Js.StrictEq(sc, "")) { var v = Js.ParseFloat(sc); score = double.IsFinite(v) ? v : null; }
                    var o = new JsObj();
                    o["url"] = full;
                    o["album"] = album;
                    o["artist"] = artist;
                    o["score"] = score;
                    o["isBestNewMusic"] = Js.Truthy(Get(rv, "isBestNewMusic")) || Js.Truthy(Get(rv, "isBestNewReissue"));
                    o["cover"] = Cover(node);
                    o["date"] = Js.Truthy(node["pubDate"]) ? node["pubDate"] : null;
                    outList.Add(o);
                }
            }
            foreach (var k in node.Keys) { var v = node[k]; if (Js.Truthy(v) && IsObject(v)) stack.Push(v); }
        }
        return outList;
    }

    /* A listing page's reviews; none when it carries no state, or one that won't parse. */
    public static List<JsObj> ListingItems(string html)
    {
        var raw = ExtractPreloadedState(html);
        if (raw == null) return [];
        object? state;
        try { state = JsJson.Parse(raw); } catch (Exception) { return []; }
        return CollectReviewItems(state);
    }

    /* An item as the page gets it. */
    public static JsObj ItemOut(JsObj x)
    {
        var o = new JsObj();
        o["url"] = x["url"];
        o["album"] = Js.Truthy(x["album"]) ? x["album"] : "";
        o["artist"] = Js.Truthy(x["artist"]) ? x["artist"] : null;
        o["cover"] = Js.Truthy(x["cover"]) ? x["cover"] : null;
        o["score"] = !Js.IsNullish(x["score"]) ? x["score"] : null;
        o["isBestNewMusic"] = Js.Truthy(x["isBestNewMusic"]);
        o["date"] = Js.Truthy(x["date"]) ? x["date"] : null;
        return o;
    }

    /* Newest first by the date as text (localeCompare), undated last, in their order. */
    public static List<JsObj> NewestFirst(IEnumerable<JsObj> items)
    {
        static string D(JsObj o) => Js.Truthy(o["date"]) ? Js.Str(o["date"]) : "";
        return Library.Sorted(items, (a, b) => Library.Lc(D(b), D(a)));
    }

    /* The reviews on either list whose album or artist holds the words, each once, [limit] at most. */
    public static List<JsObj> Match(List<JsObj> latest, List<JsObj> best, object? q, int limit)
    {
        var nq = WriteUps.Normalize(q);
        if (nq.Length == 0) return [];
        var seen = new HashSet<string>();
        var outList = new List<JsObj>();
        foreach (var it in latest.Concat(best))
        {
            if (!seen.Add(Js.Str(it["url"]))) continue;
            if (WriteUps.Normalize(it["album"]).Contains(nq, StringComparison.Ordinal) || WriteUps.Normalize(Js.Truthy(it["artist"]) ? it["artist"] : "").Contains(nq, StringComparison.Ordinal))
            {
                outList.Add(it);
                if (outList.Count >= limit) break;
            }
        }
        return outList;
    }
}
