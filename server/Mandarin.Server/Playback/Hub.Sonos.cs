// Hub.Sonos.cs — the Sonos half of the hub (lib/sonos/zones.js, v0.8.49,
// stage 6 part 2): the household read and the rooms polled. A Roon zone is a
// Sonos GROUP, identified by its coordinator's uid, which owns the queue and
// the transport; a Roon output is a Sonos ROOM, which owns volume and mute.
// THE QUEUE LIVES ON THE SPEAKER: what is queued is read back from it
// (ContentDirectory Q:0), kept here only until its UpdateID moves (v0.8.35).
// State is polled, not evented: a few hundred bytes per group, every second
// while someone is looking or music plays, every five otherwise. The writing
// half is Hub.SonosCommands.cs.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

internal sealed partial class Hub
{
    private const int Batch = 16;               // AddMultipleURIsToQueue ceiling
    private const int QueueMax = 1000;          // Sonos' own queue limit
    private const double HotMs = 15000;         // a zone someone looked at recently polls fast

    private static readonly Dictionary<string, string> SonosState = new()
    {
        ["PLAYING"] = "playing", ["TRANSITIONING"] = "loading", ["PAUSED_PLAYBACK"] = "paused", ["STOPPED"] = "stopped", ["NO_MEDIA_PRESENT"] = "stopped"
    };

    public SonosTopology Sonos = null!;
    private readonly Dictionary<string, SonosDevice.Browsed> queues = [];      // coordinator uid -> its queue as last read
    private readonly Dictionary<string, (double? Value, bool Muted, double At)> volumes = [];   // room uid -> volume
    private readonly List<CancellationTokenSource> loops = [];
    private int pollTick;
    public bool Discovered { get; private set; }

    /* Still looking: the first minute after a start, until the rooms are read. "No rooms found" is only true after that. */
    public bool Searching => Sonos.LastRefresh == 0 && Now() - startedAt < 60000;
    public string? LastError => Sonos.LastError.Length > 0 ? Sonos.LastError : null;
    public int RoomCount => Sonos.Rooms().Count;
    public List<string> SpeakerHosts => Sonos.Hosts;

    // ------------------------------------------------------------ lifecycle

    private void StartSonos()
    {
        Sonos = new SonosTopology(Config.SonosHosts, Config.ServerIp is { Length: > 0 } ip ? ip : null, Config.Include, Config.Exclude, Log)
        {
            OnHosts = SonosTopology.KeepHosts
        };
        Loop("discover", 60000, async () =>
        {
            await Sonos.Discover();
            Discovered = true;
            // Found players but no rooms yet (a restart, an update): read the rooms now rather than at the next refresh.
            if (Sonos.LastRefresh == 0 && await Sonos.Refresh()) Bump();
        }, 0);
        Loop("topology", 30000, async () => { if (await Sonos.Refresh()) Bump(); }, 1500);
        Loop("poll", 1000, PollAll, 2500);
    }

    private void StopSonos()
    {
        lock (loops) { foreach (var c in loops) c.Cancel(); loops.Clear(); }
    }

