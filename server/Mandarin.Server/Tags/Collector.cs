// Collector.cs — music-metadata's MetadataCollector and tag mappers (v0.8.13).
//
// Every tag a parser finds is kept as it was found (native, by tag format, in
// the order found) and mapped to its common name ("title", "track"…). When a
// file carries one name in several tag formats, the format higher in
// TagPriority wins; within one format a single-valued name takes the last
// value, a list gathers them. The special cases are the Node reader's own,
// kept as they are: track numbers take the last one read whatever its format,
// artist and artists fill each other, a date sets the year, ReplayGain is
// read as "-7.21 dB" or a ratio.
namespace Mandarin.Server.Tags;

internal sealed class Collector
{
    private static readonly string[] TagPriority =
        ["matroska", "APEv2", "vorbis", "ID3v2.4", "ID3v2.3", "ID3v2.2", "exif", "asf", "iTunes", "AIFF", "ID3v1"];

    public readonly Dictionary<string, object?> Format = new(StringComparer.Ordinal);
    public readonly List<(string Type, List<(string Id, object? Value)> Tags)> Native = [];
    public readonly JsObj Common = new();
    private readonly Dictionary<string, int> commonOrigin = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> originPriority = new(StringComparer.Ordinal);

    public Collector()
    {
        Common["track"] = Track(null, null);
        Common["disk"] = Track(null, null);
        Common["movementIndex"] = Track(null, null);
        var p = 1;
        foreach (var t in TagPriority) originPriority[t] = p++;
        originPriority["artificial"] = 500;
        originPriority["id3v1"] = 600;
    }

    private static JsObj Track(object? no, object? of) { var o = new JsObj(); o["no"] = no; o["of"] = of; return o; }

    public object? Fmt(string key) => Format.TryGetValue(key, out var v) ? v : Undef.V;
    public void SetFormat(string key, object? value) => Format[key] = value;
    public void SetAudioOnly() { SetFormat("hasAudio", true); SetFormat("hasVideo", false); }
    public bool HasAny() => Native.Count > 0;

    public List<(string Id, object? Value)>? NativeOf(string type)
    {
        foreach (var (t, tags) in Native) if (t == type) return tags;
        return null;
    }

    public void AddTag(string tagType, string tagId, object? value)
    {
        var list = NativeOf(tagType);
        if (list is null) { list = []; Native.Add((tagType, list)); }
        list.Add((tagId, value));
        ToCommon(tagType, tagId, value);
    }

    private void ToCommon(string tagType, string tagId, object? value)
    {
        var mapper = Mappers.For(tagType) ?? throw new JsError($"No generic tag mapper defined for tag-format: {tagType}");
        var tag = mapper.Map(tagId, value);
        if (tag is { } g) PostMap(tagType, g.Id, g.Value);
    }

    private int Prio(string tagType) => originPriority.TryGetValue(tagType, out var p) ? p : int.MinValue;

    private void PostMap(string tagType, string id, object? value)
    {
        switch (id)
        {
            case "artist": SingularArtist(tagType, id, value, "artist", "artists"); return;
            case "albumartist": SingularArtist(tagType, id, value, "albumartist", "albumartists"); return;
            case "artists": PluralArtist(tagType, id, value, "artist", "artists"); return;
            case "albumartists": PluralArtist(tagType, id, value, "albumartist", "albumartists"); return;
            case "picture":
                // Only ever stored (common.picture is not read): an empty one is dropped.
                if (value is JsObj pic && pic["data"] is U8 { Length: > 0 }) SetGenericTag(tagType, id, value);
                return;
            case "totaltracks": ((JsObj)Common["track"]!)["of"] = ToIntOrNull(value); return;
            case "totaldiscs": ((JsObj)Common["disk"]!)["of"] = ToIntOrNull(value); return;
            case "movementTotal": ((JsObj)Common["movementIndex"]!)["of"] = ToIntOrNull(value); return;
            case "track":
            case "disk":
            case "movementIndex":
            {
                var of = ((JsObj)Common[id]!)["of"];
                var t = NormalizeTrack(value);
                if (!Js.IsNullish(of)) t["of"] = of;
                Common[id] = t;
                return;
            }
            case "bpm":
            case "year":
            case "originalyear":
                value = Js.ParseInt(value);
                break;
            case "date":
            {
                if (value is not string s) throw new JsError("tag.value.substr is not a function");
                var year = Js.ParseInt(s.Length > 4 ? s[..4] : s);
                if (!double.IsNaN(year)) Common["year"] = year;
                break;
            }
            case "discogs_label_id":
            case "discogs_release_id":
            case "discogs_master_release_id":
            case "discogs_artist_id":
            case "discogs_votes":
                if (value is string) value = Js.ParseInt(value);
                break;
            case "replaygain_track_gain":
            case "replaygain_track_peak":
            case "replaygain_album_gain":
            case "replaygain_album_peak":
                value = ToRatio(value);
                break;
            case "replaygain_track_minmax":
            {
                if (value is not string s) throw new JsError("tag.value.split is not a function");
                value = s.Split(',').Select(v => (object?)Js.ParseInt(v)).ToList();
                break;
            }
            case "replaygain_undo":
            {
                if (value is not string s) throw new JsError("tag.value.split is not a function");
                var mm = s.Split(',').Select(Js.ParseInt).ToList();
                var o = new JsObj();
                o["leftChannel"] = mm[0];
                o["rightChannel"] = mm.Count > 1 ? mm[1] : Undef.V;
                value = o;
                break;
            }
            case "gapless":
            case "compilation":
            case "podcast":
            case "showMovement":
                value = value is "1" || value is double d1 && d1 == 1;
                break;
            case "isrc":
                if (Common["isrc"] is List<object?> isrcs && Js.Contains(isrcs, value)) return;
                break;
            case "comment":
            {
                if (value is string cs) { var o = new JsObj(); o["text"] = cs; value = o; }
                if (Js.IsNullish(value)) throw new JsError("Cannot read properties of undefined (reading 'descriptor')");
                if (value is JsObj c && c["descriptor"] is "iTunPGAP")
                    SetGenericTag(tagType, "gapless", c["text"] is "1");
                break;
            }
            case "lyrics":
                if (value is string ls) value = Lyrics(ls);
                break;
        }
        if (value is not null) SetGenericTag(tagType, id, value);
    }

