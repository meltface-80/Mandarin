// Scanner.Regroup.cs — a folder's tracks made its albums (out of Scanner.cs, which only shrinks): each group GroupDir
// finds given its album (AlbumIdFor), each track read written or moved to it, and the albums made ready to show at
// once. The scan does it for each folder with something new in it; Edit album's Split…, Join back and Look at this
// album again (item 424, Scanner.Split.cs) for the folders of the album they were asked of.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Scan;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Scanner
{
    /*
     * [full]: every track of folder [dir], those read now and those unchanged ("unchanged": its row as it is); [prevOf]:
     * a path's track before this scan. Each album touched goes in [touched]. [biggestFirst] (item 424): the groups given
     * their albums biggest first, so where a folder's album comes apart the biggest part keeps its id.
     */
    private void Regroup(string dir, List<JsObj> full, OrderedIds touched, Func<string, Known?> prevOf, Dictionary<string, List<string>>? imagesByDir, bool biggestFirst = false)
    {
        var groups = GroupDir(dir, full);
        var now = NowMs();
        if (biggestFirst) groups = [.. groups.OrderByDescending(g => g.Rows.Count)];
        Transaction(() =>
        {
            foreach (var g in groups)
            {
                var albumId = AlbumIdFor(g, dir, now);
                touched.Add(albumId);
                foreach (var r in g.Rows)
                {
                    if (Js.Truthy(r["unchanged"]))
                    {
                        if (!Js.StrictEq(r["album_id"], albumId))
                        {
                            touched.Add(Js.ToNumber(r["album_id"]));
                            Exec("UPDATE tracks SET album_id = $a WHERE id = $id", ("$a", albumId), ("$id", r["id"]));
                        }
                        continue;
                    }
                    var path = Js.Str(r["path"]);
                    var prev = prevOf(path);
                    if (prev != null) touched.Add(Js.ToNumber(prev.AlbumId));
                    object? Or(object? v) => Js.Truthy(v) ? v : null; object? Nul(object? v) => Js.IsNullish(v) ? null : v;
                    Exec(UpsertTrack,
                        ("$album_id", albumId), ("$path", r["path"]), ("$mtime", r["mtime"]), ("$size", r["size"]), ("$title", r["title"]), ("$artist", r["artist"]),
                        ("$album_artist", r["album_artist"]), ("$album", r["album"]), ("$track_no", r["track_no"]), ("$disc_no", r["disc_no"]), ("$duration", r["duration"]),
                        ("$codec", r["codec"]), ("$container", r["container"]), ("$sample_rate", r["sample_rate"]), ("$bits", r["bits"]), ("$channels", r["channels"]),
                        ("$lossless", r["lossless"]), ("$year", r["year"]), ("$date", Or(r["date"])), ("$label", r["label"]),
                        ("$genres", Js.Json(Js.Truthy(r["genres"]) ? r["genres"] : new List<object?>())),
                        ("$tags_v", TagsV), ("$isrc", Or(r["isrc"])), ("$barcode", Or(r["barcode"])), ("$catno", Or(r["catno"])), ("$country", Or(r["country"])),
                        ("$mb_album", Or(r["mb_album"])), ("$mb_group", Or(r["mb_group"])), ("$mb_recording", Or(r["mb_recording"])), ("$mb_artist", Or(r["mb_artist"])),
                        ("$rg_track_gain", Nul(r["rg_track_gain"])), ("$rg_track_peak", Nul(r["rg_track_peak"])),
                        ("$rg_album_gain", Nul(r["rg_album_gain"])), ("$rg_album_peak", Nul(r["rg_album_peak"])),
                        ("$names_from", Or(r["names_from"])), ("$composer", Or(r["composer"])), ("$conductor", Or(r["conductor"])), ("$work", Or(r["work"])), ("$movement", Or(r["movement"])), ("$movement_no", Nul(r["movement_no"])), ("$performers", Or(r["performers"])));
                    var tid = Get("SELECT id FROM tracks WHERE path = $p", ("$p", path));
                    if (tid != null) Exec("INSERT INTO track_tags(track_id, tags) VALUES($id, $t) ON CONFLICT(track_id) DO UPDATE SET tags = excluded.tags",
                        ("$id", tid["id"]), ("$t", Js.Json(Js.Truthy(r["tags"]) ? r["tags"] : new JsObj())));
                    // A file changed on disk is measured again (lib/loudness.js).
                    if (tid != null && prev != null && (!Js.StrictEq(prev.Mtime, r["mtime"]) || !Js.StrictEq(prev.Size, r["size"])))
                        Exec("DELETE FROM track_loudness WHERE track_id = $id", ("$id", tid["id"]));
                }
            }
            // Ready to show and play now, not only when the whole scan ends.
            foreach (var g in groups)
            {
                var id = Get("SELECT id FROM albums WHERE key = $k", ("$k", g.Key));
                if (id != null) RefreshAlbum(Js.ToNumber(id["id"]), imagesByDir);
            }
        });
    }

    private const string UpsertTrack = @"INSERT INTO tracks(album_id, path, mtime, size, title, artist, album_artist, album, track_no, disc_no, duration,
          codec, container, sample_rate, bits, channels, lossless, year, date, label, genres,
          tags_v, isrc, barcode, catno, country, mb_album, mb_group, mb_recording, mb_artist,
          rg_track_gain, rg_track_peak, rg_album_gain, rg_album_peak, names_from, composer, conductor, work, movement, movement_no, performers)
        VALUES($album_id, $path, $mtime, $size, $title, $artist, $album_artist, $album, $track_no, $disc_no, $duration,
          $codec, $container, $sample_rate, $bits, $channels, $lossless, $year, $date, $label, $genres,
          $tags_v, $isrc, $barcode, $catno, $country, $mb_album, $mb_group, $mb_recording, $mb_artist,
          $rg_track_gain, $rg_track_peak, $rg_album_gain, $rg_album_peak, $names_from, $composer, $conductor, $work, $movement, $movement_no, $performers)
        ON CONFLICT(path) DO UPDATE SET album_id=excluded.album_id, mtime=excluded.mtime, size=excluded.size,
          title=excluded.title, artist=excluded.artist, album_artist=excluded.album_artist, album=excluded.album,
          track_no=excluded.track_no, disc_no=excluded.disc_no, duration=excluded.duration, codec=excluded.codec,
          container=excluded.container, sample_rate=excluded.sample_rate, bits=excluded.bits, channels=excluded.channels,
          lossless=excluded.lossless, year=excluded.year, date=excluded.date, label=excluded.label, genres=excluded.genres,
          tags_v=excluded.tags_v, isrc=excluded.isrc, barcode=excluded.barcode, catno=excluded.catno, country=excluded.country,
          mb_album=excluded.mb_album, mb_group=excluded.mb_group, mb_recording=excluded.mb_recording, mb_artist=excluded.mb_artist,
          rg_track_gain=excluded.rg_track_gain, rg_track_peak=excluded.rg_track_peak,
          rg_album_gain=excluded.rg_album_gain, rg_album_peak=excluded.rg_album_peak, names_from=excluded.names_from, composer=excluded.composer,
          conductor=excluded.conductor, work=excluded.work, movement=excluded.movement, movement_no=excluded.movement_no, performers=excluded.performers";
}
