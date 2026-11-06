// SlimRenderer.cs — a SlimProto player answering as a renderer does (bug list item 312), so that the queue, Next and
// Back, the volume and Now playing go to it as they go to a UPnP renderer (Renderers/Players.cs): the track set,
// the next, Play, Pause and Stop said in SlimProto (SlimPlayer.cs); its state and position in AVTransport's words.
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers.Slim;

internal sealed class SlimRenderer(string id, string name, Func<string, SlimPlayer?> connected) : IRenderer
{
    public string Name { get; } = name;

    /* The player, connected; a refusal where it isn't (it has gone from the network, or not yet come back). */
    private SlimPlayer Player => connected(id) ?? throw new RendererError($"{Name} is not connected", double.NaN);

    public Task Play() { Player.Play(); return Task.CompletedTask; }
    public Task Pause() { Player.Pause(); return Task.CompletedTask; }
    public Task Stop() { Player.Stop(); return Task.CompletedTask; }
    /* A seek: the track fetched again from there (SlimPlayer.SeekTime); DSD sent as it is can't be begun part-way. */
    public Task SeekTime(double seconds)
    {
        var p = Player;
        var path = Uri.TryCreate(p.Position.Uri, UriKind.Absolute, out var u) ? u.AbsolutePath : "";
        if (path.EndsWith(".orig.dsf", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".orig.dff", StringComparison.OrdinalIgnoreCase))
            throw new RendererError($"{Name} can't seek in a DSD file sent as it is", double.NaN);
        p.SeekTime(seconds);
        return Task.CompletedTask;
    }
    public Task SetUri(string uri, string meta = "") { Player.SetUri(uri); return Task.CompletedTask; }
    public Task SetNextUri(string uri, string meta = "") { Player.SetNextUri(uri); return Task.CompletedTask; }

    public Task<JsObj> GetTransportInfo() =>
        Task.FromResult(Jv.Obj(("CurrentTransportState", Player.State), ("CurrentTransportStatus", "OK"), ("CurrentSpeed", "1")));

    /* The track playing and how far in; its length is the queue's own (a player says none). */
    public Task<JsObj> GetPositionInfo()
    {
        var (uri, seconds) = Player.Position;
        return Task.FromResult(Jv.Obj(("Track", uri.Length > 0 ? "1" : "0"), ("TrackURI", uri), ("TrackMetaData", ""),
            ("RelTime", Mpd.Hms(seconds)), ("TrackDuration", "0:00:00")));
    }

    public Task<double> GetVolume() => Task.FromResult(Player.Volume);
    public Task SetVolume(double v) { Player.SetVolume(v); return Task.CompletedTask; }
    public Task<bool> GetMute() => Task.FromResult(Player.Muted);
    public Task SetMute(bool m) { Player.SetMute(m); return Task.CompletedTask; }

    /* What went wrong, said by the player (a track it couldn't play). */
    public Exception? TakeError() => connected(id)?.TakeError() is { } e ? new RendererError(e, double.NaN) : null;
}
