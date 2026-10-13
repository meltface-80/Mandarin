// Jobs.cs — the background work this server does in the Node server's place
// (v0.8.19): the identification scan with the MusicBrainz pack (Identify/),
// and measuring loudness (Identify/Loudness.cs); from v0.8.20 the record
// labels' lookups and logos, the release days after each library scan, and
// the taste work (Smart Picks, the share card's suggestions) (Extras/); from
// v0.8.22 the built-in Tailscale engine (Admin/Tailscale.cs), which stays up
// while the Node server starts again; from v0.8.34 the library scans (Scans.cs);
// from v0.8.44 the month's prune of Qobuz's and Tidal's albums only ever played
// from the browser (Services/Rows.cs); from v0.8.45 their import, the
// favourites' watch and the service playlists (Services/Import.cs); from
// v0.8.47 their accounts (signing in and out, Tidal's token refreshed here
// alone), their streams and playing an album from their browser
// (Services/Accounts.cs, ServiceStreams.cs): "services"; from v0.8.48 the
// in-app update (Admin/Updater.cs): "update", and the processor split, decided
// here and sent to the Node server (Cpu.cs): "cpu"; from v0.8.49 playback whole
// (Playback/Hub.cs): "playback". The routes the Node server and the tests call
// are in Jobs.Internal.cs.
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

internal static partial class Jobs
{
    public static readonly string[] Names = ["identify", "mbpack", "loudness", "labels", "days", "taste", "tailscale", "scan", "prune", "import", "services", "update", "cpu", "playback"];
    // What a Node server from before v0.8.20 hands over: it doesn't say which.
    private static readonly string[] FirstNames = ["identify", "mbpack", "loudness"];

