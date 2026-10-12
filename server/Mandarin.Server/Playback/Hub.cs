// Hub.cs — every kind of player as one list of zones (lib/sonos/zones.js's
// ZoneManager, v0.8.49, stage 6 of docs/specs/csharp-migration.md): one state
// per zone, one revision the long polls wait on, the hooks history and the
// radio hang off (a track started, one played long enough to count, the queue
// near its end), and the queues the server keeps itself put back after a
// restart. Sonos rooms (SonosZones, part 2), phones (Phones.cs) and UPnP
// renderers (Hub.Upnp.cs, part 3) each answer the same methods; this class holds what they
// share and hands each id to its kind. The Node server's hub never starts
// where this one holds the job "playback" (index.js).
using System.Text.Json.Nodes;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Playback;

using AJs = Mandarin.Server.Js;
using TJs = Mandarin.Server.Tags.Js;

/* What the hub was set up with: the Node server's config, by the hand-over (Jobs.cs). */
internal sealed class HubConfig
{
    public List<string> SonosHosts = [];
    public string? ServerIp;
    public List<string> Include = [], Exclude = [];
    public List<string> UpnpHosts = [];
    public bool UpnpMulticast = true;
    public double UpnpOfflineMs = 150000;
    public bool LocalAudio = true;
    /* A test's stand-in for this computer's sound devices (index.js localAudio.list), handed over whole. */
    public Local.LocalList? LocalDevices;
    public int Port = 3500;
    public string DataDir = "";

    /* As the hand-over's config says it (index.js, lib/server/playback-handover.js). */
    public static HubConfig Of(JsonObject cfg, string dataDir, int port)
    {
        static string? Text(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) && s.Length > 0 ? s : null;
        static List<string> Strings(JsonNode? n) => n is JsonArray a ? a.Select(Text).OfType<string>().ToList() : [];
        static bool On(JsonNode? n) => n is not JsonValue v || !v.TryGetValue<bool>(out var b) || b;
        return new HubConfig
        {
            SonosHosts = Strings(cfg["sonos_hosts"]), ServerIp = Text(cfg["server_ip"]),
            Include = Strings(cfg["sonos_include"]), Exclude = Strings(cfg["sonos_exclude"]),
            UpnpHosts = Strings(cfg["upnp_hosts"]), UpnpMulticast = On(cfg["upnp_multicast"]),
            UpnpOfflineMs = cfg["upnp_offline_ms"] is JsonValue om && om.TryGetValue<double>(out var ms) && ms > 0 ? ms : 150000,
            LocalAudio = On(cfg["local_audio"]), LocalDevices = cfg["local_devices"] is JsonObject ld ? LocalListOf(ld) : null, Port = port, DataDir = dataDir
        };
    }

    /* The stand-in's devices, as lib/local/devices.js lists them: id, kind, names, location, playable and the advertised caps. */
    private static Local.LocalList LocalListOf(JsonObject ld)
    {
        var list = new Local.LocalList { Platform = ld["platform"] is JsonValue pv && pv.TryGetValue<string>(out var ps) ? ps : "", Off = ld["off"] is JsonValue ov && ov.TryGetValue<bool>(out var ob) && ob };
        list.Hidden = ld["hidden"] is JsonValue hv && hv.TryGetValue<double>(out var hn) ? (int)hn : 0;
        foreach (var n in ld["devices"] as JsonArray ?? [])
        {
            if (n is not JsonObject d || Scan.JsJson.Parse(d.ToJsonString()) is not JsObj o) continue;
            static string? S(object? v) => Jv.T(v) ? Jv.Str(v) : null;
            list.Devices.Add(new SeenInfo
            {
                Id = Jv.Str(o["id"]), Kind = S(o["kind"]) ?? "local", Family = S(o["family"]), NetworkName = S(o["network_name"]), Manufacturer = S(o["manufacturer"]),
                Model = S(o["model"]), Location = S(o["location"]), Playable = o["playable"] is bool pb ? pb : null, Caps = o["caps"] as JsObj
            });
        }
        return list;
    }
}

internal sealed partial class Hub
{
    public static Hub? Current { get; private set; }
    /* Playback is this server's: the hub runs. */
    public static bool Holds => Current != null;
    public static double Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    public readonly object Gate = new();
    public readonly Dictionary<string, ZoneState> State = [];
    public long Revision = 1;
    private readonly List<TaskCompletionSource> waiters = [];
    public readonly Dictionary<string, double> Hot = [];
    public readonly Phones Phones;
    public QueueStore? Store;
    public readonly HubConfig Config;
    public readonly Action<string> Log;
    private readonly double startedAt;
    public bool Stopped;
    // The hooks (zones.js's "track", "played" and "queue-low" events).
    public event Action<string, ZoneState>? OnTrack, OnPlayed, OnQueueLow;

    public Hub(HubConfig config, Action<string> log)
    {
        Config = config;
        Log = log;
        Phones = new Phones(this);
        StartRenderers();
        startedAt = Now();
    }

    /* ctx.baseUrl(): the address speakers and phones are given. */
    public string BaseUrl => $"http://{Config.ServerIp ?? Jv.Str(Topology.LocalIp(null, Undef.V))}:{Config.Port}";

