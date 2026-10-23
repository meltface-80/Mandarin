// Items.cs — turning library tracks into things a player's queue will take
// (lib/server/playback.js, v0.8.49, stage 6): every queued item is a URL on
// this server, /stream/t<id>.<ext>, plus the DIDL-Lite that makes Sonos
// accept it. The extension and the MIME type are decided here by the same
// plan the stream route follows when the speaker comes to fetch it
// (StreamPlans.PlanFor), so what Sonos is told and what it receives agree. A
// renderer's URLs say what they carry (.orig, .<rate>-<bits>); a phone is
// handed its ReplayGain with the track and applies it itself; Sonos and the
// renderers get the gain in the stream (?g=).
using System.Text.Json.Nodes;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Playback;

using AJs = Mandarin.Server.Js;
using TJs = Mandarin.Server.Tags.Js;


/* An error a route answers with its status and its words (the Node server's e.status). */
internal sealed class HubError(int status, string message) : Exception(message)
{
    public int Status => status;
}

internal static class Items
{
    /* Signed: speakers can't sign in, so their addresses carry the proof. */
    public static string StreamUrl(string secret, string baseUrl, PlayTrack t, JsObj p, JsObj? target)
    {
        var transcode = Jv.T(p["transcode"]);
        var seg = target == null ? "" : transcode ? $".{TJs.Num(Jv.Num(p["rate"]))}-{TJs.Num(Jv.Num(p["bits"]))}" : ".orig";
        var qs = new List<string>();
        // A conversion with DSP names its output (?o=), so the stream route runs that zone's setting as it stands when the device fetches.
        if (Jv.T(p["dsp"]) && target != null && Jv.T(target["id"])) qs.Add("o=" + AJs.EncodeURIComponent(Jv.Str(target["id"])));
        // DSD as it is, in the device's own word for it (audio/dsf…): the stream says the same as the DIDL.
        if (Jv.T(p["dsd"]) && target != null && !Jv.Same(p["mime"], StreamPlans.MimeForExt(p["ext"]))) qs.Add("m=" + AJs.EncodeURIComponent(Jv.Str(p["mime"])));
        if (Jv.T(p["gain"])) qs.Add("g=" + TJs.Num(Jv.Num(p["gain"])));
        var q = qs.Count > 0 ? "?" + string.Join("&", qs) : "";
        return Signing.SignUrl(secret, $"{baseUrl}/stream/t{t.Id}{seg}.{Jv.Str(p["ext"])}{q}");
    }

    public static string ArtUrl(string secret, string baseUrl, Album al) =>
        Signing.SignUrl(secret, $"{baseUrl}/api/image/{AJs.EncodeURIComponent(al.ImageKey)}?size=600");

    /* item(t, target, { gain, phoneGain }): the URL, the DIDL and the plan, the track beside them. */
    public static PlayItem Item(Snapshot s, string secret, string baseUrl, PlayTrack t, JsObj? target, double? gain, double? phoneGain)
    {
        var al = s.Find(t.AlbumId);
        var p = (JsObj)StreamPlans.PlanFor(t.ToJs(), target, gain)!;
        var uri = StreamUrl(secret, baseUrl, t, p, target);
        var meta = Jv.Obj(
            ("itemId", $"musicd-t{t.Id}"),
            ("title", t.Title),
            ("artist", t.Artist.Length > 0 ? t.Artist : al?.Artist is { Length: > 0 } aa ? aa : ""),
            ("albumArtist", al?.Artist is { Length: > 0 } ar ? ar : t.AlbumArtist),
            ("album", al?.Title is { Length: > 0 } at ? at : t.Album),
            ("artUri", al != null ? ArtUrl(secret, baseUrl, al) : ""),
            ("trackNumber", t.TrackNo is > 0 ? (object)(double)t.TrackNo.Value : ""),
            ("duration", t.Duration),
            ("mime", p["mime"]));
        // A DLNA renderer likes to be told what the stream carries; Sonos is told nothing new.
        if (target != null)
        {
            var transcode = Jv.T(p["transcode"]);
            meta["sampleFrequency"] = transcode ? p["rate"] : (double)(t.SampleRate ?? 0);
            meta["bitsPerSample"] = transcode ? p["bits"] : (double)(t.Bits ?? 0);
            meta["nrAudioChannels"] = transcode ? 2.0 : (double)(t.Channels is > 0 ? t.Channels.Value : 2);
        }
        return new PlayItem { Uri = uri, Meta = Didl.Build(uri, meta), Track = t, Plan = p, Gain = phoneGain };
    }

    /* Warm the transcode cache for what is about to play, in play order. */
    public static void Prefetch(IEnumerable<PlayItem> items)
    {
        var work = new List<(ConvTrack, ConvPlan)>();
        foreach (var it in items)
        {
            if (it.Track == null || it.Plan == null || !Jv.T(it.Plan["transcode"])) continue;
            work.Add((new ConvTrack(it.Track.Id, it.Track.Path, Hub.TierOrMtime(it.Track)), ConvPlan.Of(it.Plan)));
            if (work.Count == 40) break;
        }
        if (work.Count > 0) Transcoder.Prefetch(work);
    }

    /* The device's Volume Levelling, from its row in audio_devices (devices.js levellingFor). */
    public static JsObj LevellingFor(SqliteConnection c, string id) => Gain.Levelling(DeviceSettings(c, id)["levelling"]);

