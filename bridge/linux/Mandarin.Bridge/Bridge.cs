// Bridge.cs — this computer as a UPnP MediaRenderer on the network (the Android app's DacService.kt): the DAC chosen
// (the one set on its web page, else the first USB DAC found), played through the audio engine (Player.cs) and nothing
// else. What the DAC takes is what the renderer advertises (Sink): a raw-PCM entry per rate, so a control point that
// reads rates from ProtocolInfo (Mandarin does) has them all, the containers Mandarin sends, and DSD where the DAC takes
// it; everything, with what plays now, at /dac.json. A DAC plugged in or taken out changes the description's address,
// so a control point that caches descriptions by address reads it afresh, and the change is announced.
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json.Nodes;

namespace Mandarin.Bridge;

internal sealed partial class Bridge
{
    private static readonly string[] Containers = ["audio/flac", "audio/x-flac", "audio/wav", "audio/x-wav", "audio/wave", "audio/aiff", "audio/x-aiff",
        "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/opus"];
    private static readonly string[] DsdMimes = ["audio/x-dsf", "audio/x-dff", "audio/dsd", "audio/x-dsd"];

    private readonly Options opts;
    private readonly Store store;
    private readonly Player player;
    private readonly Renderer renderer;
    private readonly Http http;
    private readonly Ssdp ssdp;
    private readonly Action<string> log;
    private readonly Wifi? wifi;
    // Updated from Mandarin's Settings → Updates (item 291).
    private readonly Update update;
    private readonly DateTime started = DateTime.UtcNow;
    private volatile List<Dac> dacs = [];
    private string lastCaps = "";
    public (string From, DateTime At)? LastControl { get; private set; }

    public Bridge(Options opts, Action<string> log)
    {
        (this.opts, this.log) = (opts, log);
        store = new Store(opts.Data);
        player = new Player(opts.Engine, opts.Ffmpeg, log);
        renderer = new Renderer(player, Sink, () => { }, log);
        http = new Http(opts.Port, Route, log);
        ssdp = new Ssdp(store.Udn, Location, log);
        if (opts.Nmcli != null) wifi = new Wifi(opts.Nmcli, log);
        update = new Update(opts.UpdateApi, opts.Data, log, Program.Restart);
    }

    /* The DAC played to: the one chosen, else the first found; null with none plugged in. */
    public Dac? Dac
    {
        get
        {
            var list = dacs;
            return list.FirstOrDefault(d => d.Key == store.Dac) ?? list.FirstOrDefault();
        }
    }

    public void Start()
    {
        Look();
        http.Start();
        ssdp.Start();
        new Thread(Heartbeat) { IsBackground = true, Name = "heartbeat" }.Start();
        log($"[bridge] \"{store.Name}\" at {BaseUrl() ?? "(no network yet)"}");
    }

    public void Stop() { ssdp.Stop(); http.Stop(); player.Close(); }

    // The DACs looked at again (every few seconds): one plugged in or taken out, the engine opened on the one now played to, and the change said.
    private void Look()
    {
        dacs = Dacs.Find(opts.Asound);
        var d = Dac;
        var nativeDsd = store.DsdMode == "native" ? d?.EngineDsd ?? "" : "";
        // The DAC found, played to where it is (or, given --device, there: the tests' file); none, the engine closed.
        if (d != null)
        {
            var was = player.IsOpen;
            player.Open(opts.Device.Length > 0 ? opts.Device : d.Location, nativeDsd);
            if (!was) renderer.DacCame();
        }
        else player.Close();
        var caps = Sink() + "|" + DacJson()["dac"]?.ToJsonString();
        if (caps != lastCaps)
        {
            var first = lastCaps.Length == 0;
            lastCaps = caps;
            if (!first) { log("[bridge] the DAC changed: " + (d?.Name ?? "none")); ssdp.Alive(); }
            renderer.Evented();
        }
    }

