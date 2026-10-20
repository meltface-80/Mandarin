// Http.cs — a request's JSON body in, an answer out (v0.9.2, the audit's Q1,
// old/audit-b4-main.md). Each route file ported from the Node server
// had brought its own copy of both, and the copies had drifted: a body sent
// without a length was read by one and refused by another (v0.9.0). The
// rules are the ones the Node server's express.json() and res.send kept for
// every route, so every route keeps them alike.
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Net.Http.Headers;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

/* What a JSON body came to: its text ("" for none, or a body of another type), or why it was turned down (Text null). */
internal readonly record struct JsonBody(string? Text, int Status = 0, string Words = "")
{
    public bool Refused => Text == null;
}

internal static class Http
{
    /* A GET route, as Express's app.get takes it: a HEAD too. */
    public static readonly string[] GetOrHead = ["GET", "HEAD"];

    /* body-parser's "2mb". */
    public const long BodyLimit = 2 * 1024 * 1024;

    /* As res.json writes it: an apostrophe or an accent as it is, not '. */
    public static readonly JsonSerializerOptions Relaxed = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /* A body this server reads as JSON: one that says it is. */
    public static bool IsJson(HttpContext ctx) => (ctx.Request.ContentType ?? "").Contains("json", StringComparison.OrdinalIgnoreCase);

    /* Not past the limit by the length it gives (one sent without a length is judged as it is read). */
    public static bool Fits(HttpContext ctx) => !IsJson(ctx) || ctx.Request.ContentLength is not long n || n <= BodyLimit;

    /*
     * The body as express.json() read it: UTF-8, its byte-order mark dropped.
     * Turned down, as that parser did: past 2 MB a 413 (the rest left unread),
     * a charset other than a UTF one a 415, and not an object or an array
     * (strict) a 400. With `keep`, the body is kept, for a route after this
     * one to read again from its start.
     */
    public static async Task<JsonBody> ReadJson(HttpContext ctx, bool keep = false)
    {
        var req = ctx.Request;
        if (!IsJson(ctx)) return new("");
        if (req.ContentLength > BodyLimit) return new(null, 413, "request entity too large");
        var charset = MediaTypeHeaderValue.TryParse(req.ContentType, out var type) && type.Charset.HasValue ? type.Charset.Value!.Trim('"').ToLowerInvariant() : "utf-8";
        if (!charset.StartsWith("utf-", StringComparison.Ordinal) && charset != "utf8") return new(null, 415, $"unsupported charset \"{charset.ToUpperInvariant()}\"");
        Encoding text;
        try { text = charset is "utf-8" or "utf8" ? Encoding.UTF8 : Encoding.GetEncoding(charset); }
        catch (Exception e) when (e is ArgumentException or NotSupportedException) { return new(null, 415, $"unsupported charset \"{charset.ToUpperInvariant()}\""); }
        if (keep) req.EnableBuffering();
        // One put back by a route before this one is read from its start.
        if (req.Body.CanSeek) req.Body.Position = 0;
        using var ms = new MemoryStream();
        var buf = new byte[64 * 1024];
        int n;
        while ((n = await req.Body.ReadAsync(buf, ctx.RequestAborted)) > 0)
        {
            if (ms.Length + n > BodyLimit) return new(null, 413, "request entity too large");
            ms.Write(buf, 0, n);
        }
        var s = text.GetString(ms.GetBuffer(), 0, (int)ms.Length);
        if (s.StartsWith('\uFEFF')) s = s[1..];
        if (s.Length == 0) return new("");
        var first = s.TrimStart(' ', '\t', '\n', '\r');
        return first.Length == 0 || first[0] is not ('{' or '[') ? new(null, 400, "Bad JSON") : new(s);
    }

    /* ReadJson, parsed as JSON.parse parses it (Scan/JsJson.cs): the value ({} for none), or why not (a 400 for what isn't JSON). */
    public static async Task<(object? Value, JsonBody Read)> ReadJs(HttpContext ctx, bool keep = false)
    {
        var b = await ReadJson(ctx, keep);
        if (b.Refused) return (null, b);
        if (b.Text!.Length == 0) return (new JsObj(), b);
        try { return (JsJson.Parse(b.Text), b); }
        catch (JsError) { return (null, new(null, 400, "Bad JSON")); }
    }

    /* The etag package's weak tag, as Express gives every answer: the length, and the SHA-1's first 27 base64 characters (a cache's check, nothing secret). */
    public static string Tag(byte[] bytes) => "W/\"" + bytes.Length.ToString("x", System.Globalization.CultureInfo.InvariantCulture) + "-" + Convert.ToBase64String(Fingerprint.Sha1(bytes))[..27] + "\"";

    public const string JsonType = "application/json; charset=utf-8";

    /*
     * res.send, as Express sends it: answered here (X-Mandarin-Answered), its
     * weak tag (`tag`, when the bytes' is known already), "not modified" for a
     * copy still current, and no body to a HEAD.
     */
    public static async Task<bool> Send(HttpContext ctx, byte[] bytes, string type, int status = 200, string? tag = null)
    {
        tag ??= Tag(bytes);
        var h = ctx.Response.Headers;
        h["X-Mandarin-Answered"] = "C#";
        h.ETag = tag;
        if (status == 200 && ctx.Request.Headers.IfNoneMatch.ToString().Contains(tag, StringComparison.Ordinal)) { ctx.Response.StatusCode = 304; return true; }
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = type;
        ctx.Response.ContentLength = bytes.Length;
        if (!HttpMethods.IsHead(ctx.Request.Method)) await ctx.Response.Body.WriteAsync(bytes);
        return true;
    }

    /* res.json(text): JSON already written. */
    public static Task<bool> Json(HttpContext ctx, string json, int status = 200) => Send(ctx, Encoding.UTF8.GetBytes(json), JsonType, status);

    /* res.json(node). */
    public static Task<bool> Json(HttpContext ctx, JsonNode node, int status = 200) => Json(ctx, node.ToJsonString(Relaxed), status);

    /* res.status(status).json({ error }). */
    public static Task<bool> Error(HttpContext ctx, int status, string message) => Json(ctx, new JsonObject { ["error"] = message }, status);
}
