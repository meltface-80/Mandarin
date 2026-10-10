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
// Signed in, the sign-in, the settings, the import, favouriting, opening and
// playing stay the Node server's (stages 4.2 to 4.4, and 6). So does a request
// Tidal's token has to be refreshed for: only the Node server refreshes it.
// Answered here once the Node server has handed over its work; until then, by it.
using System.Text.RegularExpressions;
using Mandarin.Server.Services;
using Mandarin.Server.Tags;

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
            // As api-service.js's wrap answers: e.status (500 when none), its message; a 401 says signed out.
            var status = e is ServiceError se ? se.Status : 500;
            var o = Jso(("error", e.Message.Length > 0 ? e.Message : "Error"));
            if (status == 401) o["connected"] = false;
            return await SendJs(ctx, o, status);
        }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            Front.Log($"[{svc.Id}] {ctx.Request.Path}: {e.GetType().Name}: {e.Message}; passed to the Node server");
            return false;
        }
    }
}
