// Devices.cs — every player as one list: the Audio Devices page's model
// (lib/renderers/devices.js, v0.8.49, stage 6 parts 3 and 5). Sonos rooms
// come from the household the hub reads, phones from the app's hello (both
// into the register by Hub.Register.cs), UPnP renderers from Discovery.cs
// here, every minute. Each lands in the register (Playback/Register.cs) so it
// has a durable identity, a network name, the name you gave it, and its
// capabilities in layers (Profiles.cs). Here too: whether a device is on, on
// the network, playing, and the device as its page shows it.
using Mandarin.Server.Local;
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Renderers;

internal sealed class Devices
{
    private const int ScanMs = 60000, LocalMs = 30000;
    private readonly Hub hub;
    private readonly double offlineMs;
    private readonly object gate = new();
    private Task? scanning, scanningLocal;
    private readonly Func<Task<LocalList>> localList;
    public readonly RendererDiscovery Discovery;
    public double LastScan;
    /* This computer's sound devices (Local/LocalDevices.cs): the platform, how many, how many hidden, whether they are turned off. */
    public JsObj Local = Jv.Obj(("platform", OperatingSystem.IsMacOS() ? "darwin" : "linux"), ("hidden", 0.0), ("count", 0.0), ("docker", Environment.GetEnvironmentVariable("DOCKER") == "1"));

    public Devices(Hub hub)
    {
        this.hub = hub;
        offlineMs = hub.Config.UpnpOfflineMs;
        // Renderers on the network within the hour: checked directly when they miss a search round.
        Discovery = new RendererDiscovery(hub.Config.ServerIp is { Length: > 0 } ip ? ip : null, hub.Config.UpnpHosts, hub.Config.UpnpMulticast, hub.Log, () =>
        {
            using var c = Db.Open();
            return Register.All(c).Where(r => r.Kind == "upnp" && r.Location.Length > 0 && Hub.Now() - r.LastSeen < 3600000).Select(r => r.Location).ToList();
        });
        // This computer's sound devices: lib/local/devices.js's list, or a test's stand-in from the hand-over.
        var given = hub.Config.LocalDevices;
        localList = given != null ? () => Task.FromResult(given) : () => LocalDevices.List(hub.Config.LocalAudio);
    }

    public void Start()
    {
        hub.Loop("scan", ScanMs, Scan, 2000);
        hub.Loop("local", LocalMs, ScanLocal, 500);
    }
    public bool Scanning { get { lock (gate) return scanning != null; } }

    /* One discovery round now (the page's "Look again" waits for it). */
    public Task Scan()
    {
        lock (gate)
        {
            if (scanning != null) return scanning;
            scanning = Round();
            return scanning;
        }
    }

    private async Task Round()
    {
        try
        {
            try { await ScanLocal(); } catch (Exception e) when (e is SqliteException or IOException) { hub.Log($"[local] {e.Message}"); }
            var found = await Discovery.Scan();
            using (var c = Db.Open()) foreach (var rec in found) Register.Seen(c, rec);
            LastScan = Hub.Now();
            if (found.Count > 0) hub.Bump();
        }
        catch (Exception e) when (e is SqliteException or IOException) { hub.Log($"[renderers] {e.Message}"); }
        finally { lock (gate) scanning = null; }
    }

    /*
     * This computer's sound devices, every half minute: each into the register
     * as it is found, so a DAC unplugged goes offline as a renderer that left
     * the network does.
     */
    public Task ScanLocal()
    {
        lock (gate)
        {
            if (scanningLocal != null) return scanningLocal;
            scanningLocal = LocalRound();
            return scanningLocal;
        }
    }

