// Scanner.Merge.cs — albums of your own files merged into one from the library's selection menu (bug list item 512,
// AlbumMerge.cs), and taken apart again. Merged: the first disc's album keeps its id, key, plays and edits; each other
// album's tracks are moved into it, their discs after its own ("Volume Two"'s disc 1 its disc 2), and the merge kept
// (album_merges: each album's key, the one it is in, the disc it starts after; album_joins: its folders that album's,
// so the scan's split by folder leaves them be). Every scan after keeps to it: a merged album's folder read again is
// grouped into the album it was merged into, its discs after the same disc (GroupDir, AlbumIdFor). Unmerged: the
// merge forgotten and the album's folders read again from their files and grouped from scratch (Scanner.Again.cs).

namespace Mandarin.Server.Scan;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Scanner
{
    private bool? mergesTable;
    private Dictionary<string, (string Into, double Disc)>? merges;   // album_merges: an album's key → the one it is in, its disc offset

    private bool Merges() => mergesTable ??= Get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'album_merges'") != null;

    /* What [key]'s album was merged into; null where it was merged into none. */
    private (string Into, double Disc)? MergeOf(string key)
    {
        if (!Merges()) return null;
        merges ??= All("SELECT key, into_key, disc FROM album_merges").ToDictionary(r => Js.Str(r["key"]), r => (Js.Str(r["into_key"]), Js.ToNumber(r["disc"])), StringComparer.Ordinal);
        return merges.TryGetValue(key, out var m) ? m : null;
    }

    /* A group of an album merged into another: its tracks read now numbered on from the discs before it. */
    private void MergeDiscs(Group g)
    {
        if (MergeOf(g.Key) is not { } m || m.Into == g.Key || m.Disc <= 0) return;
        foreach (var r in g.Rows.Where(r => !Js.Truthy(r["unchanged"]))) r["disc_no"] = m.Disc + (Js.Truthy(r["disc_no"]) ? Js.ToNumber(r["disc_no"]) : 1);
    }

    /* The album a group's album was merged into, where it is here. */
    private double? MergedInto(Group g) =>
        MergeOf(g.Key) is { } m && m.Into != g.Key && Get("SELECT id FROM albums WHERE key = $k", ("$k", m.Into)) is { } r ? Js.ToNumber(r["id"]) : null;

    private double MaxDisc(double albumId) =>
        Get("SELECT MAX(COALESCE(disc_no, 1)) AS n FROM tracks WHERE album_id = $a", ("$a", albumId)) is { } r && Js.Truthy(r["n"]) ? Js.ToNumber(r["n"]) : 1;

    /*
     * The albums [ids] (the first disc's first) merged into the first, called [title]. The album kept; null where one
     * of them isn't here.
     */
    public double? Merge(IReadOnlyList<double> ids, string title)
    {
        if (!Merges() || !Overlays() || ids.Count < 2) return null;
        var albums = ids.Select(id => Get("SELECT id, key FROM albums WHERE id = $id", ("$id", id))).ToList();
        if (albums.Any(a => a == null)) return null;
        var keepId = Js.ToNumber(albums[0]!["id"]);
        var into = Js.Str(albums[0]!["key"]);
        claimed = [];
        Transaction(() =>
        {
            var at = NowMs();
            var offset = MaxDisc(keepId);
            Exec(@"INSERT INTO album_merges(key, into_key, disc, title, dirs, made_at) VALUES($k, $k, 0, $t, NULL, $at)
                   ON CONFLICT(key) DO UPDATE SET into_key = excluded.into_key, disc = 0, title = excluded.title, made_at = excluded.made_at",
                ("$k", into), ("$t", title), ("$at", at));
            var touched = new OrderedIds();
            touched.Add(keepId);
            foreach (var al in albums.Skip(1))
            {
                var id = Js.ToNumber(al!["id"]);
                var key = Js.Str(al["key"]);
                var dirs = DirsOf(id);
                var max = MaxDisc(id);
                // An album merged before: what was merged into it comes too, after it.
                Exec("UPDATE album_merges SET into_key = $into, disc = disc + $off WHERE into_key = $k AND key != $k", ("$into", into), ("$off", offset), ("$k", key));
                Exec(@"INSERT INTO album_merges(key, into_key, disc, title, dirs, made_at) VALUES($k, $into, $off, NULL, $dirs, $at)
                       ON CONFLICT(key) DO UPDATE SET into_key = excluded.into_key, disc = excluded.disc, title = NULL, dirs = excluded.dirs, made_at = excluded.made_at",
                    ("$k", key), ("$into", into), ("$off", offset), ("$dirs", Js.Json(dirs.Cast<object?>().ToList())), ("$at", at));
                foreach (var d in dirs)
                    Exec("INSERT INTO album_joins(dir, key, made_at) VALUES($d, $k, $at) ON CONFLICT(dir) DO UPDATE SET key = excluded.key, made_at = excluded.made_at",
                        ("$d", d), ("$k", into), ("$at", at));
                Exec("UPDATE tracks SET album_id = $a, disc_no = COALESCE(disc_no, 1) + $off WHERE album_id = $o", ("$a", keepId), ("$off", offset), ("$o", id));
                Exec("UPDATE album_joins SET key = $into WHERE key = $k", ("$into", into), ("$k", key));
                touched.Add(id);
                offset += max;
            }
            merges = null;
            Settle(touched);
        });
        return keepId;
    }

    /* The merge of [albumId] undone: its albums apart again, read afresh from their files. The albums now; null where it was no merge. */
    public List<double>? Unmerge(double albumId)
    {
        if (!Merges() || Get("SELECT key FROM albums WHERE id = $id", ("$id", albumId)) is not { } al) return null;
        var key = Js.Str(al["key"]);
        var parts = All("SELECT key, dirs FROM album_merges WHERE into_key = $k AND key != $k", ("$k", key));
        if (parts.Count == 0) return null;
        Transaction(() =>
        {
            foreach (var p in parts)
                if (Js.Truthy(p["dirs"]) && JsJson.Parse(Js.Str(p["dirs"])) is List<object?> dirs)
                    foreach (var d in dirs) Exec("DELETE FROM album_joins WHERE dir = $d AND key = $k", ("$d", Js.Str(d)), ("$k", key));
            Exec("DELETE FROM album_merges WHERE into_key = $k", ("$k", key));
            merges = null;
        });
        return LookAgain(albumId);
    }
}
