// LibraryRoutes.Versions.cs — an album's versions on its page, and the one the lists show (item 345, Library.Versions.cs):
// GET /api/album gives "versions", each version with what tells it from the others, the main one marked; POST
// /api/album/versions/main { offset } makes that version the main of its album, kept across scans.
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Library
{
    /*
     * [al]'s versions as its page lists them, the main first, this one marked (an album of one has none to list): each
     * with what tells it apart, its edition alone, its tracks and length (its row on the Versions tab, item 349).
     */
    private static JsonArray VersionsJson(Snapshot s, Album al)
    {
        var list = (al.Versions ?? []).Select(id => s.ById.TryGetValue(id, out var v) ? v : null).OfType<Album>().ToList();
        var seconds = new Dictionary<long, double>();
        try
        {
            using var c = Db.Open();
            foreach (var r in Rows(c, $"SELECT album_id, sum(duration) FROM tracks WHERE album_id IN ({string.Join(",", list.Select(v => v.Id))}) GROUP BY album_id"))
                if (r[0] is long id && r[1] is double or long) seconds[id] = Convert.ToDouble(r[1], System.Globalization.CultureInfo.InvariantCulture);
        }
        catch (Microsoft.Data.Sqlite.SqliteException) { /* its length unsaid */ }
        return new([.. list.Select(v => (JsonNode)AlbumJson(s, v, new JsonObject
        {
            ["label"] = v.VersionLabel, ["edition"] = v.VersionEdition, ["main"] = v.Id == al.MainVersion, ["current"] = v.Id == al.Id, ["release_year"] = v.ReleaseYear,
            ["tracks"] = v.TrackCount, ["seconds"] = seconds.TryGetValue(v.Id, out var sec) ? Math.Round(sec) : null,
        }))]);
    }

    /* POST /api/album/versions/main { offset }: that version the main of its album, the one the lists show. */
    private static async Task<bool> SaveMainVersion(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var al = s.Find(JsNumber(b["offset"]));
        if (al == null) return await Gone(ctx);
        if (al.Versions == null) return await Send(ctx, new JsonObject { ["error"] = "This album has no other versions" }, 400);
        var others = al.Versions.Where(id => id != al.Id).Select(id => s.ById.TryGetValue(id, out var v) ? v.Key : null).OfType<string>().ToHashSet(StringComparer.Ordinal);
        using (var c = Db.Open())
        {
            var keys = MainVersionKeys(c);
            keys.ExceptWith(others);
            keys.Add(al.Key);
            Playback.QueueStore.SetSetting(c, MainVersionsSetting, new JsonArray([.. keys.OrderBy(k => k, StringComparer.Ordinal).Select(k => (JsonNode)k)]));
        }
        await Tell(new JsonObject { ["versions"] = true });
        return await Send(ctx, new JsonObject { ["ok"] = true, ["offset"] = al.Id, ["main"] = true });
    }
}
