// SonosDevice.cs — one Sonos player's UPnP services, typed (lib/sonos/device.js
// and the sending half of soap.js, v0.8.49, stage 6 part 2). Sonos does not use
// the control URLs a stock MediaRenderer would, so they are fixed here rather
// than read from the description document. The envelope and the answer are
// Soap.cs's (held to soap.js since v0.8.37); here is the HTTP: a keep-alive
// pool of four connections, the SOAPACTION header, the ten-second timeout, one
// retry on a connection the player closed (a Sonos does after a while), and
// every failure — a fault, a timeout, a refused connection — one UPnPError.
using System.Net;
using System.Net.Sockets;
using System.Text;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

using TJs = Mandarin.Server.Tags.Js;

internal sealed class SonosDevice(string ip, string uid = "", string name = "")
{
    public const int Port = 1400;
    public const string AvTransport = "urn:schemas-upnp-org:service:AVTransport:1";
    public const string RenderingControl = "urn:schemas-upnp-org:service:RenderingControl:1";
    public const string ContentDirectory = "urn:schemas-upnp-org:service:ContentDirectory:1";
    public const string ZoneGroupTopology = "urn:schemas-upnp-org:service:ZoneGroupTopology:1";

    private static readonly Dictionary<string, string> ControlPaths = new()
    {
        [AvTransport] = "/MediaRenderer/AVTransport/Control",
        [RenderingControl] = "/MediaRenderer/RenderingControl/Control",
        ["urn:schemas-upnp-org:service:GroupRenderingControl:1"] = "/MediaRenderer/GroupRenderingControl/Control",
        [ContentDirectory] = "/MediaServer/ContentDirectory/Control",
        [ZoneGroupTopology] = "/ZoneGroupTopology/Control",
        ["urn:schemas-upnp-org:service:DeviceProperties:1"] = "/DeviceProperties/Control"
    };

    /* Sonos' play modes, as the pair the interface thinks in. */
    public static readonly (string Mode, bool Shuffle, string Loop)[] PlayModes =
    [
        ("NORMAL", false, "disabled"), ("REPEAT_ALL", false, "loop"), ("REPEAT_ONE", false, "loop_one"),
        ("SHUFFLE_NOREPEAT", true, "disabled"), ("SHUFFLE", true, "loop"), ("SHUFFLE_REPEAT_ONE", true, "loop_one")
    ];
    public static (bool Shuffle, string Loop) ModeOf(string? mode)
    {
        foreach (var (m, s, l) in PlayModes) if (m == mode) return (s, l);
        return (false, "disabled");
    }
    public static string PlayModeFor(bool shuffle, string loop)
    {
        foreach (var (m, s, l) in PlayModes) if (s == shuffle && l == loop) return m;
        return "NORMAL";
    }