    public static Identifier? Identify { get; private set; }
    public static PackStore? Packs { get; private set; }
    public static Loudness? Loudness { get; private set; }
    public static ReleaseDays? Days { get; private set; }
    public static Taste? Taste { get; private set; }
    public static WriteUpSources? WriteUps { get; private set; }
    public static Admin.Tailscale? Tailscale { get; private set; }
    // The in-app update (v0.8.48, UpdateRoutes.cs), once handed over.
    public static Admin.Updater? Updater { get; private set; }
    // The wall display's artist photos (v0.8.48, HousekeepingRoutes.cs): MusicBrainz for the act, FanArt.tv for its pictures, where each is asked.
    public static MusicBrainz? Mb { get; private set; }
    public static string FanartBase { get; private set; } = LabelLogos.FanartBase;
    // Last.fm (v0.8.26, LastfmRoutes.cs): where it is asked, and the key from the environment (LASTFM_KEY).
    // This server's own from its start (v0.8.48: LASTFM_URL, LASTFM_KEY, the same container's), so its
    // routes never wait for the hand-over; the Node server's word (a test's stand-in, a key it was
    // given) takes over when it comes.
    private static Lastfm? lastfm;
    public static Lastfm Lastfm => lastfm ??= NewLastfm(Environment.GetEnvironmentVariable("LASTFM_URL"));
    public static string? LastfmEnvKey { get; private set; } = Environment.GetEnvironmentVariable("LASTFM_KEY") is { Length: > 0 } ek ? ek : null;
    private static Lastfm NewLastfm(string? url) => new(url is { Length: > 0 } ? url : null, Library.LastfmKey, "Mandarin/" + Front.Version + " (+https://github.com/meltface-80/Mandarin)");
    // Headphone profiles (v0.8.26, DspRoutes.cs): where AutoEq is.
    public static AutoEq? AutoEq { get; private set; }
    // Qobuz's and Tidal's catalogue (v0.8.39, ServiceRoutes.cs): where each is asked.
    public static Services.QobuzCatalogue? Qobuz { get; private set; }
    public static Services.TidalCatalogue? Tidal { get; private set; }

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
        await Setup(c.Config, c.Jobs, c.Boot, dataDir, frontPort, version);
    }

    /*
     * No Node server behind this one (v0.8.50, stage 7): every job this
     * server's from the start, set up from the environment (Config.cs) as the
     * hand-over set it up; the speakers found last time asked first, as
     * index.js asked them (sonosKnownHosts).
     */
    public static Task StartAlone(JsonObject cfg, string frontKey, int frontPort, string dataDir, string version)
    {
        startedWith = null;
        upstream = null;
        key = frontKey;
        port = frontPort;
        try
        {
            using var c = Db.Open();
            if (Db.Setting(c, "sonosKnownHosts") is JsonArray known)
            {
                if (cfg["sonos_hosts"] is not JsonArray hosts) cfg["sonos_hosts"] = hosts = [];
                foreach (var h in known) if (Text(h) is { } ip && !hosts.Any(x => Text(x) == ip)) hosts.Add(ip);
            }
        }
        catch (Microsoft.Data.Sqlite.SqliteException) { /* as none known */ }
        return Setup(cfg, Names.ToHashSet(), "alone", dataDir, frontPort, version);
    }

    /* The work set up from [cfg] (the hand-over's, or the environment's) and started: [jobs] of it this server's, from the Node server of [boot]. */
    private static async Task Setup(JsonObject cfg, HashSet<string> jobs, string boot, string dataDir, int frontPort, string version)
    {
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
        Mb = new MusicBrainz(Text(cfg["musicbrainz_url"]), version);
        FanartBase = (Text(cfg["fanart_url"]) ?? LabelLogos.FanartBase).TrimEnd('/');
        var pause = Pause(cfg["logo_pause_ms"], 1100);
        Labels.Lookup = new LabelLookup(labelsMb, Text(cfg["discogs_url"]), pause, version, Log) { Ready = () => Holds("labels"), OnDone = Library.AfterLookups };
        Labels.Logos = new LabelLogos(dataDir, labelsMb, Text(cfg["discogs_url"]), Text(cfg["fanart_url"]), pause, version, Log) { Ready = () => Holds("labels") };
        Days = new ReleaseDays(Text(cfg["musicbrainz_url"]), version, Log) { Ready = () => Holds("days") };
        Taste = new Taste(Text(cfg["deezer_url"]), Log) { Ready = () => Holds("taste") };
        // Headphone profiles and Last.fm (v0.8.26): where AutoEq and Last.fm are, and the environment's Last.fm key.
        AutoEq = new AutoEq(Text(cfg["autoeq_url"]), Log);
        LastfmEnvKey = Text(cfg["lastfm_key"]);
        // Qobuz's and Tidal's catalogue (v0.8.39): their addresses as the Node server was set up (the tests' fakes).
        // Their albums' rows (v0.8.44): the covers kept in the data folder, beside the database. Tidal's sign-in (v0.8.47): where it is asked.
        Qobuz = new Services.QobuzCatalogue(Text(cfg["qobuz_url"])) { DataDir = dataDir };
        Tidal = new Services.TidalCatalogue(Text(cfg["tidal_url"]), Text(cfg["tidal_images_url"]), Text(cfg["tidal_auth_url"])) { DataDir = dataDir };
        // Kept (its answers and its spacing with it) unless the Node server asks Last.fm elsewhere.
        if (NewLastfm(Text(cfg["lastfm_url"])) is var said && said.BaseUrl != Lastfm.BaseUrl) lastfm = said;
        // A record's write-up and links (v0.8.21): asked of MusicBrainz, Wikipedia, Pitchfork and Qobuz's site where the Node server says.
        WriteUps = new WriteUpSources(Text(cfg["musicbrainz_url"]), Text(cfg["wikipedia_url"]), Text(cfg["pitchfork_url"]), Text(cfg["qobuz_web_url"]), version);
        // Tailscale built in (v0.8.22): the engine, its folder and the port it serves, as the Node server was set up.
        var watchdog = cfg["tailscale_watchdog"] as JsonObject;
        Tailscale = new Admin.Tailscale(
            Text(cfg["tailscale_bin"]) ?? (Environment.GetEnvironmentVariable("MUSICDNET_BIN") is { Length: > 0 } eb ? eb : "/usr/local/bin/musicdnet"),
            Text(cfg["tailscale_dir"]) ?? Path.Combine(dataDir, "tailscale"), Int(cfg["tailscale_port"], frontPort), version, Log,
            Int(watchdog?["rebindMs"], 60000), Int(watchdog?["restartMs"], 240000));
        // The in-app update (v0.8.48): where GitHub is asked and whether the Node server runs under its launcher, as it was set up.
        Updater?.Stop();
        Updater = new Admin.Updater(cfg, Environment.GetEnvironmentVariable("MANDARIN_APP_DIR") ?? Front.FindAppDir(), version, Log);
        handed = jobs;
        held = boot;
        seen ??= boot;
        if (handed.Contains("update")) Updater.Start();
        // The processor split (v0.8.48): decided here from now on (the Node server's DSP conversions
        // under way counted from the start), the Node server told; else its own, followed as before.
        if (handed.Contains("cpu")) Cpu.StartDeciding(Pause(cfg["cpu_dsp"], 0)); else Cpu.StopDeciding();
        if (cfg["identify"] is JsonValue on && on.TryGetValue<bool>(out var yes) && yes) Identify.Start();
        Packs.Start();
        Loudness.Start();
        Taste.Start();
        if (handed.Contains("tailscale")) _ = Tailscale.Start();
        if (handed.Contains("scan")) Scans.Start(cfg, dataDir);
        // Playback whole (v0.8.49, stage 6): the hub here from now on, set up as the Node server's was.
        if (handed.Contains("playback")) await Playback.Hub.Start(Playback.HubConfig.Of(cfg, dataDir, frontPort), Log); else Playback.Hub.Stop();
        // The month's prune of the services' albums only ever played from the browser (v0.8.44): daily, while handed over.
        Services.Prune.Start();
        // Their import and the favourites' watch (v0.8.45): on the Node server's timers, while handed over.
        Services.Import.Start(cfg);
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
                    // Playback: the hub here stays as it is (the Node server started again never starts its own); started now if it wasn't.
                    if (handed.Contains("playback")) { if (Playback.Hub.Current == null && startedWith is { } hw) _ = Playback.Hub.Start(Playback.HubConfig.Of(c.Config, hw.DataDir, hw.Port), Front.Log); }
                    else Playback.Hub.Stop();
                    // The services' import: its first run after the Node server's start, as there.
                    Services.Import.Start(c.Config);
                    // The in-app update: the checks go on here (or not, for a Node server that keeps them).
                    if (handed.Contains("update")) Updater?.Start(); else Updater?.Stop();
                    // The processor split: the Node server started again is sent it, or decides again itself.
                    if (handed.Contains("cpu")) Cpu.StartDeciding(Pause(c.Config["cpu_dsp"], 0)); else Cpu.StopDeciding();
                    Front.Log("[jobs] the Node server started again; its work stays here");
                }
                else if (refused)
                {
                    // The Node server started again is of another version (its files updated
                    // from Settings before this program is): its work is its own, the new
                    // way, until the C# server of its version starts (Front.cs, code 76).
                    // Nothing is answered or decided for it here meanwhile, and nothing
                    // asked of GitHub twice.
                    handed = [];
                    held = boot;
                    Cpu.StopDeciding();
                    Updater?.Stop();
                    Scans.Stop();
                    Playback.Hub.Stop();
                    Front.Log("[jobs] the Node server started again is of another version; its work stays with it");
                }
            }
            finally { Interlocked.Exchange(ref claiming, 0); }
        });
    }

    /*
     * The Node server started again: a restore (it reads everything afresh,
     * and swaps in a staged database), or an update staged for its launcher
     * to lay in (v0.8.48, [why] "update": its launcher applies it, Admin/Updater.cs).
     */
    public static async Task RestartNode(string why = "backup")
    {
        if (upstream == null && !Front.Alone) return;
        // A scan under way ended first: the database it writes is about to be put back.
        Scans.Halt();
        // The services' import and watch likewise, at their next album (v0.8.45).
        await Services.Import.HaltRuns();
        // No Node server: this program starts again in its own process (Program.cs, as Restart from Settings does).
        if (upstream == null) { if (Front.LeaveBy(Front.Leave.Restart)) Front.StopApp?.Invoke(); return; }
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, new Uri(upstream, "/internal/front/restart" + (why == "update" ? "?why=update" : "")));
            req.Headers.Add("X-Mandarin-Front-Key", key);
            using var res = await Http.SendAsync(req);
            if (!res.IsSuccessStatusCode) Front.Log($"[jobs] the Node server didn't restart (HTTP {(int)res.StatusCode})");
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException) { Front.Log($"[jobs] the Node server didn't restart ({e.Message})"); }
    }

    public static void Stop()
    {
        Playback.Hub.Stop();
        Updater?.Stop();
        Scans.Stop();
        Services.Prune.Stop();
        Services.Import.Stop();
        // What was playing from Qobuz reported over (v0.8.47), as the Node server's stop did: a few seconds at most.
        try { Qobuz?.Stop().Wait(TimeSpan.FromSeconds(5)); } catch (AggregateException) { /* reported or not, stopping */ }
        Tailscale?.Stop();
        Identify?.Stop();
        Packs?.Stop();
        Loudness?.Stop();
        Days?.Stop();
        Taste?.Stop();
    }
}
