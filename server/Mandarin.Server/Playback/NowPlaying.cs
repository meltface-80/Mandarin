// NowPlaying.cs — what the page draws for a zone's current track
// (api-playback.js nowPlaying and formatOf, v0.8.49, stage 6): the three
// lines, the cover, the length and where it is, and the format badge: what
// the zone is actually hearing, kept simple.
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Playback;

internal static class NowPlaying
{
    /* Artwork.foreignKey(url): a picture from elsewhere, named by its address. */
    public static string ForeignKey(string url) =>
        Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(url)).TrimEnd('=').Replace('+', '-').Replace('/', '_') is var b ? "u-" + b : "";

    public static async Task<JsonObject?> Of(SqliteConnection c, ZoneInfo z)
    {
        var st = z.State;
        if (st.TrackUri.Length == 0 && st.Title.Length == 0) return null;
        // Spotify's live stream (item 142): what plays is Soloist's.
        if (Spotify.SpotifyNow.Of(st) is { } spotify) return spotify;
        var s = await Library.CurrentCopy();
        var t = st.TrackId != null && s != null ? Tracks.Of(c, s, st.TrackId.Value) : null;
        var al = t != null && s != null ? s.Find(t.AlbumId) : null;
        var line1 = t?.Title is { Length: > 0 } tt ? tt : st.Title.Length > 0 ? st.Title : st.StreamContent;
        var line2 = t?.Artist is { Length: > 0 } ta ? ta : st.Artist;
        var line3 = al?.Title is { Length: > 0 } at ? at : st.Album;
        // The phone's own music (st.local): its cover and album are the phone's.
        var imageKey = st.ImageKey ?? (al != null ? al.ImageKey : st.ArtUri.Length > 0 ? ForeignKey(st.ArtUri) : null);
        var keys = s != null ? Tracks.ArtistKeys(s) : [];
        var length = st.Duration != 0 ? st.Duration : t != null && Math.Round(t.Duration, MidpointRounding.AwayFromZero) is var d && d != 0 ? d : (double?)null;
        var format = FormatOf(z, st, t);
        return new JsonObject
        {
            ["line1"] = line1, ["line2"] = line2, ["line3"] = line3,
            ["artists"] = new JsonArray(Names.SplitArtists(line2).Select(name => (JsonNode)new JsonObject { ["name"] = name, ["linkable"] = keys.Contains(Names.Fold(name)) }).ToArray()),
            ["image_key"] = imageKey,
            ["length"] = length,
            ["seek_position"] = Math.Round(Hub.PositionNow(st), MidpointRounding.AwayFromZero),
            // Not in Roon's shape: what the speaker is actually being sent, for the format line on Now playing.
            ["track_id"] = t?.Id,
            ["album_offset"] = st.AlbumOffset != null ? st.AlbumOffset : al != null ? al.Id : null,
            ["format"] = format == null ? null : new JsonObject { ["kind"] = format.Value.Kind, ["text"] = format.Value.Text }
        };
    }

    /*
     * The format badge: a phone playing the server's Opus says so; a lossless
     * file is "Lossless" whatever its rate; a lossy file names its codec; a
     * renderer is told exactly what it gets.
     */
    public static (string Kind, string Text)? FormatOf(ZoneInfo z, ZoneState st, PlayTrack? t)
    {
        var f = Inner(z, st, t);
        // The phone's USB driver feeding the DAC itself: the depth and rate the DAC is given, and the tick when the DSP is off.
        if (z.IsPhone && st.Usb != null && f != null)
        {
            var usb = st.Usb;
            var m = System.Text.RegularExpressions.Regex.Match(usb, @"^(dsd|dop)(\d+)$");
            if (m.Success) return (f.Value.Kind, f.Value.Text + (m.Groups[1].Value == "dop" ? $" · USB DoP DSD{m.Groups[2].Value} ✓" : $" · USB DSD{m.Groups[2].Value} ✓"));
            var parts = usb.Split('/');
            return (f.Value.Kind, f.Value.Text + $" · USB {parts[1]}/{Tags.Js.Num(Tags.Js.StringToNumber(parts[0]) / 1000)}" + (st.Dsp ? "" : " ✓"));
        }
        return f;
    }

    private static readonly string[] LosslessExts = ["flac", "wav", "aif", "aiff", "alac", "wv", "ape"];

    private static (string Kind, string Text)? Inner(ZoneInfo z, ZoneState st, PlayTrack? t)
    {
        var dspTag = z.IsPhone && st.Dsp ? " · DSP" : "";
        // The phone's own file: what its extension says.
        if (z.IsPhone && st.Local)
        {
            var ext = st.LocalExt.ToLowerInvariant();
            if (ext.Length == 0) return st.Dsp ? ("lossless", "DSP") : null;
            return LosslessExts.Contains(ext) ? ("lossless", "Lossless" + dspTag) : ("lossy", ext.ToUpperInvariant() + dspTag);
        }
        if (t == null) return null;
        // The server's Opus 256, decoded on the phone to float ("opus24") or by Android's own decoder to 16-bit ("opus").
        if (z.IsPhone && st.Format is "opus" or "opus24")
            return ("opus", (t.Path.EndsWith(".opus", StringComparison.OrdinalIgnoreCase) ? "" : st.Format == "opus24" ? "256 · 24/48" : "256kbps") + dspTag);
        if (z.IsPhone && dspTag.Length > 0)
        {
            var nm = Library.FormatName(t.Container, false) ?? (t.Codec ?? "").ToUpperInvariant();
            return t.Lossless ? ("lossless", "Lossless" + dspTag) : nm.Length > 0 ? ("lossy", nm + dspTag) : null;
        }
        // A renderer is told exactly what it gets: the file's own container, depth and rate, or the FLAC it was converted to.
        if (z.IsUpnp && st.Sent != null)
        {
            var s = st.Sent;
            static string Khz(double hz) => hz != 0 ? Tags.Js.Num(hz / 1000) : "";
            var tick = st.Verified == "yes" ? " ✓" : "";
            // DSD as it is: the file itself, at its multiple.
            if (!s.Transcode && s.Dsd != 0) return ("lossless", $"DSD{Tags.Js.Num(s.Dsd)}");
            if (s.Transcode) return ("lossless", $"FLAC {Tags.Js.Num(s.Bits)}/{Khz(s.Rate)}{(s.Upsampled != 0 ? $" ↑×{Tags.Js.Num(s.Upsampled)}" : "")}{(s.Dsp ? " · DSP" : "")}{tick}");
            var name = Library.FormatName(t.Container, false) ?? (t.Codec ?? "").ToUpperInvariant();
            if (t.Lossless) return ("lossless", string.Join(" ", new[] { name.Length > 0 ? name : "Lossless", s.Bits != 0 && s.Rate != 0 ? $"{Tags.Js.Num(s.Bits)}/{Khz(s.Rate)}" : "" }.Where(x => x.Length > 0)) + tick);
            return name.Length > 0 ? ("lossy", name) : null;
        }
        if (t.Lossless) return ("lossless", "Lossless");
        var n = Library.FormatName(t.Container, false) ?? (t.Codec ?? "").ToUpperInvariant();
        return n.Length > 0 ? ("lossy", n) : null;
    }
}
