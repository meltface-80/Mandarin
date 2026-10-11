// ServiceHttp.cs — what Qobuz's and Tidal's clients share here (v0.8.39, stage
// 4.1 of docs/specs/csharp-migration.md): a request as lib/qobuz/api.js and
// lib/tidal/api.js make it with fetch, with the words the Node server's routes
// answer a failure with; their answers kept in memory as theirs are (a Map,
// 2,000 at most, the oldest let go first); and the few JavaScript rules the
// catalogue's code leans on (reading a property, ||, Number(), new Date()).
using System.Globalization;
using System.Net;
using System.Text;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Services;

using Js = Mandarin.Server.Tags.Js;

/* A failure the route answers with this status (the Node server's e.status). */
internal sealed class ServiceError(string message, int status) : Exception(message)
{
    public int Status { get; } = status;
}

/*
 * The Node server must answer this request itself: Tidal's access token wants
 * refreshing, and only the Node server refreshes it (until stage 4.4 moves the
 * sign-in), so that two servers never hold different tokens.
 */
internal sealed class ToNode(string why) : Exception(why);

internal static class ServiceHttp
{
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30),
        AutomaticDecompression = DecompressionMethods.All,
        // As Node's fetch: straight to the service, whatever HTTP_PROXY says.
        UseProxy = false,
    }) { Timeout = Timeout.InfiniteTimeSpan };

    /*
     * fetch(url, { headers, signal: AbortSignal.timeout(ms) }) and r.text():
     * the status and the body. fetch's own failures in its words: "fetch failed"
     * (no answer), and the timeout's, which covers the body too.
     */
    public static async Task<(int Status, string Text)> Get(string url, IEnumerable<(string Name, string Value)> headers, int timeoutMs)
    {
        using var cts = new CancellationTokenSource(timeoutMs);
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            foreach (var (n, v) in headers) req.Headers.TryAddWithoutValidation(n, v);
            using var res = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
            var text = await res.Content.ReadAsStringAsync(cts.Token);
            return ((int)res.StatusCode, text);
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested)
        {
            throw new JsError("The operation was aborted due to timeout");
        }
        catch (Exception e) when (e is HttpRequestException or UriFormatException or InvalidOperationException or IOException)
        {
            throw new JsError("fetch failed");
        }
    }

    /* JSON.parse(text), or null when it isn't JSON. */
    public static object? ParseOrNull(string text)
    {
        try { return JsJson.Parse(text); } catch (Exception) { return null; }
    }

    /* encodeURIComponent */
    public static string Component(string s) => Escape(s, "-_.!~*'()", false);

    /* URLSearchParams's toString(): a space as "+", only *-._ and letters and digits as they are. */
    public static string Form(string s) => Escape(s, "*-._", true);

    private static string Escape(string s, string keep, bool plus)
    {
        var sb = new StringBuilder();
        foreach (var b in Encoding.UTF8.GetBytes(s))
        {
            var c = (char)b;
            if (b < 0x80 && (char.IsAsciiLetterOrDigit(c) || keep.Contains(c))) sb.Append(c);
            else if (plus && c == ' ') sb.Append('+');
            else sb.Append('%').Append(b.ToString("X2", CultureInfo.InvariantCulture));
        }
        return sb.ToString();
    }

    // ------------------------------------------------------------ JavaScript's rules

    /* o.k, as JavaScript reads it: a TypeError on null and undefined. */
    public static object? P(object? o, string k) => o switch
    {
        JsObj j => j[k],
        null => throw new JsError($"Cannot read properties of null (reading '{k}')"),
        Undef => throw new JsError($"Cannot read properties of undefined (reading '{k}')"),
        List<object?> l => k == "length" ? (double)l.Count : Undef.V,
        string s => k == "length" ? (double)s.Length : Undef.V,
        _ => Undef.V
    };

    /* a && a.k: a itself when it isn't truthy. */
    public static object? AndP(object? a, string k) => Js.Truthy(a) ? P(a, k) : a;

    /* a || b */
    public static object? Or(object? a, object? b) => Js.Truthy(a) ? a : b;

    /* Number(v) || d */
    public static double NumOr(object? v, double d)
    {
        var n = Js.ToNumber(v);
        return n == 0 || double.IsNaN(n) ? d : n;
    }

    /* x + y where x is a string: String(y) after it. */
    public static string Cat(params object?[] parts)
    {
        var sb = new StringBuilder();
        foreach (var p in parts) sb.Append(Js.Str(p));
        return sb.ToString();
    }

    /* Array.isArray(v) ? v : [] — what a list's items are taken as. */
    public static List<object?> Items(object? v) => v as List<object?> ?? [];

    private static readonly DateTime Epoch = new(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    /*
     * new Date(s).getTime(): the ISO forms as ECMAScript reads them (a date
     * alone is UTC; a time without an offset, local), else the system's
     * reading, as V8 falls back to; NaN when there's none.
     */
    public static double DateMs(object? v)
    {
        if (v is double d) return d;
        var s = Js.Str(v).Trim();
        if (System.Text.RegularExpressions.Regex.IsMatch(s, @"^[+-]?\d{4,6}(-\d{2}(-\d{2})?)?$"))
        {
            var parts = s.Split('-', StringSplitOptions.RemoveEmptyEntries);
            if (!int.TryParse(parts[0], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var y)) return double.NaN;
            var m = parts.Length > 1 ? int.Parse(parts[1], CultureInfo.InvariantCulture) : 1;
            var day = parts.Length > 2 ? int.Parse(parts[2], CultureInfo.InvariantCulture) : 1;
            if (y < 1 || y > 9999 || m < 1 || m > 12 || day < 1 || day > DateTime.DaysInMonth(y, m)) return double.NaN;
            return (new DateTime(y, m, day, 0, 0, 0, DateTimeKind.Utc) - Epoch).TotalMilliseconds;
        }
        var offset = System.Text.RegularExpressions.Regex.IsMatch(s, @"(Z|[+-]\d{2}:?\d{2})$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, offset ? DateTimeStyles.None : DateTimeStyles.AssumeLocal, out var t))
            return t.ToUnixTimeMilliseconds();
        return double.NaN;
    }

    public static double NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}

/*
 * The answers kept in memory, as the clients' Maps keep them: by address,
 * each for its own time, 2,000 at most (the first kept let go first; one kept
 * again keeps its place). [version]: the answer holds only while the Node
 * server's library is as it was then (the favourites: changed there, its
 * library is read again).
 */
internal sealed class AnswerCache
{
    private sealed record Entry(double At, double Ttl, object? Value, long? Version);
    private readonly object gate = new();
    private readonly OrderedDictionary<string, Entry> map = new(StringComparer.Ordinal);

    public bool TryGet(string key, long? version, out object? value)
    {
        lock (gate)
        {
            if (map.TryGetValue(key, out var e) && ServiceHttp.NowMs() - e.At < e.Ttl && (e.Version == null || version == null || e.Version == version))
            {
                value = e.Value;
                return true;
            }
        }
        value = null;
        return false;
    }

    public void Set(string key, double ttl, object? value, long? version = null)
    {
        lock (gate)
        {
            map[key] = new Entry(ServiceHttp.NowMs(), ttl, value, version);
            if (map.Count > 2000) map.RemoveAt(0);
        }
    }

    public void Clear() { lock (gate) map.Clear(); }
}
