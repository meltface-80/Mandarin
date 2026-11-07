// TagReader.Ids.cs — what identifies a file's recording, release and artist (out of TagReader.cs, which only shrinks):
// the ISRC, the barcode and catalogue number, the release's country, and MusicBrainz's ids for the release, its
// release group, the recording and (item 330) the album's artist. The artist's is the Album Artist Id where the file
// has one (TXXX:MusicBrainz Album Artist Id in ID3v2, MUSICBRAINZ_ALBUMARTISTID in Vorbis comments, and their MP4 and
// APE forms, read by Collector.cs), else the Artist Id: the first of either, the lead artist where several are named.
// It is what tells two acts of the same name apart (the library's artists, ArtistRows.cs).
using System.Text.RegularExpressions;

namespace Mandarin.Server.Tags;

internal static partial class TagReader
{
    [GeneratedRegex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")]
    private static partial Regex Mbid();

    /* Into [r]: the identifiers [c] (the common tags) and [tag] (a native tag by name) say. */
    private static void Ids(JsObj r, JsObj c, Func<string, object?> tag)
    {
        r["isrc"] = Clean(Or(() => First(c["isrc"]), () => tag("ISRC"), () => tag("TSRC")));
        r["barcode"] = Digits(Or(() => First(c["barcode"]), () => tag("BARCODE"), () => tag("UPC"), () => tag("EAN")));
        r["catno"] = Clean(Or(() => First(c["catalognumber"]), () => tag("CATALOGNUMBER"), () => tag("LABELNO"), () => tag("CATALOG")));
        r["country"] = Clean(Or(() => c["releasecountry"], () => tag("RELEASECOUNTRY")));
        r["mb_album"] = Clean(c["musicbrainz_albumid"]);
        r["mb_group"] = Clean(c["musicbrainz_releasegroupid"]);
        r["mb_recording"] = Clean(c["musicbrainz_recordingid"]);
        r["mb_artist"] = ArtistMbid(c["musicbrainz_albumartistid"]) ?? ArtistMbid(c["musicbrainz_artistid"]);
    }

    /* The first MusicBrainz id in [v] (a list, or one value; ids run together with "/", ";" or "," split), lower case; null where none is one. */
    public static string? ArtistMbid(object? v)
    {
        var values = v is List<object?> l ? l : [v];
        foreach (var x in values)
        {
            if (Clean(x) is not string s) continue;
            foreach (var part in s.Split(['/', ';', ',', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var id = part.ToLowerInvariant();
                if (Mbid().IsMatch(id)) return id;
            }
        }
        return null;
    }
}
