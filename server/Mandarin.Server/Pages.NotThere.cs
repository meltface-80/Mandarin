// Pages.NotThere.cs — alone (v0.8.50, stage 7), what no route took, as
// Express answered it (Program.cs maps it under every route): first a JSON
// body index.js's express.json() turned down before any route saw it, refused
// in the words every route refuses a body with (Http.cs) — one it can't
// read a 400, one in a charset it can't read a 415, one past its 2 MB sent
// without a length a 413 (with one, Auth.UseBodyLimit has refused it) — then
// not there: an /api/ address as JSON, with its path under /api, anything else
// finalhandler's page.
using Microsoft.Net.Http.Headers;

namespace Mandarin.Server;

internal static partial class Pages
{
    public static async Task NotThere(HttpContext ctx)
    {
        ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
        var p = ctx.Request.Path.Value ?? "/";
        if (await Unreadable(ctx) is { } refused) { await Http.Error(ctx, refused.Status, refused.Words); return; }
        if (p == "/api" || p.StartsWith("/api/", StringComparison.Ordinal)) { await Http.Error(ctx, 404, $"No such endpoint: {ctx.Request.Method} {(p.Length > 4 ? p[4..] : "/")}"); return; }
        ctx.Response.StatusCode = 404;
        ctx.Response.ContentType = "text/html; charset=utf-8";
        var said = System.Net.WebUtility.HtmlEncode($"Cannot {ctx.Request.Method} {p}");
        await ctx.Response.WriteAsync($"<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Error</title>\n</head>\n<body>\n<pre>{said}</pre>\n</body>\n</html>\n");
    }

    /*
     * body-parser's json(), as every route reads a body (Http.ReadJson): one
     * typed application/json, read; turned down, its refusal. Empty is {}, and
     * any other type isn't its to read.
     */
    private static async Task<JsonBody?> Unreadable(HttpContext ctx)
    {
        var req = ctx.Request;
        if (!MediaTypeHeaderValue.TryParse(req.ContentType, out var type) || !type.MediaType.Equals("application/json", StringComparison.OrdinalIgnoreCase)) return null;
        if (req.ContentLength is null && !req.Headers.ContainsKey("Transfer-Encoding")) return null;
        var (_, read) = await Http.ReadJs(ctx);
        return read.Refused ? read : null;
    }
}
