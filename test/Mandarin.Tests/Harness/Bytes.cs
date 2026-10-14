using System.Net.Http.Headers;

namespace Mandarin.Tests;

/// <summary>An answer read as bytes (a track, a cover, a backup), by the same client as <see cref="Http"/>.</summary>
public static class Bytes
{
    /// <summary>The status, the headers and the body as sent.</summary>
    public sealed record Answer(int Status, HttpResponseHeaders Headers, HttpContentHeaders ContentHeaders, byte[] Body)
    {
        /// <summary>A header's value, whichever side it is on, or null.</summary>
        public string? Header(string name) =>
            Headers.TryGetValues(name, out var v) || ContentHeaders.TryGetValues(name, out v) ? string.Join(", ", v) : null;
    }

    /// <summary>GET <paramref name="url"/>, with headers, its body as bytes.</summary>
    public static async Task<Answer> Get(string url, IDictionary<string, string>? headers = null)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        foreach (var (k, v) in headers ?? new Dictionary<string, string>()) req.Headers.TryAddWithoutValidation(k, v);
        using var r = await Http.Client.SendAsync(req);
        return new Answer((int)r.StatusCode, r.Headers, r.Content.Headers, await r.Content.ReadAsByteArrayAsync());
    }
}
