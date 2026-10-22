// CreditRoutes.cs — the albums' credits and the acts behind them as the
// album page, the artists' wall and an artist's page ask (bug list item 129):
//
//   GET /api/album/credits?offset=<album id>  who played, sang, wrote and made it
//   GET /api/artist?name=                     an act: picture, facts, links, members or bands, albums credited on
//   GET /api/credits/status                   how far the finding has come
//
// What hasn't been found yet is found there and then (CreditFinder.cs), for a
// few seconds at most; the rest of the time the background has it already.
using System.Text.Json.Nodes;
using Mandarin.Server.Credits;

namespace Mandarin.Server;

internal static partial class Library
{
    private const int CreditsWaitMs = 15000;

    /* Every act an album of the library's is credited to, by key. */
    private static HashSet<string> LibraryActs(Snapshot s)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        foreach (var al in s.Albums)
            foreach (var (name, _) in al.ArtistNames) set.Add(Names.ArtistKey(name));
        return set;
    }

    private static JsonArray StringArray(IEnumerable<string> list) => new(list.Select(x => (JsonNode?)x).ToArray());

    /* GET /api/album/credits?offset=<album id> */
    private static async Task<bool> AlbumCreditsRoute(HttpContext ctx, Snapshot s, LibState st)
    {
        var id = PInt(Q(ctx, "offset")) ?? 0;
        if (!s.ById.TryGetValue(id, out var al)) return await Send(ctx, new JsonObject { ["error"] = "album not found" }, 404);
        var status = CreditFinder.Current is { } f ? await f.AlbumNow(al, CreditsWaitMs) : CreditStore.AlbumStatus(al.Id) ?? "none";
        var photos = CreditStore.Photos();
        var acts = LibraryActs(s);
        var rows = CreditStore.AlbumCredits(al.Id).Select(c => (JsonNode?)new JsonObject
        {
            ["name"] = c.Name, ["key"] = c.Key, ["mbid"] = c.Mbid, ["roles"] = StringArray(c.Roles),
            // null: on every track ("All tracks"); else their places on the album, 1 on.
            ["tracks"] = c.Tracks.Count == 0 ? null : new JsonArray(c.Tracks.Select(t => (JsonNode?)t).ToArray()),
            ["photo_key"] = CreditRules.PhotoKey(photos.GetValueOrDefault(c.Key)), ["in_library"] = acts.Contains(c.Key), ["source"] = c.Source,
        }).ToArray();
        return await Send(ctx, new JsonObject { ["album"] = al.Id, ["status"] = status, ["credits"] = new JsonArray(rows) });
    }

    /* A band's members or a person's bands, each with its picture where one has been found. */
    private static JsonArray Stints(JsonNode? list, Dictionary<string, string?> photos, HashSet<string> acts)
    {
        var a = new JsonArray();
        if (list is not JsonArray arr) return a;
        foreach (var m in arr.OfType<JsonObject>())
        {
            var name = (string?)m["name"] ?? "";
            var key = Names.ArtistKey(name);
            a.Add(new JsonObject
            {
                ["name"] = name, ["key"] = key, ["mbid"] = m["mbid"]?.DeepClone(), ["begin"] = m["begin"]?.DeepClone(), ["end"] = m["end"]?.DeepClone(),
                ["ended"] = m["ended"]?.DeepClone(), ["roles"] = m["roles"]?.DeepClone() ?? new JsonArray(),
                ["photo_key"] = CreditRules.PhotoKey(photos.GetValueOrDefault(key)), ["in_library"] = acts.Contains(key),
            });
        }
        return a;
    }

    /* GET /api/artist?name= */
    private static async Task<bool> ArtistRoute(HttpContext ctx, Snapshot s, LibState st)
    {
        var name = Names.JsTrim(Q(ctx, "name") ?? "");
        if (name.Length == 0) return await Send(ctx, new JsonObject { ["error"] = "name required" }, 400);
        var key = Names.ArtistKey(name);
        var info = CreditFinder.Current is { } f ? await f.ArtistNow(name, CreditsWaitMs) : CreditStore.Artist(key);
        var photos = CreditStore.Photos();
        var acts = LibraryActs(s);
        var about = info?.About ?? new JsonObject();
        var on = new JsonArray();
        foreach (var (albumId, roles) in CreditStore.CreditedOn(key).Where(x => s.ById.ContainsKey(x.AlbumId)).OrderBy(x => s.ById[x.AlbumId].Year ?? 9999))
        {
            var o = AlbumJson(s, s.ById[albumId]);
            o["roles"] = StringArray(roles);
            on.Add(o);
        }
        return await Send(ctx, new JsonObject
        {
            ["name"] = info?.Name ?? name, ["key"] = key, ["known"] = info != null, ["mbid"] = info?.Mbid, ["type"] = info?.Type,
            ["photo_key"] = CreditRules.PhotoKey(info?.Photo), ["photo_source"] = info?.PhotoSource,
            ["disambiguation"] = about["disambiguation"]?.DeepClone(), ["begin"] = about["begin"]?.DeepClone(), ["end"] = about["end"]?.DeepClone(),
            ["ended"] = about["ended"]?.DeepClone(), ["area"] = about["area"]?.DeepClone(), ["links"] = about["links"]?.DeepClone() ?? new JsonObject(),
            ["members"] = Stints(about["members"], photos, acts), ["member_of"] = Stints(about["member_of"], photos, acts),
            ["credited_on"] = on, ["in_library"] = acts.Contains(key),
        });
    }

    /* GET /api/credits/status */
    private static Task<bool> CreditsStatus(HttpContext ctx, Snapshot s, LibState st)
    {
        var (albums, artists, photos) = CreditStore.Counts();
        return Send(ctx, new JsonObject
        {
            ["albums"] = albums, ["albums_total"] = s.Albums.Count, ["artists"] = artists, ["photos"] = photos, ["finding"] = CreditFinder.Current != null,
        });
    }
}
