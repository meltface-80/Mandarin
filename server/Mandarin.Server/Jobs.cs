// Jobs.cs — the server's background work, which it took from the Node server
// one part at a time (v0.8.19 on) and since v0.9.0 has had from its start:
// the identification scan with the MusicBrainz pack (Identify/), and measuring
// loudness (Identify/Loudness.cs); from v0.8.20 the record labels' lookups and
// logos, the release days after each library scan, and the taste work (Smart
// Picks, the share card's suggestions) (Extras/); from v0.8.22 the built-in
// Tailscale engine (Admin/Tailscale.cs); from v0.8.34 the library scans
// (Scans.cs); from v0.8.44 the month's prune of Qobuz's and Tidal's albums
// only ever played from the browser (Services/Rows.cs); from v0.8.45 their
// import, the favourites' watch and the service playlists (Services/Import.cs);
// from v0.8.47 their accounts (signing in and out, Tidal's token refreshed),
// their streams and playing an album from their browser (Services/Accounts.cs,
// ServiceStreams.cs): "services"; from v0.8.48 the in-app update
// (Admin/Updater.cs): "update", and the processor split (Cpu.cs): "cpu"; from
// v0.8.49 playback whole (Playback/Hub.cs): "playback". Set up from the
// environment (Config.cs). The routes the tests call are in Jobs.Internal.cs.
using System.Text.Json.Nodes;
using Mandarin.Server.Extras;
using Mandarin.Server.Identify;

namespace Mandarin.Server;

internal static partial class Jobs
{
    public static readonly string[] Names = ["identify", "mbpack", "loudness", "labels", "days", "taste", "tailscale", "scan", "prune", "import", "services", "update", "cpu", "playback"];

    public static Identifier? Identify { get; private set; }
    public static PackStore? Packs { get; private set; }
    public static Loudness? Loudness { get; private set; }
    public static ReleaseDays? Days { get; private set; }
    public static Taste? Taste { get; private set; }
    public static WriteUpSources? WriteUps { get; private set; }
    public static Admin.Tailscale? Tailscale { get; private set; }
    // The in-app update (v0.8.48, UpdateRoutes.cs).
    public static Admin.Updater? Updater { get; private set; }
    // The wall display's artist photos (v0.8.48, HousekeepingRoutes.cs): MusicBrainz for the act, FanArt.tv for its pictures, where each is asked.
    public static MusicBrainz? Mb { get; private set; }
    public static string FanartBase { get; private set; } = LabelLogos.FanartBase;
    // Last.fm (v0.8.26, LastfmRoutes.cs): where it is asked (LASTFM_URL), and the key from the environment (LASTFM_KEY).
    private static Lastfm? lastfm;
    public static Lastfm Lastfm => lastfm ??= NewLastfm(Environment.GetEnvironmentVariable("LASTFM_URL"));
    public static string? LastfmEnvKey { get; private set; } = Environment.GetEnvironmentVariable("LASTFM_KEY") is { Length: > 0 } ek ? ek : null;
    private static Lastfm NewLastfm(string? url) => new(url is { Length: > 0 } ? url : null, Library.LastfmKey, "Mandarin/" + Server.Version + " (+https://github.com/meltface-80/Mandarin)");
    // Headphone profiles (v0.8.26, DspRoutes.cs): where AutoEq is.
    public static AutoEq? AutoEq { get; private set; }
    // Qobuz's and Tidal's catalogue (v0.8.39, ServiceRoutes.cs): where each is asked.
    public static Services.QobuzCatalogue? Qobuz { get; private set; }
    public static Services.TidalCatalogue? Tidal { get; private set; }

    private static volatile HashSet<string> handed = [];

    /* The work is set up and running (Setup). */
    public static bool Held => Identify != null;
    /* One part of it (Names), this server's. */
    public static bool Holds(string job) => Held && handed.Contains(job);

    private static string? Text(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) && s.Length > 0 ? s : null;
    private static int Int(JsonNode? n, int d) => n is JsonValue v && v.TryGetValue<double>(out var x) && x > 0 ? (int)x : d;
    /* A pause that may be none (the tests' 0): the default only when it isn't said. */
    private static int Pause(JsonNode? n, int d) => n is JsonValue v && v.TryGetValue<double>(out var x) && x >= 0 ? (int)x : d;

    /*
     * Every job this server's from the start, set up from the environment
     * (Config.cs); the speakers found last time asked first, as index.js asked
     * them (sonosKnownHosts).
     */
    public static Task StartAlone(JsonObject cfg, string dataDir, int frontPort, string version)
    {
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
        return Setup(cfg, Names.ToHashSet(), dataDir, frontPort, version);
    }

