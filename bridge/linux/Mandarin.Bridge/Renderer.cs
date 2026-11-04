// Renderer.cs — the UPnP MediaRenderer over Mandarin's audio engine (the Android app's Renderer.kt, over ExoPlayer
// there): the three services' actions answered and their state evented. AVTransport keeps one track (current) and the
// one to follow (next, SetNextAVTransportURI), both given to the engine, so the join is gapless; when the engine moves
// on by itself the next becomes the current and the control point sees the new URI. TransportState is STOPPED after
// Stop or a new URI until Play, then the engine's: TRANSITIONING while it fills, PLAYING, PAUSED_PLAYBACK, STOPPED at
// the end, or STOPPED with ERROR_OCCURRED when a track couldn't be played (no DAC). The volume is the DAC's: 100, fixed.
namespace Mandarin.Bridge;

internal sealed class Renderer
{
    private const string AvtNs = "urn:schemas-upnp-org:metadata-1-0/AVT/", RcsNs = "urn:schemas-upnp-org:metadata-1-0/RCS/";
    private static readonly HashSet<string> Channel = ["Volume", "Mute"];

    public sealed record Item(string Uri, string Meta) { public Xml.Didl Didl { get; } = Xml.ParseDidl(Meta); }

    private readonly object gate = new();
    private readonly Player player;
    private readonly Func<string> sink;
    private readonly Action changed;
    public Events Avt { get; }
    public Events Rcs { get; }
    public Events Cms { get; }

    public Item? Current { get; private set; }
    public Item? Next { get; private set; }
    private bool stopped = true;
    private double resumeAt;
    private List<(string, string)> lastAvt = [];
    private string lastSink = "";
    private bool rcsSent;

    public Renderer(Player player, Func<string> sink, Action changed, Action<string> log)
    {
        (this.player, this.sink, this.changed) = (player, sink, changed);
        (Avt, Rcs, Cms) = (new Events(Scpd.Avt, log), new Events(Scpd.Rcs, log), new Events(Scpd.Cms, log));
        player.Changed += () => { lock (gate) { Moved(); } Evented(); };
    }

    // The engine went on to the next track by itself: it is the current one now.
    private void Moved()
    {
        if (Next != null && player.Uri == Next.Uri && Current?.Uri != Next.Uri) { Current = Next; Next = null; Joined++; }
    }

    /* How many tracks the engine has gone on to by itself, gapless (the web page's details). */
    public int Joined { get; private set; }

    public string? Error => player.Error;

    public string TransportState()
    {
        lock (gate)
        {
            if (Current == null) return "NO_MEDIA_PRESENT";
            if (stopped) return "STOPPED";
            return player.State;
        }
    }

    private double Duration() => Current?.Didl.Seconds ?? 0;
    private double Position() { lock (gate) return stopped || Current == null || player.Uri != Current.Uri ? 0 : player.Seconds; }

    private string Actions() => TransportState() switch
    {
        "NO_MEDIA_PRESENT" => "",
        "PLAYING" => "Pause,Stop,Seek,Next,Previous",
        "PAUSED_PLAYBACK" => "Play,Stop,Seek,Next,Previous",
        _ => "Play,Seek,Next,Previous",
    };

    private List<(string, string)> AvtVars()
    {
        var (c, n) = (Current, Next);
        return
        [
            ("TransportState", TransportState()), ("TransportStatus", Error != null ? "ERROR_OCCURRED" : "OK"),
            ("PlaybackStorageMedium", c != null ? "NETWORK" : "NONE"), ("NumberOfTracks", c != null ? "1" : "0"), ("CurrentTrack", c != null ? "1" : "0"),
            ("CurrentTrackDuration", Xml.Hms(Duration())), ("CurrentMediaDuration", Xml.Hms(Duration())),
            ("CurrentTrackMetaData", c?.Meta ?? ""), ("CurrentTrackURI", c?.Uri ?? ""), ("AVTransportURI", c?.Uri ?? ""), ("AVTransportURIMetaData", c?.Meta ?? ""),
            ("NextAVTransportURI", n?.Uri ?? ""), ("NextAVTransportURIMetaData", n?.Meta ?? ""), ("CurrentPlayMode", "NORMAL"), ("TransportPlaySpeed", "1"),
            ("CurrentTransportActions", Actions()),
        ];
    }

