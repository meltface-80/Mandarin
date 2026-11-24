// SimilarRoute.cs — an act's similar acts for its page (bug list item 137), and similar albums (item 140):
//
//   GET /api/artist/similar?name=          { source, artists: [{ name, in_library, photo_key }] }
//   GET /api/artist/similar-albums?name=   { enabled, source, albums: [{ title, artist, url, image_key, album }] }
//
// Deezer's related acts, which need no key (Taste.SimilarActs, kept a week; Last.fm's
// went with its key, item 494). Twelve at most. Each with a picture of the act: its own
// once the credits have found one (item 129), else Deezer's, else one of its covers in
// the library. Every one opens its page here, in the library or not, as a band's
// members do. An album's page asks the same of its lead artist (item 494).
//
// Similar albums: the library's alone (the owner's call: none that leave the
// app), its albums by the acts Deezer relates, one each, none the artist is on.
using System.Text.Json.Nodes;
using Mandarin.Server.Credits;
using Mandarin.Server.Identify;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    /* GET /api/artist/similar?name= */
    private static async Task<bool> ArtistSimilar(HttpContext ctx, Snapshot s, LibState st)
    {
        var name = Names.JsTrim(Q(ctx, "name") ?? "");
        if (name.Length == 0) return await Send(ctx, new JsonObject { ["error"] = "name required" }, 400);
        var found = new List<(string Name, string? Picture)>();
        var source = "";
        if (Jobs.Taste is { } taste)
        {
            try
            {
                found = [.. (await taste.SimilarActs(name)).OfType<JsObj>().Select(o => (TJs.Str(o["name"]), TJs.Truthy(o["picture"]) ? TJs.Str(o["picture"]) : null))];
                source = "Deezer";
            }
            catch (Exception e) when (e is LookupError or HttpRequestException) { /* none */ }
        }
        var photos = CreditStore.Photos();
        var list = new JsonArray();
        foreach (var (n, picture) in found.Where(f => f.Name.Length > 0))
        {
            var (primary, featured) = ArtistAlbumsOf(s, n);
            var own = primary.Count > 0 ? primary[0] : featured.Count > 0 ? featured[0] : null;
            var photo = CreditRules.PhotoKey(photos.GetValueOrDefault(Names.ArtistKey(n))) ?? CreditRules.PhotoKey(picture) ?? own?.ImageKey;
            list.Add(new JsonObject { ["name"] = n, ["in_library"] = own != null, ["photo_key"] = photo });
        }
        return await Send(ctx, new JsonObject { ["source"] = list.Count > 0 ? source : null, ["artists"] = list });
    }

    /* GET /api/artist/similar-albums?name= */
    private static async Task<bool> ArtistSimilarAlbums(HttpContext ctx, Snapshot s, LibState st)
    {
        var name = Names.JsTrim(Q(ctx, "name") ?? "");
        if (name.Length == 0) return await Send(ctx, new JsonObject { ["error"] = "name required" }, 400);
        var albums = new JsonArray();
        var source = "";
        if (Jobs.Taste is { } taste)
        {
            try
            {
                // Not the artist's own: an album they are on is theirs, shown as theirs already.
                var (mine, on) = ArtistAlbumsOf(s, name);
                var own = mine.Concat(on).ToHashSet();
                foreach (var act in (await taste.SimilarActs(name)).OfType<JsObj>().Select(o => TJs.Str(o["name"])).Where(n => n.Length > 0))
                {
                    if (ArtistAlbumsOf(s, act).Primary.FirstOrDefault(a => !own.Contains(a)) is not { } al) continue;
                    albums.Add(new JsonObject { ["title"] = al.Title, ["artist"] = al.Artist, ["url"] = null, ["image"] = null, ["image_key"] = al.ImageKey, ["album"] = AlbumJson(s, al) });
                    if (albums.Count == 12) break;
                }
                source = "Deezer";
            }
            catch (Exception e) when (e is LookupError or HttpRequestException) { /* none */ }
        }
        return await Send(ctx, new JsonObject { ["enabled"] = true, ["source"] = albums.Count > 0 ? source : null, ["albums"] = albums });
    }
}