    private async Task LocalRound()
    {
        try
        {
            var r = await localList();
            // A Mac's own aren't offered (v0.9.0): Mandarin's audio engine plays through ALSA, so they play
            // through Mandarin DAC Bridge, its DACs found as renderers; the page says so (mac: how many).
            var mac = r.Platform == "darwin";
            List<SeenInfo> offered = mac ? [] : r.Devices;
            using (var c = Db.Open()) foreach (var rec in offered) Register.Seen(c, rec);
            var before = Jv.Num(Local["count"]);
            Local = Jv.Obj(("platform", r.Platform.Length > 0 ? r.Platform : Local["platform"]), ("hidden", (double)r.Hidden), ("count", (double)offered.Count),
                ("docker", Local["docker"]), ("off", r.Off), ("mac", mac ? (double)r.Devices.Count : 0.0));
            if (offered.Count > 0 || before > 0) hub.Bump();
        }
        finally { lock (gate) scanningLocal = null; }
    }

    /*
     * The switch on each device. A renderer found on the network is OFF until
     * you turn it on; a Sonos room is on unless you turn it off. Phones have
     * no switch. The state lives in the register, so it survives restarts.
     */
    public static bool Enabled(DeviceRecord? r)
    {
        if (r == null || r.Kind == "phone") return true;
        var v = r.Settings["enabled"];
        return r.Kind is "upnp" or "local" ? v is true : v is not false;
    }
    public static bool Shared(DeviceRecord? r) => r == null || r.Kind != "phone" || r.Settings["shared"] is not false;
    public static bool Hidden(DeviceRecord? r) => r?.Settings["hidden"] is true;

    public bool Online(DeviceRecord r)
    {
        if (r.Kind == "sonos") return hub.Sonos.Member(r.Id) is { Invisible: false } m && m.Ip.Length > 0;
        if (r.Kind == "phone") return hub.Phones.Has(r.Id);
        return Hub.Now() - r.LastSeen < offlineMs;
    }

    private string StateOf(DeviceRecord r)
    {
        ZoneState? st;
        if (r.Kind == "sonos") { var g = hub.GroupOf(r.Id); st = g == null ? null : hub.StateOf(g.CoordinatorUid); }
        else st = hub.StateOf(r.Id);
        return st?.State is { Length: > 0 } s ? s : "stopped";
    }

    /* The row as devices.js gives it to profiles.js: its fields, caps and settings as objects, and playable (from its caps) beside them. */
    public static JsObj RecordJs(DeviceRecord r) =>
        Jv.Obj(("playable", Jv.T(r.Caps["playable"])), ("id", r.Id), ("kind", r.Kind), ("family", r.Family), ("name", r.Name), ("network_name", r.NetworkName),
            ("manufacturer", r.Manufacturer), ("model", r.Model), ("model_number", r.ModelNumber), ("firmware", r.Firmware), ("ip", r.Ip), ("location", r.Location),
            ("caps", r.Caps), ("settings", r.Settings), ("first_seen", r.FirstSeen), ("last_seen", r.LastSeen));

