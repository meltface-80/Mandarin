// ShareLinks.cs — the links under the share card (v0.8.20): lib/share-links.js,
// rule for rule. Where to hear a record (a search on each service) and where
// to read about it; pure functions of a title, an artist and a locale.
//
// The four rules that cost something to learn, all in SearchQuery: the query
// percent-encoded (a space is %20); a slash spent as a space; only the first
// credited act; and Qobuz's thirty storefronts (Apple's links carry none).
using System.Text.RegularExpressions;
using Mandarin.Server.Identify;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal static partial class ShareLinks
{
    public static readonly (string Id, string Name)[] Services =
    [
        ("qobuz", "Qobuz"), ("spotify", "Spotify"), ("apple", "Apple Music"),
        ("amazon", "Amazon Music"), ("deezer", "Deezer"), ("bandcamp", "Bandcamp"),
    ];

    public static readonly (string Id, string Name, string Kind, string Chip, bool OnByDefault)[] Reviews =
    [
        ("wikipedia", "Wikipedia", "album", "Wikipedia", true),
        ("pitchfork", "Pitchfork", "album", "Pitchfork", true),
        ("allmusic", "AllMusic", "album", "AllMusic", true),
        ("wikipedia-artist", "Wikipedia", "artist", "Wikipedia artist", false),
        ("allmusic-artist", "AllMusic", "artist", "AllMusic artist", false),
    ];

    private static readonly string[] Storefronts =
    [
        "ar-es", "at-de", "au-en", "be-fr", "be-nl", "br-pt", "ca-en", "ca-fr",
        "ch-de", "ch-fr", "cl-es", "co-es", "de-de", "dk-en", "es-es", "fi-en",
        "fr-fr", "gb-en", "ie-en", "it-it", "jp-ja", "lu-de", "lu-fr", "mx-es",
        "nl-nl", "no-en", "nz-en", "pt-pt", "se-en", "us-en",
    ];
    private const string DefaultStore = "us-en";

    private const string Ws = "[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";

    // /\s+\/\s*|\s*\/\s+|\s*;\s*|\s+(?:feat\.?|ft\.?|featuring)\s+/i
    [GeneratedRegex(Ws + "+/" + Ws + "*|" + Ws + "*/" + Ws + "+|" + Ws + "*;" + Ws + "*|" + Ws + "+(?:[fF][eE][aA][tT]\\.?|[fF][tT]\\.?|[fF][eE][aA][tT][uU][rR][iI][nN][gG])" + Ws + "+")]
    private static partial Regex CreditSeparator();
    [GeneratedRegex("[/\\\\]")] private static partial Regex Slashes();
    [GeneratedRegex(Ws + "+")] private static partial Regex Spaces();
    [GeneratedRegex("[-_]")] private static partial Regex TagParts();
    [GeneratedRegex("[^a-z]")] private static partial Regex NotLetters();
    [GeneratedRegex("^" + Ws + "*[qQ]" + Ws + "*=" + Ws + "*([0-9.]+)" + Ws + "*\\z")] private static partial Regex QParam();

    /* The first credited act. Rule 3. */
    public static string PrimaryArtist(object? artist)
    {
        var whole = Js.Trim(Js.IsNullish(artist) ? "" : Js.Str(artist));
        if (whole.Length == 0) return "";
        var first = Js.Trim(CreditSeparator().Split(whole)[0]);
        return first.Length > 0 ? first : whole;
    }

    /* "act album", percent-encoded — or null when there is nothing worth searching for. */
    public static string? SearchQuery(object? artist, object? album)
    {
        var act = PrimaryArtist(artist);
        var words = Spaces().Replace(Js.Trim(Slashes().Replace(act + " " + (Js.IsNullish(album) ? "" : Js.Str(album)), " ")), " ");
        if (words.Length == 0) return null;
        return Lookups.Encode(words);
    }

    /* The Qobuz storefront for a locale tag: the exact one, else the country's, else us-en. */
    public static string QobuzStorefront(object? locale)
    {
        var tag = Js.Lower(Js.Trim(Js.IsNullish(locale) ? "" : Js.Str(locale)));
        if (tag.Length == 0) return DefaultStore;
        var parts = TagParts().Split(tag);
        var language = parts[0];
        var country = NotLetters().Replace(parts.Length > 1 ? parts[^1] : language, "");
        if (country.Length == 0) return DefaultStore;
        var exact = $"{country}-{language}";
        if (Storefronts.Contains(exact)) return exact;
        return Storefronts.FirstOrDefault(s => s.StartsWith(country + "-", StringComparison.Ordinal)) ?? DefaultStore;
    }

    /* The best locale tag in an Accept-Language header, or "". */
    public static string LocaleFromAcceptLanguage(string? header)
    {
        var s = Js.Trim(header ?? "");
        if (s.Length == 0) return "";
        string? bestTag = null;
        double bestQ = 0;
        foreach (var part in s.Split(','))
        {
            var bits = Js.Trim(part).Split(';');
            var tag = Js.Trim(bits[0]);
            if (tag.Length == 0 || tag == "*") continue;
            double q = 1;
            foreach (var p in bits.Skip(1))
            {
                var m = QParam().Match(p);
                if (m.Success) q = Js.ParseFloat(m.Groups[1].Value);
            }
            if (!double.IsFinite(q)) q = 0;
            if (bestTag == null || q > bestQ) { bestTag = tag; bestQ = q; }
        }
        return bestTag ?? "";
    }

    private static string? ServiceUrl(string id, string query, string storefront) => id switch
    {
        "qobuz" => $"https://www.qobuz.com/{storefront}/search/?q={query}",
        "spotify" => $"https://open.spotify.com/search/{query}",
        "apple" => $"https://music.apple.com/search?term={query}",
        "amazon" => $"https://music.amazon.com/search/{query}",
        "deezer" => $"https://www.deezer.com/search/{query}",
        "bandcamp" => $"https://bandcamp.com/search?q={query}&item_type=a",
        _ => null
    };

    /* Where to hear this record, in the order the row shows them. */
    public static List<object?> ServiceLinks(object? artist, object? album, string? locale, IReadOnlyCollection<string>? enabled)
    {
        var outList = new List<object?>();
        var query = SearchQuery(artist, album);
        if (query == null) return outList;
        var storefront = QobuzStorefront(locale);
        foreach (var (id, name) in Services)
        {
            if (enabled != null && !enabled.Contains(id)) continue;
            var url = ServiceUrl(id, query, storefront);
            if (url == null) continue;
            var o = new JsObj();
            o["id"] = id;
            o["name"] = name;
            o["url"] = url;
            outList.Add(o);
        }
        return outList;
    }

    /* Where to read about it: a resolved article or review when one is known, else a search. */
    public static List<object?> ReviewLinks(object? artist, object? album, IReadOnlyCollection<string>? enabled,
        string? wikipediaUrl = null, string? pitchforkUrl = null, string? wikipediaArtistUrl = null)
    {
        var outList = new List<object?>();
        var query = SearchQuery(artist, album);
        if (query == null) return outList;
        var artistQuery = SearchQuery(artist, "");
        var allow = enabled ?? Reviews.Where(r => r.OnByDefault).Select(r => r.Id).ToList();
        string? UrlFor(string id) => id switch
        {
            "wikipedia" => !string.IsNullOrEmpty(wikipediaUrl) ? wikipediaUrl : $"https://en.wikipedia.org/w/index.php?search={query}",
            "pitchfork" => !string.IsNullOrEmpty(pitchforkUrl) ? pitchforkUrl : $"https://pitchfork.com/search/?q={query}",
            "allmusic" => $"https://www.allmusic.com/search/albums/{query}",
            "wikipedia-artist" => artistQuery != null ? (!string.IsNullOrEmpty(wikipediaArtistUrl) ? wikipediaArtistUrl : $"https://en.wikipedia.org/w/index.php?search={artistQuery}") : null,
            "allmusic-artist" => artistQuery != null ? $"https://www.allmusic.com/search/artists/{artistQuery}" : null,
            _ => null
        };
        foreach (var (id, name, kind, chip, _) in Reviews)
        {
            if (!allow.Contains(id)) continue;
            var url = UrlFor(id);
            if (url == null) continue;
            var o = new JsObj();
            o["id"] = id;
            o["name"] = name;
            o["chip"] = chip;
            o["kind"] = kind;
            o["url"] = url;
            outList.Add(o);
        }
        return outList;
    }

    public static List<string> KnownServiceIds() => Services.Select(s => s.Id).ToList();
    public static List<string> KnownReviewIds() => Reviews.Select(r => r.Id).ToList();

    /* Only ids this build knows, in the table's order. */
    public static List<string> SanitiseIds(object? ids, List<string> known)
    {
        var want = new HashSet<string>((ids as List<object?> ?? []).OfType<string>());
        return known.Where(want.Contains).ToList();
    }
    public static List<string> DefaultServiceIds() => KnownServiceIds();
    public static List<string> DefaultReviewIds() => Reviews.Where(r => r.OnByDefault).Select(r => r.Id).ToList();

    /* ctx.shareServices(): the services chosen in Settings, or all of them. */
    public static List<string> EnabledServices(Microsoft.Data.Sqlite.SqliteConnection c)
    {
        var v = Setting(c, "shareServices");
        return v is null ? DefaultServiceIds() : SanitiseIds(v, KnownServiceIds());
    }
    public static List<string> EnabledReviews(Microsoft.Data.Sqlite.SqliteConnection c)
    {
        var v = Setting(c, "shareReviews");
        return v is null ? DefaultReviewIds() : SanitiseIds(v, KnownReviewIds());
    }

    /* db.setting(key, null): the stored JSON as JSON.parse reads it; null when there's none. */
    private static object? Setting(Microsoft.Data.Sqlite.SqliteConnection c, string key)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT value FROM settings WHERE key = $k";
        cmd.Parameters.AddWithValue("$k", key);
        if (cmd.ExecuteScalar() is not string v) return null;
        try { return Scan.JsJson.Parse(v); } catch (Exception) { return null; }
    }
}