    /* The work set up from [cfg] (the environment's) and started: [jobs] of it this server's. */
    private static async Task Setup(JsonObject cfg, HashSet<string> jobs, string dataDir, int frontPort, string version)
    {
        void Log(string s) => Server.Log(s);
        Packs = new PackStore(dataDir, Text(cfg["mbpack_dir"]), Text(cfg["mbpack_url"]), Log);
        var packs = Packs;
        var mb = new PackFirst(new MusicBrainz(Text(cfg["musicbrainz_url"]), version), () => packs.Get());
        var itunes = new ITunes(Text(cfg["itunes_url"]), version, Log);
        Identify = new Identifier(mb, itunes, () => packs.Get(), Log, Int(cfg["identify_tick_ms"], 5000)) { Ready = () => Held };
        Loudness = new Loudness(Log, Int(cfg["loudness_tick_ms"], 5000)) { Ready = () => Held, Identify = () => Identify };
        // Record labels, release days and the taste work (v0.8.20): MusicBrainz as
        // itself (no pack), Discogs, FanArt.tv and Deezer where the configuration says.
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
        // Qobuz's and Tidal's catalogue (v0.8.39): their addresses as set up (the tests' fakes).
        // Their albums' rows (v0.8.44): the covers kept in the data folder, beside the database. Tidal's sign-in (v0.8.47): where it is asked.
        Qobuz = new Services.QobuzCatalogue(Text(cfg["qobuz_url"])) { DataDir = dataDir };
        Tidal = new Services.TidalCatalogue(Text(cfg["tidal_url"]), Text(cfg["tidal_images_url"]), Text(cfg["tidal_auth_url"])) { DataDir = dataDir };
        // Kept (its answers and its spacing with it) unless Last.fm is asked elsewhere.
        if (NewLastfm(Text(cfg["lastfm_url"])) is var said && said.BaseUrl != Lastfm.BaseUrl) lastfm = said;
        // A record's write-up and links (v0.8.21): asked of MusicBrainz, Wikipedia, Pitchfork and Qobuz's site where the configuration says.
        WriteUps = new WriteUpSources(Text(cfg["musicbrainz_url"]), Text(cfg["wikipedia_url"]), Text(cfg["pitchfork_url"]), Text(cfg["qobuz_web_url"]), version);
        // Tailscale built in (v0.8.22): the engine, its folder and the port it serves.
        var watchdog = cfg["tailscale_watchdog"] as JsonObject;
        Tailscale = new Admin.Tailscale(
            Text(cfg["tailscale_bin"]) ?? (Environment.GetEnvironmentVariable("MUSICDNET_BIN") is { Length: > 0 } eb ? eb : "/usr/local/bin/musicdnet"),
            Text(cfg["tailscale_dir"]) ?? Path.Combine(dataDir, "tailscale"), Int(cfg["tailscale_port"], frontPort), version, Log,
            Int(watchdog?["rebindMs"], 60000), Int(watchdog?["restartMs"], 240000));
        // The in-app update (v0.8.48): where GitHub is asked.
        Updater?.Stop();
        Updater = new Admin.Updater(cfg, Environment.GetEnvironmentVariable("MANDARIN_APP_DIR") ?? Server.FindAppDir(), version, Log);
        handed = jobs;
        if (handed.Contains("update")) Updater.Start();
        // The processor split (v0.8.48): decided here.
        if (handed.Contains("cpu")) Cpu.StartDeciding(); else Cpu.StopDeciding();
        if (cfg["identify"] is JsonValue on && on.TryGetValue<bool>(out var yes) && yes) Identify.Start();
        Packs.Start();
        Loudness.Start();
        Taste.Start();
        if (handed.Contains("tailscale")) _ = Tailscale.Start();
        if (handed.Contains("scan")) Scans.Start(cfg, dataDir);
        // Playback whole (v0.8.49, stage 6): the hub.
        if (handed.Contains("playback")) await Playback.Hub.Start(Playback.HubConfig.Of(cfg, dataDir, frontPort), Log); else Playback.Hub.Stop();
        // The month's prune of the services' albums only ever played from the browser (v0.8.44): daily.
        Services.Prune.Start();
        // Their import and the favourites' watch (v0.8.45): on the Node server's timers.
        Services.Import.Start(cfg);
        Server.Log("[jobs] made here: " + string.Join(", ", Names.Where(handed.Contains)));
        // A library scan that ended before the work was set up: what follows it, made now.
        _ = Task.Run(async () =>
        {
            if (await Library.CurrentState() is var (_, st) && !st.Scanning) await AfterScan();
        });
    }

    /* After a library scan (Scans.cs; the tests' /internal/jobs/after-scan): the release days, and today's Smart Picks. */
    public static async Task AfterScan()
    {
        try
        {
            if (Holds("days") && Days is { } d) _ = d.Run();
            if (Holds("taste") && Taste is { } t && await Library.CurrentCopy() is { } s) t.Kick(s, false);
        }
        catch (Exception e) { Server.Log($"[jobs] after the scan: {e.GetType().Name}: {e.Message}"); }
    }

    /*
     * This program started again in its own process (Program.cs), as Restart
     * from Settings does: a backup put back (a staged database swapped in as it
     * starts), or an update put in place (v0.8.48, Admin/Updater.cs).
     */
    public static async Task Restart()
    {
        // A scan under way ended first: the database it writes is about to be put back.
        Scans.Halt();
        // The services' import and watch likewise, at their next album (v0.8.45).
        await Services.Import.HaltRuns();
        if (Server.LeaveBy(Server.Leave.Restart)) Server.StopApp?.Invoke();
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