    /* devices.js json(r, full): the device as its page shows it. */
    public JsObj Json(SqliteConnection c, DeviceRecord r, bool full)
    {
        var online = Online(r);
        var caps = Profiles.Effective(RecordJs(r));
        var streamer = r.Kind is "upnp" or "local";
        var o = Jv.Obj(
            ("id", r.Id), ("kind", r.Kind), ("family", r.Family),
            ("name", r.Name ?? r.NetworkName), ("network_name", r.NetworkName), ("renamed", r.Name != null),
            ("manufacturer", r.Manufacturer), ("model", r.Model), ("model_number", r.ModelNumber), ("firmware", r.Firmware), ("ip", r.Ip),
            ("online", online), ("state", online ? StateOf(r) : "offline"),
            ("enabled", Enabled(r)), ("can_toggle", r.Kind != "phone"), ("hidden", Hidden(r)));
        if (r.Kind == "phone") o["shared"] = Shared(r);
        o["output"] = streamer ? Jv.Obj(
            ("mode", r.Settings["mode"] is string mode && mode is "original" or "x2" or "x4" or "max" ? mode : "original"),
            ("bits", r.Settings["bits"] is double b && b is 24 or 32 ? (object)b : "auto"),
            ("flac32", Transcoder.Flac32)) : null;
        o["first_seen"] = r.FirstSeen; o["last_seen"] = r.LastSeen;
        o["profile"] = caps["profile"]; o["editable"] = caps["editable"];
        o["playable"] = r.Kind != "upnp" || Jv.T(caps["playable"]);
        if (r.Kind == "local") o["location"] = System.Text.RegularExpressions.Regex.Replace(r.Location, "^(alsa|coreaudio|file):", "");
        o["rates"] = caps["rates"]; o["bits"] = caps["bits"]; o["dsd"] = caps["dsd"]; o["containers"] = caps["containers"];
        o["levelling"] = Items.LevellingFor(c, r.Id);
        if (r.Kind != "sonos")
        {
            var dsp = PlaybackRoutes.DspFor(c, r.Id);
            o["dsp"] = dsp;
            var bands = Biquad.BandsOf(dsp);
            o["dsp_info"] = Jv.Obj(("active", Biquad.Active(dsp)), ("bands", (double)bands.Count), ("headroom", Biquad.Headroom(dsp, 48000.0)),
                ("peak", Math.Round(Biquad.PeakDb(bands, 48000) * 10, MidpointRounding.AwayFromZero) / 10));
        }
        if (full)
        {
            if (r.Kind != "local") o["location"] = r.Location;
            o["caps"] = r.Caps; o["settings"] = r.Settings;
            o["found_by"] = r.Kind == "sonos" ? "The Sonos household" : r.Kind == "phone" ? "The Mandarin app"
                : r.Kind == "local" ? (r.Location.StartsWith("coreaudio:", StringComparison.Ordinal) ? "This Mac (Core Audio)" : "This computer (ALSA)") : "UPnP discovery";
            var err = streamer ? hub.Upnp.ErrorOf(r.Id) : null;
            o["last_error"] = err is { } e ? Jv.Obj(("at", e.At), ("message", e.Message)) : null;
            o["openhome"] = Jv.T(r.Caps["openhome"]);
            o["events"] = r.Kind == "upnp" ? hub.Upnp.EventsOf(r.Id) : null;
            // Volume: set on the device itself, or Mandarin's slider. Renderers only; never a Sonos room.
            o["volume_fixed"] = streamer && Players.FixedVolume(r);
            o["can_fix_volume"] = streamer && Jv.T(r.Caps["playable"]);
            o["takes_flac"] = r.Kind != "upnp" || Players.TakesFlac(r);
        }
        return o;
    }

    /* The list, the playing first, then those online, by name. */
    public List<JsObj> List(SqliteConnection c)
    {
        static int Rank(JsObj d) => Jv.Same(d["state"], "playing") || Jv.Same(d["state"], "loading") ? 0 : Jv.T(d["online"]) ? 1 : 2;
        var list = Register.All(c).Select(r => Json(c, r, false)).ToList();
        list.Sort((a, b) => Rank(a) - Rank(b) is var d && d != 0 ? d : Library.Lc(Jv.Str(a["name"]), Jv.Str(b["name"])));
        return list;
    }

    public JsObj? Get(SqliteConnection c, string id) => Register.Get(c, id) is { } r ? Json(c, r, true) : null;

    /* api-devices.js withRadio: the zone a device plays in, and its Random Album Radio switch. */
    public JsObj WithRadio(SqliteConnection c, JsObj d, string id)
    {
        var zone = ZoneIdOf(id);
        d["zone_id"] = zone;
        d["radio"] = History.RadioEnabled(c, zone);
        return d;
    }
    public string ZoneIdOf(string id) => hub.Zone(id)?.ZoneId ?? id;

    /* A phone's page is there within ten seconds of its hello; asked sooner than that, it is brought up to date now. */
    public string? OwnPhone(SqliteConnection c, Device? dev)
    {
        if (dev == null || dev.Kind != "android") return null;
        var id = Phones.UidFor(dev.Id);
        if (Register.Get(c, id) == null) hub.SyncKnown();
        return Register.Get(c, id) != null ? id : null;
    }
}
