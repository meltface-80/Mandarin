// LabelLogos.cs — a record label's logo (v0.8.20): lib/labellogos.js, rule
// for rule.
//
// Found in the background for every label that has none: Discogs first (its
// label page's own image; needs your Discogs token), then FanArt.tv (its HD
// logo for the label's MusicBrainz id, looked up by name; needs your FanArt.tv
// key). Or chosen by hand on the label's page, from Discogs' candidates or a
// pasted address. The file is kept under the data folder (labels/) and served
// as the image `label-<key>` (Images.cs). A label no source has a logo for is
// asked about again after a week, or as soon as the keys change.
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Mandarin.Server.Identify;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal sealed record Logo(string File, string Type, string Url, string Source, long UpdatedAt);

internal sealed partial class LabelLogos(string dataDir, MusicBrainz? mb, string? discogsBaseUrl, string? fanartBaseUrl, int pauseMs, string version, Action<string> log)
{
    private const double MissTtl = 7.0 * 86400000;
    public const string DiscogsBase = "https://api.discogs.com";
    public const string FanartBase = "https://webservice.fanart.tv";
    private const int MaxImage = 8 * 1024 * 1024;

    private readonly string dir = Path.Combine(dataDir, "labels");
    private readonly string discogsBase = (string.IsNullOrEmpty(discogsBaseUrl) ? DiscogsBase : discogsBaseUrl).TrimEnd('/');
    private readonly string fanartBase = (string.IsNullOrEmpty(fanartBaseUrl) ? FanartBase : fanartBaseUrl).TrimEnd('/');
    private readonly string ua = "Mandarin/" + version + " (+https://github.com/meltface-80/Mandarin)";
    private readonly object gate = new();

    public bool Running { get; private set; }
    public int Done, Total;
    private (List<(string Key, string Title)> Labels, bool Force)? again;
    private readonly List<string> lines = [];
    /* Whether this server may go on (the Node server has handed the work over). */
    public Func<bool> Ready { get; init; } = () => true;

    public List<string> Lines() { lock (lines) return [.. lines]; }
    private void Note(string line)
    {
        lock (lines)
        {
            lines.Add(DateTime.UtcNow.ToString("HH:mm:ss", CultureInfo.InvariantCulture) + " " + line);
            if (lines.Count > 400) lines.RemoveAt(0);
        }
        log("[labels] " + line);
    }

    private static string Text(object? v) => Js.Truthy(v) ? Js.Str(v) : "";
    public static string DiscogsToken() => Text(Labels.Setting("discogsToken"));
    public static string FanartKey() => Text(Labels.Setting("fanartKey"));

    // ------------------------------------------------------------ is the key good

    private sealed class Check { public string? State; public long At; public Task<string>? Pending; }
    private readonly Dictionary<string, Check> keyChecks = [];

