// BookletRoutes.cs — an album's booklets for the album page's book button
// (v0.8.33, Booklets.cs). New with the C# server: the Node server has none.
//
//   GET /api/album/booklets?offset=N         { booklets: [{ id, name, pages }] }
//   GET /api/booklet/page?offset=N&id=I&page=P&w=W   the page, a JPEG W wide
//
// A booklet is named by its album and its id, never by a path, and is looked
// for again in the album's folders each time, so nothing outside them can be
// asked for. Signed-in only, as every library route is (Auth.cs gate).
using System.Globalization;
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Library
{
    private static async Task<bool> AlbumBooklets(HttpContext ctx, Snapshot s, LibState st)
    {
        var al = s.Find(Num(Q(ctx, "offset")));
        var found = al != null ? await Booklets.Of(al, st.Roots) : [];
        return await Send(ctx, new JsonObject
        {
            ["booklets"] = new JsonArray(found.Select(b => (JsonNode)new JsonObject { ["id"] = b.Id, ["name"] = b.Name, ["pages"] = b.Pages }).ToArray())
        });
    }

    private static async Task<bool> BookletPage(HttpContext ctx, Snapshot s, LibState st)
    {
        var al = s.Find(Num(Q(ctx, "offset")));
        if (al == null) return await JsError(ctx, 404, "No such album");
        var id = Q(ctx, "id") ?? "";
        var b = (await Booklets.Of(al, st.Roots)).FirstOrDefault(x => x.Id == id);
        if (b == null) return await JsError(ctx, 404, "No such booklet");
        var page = Num(Q(ctx, "page"));
        if (double.IsNaN(page) || page != Math.Floor(page) || page < 1 || page > b.Pages) return await JsError(ctx, 404, "No such page");
        var w = Num(Q(ctx, "w"));
        var file = await Booklets.Page(b, (int)page, Booklets.Snap(double.IsNaN(w) || w < 1 ? 960 : w));
        if (file == null) return await JsError(ctx, 503, "That page couldn't be drawn");
        var h = ctx.Response.Headers;
        h["X-Mandarin-Answered"] = "C#";
        // The id changes with the file, so a page's address never shows an old page.
        h.CacheControl = "private, max-age=604800, immutable";
        ctx.Response.ContentType = "image/jpeg";
        ctx.Response.ContentLength = new FileInfo(file).Length;
        if (!HttpMethods.IsHead(ctx.Request.Method)) await ctx.Response.SendFileAsync(file);
        return true;
    }
}