    /* The install's signing secret (auth.js signUrl). */
    public string Secret(SqliteConnection c) => Db.Setting(c, "authSecret") is { } sv && AJs.Str(sv) is { Length: > 0 } s ? s : "";

    /* A conversion's name carries the file's time, or a streamed track's quality tier (Streams.cs). */
    public static long TierOrMtime(PlayTrack t) =>
        Services.Catalogue.Of(t.Path) is { } svc ? (long)svc.Tier() : t.Mtime;

    // ------------------------------------------------------------ lifecycle

    /* The hub, running: Current from the first line, so a request never waits on the start; the kept queues back before the loops begin. */
    public static async Task<Hub> Start(HubConfig config, Action<string> log)
    {
        var hub = new Hub(config, log) { Store = new QueueStore(log) };
        Current = hub;
        History.Wire(hub);
        await hub.RestoreQueues();
        hub.StartSonos();
        hub.Devices.Start();
        hub.StartRegister();
        // Mandarin's audio engine for sound devices on this computer (v0.8.0): the image's, else fetched once in the background where that is allowed.
        if (config.LocalAudio) Local.AudioEngine.StartUp(config.DataDir, Front.Version, log);
        return hub;
    }

    public static void Stop()
    {
        var hub = Current;
        if (hub == null) return;
        Current = null;
        hub.Stopped = true;
        hub.StopSonos();
        hub.Upnp.Stop();
        hub.Phones.Stop();
        hub.Store?.Flush(id => hub.SnapshotOf(id));
    }

    // ------------------------------------------------------------ the revision

    public void Bump()
    {
        List<TaskCompletionSource> woken;
        lock (Gate)
        {
            Revision++;
            woken = [.. waiters];
            waiters.Clear();
        }
        foreach (var w in woken) w.TrySetResult();
    }

    public async Task WaitForChange(double sinceRevision, int timeoutMs)
    {
        TaskCompletionSource tcs;
        lock (Gate)
        {
            if (Revision != sinceRevision) return;
            tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            waiters.Add(tcs);
        }
        using var cts = new CancellationTokenSource(timeoutMs);
        using (cts.Token.Register(() => tcs.TrySetResult())) await tcs.Task;
        lock (Gate) waiters.Remove(tcs);
    }

    public void Watch(string? zoneId) { if (!string.IsNullOrEmpty(zoneId)) lock (Gate) Hot[zoneId] = Now(); }

    // ------------------------------------------------------------ state

    /* Position now, not when the player was last asked. */
    public static double PositionNow(ZoneState? st)
    {
        if (st == null) return 0;
        if (st.State != "playing") return st.Position;
        var p = st.Position + (Now() - st.At) / 1000;
        return st.Duration > 0 ? Math.Min(p, st.Duration) : p;
    }

    public ZoneState? StateOf(string id) { lock (Gate) return State.GetValueOrDefault(id); }

    /*
     * A zone's new state — from a Sonos poll or a phone's report — and what
     * follows from it: a bump when anything visible changed, "track" when a new
     * one starts, "played" once it has been heard, "queue-low" near the end.
     */
    public void ApplyState(string uid, ZoneState prev, ZoneState next)
    {
        bool changed, lowFired = false, played = false, track = false;
        lock (Gate)
        {
            State[uid] = next;
            // A phone's or a renderer's place in its queue, kept across a restart.
            if (Store != null && (Phones.IsPhoneId(uid) || IsUpnp(uid)))
            {
                var structural = prev.QueueLength != next.QueueLength || prev.TrackNumber != next.TrackNumber ||
                    prev.State != next.State || prev.Shuffle != next.Shuffle || prev.Loop != next.Loop;
                Persist(uid, !structural);
            }
            changed = prev.State != next.State || prev.TrackUri != next.TrackUri ||
                prev.TrackNumber != next.TrackNumber || prev.QueueLength != next.QueueLength ||
                prev.Shuffle != next.Shuffle || prev.Loop != next.Loop || prev.Title != next.Title ||
                prev.Unreachable != next.Unreachable || prev.Format != next.Format ||
                !SameVolume(prev.VolumeValue, next.VolumeValue) ||
                // A seek or a drift of more than a couple of seconds from the clock.
                Math.Abs(prev.Position + (prev.State == "playing" ? (next.At - (prev.At > 0 ? prev.At : next.At)) / 1000 : 0) - next.Position) > 3;
            if (prev.TrackUri != next.TrackUri || prev.TrackNumber != next.TrackNumber)
            {
                next.PlayedLogged = false;
                next.LowFired = false;
                if (next.TrackUri.Length > 0) track = true;
            }
            else
            {
                next.PlayedLogged = prev.PlayedLogged;
                next.LowFired = prev.LowFired;
            }
            if (next.State == "playing" && !next.PlayedLogged && next.TrackUri.Length > 0 &&
                next.Position >= Math.Min(30, Math.Max(5, (next.Duration > 0 ? next.Duration : 60) / 2)))
            {
                next.PlayedLogged = true;
                played = true;
            }
            // On the last track of the queue with the end in sight: time to top up.
            if (next.OnQueue && next.State == "playing" && next.Loop == "disabled" && !next.LowFired &&
                next.TrackNumber > 0 && next.TrackNumber >= next.QueueLength &&
                next.Duration > 0 && next.Duration - next.Position < 25)
            {
                next.LowFired = true;
                lowFired = true;
            }
        }
        if (changed) Bump();
        // A Sonos queue kept here whose length changed (added to here or from the Sonos app): read again now.
        if (prev.QueueLength != next.QueueLength && next.OnQueue && !Phones.IsPhoneId(uid) && !IsUpnp(uid)) QueueChanged(uid);
        if (track) OnTrack?.Invoke(uid, next);
        if (played) OnPlayed?.Invoke(uid, next);
        if (lowFired) OnQueueLow?.Invoke(uid, next);
    }

