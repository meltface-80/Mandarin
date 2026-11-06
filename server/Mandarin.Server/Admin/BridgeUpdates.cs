// BridgeUpdates.cs — the Mandarin Bridges on Settings → Updates (item 291): every one Mandarin knows (Android, Linux, a
// Raspberry Pi), its build, and the build published for it, an Update for each where they differ, so that a Bridge is
// never updated by hand on the device again.
//
//   GET  /api/update/bridges         { tag, bridges: [{ id, name, platform, version, commit, reachable, updates,
//                                      update, latest: { commit, version } | null, available, why }] }; with ?fresh=1
//                                      (a tap on Check for update, item 293), GitHub asked again, not as kept
//   POST /api/update/bridges/apply   { id }: the Bridge asked to update itself to the release (its POST /update {tag})
//
// Which release: a test build of Mandarin's follows "test-bridge" (dev's Bridges), a numbered one the newest
// "mandarin-bridge-v…". A build published is its asset's sidecar (bridge/sidecar.sh: the commit, the version, the
// SHA-256); the Bridge fetches the release from GitHub itself and checks it against that (Update.cs, Updater.kt): it
// is never handed an address, its port having no sign-in.
using System.Text.Json.Nodes;
using Mandarin.Server.Playback;
using Mandarin.Server.Renderers;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Admin;

internal static class BridgeUpdates
{
    private const string Repo = "meltface-80/Mandarin";
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private static readonly Dictionary<string, (DateTime At, JsonObject? Body)> asked = [];

    // Where GitHub's API is (UPDATE_API: the tests' own), as the server's updater has it.
    private static string Api => (Environment.GetEnvironmentVariable("UPDATE_API") is { Length: > 0 } a ? a : "https://api.github.com").TrimEnd('/');

    /* Every Mandarin Bridge Mandarin has seen, what it says of itself, and the build published for it; [fresh], asked
       of GitHub now, not as it was kept. */
    public static async Task<JsonObject> List(bool fresh = false)
    {
        if (fresh) lock (asked) asked.Clear();
        var tag = await Tag();
        var rows = await Task.WhenAll(Bridges().Select(r => Row(r, tag)));
        return new JsonObject { ["tag"] = tag, ["bridges"] = new JsonArray([.. rows]) };
    }

    /* Bridge [id] asked to update itself to the release: its answer, or the status and why not. */
    public static async Task<(int Status, JsonObject Body)> Apply(string id)
    {
        if (Bridges().FirstOrDefault(r => r.Id == id) is not { } rec) return (404, Err("No such Mandarin Bridge"));
        if (await Tag() is not { } tag) return (409, Err("No release of Mandarin Bridge is published yet"));
        var dac = await MandarinBridge.Probe(Base(rec));
        if (dac == null) return (409, Err("The Bridge isn't answering"));
        if (!Jv.T(dac["updates"])) return (409, Err(TooOld));
        using var req = new HttpRequestMessage(HttpMethod.Post, Base(rec) + "/update") { Content = new StringContent(new JsonObject { ["tag"] = tag }.ToJsonString(), System.Text.Encoding.UTF8, "application/json") };
        try
        {
            using var r = await Http.SendAsync(req);
            var body = JsonNode.Parse(await r.Content.ReadAsStringAsync()) as JsonObject ?? [];
            if (!r.IsSuccessStatusCode) return (409, Err((string?)body["error"] ?? "The Bridge refused"));
            Server.Log($"[bridges] {Name(rec)}: asked to update to {tag}");
            return (200, new JsonObject { ["ok"] = true, ["update"] = body });
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            return (409, Err("The Bridge didn't answer: " + e.Message));
        }
    }

    private const string TooOld = "This Bridge's app can't be updated from here: update it by hand this once";

    /* Every Mandarin Bridge Mandarin has seen (BridgeLogs.cs reads their logs), once each: devices at the same address are
       the one Bridge, as it was before its app was installed again (item 321), and the one seen last is it. */
    public static List<DeviceRecord> Bridges()
    {
        using var c = Db.Open();
        return [.. Register.All(c).Where(r => r.Caps["mandarin"] is JsObj mu && Jv.T(mu["base"]))
            .GroupBy(r => Base(r).ToLowerInvariant()).Select(g => g.MaxBy(r => r.LastSeen)!)];
    }

