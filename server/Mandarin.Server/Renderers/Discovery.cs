// Discovery.cs — finding UPnP/DLNA renderers and reading what they are
// (lib/renderers/discovery.js, v0.8.49, stage 6 part 3). One round: an
// M-SEARCH for MediaRenderer devices (plus any UPNP_HOSTS seeds, for networks
// where multicast is unreliable), then for each answer its description
// (Description.cs), its ConnectionManager Sink list (ProtocolInfo.cs), and —
// when it looks like LinkPlay firmware — the WiiM-style HTTP API for the name
// its own app uses. Descriptions are cached by location, so a device already
// read costs nothing on later rounds unless its address changed; a renderer
// seen lately that missed a round is asked directly, quietly.
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

internal sealed class RendererDiscovery
{
    private const double RecheckMs = 10 * 60 * 1000;   // re-read a description / sink after this long

    private readonly string? bindIp;
    private readonly bool multicast;
    private readonly Action<string> log;
    private readonly Func<List<string>> known;
    private readonly List<string> seeds;
    private readonly object gate = new();
    private readonly Dictionary<string, (double At, SeenInfo? Record)> cache = [];   // location -> what was read
    private readonly HashSet<string> heard = [];   // places announced since the last round (SsdpListen.cs)
    public string LastError = "";

    public RendererDiscovery(string? bindIp, IEnumerable<string> seedHosts, bool multicast, Action<string> log, Func<List<string>> known)
    {
        this.bindIp = bindIp;
        this.multicast = multicast;
        this.log = log;
        this.known = known;
        seeds = seedHosts.Select(SeedLocation).Where(s => s.Length > 0).ToList();
    }