    private static object? ToIntOrNull(object? v)
    {
        var n = Js.ParseInt(v);
        return double.IsNaN(n) ? null : n;
    }

    /* CommonTagMapper.normalizeTrack: "3/12" → { no: 3, of: 12 }. */
    public static JsObj NormalizeTrack(object? v)
    {
        if (Js.IsNullish(v)) throw new JsError("Cannot read properties of null (reading 'toString')");
        var split = Js.Str(v).Split('/');
        var no = Js.ParseInt(split[0]);
        var of = split.Length > 1 ? Js.ParseInt(split[1]) : double.NaN;
        return Track(Js.Truthy(no) ? no : null, Js.Truthy(of) ? of : null);
    }

    /* Util.toRatio: "-7.21 dB" → { dB, ratio }; anything else is taken as a ratio. */
    public static JsObj ToRatio(object? value)
    {
        if (value is not string s) throw new JsError("value.split is not a function");
        var ps = s.Split(' ').Select(p => Js.Lower(Js.Trim(p))).ToArray();
        var v = Js.ParseFloat(ps[0]);
        var o = new JsObj();
        if (ps.Length == 2 && ps[1] == "db") { o["dB"] = v; o["ratio"] = Math.Pow(10, v / 10); }
        else { o["dB"] = 10 * Math.Log10(v); o["ratio"] = v; }
        return o;
    }

    private static readonly System.Text.RegularExpressions.Regex Lrc = new(@"\[([0-9]{2}):([0-9]{2})\.([0-9]{2,3})]", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    /* lrc/LyricsParser: kept for its shape only (common.lyrics is not read). */
    private static JsObj Lyrics(string input)
    {
        var o = new JsObj();
        o["contentType"] = 1.0;
        if (Lrc.IsMatch(input))
        {
            o["timeStampFormat"] = 2.0;
            var lines = new List<string>();
            foreach (var line in input.Split('\n'))
                if (Lrc.IsMatch(line)) lines.Add(Js.Trim(Lrc.Replace(line, "", 1)));
            o["text"] = string.Join("\n", lines);
        }
        else
        {
            o["timeStampFormat"] = 0.0;
            o["text"] = Js.Trim(input);
        }
        o["syncText"] = new List<object?>();
        return o;
    }

    private void SingularArtist(string tagType, string id, object? value, string singular, string plural)
    {
        if (commonOrigin.TryGetValue(singular, out var o) && o == Prio(tagType))
        {
            // The singular name given twice in one format: taken as the plural.
            PostMap("artificial", plural, value);
            return;
        }
        if (!Js.Truthy(Common[plural])) SetGenericTag("artificial", plural, value);
        SetGenericTag(tagType, id, value);
    }

    private void PluralArtist(string tagType, string id, object? value, string singular, string plural)
    {
        if (!Js.Truthy(Common[singular]) || (commonOrigin.TryGetValue(singular, out var o) && o == originPriority["artificial"]))
        {
            var list = Common[plural] as List<object?>;
            if (!Js.Truthy(Common[plural]) || list is null || !Js.Contains(list, value))
            {
                var values = new List<object?>(list ?? []) { value };
                SetGenericTag("artificial", singular, JoinArtists(values));
            }
        }
        SetGenericTag(tagType, id, value);
    }

    private static string JoinArtists(List<object?> a)
    {
        string S(object? x) => Js.IsNullish(x) ? "" : Js.Str(x);
        if (a.Count > 2) return string.Join(", ", a.Take(a.Count - 1).Select(S)) + " & " + S(a[^1]);
        return string.Join(" & ", a.Select(S));
    }

    private void SetGenericTag(string tagType, string id, object? value)
    {
        var prio0 = commonOrigin.TryGetValue(id, out var p0) && p0 != 0 ? p0 : 1000;
        var prio1 = Prio(tagType);
        if (prio1 == int.MinValue) return; // (an unknown format's priority compares false with everything)
        if (CommonTags.IsSingleton(id))
        {
            if (prio1 <= prio0) { Common[id] = value; commonOrigin[id] = prio1; }
            return;
        }
        if (prio1 == prio0)
        {
            var list = Common[id] as List<object?> ?? throw new JsError("common list missing");
            if (!CommonTags.IsUnique(id) || !Js.Contains(list, value)) list.Add(value);
        }
        else if (prio1 < prio0)
        {
            Common[id] = new List<object?> { value };
            commonOrigin[id] = prio1;
        }
    }
}

/* common/GenericTagTypes.js */
internal static class CommonTags
{
    private static readonly Dictionary<string, (bool Multiple, bool Unique)> Info = Build();

