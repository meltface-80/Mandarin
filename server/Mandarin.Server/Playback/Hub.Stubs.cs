// Hub.Stubs.cs — the Sonos half (part 2) and the renderers' half (part 3) of
// the hub, not yet here: a Sonos id gets the hub's own refusal, as a room
// that isn't there gets it, and no renderer exists. Each is replaced by its
// part's file, and this one goes.
using System.Text.Json.Nodes;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

internal sealed partial class Hub
{
    // ------------------------------------------------------------ Sonos (part 2)

    private List<ZoneInfo> SonosZones() => [];
    private ZoneInfo? SonosZone(string zoneOrOutputId) => null;
    private QueueView SonosQueue(string zoneId) => throw NoRoom();
    private void QueueChanged(string uid) { }
    private Task<JsonObject> SonosEnqueue(string zoneId, List<PlayItem> items, string how, double startAt, double seconds) => throw NoRoom();
    private Task SonosControl(string zoneId, string command) => throw NoRoom();
    private Task SonosSeek(string zoneId, string how, double seconds) => throw NoRoom();
    private Task SonosPlayFromHere(string zoneId, double position) => throw NoRoom();
    private Task SonosRemoveFromQueue(string zoneId, double position) => throw NoRoom();
    private Task<QueueMoves.Plan> SonosMoveAfterCurrent(string zoneId, List<double> positions) => throw NoRoom();
    private Task SonosClearQueue(string zoneId) => throw NoRoom();
    private Task SonosSetSettings(string zoneId, bool? shuffle, string? loop) => throw NoRoom();
    private Task SonosSetVolume(string outputId, string how, double value) => throw NoRoom();
    private Task SonosSetMute(string outputId, bool muted) => throw NoRoom();
    private Task SonosPauseAll() => Task.CompletedTask;
    private Task SonosGroup(List<string> outputIds) => throw NoRoom();
    private Task SonosUngroup(List<string> outputIds) => Task.CompletedTask;
    private Task SonosTransfer(string fromZone, string toZone) => throw NoRoom();
    private Task<(List<long>, ZoneState)> SonosTrackIds(string zoneId) => throw NoRoom();
    private Task<(List<PlayItem>, ZoneState)> SonosItems(string zoneId) => throw NoRoom();
    /* zones.outputs(): the Sonos rooms as outputs, each with its zone's name. */
    public List<OutputInfo> Outputs() => [];
    public int RoomCount => 0;
    public bool Discovered => false;
    public bool Searching => false;
    public string? LastError => null;
    public List<string> SpeakerHosts => [];
    public SonosGroup? GroupOf(string id) => null;

    // ------------------------------------------------------------ renderers (part 3)

    public bool IsUpnp(string? id) => false;
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