    // Keep-alive, four connections a player at most, as soap.js's agent; the timeout is each call's own.
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        UseProxy = false, MaxConnectionsPerServer = 4, PooledConnectionIdleTimeout = TimeSpan.FromSeconds(60), AllowAutoRedirect = false
    }) { Timeout = Timeout.InfiniteTimeSpan };

    public string Ip => ip;
    public string Uid => uid;
    public string Name => name;
    public string BaseUrl => $"http://{ip}:{Port}";

    /* One action: its answer's arguments by name, or the UPnPError (the player's fault, or that it couldn't be reached). */
    public async Task<JsObj> Call(string service, string action, JsObj? args = null, int timeoutMs = 10000, int attempt = 0)
    {
        var url = BaseUrl + ControlPaths[service];
        var payload = Soap.BuildRequest(service, action, args ?? new JsObj());
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = new StringContent(payload, Encoding.UTF8) };
            req.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("text/xml") { CharSet = "\"utf-8\"" };
            req.Headers.TryAddWithoutValidation("SOAPACTION", $"\"{service}#{action}\"");
            using var cts = new CancellationTokenSource(timeoutMs);
            using var res = await Http.SendAsync(req, HttpCompletionOption.ResponseContentRead, cts.Token);
            var text = await res.Content.ReadAsStringAsync(cts.Token);
            if ((int)res.StatusCode >= 400 && !text.Contains("Fault")) throw UPnPError.Of(501, $"HTTP {(int)res.StatusCode} from {url}");
            return Soap.ParseResponse(text, action);
        }
        catch (OperationCanceledException) { throw UPnPError.Of(501, $"Sonos player at {ip}:{Port} is not responding: timed out"); }
        catch (HttpRequestException e)
        {
            // A connection the player closed after answering an earlier call: once more on a fresh one (soap.js, v0.7.1).
            if (attempt == 0 && e.InnerException is IOException or SocketException { SocketErrorCode: SocketError.ConnectionReset })
                return await Call(service, action, args, timeoutMs, 1);
            throw UPnPError.Of(501, $"Sonos player at {ip}:{Port} is not responding: {e.Message}");
        }
    }

    /* httpGet(): a document from the player (its description), the text; a UPnPError when it isn't 200. */
    public static async Task<string> HttpGet(string url, int timeoutMs = 8000)
    {
        try
        {
            using var cts = new CancellationTokenSource(timeoutMs);
            using var res = await Http.GetAsync(url, cts.Token);
            if (res.StatusCode != HttpStatusCode.OK) throw UPnPError.Of(501, $"HTTP {(int)res.StatusCode} fetching {url}");
            return await res.Content.ReadAsStringAsync(cts.Token);
        }
        catch (OperationCanceledException) { throw UPnPError.Of(501, "timed out"); }
        catch (HttpRequestException e) { throw UPnPError.Of(501, e.Message); }
    }

    private static JsObj Args(params (string Key, object? Value)[] kv)
    {
        var o = new JsObj();
        o["InstanceID"] = 0.0;
        foreach (var (k, v) in kv) o[k] = v;
        return o;
    }
    private Task<JsObj> Avt(string action, params (string Key, object? Value)[] kv) => Call(AvTransport, action, Args(kv));
    private Task<JsObj> Rc(string action, params (string Key, object? Value)[] kv) => Call(RenderingControl, action, Args(kv));

    // -- transport --
    public Task Play() => Avt("Play", ("Speed", 1.0));
    public Task Pause() => Avt("Pause");
    public Task Stop() => Avt("Stop");
    public Task Next() => Avt("Next");
    public Task Previous() => Avt("Previous");
    public Task Seek(string unit, string target) => Avt("Seek", ("Unit", unit), ("Target", target));
    public Task SeekTrack(double n) => Seek("TRACK_NR", TJs.Num(n));
    public Task SeekTime(double seconds) => Seek("REL_TIME", Didl.Hms(seconds));
    public Task SetAVTransportURI(string uri, string meta = "") => Avt("SetAVTransportURI", ("CurrentURI", uri), ("CurrentURIMetaData", meta));
    public Task SetPlayMode(string mode) => Avt("SetPlayMode", ("NewPlayMode", mode));
    public Task<JsObj> GetTransportInfo() => Avt("GetTransportInfo");
    public Task<JsObj> GetPositionInfo() => Avt("GetPositionInfo");
    public Task<JsObj> GetMediaInfo() => Avt("GetMediaInfo");
    public Task<JsObj> GetTransportSettings() => Avt("GetTransportSettings");
    public Task BecomeStandalone() => Avt("BecomeCoordinatorOfStandaloneGroup");
    public Task JoinGroup(string coordinatorUid) => SetAVTransportURI($"x-rincon:{coordinatorUid}");

    // -- queue --
    public string QueueUri() => $"x-rincon-queue:{uid}#0";
    public Task ClearQueue() => Avt("RemoveAllTracksFromQueue");
    public Task AddToQueue(string uri, string meta = "", double position = 0, bool asNext = false) =>
        Avt("AddURIToQueue", ("EnqueuedURI", uri), ("EnqueuedURIMetaData", meta), ("DesiredFirstTrackNumberEnqueued", position), ("EnqueueAsNext", asNext ? 1.0 : 0.0));
    /*
     * Up to 16 items in one round trip. The URIs and metadata documents are
     * space-separated, which is how Sonos' own controllers send them; the URIs
     * never contain a space because the server percent-encodes them.
     */
    public Task AddMultipleToQueue(List<PlayItem> items, double position = 0, bool asNext = false) =>
        Avt("AddMultipleURIsToQueue", ("UpdateID", 0.0), ("NumberOfURIs", (double)items.Count),
            ("EnqueuedURIs", string.Join(" ", items.Select(i => i.Uri))), ("EnqueuedURIsMetaData", string.Join(" ", items.Select(i => i.Meta))),
            ("ContainerURI", ""), ("ContainerMetaData", ""), ("DesiredFirstTrackNumberEnqueued", position), ("EnqueueAsNext", asNext ? 1.0 : 0.0));
    public Task RemoveTrackFromQueue(double trackNumber) => Avt("RemoveTrackFromQueue", ("ObjectID", $"Q:0/{TJs.Num(trackNumber)}"), ("UpdateID", 0.0));
    public Task ReorderQueue(double start, double count, double insertBefore) =>
        Avt("ReorderTracksInQueue", ("StartingIndex", start), ("NumberOfTracks", count), ("InsertBefore", insertBefore), ("UpdateID", 0.0));

    public sealed record Browsed(List<JsObj> Items, double Total, double UpdateId);
    public async Task<Browsed> BrowseQueue(double start = 0, double count = 1000)
    {
        var a = new JsObj();
        a["ObjectID"] = "Q:0"; a["BrowseFlag"] = "BrowseDirectChildren";
        a["Filter"] = "dc:title,res,dc:creator,upnp:artist,upnp:album,upnp:albumArtURI";
        a["StartingIndex"] = start; a["RequestedCount"] = count; a["SortCriteria"] = "";
        var r = await Call(ContentDirectory, "Browse", a);
        return new Browsed(Didl.ParseItems(Jv.T(r["Result"]) ? r["Result"] : ""), NumOr0(r["TotalMatches"]), NumOr0(r["UpdateID"]));
    }
    private static double NumOr0(object? v) { var n = TJs.ToNumber(v); return double.IsNaN(n) ? 0 : n; }

    // -- rendering --
    public async Task<double> GetVolume() => NumOr0((await Rc("GetVolume", ("Channel", "Master")))["CurrentVolume"]);
    public Task SetVolume(double v) => Rc("SetVolume", ("Channel", "Master"), ("DesiredVolume", Math.Max(0, Math.Min(100, TJs.Round(v)))));
    public Task SetRelativeVolume(double delta) => Rc("SetRelativeVolume", ("Channel", "Master"), ("Adjustment", TJs.Round(delta)));
    public async Task<bool> GetMute()
    {
        var m = (await Rc("GetMute", ("Channel", "Master")))["CurrentMute"];
        return Jv.Same(m, "1") || Jv.Same(m, "true");
    }
    public Task SetMute(bool m) => Rc("SetMute", ("Channel", "Master"), ("DesiredMute", m ? 1.0 : 0.0));

    // -- informational --
    public async Task<string> GetZoneGroupState(int timeoutMs = 10000)
    {
        var r = await Call(ZoneGroupTopology, "GetZoneGroupState", new JsObj(), timeoutMs);
        return Jv.T(r["ZoneGroupState"]) ? Jv.Str(r["ZoneGroupState"]) : "";
    }
}