    private static Dictionary<string, (bool, bool)> Build()
    {
        var d = new Dictionary<string, (bool, bool)>(StringComparer.Ordinal);
        void S(params string[] names) { foreach (var n in names) d[n] = (false, false); }
        void M(bool unique, params string[] names) { foreach (var n in names) d[n] = (true, unique); }
        S("year", "track", "disk", "title", "artist", "albumartist", "album", "date", "originaldate", "originalyear", "releasedate");
        M(true, "artists", "albumartists");
        M(false, "comment");
        M(true, "genre", "picture", "composer");
        M(false, "lyrics");
        // multiple: false, unique: true — single-valued.
        d["albumsort"] = (false, true); d["titlesort"] = (false, true); d["work"] = (false, true);
        d["artistsort"] = (false, true); d["albumartistsort"] = (false, true); d["composersort"] = (false, true);
        M(true, "lyricist", "writer", "conductor", "remixer", "arranger", "engineer", "producer", "technician", "djmixer", "mixer", "label");
        S("grouping");
        M(false, "subtitle");
        S("discsubtitle", "totaltracks", "totaldiscs", "compilation");
        M(false, "rating");
        S("bpm", "mood", "media");
        M(true, "catalognumber");
        S("tvShow", "tvShowSort", "tvSeason", "tvEpisode", "tvEpisodeId", "tvNetwork", "podcast", "podcasturl", "releasestatus");
        M(false, "releasetype");
        S("releasecountry", "script", "language", "copyright", "license", "encodedby", "encodersettings", "gapless", "barcode");
        M(false, "isrc");
        S("asin", "musicbrainz_recordingid", "musicbrainz_trackid", "musicbrainz_albumid");
        M(false, "musicbrainz_artistid", "musicbrainz_albumartistid");
        S("musicbrainz_releasegroupid", "musicbrainz_workid", "musicbrainz_trmid", "musicbrainz_discid", "acoustid_id",
          "acoustid_fingerprint", "musicip_puid", "musicip_fingerprint", "website");
        M(true, "performer:instrument");
        S("averageLevel", "peakLevel");
        M(false, "notes");
        S("key", "originalalbum", "originalartist");
        M(true, "discogs_artist_id");
        S("discogs_release_id", "discogs_label_id", "discogs_master_release_id", "discogs_votes", "discogs_rating",
          "replaygain_track_peak", "replaygain_track_gain", "replaygain_album_peak", "replaygain_album_gain",
          "replaygain_track_minmax", "replaygain_album_minmax", "replaygain_undo");
        M(false, "description");
        S("longDescription");
        M(false, "category");
        S("hdVideo");
        M(false, "keywords");
        S("movement", "movementIndex", "movementTotal", "podcastId", "showMovement", "stik", "playCounter");
        return d;
    }

    public static bool IsSingleton(string alias) => Info.TryGetValue(alias, out var i) && !i.Multiple;

    public static bool IsUnique(string alias) =>
        Info.TryGetValue(alias, out var i) ? !i.Multiple || i.Unique : throw new JsError($"Cannot read properties of undefined (reading 'multiple')");
}

internal sealed class Mapper(Dictionary<string, string> map, bool caseInsensitive, Action<Mapper.Tag>? post = null)
{
    public sealed class Tag { public string Id = ""; public object? Value; }

    private readonly Dictionary<string, string> map = caseInsensitive ? Upper(map) : map;

    private static Dictionary<string, string> Upper(Dictionary<string, string> m)
    {
        var d = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (k, v) in m) d[Js.Upper(k)] = v;
        return d;
    }

    public (string Id, object? Value)? Map(string id, object? value)
    {
        var tag = new Tag { Id = id, Value = value };
        post?.Invoke(tag);
        var key = caseInsensitive ? Js.Upper(tag.Id) : tag.Id;
        return map.TryGetValue(key, out var common) ? (common, tag.Value) : null;
    }
}

internal static class Mappers
{
    public static Mapper? For(string tagType) => tagType switch
    {
        "ID3v1" => Id3v1,
        "ID3v2.2" => Id3v22,
        "ID3v2.3" or "ID3v2.4" => Id3v24,
        "iTunes" => Mp4,
        "vorbis" => Vorbis,
        "APEv2" => Ape,
        "asf" => Asf,
        "exif" => Riff,
        "AIFF" => Aiff,
        _ => null
    };

