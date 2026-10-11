// ServiceRoutes.cs — Qobuz's and Tidal's catalogue, as the page and the apps
// browse it (v0.8.39, stage 4.1 of docs/specs/csharp-migration.md), from
// lib/server/api-service.js in the same shapes and words (Services/):
//
//   GET /api/<s>/lists              the lists the service features (Tidal), the browser's tabs
//   GET /api/<s>/new-releases?days  GET /api/<s>/featured?type=…
//   GET /api/<s>/search?q&offset    GET /api/<s>/artist-albums?artist_id&offset
//   GET /api/<s>/album?id           the album and its tracks
//   GET /api/<s>/state?album_id     whether it is in the account's favourites
//
// and from v0.8.44 (stage 4.2) the library's rows of them (Services/Rows.cs):
//
//   POST /api/<s>/open { album_id } → { ok, offset, album }: the album's page here
//   POST /api/<s>/favorite { album_id } · /unfavorite → { ok, album_id, favourite }:
//                                   on the service, and kept in (or let go from) the library
//   POST /api/library/cleanup { kind: "qobuz" | "tidal" }: the albums no longer wanted
//                                   (where the scans are this server's, Scans.cs)
//
// A streamed album's page (GET /api/album) is LibraryRoutes.cs's, with its
// service's favourite and why it is here (ServiceFields, below).
//
// The sign-in, the settings, the import and playing stay the Node server's
// (stages 4.3, 4.4 and 6). So does a request Tidal's token has to be refreshed
// for: only the Node server refreshes it, so a write it would be refreshed for
// is passed on before anything is written. A body Express would read
// otherwise, or refuse, is passed on as it came too.
// Answered here once the Node server has handed over its work; until then, by it.
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mandarin.Server.Scan;
using Mandarin.Server.Services;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;
using SH = Mandarin.Server.Services.ServiceHttp;

internal static partial class Library
{
    [GeneratedRegex(@"^/api/(qobuz|tidal)/(lists|new-releases|featured|search|artist-albums|album|state)$")]
    private static partial Regex ServicePath();

    private static Catalogue? CatalogueOf(string id) => !Jobs.Held ? null : id == "qobuz" ? Jobs.Qobuz : id == "tidal" ? Jobs.Tidal : null;

    private static JsObj Assigned(JsObj first, JsObj rest)
    {
        foreach (var k in rest.Keys) first[k] = rest[k];
        return first;
    }
    private static JsObj Jso(params (string Key, object? Value)[] kv)
    {
        var o = new JsObj();
        foreach (var (k, v) in kv) o[k] = v;
        return o;
    }

