// Hub.Stubs.cs — the renderers' half (part 3) of the hub, not yet here: no
// renderer exists. Replaced by its part's files, and this one goes.
using System.Text.Json.Nodes;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

internal sealed partial class Hub
{
    // ------------------------------------------------------------ renderers (part 3)

    public bool IsUpnp(string? id) => false;
    private Task UpnpPollAll(int tick) => Task.CompletedTask;
    private List<ZoneInfo> UpnpZones() => [];
    private QueueView UpnpQueue(string zoneId) => new();
    private QueueSnapshot? UpnpSaved(string id) => null;
    private bool UpnpRestore(QueueSnapshot snap, List<PlayItem> items) => false;
    private JsObj? UpnpTargetFor(string zoneId) => null;
    private List<long> UpnpTrackIds(string zoneId) => [];
    private Task<JsonObject> UpnpEnqueue(string zoneId, List<PlayItem> items, string how, double startAt, double seconds) => throw NoRoom();
    private Task UpnpControl(string zoneId, string command) => throw NoRoom();
    private Task UpnpSeek(string zoneId, string how, double seconds) => throw NoRoom();
    private Task UpnpPlayFromHere(string zoneId, double position) => throw NoRoom();
    private Task UpnpRemoveFromQueue(string zoneId, double position) => throw NoRoom();
    private Task<QueueMoves.Plan> UpnpMoveAfterCurrent(string zoneId, List<double> positions) => throw NoRoom();
    private Task UpnpClearQueue(string zoneId) => throw NoRoom();
    private Task UpnpSetSettings(string zoneId, bool? shuffle, string? loop) => throw NoRoom();
    private Task UpnpSetVolume(string outputId, string how, double value) => throw NoRoom();
    private Task UpnpSetMute(string outputId, bool muted) => throw NoRoom();
    private Task UpnpPauseAll() => Task.CompletedTask;
}
