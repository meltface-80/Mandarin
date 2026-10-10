// Jobs.cs — the background work this server does in the Node server's place
// (v0.8.19): the identification scan with the MusicBrainz pack (Identify/),
// and measuring loudness (Identify/Loudness.cs); from v0.8.20 the record
// labels' lookups and logos, the release days after each library scan, and
// the taste work (Smart Picks, the share card's suggestions) (Extras/); from
// v0.8.22 the built-in Tailscale engine (Admin/Tailscale.cs), which stays up
// while the Node server starts again; from v0.8.34 the library scans (Scans.cs).
//
// The Node server is told so before any of it starts (POST
// /internal/front/runs): it stops its own loops — waiting for an album it is
// in the middle of — and answers with the settings it was started with (where
// MusicBrainz, iTunes and the pack are asked; how often), which the tests
// give it rather than this server. A Node server started again behind this
// one (an update, Restart) is told again before anything more is done, so the
// two never work on the same album at once.
//
// Until the Node server has said yes, the pages for this work are its own.
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Mandarin.Server.Extras;
using Mandarin.Server.Identify;

namespace Mandarin.Server;

internal static class Jobs
{
    public static readonly string[] Names = ["identify", "mbpack", "loudness", "labels", "days", "taste", "tailscale", "scan"];
    // What a Node server from before v0.8.20 hands over: it doesn't say which.
    private static readonly string[] FirstNames = ["identify", "mbpack", "loudness"];

    public static Identifier? Identify { get; private set; }
    public static PackStore? Packs { get; private set; }
    public static Loudness? Loudness { get; private set; }
    public static ReleaseDays? Days { get; private set; }
    public static Taste? Taste { get; private set; }
    public static WriteUpSources? WriteUps { get; private set; }
    public static Admin.Tailscale? Tailscale { get; private set; }
    // Last.fm (v0.8.26, LastfmRoutes.cs): where it is asked, and the key the Node server was started with (LASTFM_KEY).
    public static Lastfm? Lastfm { get; private set; }
    public static string? LastfmEnvKey { get; private set; }
    // Headphone profiles (v0.8.26, DspRoutes.cs): where AutoEq is.
    public static AutoEq? AutoEq { get; private set; }

    private static Uri? upstream;
    private static string key = "";
    private static int port;
    private static volatile string? held;     // the Node server (its boot) this server holds the work from
    private static volatile string? seen;     // the Node server last seen
    private static int claiming;
    private static volatile bool refused;   // the Node server said no: of another version (v0.8.25)
    private static (Uri Node, string Key, int Port, string DataDir, string Version)? startedWith;

    private static volatile HashSet<string> handed = [];

    /* The work is this server's now: told to the Node server running now. */
    public static bool Held => Identify != null && held != null && held == seen;
    /* One part of it (Names), handed over by the Node server running now. */
    public static bool Holds(string job) => Held && handed.Contains(job);

    private static readonly HttpClient Http = new(new SocketsHttpHandler { UseProxy = false }) { Timeout = TimeSpan.FromSeconds(60) };

    private sealed record Claimed(string Boot, JsonObject Config, HashSet<string> Jobs);

