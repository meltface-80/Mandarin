// SimilarRoute.cs — an act's similar acts for its page (bug list item 137), and similar albums (item 140):
//
//   GET /api/artist/similar?name=          { source, artists: [{ name, in_library, photo_key }] }
//   GET /api/artist/similar-albums?name=   { enabled, source, albums: [{ title, artist, url, image_key, album }] }
//
// Last.fm's when a key is set (Settings → Setup → API Keys), else Deezer's
// related acts, which need none (Taste.SimilarActs, kept a week). Twelve at
// most. Each with a picture of the act: its own once the credits have found
// one (item 129), else Deezer's, else one of its covers in the library; none
// from Last.fm, whose pictures of acts are a blank star now. Every one opens
// its page here, in the library or not, as a band's members do.
//
// Similar albums: with a Last.fm key, Last.fm's (each similar act's top album,
// as an album's page has them, the library's own where it has it); without
// one, the library's albums by the acts Deezer relates, one each. The shape
// is /api/lastfm/similar-albums', so the clients read both alike.
using System.Text.Json.Nodes;
using Mandarin.Server.Credits;
using Mandarin.Server.Extras;
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
        if (LastfmKey().Length > 0 && HeldLastfm is { } fm)
        {
            try { found = [.. (await fm.SimilarArtists(name)).Artists.Take(12).Select(a => (a.Name, (string?)null))]; source = "Last.fm"; }
            catch (Exception e) when (e is LastfmError or HttpRequestException) { /* Deezer's, then */ }
        }
        if (found.Count == 0 && Jobs.Taste is { } taste)
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
        if (LastfmKey().Length > 0 && HeldLastfm is { } fm)
        {
            try
            {
                var (_, found) = await fm.SimilarAlbums(name, 9, () => !ctx.RequestAborted.IsCancellationRequested);
                foreach (var al in found)
                {
                    var own = LastfmInLibrary(s, al.Title, al.Artist);
                    albums.Add(new JsonObject
                    {
                        ["title"] = al.Title, ["artist"] = al.Artist, ["url"] = al.Url, ["image"] = al.Image,
                        ["image_key"] = Picture(al.Image), ["album"] = own != null ? AlbumJson(s, own) : null,
                    });
                }
                source = "Last.fm";
            }
            catch (Exception e) when (e is LastfmError or HttpRequestException) { /* the library's, then */ }
        }
        if (albums.Count == 0 && Jobs.Taste is { } taste)
        {
            try
            {
                foreach (var act in (await taste.SimilarActs(name)).OfType<JsObj>().Select(o => TJs.Str(o["name"])).Where(n => n.Length > 0))
                {
                    var (primary, _) = ArtistAlbumsOf(s, act);
                    if (primary.Count == 0) continue;
                    var al = primary[0];
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