    /*
     * Does the key work? "ok" the service took it, "invalid" it refused it,
     * "unknown" no answer either way (offline, timed out, the service erring,
     * a bare 403 from a proxy or CDN), null no key. Remembered per key: ok for
     * 12 hours, a refusal for an hour, no answer for 10 minutes. fresh asks
     * again now (a key just saved).
     */
    public Task<string?> CheckKey(string kind, bool fresh)
    {
        var key = kind == "discogs" ? DiscogsToken() : FanartKey();
        if (key.Length == 0) return Task.FromResult<string?>(null);
        var id = kind + ":" + key;
        lock (keyChecks)
        {
            keyChecks.TryGetValue(id, out var hit);
            var age = hit != null ? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - hit.At : long.MaxValue;
            var stale = hit == null || (hit.State == "ok" ? age > 12 * 3600000L : hit.State == "invalid" ? age > 3600000L : age > 600000L);
            if (!fresh && !stale) return Task.FromResult(hit!.State);
            if (hit?.Pending != null) return Then(hit.Pending);
            var pending = Probe(kind, key).ContinueWith(t =>
            {
                var state = t.IsCompletedSuccessfully ? t.Result : "unknown";
                lock (keyChecks) keyChecks[id] = new Check { State = state, At = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
                if (state != "ok") log($"[settings] {kind} key check: {state}");
                return state;
            }, TaskScheduler.Default);
            keyChecks[id] = new Check { State = hit?.State, At = hit?.At ?? 0, Pending = pending };
            return Then(pending);
        }
        static async Task<string?> Then(Task<string> t) => await t;
    }

    // /invalid|unauthori[sz]ed|not authori[sz]ed|api key/i
    [GeneratedRegex("[iI][nN][vV][aA][lL][iI][dD]|[uU][nN][aA][uU][tT][hH][oO][rR][iI][sSzZ][eE][dD]|[nN][oO][tT] [aA][uU][tT][hH][oO][rR][iI][sSzZ][eE][dD]|[aA][pP][iI] [kK][eE][yY]")]
    private static partial Regex Refused();

    private async Task<string> Probe(string kind, string key)
    {
        // Discogs: the token's own identity — 200 with the account, 401 without.
        // FanArt.tv: one well-known artist (Radiohead's MusicBrainz id). A good
        // key gets 200, or 404 if the artist had no art; a bad one gets 401.
        var url = kind == "discogs"
            ? discogsBase + "/oauth/identity"
            : fanartBase + "/v3/music/a74b1b7f-71a5-4011-9441-d0b5e4122711?api_key=" + Lookups.Encode(key);
        var headers = new List<(string, string)> { ("User-Agent", ua), ("Accept", "application/json") };
        if (kind == "discogs") headers.Add(("Authorization", "Discogs token=" + key));
        try
        {
            var (status, body, _) = await Lookups.Fetch(url, headers, 8000, 1 << 20);
            // 401 is the key. A 403 is only taken as one when the service says so in
            // its own words; a bare 403 (a CDN page, a proxy) says nothing about it.
            if (status == 401) return "invalid";
            if (status == 403) return Refused().IsMatch(body != null ? Encoding.UTF8.GetString(body) : "") ? "invalid" : "unknown";
            if ((status >= 200 && status < 300) || (kind == "fanart" && status == 404)) return "ok";
            return "unknown";
        }
        catch (Exception) { return "unknown"; }   // offline or timed out — not evidence the key is wrong
    }

    // ------------------------------------------------------------ what's kept

    /* The logo kept for a label key, or null. */
    public Logo? Get(string key)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT file, type, source, updated_at FROM label_logos WHERE key = $k";
        cmd.Parameters.AddWithValue("$k", key);
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return null;
        var file = Path.Combine(dir, r.GetString(0));
        if (!File.Exists(file)) return null;
        var at = Convert.ToInt64(r.GetValue(3), CultureInfo.InvariantCulture);
        return new Logo(file, r.GetString(1), $"/api/image/label-{key}?v={at}", r.GetString(2), at);
    }

    /* Every label key that has a logo, with its address. */
    public static Dictionary<string, string> Urls()
    {
        var m = new Dictionary<string, string>();
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT key, updated_at FROM label_logos";
        using var r = cmd.ExecuteReader();
        while (r.Read()) m[r.GetString(0)] = $"/api/image/label-{r.GetString(0)}?v={Convert.ToInt64(r.GetValue(1), CultureInfo.InvariantCulture)}";
        return m;
    }

    // ------------------------------------------------------------ fetching

    private Task<object?> Json(string url, params (string, string)[] extra) =>
        Lookups.Json(url, new List<(string, string)> { ("User-Agent", ua), ("Accept", "application/json") }.Concat(extra), 15000);

    private Task<object?> Discogs(string pathAndQuery)
    {
        var token = DiscogsToken();
        if (token.Length == 0) throw new LookupError("Discogs token needed (Settings → Setup → API Keys)");
        return Json(discogsBase + pathAndQuery, ("Authorization", "Discogs token=" + token));
    }

    private static List<object?> L(object? v) => v as List<object?> ?? [];
    [GeneratedRegex("spacer\\.gif\\z")] private static partial Regex Spacer();

