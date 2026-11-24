// Scanner.Group.cs — which album each track is (out of Scanner.cs, which only shrinks): a folder's tracks grouped into
// albums (GroupDir), each group's album found or made (AlbumIdFor), and an album's key changed with everything that
// hangs on it (Rekey). Since item 424 a folder's grouping keeps to the hand splits of Edit album's Split… (album_splits,
// Scanner.Split.cs: a part of its own, its key the folder's and the part's) and to Join back's joins (album_joins: a
// folder's tracks the album of another folder's).
using Mandarin.Server.Tags;

namespace Mandarin.Server.Scan;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Scanner
{
    /*
     * An album's key changed: every table that names the album by its key
     * follows, so its favourite, Listen later, edits, identification, label
     * lookup, release day and Album of the day go with it.
     */
    private void Rekey(string from, string to)
    {
        if (from.Length == 0 || to.Length == 0 || from == to) return;
        foreach (var t in new[] { "albums", "favourites", "listen_later", "album_edits", "track_edits", "album_matches", "album_ids" }.Concat(Overlays() ? ["album_joins"] : []).Concat(Merges() ? ["album_merges"] : []))
            Exec($"UPDATE OR IGNORE {t} SET key = $to WHERE key = $from", ("$to", to), ("$from", from));
        if (Merges()) { Exec("UPDATE album_merges SET into_key = $to WHERE into_key = $from", ("$to", to), ("$from", from)); merges = null; }   // item 512
        Exec("UPDATE OR IGNORE cache SET key = $to WHERE ns = 'mbday' AND key = $from", ("$to", to), ("$from", from));
        if (Setting("album_of_the_day", null) is JsObj aotd && Js.StrictEq(aotd["key"], from))
        {
            var copy = new JsObj();
            foreach (var k in aotd.Keys) copy[k] = aotd[k];
            copy["key"] = to;
            SetSetting("album_of_the_day", copy);
        }
    }

    private sealed class Group
    {
        public string Title = "";
        public readonly List<JsObj> Rows = [];
        public string Artist = "";
        public double Compilation;
        public string SortArtist = "";
        public string Base = "";
        public string Key = "";
        public string Part = "";   // a hand split's part (item 424): "" for none
    }

    private static string KeyOf(object? v) => ScanNames.Key(Js.IsNullish(v) ? "" : Js.Str(v));

    /*
     * Decide each track's album within one folder.
     *   - The album-artist tag wins when present.
     *   - A compilation flag, or several track artists on one album title with
     *     no album artist, makes it "Various Artists".
     *   - Otherwise the track artist is the album artist.
     * A missing album tag names the album after its folder.
     */
    private List<Group> GroupDir(string dir, List<JsObj> rows)
    {
        var groups = new List<Group>();
        var index = new Dictionary<string, Group>(StringComparer.Ordinal);
        var dirName = NodePath.Basename(dir);
        foreach (var r in rows)
        {
            var title = Js.Truthy(r["album"]) ? Js.Str(r["album"]) : dirName;
            var part = PartOf(Js.Str(r["path"]));   // a hand split's part (item 424, Scanner.Split.cs)
            var k = ScanNames.Key(title) + "\u0002" + part;
            if (!index.TryGetValue(k, out var g)) { g = new Group { Title = title, Part = part }; index[k] = g; groups.Add(g); }
            g.Rows.Add(r);
        }
        foreach (var g in groups = DiscSets(groups))   // the discs of one title, one album (item 414, Scanner.Discs.cs)
        {
            var tagged = g.Rows.FirstOrDefault(r => Js.Truthy(r["album_artist"]));
            var artists = new HashSet<string>(g.Rows.Select(r => KeyOf(r["artist"])).Where(s => s.Length > 0), StringComparer.Ordinal);
            string albumArtist;
            if (tagged != null) albumArtist = Js.Str(tagged["album_artist"]);
            else if (g.Rows.Any(r => Js.Truthy(r["compilation"])) || artists.Count > 1) albumArtist = "Various Artists";
            else albumArtist = g.Rows.Count > 0 && Js.Truthy(g.Rows[0]["artist"]) ? Js.Str(g.Rows[0]["artist"]) : "Unknown Artist";
            g.Artist = albumArtist;
            g.Compilation = ScanNames.Key(albumArtist) == "various artists" ? 1 : 0;
            var sorted = g.Rows.FirstOrDefault(r => Js.Truthy(r["artist_sort"]));
            g.SortArtist = sorted != null ? Js.Str(sorted["artist_sort"]) : albumArtist;
            g.Base = ScanNames.Key(albumArtist) + "\u0001" + ScanNames.Key(g.Title);
            g.Key = g.Base + "\u0001" + RelFolder(dir) + (g.Part.Length > 0 ? "\u0001" + g.Part : "");
            MergeDiscs(g);   // an album merged into another: its discs after that one's (item 512, Scanner.Merge.cs)
        }
        return groups;
    }

