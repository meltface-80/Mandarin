using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The suite's HTTP client (test/setup.js's rules): nothing off this machine (ALLOW_NETWORK=1 lifts
/// it), and no request waits for ever, failing after a minute and a half with its address rather than
/// holding a test to its five-minute allowance. A connection is never kept long: tests start one
/// server after another on a port, and a kept connection would reach the one that has gone.
/// </summary>
public static class Http
{
    /// <summary>The longest a test's request is given (the phone's long poll, the longest legitimate one, is 25 s).</summary>
    public static readonly TimeSpan Patience = TimeSpan.FromSeconds(90);

    /// <summary>The client every test uses.</summary>
    public static readonly HttpClient Client = new(new LoopbackOnly(new SocketsHttpHandler
    {
        PooledConnectionIdleTimeout = TimeSpan.FromMilliseconds(500),
        AllowAutoRedirect = false,
        AutomaticDecompression = DecompressionMethods.None
    }))
    { Timeout = Patience };

    /// <summary>
    /// As a browser's fetch asks: compressed answers accepted (Accept-Encoding) and opened, so what a page
    /// sends a browser (its Vary, its compression) is what the test sees.
    /// </summary>
    public static readonly HttpClient Browserlike = new(new LoopbackOnly(new SocketsHttpHandler
    {
        PooledConnectionIdleTimeout = TimeSpan.FromMilliseconds(500),
        AllowAutoRedirect = false,
        AutomaticDecompression = DecompressionMethods.All
    }))
    { Timeout = Patience };

    /// <summary>A response read: its status, headers, body as text, and the body as JSON when it is.</summary>
    public sealed record Answer(int Status, HttpResponseHeaders Headers, HttpContentHeaders ContentHeaders, string Text)
    {
        /// <summary>The body as JSON, or null when it isn't JSON.</summary>
        public JsonNode? Json { get { try { return JsonNode.Parse(Text); } catch (System.Text.Json.JsonException) { return null; } } }

        /// <summary>The body as JSON; fails the test when it isn't.</summary>
        public JsonNode J => Json ?? throw new Xunit.Sdk.XunitException($"not JSON (status {Status}): {Text}");

        /// <summary>A header's value, whichever side it is on, or null.</summary>
        public string? Header(string name) =>
            Headers.TryGetValues(name, out var v) || ContentHeaders.TryGetValues(name, out v) ? string.Join(", ", v) : null;
    }

    /// <summary>GET <paramref name="url"/>, with headers.</summary>
    public static Task<Answer> Get(string url, IDictionary<string, string>? headers = null) => Send(HttpMethod.Get, url, null, headers);

    /// <summary>POST <paramref name="body"/> as JSON (null: none) to <paramref name="url"/>.</summary>
    public static Task<Answer> Post(string url, object? body, IDictionary<string, string>? headers = null) =>
        Send(HttpMethod.Post, url, body == null ? null : new StringContent(Json(body), Encoding.UTF8, "application/json"), headers);

    /// <summary>A request of any kind, its answer read.</summary>
    public static async Task<Answer> Send(HttpMethod method, string url, HttpContent? content, IDictionary<string, string>? headers = null, HttpClient? client = null)
    {
        using var req = new HttpRequestMessage(method, url) { Content = content };
        foreach (var (k, v) in headers ?? new Dictionary<string, string>())
            if (!req.Headers.TryAddWithoutValidation(k, v)) req.Content?.Headers.TryAddWithoutValidation(k, v);
        try
        {
            using var r = await (client ?? Client).SendAsync(req);
            var text = await r.Content.ReadAsStringAsync();
            return new Answer((int)r.StatusCode, r.Headers, r.Content.Headers, text);
        }
        catch (TaskCanceledException e) when (!e.CancellationToken.IsCancellationRequested)
        {
            throw new TimeoutException($"{method} {url} gave no answer in {Patience.TotalSeconds} s", e);
        }
    }

    /// <summary>An object as JSON, as the page sends it (a JsonNode, an anonymous object, a dictionary).</summary>
    public static string Json(object body) => body is JsonNode n ? n.ToJsonString() : System.Text.Json.JsonSerializer.Serialize(body);

    private sealed class LoopbackOnly(HttpMessageHandler inner) : DelegatingHandler(inner)
    {
        private static readonly bool Allowed = Environment.GetEnvironmentVariable("ALLOW_NETWORK") is { Length: > 0 };

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var host = request.RequestUri?.Host ?? "";
            bool local = host == "localhost" || (IPAddress.TryParse(host.Trim('[', ']'), out var ip) && IPAddress.IsLoopback(ip));
            if (!local && !Allowed) throw new HttpRequestException($"{host} is off limits to the tests (test/Mandarin.Tests/Harness/Http.cs)");
            return base.SendAsync(request, ct);
        }
    }
}