    /* The Node server told: it stops its own and says how it was set up. */
    private static async Task<Claimed?> Claim()
    {
        if (upstream == null) return null;
        refused = false;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, new Uri(upstream, "/internal/front/runs"))
            {
                Content = new StringContent(new JsonObject
                {
                    ["jobs"] = new JsonArray(Names.Select(n => (JsonNode)n).ToArray()),
                    // This program's version: a Node server of another keeps its work (v0.8.25).
                    ["version"] = Front.Version,
                    // Where its requests to MusicBrainz ask for their turn (Identify/Lookups.cs).
                    ["url"] = "http://127.0.0.1:" + port
                }.ToJsonString(), Encoding.UTF8, "application/json")
            };
            req.Headers.Add("X-Mandarin-Front-Key", key);
            using var res = await Http.SendAsync(req);
            if (res.StatusCode == System.Net.HttpStatusCode.Conflict)
            {
                // Another version (Front.cs): asked again once the two match, not before.
                refused = true;
                Front.Log("[jobs] the Node server is of another version: its background work stays with it");
                return null;
            }
            if (!res.IsSuccessStatusCode) { Front.Log($"[jobs] the Node server didn't hand over its work (HTTP {(int)res.StatusCode})"); return null; }
            var j = await res.Content.ReadFromJsonAsync<JsonObject>();
            if (j?["boot"] is not JsonValue b || !b.TryGetValue<string>(out var boot) || j["config"] is not JsonObject config) return null;
            var jobs = j["jobs"] is JsonArray a ? a.Select(Text).OfType<string>().Where(Names.Contains).ToHashSet() : FirstNames.ToHashSet();
            return new Claimed(boot, config, jobs);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            Front.Log($"[jobs] the Node server didn't hand over its work ({e.Message})");
            return null;
        }
    }

    private static string? Text(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) && s.Length > 0 ? s : null;
    private static int Int(JsonNode? n, int d) => n is JsonValue v && v.TryGetValue<double>(out var x) && x > 0 ? (int)x : d;
    /* A pause that may be none (the tests' 0): the default only when it isn't said. */
    private static int Pause(JsonNode? n, int d) => n is JsonValue v && v.TryGetValue<double>(out var x) && x >= 0 ? (int)x : d;

    /* After the Node server is up: the work taken over, and started. */
    public static async Task Start(Uri node, string frontKey, int frontPort, string dataDir, string version)
    {
        startedWith = (node, frontKey, frontPort, dataDir, version);
        upstream = node;
        key = frontKey;
        port = frontPort;
        Claimed? c = null;
        for (var i = 0; i < 10 && c == null && !refused; i++)
        {
            c = await Claim();
            if (c == null && !refused) await Task.Delay(TimeSpan.FromSeconds(1));
        }
        if (c == null)
        {
            Front.Log("[jobs] the Node server's background work stays with it");
            return;
        }
        var cfg = c.Config;
        void Log(string s) => Front.Log(s);
        Packs = new PackStore(dataDir, Text(cfg["mbpack_dir"]), Text(cfg["mbpack_url"]), Log);
        var packs = Packs;
        var mb = new PackFirst(new MusicBrainz(Text(cfg["musicbrainz_url"]), version), () => packs.Get());
        var itunes = new ITunes(Text(cfg["itunes_url"]), version, Log);
        Identify = new Identifier(mb, itunes, () => packs.Get(), Log, Int(cfg["identify_tick_ms"], 5000)) { Ready = () => Held };
        Loudness = new Loudness(Log, Int(cfg["loudness_tick_ms"], 5000)) { Ready = () => Held, Identify = () => Identify };
        // Record labels, release days and the taste work (v0.8.20): MusicBrainz as
        // itself (no pack), Discogs, FanArt.tv and Deezer where the Node server says.
        var labelsMb = new MusicBrainz(Text(cfg["musicbrainz_url"]), version);
        var pause = Pause(cfg["logo_pause_ms"], 1100);
        Labels.Lookup = new LabelLookup(labelsMb, Text(cfg["discogs_url"]), pause, version, Log) { Ready = () => Holds("labels"), OnDone = Library.AfterLookups };
        Labels.Logos = new LabelLogos(dataDir, labelsMb, Text(cfg["discogs_url"]), Text(cfg["fanart_url"]), pause, version, Log) { Ready = () => Holds("labels") };
        Days = new ReleaseDays(Text(cfg["musicbrainz_url"]), version, Log) { Ready = () => Holds("days") };
        Taste = new Taste(Text(cfg["deezer_url"]), Log) { Ready = () => Holds("taste") };
        // Headphone profiles and Last.fm (v0.8.26): where AutoEq and Last.fm are, and the environment's Last.fm key.
        AutoEq = new AutoEq(Text(cfg["autoeq_url"]), Log);
        LastfmEnvKey = Text(cfg["lastfm_key"]);
        Lastfm = new Lastfm(Text(cfg["lastfm_url"]), Library.LastfmKey, "Mandarin/" + version + " (+https://github.com/meltface-80/Mandarin)");
        // A record's write-up and links (v0.8.21): asked of MusicBrainz, Wikipedia, Pitchfork and Qobuz's site where the Node server says.
        WriteUps = new WriteUpSources(Text(cfg["musicbrainz_url"]), Text(cfg["wikipedia_url"]), Text(cfg["pitchfork_url"]), Text(cfg["qobuz_web_url"]), version);
        // Tailscale built in (v0.8.22): the engine, its folder and the port it serves, as the Node server was set up.
        var watchdog = cfg["tailscale_watchdog"] as JsonObject;
        Tailscale = new Admin.Tailscale(
            Text(cfg["tailscale_bin"]) ?? (Environment.GetEnvironmentVariable("MUSICDNET_BIN") is { Length: > 0 } eb ? eb : "/usr/local/bin/musicdnet"),
            Text(cfg["tailscale_dir"]) ?? Path.Combine(dataDir, "tailscale"), Int(cfg["tailscale_port"], frontPort), version, Log,
            Int(watchdog?["rebindMs"], 60000), Int(watchdog?["restartMs"], 240000));
        handed = c.Jobs;
        held = c.Boot;
        seen ??= c.Boot;
        if (cfg["identify"] is JsonValue on && on.TryGetValue<bool>(out var yes) && yes) Identify.Start();
        Packs.Start();
        Loudness.Start();
        Taste.Start();
        if (handed.Contains("tailscale")) _ = Tailscale.Start();
        if (handed.Contains("scan")) Scans.Start(cfg, dataDir);
        Front.Log("[jobs] made here: " + string.Join(", ", Names.Where(handed.Contains)));
        // A library scan that ended before the Node server said yes: what follows it, made now.
        _ = Task.Run(async () =>
        {
            if (await Library.CurrentState() is var (_, st) && !st.Scanning) await AfterScan();
        });
    }

    /* After a library scan (the Node server says, /internal/jobs/after-scan): the release days, and today's Smart Picks. */
    public static async Task AfterScan()
    {
        try
        {
            if (Holds("days") && Days is { } d) _ = d.Run();
            if (Holds("taste") && Taste is { } t && await Library.CurrentCopy() is { } s) t.Kick(s, false);
        }
        catch (Exception e) { Front.Log($"[jobs] after the scan: {e.GetType().Name}: {e.Message}"); }
    }

    /*
     * From this machine, with the front key: POST /internal/jobs/after-scan (the
     * Node server, a library scan ended), POST /internal/jobs/taste (the taste
     * graph built again now, from the plays as they are; the tests, after
     * writing plays: it is otherwise built once a day), and GET
     * /internal/tailscale (how the engine run here is: the Node server gives
     * phones its address).
     */
    public static void UseInternal(WebApplication app)
    {
        app.Use(async (ctx, next) =>
        {
            var p = ctx.Request.Path.Value;
            if (p is not ("/internal/jobs/after-scan" or "/internal/jobs/taste" or "/internal/tailscale")) { await next(); return; }
            var from = ctx.Connection.RemoteIpAddress;
            var given = ctx.Request.Headers["X-Mandarin-Front-Key"].ToString();
            var method = p == "/internal/tailscale" ? HttpMethods.IsGet(ctx.Request.Method) : HttpMethods.IsPost(ctx.Request.Method);
            if (from == null || !System.Net.IPAddress.IsLoopback(from) || !method
                || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(given), Encoding.UTF8.GetBytes(key)))
            {
                ctx.Response.StatusCode = 404;
                return;
            }
            ctx.Response.ContentType = "application/json";
            if (p == "/internal/tailscale")
            {
                await ctx.Response.WriteAsync(Tailscale is { } t0 && Holds("tailscale") ? Tags.Js.Json(t0.Status()) ?? "{}" : "{\"handed\":false}");
                return;
            }
            if (p == "/internal/jobs/after-scan")
            {
                await AfterScan();
                await ctx.Response.WriteAsync("{\"ok\":true}");
                return;
            }
            if (!Holds("taste") || Taste is not { } t) { ctx.Response.StatusCode = 409; await ctx.Response.WriteAsync("{\"ok\":false}"); return; }
            var b = await t.Rebuild();
            var near = new JsonObject();
            foreach (var (k, v) in b.Graph) near[k] = v.Score;
            await ctx.Response.WriteAsync(new JsonObject
            {
                ["ok"] = true, ["day"] = b.Day, ["near"] = near,
                ["heavy"] = new JsonArray(b.Heavy.Select(h => (JsonNode)h).ToArray()),
                ["played"] = new JsonArray(b.Played.Select(h => (JsonNode)h).ToArray())
            }.ToJsonString());
        });
    }

    /* The Node server's state, seen (Library.cs): one started again is told again. */
    public static void Seen(string boot)
    {
        if (boot.Length == 0) return;
        seen = boot;
        // Turned down at the start, the Node server of another version then: taken
        // over now that one of this version has started (v0.8.25).
        if (Identify == null && refused && Front.Matched && startedWith is { } w)
        {
            if (Interlocked.Exchange(ref claiming, 1) == 1) return;
            _ = Task.Run(async () =>
            {
                try { await Start(w.Node, w.Key, w.Port, w.DataDir, w.Version); }
                finally { Interlocked.Exchange(ref claiming, 0); }
            });
            return;
        }
        if (Identify == null || held == boot || Interlocked.Exchange(ref claiming, 1) == 1) return;
        _ = Task.Run(async () =>
        {
            try
            {
                var c = await Claim();
                if (c != null)
                {
                    handed = c.Jobs;
                    held = c.Boot;
                    // A Node server that runs Tailscale itself again (an older one, put back): it's its.
                    if (!handed.Contains("tailscale")) Tailscale?.Stop();
                    // The library scans: one now, as one started with the Node server — or its own again.
                    if (handed.Contains("scan") && startedWith is { } w) Scans.Start(c.Config, w.DataDir);
                    else Scans.Stop();
                    Front.Log("[jobs] the Node server started again; its work stays here");
                }
            }
            finally { Interlocked.Exchange(ref claiming, 0); }
        });
    }

    /* The Node server started again (a restore: it reads everything afresh, and swaps in a staged database). */
    public static async Task RestartNode()
    {
        if (upstream == null) return;
        // A scan under way ended first: the database it writes is about to be put back.
        Scans.Halt();
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, new Uri(upstream, "/internal/front/restart"));
            req.Headers.Add("X-Mandarin-Front-Key", key);
            using var res = await Http.SendAsync(req);
            if (!res.IsSuccessStatusCode) Front.Log($"[jobs] the Node server didn't restart (HTTP {(int)res.StatusCode})");
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException) { Front.Log($"[jobs] the Node server didn't restart ({e.Message})"); }
    }

    public static void Stop()
    {
        Scans.Stop();
        Tailscale?.Stop();
        Identify?.Stop();
        Packs?.Stop();
        Loudness?.Stop();
        Days?.Stop();
        Taste?.Stop();
    }
}
