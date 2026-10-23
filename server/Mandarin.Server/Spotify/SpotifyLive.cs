// SpotifyLive.cs — Spotify in a room (bug list item 142; docs/spotify-plan.md): Mandarin's Soloist ("Mandarin" in
// the Spotify app's devices) played into the room chosen for it, as one live stream (SpotifyStream.cs).
//
//   Spotify plays on "Mandarin"  → the room plays /stream/spotify/live.flac (its queue replaced, as Play now does)
//   Spotify pauses               → the room pauses; plays again → the room plays on
//   Spotify stops, or another device is chosen in the Spotify app → the room stops
//   the room goes on to other music, or is paused outside Mandarin, while Spotify plays → Spotify pauses
//   Now Playing's play, pause, next, previous and seek, on that room → Soloist (Hub.Commands.cs asks Intercepts)
//
// Settings → Services → Spotify (SpotifyRoutes.cs): the Soloist API key, the room, the name the Spotify app shows.
// Soloist itself is downloaded from Spotify when the key is set, and again before its 90 days are up.
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Spotify;

/* Settings → Services → Spotify, as kept (the setting "spotify"). */
internal sealed record SpotifySettings(string ApiKey, string Room, string DeviceName)
{
    public const string DefaultName = "Mandarin";
}

internal static class SpotifyLive
{
    public const string StreamPath = "/stream/spotify/live.flac";

    public static Soloist? Player { get; private set; }
    private static string dataDir = "";
    private static string? playingIn;          // the room the stream was started in, while it plays there
    private static readonly object gate = new();
    private static Timer? builds;
    private static int fetching;
    public static string FetchError { get; private set; } = "";
    public static bool Fetching => Volatile.Read(ref fetching) == 1;

    /* Started with the server (Jobs.cs). */
    public static void Start(string data)
    {
        dataDir = data;
        Player = new Soloist(data, Setup, Server.Log);
        Player.Changed += Changed;
        Player.Expired += () => _ = Fetch();
        // Soloist itself: fetched once a key is set, and again before its build runs out (looked at every six hours).
        builds = new Timer(_ => _ = KeepCurrent(), null, TimeSpan.FromSeconds(15), TimeSpan.FromHours(6));
    }

    public static void Stop()
    {
        builds?.Dispose();
        Player?.Dispose();
    }

    // ------------------------------------------------------------ the settings

    public static SpotifySettings Settings()
    {
        var s = Extras.Labels.Setting("spotify");
        string Str(string k) => s is JsObj o && o[k] is string t ? t.Trim() : "";
        var name = Str("deviceName");
        return new SpotifySettings(Str("apiKey"), Str("room"), name != "" ? name : SpotifySettings.DefaultName);
    }

    public static void Save(SpotifySettings s)
    {
        var o = new JsObj { ["apiKey"] = s.ApiKey, ["room"] = s.Room, ["deviceName"] = s.DeviceName };
        Extras.Labels.SetSetting("spotify", o);
    }

    private static SoloistSetup Setup()
    {
        var s = Settings();
        var program = SoloistDownload.Program(dataDir);
        return new SoloistSetup(File.Exists(program) ? program : "", PulseAudio(), s.ApiKey, s.DeviceName);
    }

    /* PulseAudio's program, where it is installed (Mandarin's image has it); "" when it isn't. */
    internal static string PulseAudio() =>
        (Environment.GetEnvironmentVariable("PATH") ?? "/usr/bin:/bin").Split(':').Select(d => Path.Combine(d, "pulseaudio")).FirstOrDefault(File.Exists) ?? "";

    // ------------------------------------------------------------ Soloist itself

    /* The build on disk: its version, when it runs out, and what is to be done with it. */
    public static (string Version, DateOnly? Expires, string Plan) Build()
    {
        var program = SoloistDownload.Program(dataDir);
        var exists = File.Exists(program);
        var version = exists ? SoloistDownload.Version(program) : "";
        var expires = SoloistDownload.Expires(version);
        return (version, expires, SoloistDownload.Plan(exists, expires, DateOnly.FromDateTime(DateTime.UtcNow)));
    }

    private static async Task KeepCurrent()
    {
        if (Settings().ApiKey == "") return;
        if (Build().Plan != "use") await Fetch();
    }

    /* Soloist fetched from Spotify (Settings' Download, a build running out); Soloist started again on it. */
    public static async Task Fetch()
    {
        if (Interlocked.Exchange(ref fetching, 1) == 1) return;
        try
        {
            Server.Log("[spotify] downloading Spotify Soloist");
            // SOLOIST_URL: an archive of the tests' own in place of Spotify's CDN.
            var url = Environment.GetEnvironmentVariable("SOLOIST_URL") is { Length: > 0 } u ? u : null;
            await SoloistDownload.Fetch(Path.GetDirectoryName(SoloistDownload.Program(dataDir))!, CancellationToken.None, url);
            FetchError = "";
            Server.Log("[spotify] Soloist downloaded: " + SoloistDownload.Version(SoloistDownload.Program(dataDir)));
            Player?.Restart();
        }
        catch (Exception e) when (e is HttpRequestException or IOException or InvalidDataException or PlatformNotSupportedException or TaskCanceledException or UnauthorizedAccessException)
        {
            FetchError = e.Message;
            Server.Log("[spotify] couldn't download Soloist: " + e.Message);
        }
        finally { Volatile.Write(ref fetching, 0); }
    }

