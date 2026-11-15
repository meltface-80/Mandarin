// AlbumSplitRoutes.cs — two copies of a record merged into one album, taken apart from Edit album and found from
// Settings → Library Scanner → Library clean-up (bug list item 424; the splitting is Scan/Scanner.Split.cs's):
//
//   GET  /api/album/edit's "split"     the album's folders where its tracks are in more than one ({ folder, tracks }
//                                      each, the most first: Split by folder), the ways Split… offers ({ by, name,
//                                      parts: [{ name, tracks }] }) and whether it is a part of a hand split (Join back)
//   POST /api/album/split { offset, by }  by "folder", "words", "format" or "numbers": split now; { ok, albums } (the
//                                      album kept first, then those made)
//   POST /api/album/join { offset, with? }  Join back: a hand split's parts one album again, or (with: the albums
//                                      Split by folder made) those back in this one, their folders joined to it
//   POST /api/album/look-again { offset }  this album's folders read again and grouped from scratch; { ok, albums }
//   GET  /api/library/merged           the albums that look like two copies merged: a track number twice on one
//                                      disc, or tracks in more than one folder; { albums: [{ offset, title, artist,
//                                      tracks, folders, repeats }] }
//
// Each change waits for no scan to be under way (409 while one is), and the library is read again after it.
using System.Text.Json.Nodes;
using Mandarin.Server.Scan;

namespace Mandarin.Server;

internal static partial class Library
{
    /* [albumId]'s tracks as the ways read them (a service's have no file, so none). */
    private static List<MergedCopies.Track> SplitTracks(long albumId)
    {
        using var c = Db.Open();
        return [.. Rows(c, "SELECT id, path, title, disc_no, track_no, sample_rate, bits, codec FROM tracks WHERE album_id = $1 ORDER BY path", albumId)
            .Where(r => r[1] is string p && !p.Contains("://", StringComparison.Ordinal))
            .Select(r => new MergedCopies.Track((long)r[0]!, (string)r[1]!, r[2] as string ?? "", Dbl(r[3]), Dbl(r[4]), Dbl(r[5]), Dbl(r[6]), r[7] as string))];
    }

    /* Whether [al] is a part of a hand split (Join back). */
    private static bool IsPart(Album al)
    {
        if (al.Key.Split('\u0001').Length < 4) return false;
        try { using var c = Db.Open(); return Rows(c, "SELECT 1 FROM album_splits s JOIN tracks t ON t.path = s.path WHERE t.album_id = $1 LIMIT 1", al.Id).Count > 0; }
        catch (Microsoft.Data.Sqlite.SqliteException) { return false; }
    }