    /* Discogs' label images for a name: [{ img, title, id }], the best match first. */
    public async Task<List<object?>> Candidates(string name)
    {
        var j = await Discogs("/database/search?type=label&q=" + Lookups.Encode(name) + "&per_page=25");
        var want = Names.LabelKey(name);
        var rows = L((j as JsObj)?["results"]).Select(r => r as JsObj ?? new JsObj()).Where(r => Js.Truthy(r["cover_image"]) || Js.Truthy(r["thumb"])).ToList();
        rows = Library.Sorted(rows, (a, b) => (Names.LabelKey(Text(a["title"])) == want ? 0 : 1) - (Names.LabelKey(Text(b["title"])) == want ? 0 : 1));
        var outList = new List<object?>();
        foreach (var r in rows)
        {
            var img = Js.Truthy(r["cover_image"]) ? r["cover_image"] : r["thumb"];
            if (!Js.Truthy(img) || Spacer().IsMatch(Js.Str(img))) continue;
            var o = new JsObj();
            o["img"] = img;
            o["title"] = r["title"];
            o["id"] = r["id"];
            outList.Add(o);
        }
        return outList;
    }

    /* The logo Discogs has for this label, by its own page: the primary image. */
    private async Task<string?> FromDiscogs(string name)
    {
        var cands = await Candidates(name);
        var hit = cands.OfType<JsObj>().FirstOrDefault(c => Names.LabelKey(Text(c["title"])) == Names.LabelKey(name));
        if (hit == null) return null;
        try
        {
            var page = await Discogs("/labels/" + Js.Str(hit["id"])) as JsObj;
            var images = L(page?["images"]).Select(i => i as JsObj).ToList();
            var img = images.FirstOrDefault(i => i != null && Js.StrictEq(i["type"], "primary")) ?? (images.Count > 0 ? images[0] : null);
            if (img != null && (Js.Truthy(img["uri"]) || Js.Truthy(img["resource_url"]))) return Js.Str(Js.Truthy(img["uri"]) ? img["uri"] : img["resource_url"]);
        }
        catch (Exception) { /* the search's picture will do */ }
        return Js.Str(hit["img"]);
    }

    /* The label's MusicBrainz id, by name — exactly that name, by key. */
    private async Task<string?> Mbid(string name)
    {
        if (mb == null) return null;
        var j = await mb.Get("label/", ("query", "label:\"" + Regex.Replace(name, "[\"\\\\]", m => "\\" + m.Value) + "\""), ("limit", 5.0));
        var want = Names.LabelKey(name);
        var hit = L((j as JsObj)?["labels"]).OfType<JsObj>().FirstOrDefault(l => Names.LabelKey(Text(l["name"])) == want);
        return hit != null && Js.Truthy(hit["id"]) ? Js.Str(hit["id"]) : null;
    }

    /* FanArt.tv's logo for the label: HD first. */
    private async Task<string?> FromFanart(string name)
    {
        var key = FanartKey();
        if (key.Length == 0) return null;
        var id = await Mbid(name);
        if (id == null) return null;
        object? j;
        try { j = await Json($"{fanartBase}/v3/music/labels/{Lookups.Encode(id)}?api_key={Lookups.Encode(key)}"); }
        catch (LookupError e) when (e.Message.Contains("HTTP 404", StringComparison.Ordinal)) { return null; }
        var o = j as JsObj ?? new JsObj();
        var hd = L(o["hdmusiclogo"]);
        var plain = L(o["musiclogo"]);
        var pick = (hd.Count > 0 && Js.Truthy(hd[0]) ? hd[0] : plain.Count > 0 ? plain[0] : null) as JsObj;
        return pick != null && Js.Truthy(pick["url"]) ? Js.Str(pick["url"]) : null;
    }

    // ------------------------------------------------------------ keeping one

    [GeneratedRegex("^" + ScanNames.Ws + "*<(\\?[xX][mM][lL]|[sS][vV][gG])")] private static partial Regex SvgStart();
    [GeneratedRegex("^image/svg")] private static partial Regex SvgType();
    [GeneratedRegex("^[hH][tT][tT][pP][sS]?://")] private static partial Regex WebAddress();

