// Didl.cs — the metadata a Sonos player needs before it will play a URL:
// lib/sonos/didl.js (v0.8.37) rule for rule, held to it by
// test/sonos-csharp.test.js. Nothing here runs yet: playback is still the Node
// server's until stage 6 of docs/specs/csharp-migration.md.
//
// Sonos refuses a third-party HTTP item whose DIDL-Lite lacks the
// RINCON_AssociatedZPUDN descriptor, and matches the MIME type in protocolInfo
// against what actually arrives, so the type is the one the stream endpoint is
// going to send. What is built is the Node server's, byte for byte (a speaker
// keeps the DIDL it was queued with, and a renderer compares it); fields come
// as JavaScript has them, so a number, an empty string or a missing field
// counts as it does there.
//
// What a player sends back (a Browse of its queue, a track's metadata) is read
// forgivingly: bad metadata is common, and an empty list is always an answer.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

using Js = Mandarin.Server.Tags.Js;

internal static class Didl
{
    public const string RinconNs = "urn:schemas-rinconnetworks-com:metadata-1-0/";
    public const string CdudnSentinel = "RINCON_AssociatedZPUDN";
    public const string DefaultClass = "object.item.audioItem.musicTrack";

    /* hms(): whole seconds as H:MM:SS (Number() of anything; nothing, negative or not a number is 0:00:00). */
    public static string Hms(object? seconds)
    {
        var n = Js.ToNumber(seconds);
        var s = Math.Max(0, Math.Floor(double.IsNaN(n) || n == 0 ? 0 : n));
        var h = Math.Floor(s / 3600);
        var m = Math.Floor(s % 3600 / 60);
        var r = s % 60;
        return $"{Js.Num(h)}:{Js.Num(m).PadLeft(2, '0')}:{Js.Num(r).PadLeft(2, '0')}";
    }

    /* toSeconds(): "H:MM:SS" (or any number of parts, each as Number() reads it) as seconds; anything unreadable 0. */
    public static double ToSeconds(object? v)
    {
        var t = Js.Trim(Js.Str(Js.Truthy(v) ? v : ""));
        if (t.Length == 0 || t == "NOT_IMPLEMENTED") return 0;
        var parts = t.Split(':').Select(Js.StringToNumber).ToList();
        if (parts.Any(n => !double.IsFinite(n))) return 0;
        return parts.Aggregate(0.0, (acc, n) => acc * 60 + n);
    }

    /*
     * build(): the DIDL-Lite for one URL. meta as the Node server passes it:
     * { title, artist, album, albumArtist, artUri, trackNumber, duration (s),
     *   mime, itemId, sampleFrequency, bitsPerSample, nrAudioChannels }.
     * Missing (undefined) is taken as {}; null is the TypeError JavaScript throws.
     */
    public static string Build(object? uri, object? meta)
    {
        if (meta is Undef) meta = new JsObj();
        if (meta is null) throw new JsError("Cannot read properties of null (reading 'mime')");
        object? M(string k) => Xml.Prop(meta, k);
        var mime = Xml.Or(M("mime"), "audio/flac");
        var res = new List<string> { $"protocolInfo=\"{Xml.Escape($"http-get:*:{Js.Str(mime)}:*")}\"" };
        if (Js.Truthy(M("duration"))) res.Add($"duration=\"{Hms(M("duration"))}\"");
        // What the stream carries, for renderers that show it; only when given, so
        // Sonos' items stay byte for byte what they were.
        if (Js.Truthy(M("sampleFrequency"))) res.Add($"sampleFrequency=\"{Js.Num(Js.ToNumber(M("sampleFrequency")))}\"");
        if (Js.Truthy(M("bitsPerSample"))) res.Add($"bitsPerSample=\"{Js.Num(Js.ToNumber(M("bitsPerSample")))}\"");
        if (Js.Truthy(M("nrAudioChannels"))) res.Add($"nrAudioChannels=\"{Js.Num(Js.ToNumber(M("nrAudioChannels")))}\"");
        var o = new System.Text.StringBuilder();
        o.Append("<DIDL-Lite xmlns:dc=\"http://purl.org/dc/elements/1.1/\"")
         .Append(" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\"")
         .Append(" xmlns:r=\"urn:schemas-rinconnetworks-com:metadata-1-0/\"")
         .Append(" xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\">")
         .Append($"<item id=\"{Xml.Escape(Xml.Or(M("itemId"), "-1"))}\" parentID=\"-1\" restricted=\"true\">")
         .Append($"<dc:title>{Xml.Escape(Xml.Or(M("title"), "Track"))}</dc:title>");
        if (Js.Truthy(M("artist")))
        {
            o.Append($"<dc:creator>{Xml.Escape(M("artist"))}</dc:creator>");
            o.Append($"<upnp:artist>{Xml.Escape(M("artist"))}</upnp:artist>");
        }
        if (Js.Truthy(M("albumArtist"))) o.Append($"<r:albumArtist>{Xml.Escape(M("albumArtist"))}</r:albumArtist>");
        if (Js.Truthy(M("album"))) o.Append($"<upnp:album>{Xml.Escape(M("album"))}</upnp:album>");
        if (Js.Truthy(M("artUri"))) o.Append($"<upnp:albumArtURI>{Xml.Escape(M("artUri"))}</upnp:albumArtURI>");
        if (Js.Truthy(M("trackNumber"))) o.Append($"<upnp:originalTrackNumber>{Xml.Escape(M("trackNumber"))}</upnp:originalTrackNumber>");
        o.Append($"<upnp:class>{DefaultClass}</upnp:class>");
        o.Append($"<res {string.Join(" ", res)}>{Xml.Escape(uri)}</res>");
        o.Append($"<desc id=\"cdudn\" nameSpace=\"{RinconNs}\">{CdudnSentinel}</desc>");
        o.Append("</item></DIDL-Lite>");
        return o.ToString();
    }

    /*
     * parseItems(): a DIDL-Lite document (a Browse result, or a transport's
     * track metadata) as flat items, items first, then containers. Never throws:
     * text that isn't DIDL-Lite is no items.
     */
    public static List<JsObj> ParseItems(object? didl)
    {
        var doc = Xml.Parse(didl);
        var root = Xml.Prop(doc, "DIDL-Lite");
        if (!Js.Truthy(root)) return [];
        var items = Xml.ListOf(Xml.Prop(root, "item")).Concat(Xml.ListOf(Xml.Prop(root, "container")));
        return items.Select(it =>
        {
            var res = Xml.ListOf(Xml.Prop(it, "res")) is { Count: > 0 } l ? l[0] : Undef.V;
            var o = new JsObj();
            o["id"] = Xml.Or(Xml.Prop(it, "@id"), "");
            o["title"] = Xml.Text(Xml.Prop(it, "title"));
            o["artist"] = Xml.Or(Xml.Text(Xml.Prop(it, "creator")), Xml.Text(Xml.Prop(it, "artist")));
            o["album"] = Xml.Text(Xml.Prop(it, "album"));
            o["albumArtist"] = Xml.Text(Xml.Prop(it, "albumArtist"));
            o["artUri"] = Xml.Text(Xml.Prop(it, "albumArtURI"));
            o["uri"] = Xml.Text(res);
            o["duration"] = res is JsObj r ? ToSeconds(r["@duration"]) : 0.0;
            o["streamContent"] = Xml.Text(Xml.Prop(it, "streamContent"));
            return o;
        }).ToList();
    }
}
