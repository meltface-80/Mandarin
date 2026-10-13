// Auth.Body.cs — a request's JSON body, as the Node server read it
// (express.json: a body that isn't JSON is a 400; one past the parser's limit,
// 2 MB, is 413 with the rest left unread — a playlist's share blob gone wrong,
// v0.8.50, stage 7 part 4: with no Node server behind to refuse it, refused
// here). Anything without a JSON content type reads as an empty object.
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Auth
{
    // body-parser's "2mb".
    private const long BodyLimit = 2 * 1024 * 1024;

    /*
     * Alone: express.json's limit for every request, as body-parser applied it
     * ahead of the routes (before, a body past it was passed on to the Node
     * server, which refused it): 413, the body left unread.
     */
    public static void UseBodyLimit(WebApplication app) => app.Use(async (ctx, next) =>
    {
        if (ctx.Request.ContentLength > BodyLimit && (ctx.Request.ContentType ?? "").Contains("json", StringComparison.OrdinalIgnoreCase)) { await Error(ctx, 413, "request entity too large"); return; }
        await next();
    });

    public static async Task<JsonObject?> Body(HttpContext ctx)
    {
        var type = ctx.Request.ContentType ?? "";
        if (!type.Contains("json", StringComparison.OrdinalIgnoreCase)) return [];
        if (ctx.Request.ContentLength > BodyLimit) { await Error(ctx, 413, "request entity too large"); return null; }
        try
        {
            // Read to the limit and one byte more: past it, the body is too large whatever its length said.
            using var ms = new MemoryStream();
            var buf = new byte[64 * 1024];
            int n;
            while ((n = await ctx.Request.Body.ReadAsync(buf)) > 0)
            {
                if (ms.Length + n > BodyLimit) { await Error(ctx, 413, "request entity too large"); return null; }
                ms.Write(buf, 0, n);
            }
            ms.Position = 0;
            return ms.Length == 0 ? [] : await JsonNode.ParseAsync(ms) as JsonObject ?? [];
        }
        catch (JsonException)
        {
            await Error(ctx, 400, "Bad JSON");
            return null;
        }
    }
}
