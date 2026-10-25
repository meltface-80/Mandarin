// Players.cs — a UPnP/DLNA renderer (a WiiM, a Chord Poly, any streamer) as
// one more zone (lib/renderers/players.js, v0.8.49, stage 6 part 3). Like a
// phone, a plain renderer has no queue of its own, so the server keeps it.
// Each track is handed over with SetAVTransportURI + Play, and the one after
// it with SetNextAVTransportURI as soon as its file is complete, which is
// what makes the join gapless on a device that honours it. One that does not
// is noticed — it stops at the end of a track with a next one waiting — and
// is started on the next by hand. State is polled the way Sonos rooms are
// (Players.Poll.cs), through the same ApplyState, so history and the radio
// see a renderer as they see a room. Which track is playing is read from the
// URI the renderer reports (our stream URLs carry the track id), never from
// its metadata. A sound device on this computer is one of these too (kind
// "local", part 4). The commands are Players.Commands.cs's.
using Mandarin.Server.Local;
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

internal sealed class Player(string id)
{
    public string Id => id;
    public List<UpnpItem> Queue = [];
    public int Index = -1;
    public (int Index, string Uri, bool Sent)? Next;
    // Shuffle's: the tracks played (the items themselves, so an edit of the queue moves them with it), and the track picked
    // to follow the one playing, kept while that one plays (item 183).
    public HashSet<UpnpItem> Played = [];
    public (UpnpItem After, UpnpItem Next)? Successor;
    public bool Shuffle;
    public string Loop = "disabled";
    public (double? Value, bool Muted) Volume = (null, false);
    public bool ExpectStop, NoSetNext, Subscribing;
    public int Strikes, Jumping;      // Jumping: jumps under way (Jump), whose renderer may still say the track before
    // Heard: the state the room shows is the device's own, read from it (or a jump of ours): not one carried over an
    // outage or a restart, whose stop is no end of a track (item 184). Polling: a read under way; PollAgain: another
    // asked for meanwhile, made once it has answered.
    public bool Heard, Polling, PollAgain, PollAgainVolume;
    public (double At, string Message)? LastError;
    public IRenderer? Renderer;
    public string Location = "";
    public double TouchedAt, LoadingSince, JumpedAt;
    public string? Verifying;
    public Timer? NotifyTimer;
    public (double At, JsObj Vars)? LastEvent;
}

internal sealed partial class Players
{
    private const int QueueMax = 1000;
    private const double HotMs = 15000;
    // UPnP faults that mean "not that action": the renderer has no SetNext.
    private static readonly HashSet<double> NotSupported = [401, 402, 501, 602];
    private static readonly Dictionary<string, string> States = new()
    {
        ["PLAYING"] = "playing", ["TRANSITIONING"] = "loading", ["PAUSED_PLAYBACK"] = "paused", ["STOPPED"] = "stopped", ["NO_MEDIA_PRESENT"] = "stopped"
    };
    public const string LocalPrefix = "LOCAL_";

    private readonly Hub zm;
    private readonly object gate = new();
    private readonly Dictionary<string, Player> map = [];
    // GENA subscriptions: id -> { url, sid, expires, failedAt }. Without a callback address there are no events and the renderer is simply polled.
    private readonly Dictionary<string, (string Url, string Sid, double Expires, double FailedAt)> subs = [];
    private bool stopped;
    /* A sound device on this computer, played by the engine (Local/EngineOutput.cs): made here when the kind is "local"; what ALSA has it open at. */
    public Func<Player, DeviceRecord, IRenderer> LocalOutput { get; set; }
    public Func<string, (double Rate, string Format)?> HwParams { get; set; } = loc => LocalDevices.HwParams(loc);

    public Players(Hub hub)
    {
        zm = hub;
        LocalOutput = (p, r) =>
        {
            var name = r.Name ?? r.NetworkName;
            // The engine where it is here and plays this device; without it (a Mac, or not yet downloaded) the device can't be played from this server.
            var eng = AudioEngine.Plays(r.Location) ? AudioEngine.Find(zm.Config.DataDir) : null;
            if (eng == null) throw new HubError(409, $"{name} can't be played from this server: Mandarin's audio engine isn't here");
            // The stream is this server's own: fetched over loopback, whatever address it was given out at.
            var o = new EngineOutput(name, r.Location, eng.Bin, Transcoder.Bin, Log, LocalVolume(r), () => FixedVolume(Record(p.Id)),
                u => System.Text.RegularExpressions.Regex.Replace(u, "^https?://[^/]+", $"http://127.0.0.1:{zm.Config.Port}"));
            p.Volume = (o.Volume, false);
            return o;
        };
    }
    private Action<string> Log => zm.Log;
    private Devices Devices => zm.Devices;