    private static List<(string, string)> RcsVars() => [("Volume", "100"), ("Mute", "0")];

    /* Something may have changed: whatever did is evented. */
    public void Evented()
    {
        string? avt = null, cms = null;
        lock (gate)
        {
            var a = AvtVars();
            if (!a.SequenceEqual(lastAvt))
            {
                var diff = a.Where(v => !lastAvt.Contains(v)).ToList();
                lastAvt = a;
                avt = Events.LastChange(AvtNs, diff);
            }
            var s = sink();
            if (s != lastSink) { lastSink = s; cms = Events.PropertySet([("SourceProtocolInfo", ""), ("SinkProtocolInfo", s), ("CurrentConnectionIDs", "0")]); }
        }
        if (avt != null) Avt.Changed(avt);
        if (cms != null) Cms.Changed(cms);
        if (!rcsSent) { rcsSent = true; Rcs.Changed(RcsInitial()); }
        changed();
    }

    public string AvtInitial() { lock (gate) return Events.LastChange(AvtNs, AvtVars()); }
    public static string RcsInitial() => Events.LastChange(RcsNs, RcsVars(), Channel);
    public string CmsInitial() => Events.PropertySet([("SourceProtocolInfo", ""), ("SinkProtocolInfo", sink()), ("CurrentConnectionIDs", "0")]);

    private static void Instance(Xml.Action a) { if ((a.Args.GetValueOrDefault("InstanceID") ?? "0").Trim() != "0") throw new Fault(718, "Invalid InstanceID"); }

    /* The answer to [a] (its out arguments), or a Fault. */
    public List<(string Name, string Value)> Handle(string service, Xml.Action a)
    {
        List<(string, string)> r;
        lock (gate) r = service switch
        {
            "AVTransport" => AvTransport(a),
            "RenderingControl" => RenderingControl(a),
            "ConnectionManager" => ConnectionManager(a),
            _ => throw new Fault(401, "Invalid Action"),
        };
        Evented();
        return r;
    }

    private string Arg(Xml.Action a, string name) => (a.Args.GetValueOrDefault(name) ?? "").Trim();

    // The current track from [at] s, and the next given again (a play clears it in the engine).
    private void Start(double at, bool paused = false)
    {
        player.Play(Current!.Uri, at, paused);
        if (Next != null) player.Next(Next.Uri);
    }