    /* The catalogue's routes: true when answered here. */
    private static async Task<bool> ServiceRoute(HttpContext ctx)
    {
        var m = ctx.Request.Method;
        if (!HttpMethods.IsGet(m) && !HttpMethods.IsHead(m)) return false;
        var match = ServicePath().Match(ctx.Request.Path.Value ?? "");
        if (!match.Success || CatalogueOf(match.Groups[1].Value) is not { } svc) return false;
        var what = match.Groups[2].Value;
        try
        {
            if (!svc.Connected()) return await SendJs(ctx, Jso(("error", "Not signed in to " + svc.Name), ("connected", false)), 401);
            // The favourites a minute old at most, and never from before the Node server's library last changed.
            var ask = new Ask((await State())?.Version);
            var offset = Math.Max(0, SH.NumOr(Num(Q(ctx, "offset")), 0));
            switch (what)
            {
                case "lists":
                    if (svc.Lists(ask) is not { } lists) return await JsError(ctx, 404, svc.Name + " has no lists");
                    return await SendJs(ctx, Jso(("connected", true), ("lists", await lists)));
                case "new-releases":
                    var days = Math.Max(1, Math.Min(90, SH.NumOr(Num(Q(ctx, "days")), 30)));
                    return await SendJs(ctx, Jso(("connected", true), ("days", days), ("albums", await svc.NewReleases(days, ask))));
                case "featured":
                    return await SendJs(ctx, Jso(("connected", true), ("albums", await svc.Featured(Q(ctx, "type") ?? "", ask))));
                case "search":
                    var query = Names.JsTrim(Q(ctx, "q") ?? "");
                    if (query.Length == 0) return await SendJs(ctx, Jso(("connected", true), ("albums", new List<object?>()), ("artists", new List<object?>()), ("total", 0.0), ("has_more", false)));
                    return await SendJs(ctx, Assigned(Jso(("connected", true)), await svc.Search(query, offset, ask)));
                case "artist-albums":
                    if (Q(ctx, "artist_id") is not { Length: > 0 } artist) return await JsError(ctx, 400, "artist_id required");
                    return await SendJs(ctx, Assigned(Jso(("connected", true)), await svc.ArtistAlbums(artist, offset, ask)));
                case "album":
                    if (Q(ctx, "id") is not { Length: > 0 } id) return await JsError(ctx, 400, "id required");
                    var d = await svc.AlbumDetail(id, ask);
                    var row = svc.AlbumRow(TJs.Str(SH.P(d["album"], "id")));
                    return await SendJs(ctx, Assigned(Jso(("connected", true), ("offset", row is long r ? (double)r : null)), d));
                default:
                    if (Q(ctx, "album_id") is not { Length: > 0 } albumId) return await JsError(ctx, 400, "album_id required");
                    return await SendJs(ctx, Jso(("connected", true), ("favourite", await svc.IsFavourite(albumId, ask))));
            }
        }
        catch (ToNode) when (!ctx.Response.HasStarted)
        {
            // Tidal's token to be refreshed: the Node server's to do, and so this request.
            return false;
        }
        catch (Exception e) when (e is ServiceError or Tags.JsError && !ctx.Response.HasStarted)
        {
            return await ServiceFailed(ctx, e);
        }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            Front.Log($"[{svc.Id}] {ctx.Request.Path}: {e.GetType().Name}: {e.Message}; passed to the Node server");
            return false;
        }
    }

    /* As api-service.js's wrap answers what throws: e.status (500 when none), its message; a 401 says signed out. */
    private static Task<bool> ServiceFailed(HttpContext ctx, Exception e)
    {
        var status = e is ServiceError se ? se.Status : 500;
        var o = Jso(("error", e.Message.Length > 0 ? e.Message : "Error"));
        if (status == 401) o["connected"] = false;
        return SendJs(ctx, o, status);
    }

    private static Task<bool> SignedOut(HttpContext ctx, Catalogue svc) =>
        SendJs(ctx, Jso(("error", "Not signed in to " + svc.Name), ("connected", false)), 401);

    // ------------------------------------------------------------ the library's rows (v0.8.44)

    [GeneratedRegex(@"^/api/(qobuz|tidal)/(open|favorite|unfavorite)$")]
    private static partial Regex ServiceWritePath();

    [GeneratedRegex(@"^SQLite Error \d+: '(.*)'\.$", RegexOptions.Singleline)]
    private static partial Regex SqliteSaid();
    /* An error in the words the Node server's would have: SQLite's own message, as better-sqlite3 gives it. */
    private static string NodeWords(Exception e) => e is SqliteException && SqliteSaid().Match(e.Message) is { Success: true } m ? m.Groups[1].Value : e.Message;

    /*
     * req.body as the Node server's express.json() makes it, the request kept
     * as it came (buffered, put back) to be passed on still: {} for a body of
     * another type; Ok false for one that parser would refuse (its own words,
     * so its to answer) or read otherwise (another charset, compressed).
     */
    private static async Task<(bool Ok, object? Body)> ServiceBody(HttpContext ctx)
    {
        if (!IsJsonBody(ctx)) return (true, new JsObj());
        if (!MediaTypeHeaderValue.TryParse(ctx.Request.ContentType, out var mt)
            || !string.Equals(mt.MediaType, "application/json", StringComparison.OrdinalIgnoreCase)
            || mt.CharSet is { } cs && !cs.Trim('"').Equals("utf-8", StringComparison.OrdinalIgnoreCase)
            || ctx.Request.Headers.ContentEncoding.Count > 0) return (false, null);
        ctx.Request.EnableBuffering();
        using var ms = new MemoryStream();
        await ctx.Request.Body.CopyToAsync(ms);
        ctx.Request.Body.Position = 0;
        var text = Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
        if (text.StartsWith('\uFEFF')) text = text[1..];
        if (text.Length == 0) return (true, new JsObj());
        // Strict, as the parser is: an object or an array, nothing else.
        var first = text.TrimStart(' ', '\t', '\n', '\r');
        if (first.Length == 0 || first[0] is not ('{' or '[')) return (false, null);
        try { return (true, JsJson.Parse(text)); }
        catch (Tags.JsError) { return (false, null); }
    }

    /* Opening an album, favouriting it, Clean up: true when answered here. */
    private static async Task<bool> ServiceWrite(HttpContext ctx)
    {
        if (!HttpMethods.IsPost(ctx.Request.Method)) return false;
        var path = ctx.Request.Path.Value ?? "";
        if (path == "/api/library/cleanup") return await ServiceCleanUp(ctx);
        var match = ServiceWritePath().Match(path);
        if (!match.Success || CatalogueOf(match.Groups[1].Value) is not { } svc || !BodyFits(ctx)) return false;
        var (ok, b) = await ServiceBody(ctx);
        if (!ok) return false;
        try
        {
            if (!svc.Connected()) return await SignedOut(ctx, svc);
            var given = Prop(b, "album_id");
            if (!TJs.Truthy(given)) return await JsError(ctx, 400, "album_id required");
            var albumId = TJs.Str(given);
            return match.Groups[2].Value == "open" ? await OpenAlbum(ctx, svc, albumId) : await Favourite(ctx, svc, albumId, match.Groups[2].Value == "favorite");
        }
        catch (ToNode) when (!ctx.Response.HasStarted)
        {
            // Tidal's token to be refreshed: the Node server's to do, and so this request, as it came.
            ctx.Request.Body.Position = 0;
            return false;
        }
        catch (Exception e) when (e is ServiceError or Tags.JsError && !ctx.Response.HasStarted)
        {
            return await ServiceFailed(ctx, e);
        }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            // Before anything was written (the album's rows are one transaction): the Node server's to make.
            Front.Log($"[{svc.Id}] {path}: {e.GetType().Name}: {e.Message}; passed to the Node server");
            ctx.Request.Body.Position = 0;
            return false;
        }
    }

    /*
     * The album as library rows (transient until favourited), so its page here
     * opens. One already known is answered as it is: no asking the service
     * again, no library reload, for every tap in the browser.
     */
    private static async Task<bool> OpenAlbum(HttpContext ctx, Catalogue svc, string albumId)
    {
        if (svc.AlbumRow(albumId) is long known && await Current() is var (s, _) && s.Find(known) is { } al)
            return await Send(ctx, new JsonObject { ["ok"] = true, ["offset"] = known, ["album"] = AlbumJson(s, al) });
        var t0 = NowMs();
        var offset = await svc.EnsureAlbum(albumId);
        var t1 = NowMs();
        await svc.Changed("opened");
        var t2 = NowMs();
        // Where the time went, for a slow open to be read off the log.
        Front.Log($"[{svc.Id}] open {albumId}: asked and written in {t1 - t0} ms, library read in {t2 - t1} ms");
        // The album as the page's tiles carry it, so the page opens without another ask.
        JsonObject? album = null;
        try { if (await Current() is var (s2, _) && s2.Find(offset) is { } a2) album = AlbumJson(s2, a2); }
        catch (Exception e) when (e is SqliteException or IOException) { Front.Log($"[{svc.Id}] open {albumId}: {e.Message}"); }
        return await Send(ctx, new JsonObject { ["ok"] = true, ["offset"] = offset, ["album"] = album });
    }

    /*
     * The favourite on the service, then the album kept in the library (its
     * rows written first) or let go. Once the service has made it, a failure is
     * answered here as the Node server's wrap() answers it, rather than passed
     * on to be made twice; but a token Tidal refuses (revoked meanwhile) still
     * goes to the Node server, whose favourite again changes nothing there.
     */
    private static async Task<bool> Favourite(HttpContext ctx, Catalogue svc, string albumId, bool on)
    {
        await svc.SetFavouriteThere(albumId, on);
        try { await svc.SetFavouriteHere(albumId, on); }
        catch (Exception e) when (e is not (global::Mandarin.Server.Services.ToNode or ServiceError or Tags.JsError) && !ctx.Response.HasStarted)
        {
            Front.Log($"[{svc.Id}] {ctx.Request.Path}: {e.GetType().Name}: {e.Message}");
            return await JsError(ctx, 500, NodeWords(e));
        }
        return await SendJs(ctx, Jso(("ok", true), ("album_id", albumId), ("favourite", on)));
    }

    /*
     * Clean up of a service's albums, where the scans are this server's
     * (Scans.cs): its own scan is the one Clean up waits for, and none starts
     * while it is made. The music folders' kind ("files") and the counts (GET)
     * stay the Node server's, as does a kind it would refuse.
     */
    private static async Task<bool> ServiceCleanUp(HttpContext ctx)
    {
        if (!Scans.On || !BodyFits(ctx)) return false;
        var (ok, b) = await ServiceBody(ctx);
        if (!ok || Prop(b, "kind") is not string kind || CatalogueOf(kind) is not { } svc) return false;
        try
        {
            if (Scans.Running) return await Send(ctx, new JsonObject { ["error"] = ScanUnderWay }, 409);
            if (!svc.CleanUpFits()) return false;
            var removed = 0;
            if (!Scans.WhileNoScan(() => removed = svc.CleanUp())) return await Send(ctx, new JsonObject { ["error"] = ScanUnderWay }, 409);
            if (removed > 0) await svc.Changed();
            return await Send(ctx, new JsonObject { ["ok"] = true, ["kind"] = kind, ["removed"] = removed, ["count"] = await CountNow() });
        }
        catch (Exception e) when (e is SqliteException or Tags.JsError or InvalidOperationException && !ctx.Response.HasStarted)
        {
            // Nothing written (the transaction undone): the Node server's to make.
            Front.Log($"[{svc.Id}] Clean up: {e.GetType().Name}: {e.Message}; passed to the Node server");
            ctx.Request.Body.Position = 0;
            return false;
        }
    }

    /*
     * A streamed album's page, signed in (api-library.js GET /api/album): its
     * favourite on the service, the library brought into line with it first
     * (reconcile), and why it is here — its release day too when that is
     * still to come. Each failure leaves its part out, as there; a token Tidal
     * wants refreshed passes the whole page on (ToNode).
     */
    private static async Task<JsObj> ServiceFields(Catalogue svc, Album al, LibState st)
    {
        var o = new JsObj();
        if (!svc.Connected()) return o;
        var id = AlbumIdOf(al.Key, svc.Id);
        try
        {
            // qobuz[s + "_favourite"] = qobuz.service_favourite = …: the second set first.
            var fav = await svc.Reconcile(id, new Ask(st.Version));
            o["service_favourite"] = fav;
            o[svc.Id + "_favourite"] = fav;
        }
        catch (Exception e) when (e is not global::Mandarin.Server.Services.ToNode) { /* unknown: no item */ }
        try
        {
            var why = svc.Why(id);
            o["service_why"] = why;
            var today = DateTime.UtcNow.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
            if (!string.IsNullOrEmpty(al.Date) && string.CompareOrdinal(al.Date, today) > 0) why["releases"] = al.Date;
        }
        catch (Exception e) when (e is not global::Mandarin.Server.Services.ToNode) { /* no note */ }
        return o;
    }
}