    public void Stop()
    {
        stopped = true;
        List<(string Id, string Url, string Sid)> gone;
        lock (gate) { gone = subs.Where(kv => kv.Value.Sid.Length > 0).Select(kv => (kv.Key, kv.Value.Url, kv.Value.Sid)).ToList(); subs.Clear(); }
        foreach (var (_, url, sid) in gone) _ = GenaClient.Unsubscribe(url, sid);
        lock (gate) foreach (var p in map.Values) p.Renderer?.Halt();
    }

    // ------------------------------------------------------------ kept across a restart

    /* What the store keeps of this renderer's queue; null when empty. */
    public QueueSnapshot? Saved(string id)
    {
        lock (gate)
        {
            var p = map.GetValueOrDefault(id);
            if (p == null || p.Queue.Count == 0) return null;
            return new QueueSnapshot { Kind = "upnp", Ids = p.Queue.Select(it => it.TrackId).ToList() };
        }
    }

    /*
     * A queue kept from before a restart, back — with the device most likely
     * still playing the track it was given: its address is the same as before
     * (signed the same way), so the first read of the device finds it in the
     * queue and carries on from there, next track and all.
     */
    public bool Restore(QueueSnapshot snap, List<PlayItem> items)
    {
        var p = PlayerOf(snap.Id);
        var local = Record(p.Id)?.Kind == "local";
        ZoneState next;
        lock (gate)
        {
            p.Queue = items.Take(QueueMax).Select(ToItem).ToList();
            p.Index = Math.Max(0, Math.Min(p.Queue.Count - 1, (int)snap.Index));
            // Kept as it was, but not heard: the first read says how the device is now, and a stop then is no end of a track.
            p.Heard = false;
            p.Next = null;
            p.Shuffle = snap.Shuffle;
            p.Loop = snap.Loop is "disabled" or "loop" or "loop_one" ? snap.Loop : "disabled";
            p.Played = p.Shuffle ? [p.Queue[p.Index]] : [];
            p.Successor = null;
            if (snap.VolumeValue != null) p.Volume = (snap.VolumeValue.Value, snap.VolumeValue.Muted);
            var it = p.Queue[p.Index];
            next = ZoneState.Blank(new Volume(p.Volume.Value, p.Volume.Muted));
            // A sound device on this computer stopped with the server: it waits for play.
            next.State = local ? "stopped" : snap.State is "playing" or "paused" or "stopped" ? snap.State : "stopped";
            next.TrackUri = it.Uri; next.TrackId = it.TrackId; next.TrackNumber = p.Index + 1; next.QueueLength = p.Queue.Count; next.OnQueue = true;
            next.Position = Math.Max(0, snap.Seconds); next.Duration = it.Duration;
            next.Title = it.Title; next.Artist = it.Artist; next.Album = it.Album; next.ArtUri = it.ArtUri; next.Sent = it.Sent;
            next.Shuffle = p.Shuffle; next.Loop = p.Loop; next.At = Hub.Now();
        }
        lock (zm.Gate) zm.State[p.Id] = next;
        return true;
    }

    // ------------------------------------------------------------ the register

    public static bool IsUpnpId(string? id) => id != null && (id.StartsWith("UPNP_", StringComparison.Ordinal) || id.StartsWith(LocalPrefix, StringComparison.Ordinal));
    public static bool IsStreamer(DeviceRecord? r) => r != null && r.Kind is "upnp" or "local";
    public static DeviceRecord? Record(string id) { using var c = Db.Open(); return Register.Get(c, id); }
    public static bool TakesFlac(DeviceRecord r)
    {
        var c = (r.Caps["advertised"] as JsObj)?["containers"] as List<object?> ?? [];
        return c.Count == 0 || c.Any(x => Jv.Same(x, "flac"));
    }
    /* A renderer that can be played to right now. */
    public bool Usable(DeviceRecord? r) => IsStreamer(r) && Jv.T(r!.Caps["playable"]) && Devices.Enabled(r) && Devices.Online(r) && TakesFlac(r);
    public bool Has(string id) => IsUpnpId(id) && Usable(Record(id));

    private Player PlayerOf(string id)
    {
        lock (gate)
        {
            if (map.TryGetValue(id, out var p)) return p;
            p = new Player(id);
            // A sound device on this computer: its volume is Mandarin's own, kept in the register.
            var r = Record(id);
            if (r != null && r.Kind == "local") p.Volume = (LocalVolume(r), false);
            map[id] = p;
            return p;
        }
    }

