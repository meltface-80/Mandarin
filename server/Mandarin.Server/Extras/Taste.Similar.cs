// Taste.Similar.cs — an act's similar acts for its page (bug list item 137):
// Deezer's related list as Taste reads it for the share card and the taste
// graph, twelve kept with their pictures (Credits/SimilarRoute.cs asks).
using Mandarin.Server.Identify;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Taste
{
    /* An act's similar acts for its page (bug list item 137): Deezer's related list, [{ name, id, picture }] (twelve at most), kept a week. */
    public async Task<List<object?>> SimilarActs(string name)
    {
        var key = Names.Fold(name);
        var hit = CacheGet("similar", key, 7 * Day);
        if (Js.Truthy(hit)) return hit as List<object?> ?? [];
        var search = await Deezer("search/artist?limit=" + Similar.SearchRows + "&q=" + Lookups.Encode(name));
        var acts = new List<object?>();
        foreach (var c in Similar.ReadDeezerArtists(search, name).Take(Similar.Candidates))
        {
            var rel = await Deezer("artist/" + Lookups.Encode(c.Id) + "/related?limit=25");
            acts = Similar.ReadDeezerRelated(rel, 12).Select(a =>
            {
                var o = new JsObj();
                o["name"] = a.Name;
                o["id"] = a.Id;
                o["picture"] = a.Picture;
                return (object?)o;
            }).ToList();
            if (acts.Count > 0) break;
        }
        CachePut("similar", key, acts);
        return acts;
    }
}
