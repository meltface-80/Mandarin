// AlbumMergeRoutes.cs — albums merged into one from the library's selection menu, and taken apart again (bug list
// item 512; the order and the name AlbumMerge.cs's, the merge Scan/Scanner.Merge.cs's for your own files and
// Services/IBroadcast/IBroadcastMerges.cs's for iBroadcast's):
//
//   POST /api/albums/merge { offsets }   the albums (two or more, all your files' or all iBroadcast's, in the order
//                                        chosen) one album: the first disc's (by the number each title ends on, else
//                                        the order chosen) keeps its place, the others' tracks its later discs, the
//                                        one called by what their titles share. { ok, offset, title, order }
//   POST /api/albums/unmerge { offset }  a merged album's albums each their own again. { ok, albums }
//
// Kept in the database (album_merges), so every scan and every reading of iBroadcast after keeps to it, and in
// backups. A merged album says so in every list ("merged": true), for Unmerge. Each waits for no scan to be under way.
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using Mandarin.Server.Services.IBroadcast;

namespace Mandarin.Server;

internal static partial class Library
{
    private static readonly ConditionalWeakTable<Snapshot, HashSet<string>> MergedKeys = [];

    /* Whether [key]'s album is a merge (albums merged into it), as of the library [s]. */
    private static bool IsMerged(Snapshot s, string key) => MergedKeys.GetValue(s, _ =>
    {
        try
        {
            using var c = Db.Open();
            return [.. Rows(c, "SELECT DISTINCT into_key FROM album_merges WHERE key != into_key").Select(r => (string)r[0]!)];
        }
        catch (Microsoft.Data.Sqlite.SqliteException) { return new HashSet<string>(StringComparer.Ordinal); }
    }).Contains(key);

    /* The title edit a merge or an unmerge makes: [title] laid over [key]'s album, or (null) the merge's own taken off. */
    private static void MergeTitle(string key, string? title, string? was)
    {
        using var c = Db.Open();
        using var w = c.CreateCommand();
        w.Parameters.AddWithValue("$k", key);
        w.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        if (title != null)
        {
            w.CommandText = "INSERT INTO album_edits(key, title, updated_at) VALUES($k, $t, $at) ON CONFLICT(key) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at";
            w.Parameters.AddWithValue("$t", title);
        }
        else
        {
            w.CommandText = "UPDATE album_edits SET title = NULL, updated_at = $at WHERE key = $k AND title = $was";
            w.Parameters.AddWithValue("$was", (object?)was ?? DBNull.Value);
        }
        w.ExecuteNonQuery();
    }

    /* The title the merge of [key] gave its album; null where none. */
    private static string? MergedTitle(string key)
    {
        using var c = Db.Open();
        return Rows(c, "SELECT title FROM album_merges WHERE key = $1 AND into_key = $1", key).FirstOrDefault()?[0] as string;
    }

    /* POST /api/albums/merge { offsets } */
    private static async Task<bool> MergeAlbumsRoute(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        var offsets = b?["offsets"] is JsonArray a ? a.Select(JsNumber).Where(x => !double.IsNaN(x)).Distinct().ToList() : [];
        var albums = offsets.Select(s.Find).ToList();
        if (albums.Any(x => x == null)) return await NoAlbum(ctx);
        if (albums.Count < 2) return await JsError(ctx, 400, "Choose two albums or more to merge");
        var source = albums[0]!.Service;
        if (source is not (null or "ibroadcast")) return await JsError(ctx, 400, "Only albums of your own files or of iBroadcast can be merged");
        if (albums.Any(x => x!.Service != source)) return await JsError(ctx, 400, "Albums of your own files and of iBroadcast can't be merged into one");
        var order = AlbumMerge.Order([.. albums.Select(x => x!.Title)]).Select(i => albums[i]!).ToList();
        var title = AlbumMerge.TitleOf([.. order.Select(x => x.Title)]);
        var keep = order[0];
        if (source == null)
        {
            double? kept = null;
            if (!Scans.WhileNoScan(() =>
            {
                using var db = Scans.OpenDb();
                kept = Scans.Scanner(db).Merge([.. order.Select(x => (double)x.Id)], title);
            })) return await JsError(ctx, 409, ScanUnderWay);
            if (kept == null) return await NoAlbum(ctx);
        }
        else IBroadcastMerges.Merge([.. order.Select(x => (x.Id, x.Key))], title);
        if (title != keep.Title) MergeTitle(keep.Key, title, null);
        Server.Log($"[library] merged {order.Count} albums into \"{title}\" ({(source ?? "files")}): {string.Join(", ", order.Select(x => "\"" + x.Title + "\""))}");
        await Tell(new JsonObject { ["edits"] = true });
        var count = await Scans.Changed();
        return await Send(ctx, new JsonObject
        {
            ["ok"] = true, ["offset"] = keep.Id, ["title"] = title, ["order"] = new JsonArray([.. order.Select(x => (JsonNode)x.Id)]), ["count"] = count
        });
    }

    /* POST /api/albums/unmerge { offset } */
    private static async Task<bool> UnmergeAlbumRoute(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        if (b == null || s.Find(JsNumber(b["offset"])) is not { } al) return await NoAlbum(ctx);
        if (!IsMerged(s, al.Key)) return await JsError(ctx, 400, "This album isn't a merge of albums");
        var was = MergedTitle(al.Key);
        JsonArray albums;
        if (al.Service == null)
        {
            List<double>? now = null;
            if (!Scans.WhileNoScan(() =>
            {
                using var db = Scans.OpenDb();
                now = Scans.Scanner(db).Unmerge(al.Id);
            })) return await JsError(ctx, 409, ScanUnderWay);
            albums = Ids(now ?? [al.Id]);
        }
        else
        {
            IBroadcastMerges.Unmerge(al.Key);
            if (Jobs.IBroadcastLibrary is { } lib)
                try { await lib.Read(true); }
                catch (Services.ServiceError e) { Server.Log("[ibroadcast] the library couldn't be read after an unmerge: " + e.Message); }
            albums = Ids([al.Id]);
        }
        MergeTitle(al.Key, null, was);
        Server.Log($"[library] unmerged \"{al.Title}\" ({al.Service ?? "files"})");
        await Tell(new JsonObject { ["edits"] = true });
        var count = await Scans.Changed();
        return await Send(ctx, new JsonObject { ["ok"] = true, ["albums"] = albums, ["count"] = count });
    }
}