    /* The player, or the refusal api-playback's wrap would send (e.status). */
    public Player Get(string id)
    {
        var r = Record(id);
        if (!IsStreamer(r)) throw new HubError(404, "No such device");
        var name = r!.Name ?? r.NetworkName;
        if (!Devices.Enabled(r)) throw new HubError(409, $"{name} is switched off in Settings → Audio Devices");
        if (!Devices.Online(r)) throw new HubError(409, r.Kind == "local" ? $"{name} isn't connected to this computer" : $"{name} isn't on the network");
        if (!Jv.T(r.Caps["playable"])) throw new HubError(409, $"{name} can't be played to — it has no AVTransport service");
        if (!TakesFlac(r)) throw new HubError(409, $"{name} doesn't take FLAC, which is how Mandarin sends audio for now");
        return PlayerOf(id);
    }

    private IRenderer RendererOf(Player p)
    {
        var r = Record(p.Id);
        lock (gate)
        {
            var location = r?.Location ?? "";
            if (p.Renderer == null || p.Location != location)
            {
                p.Renderer?.Halt();
                if (r?.Kind == "local") p.Renderer = LocalOutput(p, r);
                else p.Renderer = new Renderer(p.Id, r?.Name ?? r?.NetworkName ?? p.Id, r?.Caps["services"] as JsObj);
                p.Location = location;
            }
            return p.Renderer;
        }
    }

    private static double LocalVolume(DeviceRecord r) => r.Settings["local_volume"] is double v && double.IsFinite(v) ? v : 50;

    public static bool FixedVolume(DeviceRecord? r)
    {
        if (r == null) return false;
        if (r.Kind == "local") return Jv.Same(r.Settings["volume"], "fixed");
        if (Jv.T(r.Settings["volume"])) return Jv.Same(r.Settings["volume"], "fixed");
        return Jv.Same(Jv.Get(Profiles.Effective(Devices.RecordJs(r))["profile"], "volume"), "fixed");
    }

    /* The ceiling the stream plan works to: what the device's page shows as on. */
    public static JsObj? TargetFor(string id)
    {
        var r = Record(id);
        if (!IsStreamer(r)) return null;
        var caps = Profiles.Effective(Devices.RecordJs(r!));
        static List<object?> On(object? list, string key) => (list as List<object?> ?? []).Where(x => Jv.T(Jv.Get(x, "on"))).Select(x => Jv.Get(x, key)).ToList();
        var rates = On(caps["rates"], "hz");
        var bits = On(caps["bits"], "n").Select(Jv.Num).ToList();
        var s = r!.Settings;
        // 32-bit output only where this ffmpeg writes 32-bit FLAC.
        var most = bits.Count > 0 ? bits.Max() : 24;
        var maxBits = Math.Min(most, Transcoder.Flac32 ? 32 : 24);
        var dsd = On(caps["dsd"], "n");
        var mimes = ((r.Caps["advertised"] as JsObj)?["mimes"] as List<object?> ?? []).Select(Jv.Str).ToList();
        static string? Find(List<string> l, string re) => l.FirstOrDefault(m => System.Text.RegularExpressions.Regex.IsMatch(m, re));
        var dsdMimes = Jv.Obj(
            ("dsf", Find(mimes, "^audio/(x-)?dsf$") ?? Find(mimes, "^audio/(x-)?dsd$")),
            ("dff", Find(mimes, "^audio/(x-)?dff$") ?? Find(mimes, "^audio/(x-)?dsd$")));
        JsObj? dsp;
        using (var c = Db.Open()) dsp = PlaybackRoutes.DspFor(c, id);
        return Jv.Obj(
            ("name", r.Name ?? r.NetworkName), ("rates", rates), ("maxBits", maxBits), ("containers", caps["containers"]), ("dsd", dsd), ("dsdMimes", dsdMimes),
            ("mode", s["mode"] is string mode && mode is "original" or "x2" or "x4" or "max" ? mode : "original"),
            ("bits", s["bits"] is double b && b is 24 or 32 ? (object)b : "auto"),
            ("dsp", dsp), ("id", r.Id));
    }

