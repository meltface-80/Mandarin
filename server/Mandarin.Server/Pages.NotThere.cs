// Pages.NotThere.cs — alone (v0.8.50, stage 7), what no route took, as
// Express answered it (Program.cs maps it under every route): first a JSON
// body index.js's express.json() turned down before any route saw it, refused
// in the words this server refuses a body with (Auth.Body.cs) — one it can't
// read a 400, one in a charset it can't read a 415, one past its 2 MB sent
// without a length a 413 (with one, Auth.UseBodyLimit has refused it) — then
// not there: an /api/ address as JSON, with its path under /api, anything else
// finalhandler's page.
using System.Text;
using Microsoft.Net.Http.Headers;

namespace Mandarin.Server;

internal static partial class Pages
{
    private const long JsonLimit = 2 * 1024 * 1024;   // express.json({ limit: "2mb" })

    public static async Task NotThere(HttpContext ctx)
    {
        ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
        var p = ctx.Request.Path.Value ?? "/";
        if (await Unreadable(ctx) is { } refused) { await JsonError(ctx, refused.Status, refused.Words); return; }
        if (p == "/api" || p.StartsWith("/api/", StringComparison.Ordinal)) { await JsonError(ctx, 404, $"No such endpoint: {ctx.Request.Method} {(p.Length > 4 ? p[4..] : "/")}"); return; }
        ctx.Response.StatusCode = 404;
        ctx.Response.ContentType = "text/html; charset=utf-8";
        var said = System.Net.WebUtility.HtmlEncode($"Cannot {ctx.Request.Method} {p}");
        await ctx.Response.WriteAsync($"<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Error</title>\n</head>\n<body>\n<pre>{said}</pre>\n</body>\n</html>\n");
    }

    private static Task JsonError(HttpContext ctx, int status, string words)
    {
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        return ctx.Response.WriteAsync(new System.Text.Json.Nodes.JsonObject { ["error"] = words }.ToJsonString());
    }

    /*
     * body-parser's json(): a body typed application/json, in UTF-8, read; past
     * the limit, or not an object or an array (strict), or not JSON, turned down.
     * Empty is {}, and any other type isn't its to read.
     */
    private static async Task<(int Status, string Words)?> Unreadable(HttpContext ctx)
    {
        var req = ctx.Request;
        if (!MediaTypeHeaderValue.TryParse(req.ContentType, out var type) || !type.MediaType.Equals("application/json", StringComparison.OrdinalIgnoreCase)) return null;
        if (req.ContentLength is null && !req.Headers.ContainsKey("Transfer-Encoding")) return null;
        var charset = type.Charset.HasValue ? type.Charset.Value!.ToLowerInvariant() : "utf-8";
        if (!charset.StartsWith("utf-", StringComparison.Ordinal)) return (415, $"unsupported charset \"{charset.ToUpperInvariant()}\"");
        // UTF-16 and UTF-32 are read there too; not judged here.
        if (charset is not ("utf-8" or "utf8")) return null;
        if (req.Body.CanSeek) req.Body.Position = 0;
        using var ms = new MemoryStream();
        var buf = new byte[81920];
        int n;
        while ((n = await req.Body.ReadAsync(buf, ctx.RequestAborted)) > 0)
        {
            if (ms.Length + n > JsonLimit) return (413, "request entity too large");
            ms.Write(buf, 0, n);
        }
        var text = Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
        if (text.StartsWith('﻿')) text = text[1..];
        if (text.Length == 0) return null;
        var first = text.TrimStart(' ', '\t', '\n', '\r');
        if (first.Length == 0 || first[0] is not ('{' or '[')) return (400, "Bad JSON");
        try { Scan.JsJson.Parse(text); }
        catch (Tags.JsError) { return (400, "Bad JSON"); }
        return null;
    }
}
