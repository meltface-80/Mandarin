// AcoustId.cs — AcoustID's lookup by fingerprint (bug list item 414c): which recordings a track is, how sure, and the
// releases each is on (https://api.acoustid.org/v2/lookup; ACOUSTID_URL points it elsewhere, a fake in the tests).
//
// Asked with your AcoustID key (Settings → API Keys, kept as the setting "acoustidKey", carried in a backup's keys and
// sealed with them), the track's length and its fingerprint, for its recordings, their release groups, releases and
// tracks; a form posted, the answer gzipped where it can be. At most three requests a second, AcoustID's limit,
// through a queue of its own. What came of the last request is kept for the Album Scanner's readout (State): the key
// missing, refused, AcoustID busy or not reached. Busy or not reached, it rests ten minutes and the albums meanwhile
// are matched without it.
using System.Net;
using System.Text;
using Mandarin.Server.Extras;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal sealed class AcoustIdError(string message, string kind) : Exception(message)
{
    /* "invalid" (the key refused), "limited" (too many requests), "unreachable" (offline, or AcoustID erring). */
    public string Kind { get; } = kind;
}

internal sealed class AcoustId(string? baseUrl, string version)
{
    public const string DefaultBase = "https://api.acoustid.org/v2";
    public const string Setting = "acoustidKey";
    private const int Spacing = 334;                    // a third of a second: three requests a second at most
    private const long RestMs = 10 * 60 * 1000;
    // A recording AcoustID has, to check a key by (its own documentation's example).
    private const string KnownTrack = "9ff43b6a-4f16-427c-93c2-92307ca505e0";

    public readonly string BaseUrl = (string.IsNullOrEmpty(baseUrl) ? DefaultBase : baseUrl).TrimEnd('/');
    private readonly string ua = $"Mandarin/{version} ( https://github.com/meltface-80/Mandarin )";
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30),
        AutomaticDecompression = DecompressionMethods.All
    }) { Timeout = Timeout.InfiniteTimeSpan };

    private readonly SemaphoreSlim queue = new(1, 1);
    private long last = long.MinValue / 2;
    public int Requests;
    /* The last request's outcome: null none yet, "ok", or an AcoustIdError's kind. */
    public volatile string? State;
    public long PausedUntil;

    public bool Paused => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() < Interlocked.Read(ref PausedUntil);

    /* The key saved on this server (one pasted before item 491, or a test's), else Mandarin's own (BuiltInKeys), or "". */
    public static string Key() => Labels.Setting(Setting) is string s && s.Trim().Length > 0 ? s.Trim() : BuiltInKeys.AcoustId;

    /* Asked in turn, a third of a second at least after the one before. */
    private async Task<JsObj> Ask(HttpMethod method, string url, string? form)
    {
        Lookups.Allowed(url);
        await queue.WaitAsync();
        try
        {
            var wait = Interlocked.Read(ref last) + Spacing - Environment.TickCount64;
            if (wait > 0) await Task.Delay(TimeSpan.FromMilliseconds(wait));
            Interlocked.Exchange(ref last, Environment.TickCount64);
            Interlocked.Increment(ref Requests);
        }
        finally { queue.Release(); }
        using var cts = new CancellationTokenSource(20000);
        using var req = new HttpRequestMessage(method, url);
        req.Headers.TryAddWithoutValidation("User-Agent", ua);
        req.Headers.TryAddWithoutValidation("Accept", "application/json");
        if (form != null) req.Content = new StringContent(form, Encoding.UTF8, "application/x-www-form-urlencoded");
        string text;
        HttpStatusCode status;
        try
        {
            using var res = await Http.SendAsync(req, cts.Token);
            status = res.StatusCode;
            text = await res.Content.ReadAsStringAsync(cts.Token);
        }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException or IOException)
        {
            throw new AcoustIdError("AcoustID can't be reached (" + e.Message + ")", "unreachable");
        }
        JsObj? j;
        try { j = JsJson.Parse(text) as JsObj; } catch (Exception) { j = null; }
        var error = j?["error"] as JsObj;
        var code = error != null && error["code"] is double d ? d : 0;
        var message = error != null ? Js.Str(error["message"]) : "HTTP " + (int)status;
        // AcoustID's error codes: 4 an invalid API key, 17 an unknown application; 14 too many requests.
        if (code is 4 or 17 || status == HttpStatusCode.Unauthorized) throw new AcoustIdError("AcoustID refused the key (" + message + ")", "invalid");
        if (code == 14 || status == HttpStatusCode.TooManyRequests) throw new AcoustIdError("AcoustID asks to wait (" + message + ")", "limited");
        if (j == null || (int)status >= 500 || code is 5 or 13) throw new AcoustIdError("AcoustID isn't answering (" + message + ")", "unreachable");
        if (!Js.StrictEq(j["status"], "ok")) throw new AcoustIdError("AcoustID: " + message, "error");
        return j;
    }

    private void Said(string state)
    {
        State = state;
        if (state is "limited" or "unreachable") Interlocked.Exchange(ref PausedUntil, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + RestMs);
    }

    /*
     * The recordings AcoustID matches to a fingerprint ([seconds] long), best first: each { score, recordings } as it
     * answers, recordings with their release groups and releases and those releases' tracks.
     */
    public async Task<List<JsObj>> Lookup(string key, string fingerprint, double seconds)
    {
        var form = Lookups.Query([("client", key), ("format", "json"), ("duration", ((int)seconds).ToString(System.Globalization.CultureInfo.InvariantCulture)),
            ("meta", "recordings releasegroups releases tracks"), ("fingerprint", fingerprint)]).Replace("%20", "+", StringComparison.Ordinal);
        try
        {
            var j = await Ask(HttpMethod.Post, BaseUrl + "/lookup", form);
            Said("ok");
            return (j["results"] as List<object?> ?? []).OfType<JsObj>().ToList();
        }
        catch (AcoustIdError e) { Said(e.Kind); throw; }
    }

    /* Does [key] work? "ok", "invalid" (AcoustID refused it) or "unknown" (no answer either way). */
    public async Task<string> Check(string key)
    {
        try
        {
            await Ask(HttpMethod.Get, BaseUrl + "/lookup?" + Lookups.Query([("client", key), ("format", "json"), ("trackid", KnownTrack)]), null);
            Said("ok");
            return "ok";
        }
        catch (AcoustIdError e)
        {
            if (e.Kind == "invalid") { Said("invalid"); return "invalid"; }
            return "unknown";
        }
    }
}
