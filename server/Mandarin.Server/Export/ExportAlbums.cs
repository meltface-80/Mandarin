// ExportAlbums.cs — each album of the library export as the files say it (item 442), for Mandarin Migration:
//   - its artist the album-artist tag exactly as tagged (your Edit album's where you changed it), never Mandarin's name
//     for it rebuilt from the acts in it; no such tag: the track artist's, "Various Artists" where they differ;
//   - its title the album tag's (your edit's), its notes stripped (ExportNotes.cs);
//   - a value no tag said, taken from a folder's name, said in the export's "from_path" column, never passed off as a tag;
//   - two copies of a record merged into one album (a track number twice on a disc): one copy, the first by its folder;
//   - its barcode: the version's, the files' BARCODE, UPC or EAN however tagged, else the barcode of the MusicBrainz release
//     the files name (MUSICBRAINZ_ALBUMID), from the MusicBrainz pack where it is installed.
using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mandarin.Server.Export;
using Mandarin.Server.Scan;

namespace Mandarin.Server;

internal static partial class Library
{
    /* A track as exported. */
    private sealed record ExportTrack(long Id, string Path, string Title, string Artist, int Disc, int? No, string Seconds, string Isrc, string FromPath);

    /* An album as exported: what the CSV's rows of it say, and what was left of it. */
    private sealed class ExportAlbum
    {
        public required Album Al { get; init; }
        public string Artist = "", Title = "", Year = "", Barcode = "";
        public int? Disc;
        public bool NumberedCopy;
        public List<ExportTrack> Tracks = [];
        public List<string> FromPath = [], Stripped = [];
        public int CopyLeftOut;
    }

    [GeneratedRegex(@"^(?:CD|Dis[ck])\s*\d{1,2}$", RegexOptions.IgnoreCase)] private static partial Regex DiscOnly();
    [GeneratedRegex(@"(?:^|:)(?:BARCODE|UPC|EAN|EAN13|UPC_EAN)$")] private static partial Regex BarcodeTag();

