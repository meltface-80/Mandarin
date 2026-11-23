// IBroadcastDeleteRoutes.cs — iBroadcast albums deleted from the library's selection menu (bug list item 527): from
// iBroadcast itself, not only from Mandarin, asked twice on the page and in the app before it is done.
//
//   POST /api/ibroadcast/delete-albums { offsets }   the albums (each of iBroadcast's) deleted at iBroadcast: their
//        tracks moved to iBroadcast's trash ("trash") and the trash emptied of them ("empty_trash"), as iBroadcast's
//        own apps do; then the library read again from iBroadcast, at once, a few seconds and half a minute later, the
//        tracks left out of every reading for a day meanwhile (item 528: iBroadcast lists them a while after). { ok, albums, tracks,
//        emptied }; emptied false where iBroadcast kept them in its trash (said, from its own words, in "note").
//        400 for an album not iBroadcast's, 401 signed out, 404 an album gone; nothing is deleted then.
//
// What iBroadcast said of each step is logged, its own words. Merged albums (item 512) are their tracks: all go.
using System.Text.Json.Nodes;
using Mandarin.Server.Services;

namespace Mandarin.Server;

internal static partial class Library
{
    /* POST /api/ibroadcast/delete-albums { offsets } */
    private static async Task<bool> DeleteIBroadcastAlbumsRoute(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        var offsets = b?["offsets"] is JsonArray a ? a.Select(JsNumber).Where(x => !double.IsNaN(x)).Distinct().ToList() : [];
        if (offsets.Count == 0) return await JsError(ctx, 400, "Choose the albums to delete");
        var albums = offsets.Select(s.Find).ToList();
        if (albums.Any(x => x == null)) return await NoAlbum(ctx);
        if (albums.Any(x => x!.Service != "ibroadcast")) return await JsError(ctx, 400, "Only iBroadcast's albums can be deleted from iBroadcast");
        if (Jobs.IBroadcast is not { } ib || !Mandarin.Server.Services.IBroadcast.IBroadcast.Connected()) return await JsError(ctx, 401, "Not signed in to iBroadcast");

        var ids = new List<long>();
        using (var c = Db.Open())
            foreach (var r in Rows(c, $"SELECT path FROM tracks WHERE album_id IN ({string.Join(",", albums.Select(x => x!.Id))})"))
                if (r[0] is string p && Mandarin.Server.Services.IBroadcast.IBroadcastDownloads.Is(p) && long.TryParse(p["ibroadcast://track/".Length..], out var id)) ids.Add(id);
        if (ids.Count == 0) return await JsError(ctx, 400, "Those albums have no tracks at iBroadcast");

        var tracks = new JsonObject { ["tracks"] = new JsonArray([.. ids.Distinct().Select(id => (JsonNode)id)]) };
        var names = string.Join("; ", albums.Take(3).Select(x => $"{x!.Artist} — {x.Title}")) + (albums.Count > 3 ? $"; and {albums.Count - 3} more" : "");
        try
        {
            var trashed = await ib.Api.Json("trash", tracks);
            Server.Log($"[ibroadcast] delete: {albums.Count} album(s), {ids.Count} track(s) moved to iBroadcast's trash ({names}); iBroadcast: {Said(trashed)}");
        }
        catch (ServiceError e)
        {
            Server.Log($"[ibroadcast] delete: {albums.Count} album(s) not deleted ({names}): {e.Message}");
            return await JsError(ctx, e.Status, "iBroadcast didn't delete them: " + e.Message);
        }
        bool emptied;
        string? note = null;
        try
        {
            var gone = await ib.Api.Json("empty_trash", tracks);
            emptied = true;
            Server.Log($"[ibroadcast] delete: iBroadcast's trash emptied of them; iBroadcast: {Said(gone)}");
        }
        catch (ServiceError e)
        {
            emptied = false;
            note = $"They are in iBroadcast's trash: {e.Message}";
            Server.Log($"[ibroadcast] delete: left in iBroadcast's trash, not emptied: {e.Message}");
        }
        // Gone from the library at once, whatever iBroadcast goes on listing a while (item 528, IBroadcastDeleted.cs); the
        // library read again now, then a few seconds and half a minute later, for what iBroadcast says by then.
        Mandarin.Server.Services.IBroadcast.IBroadcastDeleted.Keep(ids);
        await ReadAgain(0);
        _ = Task.Run(async () => { foreach (var ms in AgainAfterMs) { await Task.Delay(ms); await ReadAgain(ms); } });
        var o = new JsonObject { ["ok"] = true, ["albums"] = albums.Count, ["tracks"] = ids.Count, ["emptied"] = emptied };
        if (note != null) o["note"] = note;
        return await Send(ctx, o);
    }

    /* When the library is read again after a delete (ms after the one read at once). */
    internal static readonly int[] AgainAfterMs = [5_000, 25_000];

    private static async Task ReadAgain(int afterMs)
    {
        if (Jobs.IBroadcastLibrary is not { } lib) return;
        try { await lib.Read(force: true); }
        catch (Exception e) when (e is ServiceError or HttpRequestException or TaskCanceledException)
        {
            Server.Log($"[ibroadcast] delete: the library not read again{(afterMs > 0 ? $" ({afterMs / 1000} s after)" : "")}: {e.Message}");
        }
    }

    private static string Said(JsonObject j) => j["message"] is JsonValue m && m.TryGetValue<string>(out var t) && t.Length > 0 ? t : "done";
}