    /* Edit album's "split": the folders, the ways and whether it is a part. */
    private static JsonObject SplitJson(Album al)
    {
        var tracks = SplitTracks(al.Id);
        var places = tracks.GroupBy(t => Scanner.PlaceOf(t.Path)).OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal).ToList();
        return new JsonObject
        {
            ["folders"] = new JsonArray([.. (places.Count < 2 ? [] : places).Select(g => (JsonNode)new JsonObject
                { ["folder"] = NodePath.Basename(Scanner.AlbumDirOf(g.First().Path)), ["tracks"] = g.Count() })]),
            ["ways"] = new JsonArray([.. MergedCopies.Ways(tracks).Select(w => (JsonNode)new JsonObject
            {
                ["by"] = w.By, ["name"] = w.Name,
                ["parts"] = new JsonArray([.. w.Parts.Select(p => (JsonNode)new JsonObject { ["name"] = p.Name, ["tracks"] = p.Tracks.Count })])
            })]),
            ["part"] = IsPart(al)
        };
    }

    /* The change [body] made with no scan under way, then the library read again: its answer, or 409. */
    private static async Task<bool> SplitDone(HttpContext ctx, Func<Scanner, JsonObject> body)
    {
        JsonObject? said = null;
        var made = Scans.WhileNoScan(() =>
        {
            using var db = Scans.OpenDb();
            said = body(Scans.Scanner(db));
        });
        if (!made) return await JsError(ctx, 409, ScanUnderWay);
        await Tell(new JsonObject { ["edits"] = true });
        var count = await Scans.Changed();
        said!["count"] = count;
        return await Send(ctx, said, said["error"] != null ? 400 : 200);
    }

    private static JsonArray Ids(IEnumerable<double> ids) => new([.. ids.Select(i => (JsonNode)(long)i)]);

    /* The album asked of in [b]: one of the library's with files of its own, or null when the answer is said. */
    private static async Task<Album?> SplitAlbum(HttpContext ctx, Snapshot s, JsonObject? b)
    {
        if (b == null) return null;
        var al = s.Find(JsNumber(b["offset"]));
        if (al == null) { await NoAlbum(ctx); return null; }
        if (al.Service != null) { await JsError(ctx, 400, "A streamed album has no files to split"); return null; }
        return al;
    }

    /* POST /api/album/split { offset, by } */
    private static async Task<bool> SplitAlbumRoute(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        var al = await SplitAlbum(ctx, s, b);
        if (al == null) return true;
        var by = b!["by"]?.GetValueKind() == System.Text.Json.JsonValueKind.String ? (string)b["by"]! : "";
        if (by == "folder") return await SplitDone(ctx, sc => new JsonObject { ["ok"] = true, ["albums"] = Ids(sc.SplitFolders(al.Id)) });
        var way = MergedCopies.Ways(SplitTracks(al.Id)).FirstOrDefault(w => w.By == by);
        if (way == null) return await JsError(ctx, 400, "This album can't be split that way");
        var partOf = way.Parts.SelectMany(p => p.Tracks.Select(t => (t.Path, Name: MergedCopies.PartName(p.Name)))).ToDictionary(x => x.Path, x => x.Name, StringComparer.Ordinal);
        return await SplitDone(ctx, sc => new JsonObject { ["ok"] = true, ["albums"] = Ids(sc.SplitByHand(al.Id, partOf)) });
    }

    /* POST /api/album/join { offset, with? } */
    private static async Task<bool> JoinAlbumRoute(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        var al = await SplitAlbum(ctx, s, b);
        if (al == null) return true;
        var with = b!["with"] is JsonArray w ? w.Select(JsNumber).Where(x => !double.IsNaN(x)).ToList() : null;
        return await SplitDone(ctx, sc =>
        {
            if (with != null)
                return sc.JoinFolders(al.Id, with) is { Count: > 0 } joined ? new JsonObject { ["ok"] = true, ["albums"] = Ids([al.Id]), ["joined"] = Ids(joined) }
                    : new JsonObject { ["error"] = "Nothing to join back" };
            return sc.JoinParts(al.Id) is double kept ? new JsonObject { ["ok"] = true, ["albums"] = Ids([kept]) } : new JsonObject { ["error"] = "Nothing to join back" };
        });
    }

    /* POST /api/album/look-again { offset } */
    private static async Task<bool> LookAgainRoute(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        var al = await SplitAlbum(ctx, s, b);
        if (al == null) return true;
        return await SplitDone(ctx, sc => new JsonObject { ["ok"] = true, ["albums"] = Ids(sc.LookAgain(al.Id)) });
    }

    /* GET /api/library/merged */
    private static async Task<bool> MergedAlbums(HttpContext ctx, Snapshot s, LibState st)
    {
        var byAlbum = new Dictionary<long, List<MergedCopies.Track>>();
        var joined = new HashSet<string>(StringComparer.Ordinal);
        using (var c = Db.Open())
        {
            foreach (var r in Rows(c, "SELECT id, path, title, disc_no, track_no, album_id FROM tracks"))
            {
                if (r[1] is not string p || p.Contains("://", StringComparison.Ordinal) || r[5] is not long a) continue;
                if (!byAlbum.TryGetValue(a, out var l)) byAlbum[a] = l = [];
                l.Add(new MergedCopies.Track((long)r[0]!, p, r[2] as string ?? "", Dbl(r[3]), Dbl(r[4]), null, null, null));
            }
            try { foreach (var r in Rows(c, "SELECT dir FROM album_joins")) if (r[0] is string d) joined.Add(d); }
            catch (Microsoft.Data.Sqlite.SqliteException) { /* none before item 424 */ }
        }
        var list = new List<(Album Al, int Folders, bool Repeats, int Tracks)>();
        foreach (var (id, tracks) in byAlbum)
        {
            // A folder joined to it by Join back is the owner's choice: not counted.
            var own = tracks.Where(t => !joined.Contains(Scanner.AlbumDirOf(t.Path))).ToList();
            var folders = own.Select(t => Scanner.PlaceOf(t.Path)).Distinct(StringComparer.Ordinal).Count();
            var repeats = MergedCopies.Repeats(own);
            if ((folders > 1 || repeats) && s.ById.TryGetValue(id, out var al)) list.Add((al, folders, repeats, tracks.Count));
        }
        var albums = list.OrderBy(x => x.Al.Artist, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.Al.Title, StringComparer.OrdinalIgnoreCase).Take(500)
            .Select(x => (JsonNode)new JsonObject
            {
                ["offset"] = x.Al.Id, ["title"] = x.Al.Title, ["artist"] = x.Al.Artist, ["tracks"] = x.Tracks, ["folders"] = Math.Max(1, x.Folders), ["repeats"] = x.Repeats
            });
        return await Send(ctx, new JsonObject { ["albums"] = new JsonArray([.. albums]), ["count"] = list.Count });
    }
}
