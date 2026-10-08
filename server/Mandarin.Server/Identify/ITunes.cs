// ITunes.cs — Apple's catalogue as a second opinion for the identification
// scan (v0.8.19): lib/identify/itunes.js, rule for rule. Apple's iTunes Search
// API needs no key and no account: an album search and a lookup of one
// album's songs, each with its title and its length to the millisecond. Apple
// asks for no more than about twenty requests a minute from one address; this
// keeps to one every 3.2 seconds. A refusal (403 or 429) pauses iTunes for a
// quarter of an hour; MusicBrainz carries on.
//
// Candidates come back in the shape MusicBrainz.cs gives, so the scorer weighs
// them the same way. What Apple can't say is left out: no release group and
// no year (Apple's date is the edition's on sale, often a remaster's).
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class ITunes
{
    public const string DefaultBase = "https://itunes.apple.com";
    public const int GapMs = 3200;
    public const long PauseMs = 15 * 60 * 1000;

    public readonly string BaseUrl;
    public readonly string Country;
    public readonly int Gap;
    // How long a refusal rests it: a quarter of an hour (ITUNES_PAUSE_MS for the tests).
    public readonly long Pause = long.TryParse(Environment.GetEnvironmentVariable("ITUNES_PAUSE_MS"), out var ms) && ms > 0 ? ms : PauseMs;
    private readonly string userAgent;
    private readonly Action<string> log;
    private readonly object slot = new();
    private long last;
    public long PausedUntil;
    public int Requests;

    public ITunes(string? baseUrl, string version, Action<string> log, string? country = null, int? gapMs = null)
    {
        BaseUrl = (string.IsNullOrEmpty(baseUrl) ? DefaultBase : baseUrl).TrimEnd('/');
        var c = !string.IsNullOrEmpty(country) ? country : Environment.GetEnvironmentVariable("ITUNES_COUNTRY");
        Country = Js.Upper(string.IsNullOrEmpty(c) ? "US" : c);
        Gap = gapMs ?? (BaseUrl == DefaultBase ? GapMs : 0);
        userAgent = $"Mandarin/{version} ( https://github.com/meltface-80/Mandarin )";
        this.log = log;
    }

    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    /* Refusing for now (it said too many): don't ask. */
    public bool Paused => Now < PausedUntil;

    // Apple's suffixes that aren't part of the name: /\s+-\s+(?:Single|EP)\s*$/i.
    [GeneratedRegex("[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+-[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+(?:[Ss][Ii][Nn][Gg][Ll][Ee]|[Ee][Pp])[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*\\z")]
    private static partial Regex FormatTail();
    [GeneratedRegex("[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff-]")]
    private static partial Regex WsOrDash();

    private async Task<object?> Get(string path, params (string, object?)[] ps)
    {
        if (Paused) throw new LookupError("iTunes asked us to wait") { Paused = true };
        long at;
        lock (slot)
        {
            // One after another, a gap apart, however many ask at once.
            at = Math.Max(Now, last + Gap);
            last = at;
        }
        var wait = at - Now;
        if (wait > 0) await Task.Delay(TimeSpan.FromMilliseconds(wait));
        Interlocked.Increment(ref Requests);
        var all = new List<(string, object?)> { ("country", Country) };
        all.AddRange(ps);
        try
        {
            return await Lookups.Json($"{BaseUrl}/{path}?{Lookups.Query(all)}", [("User-Agent", userAgent), ("Accept", "application/json")], 15000);
        }
        catch (LookupError e) when (e.Status is 403 or 429)
        {
            PausedUntil = Now + Pause;
            log("[identify] iTunes asked us to slow down; asking it again in a quarter of an hour");
            throw new LookupError(e.Message) { Status = e.Status, Paused = true };
        }
    }

    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static string S(object? v) => Js.Truthy(v) ? Js.Str(v) : "";
    private static double N(object? v, double d) => Js.Truthy(v) ? Js.ToNumber(v) : d;

    /* Albums that could be this one: by artist and title, or by title alone when the artist tag can't be trusted. */
    public async Task<List<JsObj>> Search(object? title, object? artist, double limit = 15)
    {
        var term = Js.Trim(string.Join(" ", new[] { artist, title }.Where(Js.Truthy).Select(Js.Str)));
        if (term.Length == 0) return [];
        var j = await Get("search", ("term", term), ("media", "music"), ("entity", "album"), ("limit", limit));
        var outList = new List<JsObj>();
        foreach (var r0 in L((j as JsObj)?["results"]))
        {
            if (r0 is not JsObj r || !Js.Truthy(r["collectionId"])) continue;
            var o = new JsObj();
            o["id"] = Js.Str(r["collectionId"]);
            o["title"] = S(r["collectionName"]);
            o["artist"] = S(r["artistName"]);
            o["track_count"] = Js.Truthy(r["trackCount"]) ? r["trackCount"] : 0.0;
            outList.Add(o);
        }
        return outList;
    }

    /* One album in full, as a candidate for the scorer — or null. */
    public async Task<JsObj?> Album(object? id) => AlbumFrom(await Get("lookup", ("id", id), ("entity", "song"), ("limit", 200.0)));

    /* The album carrying this barcode (UPC/EAN), in full. */
    public async Task<JsObj?> ByUpc(object? upc)
    {
        var code = new string((Js.IsNullish(upc) || !Js.Truthy(upc) ? "" : Js.Str(upc)).Where(char.IsAsciiDigit).ToArray());
        if (code.Length == 0) return null;
        return AlbumFrom(await Get("lookup", ("upc", code), ("entity", "song"), ("limit", 200.0)));
    }

    public JsObj? AlbumFrom(object? j)
    {
        var rows = L((j as JsObj)?["results"]);
        var col = rows.OfType<JsObj>().FirstOrDefault(r => Js.StrictEq(r["wrapperType"], "collection"));
        if (col == null) return null;
        var songs = Library.Sorted(rows.OfType<JsObj>().Where(r => Js.StrictEq(r["wrapperType"], "track") && Js.StrictEq(r["kind"], "song")),
            (a, b) =>
            {
                var d = Lookups.Sgn(N(a["discNumber"], 1) - N(b["discNumber"], 1));
                return d != 0 ? d : Lookups.Sgn(N(a["trackNumber"], 0) - N(b["trackNumber"], 0));
            });
        if (songs.Count == 0) return null;
        var name = S(col["collectionName"]);
        var tail = FormatTail().Match(name);
        var type = WsOrDash().Replace(tail.Success ? tail.Value : "", "");
        var c = new JsObj();
        c["mbid"] = "itunes:" + Js.Str(col["collectionId"]);
        c["source"] = "itunes";
        c["group_mbid"] = null;
        c["title"] = FormatTail().Replace(name, "", 1);
        c["artist"] = S(col["artistName"]);
        c["year"] = null;
        c["date"] = null;
        c["release_title"] = name;
        c["release_year"] = null;
        c["release_date"] = Js.Truthy(col["releaseDate"]) ? Slice(Js.Str(col["releaseDate"]), 10) : null;
        c["edition"] = "";
        c["type"] = type.Length > 0 ? type : "Album";
        c["country"] = Js.Truthy(col["country"]) ? col["country"] : Country;
        c["discs"] = songs.Select(s => N(s["discNumber"], 1)).Aggregate(1.0, JsMax);
        c["track_count"] = (double)songs.Count;
        var tracks = new List<object?>();
        for (var i = 0; i < songs.Count; i++)
        {
            var s = songs[i];
            var t = new JsObj();
            t["disc"] = Js.Truthy(s["discNumber"]) ? s["discNumber"] : 1.0;
            t["no"] = Js.Truthy(s["trackNumber"]) ? s["trackNumber"] : (double)(i + 1);
            t["title"] = S(s["trackName"]);
            t["artist"] = S(s["artistName"]);
            t["length"] = !Js.IsNullish(s["trackTimeMillis"]) ? Js.ToNumber(s["trackTimeMillis"]) / 1000 : null;
            tracks.Add(t);
        }
        c["tracks"] = tracks;
        return c;
    }

    /* Math.max: NaN wins. */
    private static double JsMax(double a, double b) => double.IsNaN(a) || double.IsNaN(b) ? double.NaN : Math.Max(a, b);

    /* String.prototype.slice(0, n), by UTF-16 units as JavaScript counts them. */
    private static string Slice(string s, int n) => s.Length <= n ? s : s[..n];
}
