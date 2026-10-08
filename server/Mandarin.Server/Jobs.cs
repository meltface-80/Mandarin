// Jobs.cs — the background work this server does in the Node server's place
// (v0.8.19): the identification scan with the MusicBrainz pack (Identify/),
// and measuring loudness (Identify/Loudness.cs).
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
using Mandarin.Server.Identify;

namespace Mandarin.Server;

internal static class Jobs
{
    public static readonly string[] Names = ["identify", "mbpack", "loudness"];

    public static Identifier? Identify { get; private set; }
    public static PackStore? Packs { get; private set; }
    public static Loudness? Loudness { get; private set; }

    private static Uri? upstream;
    private static string key = "";
    private static int port;
    private static volatile string? held;     // the Node server (its boot) this server holds the work from
    private static volatile string? seen;     // the Node server last seen
    private static int claiming;

    /* The work is this server's now: told to the Node server running now. */
    public static bool Held => Identify != null && held != null && held == seen;

    private static readonly HttpClient Http = new(new SocketsHttpHandler { UseProxy = false }) { Timeout = TimeSpan.FromSeconds(60) };

    private sealed record Claimed(string Boot, JsonObject Config);

    /* The Node server told: it stops its own and says how it was set up. */
    private static async Task<Claimed?> Claim()
    {
        if (upstream == null) return null;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, new Uri(upstream, "/internal/front/runs"))
            {
                Content = new StringContent(new JsonObject
                {
                    ["jobs"] = new JsonArray(Names.Select(n => (JsonNode)n).ToArray()),
                    // Where its requests to MusicBrainz ask for their turn (Identify/Lookups.cs).
                    ["url"] = "http://127.0.0.1:" + port
                }.ToJsonString(), Encoding.UTF8, "application/json")
            };
            req.Headers.Add("X-Mandarin-Front-Key", key);
            using var res = await Http.SendAsync(req);
            if (!res.IsSuccessStatusCode) { Front.Log($"[jobs] the Node server didn't hand over its work (HTTP {(int)res.StatusCode})"); return null; }
            var j = await res.Content.ReadFromJsonAsync<JsonObject>();
            if (j?["boot"] is not JsonValue b || !b.TryGetValue<string>(out var boot) || j["config"] is not JsonObject config) return null;
            return new Claimed(boot, config);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            Front.Log($"[jobs] the Node server didn't hand over its work ({e.Message})");
            return null;
        }
    }

    private static string? Text(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) && s.Length > 0 ? s : null;
    private static int Int(JsonNode? n, int d) => n is JsonValue v && v.TryGetValue<double>(out var x) && x > 0 ? (int)x : d;

    /* After the Node server is up: the work taken over, and started. */
    public static async Task Start(Uri node, string frontKey, int frontPort, string dataDir, string version)
    {
        upstream = node;
        key = frontKey;
        port = frontPort;
        Claimed? c = null;
        for (var i = 0; i < 10 && c == null; i++)
        {
            c = await Claim();
            if (c == null) await Task.Delay(TimeSpan.FromSeconds(1));
        }
        if (c == null)
        {
            Front.Log("[jobs] the identification scan and loudness measuring stay with the Node server");
            return;
        }
        var cfg = c.Config;
        void Log(string s) => Front.Log(s);
        Packs = new PackStore(dataDir, Text(cfg["mbpack_dir"]), Text(cfg["mbpack_url"]), Log);
        var packs = Packs;
        var mb = new PackFirst(new MusicBrainz(Text(cfg["musicbrainz_url"]), version), () => packs.Get());
        var itunes = new ITunes(Text(cfg["itunes_url"]), version, Log);
        Identify = new Identifier(mb, itunes, () => packs.Get(), Log, Int(cfg["identify_tick_ms"], 5000)) { Ready = () => Held };
        Loudness = new Loudness(Log, Int(cfg["loudness_tick_ms"], 5000)) { Ready = () => Held };
        held = c.Boot;
        seen ??= c.Boot;
        if (cfg["identify"] is JsonValue on && on.TryGetValue<bool>(out var yes) && yes) Identify.Start();
        Packs.Start();
        Loudness.Start();
        Front.Log("[jobs] the identification scan and loudness measuring are made here");
    }

    /* The Node server's state, seen (Library.cs): one started again is told again. */
    public static void Seen(string boot)
    {
        if (boot.Length == 0) return;
        seen = boot;
        if (Identify == null || held == boot || Interlocked.Exchange(ref claiming, 1) == 1) return;
        _ = Task.Run(async () =>
        {
            try
            {
                var c = await Claim();
                if (c != null) { held = c.Boot; Front.Log("[jobs] the Node server started again; its work stays here"); }
            }
            finally { Interlocked.Exchange(ref claiming, 0); }
        });
    }

    public static void Stop()
    {
        Identify?.Stop();
        Packs?.Stop();
        Loudness?.Stop();
    }
}
