// Scanner.Album.cs — an album's own columns made again from its tracks (out of Scanner.cs, which only shrinks): its
// year, label, genres, folder art, rates, identifiers and, since item 330, the artist it is filed under (ArtistRows.cs).
namespace Mandarin.Server.Scan;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Scanner
{
    /* Recompute an album's derived columns from its tracks. */
    private void RefreshAlbum(double id, Dictionary<string, List<string>>? imagesByDir)
    {
        var tracks = All("SELECT * FROM tracks WHERE album_id = $id ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path", ("$id", id));
        if (tracks.Count == 0) return;
        var now = NowMs();
        var years = Count(tracks.Select(t => t["year"]));
        var labels = Count(tracks.Select(t => t["label"]));
        var genres = new List<object?>();
        foreach (var t in tracks) foreach (var g in GenresOf(t)) if (!genres.Any(x => Same(x, g))) genres.Add(g);
        var dirs = Count(tracks.Select(t => (object?)NodePath.Dirname(Js.Str(t["path"]))));
        var dir = dirs.Count > 0 ? Js.Str(dirs[0]) : "";
        if (ScanNames.DiscDir().IsMatch(NodePath.Basename(dir))) dir = NodePath.Dirname(dir);
        // Folder art: the album's own folder, then each disc folder.
        string? art = null;
        foreach (var d in new[] { dir }.Concat(dirs.Select(x => Js.Str(x))))
        {
            var list = imagesByDir != null && imagesByDir.TryGetValue(d, out var imgs) ? imgs : ListImages(d);
            art = PickArt(list);
            if (art != null) break;
        }
        var lossy = tracks.Any(t => !Js.Truthy(t["lossless"]));
        var maxRate = JsMax(tracks.Select(t => Js.Truthy(t["sample_rate"]) ? t["sample_rate"] : 0.0));
        var maxBits = JsMax(tracks.Select(t => Js.Truthy(t["bits"]) ? t["bits"] : 0.0));
        var containers = Count(tracks.Select(t => t["container"]));
        var duration = 0.0;
        foreach (var t in tracks) duration += Js.Truthy(t["duration"]) ? Js.ToNumber(t["duration"]) : 0;
        var addedAt = JsMin(tracks.Select(t => t["mtime"]));
        object? First(List<object?> l) => l.Count > 0 ? l[0] : null;
        Exec(@"UPDATE albums SET year=$year, date=$date, label=$label, genres=$genres, dir=$dir, art_path=$art_path, art_embedded=$art_embedded,
                 art_hash=$art_hash, track_count=$track_count, duration=$duration, max_rate=$max_rate, max_bits=$max_bits,
                 lossless=$lossless, container=$container, added_at=$added_at,
                 barcode=$barcode, catno=$catno, country=$country, mb_album=$mb_album, mb_group=$mb_group, updated_at=$now WHERE id=$id",
            ("$id", id),
            ("$year", First(years)),
            ("$date", AlbumDateOf(tracks.Select(t => t["date"]), First(years))),
            ("$label", First(labels)),
            ("$genres", Js.Json(genres.Take(8).ToList())),
            ("$dir", dir),
            ("$art_path", art),
            ("$art_embedded", art != null ? null : tracks[0]["path"]),
            ("$art_hash", art != null ? ArtHash(art) : ArtHash(Js.Str(tracks[0]["path"]))),
            ("$track_count", (double)tracks.Count),
            ("$duration", duration),
            ("$max_rate", OrNull(maxRate)),
            ("$max_bits", OrNull(maxBits)),
            ("$lossless", lossy ? 0.0 : 1.0),
            ("$container", First(containers)),
            ("$added_at", addedAt == 0 || double.IsNaN(addedAt) ? now : addedAt),
            // The release's identifiers: what most of its tracks say.
            ("$barcode", First(Count(tracks.Select(t => t["barcode"])))),
            ("$catno", First(Count(tracks.Select(t => t["catno"])))),
            ("$country", First(Count(tracks.Select(t => t["country"])))),
            ("$mb_album", First(Count(tracks.Select(t => t["mb_album"])))),
            ("$mb_group", First(Count(tracks.Select(t => t["mb_group"])))),
            ("$now", now));
        FileUnderArtist(id, First(Count(tracks.Select(t => t["mb_artist"]))));
    }

    /*
     * Album [id] filed under its artist (item 330): the act its MusicBrainz id says ([mbid], what most of its tracks'
     * tags say), else the id its applied MusicBrainz match gives for an act of the same name, else the one act of that
     * name (Artists.For). Two acts of one name, each with its own id, are two artists.
     */
    private void FileUnderArtist(double id, object? mbid)
    {
        var al = Get("SELECT a.key, a.artist, m.candidate FROM albums a LEFT JOIN album_matches m ON m.key = a.key AND m.status = 'applied' WHERE a.id = $id", ("$id", id));
        if (al == null) return;
        var name = Js.Str(al["artist"]);
        var (matched, note) = ArtistRows.FromMatch(al["candidate"] as string, name);
        var tagged = mbid is string s && s.Length > 0 ? s : null;
        var act = ArtistRows.For(db, tx, name, tagged ?? matched, tagged == null || tagged == matched ? note : null);
        Exec("UPDATE albums SET mb_artist = $mb, artist_id = $act WHERE id = $id", ("$mb", tagged ?? matched), ("$act", (double)act), ("$id", id));
    }

    /*
     * Albums not yet filed under an artist (a library from before item 330), and those whose applied MusicBrainz match
     * names their act's id since (identification applies a match without touching the files): filed now, at the end of
     * each scan, by what most of their tracks' tags say and their match.
     */
    private void FileUnfiled()
    {
        var ids = All(@"SELECT a.id FROM albums a LEFT JOIN album_matches m ON m.key = a.key AND m.status = 'applied'
                         WHERE a.artist_id IS NULL OR (a.mb_artist IS NULL AND m.candidate LIKE '%""artist_mbid"":""%')");
        foreach (var r in ids)
        {
            var id = Js.ToNumber(r["id"]);
            var tagged = Get("SELECT mb_artist FROM tracks WHERE album_id = $id AND mb_artist IS NOT NULL GROUP BY mb_artist ORDER BY COUNT(*) DESC LIMIT 1", ("$id", id));
            FileUnderArtist(id, tagged?["mb_artist"]);
        }
    }
}
