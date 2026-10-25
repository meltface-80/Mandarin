// Auth.Body.cs — a request's JSON body, as the Node server read it
// (express.json, Http.cs: one turned down is answered in that parser's words,
// one past its 2 MB a 413 with the rest left unread — a playlist's share blob
// gone wrong, v0.8.50, stage 7 part 4: with no Node server behind to refuse
// it, refused here). Anything without a JSON content type reads as an empty
// object.
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Auth
{
    /*
     * Alone: express.json's limit for every request, as body-parser applied it
     * ahead of the routes (before, a body past it was passed on to the Node
     * server, which refused it): 413, the body left unread.
     */
    public static void UseBodyLimit(WebApplication app) => app.Use(async (ctx, next) =>
    {
        if (!Http.Fits(ctx)) { await Error(ctx, 413, "request entity too large"); return; }
        await next();
    });

    public static async Task<JsonObject?> Body(HttpContext ctx)
    {
        var read = await Http.ReadJson(ctx);
        if (read.Refused) { await Error(ctx, read.Status, read.Words); return null; }
        try
        {
            if (read.Text!.Length == 0) return [];
            // Its values outlive the document read (Clone): a value made here keeps the element it came from.
            using var doc = JsonDocument.Parse(read.Text);
            return Node(doc.RootElement.Clone()) as JsonObject ?? [];
        }
        catch (JsonException)
        {
            await Error(ctx, 400, "Bad JSON");
            return null;
        }
    }

    /*
     * The value whole, every object in it made here, a name given twice its
     * last value, as JSON.parse keeps it (item 173). JsonNode.Parse made an
     * object only when first read, so a name given twice threw then, on the
     * route's way and outside any catch: a 500, with nothing said. Kept last
     * rather than refused, as the Node server read it and as every other
     * route here reads a body (Http.ReadJs, Scan/JsJson.cs).
     */
    private static JsonNode? Node(JsonElement e)
    {
        switch (e.ValueKind)
        {
            case JsonValueKind.Object:
                var o = new JsonObject();
                foreach (var p in e.EnumerateObject()) o[p.Name] = Node(p.Value);
                return o;
            case JsonValueKind.Array:
                var a = new JsonArray();
                foreach (var v in e.EnumerateArray()) a.Add(Node(v));
                return a;
            default:
                return JsonValue.Create(e);
        }
    }
}