    private void Heartbeat()
    {
        var alive = DateTime.UtcNow;
        while (true)
        {
            Thread.Sleep(Math.Clamp(opts.SetupAfter * 1000, 1000, 5000));
            try { Look(); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { log("[bridge] " + e.Message); }
            if (DateTime.UtcNow - alive > TimeSpan.FromMinutes(10)) { alive = DateTime.UtcNow; ssdp.Alive(); }
            // No network a while after starting (a Pi just flashed, or a network gone): the setup network, so its page can be reached.
            if (wifi != null && !wifi.Hotspot && DateTime.UtcNow - started > TimeSpan.FromSeconds(opts.SetupAfter) && !wifi.Connected()) wifi.OpenSetup();
        }
    }

    /* The DSD this DAC is given, as the setting says: native words where it takes them (DoP for the rest), DoP only, or none. */
    private List<int> Dsd(Dac d) => store.DsdMode switch
    {
        "pcm" => [],
        "dop" => d.Dop,
        _ => [.. d.Native.Union(d.Dop).Order()],
    };

    /* ConnectionManager's Sink: what the DAC takes, as ProtocolInfo entries; the floor (44.1 and 48, 16-bit) with no DAC. */
    public string Sink()
    {
        var d = Dac;
        var entries = new List<string>();
        var deep = (d?.Bits.DefaultIfEmpty(16).Max() ?? 16) >= 24;
        foreach (var r in d is { Rates.Count: > 0 } ? d.Rates : [44100, 48000])
        {
            entries.Add($"http-get:*:audio/L16;rate={r};channels=2:*");
            if (deep) entries.Add($"http-get:*:audio/L24;rate={r};channels=2:*");
        }
        entries.AddRange(Containers.Select(m => $"http-get:*:{m}:*"));
        if (d != null && Dsd(d).Count > 0) entries.AddRange(DsdMimes.Select(m => $"http-get:*:{m}:*"));
        return string.Join(",", entries);
    }

    /* /dac.json: the DAC, what it takes, and what it is being fed (the Android app's, the same words). */
    public JsonObject DacJson()
    {
        var d = Dac;
        var dac = new JsonObject { ["attached"] = d != null, ["permission"] = d != null };
        if (d != null)
        {
            dac["device"] = d.Name; dac["manufacturer"] = d.Maker.Length > 0 ? d.Maker : null; dac["usb_id"] = d.UsbId; dac["card"] = d.Card;
            dac["volume_control"] = false; dac["fixed"] = true; dac["dsd_mode"] = store.DsdMode;
            // Every depth up to the DAC's widest format: a shallower sample goes to the DAC in that format.
            var widest = d.Bits.DefaultIfEmpty(0).Max();
            dac["rates"] = new JsonArray([.. d.Rates.Select(r => (JsonNode)r)]);
            dac["bits"] = new JsonArray([.. new[] { 16, 24, 32 }.Where(b => b <= widest).Union(d.Bits).Order().Select(b => (JsonNode)b)]);
            dac["dac_bits"] = new JsonArray([.. d.Bits.Select(b => (JsonNode)b)]);
            dac["dsd"] = new JsonArray([.. Dsd(d).Select(m => (JsonNode)m)]);
            dac["dsd_native"] = new JsonArray([.. d.Native.Select(m => (JsonNode)m)]);
            dac["dsd_dop"] = new JsonArray([.. d.Dop.Select(m => (JsonNode)m)]);
        }
        var now = player.Now();
        return new JsonObject
        {
            ["model"] = Scpd.Model, ["version"] = Program.Version, ["platform"] = "linux", ["name"] = store.Name, ["udn"] = store.Udn, ["dac"] = dac,
            // Which build it is, for which machine, and that Mandarin can update it (POST /update, item 291): where that is.
            ["commit"] = Program.Commit, ["arch"] = Update.Arch, ["updates"] = true, ["update"] = update.State(), ["log"] = "/log",
            // The engine gives the DAC every PCM track in 32-bit words, at its gain of 1 whatever the volume asked (the Bridge
            // has no volume of its own: Player.cs): said as it is (item 287), the samples untouched.
            ["now"] = now is { } n ? new JsonObject
            {
                ["rate"] = n.Rate, ["bits"] = n.Kind == "pcm" ? 32 : 0, ["kind"] = n.Kind, ["dsd"] = n.Dsd, ["transport"] = renderer.TransportState(),
                ["volume"] = "fixed", ["level"] = 100, ["untouched"] = true,
            } : null,
        };
    }

    /*
     * Where this computer is on the home network: the address it would reach the world from (its default route,
     * asked of the system by a UDP "connect", which sends nothing), so a Docker or VPN bridge (docker0, 172.17.x.x) is
     * never the one said; with no route (a Pi on its own setup Wi-Fi), the first IPv4 address of an interface that is up.
     */
    public static IPAddress? LanAddress()
    {
        try
        {
            using var s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            s.Connect(new IPEndPoint(IPAddress.Parse("192.0.2.1"), 9));
            if (s.LocalEndPoint is IPEndPoint { Address: var a } && !IPAddress.Any.Equals(a) && !IPAddress.IsLoopback(a)) return a;
        }
        catch (SocketException) { /* no route: the interfaces, below */ }
        try
        {
            return NetworkInterface.GetAllNetworkInterfaces()
                .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .SelectMany(n => n.GetIPProperties().UnicastAddresses).Select(a => a.Address)
                .FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a));
        }
        catch (NetworkInformationException) { return null; }
    }

    public string? BaseUrl() => (opts.Address ?? LanAddress()?.ToString()) is { } a ? $"http://{a}:{http.Port}" : null;

    // The description's address: the hash of its name and everything said of the DAC, so any change is a new address.
    private string? Location() => BaseUrl() is { } b ? b + "/description.xml?caps=" + Fnv(store.Name + "|" + Sink() + "|" + DacJson()["dac"]?.ToJsonString()) : null;

    // A hash that is the same from one start to the next (string.GetHashCode isn't).
    private static string Fnv(string s)
    {
        var h = 2166136261u;
        foreach (var c in s) { h ^= c; h *= 16777619u; }
        return h.ToString("x8", System.Globalization.CultureInfo.InvariantCulture);
    }
}