    /* An image's kind from its bytes: [type, extension], or null (labellogos.js typeOf). */
    public static (string Type, string Ext)? TypeOf(byte[] buf, string? declared)
    {
        // Buffer's "ascii": the high bit of each byte unset.
        string Ascii(int from, int to) => new(buf.Skip(from).Take(Math.Max(0, Math.Min(to, buf.Length) - from)).Select(b => (char)(b & 0x7f)).ToArray());
        if (buf.Length > 8 && buf[0] == 0x89 && buf[1] == 0x50) return ("image/png", "png");
        if (buf.Length > 3 && buf[0] == 0xff && buf[1] == 0xd8) return ("image/jpeg", "jpg");
        if (buf.Length > 6 && Ascii(0, 6).StartsWith("GIF8", StringComparison.Ordinal)) return ("image/gif", "gif");
        if (buf.Length > 12 && Ascii(8, 12) == "WEBP") return ("image/webp", "webp");
        if (SvgStart().IsMatch(Encoding.UTF8.GetString(buf, 0, Math.Min(200, buf.Length)))) return ("image/svg+xml", "svg");
        if (SvgType().IsMatch(declared ?? "")) return ("image/svg+xml", "svg");
        return null;
    }

    /* Fetch an image and keep it as the label's logo. → its address on this server. */
    public async Task<string> Save(string key, string url, string? source)
    {
        if (!WebAddress().IsMatch(url)) throw new LookupError("A web address is needed");
        var (status, buf, type) = await Lookups.Fetch(url, [("User-Agent", ua), ("Accept", "image/*")], 20000, MaxImage);
        if (status < 200 || status > 299) throw new LookupError("HTTP " + status);
        if (buf == null || buf.Length == 0) throw new LookupError("Not an image this server keeps (empty or over 8 MB)");
        var t = TypeOf(buf, type) ?? throw new LookupError("That address isn't an image");
        Directory.CreateDirectory(dir);
        var file = $"{key}.{t.Ext}";
        // Its own name while written: the Node server's .tmp is never this one's.
        var tmp = Path.Combine(dir, file + ".cs.tmp");
        await File.WriteAllBytesAsync(tmp, buf);
        File.Move(tmp, Path.Combine(dir, file), true);
        // Any other extension this key had before.
        foreach (var f in Directory.EnumerateFiles(dir).Select(Path.GetFileName).ToList())
            if (f != null && f.StartsWith(key + ".", StringComparison.Ordinal) && f != file && !f.EndsWith(".tmp", StringComparison.Ordinal))
                try { File.Delete(Path.Combine(dir, f)); } catch (IOException) { /* gone */ }
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        using (var c = Db.Open())
        {
            using (var cmd = c.CreateCommand())
            {
                cmd.CommandText = @"INSERT INTO label_logos(key, file, type, source, url, updated_at) VALUES($k, $f, $t, $s, $u, $a)
                                    ON CONFLICT(key) DO UPDATE SET file=excluded.file, type=excluded.type, source=excluded.source, url=excluded.url, updated_at=excluded.updated_at";
                cmd.Parameters.AddWithValue("$k", key);
                cmd.Parameters.AddWithValue("$f", file);
                cmd.Parameters.AddWithValue("$t", t.Type);
                cmd.Parameters.AddWithValue("$s", string.IsNullOrEmpty(source) ? "manual" : source);
                cmd.Parameters.AddWithValue("$u", url);
                cmd.Parameters.AddWithValue("$a", (double)now);
                cmd.ExecuteNonQuery();
            }
            using var del = c.CreateCommand();
            del.CommandText = "DELETE FROM cache WHERE ns = 'labellogo-miss' AND key = $k";
            del.Parameters.AddWithValue("$k", key);
            del.ExecuteNonQuery();
        }
        return $"/api/image/label-{key}?v={now}";
    }

