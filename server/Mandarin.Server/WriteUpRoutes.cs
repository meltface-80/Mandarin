// WriteUpRoutes.cs — a record's write-up and links (v0.8.21), from the
// write-ups and share-card parts of lib/server/api-library.js, in the same
// shapes: an album's extras (its year and release day, the write-up and the
// artist's story, its label, where to hear it and read about it), an artist's
// story, Pitchfork's lists and a review's match in the library, the share
// card's settings, the link that opens the Qobuz app, and the Pitchfork part
// of the search. The sources are asked here once the Node server has said
// where they are (Jobs.cs); until then, by the Node server. The wall display's
// page, which follows what plays, stays with the Node server.
using System.Text.Json.Nodes;
using Mandarin.Server.Extras;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    private static WriteUpSources? HeldWriteUps => Jobs.Held ? Jobs.WriteUps : null;
    private const double ThirtyDays = 30.0 * 86400000;

    /* A Map of five hundred, the oldest let go first. */
    private sealed class Memo500
    {
        private readonly Dictionary<string, object?> map = [];
        private readonly LinkedList<string> order = new();
        public bool TryGet(string k, out object? v) { lock (map) return map.TryGetValue(k, out v); }
        public void Set(string k, object? v)
        {
            lock (map)
            {
                if (!map.ContainsKey(k)) order.AddLast(k);
                map[k] = v;
                if (map.Count > 500) { map.Remove(order.First!.Value); order.RemoveFirst(); }
            }
        }
    }
    private static readonly Memo500 ExtrasMemo = new(), BioMemo = new(), QobuzLinkMemo = new();

    private static string Fold2(string title, string artist) => Names.Fold(title) + "||" + Names.Fold(artist);
    private static async Task<T?> Quietly<T>(Task<T?> t) where T : class { try { return await t; } catch (Exception) { return null; } }

    /* albumExtras: the year and the write-ups, kept a month when there's an answer (a miss is asked again next time). */
    private static async Task<JsObj> AlbumExtrasOf(WriteUpSources w, string title, string artist)
    {
        var key = Fold2(title, artist);
        if (ExtrasMemo.TryGet(key, out var m) && m is JsObj memo) return memo;
        var v = Taste.CacheGet("extras", key, ThirtyDays) as JsObj;
        if (v == null)
        {
            var yearTask = Quietly(w.AlbumYear(title, artist));
            var biosTask = Quietly(w.AlbumBios(title, artist));
            var year = await yearTask;
            var bios = await biosTask;
            v = new JsObj();
            v["year"] = year;
            v["bios"] = bios;
            if (TJs.Truthy(year) || (bios != null && (TJs.Truthy(bios["album"]) || TJs.Truthy(bios["artist"])))) Taste.CachePut("extras", key, v);
        }
        ExtrasMemo.Set(key, v);
        return v;
    }

    /* Whether the share card carries the write-up (Settings → Share Card): on unless switched off. */
    private static bool CardReview() => !TJs.StrictEq(Labels.Setting("shareCardReview"), false);

    private static object? Field(object? o, string k) => o is JsObj j ? j[k] : Undef.V;
    private static string? UrlField(object? urls, string k) { var v = Field(urls, k); return TJs.Truthy(v) ? TJs.Str(v) : null; }
    private static string? AcceptLanguage(HttpContext ctx) => ctx.Request.Headers.AcceptLanguage.Count > 0 ? ctx.Request.Headers.AcceptLanguage.ToString() : null;

    /* GET /api/album/extras?title=&artist=[&day=1][&fast=1] */
    private static async Task<bool> AlbumExtras(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldWriteUps is not { } w) return false;
        var title = Q(ctx, "title") ?? "";
        var artist = Q(ctx, "artist") ?? "";
        if (title.Length == 0) return await JsError(ctx, 400, "title query parameter required");
        var al = Relocate(s, title, artist);
        // The album page shows the full release date: looked up there and then
        // when only the year is known (a second and a half at most).
        string? dayNow = null;
        if (al != null && Q(ctx, "day") == "1" && Jobs.Days is { } days) dayNow = await days.Now(al);
        object? year = al is { Year: { } y and not 0 } ? y.ToString(System.Globalization.CultureInfo.InvariantCulture) : null;
        object? bios = null;
        if (Q(ctx, "fast") != "1")
        {
            var ex = await AlbumExtrasOf(w, title, artist);
            year = TJs.Truthy(year) ? year : ex["year"];
            bios = ex["bios"];
        }
        else if (Taste.CacheGet("extras", Fold2(title, artist), 0) is var hit && TJs.Truthy(hit))
        {
            year = TJs.Truthy(year) ? year : Field(hit, "year");
            bios = Field(hit, "bios");
        }
        if (TJs.Truthy(bios) && Field(bios, "album") is JsObj a0 && TJs.Truthy(year)) a0["year"] = year;
        // The label is the library's own (Settings → Record labels), never one a write-up names.
        var label = al != null ? s.LabelOf(al) : null;
        if (TJs.Truthy(bios) && TJs.Truthy(Field(bios, "album")))
        {
            var copy = new JsObj();
            if (Field(bios, "album") is JsObj album) foreach (var k in album.Keys) copy[k] = album[k];
            copy["label"] = label;
            ((JsObj)bios!)["album"] = copy;
        }
        else if (label != null)
        {
            var nb = new JsObj();
            if (bios is JsObj old) foreach (var k in old.Keys) nb[k] = old[k];
            var only = new JsObj();
            only["label"] = label;
            nb["album"] = only;
            bios = nb;
        }
        List<string> services, reviews;
        using (var c = Db.Open()) { services = ShareLinks.EnabledServices(c); reviews = ShareLinks.EnabledReviews(c); }
        var locale = ShareLinks.LocaleFromAcceptLanguage(AcceptLanguage(ctx));
        var urls = TJs.Truthy(bios) ? Field(bios, "urls") : null;
        var o = new JsObj();
        o["year"] = year;
        o["release_date"] = dayNow ?? (al != null && !string.IsNullOrEmpty(al.Date) ? al.Date : year);
        o["album"] = TJs.Truthy(bios) ? Field(bios, "album") : null;
        o["artist"] = TJs.Truthy(bios) ? Field(bios, "artist") : null;
        var card = new JsObj();
        card["review"] = CardReview();
        o["card"] = card;
        var links = new JsObj();
        links["services"] = ShareLinks.ServiceLinks(artist, title, locale, services);
        links["reviews"] = ShareLinks.ReviewLinks(artist, title, reviews,
            TJs.Truthy(urls) ? UrlField(urls, "wikipediaAlbum") : null, TJs.Truthy(urls) ? UrlField(urls, "pitchfork") : null, TJs.Truthy(urls) ? UrlField(urls, "wikipediaArtist") : null);
        o["links"] = links;
        return await SendJs(ctx, o);
    }

    /* GET /api/artist-bio?artist=[&album=]: the act's own article, kept a month (a miss too). */
    private static async Task<bool> ArtistBio(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldWriteUps is not { } w) return false;
        var artist = TJs.Trim(Q(ctx, "artist") ?? "");
        if (artist.Length == 0) return await JsError(ctx, 400, "artist required");
        var album = TJs.Trim(Q(ctx, "album") ?? "");
        var key = Fold2(artist, album);
        object? bio;
        if (!BioMemo.TryGet(key, out bio))
        {
            bio = Taste.CacheGet("artist-bio", key, ThirtyDays);
            if (bio is Undef)
            {
                bio = await Quietly(w.WikiArtist(artist, album.Length > 0 ? album : null));
                Taste.CachePut("artist-bio", key, TJs.Truthy(bio) ? bio : null);
            }
            BioMemo.Set(key, bio);
        }
        var o = new JsObj();
        if (!TJs.Truthy(bio) || !TJs.Truthy(Field(bio, "description"))) { o["bio"] = null; return await SendJs(ctx, o); }
        var b = new JsObj();
        b["name"] = TJs.Truthy(Field(bio, "name")) ? Field(bio, "name") : artist;
        b["text"] = Field(bio, "description");
        b["source"] = TJs.Truthy(Field(bio, "source")) ? Field(bio, "source") : "Wikipedia";
        b["image"] = null;
        o["bio"] = b;
        return await SendJs(ctx, o);
    }

    /* GET /api/pitchfork/reviews?type=latest|best */
    private static async Task<bool> PitchforkReviews(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldWriteUps is not { } w) return false;
        var type = Q(ctx, "type") == "best" ? "best" : "latest";
        try
        {
            var o = new JsObj();
            o["type"] = type;
            o["items"] = (await w.Reviews(type)).Select(x => (object?)x).ToList();
            return await SendJs(ctx, o);
        }
        catch (Exception e) { return await JsError(ctx, 500, e.Message); }
    }

    [System.Text.RegularExpressions.GeneratedRegex("^[A-Za-z][A-Za-z0-9+.-]*:")] private static partial System.Text.RegularExpressions.Regex SchemeStart();

    /* GET /api/pitchfork/review?url=&album=&artist=: the record in the library, when it's confidently this one. */
    private static Task<bool> PitchforkReviewMatch(HttpContext ctx, Snapshot s, LibState st)
    {
        var raw = Q(ctx, "url") ?? "";
        var text = raw.Trim('\u0000', '\u0001', '\u0002', '\u0003', '\u0004', '\u0005', '\u0006', '\u0007', '\u0008', '\t', '\n', '\u000b', '\u000c', '\r', '\u000e', '\u000f',
            '\u0010', '\u0011', '\u0012', '\u0013', '\u0014', '\u0015', '\u0016', '\u0017', '\u0018', '\u0019', '\u001a', '\u001b', '\u001c', '\u001d', '\u001e', '\u001f', ' ');
        if (!SchemeStart().IsMatch(text) || !Uri.TryCreate(text, UriKind.Absolute, out var u)) return JsError(ctx, 400, "Invalid url");
        if (u.Host != "pitchfork.com" || !u.AbsolutePath.StartsWith("/reviews/albums/", StringComparison.Ordinal)) return JsError(ctx, 400, "Not a Pitchfork album-review URL");
        string album = Q(ctx, "album") ?? "", artist = Q(ctx, "artist") ?? "";
        var al = Relocate(s, album, artist);
        JsonObject? match = al != null ? AlbumJson(s, al) : null;
        var want = Names.Fold(album);
        if (match == null && want.Length > 0)
        {
            foreach (var (hal, score) in SearchHits(s, (artist.Length > 0 ? artist + " " : "") + album, 3))
            {
                var got = Names.Fold(hal.Title);
                if (got.Length > 0 && (got == want || got.StartsWith(want, StringComparison.Ordinal) || want.StartsWith(got, StringComparison.Ordinal)))
                {
                    match = AlbumJson(s, hal, new JsonObject { ["score"] = score });
                    break;
                }
            }
        }
        return Send(ctx, new JsonObject { ["review"] = null, ["match"] = match });
    }

    // ------------------------------------------------------------ the share card

    private static JsObj ShareSettingsJson(List<string> services, List<string> reviews)
    {
        var o = new JsObj();
        var sv = new JsObj();
        sv["all"] = ShareLinks.Services.Select(x => { var j = new JsObj(); j["id"] = x.Id; j["name"] = x.Name; return (object?)j; }).ToList();
        sv["enabled"] = services.Select(x => (object?)x).ToList();
        var rv = new JsObj();
        rv["all"] = ShareLinks.Reviews.Select(x =>
        {
            var j = new JsObj();
            j["id"] = x.Id; j["name"] = x.Name; j["kind"] = x.Kind; j["chip"] = x.Chip; j["onByDefault"] = x.OnByDefault;
            return (object?)j;
        }).ToList();
        rv["enabled"] = reviews.Select(x => (object?)x).ToList();
        o["services"] = sv;
        o["reviews"] = rv;
        var card = new JsObj();
        card["review"] = CardReview();
        o["card"] = card;
        return o;
    }

    /* GET /api/settings/share-links: what can be shown under the card, what is, and whether the card carries the write-up. */
    private static Task<bool> ShareSettings(HttpContext ctx, Snapshot s, LibState st)
    {
        using var c = Db.Open();
        return SendJs(ctx, ShareSettingsJson(ShareLinks.EnabledServices(c), ShareLinks.EnabledReviews(c)));
    }

    /* POST /api/settings/share-links { services?, reviews?, card_review? } */
    private static async Task<bool> SaveShareSettings(HttpContext ctx, Snapshot s, LibState st)
    {
        var b0 = await Auth.Body(ctx);
        if (b0 == null) return true;
        var b = FromNode(b0) as JsObj ?? new JsObj();
        var touched = false;
        if (b["services"] is List<object?>) { Labels.SetSetting("shareServices", ShareLinks.SanitiseIds(b["services"], ShareLinks.KnownServiceIds()).Select(x => (object?)x).ToList()); touched = true; }
        if (b["reviews"] is List<object?>) { Labels.SetSetting("shareReviews", ShareLinks.SanitiseIds(b["reviews"], ShareLinks.KnownReviewIds()).Select(x => (object?)x).ToList()); touched = true; }
        if (b["card_review"] is bool cr) { Labels.SetSetting("shareCardReview", cr); touched = true; }
        if (!touched) return await JsError(ctx, 400, "services, reviews and/or card_review required");
        using var c = Db.Open();
        var o = new JsObj();
        o["ok"] = true;
        var full = ShareSettingsJson(ShareLinks.EnabledServices(c), ShareLinks.EnabledReviews(c));
        o["services"] = Field(full["services"], "enabled");
        o["reviews"] = Field(full["reviews"], "enabled");
        o["card"] = full["card"];
        return await SendJs(ctx, o);
    }

    /* GET /api/qobuz-link?album=&artist=: the link that opens the Qobuz app on this record (an id off Qobuz's own search page), or null. */
    private static async Task<bool> QobuzLink(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldWriteUps is not { } w) return false;
        var album = TJs.Trim(Q(ctx, "album") ?? "");
        var artist = TJs.Trim(Q(ctx, "artist") ?? "");
        if (album.Length == 0) return await JsError(ctx, 400, "album query parameter required");
        var store = ShareLinks.QobuzStorefront(ShareLinks.LocaleFromAcceptLanguage(AcceptLanguage(ctx)));
        var key = store + "|" + Similar.Normalize(artist) + "|" + Similar.Normalize(album);
        string id;
        if (QobuzLinkMemo.TryGet(key, out var known)) id = known as string ?? "";
        else
        {
            try
            {
                id = await w.QobuzAlbumId(store, artist, album) ?? "";
                QobuzLinkMemo.Set(key, id);
            }
            // Qobuz away: no link this time, and asked again next time.
            catch (Exception) { id = ""; }
        }
        ctx.Response.Headers.CacheControl = "public, max-age=604800";
        var o = new JsObj();
        o["url"] = WriteUps.DeepLink(id.Length > 0 ? id : null);
        return await SendJs(ctx, o);
    }

    /* GET /api/search/external?q=&parts=pitchfork: Pitchfork's reviews the words find (the services' parts are the Node server's). */
    private static async Task<bool> SearchExternal(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldWriteUps is not { } w) return false;
        var q = TJs.Trim(Q(ctx, "q") ?? "");
        var o = new JsObj();
        o["query"] = q;
        if (q.Length == 0)
        {
            o["qobuz"] = null; o["tidal"] = null; o["pitchfork"] = new List<object?>();
            return await SendJs(ctx, o);
        }
        var parts = (Q(ctx, "parts") is { } p0 && p0.Length > 0 ? p0 : "services,pitchfork").Split(',');
        if (parts.Any(p => p is "services" or "qobuz" or "tidal")) return false;
        List<object?> pf = [];
        if (parts.Contains("pitchfork"))
        {
            var search = w.SearchReviews(q, 6);
            if (await Task.WhenAny(search, Task.Delay(10000)) == search)
                try { pf = (await search).Select(x => (object?)x).ToList(); } catch (Exception) { pf = []; }
        }
        o["qobuz"] = null; o["qobuz_artists"] = null; o["tidal"] = null; o["tidal_artists"] = null;
        o["pitchfork"] = pf;
        return await SendJs(ctx, o);
    }
}
