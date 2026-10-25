// Renderer.cs — one UPnP media renderer's transport and volume, typed
// (lib/renderers/renderer.js, v0.8.49, stage 6 part 3): the plain AVTransport
// and RenderingControl services every DLNA renderer offers, at the control
// URLs its description gave — where a Sonos player has fixed paths of its own.
// A sound device on this computer answers the same calls (part 4).
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

/* What a player the server keeps the queue for answers: a renderer over UPnP, or a sound device here. */
internal interface IRenderer
{
    string Name { get; }
    Task Play();
    Task Pause();
    Task Stop();
    Task SeekTime(double seconds);
    Task SetUri(string uri, string meta = "");
    Task SetNextUri(string uri, string meta = "");
    Task<JsObj> GetTransportInfo();
    Task<JsObj> GetPositionInfo();
    Task<double> GetVolume();
    Task SetVolume(double v);
    Task<bool> GetMute();
    Task SetMute(bool m);
    /* A sound device on this computer says what went wrong itself; a renderer never. */
    Exception? TakeError() => null;
    /* Stopped with the server, or let go. */
    void Halt() { }
}

/* A call a renderer refused or didn't answer: the renderer's name first, as renderer.js words it; the UPnP code kept. */
internal sealed class RendererError(string message, double code) : Exception(message)
{
    public double Code => code;
}

/* unanswered: told of each call the device didn't answer at all (Players: what the room shows of it is then not its own). */
internal sealed class Renderer(string id, string? name, JsObj? services, Action? unanswered = null) : IRenderer
{
    public const string AvTransport = "urn:schemas-upnp-org:service:AVTransport:1";
    public const string RenderingControl = "urn:schemas-upnp-org:service:RenderingControl:1";

    public string Id => id;
    public string Name { get; } = name is { Length: > 0 } ? name : id;
    private readonly string avtUrl = services != null && Jv.T(services["AVTransport"]) ? Jv.Str(services["AVTransport"]) : "";
    private readonly string rcUrl = services != null && Jv.T(services["RenderingControl"]) ? Jv.Str(services["RenderingControl"]) : "";

    private async Task<JsObj> Call(string url, string type, string action, JsObj args, int timeoutMs = 8000)
    {
        if (url.Length == 0) throw new RendererError($"{Name} has no {type.Split(':')[3]} service", double.NaN);
        try { return await SoapHttp.Call(url, type, action, args, timeoutMs); }
        catch (UPnPError e)
        {
            if (e.Unanswered) unanswered?.Invoke();
            var msg = e.Message;
            const string prefix = "Sonos player at ";
            if (msg.StartsWith(prefix, StringComparison.Ordinal) && msg.IndexOf(" is not responding: ", StringComparison.Ordinal) is var i && i > 0)
                msg = msg[(i + " is not responding: ".Length)..];
            throw new RendererError($"{Name}: {msg}", e.Code);
        }
    }

    private static JsObj Args(bool channel, params (string Key, object? Value)[] kv)
    {
        var o = new JsObj();
        o["InstanceID"] = 0.0;
        if (channel) o["Channel"] = "Master";
        foreach (var (k, v) in kv) o[k] = v;
        return o;
    }
    private Task<JsObj> Avt(string action, params (string Key, object? Value)[] kv) => Call(avtUrl, AvTransport, action, Args(false, kv));
    private Task<JsObj> Rc(string action, params (string Key, object? Value)[] kv) => Call(rcUrl, RenderingControl, action, Args(true, kv));

    // -- transport --
    public Task Play() => Avt("Play", ("Speed", 1.0));
    public Task Pause() => Avt("Pause");
    public Task Stop() => Avt("Stop");
    public Task SeekTime(double seconds) => Avt("Seek", ("Unit", "REL_TIME"), ("Target", Didl.Hms(seconds)));
    public Task SetUri(string uri, string meta = "") => Avt("SetAVTransportURI", ("CurrentURI", uri), ("CurrentURIMetaData", meta));
    public Task SetNextUri(string uri, string meta = "") => Avt("SetNextAVTransportURI", ("NextURI", uri), ("NextURIMetaData", meta));
    public Task<JsObj> GetTransportInfo() => Avt("GetTransportInfo");
    public Task<JsObj> GetPositionInfo() => Avt("GetPositionInfo");
    public Task<JsObj> GetMediaInfo() => Avt("GetMediaInfo");

    // -- volume --
    public async Task<double> GetVolume() { var n = Tags.Js.ToNumber((await Rc("GetVolume"))["CurrentVolume"]); return double.IsNaN(n) ? 0 : n; }
    public Task SetVolume(double v) => Rc("SetVolume", ("DesiredVolume", Math.Max(0, Math.Min(100, Tags.Js.Round(v)))));
    public async Task<bool> GetMute() { var m = (await Rc("GetMute"))["CurrentMute"]; return Jv.Same(m, "1") || Jv.Same(m, "true"); }
    public Task SetMute(bool m) => Rc("SetMute", ("DesiredMute", m ? 1.0 : 0.0));
}