    private List<(string, string)> AvTransport(Xml.Action a)
    {
        Instance(a);
        switch (a.Name)
        {
            case "SetAVTransportURI":
            {
                var uri = Arg(a, "CurrentURI");
                if (uri.Length == 0) throw new Fault(716, "Resource not found");
                // Playing on, as most renderers do, when it was; else stopped until Play.
                var playing = !stopped && player.State is "PLAYING" or "TRANSITIONING";
                Current = new Item(uri, a.Args.GetValueOrDefault("CurrentURIMetaData") ?? ""); Next = null; resumeAt = 0;
                if (playing) Start(0); else { stopped = true; player.Stop(); }
                return [];
            }
            case "SetNextAVTransportURI":
            {
                var uri = Arg(a, "NextURI");
                if (Current == null && uri.Length > 0) throw new Fault(701, "Transition not available");
                Next = uri.Length == 0 ? null : new Item(uri, a.Args.GetValueOrDefault("NextURIMetaData") ?? "");
                if (!stopped) player.Next(Next?.Uri ?? "");
                return [];
            }
            case "Play":
                if (Current == null) throw new Fault(701, "Transition not available");
                if (!stopped && player.State == "PAUSED_PLAYBACK" && player.Uri == Current.Uri) player.Resume();
                else if (stopped || player.State == "STOPPED") { Start(resumeAt); resumeAt = 0; }
                stopped = false;
                return [];
            case "Pause":
                if (Current == null) throw new Fault(701, "Transition not available");
                if (!stopped) player.Pause();
                return [];
            case "Stop": stopped = true; resumeAt = 0; player.Stop(); return [];
            case "Seek":
            {
                if (Current == null) throw new Fault(701, "Transition not available");
                var unit = Arg(a, "Unit");
                if (unit == "TRACK_NR") { if (Arg(a, "Target") != "1") throw new Fault(711, "Illegal seek target"); return []; }
                if (unit is not ("REL_TIME" or "ABS_TIME")) throw new Fault(710, "Seek mode not supported");
                var at = Xml.Seconds(Arg(a, "Target"));
                if (stopped) resumeAt = at; else Start(at, player.State == "PAUSED_PLAYBACK");
                return [];
            }
            case "Next":
                if (Next == null) throw new Fault(711, "Nothing next");
                Current = Next; Next = null;
                if (!stopped) Start(0);
                return [];
            case "Previous":
                if (Current == null) throw new Fault(701, "Transition not available");
                if (stopped) resumeAt = 0; else Start(0, player.State == "PAUSED_PLAYBACK");
                return [];
            case "SetPlayMode": if ((a.Args.GetValueOrDefault("NewPlayMode") ?? "NORMAL") == "NORMAL") return []; throw new Fault(712, "Play mode not supported");
            case "GetTransportInfo": return [("CurrentTransportState", TransportState()), ("CurrentTransportStatus", Error != null ? "ERROR_OCCURRED" : "OK"), ("CurrentSpeed", "1")];
            case "GetPositionInfo":
            {
                var c = Current;
                var pos = Xml.Hms(Position());
                return [("Track", c != null ? "1" : "0"), ("TrackDuration", Xml.Hms(Duration())), ("TrackMetaData", c?.Meta ?? ""), ("TrackURI", c?.Uri ?? ""),
                    ("RelTime", pos), ("AbsTime", pos), ("RelCount", "2147483647"), ("AbsCount", "2147483647")];
            }
            case "GetMediaInfo":
            {
                var (c, n) = (Current, Next);
                return [("NrTracks", c != null ? "1" : "0"), ("MediaDuration", Xml.Hms(Duration())), ("CurrentURI", c?.Uri ?? ""), ("CurrentURIMetaData", c?.Meta ?? ""),
                    ("NextURI", n?.Uri ?? ""), ("NextURIMetaData", n?.Meta ?? ""), ("PlayMedium", c != null ? "NETWORK" : "NONE"), ("RecordMedium", "NOT_IMPLEMENTED"), ("WriteStatus", "NOT_IMPLEMENTED")];
            }
            case "GetDeviceCapabilities": return [("PlayMedia", "NETWORK"), ("RecMedia", "NOT_IMPLEMENTED"), ("RecQualityModes", "NOT_IMPLEMENTED")];
            case "GetTransportSettings": return [("PlayMode", "NORMAL"), ("RecQualityMode", "NOT_IMPLEMENTED")];
            case "GetCurrentTransportActions": return [("Actions", Actions())];
            default: throw new Fault(401, "Invalid Action");
        }
    }

    // The DAC's own volume: 100, fixed (Mandarin sends untouched samples; the DAC or the amplifier sets the level).
    private static List<(string, string)> RenderingControl(Xml.Action a)
    {
        Instance(a);
        return a.Name switch
        {
            "GetVolume" => [("CurrentVolume", "100")],
            "SetVolume" => [],
            "GetMute" => [("CurrentMute", "0")],
            "SetMute" => [],
            "ListPresets" => [("CurrentPresetNameList", "FactoryDefaults")],
            "SelectPreset" => [],
            _ => throw new Fault(401, "Invalid Action"),
        };
    }

    private List<(string, string)> ConnectionManager(Xml.Action a) => a.Name switch
    {
        "GetProtocolInfo" => [("Source", ""), ("Sink", sink())],
        "GetCurrentConnectionIDs" => [("ConnectionIDs", "0")],
        "GetCurrentConnectionInfo" => [("RcsID", "0"), ("AVTransportID", "0"), ("ProtocolInfo", ""), ("PeerConnectionManager", ""), ("PeerConnectionID", "-1"), ("Direction", "Input"), ("Status", "OK")],
        _ => throw new Fault(401, "Invalid Action"),
    };
}