    public static string IdFor(string? udn) => "UPNP_" + System.Text.RegularExpressions.Regex.Replace(udn ?? "", "^uuid:", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim();

    /* UPNP_HOSTS: an IP (tried at the ports renderers usually use) or a full description URL. */
    public static string SeedLocation(string? s)
    {
        var v = (s ?? "").Trim();
        if (v.Length == 0) return "";
        if (v.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || v.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return v;
        return $"http://{v}:49152/description.xml";
    }

    /* The player read at this place, if one was (SsdpListen: an announcement from it may need no round). */
    public string? Known(string location) { lock (gate) return cache.TryGetValue(location, out var hit) ? hit.Record?.Id : null; }

    /* A place a renderer announced: read in the next round, as an answer to its search. */
    public void Heard(string location) { lock (gate) heard.Add(location); }

    /* A device forgotten: read afresh if it comes back. */
    public void Forget(string id) { lock (gate) foreach (var k in cache.Where(kv => kv.Value.Record?.Id == id).Select(kv => kv.Key).ToList()) cache.Remove(k); }

    /* One round → the renderers found, as the register takes them. */
    public async Task<List<SeenInfo>> Scan()
    {
        var answers = multicast ? await Ssdp.Search(bindIp) : [];
        var locations = new Dictionary<string, SsdpAnswer>();
        foreach (var a in answers)
        {
            if (Ssdp.IsSonos(a)) continue;
            if (a.Location.Length > 0) locations.TryAdd(a.Location, a);
        }
        foreach (var loc in seeds) locations.TryAdd(loc, new SsdpAnswer(loc, "", "", "", ""));
        lock (gate) { foreach (var loc in heard) locations.TryAdd(loc, new SsdpAnswer(loc, "", "", "", "")); heard.Clear(); }
        // A renderer seen lately that didn't answer this time: asked directly, quietly (one that has gone is simply not found).
        List<string> lately;
        try { lately = known(); } catch (Exception e) when (e is Microsoft.Data.Sqlite.SqliteException or IOException) { lately = []; }
        foreach (var loc in lately) if (loc.Length > 0) locations.TryAdd(loc, new SsdpAnswer(loc, "", "", "", "", Quiet: true));
        var found = await Task.WhenAll(locations.Values.Select(Describe));
        return found.Where(r => r != null).Select(r => r!).ToList();
    }

    /*
     * A device that answered the search is alive and, once read, known; a seed
     * has answered nothing, so its description is fetched every round — that
     * fetch is what says it is still there — while its sink list and probe are
     * reused until the next re-check.
     */
    private async Task<SeenInfo?> Describe(SsdpAnswer answer)
    {
        var loc = answer.Location;
        (double At, SeenInfo? Record) hit;
        bool had;
        lock (gate) had = cache.TryGetValue(loc, out hit);
        var fresh = had && hit.Record != null && Hub.Now() - hit.At < RecheckMs;
        if (fresh && answer.Usn.Length > 0) return hit.Record;
        try
        {
            var xml = await SoapHttp.HttpGet(loc, 5000);
            var d = Description.Parse(xml, loc) ?? throw new RendererError("not a UPnP device description", double.NaN);
            var services = d["services"] as JsObj ?? new JsObj();
            if (!Jv.T(d["renderer"]) && !services.Has("AVTransport")) throw new RendererError("not a media renderer", double.NaN);
            var udn = Jv.Str(d["udn"]);
            var manufacturer = Jv.Str(d["manufacturer"]);
            if (udn.StartsWith("uuid:RINCON_", StringComparison.OrdinalIgnoreCase) || manufacturer.Contains("sonos", StringComparison.OrdinalIgnoreCase))
            {
                lock (gate) cache[loc] = (Hub.Now(), null);
                return null;
            }
            if (fresh && hit.Record!.Id == IdFor(udn))
            {
                if (hit.Record.Linkplay == null && Jv.Str(d["friendlyName"]).Length > 0) hit.Record.NetworkName = Jv.Str(d["friendlyName"]);
                return hit.Record;
            }
            var host = WebUrl.Hostname(loc) ?? "";
            var modelName = Jv.Str(d["modelName"]);
            var rec = new SeenInfo
            {
                Id = IdFor(udn), Kind = "upnp", Family = Jv.T(d["openhome"]) ? "openhome" : "generic",
                NetworkName = Jv.Str(d["friendlyName"]) is { Length: > 0 } fn ? fn : modelName.Length > 0 ? modelName : host,
                Manufacturer = manufacturer, Model = modelName, ModelNumber = Jv.Str(d["modelNumber"]), Firmware = "", Ip = host, Location = loc,
                Playable = services.Has("AVTransport"), Openhome = Jv.T(d["openhome"]),
                Services = new JsObj(), Events = new JsObj(), Caps = new JsObj()
            };
            foreach (var k in services.Keys)
            {
                var svc = services[k] as JsObj ?? new JsObj();
                rec.Services![k] = svc["controlUrl"];
                if (Jv.T(svc["eventSubUrl"])) rec.Events![k] = svc["eventSubUrl"];
            }
            var advertised = Jv.Obj(("mimes", new List<object?>()), ("containers", new List<object?>()), ("rates", new List<object?>()));
            if (services["ConnectionManager"] is JsObj cm)
            {
                try
                {
                    var r = await SoapHttp.Call(Jv.Str(cm["controlUrl"]), Jv.Str(cm["type"]), "GetProtocolInfo", new JsObj(), 5000);
                    advertised = ProtocolInfo.ParseSink(r["Sink"]);
                }
                catch (UPnPError e) { advertised["error"] = e.Message; }
            }
            rec.Caps!["advertised"] = advertised;
            var blurb = manufacturer + " " + modelName;
            if (Jv.T(d["linkplayHint"]) || blurb.Contains("linkplay", StringComparison.OrdinalIgnoreCase) || blurb.Contains("wiim", StringComparison.OrdinalIgnoreCase))
            {
                var u = WebUrl.Parse(loc, null);
                var baseUrl = u?.Host is { Length: > 0 } uh ? $"{u.Scheme}://{uh}{(u.Port is { } pt ? ":" + pt.ToString(System.Globalization.CultureInfo.InvariantCulture) : "")}" : "";
                var lp = await LinkPlay.Probe(host, baseUrl.Length > 0 ? [baseUrl] : []);
                if (lp != null)
                {
                    rec.Family = "wiim";
                    rec.Firmware = lp.Firmware;
                    rec.Linkplay = Jv.Obj(("base", lp.Base), ("project", lp.Project), ("hardware", lp.Hardware), ("uuid", lp.Uuid), ("deviceName", lp.DeviceName));
                    if (lp.DeviceName.Length > 0) rec.NetworkName = lp.DeviceName;
                }
            }
            lock (gate) cache[loc] = (Hub.Now(), rec);
            return rec;
        }
        catch (Exception e) when (e is UPnPError or RendererError or XmlRefused or JsError)
        {
            // A known renderer checked directly and not there keeps what it had: its record is still right should it come back.
            if (answer.Quiet) return null;
            lock (gate) cache[loc] = (Hub.Now(), null);
            LastError = $"{loc}: {e.Message}";
            log($"[renderers] {loc}: {e.Message}");
            return null;
        }
    }
}