    private double AlbumIdFor(Group g, string dir, double now)
    {
        var id = AlbumIdFor1(g, dir, now);
        claimed?.Add(id);
        return id;
    }

    private double AlbumIdFor1(Group g, string dir, double now)
    {
        if (MergedInto(g) is double merged) return merged;   // merged into another (item 512, Scanner.Merge.cs)
        if (JoinedInto(g, dir) is double joined) return joined;   // Join back's (item 424, Scanner.Split.cs)
        var hit = Get("SELECT id FROM albums WHERE key = $k", ("$k", g.Key));
        if (hit != null) return Js.ToNumber(hit["id"]);
        // The folder renamed or moved (the tracks known, the old folder gone):
        // the same album, under its new key — plays, edits and favourite kept.
        var prevIds = new List<double>();
        foreach (var r in g.Rows)
        {
            var v = Js.Truthy(r["unchanged"]) ? r["album_id"] : r["prev_album"];
            if (!Js.Truthy(v)) continue;
            var n = Js.ToNumber(v);
            if (!prevIds.Contains(n)) prevIds.Add(n);
        }
        if (prevIds.Count == 1)
        {
            var old = Get("SELECT id, key, dir FROM albums WHERE id = $id", ("$id", prevIds[0]));
            if (old != null)
            {
                var oldKey = Js.Str(old["key"]);
                var sameName = string.Join("\u0001", oldKey.Split('\u0001').Take(2)) == g.Base;
                var oldDir = old["dir"];
                // Its names changed in the same folder (an untagged album named from its folders, or tags rewritten): still the same album.
                var sameFolder = Js.Truthy(oldDir) && NodePath.Resolve(Js.Str(oldDir)) == NodePath.Resolve(dir) && !(claimed != null && claimed.Contains(Js.ToNumber(old["id"])));
                if ((sameName && !(Js.Truthy(oldDir) && PosixFs.Exists(Js.Str(oldDir)))) || sameFolder)
                {
                    Rekey(oldKey, g.Key);
                    Exec("UPDATE albums SET title = $title, artist = $artist, sort_title = $sort_title, sort_artist = $sort_artist, compilation = $compilation WHERE id = $id",
                        ("$id", old["id"]), ("$title", g.Title), ("$artist", g.Artist), ("$sort_title", ScanNames.SortName(g.Title)),
                        ("$sort_artist", ScanNames.SortName(g.SortArtist)), ("$compilation", g.Compilation));
                    // New names, not yet looked up under them: identification asks again.
                    if (!sameName) Exec("DELETE FROM album_matches WHERE key = $k AND status = 'unidentified'", ("$k", g.Key));
                    return Js.ToNumber(old["id"]);
                }
            }
        }
        // What was kept under the key before folders counted (edits restored into a new database; an album that left and is back).
        if (g.Base.Length > 0)
        {
            Rekey(g.Base, g.Key);
            var was = Get("SELECT id FROM albums WHERE key = $k", ("$k", g.Key));
            if (was != null) return Js.ToNumber(was["id"]);
        }
        return NewAlbum(g, dir, now);
    }

    /* A new album for [g], in [dir]: the id it had before if it was here and nothing has taken it since. */
    private double NewAlbum(Group g, string dir, double now)
    {
        (string, object?)[] row =
        [
            ("$key", g.Key), ("$title", g.Title), ("$artist", g.Artist), ("$sort_title", ScanNames.SortName(g.Title)),
            ("$sort_artist", ScanNames.SortName(g.SortArtist)), ("$dir", dir), ("$now", now), ("$compilation", g.Compilation)
        ];
        // Back after a while away: the id it had, if nothing has taken it since.
        var retired = Get("SELECT id FROM album_ids WHERE key = $k", ("$k", g.Key));
        if (retired != null && Get("SELECT id FROM albums WHERE id = $id", ("$id", retired["id"])) == null)
        {
            Exec(@"INSERT INTO albums(id, key, title, artist, sort_title, sort_artist, dir, added_at, updated_at, compilation)
                   VALUES($id, $key, $title, $artist, $sort_title, $sort_artist, $dir, $now, $now, $compilation)", [("$id", retired["id"]), .. row]);
            return Js.ToNumber(retired["id"]);
        }
        Exec(@"INSERT INTO albums(key, title, artist, sort_title, sort_artist, dir, added_at, updated_at, compilation)
               VALUES($key, $title, $artist, $sort_title, $sort_artist, $dir, $now, $now, $compilation)", row);
        return Js.ToNumber(Get("SELECT last_insert_rowid() AS id")!["id"]);
    }
}
