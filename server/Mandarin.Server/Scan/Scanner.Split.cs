// Scanner.Split.cs — two copies of a record merged into one album, taken apart (bug list item 424).
//
// An album is its folder (v0.6.0-RC8), so two releases in one folder with one album tag are one album, and a file moved
// keeps its album (a folder renamed keeps its plays and edits). The owner's Moanin' (Remastered 2013, 6 tracks, and the
// SACD Version, 7, in one folder) stayed one album of 13 when its files were moved into a folder each: every scan after
// said "moved 7 files" and nothing else. Now:
//   - the scan: an album whose tracks lie in more than one folder (a disc folder, "CD1", "Disc 2", is its album's; so
//     are sibling folders naming the discs of one title, "Name (Disc 1)") is grouped by folder as a fresh scan would:
//     the folder holding most of its tracks keeps the album — its id, key, plays, heart, edits and match (ties: the
//     folder whose name is most like the album's folder before, then the first by name); each other folder's tracks are
//     the album of that folder (one it has already, else a new one), a version of it. A whole album moved stays one.
//   - Edit album's Split by folder does the same at once; Split… lays the album's tracks out in parts the owner chose
//     (by the version words in their titles, their format, or the copies a repeated track number makes), kept as a hand
//     split (album_splits: each track's part, by path) that every scan keeps to, the biggest part keeping the album.
//   - Join back undoes either: a hand split's parts one album again (their rows gone), or (just after Split by folder)
//     the folders' albums joined into the one kept, the join kept (album_joins: a folder's tracks that album's).
//   - Look at this album again: the album's folders read again from their files and grouped from scratch, now.
// Plays follow their tracks to the part they are in; backups keep the hand splits and joins (Admin/Backup.cs).
using Mandarin.Server.Tags;

namespace Mandarin.Server.Scan;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Scanner
{
    private Dictionary<string, string>? parts;   // album_splits: a track's path → its part
    private bool? overlays;                      // whether the database has the tables (one from before item 424 may not, until the server opens it)

    private bool Overlays() => overlays ??= Get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'album_joins'") != null;

    /* The part of a hand split the track at [path] is in; "" where it is in none. */
    private string PartOf(string path)
    {
        if (parts == null)
        {
            parts = new(StringComparer.Ordinal);
            if (Overlays()) foreach (var r in All("SELECT path, part FROM album_splits")) parts[Js.Str(r["path"])] = Js.Str(r["part"]);
        }
        return parts.TryGetValue(path, out var p) ? p : "";
    }

    /* The album Join back joined [g]'s folder [dir] into, where it is still here and of [g]'s act and title. */
    private double? JoinedInto(Group g, string dir)
    {
        if (!Overlays()) return null;
        var r = Get("SELECT a.id, a.key FROM album_joins j JOIN albums a ON a.key = j.key WHERE j.dir = $d", ("$d", NodePath.Resolve(dir)));
        return r != null && BaseOf(Js.Str(r["key"])) == g.Base ? Js.ToNumber(r["id"]) : null;
    }

    /* The folders joined into the album of [key]. */
    private HashSet<string> JoinedDirs(string key) =>
        Overlays() ? All("SELECT dir FROM album_joins WHERE key = $k", ("$k", key)).Select(r => Js.Str(r["dir"])).ToHashSet(StringComparer.Ordinal) : [];

    /* An album key's act and title. */
    private static string BaseOf(string key) => string.Join("\u0001", key.Split('\u0001').Take(2));

    /* The folder a track is in, as its album has it: a disc folder's ("CD1", "Disc 2 - …") is the one above. */
    internal static string AlbumDirOf(string path)
    {
        var d = NodePath.Dirname(path);
        return ScanNames.DiscDir().IsMatch(NodePath.Basename(d)) ? NodePath.Dirname(d) : d;
    }

    /* Where a track is, as an album is told apart: its album's folder, sibling folders that name the discs of one title ("Name (Disc 1)", "Name (Disc 2)") one place. */
    internal static string PlaceOf(string path)
    {
        var d = AlbumDirOf(path);
        return DiscOfTitle(NodePath.Basename(d)) is { } t ? NodePath.Dirname(d) + "/\u0000" + ScanNames.Key(t.Title) : d;
    }