    /* What a Bridge's /dac.json says of [v]: "" where it says nothing (an older app's), never "undefined". */
    public static string Said(object? v) => Jv.Nullish(v) ? "" : Jv.Str(v);

    public static string Base(DeviceRecord r) => Jv.Str(((JsObj)r.Caps["mandarin"]!)["base"]).TrimEnd('/');
    public static string Name(DeviceRecord r) => r.Name ?? (r.NetworkName.Length > 0 ? r.NetworkName : r.Id);

    // One Bridge's row: what it says (its /dac.json), the build published for its machine, and whether they differ.
    private static async Task<JsonObject> Row(DeviceRecord rec, string? tag)
    {
        var dac = await MandarinBridge.Probe(Base(rec));
        var platform = dac == null ? null : Said(dac["platform"]) is { Length: > 0 } p ? p : "android";
        var commit = dac == null ? null : Said(dac["commit"]);
        var updates = dac != null && Jv.T(dac["updates"]);
        JsonObject? latest = null;
        if (dac != null && tag != null) latest = await Published(tag, platform == "android" ? "mandarin-bridge.apk" : $"mandarin-bridge-{Said(dac["arch"])}.tar.gz");
        var available = updates && latest != null && (string?)latest["commit"] is { Length: > 0 } c && c != commit;
        var why = dac == null ? "The Bridge isn't answering" : !updates ? TooOld : tag == null ? "No release of Mandarin Bridge is published yet"
            : latest == null ? "No build is published for this Bridge's machine" : null;
        return new JsonObject
        {
            ["id"] = rec.Id, ["name"] = Name(rec), ["platform"] = platform, ["version"] = dac == null ? null : Said(dac["version"]),
            ["commit"] = commit is { Length: > 0 } ? commit : null, ["reachable"] = dac != null, ["updates"] = updates,
            ["update"] = dac?["update"] is JsObj u && Tags.Js.Json(u) is { } text ? JsonNode.Parse(text) : null,
            ["latest"] = latest, ["available"] = available, ["why"] = why,
        };
    }

    // The release Mandarin's Bridges follow: "test-bridge" for a test build of Mandarin's, else the newest numbered one.
    private static async Task<string?> Tag()
    {
        if (System.Text.RegularExpressions.Regex.IsMatch(Server.Version, @"-t\d+$")) return "test-bridge";
        var list = await Get($"{Api}/repos/{Repo}/releases?per_page=30");
        return list?["list"] is JsonArray a
            ? a.OfType<JsonObject>().Select(x => (string?)x["tag_name"] ?? "").FirstOrDefault(t => t.StartsWith("mandarin-bridge-v", StringComparison.Ordinal))
            : null;
    }

    // The build published as [asset] in release [tag]: its sidecar ({commit, version, sha256}), or null.
    private static async Task<JsonObject?> Published(string tag, string asset)
    {
        var rel = await Get($"{Api}/repos/{Repo}/releases/tags/{tag}");
        var url = (rel?["assets"] as JsonArray ?? []).OfType<JsonObject>().FirstOrDefault(a => (string?)a["name"] == asset + ".json")?["browser_download_url"]?.ToString();
        if (url == null || await Get(url) is not { } side) return null;
        return new JsonObject { ["commit"] = (string?)side["commit"], ["version"] = (string?)side["version"] };
    }

    // [url]'s JSON (an array as { list }), kept a minute: Settings → Updates asks often, GitHub limits how often it is asked.
    private static async Task<JsonObject?> Get(string url)
    {
        lock (asked) if (asked.TryGetValue(url, out var was) && DateTime.UtcNow - was.At < TimeSpan.FromMinutes(1)) return was.Body;
        JsonObject? body = null;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.UserAgent.ParseAdd("mandarin-server");
            using var r = await Http.SendAsync(req);
            if (r.IsSuccessStatusCode)
                body = JsonNode.Parse(await r.Content.ReadAsStringAsync()) switch { JsonObject o => o, JsonArray a => new JsonObject { ["list"] = a.DeepClone() }, _ => null };
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException or UriFormatException) { body = null; }
        lock (asked) asked[url] = (DateTime.UtcNow, body);
        return body;
    }

    private static JsonObject Err(string message) => new() { ["error"] = message };
}
