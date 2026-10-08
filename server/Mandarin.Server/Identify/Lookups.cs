// Lookups.cs — asking the services outside (v0.8.19), as lib/meta.js asks
// them: JSON over HTTP with a time limit (httpJson), addresses written with
// JavaScript's encodeURIComponent, and MusicBrainz's one request a second
// (mbWait). That wait is the whole server's: the Node server's own requests to
// MusicBrainz (release days, record labels, an album's write-up) take their
// turn here too (GET /internal/mb/slot), so the two never add up to two a second.
using System.Text;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal sealed class LookupError(string message) : Exception(message)
{
    public int Status { get; init; }
    public bool Paused { get; init; }
}

internal static class Lookups
{
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30),
        AutomaticDecompression = System.Net.DecompressionMethods.All,
        AllowAutoRedirect = true
    }) { Timeout = Timeout.InfiniteTimeSpan };

    // MANDARIN_LOOPBACK_ONLY=1 (the tests, test/setup.js): nothing off this
    // machine is asked, as the Node server's fetch is kept to loopback there.
    private static readonly bool LoopbackOnly = Environment.GetEnvironmentVariable("MANDARIN_LOOPBACK_ONLY") == "1";

    /* Refused at once when the address is off limits. */
    public static void Allowed(string url)
    {
        if (!LoopbackOnly) return;
        var host = Uri.TryCreate(url, UriKind.Absolute, out var u) ? u.Host : "";
        if (host.Length > 0 && !(host == "localhost" || host.StartsWith("127.", StringComparison.Ordinal) || host is "::1" or "[::1]"))
            throw new LookupError($"fetch failed: {host} is off limits to the tests (test/setup.js)");
    }

    /* httpJson(url, headers, timeoutMs): the answer as JSON.parse reads it; "HTTP 503" for a refusal. */
    public static async Task<object?> Json(string url, IEnumerable<(string, string)> headers, int timeoutMs)
    {
        Allowed(url);
        using var cts = new CancellationTokenSource(timeoutMs);
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        foreach (var (k, v) in headers) req.Headers.TryAddWithoutValidation(k, v);
        HttpResponseMessage res;
        try { res = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token); }
        catch (OperationCanceledException) { throw new LookupError("This operation was aborted"); }
        catch (HttpRequestException e) { throw new LookupError("fetch failed" + (e.InnerException != null ? " (" + e.InnerException.Message + ")" : "")); }
        using (res)
        {
            if (!res.IsSuccessStatusCode) throw new LookupError("HTTP " + (int)res.StatusCode) { Status = (int)res.StatusCode };
            string text;
            try { text = await res.Content.ReadAsStringAsync(cts.Token); }
            catch (OperationCanceledException) { throw new LookupError("This operation was aborted"); }
            catch (Exception e) when (e is HttpRequestException or IOException) { throw new LookupError("terminated"); }
            try { return JsJson.Parse(text); }
            catch (Exception e) { throw new LookupError("Unexpected token in JSON (" + e.Message + ")"); }
        }
    }

    /* httpText(url, headers, timeoutMs): the page as text (UTF-8, as fetch's text() reads any page); "HTTP 404" for a refusal. */
    public static async Task<string> Text(string url, IEnumerable<(string, string)> headers, int timeoutMs)
    {
        Allowed(url);
        using var cts = new CancellationTokenSource(timeoutMs);
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        foreach (var (k, v) in headers) req.Headers.TryAddWithoutValidation(k, v);
        HttpResponseMessage res;
        try { res = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token); }
        catch (OperationCanceledException) { throw new LookupError("This operation was aborted"); }
        // As fetch says it (its cause unsaid): a route that fails says the same as the Node server's.
        catch (HttpRequestException) { throw new LookupError("fetch failed"); }
        using (res)
        {
            if (!res.IsSuccessStatusCode) throw new LookupError("HTTP " + (int)res.StatusCode) { Status = (int)res.StatusCode };
            byte[] bytes;
            try { bytes = await res.Content.ReadAsByteArrayAsync(cts.Token); }
            catch (OperationCanceledException) { throw new LookupError("This operation was aborted"); }
            catch (Exception e) when (e is HttpRequestException or IOException) { throw new LookupError("terminated"); }
            var text = Encoding.UTF8.GetString(bytes);
            return text.Length > 0 && text[0] == '\uFEFF' ? text[1..] : text;
        }
    }

    /* fetch(url), as the Node server's own: the status, the body (null past [max] bytes) and the type it says it is. */
    public static async Task<(int Status, byte[]? Body, string? Type)> Fetch(string url, IEnumerable<(string, string)> headers, int timeoutMs, int max)
    {
        Allowed(url);
        using var cts = new CancellationTokenSource(timeoutMs);
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        foreach (var (k, v) in headers) req.Headers.TryAddWithoutValidation(k, v);
        try
        {
            using var res = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
            var type = res.Content.Headers.ContentType?.ToString();
            await using var body = await res.Content.ReadAsStreamAsync(cts.Token);
            using var ms = new MemoryStream();
            var buf = new byte[81920];
            int n;
            while ((n = await body.ReadAsync(buf, cts.Token)) > 0)
            {
                ms.Write(buf, 0, n);
                if (ms.Length > max) return ((int)res.StatusCode, null, type);
            }
            return ((int)res.StatusCode, ms.ToArray(), type);
        }
        catch (OperationCanceledException) { throw new LookupError("This operation was aborted"); }
        catch (HttpRequestException e) { throw new LookupError("fetch failed" + (e.InnerException != null ? " (" + e.InnerException.Message + ")" : "")); }
        catch (IOException) { throw new LookupError("terminated"); }
    }

    /* A comparator's answer from a difference, as Array.prototype.sort reads it (NaN is 0). */
    public static int Sgn(double d) => d > 0 ? 1 : d < 0 ? -1 : 0;

    /* encodeURIComponent: everything but A–Z a–z 0–9 - _ . ! ~ * ' ( ) as UTF-8, %XX. */
    public static string Encode(string s)
    {
        var sb = new StringBuilder(s.Length + 16);
        var bytes = Encoding.UTF8.GetBytes(s);
        foreach (var b in bytes)
        {
            var c = (char)b;
            if (b < 0x80 && (char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' or '!' or '~' or '*' or '\'' or '(' or ')')) sb.Append(c);
            else sb.Append('%').Append(b.ToString("X2", System.Globalization.CultureInfo.InvariantCulture));
        }
        return sb.ToString();
    }

    /* `${k}=${encodeURIComponent(v)}` joined by "&", in the order given. */
    public static string Query(IEnumerable<(string Key, object? Value)> parts) =>
        string.Join("&", parts.Select(p => p.Key + "=" + Encode(Js.Str(p.Value))));

    // ---------------------------------------------------------------- MusicBrainz's second

    private static readonly SemaphoreSlim MbLock = new(1, 1);
    private static long mbLast;

    /* mbWait: at least 1.1 s since the last request to musicbrainz.org, whoever made it. */
    public static async Task MbWait(CancellationToken ct = default)
    {
        await MbLock.WaitAsync(ct);
        try
        {
            var elapsed = Environment.TickCount64 - mbLast;
            if (elapsed < 1100) await Task.Delay(TimeSpan.FromMilliseconds(1100 - elapsed), ct);
            mbLast = Environment.TickCount64;
        }
        finally { MbLock.Release(); }
    }

    /* GET /internal/mb/slot from the Node server (loopback, the front key): answered when its request may go. */
    public static void UseInternal(WebApplication app)
    {
        app.Use(async (ctx, next) =>
        {
            if (ctx.Request.Path.Value != "/internal/mb/slot") { await next(); return; }
            var from = ctx.Connection.RemoteIpAddress;
            var key = ctx.Request.Headers["X-Mandarin-Front-Key"].ToString();
            if (from == null || !System.Net.IPAddress.IsLoopback(from)
                || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(key), Encoding.UTF8.GetBytes(Library.FrontKey)))
            {
                ctx.Response.StatusCode = 404;
                return;
            }
            try { await MbWait(ctx.RequestAborted); } catch (OperationCanceledException) { return; }
            ctx.Response.ContentType = "application/json";
            await ctx.Response.WriteAsync("{\"ok\":true}");
        });
    }
}