    /* How alike two folder names are: the letters they start with in common. */
    private static int Alike(string a, string b)
    {
        int i = 0;
        while (i < a.Length && i < b.Length && char.ToLowerInvariant(a[i]) == char.ToLowerInvariant(b[i])) i++;
        return i;
    }

    /* A track's row as the scan holds one it hasn't read again. */
    private static JsObj Unchanged(JsObj t)
    {
        var o = new JsObj();
        o["unchanged"] = true;
        o["genres"] = JsJson.Parse(Js.Truthy(t["genres"]) ? Js.Str(t["genres"]) : "[]");
        foreach (var k in t.Keys) o[k] = t[k];
        return o;
    }

    /* The plays of album [from] go with their tracks to the albums those are in now. */
    private void PlaysFollow(double from) =>
        Exec(@"UPDATE plays SET album_id = (SELECT t.album_id FROM tracks t WHERE t.id = plays.track_id)
               WHERE album_id = $a AND track_id IN (SELECT id FROM tracks WHERE album_id != $a)", ("$a", from));

    /* The folders [albumId]'s tracks are in (a disc folder's album's), where their files are. */
    private List<string> DirsOf(double albumId) =>
        All("SELECT path FROM tracks WHERE album_id = $id ORDER BY path", ("$id", albumId)).Select(r => Js.Str(r["path"]))
            .Where(p => !p.Contains("://", StringComparison.Ordinal)).Select(AlbumDirOf).Distinct(StringComparer.Ordinal).ToList();

    /*
     * After the scan's walk: every album whose tracks found this time ([seen]) lie in more than one place, grouped by
     * folder (SplitByFolder). A file moved keeps its album (Relocate), so this is where moving one release's files out
     * of a folder of two makes two albums of it; it finds an album merged that way by an earlier scan too.
     */
    private void SplitStrays(HashSet<string> seen, OrderedIds touched)
    {
        var places = new Dictionary<double, HashSet<string>>();
        foreach (var r in All("SELECT album_id, path FROM tracks"))
        {
            var p = Js.Str(r["path"]);
            if (!seen.Contains(p)) continue;
            var a = Js.ToNumber(r["album_id"]);
            if (!places.TryGetValue(a, out var set)) places[a] = set = new(StringComparer.Ordinal);
            set.Add(PlaceOf(p));
        }
        foreach (var (id, set) in places)
        {
            if (set.Count < 2) continue;
            var made = SplitByFolder(id, seen.Contains);
            if (made.Count == 0) continue;
            touched.Add(id);
            foreach (var m in made) touched.Add(m);
        }
    }

    /*
     * Album [albumId] grouped by folder, as a fresh scan groups it (its tracks where [here] says their files are, a
     * folder joined into it left as it is): the place holding most of them keeps the album, under its own folder's key;
     * each other's tracks go to that folder's album, one it has or a new one. The albums made; none where it is in one place.
     */
    public List<double> SplitByFolder(double albumId, Func<string, bool> here)
    {
        var made = new List<double>();
        var al = Get("SELECT id, key, dir, title FROM albums WHERE id = $id", ("$id", albumId));
        if (al == null) return made;
        var key = Js.Str(al["key"]);
        var joined = JoinedDirs(key);
        var places = new List<(string Place, List<JsObj> Rows)>();
        foreach (var t in All("SELECT * FROM tracks WHERE album_id = $id ORDER BY path", ("$id", albumId)))
        {
            var p = Js.Str(t["path"]);
            if (p.Contains("://", StringComparison.Ordinal) || !here(p) || joined.Contains(AlbumDirOf(p))) continue;
            var place = PlaceOf(p);
            var i = places.FindIndex(x => x.Place == place);
            if (i < 0) places.Add((place, [t])); else places[i].Rows.Add(t);
        }
        if (places.Count < 2) return made;
        var was = NodePath.Basename(Js.Str(al["dir"]));
        string DirOf((string Place, List<JsObj> Rows) x) => AlbumDirOf(Js.Str(x.Rows[0]["path"]));
        var keep = places.OrderByDescending(x => x.Rows.Count).ThenByDescending(x => Alike(NodePath.Basename(DirOf(x)), was))
            .ThenBy(x => x.Place, StringComparer.Ordinal).First();
        // The album keeps its key, its own folder's now: what hangs on it stays with the part it keeps.
        var seg = key.Split('\u0001');
        if (seg.Length >= 3)
        {
            var want = seg[0] + "\u0001" + seg[1] + "\u0001" + RelFolder(DirOf(keep)) + (seg.Length > 3 ? "\u0001" + string.Join("\u0001", seg[3..]) : "");
            if (want != key && Get("SELECT id FROM albums WHERE key = $k", ("$k", want)) == null) { Rekey(key, want); key = want; }
        }
        claimed ??= [];
        claimed.Add(albumId);
        var now = NowMs();
        foreach (var place in places)
        {
            if (place.Place == keep.Place) continue;
            foreach (var inDir in place.Rows.GroupBy(r => AlbumDirOf(Js.Str(r["path"]))))
                foreach (var g in GroupDir(inDir.Key, inDir.Select(Unchanged).ToList()))
                {
                    if (g.Key == key) continue;   // the album's own key (it couldn't take its folder's): left with it
                    var hit = Get("SELECT id FROM albums WHERE key = $k", ("$k", g.Key));
                    var to = hit != null ? Js.ToNumber(hit["id"]) : NewAlbum(g, inDir.Key, now);
                    claimed.Add(to);
                    foreach (var r in g.Rows) Exec("UPDATE tracks SET album_id = $a WHERE id = $id", ("$a", to), ("$id", r["id"]));
                    if (!made.Contains(to)) made.Add(to);
                }
        }
        PlaysFollow(albumId);
        RefreshAlbum(albumId, null);
        foreach (var id in made) RefreshAlbum(id, null);
        if (made.Count > 0)
            log($"[scan] {Js.Str(al["title"])}: its tracks were in {places.Count} folders — {made.Count + 1} albums now, the folder with most of them keeping the album");
        return made;
    }

    /* Each folder in [dirs] grouped again from what the library holds of it, the biggest group of each keeping its album. */
    private void RegroupDirs(IEnumerable<string> dirs, OrderedIds touched)
    {
        parts = null;
        foreach (var dir in dirs)
        {
            var like = LikeEscapes().Replace(dir, m => "\\" + m.Value) + "/%";
            var full = All("SELECT * FROM tracks WHERE path LIKE $l ESCAPE '\\' ORDER BY path", ("$l", like))
                .Where(t => AlbumDirOf(Js.Str(t["path"])) == dir).Select(Unchanged).ToList();
            if (full.Count > 0) Regroup(dir, full, touched, _ => null, null, biggestFirst: true);
        }
    }

    /* After a split or a join: plays with their tracks, every album touched made again, those left empty gone. */
    private void Settle(OrderedIds touched)
    {
        foreach (var id in touched.Items) PlaysFollow(id);
        foreach (var id in touched.Items) RefreshAlbum(id, null);
        DropEmptyAlbums();
        FileUnfiled();
        ArtistRows.Prune(db, tx);
    }

    /* Edit album's Split by folder: any join of it let go, then grouped by folder (SplitByFolder). The albums its tracks are in now, it first. */
    public List<double> SplitFolders(double albumId)
    {
        var made = new List<double>();
        claimed = [];
        Transaction(() =>
        {
            if (Get("SELECT key FROM albums WHERE id = $id", ("$id", albumId)) is { } al && Overlays())
                Exec("DELETE FROM album_joins WHERE key = $k", ("$k", al["key"]));
            made = SplitByFolder(albumId, PosixFs.Exists);
            var touched = new OrderedIds();
            touched.Add(albumId);
            foreach (var m in made) touched.Add(m);
            Settle(touched);
        });
        return [albumId, .. made];
    }

    /*
     * Edit album's Split… : [partOf] (a track's path → its part's name) kept as a hand split, and the album's folders
     * grouped again by it: the biggest part keeps the album, each other is an album of its own. The albums its tracks are in now.
     */
    public List<double> SplitByHand(double albumId, IReadOnlyDictionary<string, string> partOf)
    {
        claimed = [];
        var dirs = DirsOf(albumId);
        var paths = partOf.Keys.ToList();
        Transaction(() =>
        {
            var at = NowMs();
            foreach (var (p, part) in partOf)
                Exec("INSERT INTO album_splits(path, part, made_at) VALUES($p, $part, $at) ON CONFLICT(path) DO UPDATE SET part = excluded.part, made_at = excluded.made_at",
                    ("$p", p), ("$part", part), ("$at", at));
            var touched = new OrderedIds();
            touched.Add(albumId);
            RegroupDirs(dirs, touched);
            Settle(touched);
        });
        return AlbumsOf(paths);
    }

    /* The albums the tracks at [paths] are in, biggest first. */
    private List<double> AlbumsOf(IEnumerable<string> paths)
    {
        var n = new Dictionary<double, int>();
        foreach (var p in paths)
            if (Get("SELECT album_id FROM tracks WHERE path = $p", ("$p", p)) is { } r) n[Js.ToNumber(r["album_id"])] = n.GetValueOrDefault(Js.ToNumber(r["album_id"])) + 1;
        return [.. n.OrderByDescending(x => x.Value).ThenBy(x => x.Key).Select(x => x.Key)];
    }

    /*
     * Join back, of a hand split: the parts of [albumId]'s split (the albums of its folders whose tracks have a part, of
     * its act, title and folder) one album again, their parts let go. The biggest part's album is the one kept, under
     * the folder's key; what hung on the others goes with it where it doesn't clash. The album kept; null where it is no part.
     */
    public double? JoinParts(double albumId)
    {
        var al = Get("SELECT id, key FROM albums WHERE id = $id", ("$id", albumId));
        if (al == null || !Overlays()) return null;
        var seg = Js.Str(al["key"]).Split('\u0001');
        if (seg.Length < 4) return null;
        var whole = string.Join("\u0001", seg.Take(3));
        var dirs = DirsOf(albumId);
        var sibs = All(@"SELECT a.id, a.key, COUNT(*) AS n FROM tracks t JOIN album_splits s ON s.path = t.path JOIN albums a ON a.id = t.album_id
                         GROUP BY a.id ORDER BY n DESC, a.id")
            .Where(r => Js.Str(r["key"]).StartsWith(whole + "\u0001", StringComparison.Ordinal)).ToList();
        if (sibs.Count == 0) return null;
        var keep = Js.ToNumber(sibs[0]["id"]);
        claimed = [];
        Transaction(() =>
        {
            foreach (var s in sibs) Exec("DELETE FROM album_splits WHERE path IN (SELECT path FROM tracks WHERE album_id = $a)", ("$a", s["id"]));
            if (Get("SELECT id FROM albums WHERE key = $k", ("$k", whole)) == null) Rekey(Js.Str(sibs[0]["key"]), whole);
            foreach (var s in sibs.Skip(1)) Rekey(Js.Str(s["key"]), whole);
            var touched = new OrderedIds();
            foreach (var s in sibs) touched.Add(Js.ToNumber(s["id"]));
            RegroupDirs(dirs, touched);
            Settle(touched);
        });
        return Get("SELECT id FROM albums WHERE key = $k", ("$k", whole)) is { } kept ? Js.ToNumber(kept["id"]) : keep;
    }

    /*
     * Join back, just after Split by folder: [others]' tracks back in [keepId], their folders joined into it
     * (album_joins) so no scan takes them apart again. Only an album of the same act and title is joined. The albums joined.
     */
    public List<double> JoinFolders(double keepId, IEnumerable<double> others)
    {
        var joined = new List<double>();
        var keep = Get("SELECT id, key FROM albums WHERE id = $id", ("$id", keepId));
        if (keep == null || !Overlays()) return joined;
        var key = Js.Str(keep["key"]);
        Transaction(() =>
        {
            var at = NowMs();
            foreach (var o in others.Distinct().Where(o => o != keepId))
            {
                var al = Get("SELECT id, key FROM albums WHERE id = $id", ("$id", o));
                if (al == null || BaseOf(Js.Str(al["key"])) != BaseOf(key)) continue;
                foreach (var d in DirsOf(o))
                    Exec("INSERT INTO album_joins(dir, key, made_at) VALUES($d, $k, $at) ON CONFLICT(dir) DO UPDATE SET key = excluded.key, made_at = excluded.made_at",
                        ("$d", d), ("$k", key), ("$at", at));
                Exec("UPDATE tracks SET album_id = $a WHERE album_id = $o", ("$a", keepId), ("$o", o));
                PlaysFollow(o);
                Rekey(Js.Str(al["key"]), key);
                joined.Add(o);
            }
            var touched = new OrderedIds();
            touched.Add(keepId);
            Settle(touched);
        });
        return joined;
    }
}
