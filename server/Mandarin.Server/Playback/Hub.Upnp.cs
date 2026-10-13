// Hub.Upnp.cs — the renderers' half of the hub (v0.8.49, stage 6 part 3):
// every id that is a renderer's (UPNP_, LOCAL_) handed to Renderers/Players.cs,
// the way a PHONE_ id is handed to Phones.cs.
using System.Text.Json.Nodes;
using Mandarin.Server.Renderers;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

internal sealed partial class Hub
{
    public Players Upnp = null!;
    public Devices Devices = null!;

    private void StartRenderers()
    {
        Upnp = new Players(this);
        Devices = new Devices(this);
    }

    public bool IsUpnp(string? id) => Players.IsUpnpId(id);
    private Task UpnpPollAll(int tick) => Upnp.PollAll(tick);
    private List<ZoneInfo> UpnpZones() => Upnp.Zones();
    private QueueView UpnpQueue(string zoneId) => Upnp.Queue(zoneId);
    private QueueSnapshot? UpnpSaved(string id) => Upnp.Saved(id);
    private bool UpnpRestore(QueueSnapshot snap, List<PlayItem> items) => Upnp.Restore(snap, items);
    private static JsObj? UpnpTargetFor(string zoneId) => Players.TargetFor(zoneId);
    private List<long> UpnpTrackIds(string zoneId) => Upnp.TrackIds(zoneId);
    private Task<JsonObject> UpnpEnqueue(string zoneId, List<PlayItem> items, string how, double startAt, double seconds) => Upnp.Enqueue(zoneId, items, how, startAt, seconds);
    private Task UpnpControl(string zoneId, string command) => Upnp.Control(zoneId, command);
    private Task UpnpSeek(string zoneId, string how, double seconds) => Upnp.Seek(zoneId, how, seconds);
    private Task UpnpPlayFromHere(string zoneId, double position) => Upnp.PlayFromHere(zoneId, position);
    private Task UpnpRemoveFromQueue(string zoneId, double position) => Upnp.RemoveFromQueue(zoneId, position);
    private Task<QueueMoves.Plan> UpnpMoveAfterCurrent(string zoneId, List<double> positions) => Task.FromResult(Upnp.MoveAfterCurrent(zoneId, positions));
    private Task UpnpClearQueue(string zoneId) => Upnp.ClearQueue(zoneId);
    private Task UpnpSetSettings(string zoneId, bool? shuffle, string? loop) { Upnp.SetSettings(zoneId, shuffle, loop); return Task.CompletedTask; }
    private Task UpnpSetVolume(string outputId, string how, double value) => Upnp.SetVolume(outputId, how, value);
    private Task UpnpSetMute(string outputId, bool muted) => Upnp.SetMute(outputId, muted);
    private Task UpnpPauseAll() => Upnp.PauseAll();
}