    public void Remove(string key)
    {
        using var c = Db.Open();
        string? file = null;
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT file FROM label_logos WHERE key = $k";
            cmd.Parameters.AddWithValue("$k", key);
            file = cmd.ExecuteScalar() as string;
        }
        if (file != null) try { File.Delete(Path.Combine(dir, file)); } catch (IOException) { /* gone */ }
        using var del = c.CreateCommand();
        del.CommandText = "DELETE FROM label_logos WHERE key = $k";
        del.Parameters.AddWithValue("$k", key);
        del.ExecuteNonQuery();
    }

    // --------------------------------------------------------- the pass

    /* Which keys a lookup has to ask with, as a digest: never the keys themselves. */
    public static string KeysSig() =>
        Convert.ToHexStringLower(SHA1.HashData(Encoding.UTF8.GetBytes(DiscogsToken() + "\n" + FanartKey())))[..12];

    /*
     * Find logos for the labels that have none: one at a time, Discogs then
     * FanArt.tv, a pause between calls. A miss is remembered for a week (for
     * the keys it was asked with); [force] forgets the misses. Asked for
     * while a pass runs: it runs straight after.
     */
    public bool FetchMissing(List<(string Key, string Title)> labels, bool force)
    {
        List<(string Key, string Title)> todo;
        lock (gate)
        {
            if (Running)
            {
                again = (labels, force || (again?.Force ?? false));
                return true;
            }
            var have = Urls();
            var sig = KeysSig();
            var misses = MissesFor(sig);
            todo = labels.Where(l => !have.ContainsKey(l.Key) && (force || !misses.Contains(l.Key))).ToList();
            if (todo.Count == 0) return false;
            if (DiscogsToken().Length == 0 && FanartKey().Length == 0)
            {
                Note($"{todo.Count} label(s) without a logo; no Discogs token or FanArt.tv key to look with (Settings → Setup → API Keys)");
                return false;
            }
            Running = true;
            Done = 0; Total = todo.Count;
        }
        bool d = DiscogsToken().Length > 0, f = FanartKey().Length > 0;
        Note($"logos: looking for {todo.Count} label(s)" + (d ? " on Discogs" : "") + (f ? (d ? " and" : " on") + " FanArt.tv" : ""));
        _ = Task.Run(async () =>
        {
            try
            {
                int found = 0, consecutiveErrors = 0;
                foreach (var l in todo)
                {
                    if (!Ready()) break;
                    string? url = null, source = null;
                    var asked = KeysSig();
                    try
                    {
                        if (DiscogsToken().Length > 0) { url = await FromDiscogs(l.Title); source = "discogs"; }
                        if (url == null && FanartKey().Length > 0) { url = await FromFanart(l.Title); source = "fanart"; }
                        if (url != null)
                        {
                            await Save(l.Key, url, source);
                            found++;
                            Note($"{l.Title}: logo from {(source == "discogs" ? "Discogs" : "FanArt.tv")}");
                        }
                        else
                        {
                            Miss(l.Key, asked);
                            Note($"{l.Title}: no logo found");
                        }
                        consecutiveErrors = 0;
                    }
                    catch (Exception e)
                    {
                        Note($"{l.Title}: {e.Message}");
                        if (e.Message.Contains("HTTP 429", StringComparison.Ordinal)) await Task.Delay(30000);
                        if (++consecutiveErrors >= 5) { Note("logos: five errors in a row — stopping; next time the wall opens it tries again"); break; }
                    }
                    Interlocked.Increment(ref Done);
                    if (pauseMs > 0) await Task.Delay(pauseMs);
                }
                Note($"logos: done, {found} of {Total} found");
            }
            catch (Exception e) { Note("logos: " + e.Message); }
            (List<(string Key, string Title)> Labels, bool Force)? next;
            lock (gate) { Running = false; next = again; again = null; }
            if (next is { } a && Ready()) FetchMissing(a.Labels, a.Force);
        });
        return true;
    }

    /* The labels a miss stands for with these keys (cacheGet("labellogo-miss", key, a week) === sig). */
    private static HashSet<string> MissesFor(string sig)
    {
        var outSet = new HashSet<string>();
        var now = (double)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT key, value, ts FROM cache WHERE ns = 'labellogo-miss'";
        using var r = cmd.ExecuteReader();
        while (r.Read())
        {
            if (now - (r.IsDBNull(2) ? 0 : r.GetDouble(2)) > MissTtl) continue;
            object? v;
            try { v = JsJson.Parse(r.GetString(1)); } catch (Exception) { continue; }
            if (v is string s && s == sig) outSet.Add(r.GetString(0));
        }
        return outSet;
    }

    private static void Miss(string key, string sig)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO cache(ns, key, value, ts) VALUES('labellogo-miss', $k, $v, $t) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, ts = excluded.ts";
        cmd.Parameters.AddWithValue("$k", key);
        cmd.Parameters.AddWithValue("$v", Js.Json(sig));
        cmd.Parameters.AddWithValue("$t", (double)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        cmd.ExecuteNonQuery();
    }

    /* Force: every remembered miss forgotten. */
    public static void ClearMisses()
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "DELETE FROM cache WHERE ns = 'labellogo-miss'";
        cmd.ExecuteNonQuery();
    }
}