    private static bool SameVolume(Volume? a, Volume? b) => a == null ? b == null : b != null && a.Value == b.Value && a.Muted == b.Muted;

    // ------------------------------------------------------------ kept queues

    /* A phone's or a renderer's queue and place, as the store keeps it; null when empty. */
    public QueueSnapshot? SnapshotOf(string id)
    {
        QueueSnapshot? snap = null;
        if (Phones.IsPhoneId(id)) snap = Phones.Saved(id);
        else if (IsUpnp(id)) snap = UpnpSaved(id);
        if (snap == null) return null;
        var st = State.GetValueOrDefault(id) ?? new ZoneState();
        snap.Id = id;
        snap.Index = Math.Max(0, (st.TrackNumber > 0 ? st.TrackNumber : 1) - 1);
        snap.Seconds = PositionNow(st);
        snap.State = st.State;
        snap.Shuffle = st.Shuffle;
        snap.Loop = st.Loop;
        snap.VolumeValue = st.VolumeValue;
        snap.At = Now();
        return snap;
    }

    /* The queue changed (or, light, only the position): keep it. */
    public void Persist(string id, bool light = false)
    {
        if (Store == null) return;
        var snap = SnapshotOf(id);
        if (snap != null) Store.Save(id, snap, light);
        else Store.Forget(id);
    }

    /* After a start: every phone and renderer queue kept from before, put back with its items rebuilt from the library. */
    public async Task<int> RestoreQueues()
    {
        if (Store == null) return 0;
        var n = 0;
        foreach (var snap in Store.All())
        {
            try
            {
                var items = await RebuildItems(snap.Ids.Where(x => x != null).Select(x => x!.Value).ToList(), snap.Id);
                if (items.Count == 0) { Store.Forget(snap.Id); continue; }
                if (snap.Kind == "phone") Phones.Restore(snap, items);
                else if (snap.Kind == "upnp" && UpnpRestore(snap, items)) { }
                else continue;
                n++;
            }
            catch (Exception e) when (e is HubError or SqliteException or JsError or IOException)
            {
                Store.Forget(snap.Id);
            }
        }
        if (n > 0) Bump();
        return n;
    }

    /* A queue moving between players is rebuilt for the player it goes to (index.js rebuildItems). */
    public async Task<List<PlayItem>> RebuildItems(List<long> ids, string zoneId)
    {
        var s = await Library.CurrentCopy();
        if (s == null) return [];
        using var c = Db.Open();
        var tracks = ids.Select(id => Tracks.Of(c, s, id)).Where(t => t != null).Select(t => t!).ToList();
        return Items.ItemsFor(c, s, this, zoneId, tracks);
    }

    /* The ceiling the stream plan works to: a renderer's, or a phone's USB DAC; null (the Sonos rule) otherwise. */
    public JsObj? TargetFor(string zoneId)
    {
        if (IsUpnp(zoneId)) return UpnpTargetFor(zoneId);
        if (Phones.IsPhoneId(zoneId)) return Phones.TargetFor(zoneId);
        return null;
    }

    // ------------------------------------------------------------ reading

    /* Every zone, sorted by name as the page shows them. */
    public List<ZoneInfo> Zones()
    {
        var list = SonosZones().Concat(Phones.Zones()).Concat(UpnpZones()).ToList();
        list.Sort((a, b) => Library.Lc(a.DisplayName, b.DisplayName));
        return list;
    }

    public ZoneInfo? Zone(string? zoneOrOutputId)
    {
        if (string.IsNullOrEmpty(zoneOrOutputId)) return null;
        if (Phones.Has(zoneOrOutputId)) return Phones.Zones().FirstOrDefault(z => z.ZoneId == zoneOrOutputId);
        if (IsUpnp(zoneOrOutputId)) return UpnpZones().FirstOrDefault(z => z.ZoneId == zoneOrOutputId);
        return SonosZone(zoneOrOutputId);
    }

    public Task<QueueView> Queue(string zoneId)
    {
        if (Phones.IsPhoneId(zoneId)) return Task.FromResult(Phones.Queue(zoneId));
        if (IsUpnp(zoneId)) return Task.FromResult(UpnpQueue(zoneId));
        return SonosQueue(zoneId);
    }
}