    private static Dictionary<string, string> D(params string[] kv)
    {
        var d = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var i = 0; i < kv.Length; i += 2) d[kv[i]] = kv[i + 1];
        return d;
    }

    public static readonly Mapper Id3v1 = new(D("title", "title", "artist", "artist", "album", "album", "year", "year",
        "comment", "comment", "track", "track", "genre", "genre"), false);

    public static readonly Mapper Id3v22 = new(D(
        "TT2", "title", "TP1", "artist", "TP2", "albumartist", "TAL", "album", "TYE", "year", "COM", "comment",
        "TRK", "track", "TPA", "disk", "TCO", "genre", "PIC", "picture", "TCM", "composer", "TOR", "originaldate",
        "TOT", "originalalbum", "TXT", "lyricist", "TP3", "conductor", "TPB", "label", "TT1", "grouping",
        "TT3", "subtitle", "TLA", "language", "TCR", "copyright", "WCP", "license", "TEN", "encodedby",
        "TSS", "encodersettings", "WAR", "website", "PCS", "podcast", "TCP", "compilation", "TDR", "date",
        "TS2", "albumartistsort", "TSA", "albumsort", "TSC", "composersort", "TSP", "artistsort", "TST", "titlesort",
        "WFD", "podcasturl", "TBP", "bpm", "GP1", "grouping"), true);

    public static readonly Mapper Id3v24 = new(D(
        "TIT2", "title", "TPE1", "artist", "TXXX:Artists", "artists", "TPE2", "albumartist", "TALB", "album",
        "TDRV", "date", "TORY", "originalyear", "TPOS", "disk", "TCON", "genre", "APIC", "picture",
        "TCOM", "composer", "USLT", "lyrics", "TSOA", "albumsort", "TSOT", "titlesort", "TOAL", "originalalbum",
        "TSOP", "artistsort", "TSO2", "albumartistsort", "TSOC", "composersort", "TEXT", "lyricist",
        "TXXX:Writer", "writer", "TPE3", "conductor", "TPE4", "remixer", "IPLS:arranger", "arranger",
        "IPLS:engineer", "engineer", "IPLS:producer", "producer", "IPLS:DJ-mix", "djmixer", "IPLS:mix", "mixer",
        "TPUB", "label", "TIT1", "grouping", "TIT3", "subtitle", "TRCK", "track", "TCMP", "compilation",
        "POPM", "rating", "TBPM", "bpm", "TMED", "media", "TXXX:CATALOGNUMBER", "catalognumber",
        "TXXX:MusicBrainz Album Status", "releasestatus", "TXXX:MusicBrainz Album Type", "releasetype",
        "TXXX:MusicBrainz Album Release Country", "releasecountry", "TXXX:RELEASECOUNTRY", "releasecountry",
        "TXXX:SCRIPT", "script", "TLAN", "language", "TCOP", "copyright", "WCOP", "license", "TENC", "encodedby",
        "TSSE", "encodersettings", "TXXX:BARCODE", "barcode", "TXXX:ISRC", "isrc", "TSRC", "isrc", "TXXX:ASIN", "asin",
        "TXXX:originalyear", "originalyear", "UFID:http://musicbrainz.org", "musicbrainz_recordingid",
        "TXXX:MusicBrainz Release Track Id", "musicbrainz_trackid", "TXXX:MusicBrainz Album Id", "musicbrainz_albumid",
        "TXXX:MusicBrainz Artist Id", "musicbrainz_artistid", "TXXX:MusicBrainz Album Artist Id", "musicbrainz_albumartistid",
        "TXXX:MusicBrainz Release Group Id", "musicbrainz_releasegroupid", "TXXX:MusicBrainz Work Id", "musicbrainz_workid",
        "TXXX:MusicBrainz TRM Id", "musicbrainz_trmid", "TXXX:MusicBrainz Disc Id", "musicbrainz_discid",
        "TXXX:ACOUSTID_ID", "acoustid_id", "TXXX:Acoustid Id", "acoustid_id", "TXXX:Acoustid Fingerprint", "acoustid_fingerprint",
        "TXXX:MusicIP PUID", "musicip_puid", "TXXX:MusicMagic Fingerprint", "musicip_fingerprint", "WOAR", "website",
        "TDRC", "date", "TYER", "year", "TDOR", "originaldate", "TIPL:arranger", "arranger", "TIPL:engineer", "engineer",
        "TIPL:producer", "producer", "TIPL:DJ-mix", "djmixer", "TIPL:mix", "mixer", "TMOO", "mood", "SYLT", "lyrics",
        "TSST", "discsubtitle", "TKEY", "key", "COMM", "comment", "TOPE", "originalartist",
        "PRIV:AverageLevel", "averageLevel", "PRIV:PeakLevel", "peakLevel",
        "TXXX:DISCOGS_ARTIST_ID", "discogs_artist_id", "TXXX:DISCOGS_ARTISTS", "artists", "TXXX:DISCOGS_ARTIST_NAME", "artists",
        "TXXX:DISCOGS_ALBUM_ARTISTS", "albumartist", "TXXX:DISCOGS_CATALOG", "catalognumber", "TXXX:DISCOGS_COUNTRY", "releasecountry",
        "TXXX:DISCOGS_DATE", "originaldate", "TXXX:DISCOGS_LABEL", "label", "TXXX:DISCOGS_LABEL_ID", "discogs_label_id",
        "TXXX:DISCOGS_MASTER_RELEASE_ID", "discogs_master_release_id", "TXXX:DISCOGS_RATING", "discogs_rating",
        "TXXX:DISCOGS_RELEASED", "date", "TXXX:DISCOGS_RELEASE_ID", "discogs_release_id", "TXXX:DISCOGS_VOTES", "discogs_votes",
        "TXXX:CATALOGID", "catalognumber", "TXXX:STYLE", "genre", "TXXX:REPLAYGAIN_TRACK_PEAK", "replaygain_track_peak",
        "TXXX:REPLAYGAIN_TRACK_GAIN", "replaygain_track_gain", "TXXX:REPLAYGAIN_ALBUM_PEAK", "replaygain_album_peak",
        "TXXX:REPLAYGAIN_ALBUM_GAIN", "replaygain_album_gain", "TXXX:MP3GAIN_MINMAX", "replaygain_track_minmax",
        "TXXX:MP3GAIN_ALBUM_MINMAX", "replaygain_album_minmax", "TXXX:MP3GAIN_UNDO", "replaygain_undo",
        "MVNM", "movement", "MVIN", "movementIndex", "PCST", "podcast", "TCAT", "category", "TDES", "description",
        "TDRL", "releasedate", "TGID", "podcastId", "TKWD", "keywords", "WFED", "podcasturl", "GRP1", "grouping",
        "PCNT", "playCounter"), true, Id3v24Post);

    private static void Id3v24Post(Mapper.Tag tag)
    {
        switch (tag.Id)
        {
            case "UFID":
                if (tag.Value is JsObj u && u["owner_identifier"] is "http://musicbrainz.org")
                {
                    tag.Id += ":http://musicbrainz.org";
                    tag.Value = Text.DecodeString((U8)u["identifier"]!, "latin1");
                }
                break;
            case "PRIV":
                if (tag.Value is JsObj p && p["owner_identifier"] is string owner && owner is "AverageLevel" or "PeakValue")
                {
                    tag.Id += ":" + owner;
                    var data = (U8)p["data"]!;
                    tag.Value = data.Length == 4 ? (double)data.U32LE(0) : null;
                }
                break;
            case "POPM":
                if (tag.Value is JsObj popm)
                {
                    var r = new JsObj();
                    r["source"] = popm["email"];
                    var rating = Js.ToNumber(popm["rating"]);
                    r["rating"] = rating > 0 ? (rating - 1) / 254 * 1 : Undef.V;
                    tag.Value = r;
                }
                break;
        }
    }

    public static readonly Mapper Mp4 = new(D(
        "©nam", "title", "©ART", "artist", "aART", "albumartist", "----:com.apple.iTunes:Band", "albumartist",
        "©alb", "album", "©day", "date", "©cmt", "comment", "©com", "comment", "trkn", "track", "disk", "disk",
        "©gen", "genre", "covr", "picture", "©wrt", "composer", "©lyr", "lyrics", "soal", "albumsort", "sonm", "titlesort",
        "soar", "artistsort", "soaa", "albumartistsort", "soco", "composersort",
        "----:com.apple.iTunes:LYRICIST", "lyricist", "----:com.apple.iTunes:CONDUCTOR", "conductor",
        "----:com.apple.iTunes:REMIXER", "remixer", "----:com.apple.iTunes:ENGINEER", "engineer",
        "----:com.apple.iTunes:PRODUCER", "producer", "----:com.apple.iTunes:DJMIXER", "djmixer",
        "----:com.apple.iTunes:MIXER", "mixer", "----:com.apple.iTunes:LABEL", "label", "©grp", "grouping",
        "----:com.apple.iTunes:SUBTITLE", "subtitle", "----:com.apple.iTunes:DISCSUBTITLE", "discsubtitle",
        "cpil", "compilation", "tmpo", "bpm", "----:com.apple.iTunes:MOOD", "mood", "----:com.apple.iTunes:MEDIA", "media",
        "----:com.apple.iTunes:CATALOGNUMBER", "catalognumber", "tvsh", "tvShow", "tvsn", "tvSeason", "tves", "tvEpisode",
        "sosn", "tvShowSort", "tven", "tvEpisodeId", "tvnn", "tvNetwork", "pcst", "podcast", "purl", "podcasturl",
        "----:com.apple.iTunes:MusicBrainz Album Status", "releasestatus", "----:com.apple.iTunes:MusicBrainz Album Type", "releasetype",
        "----:com.apple.iTunes:MusicBrainz Album Release Country", "releasecountry", "----:com.apple.iTunes:SCRIPT", "script",
        "----:com.apple.iTunes:LANGUAGE", "language", "cprt", "copyright", "©cpy", "copyright",
        "----:com.apple.iTunes:LICENSE", "license", "©too", "encodedby", "pgap", "gapless",
        "----:com.apple.iTunes:BARCODE", "barcode", "----:com.apple.iTunes:ISRC", "isrc", "----:com.apple.iTunes:ASIN", "asin",
        "----:com.apple.iTunes:NOTES", "comment", "----:com.apple.iTunes:MusicBrainz Track Id", "musicbrainz_recordingid",
        "----:com.apple.iTunes:MusicBrainz Release Track Id", "musicbrainz_trackid", "----:com.apple.iTunes:MusicBrainz Album Id", "musicbrainz_albumid",
        "----:com.apple.iTunes:MusicBrainz Artist Id", "musicbrainz_artistid", "----:com.apple.iTunes:MusicBrainz Album Artist Id", "musicbrainz_albumartistid",
        "----:com.apple.iTunes:MusicBrainz Release Group Id", "musicbrainz_releasegroupid", "----:com.apple.iTunes:MusicBrainz Work Id", "musicbrainz_workid",
        "----:com.apple.iTunes:MusicBrainz TRM Id", "musicbrainz_trmid", "----:com.apple.iTunes:MusicBrainz Disc Id", "musicbrainz_discid",
        "----:com.apple.iTunes:Acoustid Id", "acoustid_id", "----:com.apple.iTunes:Acoustid Fingerprint", "acoustid_fingerprint",
        "----:com.apple.iTunes:MusicIP PUID", "musicip_puid", "----:com.apple.iTunes:fingerprint", "musicip_fingerprint",
        "----:com.apple.iTunes:replaygain_track_gain", "replaygain_track_gain", "----:com.apple.iTunes:replaygain_track_peak", "replaygain_track_peak",
        "----:com.apple.iTunes:replaygain_album_gain", "replaygain_album_gain", "----:com.apple.iTunes:replaygain_album_peak", "replaygain_album_peak",
        "----:com.apple.iTunes:replaygain_track_minmax", "replaygain_track_minmax", "----:com.apple.iTunes:replaygain_album_minmax", "replaygain_album_minmax",
        "----:com.apple.iTunes:replaygain_undo", "replaygain_undo", "gnre", "genre",
        "----:com.apple.iTunes:ALBUMARTISTSORT", "albumartistsort", "----:com.apple.iTunes:ARTISTS", "artists",
        "----:com.apple.iTunes:ORIGINALDATE", "originaldate", "----:com.apple.iTunes:ORIGINALYEAR", "originalyear",
        "----:com.apple.iTunes:RELEASEDATE", "releasedate", "desc", "description", "ldes", "longDescription",
        "©mvn", "movement", "©mvi", "movementIndex", "©mvc", "movementTotal", "©wrk", "work", "catg", "category",
        "egid", "podcastId", "hdvd", "hdVideo", "keyw", "keywords", "shwm", "showMovement", "stik", "stik", "rate", "rating"), true, Mp4Post);

    private static void Mp4Post(Mapper.Tag tag)
    {
        if (tag.Id == "rate")
        {
            var r = new JsObj();
            r["source"] = Undef.V;
            r["rating"] = Js.ParseFloat(tag.Value) / 100;
            tag.Value = r;
        }
    }

    public static readonly Mapper Vorbis = new(D(
        "TITLE", "title", "ARTIST", "artist", "ARTISTS", "artists", "ALBUMARTIST", "albumartist", "ALBUM ARTIST", "albumartist",
        "ALBUM", "album", "DATE", "date", "ORIGINALDATE", "originaldate", "ORIGINALYEAR", "originalyear", "RELEASEDATE", "releasedate",
        "COMMENT", "comment", "DESCRIPTION", "comment", "TRACKNUMBER", "track", "DISCNUMBER", "disk", "GENRE", "genre",
        "METADATA_BLOCK_PICTURE", "picture", "COMPOSER", "composer", "LYRICS", "lyrics", "UNSYNCEDLYRICS", "lyrics",
        "ALBUMSORT", "albumsort", "TITLESORT", "titlesort", "WORK", "work", "ARTISTSORT", "artistsort",
        "ALBUMARTISTSORT", "albumartistsort", "COMPOSERSORT", "composersort", "LYRICIST", "lyricist", "WRITER", "writer",
        "CONDUCTOR", "conductor", "REMIXER", "remixer", "ARRANGER", "arranger", "ENGINEER", "engineer", "PRODUCER", "producer",
        "DJMIXER", "djmixer", "MIXER", "mixer", "LABEL", "label", "ORGANIZATION", "label", "PUBLISHER", "label",
        "GROUPING", "grouping", "SUBTITLE", "subtitle", "DISCSUBTITLE", "discsubtitle", "TRACKTOTAL", "totaltracks",
        "DISCTOTAL", "totaldiscs", "COMPILATION", "compilation", "RATING", "rating", "BPM", "bpm", "KEY", "key", "MOOD", "mood",
        "MEDIA", "media", "CATALOGNUMBER", "catalognumber", "RELEASESTATUS", "releasestatus", "RELEASETYPE", "releasetype",
        "RELEASECOUNTRY", "releasecountry", "SCRIPT", "script", "LANGUAGE", "language", "COPYRIGHT", "copyright",
        "LICENSE", "license", "ENCODEDBY", "encodedby", "ENCODERSETTINGS", "encodersettings", "BARCODE", "barcode",
        "ISRC", "isrc", "ASIN", "asin", "MUSICBRAINZ_TRACKID", "musicbrainz_recordingid", "MUSICBRAINZ_RELEASETRACKID", "musicbrainz_trackid",
        "MUSICBRAINZ_ALBUMID", "musicbrainz_albumid", "MUSICBRAINZ_ARTISTID", "musicbrainz_artistid",
        "MUSICBRAINZ_ALBUMARTISTID", "musicbrainz_albumartistid", "MUSICBRAINZ_RELEASEGROUPID", "musicbrainz_releasegroupid",
        "MUSICBRAINZ_WORKID", "musicbrainz_workid", "MUSICBRAINZ_TRMID", "musicbrainz_trmid", "MUSICBRAINZ_DISCID", "musicbrainz_discid",
        "ACOUSTID_ID", "acoustid_id", "ACOUSTID_ID_FINGERPRINT", "acoustid_fingerprint", "MUSICIP_PUID", "musicip_puid",
        "WEBSITE", "website", "NOTES", "notes", "TOTALTRACKS", "totaltracks", "TOTALDISCS", "totaldiscs",
        "DISCOGS_ARTIST_ID", "discogs_artist_id", "DISCOGS_ARTISTS", "artists", "DISCOGS_ARTIST_NAME", "artists",
        "DISCOGS_ALBUM_ARTISTS", "albumartist", "DISCOGS_CATALOG", "catalognumber", "DISCOGS_COUNTRY", "releasecountry",
        "DISCOGS_DATE", "originaldate", "DISCOGS_LABEL", "label", "DISCOGS_LABEL_ID", "discogs_label_id",
        "DISCOGS_MASTER_RELEASE_ID", "discogs_master_release_id", "DISCOGS_RATING", "discogs_rating", "DISCOGS_RELEASED", "date",
        "DISCOGS_RELEASE_ID", "discogs_release_id", "DISCOGS_VOTES", "discogs_votes", "CATALOGID", "catalognumber", "STYLE", "genre",
        "REPLAYGAIN_TRACK_GAIN", "replaygain_track_gain", "REPLAYGAIN_TRACK_PEAK", "replaygain_track_peak",
        "REPLAYGAIN_ALBUM_GAIN", "replaygain_album_gain", "REPLAYGAIN_ALBUM_PEAK", "replaygain_album_peak",
        "REPLAYGAIN_MINMAX", "replaygain_track_minmax", "REPLAYGAIN_ALBUM_MINMAX", "replaygain_album_minmax",
        "REPLAYGAIN_UNDO", "replaygain_undo"), false, VorbisPost);

    private static JsObj VorbisRating(string? email, object? rating, double maxScore)
    {
        var r = new JsObj();
        r["source"] = email is null ? Undef.V : Js.Lower(email);
        r["rating"] = Js.ParseFloat(rating) / maxScore * 1;
        return r;
    }

    private static void VorbisPost(Mapper.Tag tag)
    {
        if (tag.Id == "RATING") tag.Value = VorbisRating(null, tag.Value, 100);
        else if (tag.Id.StartsWith("RATING:", StringComparison.Ordinal))
        {
            var keys = tag.Id.Split(':');
            tag.Value = VorbisRating(keys[1].Length > 0 ? keys[1] : null, tag.Value, 1);
            tag.Id = keys[0];
        }
    }

    public static readonly Mapper Ape = new(D(
        "Title", "title", "Artist", "artist", "Artists", "artists", "Album Artist", "albumartist", "Album", "album",
        "Year", "date", "Date", "date", "Originalyear", "originalyear", "Originaldate", "originaldate", "Releasedate", "releasedate",
        "Comment", "comment", "Track", "track", "Disc", "disk", "DISCNUMBER", "disk", "Genre", "genre",
        "Cover Art (Front)", "picture", "Cover Art (Back)", "picture", "Composer", "composer", "Lyrics", "lyrics",
        "ALBUMSORT", "albumsort", "TITLESORT", "titlesort", "WORK", "work", "ARTISTSORT", "artistsort",
        "ALBUMARTISTSORT", "albumartistsort", "COMPOSERSORT", "composersort", "Lyricist", "lyricist", "Writer", "writer",
        "Conductor", "conductor", "MixArtist", "remixer", "Arranger", "arranger", "Engineer", "engineer", "Producer", "producer",
        "DJMixer", "djmixer", "Mixer", "mixer", "Label", "label", "Grouping", "grouping", "Subtitle", "subtitle",
        "DiscSubtitle", "discsubtitle", "Compilation", "compilation", "BPM", "bpm", "Mood", "mood", "Media", "media",
        "CatalogNumber", "catalognumber", "MUSICBRAINZ_ALBUMSTATUS", "releasestatus", "MUSICBRAINZ_ALBUMTYPE", "releasetype",
        "RELEASECOUNTRY", "releasecountry", "Script", "script", "Language", "language", "Copyright", "copyright",
        "LICENSE", "license", "EncodedBy", "encodedby", "EncoderSettings", "encodersettings", "Barcode", "barcode",
        "ISRC", "isrc", "ASIN", "asin", "musicbrainz_trackid", "musicbrainz_recordingid", "musicbrainz_releasetrackid", "musicbrainz_trackid",
        "MUSICBRAINZ_ALBUMID", "musicbrainz_albumid", "MUSICBRAINZ_ARTISTID", "musicbrainz_artistid",
        "MUSICBRAINZ_ALBUMARTISTID", "musicbrainz_albumartistid", "MUSICBRAINZ_RELEASEGROUPID", "musicbrainz_releasegroupid",
        "MUSICBRAINZ_WORKID", "musicbrainz_workid", "MUSICBRAINZ_TRMID", "musicbrainz_trmid", "MUSICBRAINZ_DISCID", "musicbrainz_discid",
        "Acoustid_Id", "acoustid_id", "ACOUSTID_FINGERPRINT", "acoustid_fingerprint", "MUSICIP_PUID", "musicip_puid",
        "Weblink", "website", "REPLAYGAIN_TRACK_GAIN", "replaygain_track_gain", "REPLAYGAIN_TRACK_PEAK", "replaygain_track_peak",
        "MP3GAIN_MINMAX", "replaygain_track_minmax", "MP3GAIN_UNDO", "replaygain_undo"), true);

    public static readonly Mapper Asf = new(D(
        "Title", "title", "Author", "artist", "WM/AlbumArtist", "albumartist", "WM/AlbumTitle", "album", "WM/Year", "date",
        "WM/OriginalReleaseTime", "originaldate", "WM/OriginalReleaseYear", "originalyear", "Description", "comment",
        "WM/TrackNumber", "track", "WM/PartOfSet", "disk", "WM/Genre", "genre", "WM/Composer", "composer", "WM/Lyrics", "lyrics",
        "WM/AlbumSortOrder", "albumsort", "WM/TitleSortOrder", "titlesort", "WM/ArtistSortOrder", "artistsort",
        "WM/AlbumArtistSortOrder", "albumartistsort", "WM/ComposerSortOrder", "composersort", "WM/Writer", "lyricist",
        "WM/Conductor", "conductor", "WM/ModifiedBy", "remixer", "WM/Engineer", "engineer", "WM/Producer", "producer",
        "WM/DJMixer", "djmixer", "WM/Mixer", "mixer", "WM/Publisher", "label", "WM/ContentGroupDescription", "grouping",
        "WM/SubTitle", "subtitle", "WM/SetSubTitle", "discsubtitle", "WM/IsCompilation", "compilation",
        "WM/SharedUserRating", "rating", "POPULARIMETER", "rating", "WM/BeatsPerMinute", "bpm", "WM/Mood", "mood",
        "WM/Media", "media", "WM/CatalogNo", "catalognumber", "MusicBrainz/Album Status", "releasestatus",
        "MusicBrainz/Album Type", "releasetype", "MusicBrainz/Album Release Country", "releasecountry", "WM/Script", "script",
        "WM/Language", "language", "Copyright", "copyright", "LICENSE", "license", "WM/EncodedBy", "encodedby",
        "WM/EncodingSettings", "encodersettings", "WM/Barcode", "barcode", "WM/ISRC", "isrc",
        "MusicBrainz/Track Id", "musicbrainz_recordingid", "MusicBrainz/Release Track Id", "musicbrainz_trackid",
        "MusicBrainz/Album Id", "musicbrainz_albumid", "MusicBrainz/Artist Id", "musicbrainz_artistid",
        "MusicBrainz/Album Artist Id", "musicbrainz_albumartistid", "MusicBrainz/Release Group Id", "musicbrainz_releasegroupid",
        "MusicBrainz/Work Id", "musicbrainz_workid", "MusicBrainz/TRM Id", "musicbrainz_trmid", "MusicBrainz/Disc Id", "musicbrainz_discid",
        "Acoustid/Id", "acoustid_id", "Acoustid/Fingerprint", "acoustid_fingerprint", "MusicIP/PUID", "musicip_puid",
        "WM/ARTISTS", "artists", "WM/InitialKey", "key", "ASIN", "asin", "WM/Work", "work", "WM/AuthorURL", "website",
        "WM/Picture", "picture"), false, AsfPost);

    private static void AsfPost(Mapper.Tag tag)
    {
        switch (tag.Id)
        {
            case "POPULARIMETER":
            {
                if (tag.Value is not string s) throw new JsError("tag.value.split is not a function");
                var parts = s.Split('|');
                var rating = parts.Length > 1 ? parts[1] : null;
                var value = rating is null ? double.NaN : Js.ToNumber(rating);
                var valid = rating is not null && rating.Length > 0 && rating.All(c => c >= '0' && c <= '9')
                    && Math.Floor(value) == value && value >= 0 && value <= 255;
                var r = new JsObj();
                r["source"] = parts[0];
                r["rating"] = valid && value > 0 ? (value - 1) / 254 * 1 : Undef.V;
                tag.Value = r;
                break;
            }
            case "WM/SharedUserRating":
            {
                var value = tag.Value is double d ? d : Js.ParseFloat(tag.Value);
                var r = new JsObj();
                r["rating"] = !double.IsFinite(value) || value <= 0 ? Undef.V : value / 99;
                tag.Value = r;
                tag.Id = tag.Id.Split(':')[0];
                break;
            }
        }
    }

    public static readonly Mapper Riff = new(D(
        "IART", "artist", "ICRD", "date", "INAM", "title", "TITL", "title", "IPRD", "album", "ITRK", "track", "IPRT", "track",
        "COMM", "comment", "ICMT", "comment", "ICNT", "releasecountry", "GNRE", "genre", "IWRI", "writer", "RATE", "rating",
        "YEAR", "year", "ISFT", "encodedby", "CODE", "encodedby", "TURL", "website", "IGNR", "genre", "IENG", "engineer",
        "ITCH", "technician", "IMED", "media", "IRPD", "album"), false);

    public static readonly Mapper Aiff = new(D("NAME", "title", "AUTH", "artist", "(c) ", "copyright", "ANNO", "comment"), false);
}
