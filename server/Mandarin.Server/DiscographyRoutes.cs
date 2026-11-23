// DiscographyRoutes.cs — the default service (Settings → Services, under the services) and an artist's albums on it
// (bug list item 522; Services/Discography.cs reads them):
//
//   GET  /api/settings/default-service            { service: id | "", choices: [{ id, name, connected }] }
//   POST /api/settings/default-service { service } the same, after it is kept; "" for none; another id: 400
//   GET  /api/artist-discography?artist&artist_id  the default service's albums of the artist the library doesn't have:
//        { service, name, artist, albums } (Discography.Of); { service: "" , albums: [] } with no default service, or
//        one not signed in; what the service said, as error, when it couldn't be asked (the page shows the library's)
using System.Text.Json.Nodes;
using Mandarin.Server.Services;

namespace Mandarin.Server;

internal static partial class Library
{
    private static JsonObject DefaultServiceJson()
    {
        var choices = new JsonArray();
        foreach (var id in Discography.Ids)
            if (CatalogueOf(id) is { } svc) choices.Add(new JsonObject { ["id"] = id, ["name"] = svc.Name, ["connected"] = svc.Connected() });
        return new JsonObject { ["service"] = Discography.Default(), ["choices"] = choices };
    }

    /* GET and POST /api/settings/default-service */
    private static async Task<bool> DefaultServiceRoute(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HttpMethods.IsPost(ctx.Request.Method))
        {
            var b = await Auth.Body(ctx);
            var id = b?["service"] is JsonValue v && v.TryGetValue<string>(out var given) ? given : null;
            if (id == null || (id != "" && !Discography.Ids.Contains(id))) return await JsError(ctx, 400, "Choose Qobuz, Tidal, Spotify or none");
            using var c = Db.Open();
            Playback.QueueStore.SetSetting(c, Discography.Setting, id == "" ? null : JsonValue.Create(id));
        }
        return await Send(ctx, DefaultServiceJson());
    }

    /* GET /api/artist-discography?artist&artist_id */
    private static async Task<bool> ArtistDiscography(HttpContext ctx, Snapshot s, LibState st)
    {
        var artist = Names.JsTrim(Q(ctx, "artist") ?? "");
        if (artist.Length == 0) return await Send(ctx, new JsonObject { ["error"] = "artist required" }, 400);
        var none = new JsonObject { ["service"] = "", ["albums"] = new JsonArray() };
        if (CatalogueOf(Discography.Default()) is not { } svc || !svc.Connected()) return await Send(ctx, none);
        var (primary, _) = ArtistAlbumsOf(s, artist, ActOf(ctx));
        try
        {
            var o = await Discography.Of(svc, artist, [.. primary.Select(al => (al.Key, al.Title))], new Ask((await State())?.Version));
            return await SendJs(ctx, o);
        }
        catch (Exception e) when (e is ServiceError or HttpRequestException or TaskCanceledException)
        {
            Server.Log($"[{svc.Id}] {artist}'s albums for their page: {e.Message}");
            return await Send(ctx, new JsonObject { ["service"] = svc.Id, ["name"] = svc.Name, ["albums"] = new JsonArray(), ["error"] = e.Message });
        }
    }
}
