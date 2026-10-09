// Lastfm.cs — Last.fm, read-only (v0.8.26): lib/lastfm.js rule for rule.
// Similar artists, and an album by each of the closest; no scrobbling, no
// account, no writes. A personal API key is the whole credential, and with
// none the feature is absent.
//
// Their terms ask for no more than five requests a second: calls go out one at
// a time, a quarter of a second apart, through one queue, and every answer is
// kept for a week (a failure for ten minutes; a missing key and Last.fm's own
// "too many requests" not at all). Where Last.fm is asked comes from the Node
// server (Jobs.cs: a fake in the tests).
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Server.Extras;

/* A Last.fm failure: Code is "nokey", "network", "http", or Last.fm's error number. */
internal sealed class LastfmError(string message, object code) : Exception(message)
{
    public object Code { get; } = code;
    public bool KeyRefused => Code is 10 or 26;
}

internal sealed record LastfmArtist(string Name, string Url, double Match, string Image);
internal sealed record LastfmSimilar(string Artist, string Url, List<LastfmArtist> Artists);
internal sealed record LastfmAlbum(string Title, string Artist, string Url, string Image);

internal sealed partial class Lastfm(string? baseUrl, Func<string> getKey, string userAgent)
{
    public const string Api = "https://ws.audioscrobbler.com/2.0/";
    // Last.fm's grey star: every artist picture since 2019. None is better.
    private const string Placeholder = "2a96cbd8b46e442fc41c2b86b821562f";
    private const long Ttl = 7L * 24 * 60 * 60 * 1000, FailTtl = 10 * 60 * 1000;
    private const int Spacing = 250, MaxEntries = 800, TimeoutMs = 8000;

    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30),
        AutomaticDecompression = DecompressionMethods.All,
    }) { Timeout = Timeout.InfiniteTimeSpan };

    public string BaseUrl { get; } = baseUrl is { Length: > 0 } b ? (b.EndsWith('/') ? b : b + "/") : Api;

    private sealed class Entry
    {
        public long At, TtlMs;
        public object? Value;
        public Exception? Error;
        public Task<object?>? Pending;
    }
    private readonly object gate = new();
    private readonly Dictionary<string, Entry> cache = [];
    private readonly LinkedList<string> order = new();      // oldest use first
    private readonly SemaphoreSlim queue = new(1, 1);
    private long lastCallAt;
    private int generation;

    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private static string KeyFor(string kind, string artist) => kind + "\u0000" + Names.JsTrim(artist).ToLowerInvariant();

    /* The largest picture offered, never the placeholder, https only; else "". */
    public static string PickImage(JsonNode? images)
    {
        if (images is not JsonArray list) return "";
        string[] rank = ["mega", "extralarge", "large", "medium", "small", ""];
        string best = "";
        var bestRank = int.MaxValue;
        foreach (var im in list)
        {
            var url = im is JsonObject o && o["#text"] is JsonValue v && v.TryGetValue<string>(out var s) ? Names.JsTrim(s) : "";
            if (url.Length == 0 || url.Contains(Placeholder, StringComparison.Ordinal) || !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) continue;
            var size = im is JsonObject o2 && o2["size"] is JsonValue sv ? Str(sv) : "";
            var r = Array.IndexOf(rank, size);
            var k = r == -1 ? rank.Length : r;
            if (k < bestRank) { bestRank = k; best = url; }
        }
        return best;
    }

    [GeneratedRegex(@"^https://(www\.)?last\.fm/", RegexOptions.IgnoreCase)] private static partial Regex SiteRe();
    /* A link to Last.fm's own https site, or "". */
    public static string SiteUrl(JsonNode? u)
    {
        var s = Names.JsTrim(Str(u));
        return SiteRe().IsMatch(s) ? s : "";
    }

    // String(x || "") of a JSON value: a string as it is, a number as JavaScript writes it.
    private static string Str(JsonNode? n) => n switch
    {
        JsonValue v when v.TryGetValue<string>(out var s) => s,
        JsonValue v when v.TryGetValue<double>(out var d) => d == 0 || double.IsNaN(d) ? "" : Tags.Js.Num(d),
        JsonValue v when v.TryGetValue<bool>(out var b) => b ? "true" : "",
        _ => ""
    };
    // A single result comes as an object rather than a one-element array.
    private static IEnumerable<JsonNode?> AsList(JsonNode? x) => x is JsonArray a ? a : x is JsonObject o ? [o] : [];

    /* One call, through the queue, a quarter of a second after the last. */
    private async Task<JsonObject> Call(string method, params (string Key, string Value)[] args)
    {
        await queue.WaitAsync();
        try
        {
            var key = Names.JsTrim(getKey() ?? "");
            if (key.Length == 0) throw new LastfmError("no Last.fm key", "nokey");
            var wait = lastCallAt + Spacing - Now;
            if (wait > 0) await Task.Delay((int)wait);
            lastCallAt = Now;
            var qs = new StringBuilder();
            foreach (var (k, v) in new[] { ("method", method), ("api_key", key), ("format", "json") }.Concat(args))
            {
                if (qs.Length > 0) qs.Append('&');
                qs.Append(Form(k)).Append('=').Append(Form(v));
            }
            var url = BaseUrl + "?" + qs;
            JsonObject? j;
            HttpStatusCode status;
            bool ok;
            try
            {
                Identify.Lookups.Allowed(url);
                using var cts = new CancellationTokenSource(TimeoutMs);
                using var req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.TryAddWithoutValidation("User-Agent", userAgent);
                req.Headers.TryAddWithoutValidation("Accept", "application/json");
                using var res = await Http.SendAsync(req, cts.Token);
                status = res.StatusCode;
                ok = res.IsSuccessStatusCode;
                try { j = JsonNode.Parse(await res.Content.ReadAsStringAsync(cts.Token)) as JsonObject; }
                catch (System.Text.Json.JsonException) { j = null; }
            }
            catch (Exception e) when (e is HttpRequestException or OperationCanceledException or Identify.LookupError or IOException)
            {
                throw new LastfmError("Last.fm unreachable: " + e.Message, "network");
            }
            if (j?["error"] is JsonNode err && Js.Truthy(err))
            {
                var n = err is JsonValue ev && ev.TryGetValue<double>(out var d) ? d : Library.Num(Str(err));
                throw new LastfmError(j["message"] is JsonValue mv && mv.TryGetValue<string>(out var msg) ? msg : "Last.fm error " + Str(err), double.IsNaN(n) ? "http" : (int)n);
            }
            if (!ok || j == null) throw new LastfmError("Last.fm answered HTTP " + (int)status, "http");
            return j;
        }
        finally { queue.Release(); }
    }

    // URLSearchParams' form encoding: letters, digits and *-._ as they are, a space as +.
    private static string Form(string s)
    {
        var sb = new StringBuilder();
        foreach (var b in Encoding.UTF8.GetBytes(s))
        {
            var c = (char)b;
            if (char.IsAsciiLetterOrDigit(c) || c is '*' or '-' or '.' or '_') sb.Append(c);
            else if (c == ' ') sb.Append('+');
            else sb.Append('%').Append(b.ToString("X2"));
        }
        return sb.ToString();
    }

    /* Remembered answers; a failure too, for less time, but never a missing key or "too many requests" (29). */
    private Task<object?> Remembered(string kind, string artist, Func<Task<object?>> compute)
    {
        var k = KeyFor(kind, artist);
        lock (gate)
        {
            if (cache.TryGetValue(k, out var hit))
            {
                if (hit.Pending != null) return hit.Pending;
                if (Now - hit.At < hit.TtlMs)
                {
                    Touch(k);
                    return hit.Error != null ? Task.FromException<object?>(hit.Error) : Task.FromResult(hit.Value);
                }
            }
            var gen = generation;
            var pending = Run();
            if (!pending.IsCompleted) { Put(k, new Entry { Pending = pending }); }
            return pending;

            async Task<object?> Run()
            {
                try
                {
                    var value = await compute();
                    lock (gate) if (gen == generation) Put(k, new Entry { At = Now, TtlMs = Ttl, Value = value });
                    return value;
                }
                catch (Exception e)
                {
                    lock (gate)
                    {
                        if (gen == generation)
                        {
                            if (e is LastfmError { Code: "nokey" or 29 }) Remove(k);
                            else Put(k, new Entry { At = Now, TtlMs = FailTtl, Error = e });
                        }
                    }
                    throw;
                }
            }
        }
    }
    private void Touch(string k) { order.Remove(k); order.AddLast(k); }
    private void Remove(string k) { cache.Remove(k); order.Remove(k); }
    private void Put(string k, Entry e)
    {
        Remove(k);
        cache[k] = e;
        order.AddLast(k);
        while (cache.Count > MaxEntries && order.First is { } first) { cache.Remove(first.Value); order.RemoveFirst(); }
    }

    /* The artists Last.fm calls closest to `artist`, closest first (24). */
    public async Task<LastfmSimilar> SimilarArtists(string artist)
    {
        var name = Names.JsTrim(artist ?? "");
        if (name.Length == 0) return new LastfmSimilar("", "", []);
        return (LastfmSimilar)(await Remembered("similar", name, async () =>
        {
            var j = await Call("artist.getSimilar", ("artist", name), ("autocorrect", "1"), ("limit", "24"));
            var sim = j["similarartists"] as JsonObject;
            var attr = sim?["@attr"] as JsonObject;
            var seen = new HashSet<string>();
            var artists = new List<LastfmArtist>();
            foreach (var a in AsList(sim?["artist"]))
            {
                var n = Names.JsTrim(Str((a as JsonObject)?["name"]));
                if (n.Length == 0 || !seen.Add(n.ToLowerInvariant())) continue;
                var match = Library.Num(Str(a!["match"]) is { Length: > 0 } ms ? ms : "0");
                artists.Add(new LastfmArtist(n, SiteUrl(a["url"]), double.IsNaN(match) ? 0 : match, PickImage(a["image"])));
            }
            var canonical = attr?["artist"] is JsonNode an && Str(an) is { Length: > 0 } cs ? cs : name;
            return new LastfmSimilar(canonical, "https://www.last.fm/music/" + Js.EncodeURIComponent(canonical).Replace("%20", "+"), artists);
        }))!;
    }

    /* `artist`'s most-played album on Last.fm, or null. */
    public async Task<LastfmAlbum?> TopAlbum(string artist)
    {
        var name = Names.JsTrim(artist ?? "");
        if (name.Length == 0) return null;
        return (LastfmAlbum?)await Remembered("top", name, async () =>
        {
            var j = await Call("artist.getTopAlbums", ("artist", name), ("autocorrect", "1"), ("limit", "5"));
            foreach (var al in AsList((j["topalbums"] as JsonObject)?["album"]))
            {
                var title = Names.JsTrim(Str((al as JsonObject)?["name"]));
                // Untitled rows come as "(null)".
                if (title.Length == 0 || title == "(null)") continue;
                var byName = Str((al!["artist"] as JsonObject)?["name"]);
                var by = Names.JsTrim(byName.Length > 0 ? byName : name);
                return new LastfmAlbum(title, by, SiteUrl(al["url"]), PickImage(al["image"]));
            }
            return null;
        });
    }

    /*
     * Similar albums: the top album of each of the `count` closest similar
     * artists; one that can't be read is skipped (a refused key isn't).
     * `wanted()` false (the page has gone) stops it between artists.
     */
    public async Task<(string Artist, List<LastfmAlbum> Albums)> SimilarAlbums(string artist, int count, Func<bool> wanted)
    {
        var sim = await SimilarArtists(artist);
        var outList = new List<LastfmAlbum>();
        foreach (var a in sim.Artists.Take(count > 0 ? count : 9))
        {
            if (!wanted()) break;
            LastfmAlbum? al = null;
            try { al = await TopAlbum(a.Name); }
            catch (LastfmError e) when (!(e.Code is "nokey" || e.KeyRefused)) { /* that one entry only */ }
            if (al != null) outList.Add(al);
        }
        return (sim.Artist, outList);
    }

    /* Everything forgotten: a new key may see a different catalogue. */
    public void Clear()
    {
        lock (gate) { generation++; cache.Clear(); order.Clear(); }
    }

    // ------------------------------------------------------------ the key's check

    private readonly Dictionary<string, (string? State, long At, Task<string>? Pending)> checks = [];

    [GeneratedRegex(@"invalid api key|""error""\s*:\s*(10|26)\b", RegexOptions.IgnoreCase)] private static partial Regex RefusedRe();

    /* Does the key work? "ok", "invalid", or "unknown" (no answer either way). */
    private async Task<string> Probe(string k)
    {
        var url = BaseUrl + "?method=artist.getInfo&artist=Radiohead&format=json&api_key=" + Js.EncodeURIComponent(k);
        try
        {
            Identify.Lookups.Allowed(url);
            using var cts = new CancellationTokenSource(8000);
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.TryAddWithoutValidation("User-Agent", userAgent);
            req.Headers.TryAddWithoutValidation("Accept", "application/json");
            using var res = await Http.SendAsync(req, cts.Token);
            if (res.IsSuccessStatusCode) return "ok";
            // Last.fm refuses a bad key with 403 and its own words; a bare 403 says nothing about the key.
            string body;
            try { body = await res.Content.ReadAsStringAsync(cts.Token); } catch (Exception) { body = ""; }
            return RefusedRe().IsMatch(body) ? "invalid" : "unknown";
        }
        catch (Exception) { return "unknown"; }
    }

    /* Remembered per key: ok for 12 hours, a refusal for an hour, no answer for ten minutes; fresh asks now. */
    public Task<string> CheckKey(string k, bool fresh, Action<string> log)
    {
        lock (checks)
        {
            checks.TryGetValue(k, out var hit);
            var known = checks.ContainsKey(k);
            var age = known ? Now - hit.At : long.MaxValue;
            var stale = !known || (hit.State == "ok" ? age > 12 * 3600000L : hit.State == "invalid" ? age > 3600000L : age > 600000L);
            if (!fresh && !stale && hit.State != null) return Task.FromResult(hit.State);
            if (hit.Pending != null) return hit.Pending;
            var pending = Run();
            checks[k] = (hit.State, hit.At, pending);
            return pending;
        }
        async Task<string> Run()
        {
            var state = await Probe(k);
            lock (checks) checks[k] = (state, Now, null);
            if (state != "ok") log($"[settings] last.fm key check: {state}");
            return state;
        }
    }
}