    /* Each loop runs, waits, runs again: never two at once, never piling up. */
    internal void Loop(string name, int every, Func<Task> fn, int firstDelay)
    {
        var cts = new CancellationTokenSource();
        lock (loops) loops.Add(cts);
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(firstDelay, cts.Token);
                while (!cts.IsCancellationRequested && !Stopped)
                {
                    try { await fn(); }
                    catch (Exception e) when (e is not OperationCanceledException) { Log($"[sonos] {name}: {e.Message}"); }
                    await Task.Delay(every, cts.Token);
                }
            }
            catch (OperationCanceledException) { /* stopped */ }
        });
    }

    /* Re-read the household now (after grouping, or when a client asks). */
    public async Task RefreshTopology() { if (await Sonos.Refresh()) Bump(); }

    // ------------------------------------------------------------ polling

    private async Task PollAll()
    {
        pollTick++;
        var groups = Sonos.Groups();
        var now = Now();
        await Task.WhenAll(groups.Select(async g =>
        {
            var id = g.Coordinator.Uid;
            bool hot, playing;
            lock (Gate)
            {
                hot = now - Hot.GetValueOrDefault(id) < HotMs;
                playing = State.TryGetValue(id, out var st) && st.State == "playing";
            }
            // Fast while watched, or while playing (to notice the queue running out and each track change); slow for an idle room nobody looks at.
            if (!hot && !playing && pollTick % 5 != 0) return;
            await PollGroup(g);
            if (hot || pollTick % 5 == 0) await PollVolumes(g.Members);
        }));
        // Forget state for groups that no longer exist.
        var live = groups.Select(g => g.Coordinator.Uid).ToHashSet();
        var gone = new List<string>();
        lock (Gate) foreach (var id in State.Keys) if (!live.Contains(id) && !Phones.IsPhoneId(id) && !IsUpnp(id)) gone.Add(id);
        foreach (var id in gone) { lock (Gate) State.Remove(id); Bump(); }
        await UpnpPollAll(pollTick);
    }

    private async Task PollGroup((SonosMember Coordinator, List<SonosMember> Members) g)
    {
        var c = new SonosDevice(g.Coordinator.Ip, g.Coordinator.Uid, g.Coordinator.Name);
        JsObj transport, position, settings, media;
        try
        {
            var t = c.GetTransportInfo(); var p = c.GetPositionInfo(); var s = c.GetTransportSettings(); var m = c.GetMediaInfo();
            await Task.WhenAll(t, p, s, m);
            (transport, position, settings, media) = (t.Result, p.Result, s.Result, m.Result);
        }
        catch (UPnPError)
        {
            var bump = false;
            lock (Gate) if (State.TryGetValue(c.Uid, out var prev0) && !prev0.Unreachable) { prev0.Unreachable = true; bump = true; }
            if (bump) Bump();
            return;
        }
        ZoneState prev;
        lock (Gate) prev = State.GetValueOrDefault(c.Uid) ?? new ZoneState();
        var meta = Didl.ParseItems(Str(position["TrackMetaData"])).FirstOrDefault() ?? new JsObj();
        var trackUri = Str(position["TrackURI"]);
        var currentUri = Str(media["CurrentURI"]);
        var onQueue = currentUri.StartsWith("x-rincon-queue:");
        var playMode = Str(settings["PlayMode"]);
        var (shuffle, loop) = SonosDevice.ModeOf(playMode);
        var next = new ZoneState
        {
            State = SonosState.GetValueOrDefault(Str(transport["CurrentTransportState"]), "stopped"),
            TrackUri = trackUri,
            TrackId = Phones.TrackIdFromUri(trackUri),
            TrackNumber = NumOr0(position["Track"]),
            QueueLength = onQueue ? NumOr0(media["NrTracks"]) : 0,
            OnQueue = onQueue,
            Position = Didl.ToSeconds(position["RelTime"]),
            Duration = Didl.ToSeconds(position["TrackDuration"]) is var d && d != 0 ? d : Jv.Num(meta["duration"]) is var md && !double.IsNaN(md) ? md : 0,
            Title = Str(meta["title"]), Artist = Str(meta["artist"]), Album = Str(meta["album"]),
            ArtUri = Jv.T(meta["artUri"]) ? Absolutise(Str(meta["artUri"]), c.BaseUrl) : "",
            StreamContent = Str(meta["streamContent"]),
            Shuffle = shuffle, Loop = loop,
            PlayMode = playMode.Length > 0 ? playMode : "NORMAL",
            MediaUri = currentUri,
            At = Now(), Unreachable = false
        };
        ApplyState(c.Uid, prev, next);
    }

    private static string Str(object? v) => Jv.T(v) ? Jv.Str(v) : "";
    private static double NumOr0(object? v) { var n = Tags.Js.ToNumber(v); return double.IsNaN(n) ? 0 : n; }

    private async Task PollVolumes(List<SonosMember> members)
    {
        await Task.WhenAll(members.Select(async m =>
        {
            var d = new SonosDevice(m.Ip, m.Uid, m.Name);
            try
            {
                var v = d.GetVolume(); var mu = d.GetMute();
                await Task.WhenAll(v, mu);
                bool changed;
                lock (Gate)
                {
                    changed = !volumes.TryGetValue(m.Uid, out var prev) || prev.Value != v.Result || prev.Muted != mu.Result;
                    volumes[m.Uid] = (v.Result, mu.Result, Now());
                }
                if (changed) Bump();
            }
            catch (UPnPError) { /* an unreachable room keeps its last known volume */ }
        }));
    }

    /* A Sonos queue kept here whose length changed (added to here or from the Sonos app): read again now. */
    private void QueueChanged(string uid)
    {
        bool kept;
        lock (Gate) kept = queues.ContainsKey(uid);
        if (!kept) return;
        var c = Coordinator(uid);
        if (c != null) _ = QueueOf(c).ContinueWith(_ => { }, TaskContinuationOptions.OnlyOnFaulted);
    }

    // ------------------------------------------------------------ reading

    private (SonosMember Coordinator, List<SonosMember> Members)? SonosGroupOf(string? zoneOrOutputId)
    {
        var groups = Sonos.Groups();
        var i = groups.FindIndex(g => g.Coordinator.Uid == zoneOrOutputId);
        if (i < 0) i = groups.FindIndex(g => g.Members.Any(m => m.Uid == zoneOrOutputId));
        return i < 0 ? null : groups[i];
    }

    public SonosGroup? GroupOf(string? id)
    {
        var g = SonosGroupOf(id);
        return g == null ? null : new SonosGroup { CoordinatorUid = g.Value.Coordinator.Uid, CoordinatorName = g.Value.Coordinator.Name, Members = g.Value.Members.Select(m => (m.Uid, m.Name)).ToList() };
    }

    private SonosDevice? Coordinator(string? zoneOrOutputId)
    {
        var g = SonosGroupOf(zoneOrOutputId);
        return g == null ? null : new SonosDevice(g.Value.Coordinator.Ip, g.Value.Coordinator.Uid, g.Value.Coordinator.Name);
    }

    /* The coordinator's name first, as the Sonos app writes a group. */
    private static string DisplayName((SonosMember Coordinator, List<SonosMember> Members) g)
    {
        var names = g.Members.Select(m => m.Name).ToList();
        names.Sort((a, b) => a == g.Coordinator.Name ? -1 : b == g.Coordinator.Name ? 1 : Library.Lc(a, b));
        if (names.Count <= 2) return string.Join(" + ", names);
        return $"{names[0]} + {names.Count - 1}";
    }

    private OutputInfo OutputJson(SonosMember m, (SonosMember Coordinator, List<SonosMember> Members)? g)
    {
        (double? Value, bool Muted, double At) v;
        string model;
        lock (Gate) { volumes.TryGetValue(m.Uid, out v); model = Sonos.Models.GetValueOrDefault(m.Uid, ""); }
        var has = v.At > 0;
        return new OutputInfo
        {
            OutputId = m.Uid, ZoneId = g?.Coordinator.Uid ?? "", DisplayName = m.Name, Model = model, StereoPair = m.StereoPair,
            IsMuted = has && v.Muted, VolumeValue = has ? v.Value : null, Step = 1, CanGroupWith = Sonos.Rooms().Select(r => r.Uid).ToList()
        };
    }

    private List<ZoneInfo> SonosZones()
    {
        var out_ = new List<ZoneInfo>();
        foreach (var g in Sonos.Groups())
        {
            ZoneState st;
            lock (Gate) st = State.GetValueOrDefault(g.Coordinator.Uid) ?? new ZoneState();
            out_.Add(new ZoneInfo
            {
                ZoneId = g.Coordinator.Uid, DisplayName = DisplayName(g), State = st, Outputs = g.Members.Select(m => OutputJson(m, g)).ToList(),
                Group = new SonosGroup { CoordinatorUid = g.Coordinator.Uid, CoordinatorName = g.Coordinator.Name, Members = g.Members.Select(m => (m.Uid, m.Name)).ToList() }
            });
        }
        return out_;
    }

    private ZoneInfo? SonosZone(string zoneOrOutputId)
    {
        var g = SonosGroupOf(zoneOrOutputId);
        return g == null ? null : Zones().FirstOrDefault(z => z.ZoneId == g.Value.Coordinator.Uid);
    }

    /* zones.outputs(): every Sonos room as an output, each with its zone's name, by name. */
    public List<OutputInfo> Outputs()
    {
        var groups = Sonos.Groups();
        var list = Sonos.Rooms().Select(m =>
        {
            var i = groups.FindIndex(x => x.Members.Any(y => y.Uid == m.Uid));
            var o = OutputJson(m, i < 0 ? null : groups[i]);
            o.ZoneName = i < 0 ? "" : DisplayName(groups[i]);
            return o;
        }).ToList();
        list.Sort((a, b) => Library.Lc(a.DisplayName, b.DisplayName));
        return list;
    }

    private async Task<QueueView> SonosQueue(string zoneId)
    {
        // A room that isn't there: an empty queue, as zones.js answers it (not a refusal).
        var c = Coordinator(zoneId);
        if (c == null) return new QueueView();
        ZoneState st;
        lock (Gate) st = State.GetValueOrDefault(c.Uid) ?? new ZoneState();
        var r = await QueueOf(c);
        return new QueueView
        {
            Items = r.Items.Select((it, i) => new QueueEntry
            {
                Position = i + 1, Uri = Str(it["uri"]), TrackId = Phones.TrackIdFromUri(Str(it["uri"])),
                Title = Str(it["title"]), Artist = Str(it["artist"]), Album = Str(it["album"]),
                ArtUri = Jv.T(it["artUri"]) ? Absolutise(Str(it["artUri"]), c.BaseUrl) : "", Duration = Jv.Num(it["duration"]) is var d && !double.IsNaN(d) ? d : 0
            }).ToList(),
            Total = r.Total,
            Current = st.OnQueue ? st.TrackNumber : 0
        };
    }

    /*
     * A Sonos room's queue, kept here (v0.8.35): the speaker is asked only
     * whether it has changed (the first track alone, which comes with the
     * queue's UpdateID), and the whole queue read again only when it has. A
     * speaker that gives no UpdateID is read in full every time.
     */
    private async Task<SonosDevice.Browsed> QueueOf(SonosDevice c)
    {
        SonosDevice.Browsed? kept;
        lock (Gate) queues.TryGetValue(c.Uid, out kept);
        if (kept != null)
        {
            var head = await c.BrowseQueue(0, 1);
            if (head.UpdateId != 0 && head.UpdateId == kept.UpdateId && head.Total == kept.Total) return kept;
        }
        var r = await c.BrowseQueue(0, QueueMax);
        lock (Gate) { if (r.UpdateId != 0) queues[c.Uid] = r; else queues.Remove(c.Uid); }
        return r;
    }

    public static string Absolutise(string uri, string baseUrl)
    {
        if (uri.Length == 0) return "";
        if (uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return uri;
        return baseUrl + (uri.StartsWith('/') ? uri : "/" + uri);
    }

    public static string MimeFromUri(string uri)
    {
        var path = uri.Split('?')[0];
        var m = System.Text.RegularExpressions.Regex.Match(path, @"\.([a-z0-9]+)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return (m.Success ? m.Groups[1].Value.ToLowerInvariant() : "") switch
        {
            "flac" => "audio/flac", "mp3" => "audio/mpeg", "m4a" or "mp4" => "audio/mp4", "aac" => "audio/aac",
            "wav" => "audio/wav", "aif" or "aiff" => "audio/aiff", "ogg" => "audio/ogg", _ => "audio/flac"
        };
    }
}