    /* A device's settings as registry.js reads them: {} for a device not in the register. */
    public static JsObj DeviceSettings(SqliteConnection c, string id)
    {
        var rows = Library.Rows(c, "SELECT settings FROM audio_devices WHERE id = $1", id);
        if (rows.Count == 0 || rows[0][0] is not string json) return new JsObj();
        try { return Scan.JsJson.Parse(json) as JsObj ?? new JsObj(); } catch (JsError) { return new JsObj(); }
    }

    /* loudness.js's two reads for the gains: what was measured of a track, and an album's rows. */
    private static object? Measured(SqliteConnection c, object? id)
    {
        if (!Jv.IsFiniteNumber(id)) return null;
        var rows = Library.Rows(c, "SELECT lufs, peak FROM track_loudness WHERE track_id = $1 AND lufs IS NOT NULL", (long)Jv.Num(id));
        return rows.Count == 0 ? null : Jv.Obj(("lufs", Dbl(rows[0][0])), ("peak", Dbl(rows[0][1])));
    }
    private static List<object?> AlbumRows(SqliteConnection c, object? albumId)
    {
        if (!Jv.IsFiniteNumber(albumId)) return [];
        return Library.Rows(c, "SELECT t.id, t.duration, t.rg_track_gain, t.rg_track_peak, l.lufs, l.peak FROM tracks t LEFT JOIN track_loudness l ON l.track_id = t.id WHERE t.album_id = $1", (long)Jv.Num(albumId))
            .Select(r => (object?)Jv.Obj(("id", Dbl(r[0])), ("duration", Dbl(r[1])), ("rg_track_gain", Dbl(r[2])), ("rg_track_peak", Dbl(r[3])), ("lufs", Dbl(r[4])), ("peak", Dbl(r[5])))).ToList();
    }
    private static object? Dbl(object? v) => v switch { null => null, long l => (double)l, double d => d, _ => TJs.ToNumber(v) };

    /* The items a zone is handed: planned for that zone's player, each with its ReplayGain. */
    public static List<PlayItem> ItemsFor(SqliteConnection c, Snapshot s, Hub hub, string zoneId, List<PlayTrack> tracks, bool? shuffled = null)
    {
        var target = hub.TargetFor(zoneId);
        var phone = hub.Phones.IsPhoneId(zoneId);
        var shuffle = shuffled ?? (hub.State.TryGetValue(zoneId, out var st) && st.Shuffle);
        var levelling = LevellingFor(c, zoneId);
        var gains = Gain.GainsFor(tracks.Select(t => (object?)t.ToJs()).ToList(), shuffle, levelling, id => Measured(c, id), id => AlbumRows(c, id));
        var secret = hub.Secret(c);
        var baseUrl = hub.BaseUrl;
        var out_ = new List<PlayItem>(tracks.Count);
        for (int i = 0; i < tracks.Count; i++)
        {
            double? g = gains[i] is double d ? d : null;
            out_.Add(Item(s, secret, baseUrl, tracks[i], target, phone ? null : g, phone ? g : null));
        }
        return out_;
    }

    public static async Task<JsonObject> PlayTracks(Hub hub, string zoneId, List<PlayTrack> tracks, string how, double startAt = 0, double seconds = 0, bool? shuffled = null)
    {
        if (tracks.Count == 0) throw new HubError(500, "Nothing to play");
        // Spotify's songs (item 143): played by Mandarin's Soloist, lossless, never queued track by track; a list mixing
        // them with others plays the part the starting track is in.
        if (tracks.Any(Spotify.SpotifyPlay.IsSpotify))
        {
            var (part, first, spotify) = Spotify.SpotifyPlay.Part(tracks, (int)Math.Max(0, startAt));
            if (spotify) return await Spotify.SpotifyPlay.Play(zoneId, part, how, how == "play_now" ? first : 0, seconds, shuffled);
            (tracks, startAt) = (part, how == "play_now" ? first : startAt);
        }
        List<PlayItem> items;
        using (var c = Db.Open())
        {
            var s = await Library.CurrentCopy() ?? throw new HubError(503, "The library is still being scanned");
            items = ItemsFor(c, s, hub, zoneId, tracks, shuffled);
        }
        // The track that starts first is prepared first.
        var start = (int)Math.Max(0, startAt);
        Prefetch(items.Skip(start).Concat(items.Take(start)));
        return await hub.Enqueue(zoneId, items, how, startAt, seconds);
    }

    public static async Task<Album> PlayAlbum(Hub hub, string zoneId, double albumId, string how, double startAt = 0, double seconds = 0)
    {
        var s = await Library.CurrentCopy() ?? throw new HubError(503, "The library is still being scanned");
        var al = s.Find(albumId) ?? throw new HubError(404, "That album is no longer in the library");
        List<PlayTrack> tracks;
        using (var c = Db.Open()) tracks = Tracks.OfAlbum(c, s, al.Id);
        bool? shuffled = null;
        if (how == "shuffle")
        {
            shuffled = true;
            for (int i = tracks.Count - 1; i > 0; i--)
            {
                var j = (int)Math.Floor(Random.Shared.NextDouble() * (i + 1));
                (tracks[i], tracks[j]) = (tracks[j], tracks[i]);
            }
            how = "play_now";
        }
        await PlayTracks(hub, zoneId, tracks, NormaliseKind(how), startAt, seconds, shuffled);
        return al;
    }

    /* The interface's words for where things go, mapped onto the three the hub understands. */
    public static string NormaliseKind(string? kind) => kind switch
    {
        "queue" or "add_to_queue" => "queue",
        "play_next" or "add_next" or "next" => "add_next",
        _ => "play_now"
    };
}
