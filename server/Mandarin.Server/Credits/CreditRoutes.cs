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

    /*
     * A band's members as its page shows them (bug list item 133): those in it now, as Wikipedia's "Members"; a band
     * that has ended, its last line-up (those whose time ended with the band's); none of either, every one.
     */
    private static JsonNode? MainMembers(JsonNode? members, JsonNode about)
    {
        if (members is not JsonArray all || all.Count == 0) return members;
        static string? Year(JsonNode? v) => (string?)v is { Length: >= 4 } y ? y[..4] : null;
        var now = all.Where(m => m is JsonObject o && o["end"] == null && (bool?)o["ended"] != true).ToList();
        if (now.Count > 0) return new JsonArray(now.Select(m => m!.DeepClone()).ToArray());
        var last = Year(about["end"]) is { } end ? all.Where(m => Year(m?["end"]) == end).ToList() : new List<JsonNode?>();
        return last.Count > 0 ? new JsonArray(last.Select(m => m!.DeepClone()).ToArray()) : members;
    }

    /*
     * A person's bands' albums in the library, from their years in each (bug list item 133: a member's own page had
     * none, "0 albums"): those not already among their own, each band its own group, the earliest stint first.
     */
    private static JsonArray BandAlbums(Snapshot s, JsonNode? bands, HashSet<long> shown)
    {
        var groups = new JsonArray();
        if (bands is not JsonArray list) return groups;
        static int? Year(JsonNode? v) => (string?)v is { Length: >= 4 } y && int.TryParse(y[..4], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var n) ? n : null;
        foreach (var b in list.OfType<JsonObject>().OrderBy(b => Year(b["begin"]) ?? 9999))
        {
            var band = (string?)b["name"] ?? "";
            if (band.Length == 0) continue;
            var (from, to) = (Year(b["begin"]), Year(b["end"]));
            var albums = ArtistAlbumsOf(s, band).Primary
                .Where(al => !shown.Contains(al.Id) && (al.Year is not { } y || ((from == null || y >= from) && (to == null || y <= to))))
                .OrderBy(al => al.Year ?? 9999).ToList();
            if (albums.Count == 0) continue;
            foreach (var al in albums) shown.Add(al.Id);
            groups.Add(new JsonObject { ["band"] = band, ["albums"] = new JsonArray(albums.Select(al => (JsonNode?)AlbumJson(s, al)).ToArray()) });
        }
        return groups;
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
        // Their bands' albums first, so an album is under its band rather than again under "credited on".
        var (own, featured) = ArtistAlbumsOf(s, name);
        var shown = own.Concat(featured).Select(al => al.Id).ToHashSet();
        var bandAlbums = BandAlbums(s, about["member_of"], shown);
        var on = new JsonArray();
        foreach (var (albumId, roles) in CreditStore.CreditedOn(key).Where(x => s.ById.ContainsKey(x.AlbumId) && !shown.Contains(x.AlbumId)).OrderBy(x => s.ById[x.AlbumId].Year ?? 9999))
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
            ["members"] = Stints(MainMembers(about["members"], about), photos, acts), ["member_of"] = Stints(about["member_of"], photos, acts),
            ["band_albums"] = bandAlbums, ["credited_on"] = on, ["in_library"] = acts.Contains(key),
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