    /* The settings changed (output, DSP): what follows in the queue is planned again; the track playing carries on as it was given. */
    public async Task<bool> Replan(string id)
    {
        Player? p;
        List<long> ids;
        lock (gate)
        {
            if (!map.TryGetValue(id, out p) || p.Queue.Count == 0) return false;
            ids = p.Queue.Select(it => it.TrackId ?? 0).ToList();
        }
        var items = await zm.RebuildItems(ids.Where(x => x > 0).ToList(), id);
        lock (gate)
        {
            if (items.Count != p.Queue.Count) return false;
            // The same tracks in the same places, made again: what was played is still played.
            var played = Enumerable.Range(0, p.Queue.Count).Where(i => p.Played.Contains(p.Queue[i])).ToList();
            p.Queue = items.Select(ToItem).ToList();
            p.Played = played.Select(i => p.Queue[i]).ToHashSet();
            p.Successor = null;
            p.Next = null;
        }
        return true;
    }

    // ------------------------------------------------------------ zones

    public List<ZoneInfo> Zones()
    {
        var out_ = new List<ZoneInfo>();
        List<DeviceRecord> all;
        using (var c = Db.Open()) all = Register.All(c);
        foreach (var r in all)
        {
            if (!Usable(r)) continue;
            var p = PlayerOf(r.Id);
            ZoneState st;
            lock (zm.Gate) st = zm.State.GetValueOrDefault(r.Id) ?? ZoneState.Blank(new Volume(p.Volume.Value, p.Volume.Muted));
            out_.Add(new ZoneInfo { ZoneId = r.Id, DisplayName = r.NetworkName, State = st, Outputs = [OutputJson(r, p, st)], IsUpnp = true, IsLocal = r.Kind == "local" });
        }
        return out_;
    }

    private static OutputInfo OutputJson(DeviceRecord r, Player p, ZoneState st)
    {
        var v = st.VolumeValue ?? new Volume(p.Volume.Value, p.Volume.Muted);
        return new OutputInfo
        {
            OutputId = r.Id, ZoneId = r.Id, DisplayName = r.NetworkName, Model = r.Model, StereoPair = false, IsMuted = v.Muted,
            // Fixed on the device (a Poly feeds a Mojo, whose knob is the volume): no slider.
            VolumeShown = !FixedVolume(r), VolumeValue = v.Value, Step = 1, CanGroupWith = [r.Id]
        };
    }

    public QueueView Queue(string id)
    {
        var p = Get(id);
        lock (gate)
        {
            return new QueueView
            {
                Items = p.Queue.Select((it, i) => new QueueEntry { Position = i + 1, Uri = it.Uri, TrackId = it.TrackId, Title = it.Title, Artist = it.Artist, Album = it.Album, ArtUri = it.ArtUri, Duration = it.Duration }).ToList(),
                Total = p.Queue.Count, Current = p.Index + 1
            };
        }
    }

    public List<long> TrackIds(string id) { var p = Get(id); lock (gate) return p.Queue.Select(it => it.TrackId ?? 0).Where(x => x > 0).ToList(); }
    public (double At, string Message)? ErrorOf(string id) { lock (gate) return map.TryGetValue(id, out var p) ? p.LastError : null; }

    /* Its queue emptied, the renderer stopped, the room blank and kept so. */
    private async Task Emptied(Player p)
    {
        lock (gate) { p.Queue = []; p.Index = -1; p.Next = null; p.Played = []; p.Successor = null; p.ExpectStop = true; }
        try { await RendererOf(p).Stop(); } catch (RendererError) { /* already */ }
        lock (zm.Gate) zm.State[p.Id] = ZoneState.Blank(new Volume(p.Volume.Value, p.Volume.Muted));
        zm.Bump();
        zm.Persist(p.Id);
    }

    /*
     * devices.js setEnabled: switched off, or hidden, while playing — stopped
     * and its queue let go. The route writes the switch before the hub hears
     * of it, so the player is had as Get has it, all but the switch.
     */
    public async Task LetGo(string id)
    {
        try
        {
            var r = Record(id);
            if (IsStreamer(r) && Devices.Online(r!) && Jv.T(r!.Caps["playable"]) && TakesFlac(r)) await Emptied(PlayerOf(id));
        }
        finally { Drop(id); }
    }

    public void Drop(string id)
    {
        (string Url, string Sid, double Expires, double FailedAt) s;
        bool had;
        lock (gate)
        {
            if (map.Remove(id, out var p)) p.Renderer?.Halt();
            had = subs.Remove(id, out s);
        }
        lock (zm.Gate) zm.State.Remove(id);
        if (had && s.Sid.Length > 0) _ = GenaClient.Unsubscribe(s.Url, s.Sid);
    }
}
