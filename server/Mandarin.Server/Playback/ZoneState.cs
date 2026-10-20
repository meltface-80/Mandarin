// ZoneState.cs — what the hub keeps of every zone (v0.8.49, stage 6 of
// old/csharp-migration.md): the state a Sonos poll, a phone's report
// or a renderer's read produces (lib/sonos/zones.js applyState, the blankState
// of phones.js and players.js), and the shapes the hub hands the routes (a
// zone, an output, a queue entry) as zones.js's zones(), outputJson() and
// queue() hand them. One class for every kind of player: a field a kind never
// sets stays at its blank value, as the JavaScript object left it undefined.
using System.Text.Json.Nodes;

namespace Mandarin.Server.Playback;

/* A room's volume as the hub keeps it: { value, muted }; value null until read. */
internal sealed record Volume(double? Value, bool Muted);

/* What a renderer or a sound device is being sent (players.js toItem's `sent`): the Now playing badge's words. */
internal sealed record SentInfo(bool Transcode, double Rate, double Bits, double Upsampled, bool Dsp, double Dsd, string Ext, string Mime)
{
    public JsonObject Json() => new()
    {
        ["transcode"] = Transcode, ["rate"] = Rate, ["bits"] = Bits, ["upsampled"] = Upsampled,
        ["dsp"] = Dsp, ["dsd"] = Dsd, ["ext"] = Ext, ["mime"] = Mime
    };
}

internal sealed class ZoneState
{
    public string State = "stopped";          // playing | loading | paused | stopped
    public string TrackUri = "";
    public long? TrackId;
    public double TrackNumber;                // 1-based; 0 for none
    public double QueueLength;
    public bool OnQueue;
    public double Position;                   // seconds, when it was read (At)
    public double Duration;
    public string Title = "", Artist = "", Album = "", ArtUri = "", StreamContent = "";
    public bool Shuffle;
    public string Loop = "disabled";          // disabled | loop | loop_one
    public string PlayMode = "NORMAL";
    public string MediaUri = "";
    public double At;                         // ms, when read
    public bool Unreachable;
    public Volume? VolumeValue;
    // The phone's own (phones.js report): its own list, its cover and album, the file's extension.
    public bool Local;
    public string? ImageKey;
    public string? AlbumOffset;
    public string LocalExt = "";
    public string Format = "original";        // original | opus | opus24
    public bool Dsp;
    public string? Usb;
    // A renderer's (players.js): what it is sent, and whether the device confirmed it.
    public SentInfo? Sent { get; set; }
    public string? Verified { get; set; }     // "yes" | "no" | null
    // History's and the radio's marks, carried from one state to the next.
    public bool PlayedLogged, LowFired;

    /* blankState(volume): nothing playing. */
    public static ZoneState Blank(Volume? volume = null) => new() { At = Hub.Now(), VolumeValue = volume ?? new Volume(null, false) };

    public ZoneState Clone() => (ZoneState)MemberwiseClone();
}

/* One output as zones.js outputJson() gives it; volume null for a renderer whose volume is fixed on the device. */
internal sealed class OutputInfo
{
    public string OutputId = "", ZoneId = "", DisplayName = "", Model = "";
    public bool StereoPair, IsMuted;
    public double? VolumeValue;
    public double Step = 1;
    public bool VolumeShown = true;
    public List<string> CanGroupWith = [];
    public string ZoneName = "";              // outputs(): the zone's display name

    public JsonObject Json(bool withZoneName = false)
    {
        var o = new JsonObject
        {
            ["output_id"] = OutputId, ["zone_id"] = ZoneId, ["display_name"] = DisplayName, ["model"] = Model,
            ["stereo_pair"] = StereoPair, ["is_muted"] = IsMuted,
            ["volume"] = !VolumeShown ? null : new JsonObject
            {
                ["type"] = "number", ["min"] = 0, ["max"] = 100, ["step"] = Step,
                ["value"] = VolumeValue, ["soft_limit"] = 100, ["is_muted"] = IsMuted
            },
            ["can_group_with_output_ids"] = new JsonArray(CanGroupWith.Select(x => (JsonNode)x).ToArray()),
            ["source_controls"] = new JsonArray()
        };
        if (withZoneName) o["zone_name"] = ZoneName;
        return o;
    }

    /* The three fields /api/zone-state's zone carries of each output (api-playback.js zoneJson). */
    public JsonObject Short() => new()
    {
        ["output_id"] = OutputId, ["display_name"] = DisplayName, ["is_muted"] = IsMuted,
        ["volume"] = !VolumeShown ? null : new JsonObject
        {
            ["type"] = "number", ["min"] = 0, ["max"] = 100, ["step"] = Step,
            ["value"] = VolumeValue, ["soft_limit"] = 100, ["is_muted"] = IsMuted
        }
    };
}

/* A zone as zones.js zones() gives it, with its state and (a Sonos room's) group beside it. */
internal sealed class ZoneInfo
{
    public string ZoneId = "", DisplayName = "";
    public ZoneState State = ZoneState.Blank();
    public List<OutputInfo> Outputs = [];
    public bool IsPhone;
    public bool IsUpnp { get; set; }
    public bool IsLocal { get; set; }
    public string? DeviceId;
    public SonosGroup? Group { get; set; }

    public string Status => State.State;
    public JsonObject Settings => new() { ["shuffle"] = State.Shuffle, ["loop"] = State.Loop, ["auto_radio"] = false };
}

/* A Sonos group: its coordinator and its rooms (part 2 fills it; here for the name overlay's order). */
internal sealed class SonosGroup
{
    public string CoordinatorUid = "", CoordinatorName = "";
    public List<(string Uid, string Name)> Members = [];
}

/* One entry of a queue as zones.js queue() gives it: position 1-based. */
internal sealed class QueueEntry
{
    public double Position;
    public string Uri = "";
    public long? TrackId;
    public string Title = "", Artist = "", Album = "", ArtUri = "";
    public double Duration;
    public string? ImageKey;
}

internal sealed class QueueView
{
    public List<QueueEntry> Items = [];
    public double Total, Current;
}
