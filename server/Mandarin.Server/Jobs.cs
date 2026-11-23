// Jobs.cs — the server's background work, which it took from the Node server
// one part at a time (v0.8.19 on) and since v0.9.0 has had from its start:
// the identification scan with the MusicBrainz pack (Identify/), and measuring
// loudness (Identify/Loudness.cs); from v0.8.20 the release days after each library scan, and the taste work (Smart
// Picks, the share card's suggestions) (Extras/); from v0.8.22 the built-in
// Tailscale engine (Admin/Tailscale.cs); from v0.8.34 the library scans
// (Scans.cs); from v0.8.44 the month's prune of Qobuz's and Tidal's albums
// only ever played from the browser (Services/Rows.cs); from v0.8.45 their
// import and the favourites' watch (Services/Import.cs);
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
    public static readonly string[] Names = ["identify", "mbpack", "loudness", "days", "taste", "tailscale", "scan", "prune", "import", "services", "update", "cpu", "playback", "covers"];

    public static Identifier? Identify { get; private set; }
    public static PackStore? Packs { get; private set; }
    public static Loudness? Loudness { get; private set; }
    // Each track looked at for MQA's signalling after the scan (item 418, Mqa/MqaPass.cs).
    public static Mqa.MqaPass? MqaPass { get; private set; }
    public static ReleaseDays? Days { get; private set; }
    public static Taste? Taste { get; private set; }
    public static WriteUpSources? WriteUps { get; private set; }
    public static Admin.Tailscale? Tailscale { get; private set; }
    // The in-app update (v0.8.48, UpdateRoutes.cs).
    public static Admin.Updater? Updater { get; private set; }
    // The wall display's artist photos (v0.8.48, HousekeepingRoutes.cs): MusicBrainz for the act, FanArt.tv for its pictures, where each is asked.
    public static MusicBrainz? Mb { get; private set; }
    public static string FanartBase { get; private set; } = Fanart.Base;
    // Headphone profiles (v0.8.26, DspRoutes.cs): where AutoEq is.
    public static AutoEq? AutoEq { get; private set; }
    // Qobuz's and Tidal's catalogue (v0.8.39, ServiceRoutes.cs): where each is asked.
    public static Services.QobuzCatalogue? Qobuz { get; private set; }
    public static Services.TidalCatalogue? Tidal { get; private set; }
    // iBroadcast (item 443, Services/IBroadcast/): where it is asked (the tests' stand-in).
    public static Services.IBroadcast.IBroadcast? IBroadcast { get; private set; }
    // Its library in Mandarin's (item 444): read when iBroadcast says it changed.
    public static Services.IBroadcast.IBroadcastLibrary? IBroadcastLibrary { get; private set; }
    // Its tracks played, as a service's are (item 445).
    public static Services.IBroadcast.IBroadcastStreams? IBroadcastStreams { get; private set; }
    // Its upload (item 446): the limit on a file (the tests' smaller), and the waits for a busy iBroadcast (the tests' shorter).
    public static Services.IBroadcast.IBroadcastUpload? IBroadcastUpload { get; private set; }
    // And on a schedule, never at the Library Scanner's hours (item 447): the clock looked at (the tests' more often).
    public static Services.IBroadcast.IBroadcastSchedule? IBroadcastSchedule { get; private set; }

    private static volatile bool started;

    /* The work is set up and running (Setup). */
    public static bool Held => Identify != null;
    /* One part of it (Names), started: every part is this server's since v0.9.0. */
    public static bool Holds(string job) => started && Names.Contains(job);

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
        return Setup(cfg, dataDir, frontPort, version);
    }

    /* The work set up from [cfg] (the environment's) and started, every part of it. */
    private static async Task Setup(JsonObject cfg, string dataDir, int frontPort, string version)
    {
        void Log(string s) => Server.Log(s);
        Packs = new PackStore(dataDir, Text(cfg["mbpack_dir"]), Text(cfg["mbpack_url"]), Log);
        var packs = Packs;
        var mb = new PackFirst(new MusicBrainz(Text(cfg["musicbrainz_url"]), version), () => packs.Get());
        var itunes = new ITunes(Text(cfg["itunes_url"]), version, Log);
        // AcoustID, for the albums still unsure (item 414c): where it is asked (ACOUSTID_URL), with the key in Settings.
        Identify = new Identifier(mb, itunes, () => packs.Get(), Log, Int(cfg["identify_tick_ms"], 5000))
            { Ready = () => Held, Sound = new AcoustId(Environment.GetEnvironmentVariable("ACOUSTID_URL"), version) };
        packs.Installed += () => _ = Identify?.PackUpdated();   // a new pack: what it may place looked at again (item 414b)
        // Measured with the Album Scanner on (item 411), except while the tests keep to this machine and haven't asked for it (loudness: true).
        var measureHere = !Lookups.LoopbackOnly || (cfg["loudness"] is JsonValue lo && lo.TryGetValue<bool>(out var loOn) && loOn);
        Loudness = new Loudness(Log, Int(cfg["loudness_tick_ms"], 5000)) { Ready = () => Held && measureHere, Identify = () => Identify };
        // Likewise MQA's (item 418): always, except while the tests keep to this machine and haven't asked for it (mqa: true).
        var mqaHere = !Lookups.LoopbackOnly || (cfg["mqa"] is JsonValue mq && mq.TryGetValue<bool>(out var mqOn) && mqOn);
        MqaPass?.Stop();
        MqaPass = new Mqa.MqaPass(Log, Int(cfg["mqa_tick_ms"], 3000)) { Ready = () => Held && mqaHere };
        // Release days and the taste work (v0.8.20): MusicBrainz as itself (no
        // pack), FanArt.tv and Deezer where the configuration says.
        Mb = new MusicBrainz(Text(cfg["musicbrainz_url"]), version);
        FanartBase = (Text(cfg["fanart_url"]) ?? Fanart.Base).TrimEnd('/');
        Days = new ReleaseDays(Text(cfg["musicbrainz_url"]), version, Log) { Ready = () => Holds("days") };
        Taste = new Taste(Text(cfg["deezer_url"]), Log) { Ready = () => Holds("taste") };
        // Headphone profiles (v0.8.26): where AutoEq is.
        AutoEq = new AutoEq(Text(cfg["autoeq_url"]), Log);
        BuiltInKeys.Configure(Text(cfg["acoustid_built_in"]), Text(cfg["fanart_built_in"]));
        // Qobuz's and Tidal's catalogue (v0.8.39): their addresses as set up (the tests' fakes).
        // Their albums' rows (v0.8.44): the covers kept in the data folder, beside the database. Tidal's sign-in (v0.8.47): where it is asked.
        Qobuz = new Services.QobuzCatalogue(Text(cfg["qobuz_url"])) { DataDir = dataDir };
        Tidal = new Services.TidalCatalogue(Text(cfg["tidal_url"]), Text(cfg["tidal_images_url"]), Text(cfg["tidal_auth_url"])) { DataDir = dataDir };
        IBroadcast = new Services.IBroadcast.IBroadcast(Text(cfg["ibroadcast_url"]));
        // The uploaded albums' booklets kept here (item 510), shown from the start.
        Services.IBroadcast.IBroadcastBooklets.Init(dataDir);
        IBroadcastLibrary = new Services.IBroadcast.IBroadcastLibrary(IBroadcast, dataDir)
            { WatchMs = cfg["ibroadcast_watch_ms"] is JsonValue ibw && ibw.TryGetValue<double>(out var ibms) && ibms > 0 ? ibms : 10 * 60 * 1000 };
        IBroadcastStreams = new Services.IBroadcast.IBroadcastStreams(IBroadcast) { DataDir = dataDir };
        IBroadcastUpload = new Services.IBroadcast.IBroadcastUpload(IBroadcast, dataDir)
        {
            LimitBytes = cfg["ibroadcast_upload_limit"] is JsonValue ibl && ibl.TryGetValue<double>(out var lim) && lim > 0 ? (long)lim : 1_500_000_000,
            HoldMs = cfg["ibroadcast_upload_limit"] != null ? 200 : 5000,
            // The tests' uploads follow one another at once: no wait unless one asks for it (item 488).
            WaitMs = cfg["ibroadcast_upload_wait_ms"] is JsonValue ibq && ibq.TryGetValue<double>(out var wait) ? wait : cfg["ibroadcast_upload_limit"] != null ? 0 : Services.IBroadcast.IBroadcastUploadSent.WaitMs,
            AgainMs = cfg["ibroadcast_upload_again_ms"] is JsonValue iba && iba.TryGetValue<double>(out var again) && again > 0 ? again : Services.IBroadcast.IBroadcastUploadSent.AgainMs,
            ResumeEveryMs = cfg["ibroadcast_upload_limit"] != null ? 200 : 15_000,
            Files = new Services.IBroadcast.IBroadcastUploadFiles(IBroadcast.Api, dataDir) { Waits = cfg["ibroadcast_upload_limit"] != null ? [TimeSpan.FromMilliseconds(200)] : [TimeSpan.FromSeconds(30), TimeSpan.FromMinutes(2), TimeSpan.FromMinutes(5)] },
        };
        IBroadcastSchedule = new Services.IBroadcast.IBroadcastSchedule(IBroadcastUpload)
            { TickMs = cfg["ibroadcast_schedule_tick_ms"] is JsonValue ibt && ibt.TryGetValue<double>(out var tick) && tick > 0 ? (int)tick : 30_000 };
        // What a service no longer here left behind (items 152, 525: Spotify's), and gone albums and tracks (item 179): gone before the library is read.
        Orphans.Sweep(Log);
        if (Services.Leftovers.Remove(dataDir, Log)) _ = Library.Tell(new JsonObject { ["services"] = "changed" });
        // The playlists' settings and the albums they held, gone with the playlists.
        Services.Leftovers.RemovePlaylists(Log);
        // A record's write-up and links (v0.8.21): asked of MusicBrainz, Wikipedia, Pitchfork and Qobuz's site where the configuration says.
        WriteUps = new WriteUpSources(Text(cfg["musicbrainz_url"]), Text(cfg["wikipedia_url"]), Text(cfg["pitchfork_url"]), Text(cfg["qobuz_web_url"]), version);
        // The albums' credits and the acts behind them (bug list item 129): MusicBrainz, Wikidata, FanArt.tv and Deezer where the configuration says.
        Credits.CreditFinder.Current?.Stop();
        var credits = new Credits.CreditFinder(new MusicBrainz(Text(cfg["musicbrainz_url"]), version), Text(cfg["deezer_url"]), Text(cfg["wikidata_url"]),
            FanartBase, "Mandarin/" + version + " (+https://github.com/meltface-80/Mandarin)", Log) { Ready = () => Held };
        Credits.CreditFinder.Current = credits;
        // Tailscale built in (v0.8.22): the engine, its folder and the port it serves.
        var watchdog = cfg["tailscale_watchdog"] as JsonObject;
        Tailscale = new Admin.Tailscale(
            Text(cfg["tailscale_bin"]) ?? (Environment.GetEnvironmentVariable("MUSICDNET_BIN") is { Length: > 0 } eb ? eb : "/usr/local/bin/musicdnet"),
            Text(cfg["tailscale_dir"]) ?? Path.Combine(dataDir, "tailscale"), Int(cfg["tailscale_port"], frontPort), version, Log,
            Int(watchdog?["rebindMs"], 60000), Int(watchdog?["restartMs"], 240000));
        // The in-app update (v0.8.48): where GitHub is asked.
        Updater?.Stop();
        Updater = new Admin.Updater(cfg, Environment.GetEnvironmentVariable("MANDARIN_APP_DIR") ?? Server.FindAppDir(), version, Log);
        started = true;
        Updater.Start();
        // The processor split (v0.8.48): decided here.
        Cpu.StartDeciding();
        if (cfg["identify"] is JsonValue on && on.TryGetValue<bool>(out var yes) && yes) Identify.Start();
        Packs.Start();
        Loudness.Start();
        MqaPass.Start();
        Taste.Start();
        // Found in the background, except while the tests keep to this machine and haven't asked for it (credits: true).
        if (!Lookups.LoopbackOnly || (cfg["credits"] is JsonValue cr && cr.TryGetValue<bool>(out var crOn) && crOn))
            credits.Start(Int(cfg["credits_tick_ms"], 2000));
        // The tiles' covers drawn ahead after a scan: likewise (covers_ahead: true).
        Covers.AheadOn = !Lookups.LoopbackOnly || (cfg["covers_ahead"] is JsonValue ca && ca.TryGetValue<bool>(out var caOn) && caOn);
        // The cover finder (item 409): likewise (auto_covers: true), an album auto_covers_gap_ms apart (4000).
        var findCovers = !Lookups.LoopbackOnly || (cfg["auto_covers"] is JsonValue ac && ac.TryGetValue<bool>(out var acOn) && acOn);
        AutoCovers.Current?.Stop();
        AutoCovers.Current = new AutoCovers(new CoverCatalogues(Text(cfg["itunes_url"]), Text(cfg["deezer_url"]), Text(cfg["musicbrainz_url"]), Text(cfg["coverart_url"]), version, Log),
            Pause(cfg["auto_covers_gap_ms"], 4000), Log) { Ready = () => findCovers && Holds("covers") };
        if (findCovers) AutoCovers.Current.Start();
        _ = Tailscale.Start();
        Scans.Start(cfg, dataDir);
        // Playback whole (v0.8.49, stage 6): the hub.
        await Playback.Hub.Start(Playback.HubConfig.Of(cfg, dataDir, frontPort), Log);
        // The month's prune of the services' albums only ever played from the browser (v0.8.44): daily.
        Services.Prune.Start();
        // Their import and the favourites' watch (v0.8.45): on the Node server's timers.
        Services.Import.Start(cfg);
        IBroadcastLibrary?.Start();
        IBroadcastSchedule?.Start();
        IBroadcastUpload?.Resume();
        Server.Log("[jobs] made here: " + string.Join(", ", Names));
        // A library scan that ended before the work was set up: what follows it, made now.
        _ = Task.Run(async () =>
        {
            if (await Library.CurrentState() is var (_, st) && !st.Scanning) await AfterScan();
        });
    }

    /* After a library scan (Scans.cs; the tests' /internal/jobs/after-scan): the release days, today's Smart Picks, the covers drawn ahead, and covers looked for. */
    public static async Task AfterScan()
    {
        try
        {
            if (Holds("days") && Days is { } d) _ = d.Run();
            if (Holds("taste") && Taste is { } t && await Library.CurrentCopy() is { } s) t.Kick(s, false);
            // The tiles' covers not drawn yet, drawn ahead (Covers.Ahead.cs).
            Covers.DrawAhead();
            // The albums with no cover of their own not looked at yet, a cover looked for (Extras/AutoCovers.cs).
            AutoCovers.Current?.Kick();
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
        IBroadcastLibrary?.Stop();
        IBroadcastSchedule?.Stop();
        IBroadcastUpload?.Shutdown();   // an Upload now under way goes on when the server starts again (item 467)
        // What was playing from Qobuz reported over (v0.8.47), as the Node server's stop did: a few seconds at most.
        try { Qobuz?.Stop().Wait(TimeSpan.FromSeconds(5)); } catch (AggregateException) { /* reported or not, stopping */ }
        Tailscale?.Stop();
        Identify?.Stop();
        Packs?.Stop();
        Loudness?.Stop();
        MqaPass?.Stop();
        Days?.Stop();
        AutoCovers.Current?.Stop();
        Taste?.Stop();
    }
}
