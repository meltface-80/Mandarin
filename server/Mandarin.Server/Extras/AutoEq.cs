// AutoEq.cs — headphone profiles from AutoEq (v0.8.26): lib/autoeq.js rule
// for rule, with the band rules of public/biquad.js's normaliseBand.
//
// AutoEq publishes, for thousands of headphones, a parametric EQ that brings
// each measured response to a target. Its index (results/INDEX.md) is fetched
// once a day and kept in the cache table, as the Node server keeps it (the
// same rows, so either reads the other's); a profile is fetched when chosen
// and kept for good. A profile pasted by hand goes through the same parser.
using System.Globalization;
using System.Net;
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

/* A refusal with its HTTP status (Node's e.status; 502 when none). */
internal sealed class AutoEqError(string message, int status = 502) : Exception(message)
{
    public int Status { get; } = status;
}

internal sealed partial class AutoEq(string? baseUrl, Action<string> log)
{
    public const string DefaultBase = "https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results";
    public const int MaxBands = 10;
    private const string Ns = "autoeq";
    private const double IndexMaxAge = 24 * 3600 * 1000;
    private static readonly string[] Types = ["peak", "low_shelf", "high_shelf", "low_pass", "high_pass"];

    private readonly string baseUrl = (baseUrl is { Length: > 0 } b ? b : DefaultBase).TrimEnd('/');
    private readonly object gate = new();
    private Task<List<object?>>? loading;

    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30),
        AutomaticDecompression = DecompressionMethods.All,
        AllowAutoRedirect = true,
    }) { Timeout = Timeout.InfiniteTimeSpan };

    // ------------------------------------------------------------ AutoEq's files

    // "- [Sennheiser HD 650](./oratory1990/over-ear/Sennheiser%20HD%20650) by oratory1990 on GRAS 43AG-7"
    [GeneratedRegex(@"^- \[([^\]]+)\]\(\./([^)]+)\)\s+by\s+(.+?)(?:\s+on\s+(.+?))?\s*$")] private static partial Regex Row();
    [GeneratedRegex("in-ear", RegexOptions.IgnoreCase)] private static partial Regex InEar();
    [GeneratedRegex("earbud", RegexOptions.IgnoreCase)] private static partial Regex Earbud();
    [GeneratedRegex("over-ear", RegexOptions.IgnoreCase)] private static partial Regex OverEar();

    /* The index's markdown as rows: { id, name, source, rig, form }; the id is the path under results/, decoded. */
    public static List<object?> ParseIndex(string md)
    {
        var rows = new List<object?>();
        foreach (var line in md.Split('\n'))
        {
            var m = Row().Match(Names.JsTrim(line));
            if (!m.Success) continue;
            var id = DecodeURIComponent(m.Groups[2].Value);
            var parts = id.Split('/');
            // The middle folder names the rig and the form: "GRAS 43AG-7 over-ear", "in-ear", "earbud".
            var mid = parts.Length >= 3 ? parts[1] : "";
            var form = InEar().IsMatch(mid) ? "in-ear" : Earbud().IsMatch(mid) ? "earbud" : OverEar().IsMatch(mid) ? "over-ear" : "";
            var o = new JsObj();
            o["id"] = id;
            o["name"] = m.Groups[1].Value;
            o["source"] = Names.JsTrim(m.Groups[3].Value);
            o["rig"] = Names.JsTrim(m.Groups[4].Success ? m.Groups[4].Value : "");
            o["form"] = form;
            rows.Add(o);
        }
        return rows;
    }

    /* decodeURIComponent: a malformed escape throws, as it does there. */
    private static string DecodeURIComponent(string s)
    {
        if (!s.Contains('%')) return s;
        var bytes = new List<byte>();
        var sb = new System.Text.StringBuilder();
        var utf8 = new System.Text.UTF8Encoding(false, true);
        void Flush()
        {
            if (bytes.Count == 0) return;
            try { sb.Append(utf8.GetString(bytes.ToArray())); }
            catch (System.Text.DecoderFallbackException) { throw new AutoEqError("URI malformed"); }
            bytes.Clear();
        }
        for (var i = 0; i < s.Length; i++)
        {
            if (s[i] == '%')
            {
                if (i + 2 >= s.Length || !Uri.IsHexDigit(s[i + 1]) || !Uri.IsHexDigit(s[i + 2])) throw new AutoEqError("URI malformed");
                bytes.Add(byte.Parse(s.AsSpan(i + 1, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                i += 2;
            }
            else { Flush(); sb.Append(s[i]); }
        }
        Flush();
        return sb.ToString();
    }

    private static readonly Dictionary<string, string> TypeOf = new()
    {
        ["PK"] = "peak", ["PEQ"] = "peak", ["LSC"] = "low_shelf", ["LS"] = "low_shelf", ["LSQ"] = "low_shelf",
        ["HSC"] = "high_shelf", ["HS"] = "high_shelf", ["HSQ"] = "high_shelf", ["LPQ"] = "low_pass", ["LP"] = "low_pass",
        ["HPQ"] = "high_pass", ["HP"] = "high_pass",
    };
    [GeneratedRegex(@"^Preamp:\s*(-?[0-9.]+)\s*dB", RegexOptions.IgnoreCase)] private static partial Regex Preamp();
    [GeneratedRegex(@"^Filter\s*[0-9]*:\s*(ON|OFF)\s+([A-Z]+)\s+Fc\s+(-?[0-9.]+)\s*Hz(?:\s+Gain\s+(-?[0-9.]+)\s*dB)?(?:\s+Q\s+(-?[0-9.]+))?", RegexOptions.IgnoreCase)]
    private static partial Regex Filter();

    // Math.round(x): halves up, toward +Infinity.
    private static double Round(double x) => Math.Floor(x + 0.5);

    /* biquad.js normaliseBand: within range, rounded as stored; out of range throws. */
    public static JsObj NormaliseBand(string type, double freq, double gain, double q)
    {
        if (!Types.Contains(type)) throw new AutoEqError("band type must be one of " + string.Join(", ", Types), 400);
        if (!(freq >= 10 && freq <= 24000)) throw new AutoEqError("band frequency must be 10–24000 Hz", 400);
        if (!(q >= 0.1 && q <= 20)) throw new AutoEqError("band Q must be 0.1–20", 400);
        if (type is "low_pass" or "high_pass") gain = 0;
        if (!(gain >= -20 && gain <= 20)) throw new AutoEqError("band gain must be −20–20 dB", 400);
        var o = new JsObj();
        o["type"] = type;
        o["freq"] = Round(freq * 10) / 10;
        o["gain"] = Round(gain * 10) / 10 + 0.0;   // never -0
        o["q"] = Round(q * 1000) / 1000;
        return o;
    }

    /*
     * A ParametricEQ.txt (AutoEq's, or Equalizer APO's shape generally) →
     * { preamp, bands }. OFF filters are left out, and a band out of range;
     * more than ten keeps the first ten. Nothing that is a filter: 400.
     */
    public static (double? Preamp, List<object?> Bands) ParseProfile(string text)
    {
        double? preamp = null;
        var bands = new List<object?>();
        foreach (var raw in text.Split('\n'))
        {
            var line = Names.JsTrim(raw);
            var m = Preamp().Match(line);
            if (m.Success) { var p = Library.Num(m.Groups[1].Value); preamp = double.IsNaN(p) ? double.NaN : Math.Min(0, p); continue; }
            m = Filter().Match(line);
            if (!m.Success) continue;
            if (m.Groups[1].Value.ToUpperInvariant() == "OFF") continue;
            if (!TypeOf.TryGetValue(m.Groups[2].Value.ToUpperInvariant(), out var type)) continue;
            var freq = Library.Num(m.Groups[3].Value);
            var gain = m.Groups[4].Success ? Library.Num(m.Groups[4].Value) : 0;
            var q = m.Groups[5].Success ? Library.Num(m.Groups[5].Value) : 0.707;
            try { bands.Add(NormaliseBand(type, freq, gain, q)); }
            catch (AutoEqError) { /* a band out of range is left out */ }
        }
        if (bands.Count == 0) throw new AutoEqError("No filters found — a profile reads like “Filter 1: ON PK Fc 105 Hz Gain 3.1 dB Q 0.70”", 400);
        return (preamp, bands.Take(MaxBands).ToList());
    }

    // ------------------------------------------------------------ fetched, and kept

    private async Task<string> FetchText(string url)
    {
        Identify.Lookups.Allowed(url);
        try
        {
            using var cts = new CancellationTokenSource(30000);
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.TryAddWithoutValidation("User-Agent", "Mandarin (https://github.com/meltface-80/Mandarin)");
            using var res = await Http.SendAsync(req, cts.Token);
            if (!res.IsSuccessStatusCode) throw new AutoEqError($"AutoEq: HTTP {(int)res.StatusCode} for {url}");
            return await res.Content.ReadAsStringAsync(cts.Token);
        }
        catch (OperationCanceledException) { throw new AutoEqError("The operation was aborted due to timeout"); }
        catch (HttpRequestException) { throw new AutoEqError("fetch failed"); }
    }

    private static List<object?>? RowsOf(object? cached) => cached is JsObj o && o["rows"] is List<object?> rows ? rows : null;

    /* The index, from the cache or fetched once a day; one that can't be fetched leaves the last in use. */
    public Task<List<object?>> Index()
    {
        if (RowsOf(Taste.CacheGet(Ns, "index", IndexMaxAge)) is { } fresh) return Task.FromResult(fresh);
        lock (gate) return loading ??= Load();

        async Task<List<object?>> Load()
        {
            // Never finished before it is kept as the one loading (a refusal comes back at once).
            await Task.Yield();
            try
            {
                var md = await FetchText($"{baseUrl}/INDEX.md");
                var rows = ParseIndex(md);
                if (rows.Count == 0) throw new AutoEqError("AutoEq: the index had no rows");
                var o = new JsObj();
                o["rows"] = rows;
                o["at"] = (double)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                Taste.CachePut(Ns, "index", o);
                log($"[autoeq] index: {rows.Count} headphones");
                return rows;
            }
            catch (Exception e) when (e is AutoEqError or Identify.LookupError)
            {
                log($"[autoeq] index not fetched: {e.Message}");
                if (RowsOf(Taste.CacheGet(Ns, "index", 0)) is { } old) return old;
                throw;
            }
            finally { lock (gate) loading = null; }
        }
    }

    public static object? IndexedAt() => Taste.CacheGet(Ns, "index", 0) is JsObj o ? o["at"] : null;

    [GeneratedRegex(@"[\t\n\v\f\r    -     　﻿]+")] private static partial Regex Spaces();

    /* Headphones whose names carry every word of the query: shortest name first, then oratory1990's, crinacle's, Rtings'. */
    public async Task<List<object?>> Search(string query, int limit = 40)
    {
        var words = Spaces().Split(query.ToLowerInvariant()).Where(w => w.Length > 0).ToArray();
        if (words.Length == 0) return [];
        var rows = await Index();
        static int Rank(JsObj r) => Js.Str(r["source"]) switch { "oratory1990" => 0, "crinacle" => 1, "Rtings" => 2, _ => 3 };
        var hits = rows.OfType<JsObj>().Where(r => { var n = Js.Str(r["name"]).ToLowerInvariant(); return words.All(w => n.Contains(w, StringComparison.Ordinal)); }).ToList();
        // A stable sort, as Array.prototype.sort is.
        return hits.Select((r, i) => (r, i))
            .OrderBy(x => x.r, Comparer<JsObj>.Create((a, b) =>
            {
                var d = Js.Str(a["name"]).Length - Js.Str(b["name"]).Length;
                if (d != 0) return Math.Sign(d);
                d = Rank(a) - Rank(b);
                return d != 0 ? Math.Sign(d) : Library.Lc(Js.Str(a["source"]), Js.Str(b["source"]));
            }))
            .ThenBy(x => x.i)
            .Take(limit).Select(x => (object?)x.r).ToList();
    }

    /* One headphone's profile — { source: "autoeq", id, name, preamp, bands } — fetched once. */
    public async Task<JsObj> Profile(string id)
    {
        if (id.Length == 0 || id.Contains("..", StringComparison.Ordinal)) throw new AutoEqError("No such headphone", 404);
        if (Taste.CacheGet(Ns, "profile:" + id, 0) is JsObj hit) return hit;
        var rows = await Index();
        var row = rows.OfType<JsObj>().FirstOrDefault(r => Js.Str(r["id"]) == id) ?? throw new AutoEqError("No such headphone in AutoEq's index", 404);
        var name = Js.Str(row["name"]);
        var file = $"{baseUrl}/{string.Join("/", id.Split('/').Select(Mandarin.Server.Js.EncodeURIComponent))}/{Mandarin.Server.Js.EncodeURIComponent(name)}%20ParametricEQ.txt";
        var (preamp, bands) = ParseProfile(await FetchText(file));
        var source = Js.Str(row["source"]);
        var rig = Js.Str(row["rig"]);
        var o = new JsObj();
        o["source"] = "autoeq";
        o["id"] = id;
        o["name"] = name + (source.Length > 0 ? $" ({source}{(rig.Length > 0 ? ", " + rig : "")})" : "");
        o["preamp"] = preamp;
        o["bands"] = bands;
        Taste.CachePut(Ns, "profile:" + id, o);
        return o;
    }
}