    /* Album [al] as exported, its tracks from [c]; [edits]: Edit album's (title, artist) by key; [pack]: the MusicBrainz pack, or null. */
    private static ExportAlbum? ExportOne(Microsoft.Data.Sqlite.SqliteConnection c, Snapshot s, Album al, Dictionary<string, (string? Title, string? Artist)> edits, Identify.MbPack? pack)
    {
        var rows = Rows(c, @"SELECT id, path, title, artist, album_artist, album, disc_no, track_no, duration, isrc, barcode, names_from, mb_album, sample_rate, bits, codec
                             FROM tracks WHERE album_id = $1 ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path", (double)al.Id);
        if (rows.Count == 0) return null;
        var x = new ExportAlbum { Al = al };
        static bool From(object?[] r, string what) => (Text(r[11]) ?? "").Split(',').Contains(what);

        // Two copies merged into one album: the first copy alone (MergedCopies' way, the biggest part).
        var copies = rows.Select(r => new MergedCopies.Track((long)r[0]!, (string)r[1]!, Text(r[2]) ?? "", Dbl(r[6]), Dbl(r[7]), Dbl(r[13]), Dbl(r[14]), Text(r[15]))).ToList();
        if (MergedCopies.Repeats(copies) && MergedCopies.Ways(copies) is { Count: > 0 } ways)
        {
            var keep = ways[0].Parts[0].Tracks.Select(t => t.Id).ToHashSet();
            x.CopyLeftOut = rows.Count - keep.Count;
            rows = rows.Where(r => keep.Contains((long)r[0]!)).ToList();
        }
        var tagged = rows.Where(r => !From(r, "artist")).ToList();
        var edit = edits.GetValueOrDefault(al.Key);

        // The artist as tagged.
        string? Commonest(IEnumerable<object?[]> of, int col) => of.Select(r => Text(r[col])?.Trim()).OfType<string>().Where(v => v.Length > 0)
            .GroupBy(v => v, StringComparer.Ordinal).OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal).Select(g => g.Key).FirstOrDefault();
        var trackArtists = tagged.Select(r => Text(r[3])?.Trim()).OfType<string>().Where(v => v.Length > 0).Distinct(StringComparer.Ordinal).ToList();
        string artist;
        var artistFromPath = false;
        if (edit.Artist is { Length: > 0 } ea) artist = ea;
        else if (Commonest(tagged, 4) is { } aa) artist = aa;
        else if (trackArtists.Count == 1) artist = trackArtists[0];
        else if (trackArtists.Count > 1) artist = "Various Artists";
        else { artist = al.ScannedArtist; artistFromPath = true; x.FromPath.Add("album_artist"); }
        var (cleanArtist, artistNote) = ExportNotes.Artist(artist, artistFromPath);
        x.Artist = cleanArtist;
        if (artistNote != null) x.Stripped.Add("album_artist: " + artistNote);

        // The title as tagged, its notes stripped; one a folder's name gave said so.
        ExportNotes.Title t;
        if (edit.Title is { Length: > 0 } et) t = ExportNotes.Clean(et, x.Artist, false);
        else if (Commonest(rows.Where(r => !From(r, "album")), 5) is { } at) t = ExportNotes.Clean(at, x.Artist, false);
        else { t = ExportNotes.Clean(al.ScannedTitle, x.Artist, true); x.FromPath.Add("album"); }
        if (t.Text.Length == 0 || DiscOnly().IsMatch(t.Text))
        {
            // Its title only a disc's ("Disc 1"): the album's folder's name, the disc's own folder passed over.
            var disc = t.Disc ?? (DiscOnly().IsMatch(t.Text) ? int.Parse(new string(t.Text.Where(char.IsAsciiDigit).ToArray()), CultureInfo.InvariantCulture) : null);
            var folder = FolderName(al.Dir ?? NodePath.Dirname((string)rows[0][1]!));
            var f = ExportNotes.Clean(folder, x.Artist, true);
            t = f with { Disc = f.Disc ?? disc, Stripped = [.. t.Stripped, t.Text, .. f.Stripped] };
            if (!x.FromPath.Contains("album")) x.FromPath.Add("album");
        }
        x.Title = t.Text;
        x.Disc = t.Disc;
        x.NumberedCopy = t.Stripped.Any(n => n.Length is >= 3 and <= 4 && n[0] == '(' && n[1..^1].All(char.IsAsciiDigit));
        x.Stripped.AddRange(t.Stripped.Select(n => "album: " + n));
        x.Year = (al.Year ?? t.Year)?.ToString(CultureInfo.InvariantCulture) ?? "";

        // Its barcode.
        var version = VersionBase(c, al);
        x.Barcode = ExportBarcode(al.VersionOwn?.GetValueOrDefault("barcode") ?? version["barcode"].Value)
            ?? rows.Select(r => ExportBarcode(Text(r[10]))).FirstOrDefault(b => b != null)
            ?? RawBarcode(c, rows.Select(r => (long)r[0]!))
            ?? (pack == null ? null : rows.Select(r => Text(r[12])).OfType<string>().Distinct().Select(pack.BarcodeOf).FirstOrDefault(b => b != null))
            ?? "";

        s.TrackEdits.TryGetValue(al.Key, out var titles);
        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            string? edited = null;
            titles?.TryGetValue(Identify.Identifier.TrackPos(r[6], r[7], i), out edited);
            var from = new List<string>();
            if (From(r, "title") && edited == null) from.Add("title");
            if (From(r, "artist")) from.Add("artist");
            var tagDisc = Dbl(r[6]) is double d && d > 0 ? (int)d : (int?)null;
            // A disc ripped as an album of its own ("… CD2"): its tracks that disc of the set.
            var discNo = x.Disc is int ad && (tagDisc ?? 1) == 1 ? ad : tagDisc ?? 1;
            var no = Dbl(r[7]) is double n && n > 0 ? (int)n : (int?)null;
            var seconds = r[8] is double sec ? Math.Round(sec).ToString(CultureInfo.InvariantCulture) : "";
            x.Tracks.Add(new ExportTrack((long)r[0]!, (string)r[1]!, edited ?? Text(r[2]) ?? "", Text(r[3]) ?? x.Artist, discNo, no, seconds, Text(r[9]) ?? "", string.Join(' ', from)));
        }
        return x;
    }

    /* The album's folder's own name: [dir]'s, a disc's folder ("CD1") passed over. */
    private static string FolderName(string dir)
    {
        var d = dir.TrimEnd('/', '\\');
        while (ScanNames.DiscDir().IsMatch(NodePath.Basename(d)) && NodePath.Dirname(d) is { Length: > 0 } up && up != d) d = up;
        return NodePath.Basename(d);
    }

    /* A barcode in the files' own tags however named (TXXX:UPC, ----:COM.APPLE.ITUNES:EAN), for files read before they were. */
    private static string? RawBarcode(Microsoft.Data.Sqlite.SqliteConnection c, IEnumerable<long> ids)
    {
        foreach (var id in ids)
        {
            if (Rows(c, "SELECT tags FROM track_tags WHERE track_id = $1", id).FirstOrDefault()?[0] is not string json) continue;
            JsonObject? o;
            try { o = JsonNode.Parse(json) as JsonObject; } catch (System.Text.Json.JsonException) { continue; }
            foreach (var (k, v) in o ?? [])
                if (BarcodeTag().IsMatch(k) && (v is JsonArray a ? a.FirstOrDefault()?.ToString() : v?.ToString()) is { } raw && ExportBarcode(raw) is { } code) return code;
        }
        return null;
    }

}
