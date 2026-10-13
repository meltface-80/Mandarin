// Item.cs — what a player's queue takes (v0.8.49, stage 6): a URL on this
// server and the DIDL-Lite that makes Sonos accept it (lib/server/playback.js
// item()), with the track and the plan beside them for the players that keep
// their own queue; and the plain fields a phone is sent (phones.js toItem,
// publicItem) or a renderer keeps (players.js toItem).
using System.Text.Json.Nodes;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

/* { uri, meta, track, plan, gain?, phone?, upnp? } as the hub hands items around. */
internal sealed class PlayItem
{
    public string Uri = "", Meta = "";
    public PlayTrack? Track;
    public JsObj? Plan;
    public double? Gain;              // for the phone to apply (null: none)
    public PhoneItem? Phone;          // a phone's queue entry, moving elsewhere (phones.js itemsFor)
    public UpnpItem? Upnp { get; set; }   // a renderer's queue entry (players.js), part 3
}

/* A phone's queue entry (phones.js toItem). */
internal sealed class PhoneItem
{
    public string Uri = "";
    public long? TrackId;
    public string Title = "", Artist = "", Album = "", ArtUri = "";
    public double Duration;
    public double? Gain;
    // The phone's own list (report local_items): its cover and album, the file's extension.
    public string? ImageKey, AlbumKey;
    public string Ext = "";

    /* publicItem(it): what the app is sent for each track. */
    public JsonObject Public() => new()
    {
        ["url"] = Uri, ["track_id"] = TrackId, ["title"] = Title, ["artist"] = Artist,
        ["album"] = Album, ["art_url"] = ArtUri, ["duration"] = Duration, ["gain_db"] = Gain
    };

    public QueueEntry Entry(int position) => new()
    {
        Position = position, Uri = Uri, TrackId = TrackId, Title = Title, Artist = Artist, Album = Album,
        ArtUri = ArtUri, Duration = Duration, ImageKey = ImageKey
    };
}

/* A renderer's queue entry (players.js toItem): filled in part 3. */
internal sealed class UpnpItem
{
    public string Uri { get; set; } = "";
    public string Meta { get; set; } = "";
    public PlayTrack? Track { get; set; }
    public JsObj? Plan { get; set; }
    public long? TrackId { get; set; }
    public string Title { get; set; } = "";
    public string Artist { get; set; } = "";
    public string Album { get; set; } = "";
    public string ArtUri { get; set; } = "";
    public double Duration { get; set; }
    public SentInfo? Sent { get; set; }
}