    // ------------------------------------------------------------ the room

    /* Whether [st] is the room's state while it plays Spotify's stream. */
    public static bool IsLive(ZoneState? st) => st != null && st.TrackUri.Contains(StreamPath, StringComparison.Ordinal);

    private static void Changed()
    {
        Hub.Current?.Bump();
        var p = Player;
        if (p == null) return;
        // "playing" is the account's: it plays here only while this Soloist is the active device.
        var here = p.Active && p.Playback is "playing" or "paused";
        _ = Task.Run(() => Follow(here ? p.Playback : "idle"));
    }

    private static readonly SemaphoreSlim following = new(1, 1);
    private static string lastPlayback = "idle"; // what Spotify did when last followed (SpotifyFollow.Decide)
    private static long startedAt;               // when the stream was started in the room (Environment.TickCount64)
    private static bool saidNoRoom;              // said once while it plays with no room, not at every change

    // The room made to follow Spotify (SpotifyFollow.cs says what to do), one change at a time.
    private static async Task Follow(string playback)
    {
        var hub = Hub.Current;
        var p = Player;
        if (hub == null || p == null) return;
        await following.WaitAsync();
        try
        {
            string? room;
            lock (gate) room = playingIn;
            var want = Settings().Room;
            var st = room != null ? hub.StateOf(room) : null;
            var starting = Environment.TickCount64 - startedAt < SpotifyFollow.StartingMs;
            var what = SpotifyFollow.Decide(playback, lastPlayback, want, room, st != null ? new SpotifyRoom(IsLive(st), st.State) : null, starting);
            if (what != "no-room") saidNoRoom = false;
            switch (what)
            {
                case "no-room":
                    if (!saidNoRoom) Server.Log("[spotify] Spotify is playing on Mandarin, but no room is chosen for it (Settings → Services → Spotify)");
                    saidNoRoom = true;
                    break;
                case "start":
                    await hub.Enqueue(want, [Item(hub)], "play_now");
                    lock (gate) playingIn = want;
                    startedAt = Environment.TickCount64;
                    Server.Log("[spotify] playing in the room chosen for it");
                    break;
                case "moved-on" or "room-paused":
                    if (what == "moved-on") lock (gate) playingIn = null;
                    Server.Log(what == "moved-on" ? "[spotify] the room went on to other music: Spotify paused" : "[spotify] the room was paused: Spotify paused too");
                    await p.Pause();
                    break;
                case "resume-room": await hub.ControlDevice(room!, "play"); break;
                case "pause-room": await hub.ControlDevice(room!, "pause"); break;
                case "stop-room" or "forget":
                    if (what == "stop-room") await hub.ControlDevice(room!, "stop");
                    lock (gate) playingIn = null;
                    break;
            }
            lastPlayback = playback;
        }
        catch (Exception e) when (e is HubError or HttpRequestException or InvalidOperationException or TaskCanceledException)
        {
            Server.Log("[spotify] the room didn't follow: " + e.Message);
        }
        finally { following.Release(); }
    }

    /* The stream as a queue item: signed (speakers can't sign in), FLAC, no length. */
    private static PlayItem Item(Hub hub)
    {
        string secret;
        using (var c = Db.Open()) secret = hub.Secret(c);
        var uri = Signing.SignUrl(secret, hub.BaseUrl + StreamPath);
        var meta = Didl.Build(uri, Jv.Obj(("itemId", "mandarin-spotify"), ("title", "Spotify"), ("artist", ""), ("album", ""), ("mime", "audio/flac")));
        return new PlayItem { Uri = uri, Meta = meta };
    }

    // ------------------------------------------------------------ Now Playing's controls

    /* A command for a room playing Spotify's stream, sent to Soloist instead; false when the room isn't. */
    public static bool Intercepts(Hub hub, string zoneId, string command, double? seconds = null)
    {
        var p = Player;
        if (p == null || !IsLive(hub.StateOf(zoneId))) return false;
        _ = command switch
        {
            "play" => p.Play(),
            "pause" or "stop" => p.Pause(),
            "playpause" => p.Playback == "playing" ? p.Pause() : p.Play(),
            "next" => p.Next(),
            "previous" => p.Previous(),
            "seek" when seconds != null => p.Seek(seconds.Value),
            _ => Task.CompletedTask
        };
        return true;
    }
}
