// SoapHttp.cs — a UPnP action sent to a player, and a document fetched from
// one (the sending half of lib/sonos/soap.js, v0.8.49, stage 6): a keep-alive
// pool of four connections a player, the SOAPACTION header, the timeout each
// call's own (ten seconds for a Sonos, eight for a renderer), one retry on a
// connection the player closed after answering an earlier call (a Sonos does
// after a while; Audirvana's renderer does), and every failure — a fault, a
// timeout, a refused connection — one UPnPError, its words soap.js's.
using System.Net;
using System.Net.Sockets;
using System.Net.Http.Headers;
using System.Text;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

internal static class SoapHttp
{
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        UseProxy = false, MaxConnectionsPerServer = 4, PooledConnectionIdleTimeout = TimeSpan.FromSeconds(60), AllowAutoRedirect = false
    }) { Timeout = Timeout.InfiniteTimeSpan };

    private static string HostOf(string url) => WebUrl.Parse(url, null) is { } u ? (u.Host ?? "") + (u.Port is { } p ? ":" + p.ToString(System.Globalization.CultureInfo.InvariantCulture) : "") : url;

    /* soap.js call(): the answer's arguments by name, or the UPnPError (the player's fault, or that it couldn't be reached). */
    public static async Task<JsObj> Call(string url, string service, string action, JsObj? args, int timeoutMs = 10000, int attempt = 0)
    {
        var payload = Soap.BuildRequest(service, action, args ?? new JsObj());
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = new StringContent(payload, Encoding.UTF8) };
            req.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("text/xml") { CharSet = "\"utf-8\"" };
            req.Headers.TryAddWithoutValidation("SOAPACTION", $"\"{service}#{action}\"");
            using var cts = new CancellationTokenSource(timeoutMs);
            using var res = await Http.SendAsync(req, HttpCompletionOption.ResponseContentRead, cts.Token);
            var text = await res.Content.ReadAsStringAsync(cts.Token);
            if ((int)res.StatusCode >= 400 && !text.Contains("Fault")) throw UPnPError.Of(501, $"HTTP {(int)res.StatusCode} from {url}");
            return Soap.ParseResponse(text, action);
        }
        catch (OperationCanceledException) { throw UPnPError.NoAnswer($"Sonos player at {HostOf(url)} is not responding: timed out"); }
        catch (UriFormatException) { throw UPnPError.Of(501, "bad url " + url); }
        catch (HttpRequestException e)
        {
            if (attempt == 0 && e.InnerException is IOException or SocketException { SocketErrorCode: SocketError.ConnectionReset })
                return await Call(url, service, action, args, timeoutMs, 1);
            throw UPnPError.NoAnswer($"Sonos player at {HostOf(url)} is not responding: {e.Message}");
        }
    }

    /* soap.js httpGet(): the text; a UPnPError when it isn't 200. */
    public static async Task<string> HttpGet(string url, int timeoutMs = 8000)
    {
        try
        {
            using var cts = new CancellationTokenSource(timeoutMs);
            using var res = await Http.GetAsync(url, cts.Token);
            if (res.StatusCode != HttpStatusCode.OK) throw UPnPError.Of(501, $"HTTP {(int)res.StatusCode} fetching {url}");
            return await res.Content.ReadAsStringAsync(cts.Token);
        }
        catch (OperationCanceledException) { throw UPnPError.Of(501, "timed out"); }
        catch (HttpRequestException e) { throw UPnPError.Of(501, e.Message); }
        catch (UriFormatException e) { throw UPnPError.Of(501, e.Message); }
    }

    /* A request with a method of its own (SUBSCRIBE, UNSUBSCRIBE: gena.js request()): the status, the headers and the text. */
    public static async Task<(int Status, HttpResponseHeaders Headers, string Text)> Request(string url, string method, IEnumerable<(string, string)> headers, int timeoutMs = 6000)
    {
        using var req = new HttpRequestMessage(new HttpMethod(method), url);
        foreach (var (k, v) in headers) req.Headers.TryAddWithoutValidation(k, v);
        using var cts = new CancellationTokenSource(timeoutMs);
        using var res = await Http.SendAsync(req, HttpCompletionOption.ResponseContentRead, cts.Token);
        return ((int)res.StatusCode, res.Headers, await res.Content.ReadAsStringAsync(cts.Token));
    }
}
