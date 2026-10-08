// TasteRoutes.cs — what your listening suggests (v0.8.20), from
// lib/server/api-library.js, in the same shapes: Smart Picks (today's five,
// made again, an artist kept out) and the three acts under the share card
// (/api/similar). Answered here once the Node server has handed the taste
// work over (Jobs.cs, Extras/Taste.cs); until then, by the Node server.
using Mandarin.Server.Extras;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    private static Taste? HeldTaste => Jobs.Holds("taste") ? Jobs.Taste : null;

    private static Task<bool> SmartPicks(HttpContext ctx, Snapshot s, LibState st) =>
        HeldTaste is { } t ? SendJs(ctx, t.PicksJson(s)) : Task.FromResult(false);

    private static Task<bool> RebuildSmartPicks(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldTaste is not { } t) return Task.FromResult(false);
        t.Kick(s, true);
        var o = new JsObj();
        o["ok"] = true;
        o["building"] = true;
        return SendJs(ctx, o);
    }

    private static async Task<bool> BlockSmartPicksArtist(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldTaste == null) return false;
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var artist = TJs.Trim(LabelText((FromNode(b) as JsObj ?? new JsObj())["artist"]));
        if (artist.Length == 0) return await JsError(ctx, 400, "artist required");
        try { Taste.Block(s, artist); }
        catch (Exception e) { return await JsError(ctx, 400, e.Message); }
        var o = new JsObj();
        o["ok"] = true;
        o["artist"] = artist;
        return await SendJs(ctx, o);
    }

    /* library.artistAlbums(name).primary: the albums credited to the act first (Beatles or The Beatles). */
    private static List<Album> PrimaryAlbums(Snapshot s, string name)
    {
        var q = Names.ArtistKey(name);
        var primary = new List<Album>();
        if (q.Length == 0) return primary;
        foreach (var al in s.Albums)
        {
            var whole = Names.ArtistKey(al.Artist);
            var first = al.ArtistNames.Length > 0 ? Names.ArtistKey(al.ArtistNames[0].Name) : null;
            if (whole == q || first == q) primary.Add(al);
        }
        return primary;
    }

    /*
     * GET /api/similar?artist=: three acts worth hearing next — two not heard
     * of, one you know with a record you don't own — drawn afresh each time,
     * weighted by your listening, steered away from what was shown lately.
     */
    private static async Task<bool> SimilarActs(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldTaste is not { } taste) return false;
        var artist = Names.JsTrim(Q(ctx, "artist") ?? "");
        if (artist.Length == 0) return await JsError(ctx, 400, "artist query parameter required");
        var primary = ShareLinks.PrimaryArtist(artist);
        var key = Similar.Normalize(primary);
        var pool = (await taste.SimilarPool(primary)).OfType<JsObj>().Select(Act.FromPool).ToList();
        var graph = taste.Current();
        var artistKeys = new HashSet<string>(s.Albums.SelectMany(a => a.ArtistNames.Select(n => n.N)));
        string? Known(string name)
        {
            if (artistKeys.Contains(Names.Fold(name)) || PrimaryAlbums(s, name).Count > 0) return "library";
            return graph.Played.Contains(Similar.Normalize(name)) ? "played" : null;
        }
        var shownBefore = Taste.CacheGet("similar-shown", key, 30.0 * 86400000) as List<object?> ?? [];
        var ranked = Similar.RankActs(pool, primary, graph.Graph, Known, graph.Heavy, [.. shownBefore.OfType<string>()]);
        var picks = Similar.Choose(ranked);
        var acts = new List<JsObj>();
        foreach (var act in picks)
        {
            var (top, albums) = await taste.ActRecords(act);
            var owned = act.Known == "library" ? PrimaryAlbums(s, act.Name).Select(a => a.Title) : [];
            var rec = Similar.RecordFor(act, top, albums, owned);
            var o = new JsObj();
            o["name"] = act.Name;
            o["id"] = act.Id;
            o["album"] = rec != null ? rec["title"] : null;
            o["year"] = rec != null ? rec["year"] : null;
            o["cover"] = rec != null && TJs.Truthy(rec["cover"]) ? rec["cover"] : TJs.Truthy(act.Picture) ? act.Picture : null;
            o["reason"] = Similar.ReasonFor(act, primary);
            o["known"] = act.Known;
            acts.Add(o);
        }
        if (picks.Count > 0)
        {
            var shown = new List<object?>();
            foreach (var v in picks.Select(a => (object?)a.Id).Concat(shownBefore))
                if (!shown.Any(x => TJs.StrictEq(x, v))) shown.Add(v);
            Taste.CachePut("similar-shown", key, shown.Take(Similar.ShownKeep).ToList());
        }
        List<string> enabled;
        using (var c = Db.Open()) enabled = ShareLinks.EnabledServices(c);
        var locale = ShareLinks.LocaleFromAcceptLanguage(ctx.Request.Headers.AcceptLanguage.Count > 0 ? ctx.Request.Headers.AcceptLanguage.ToString() : null);
        var body = new JsObj();
        body["acts"] = acts.Select(act =>
        {
            // A record that turns out to be in the library after all can be played here.
            var album = act["album"];
            var inLib = TJs.Truthy(album) ? Relocate(s, TJs.Str(album), TJs.Str(act["name"])) : null;
            var o = new JsObj();
            foreach (var k in act.Keys) o[k] = act[k];
            o["album"] = inLib != null ? inLib.Title : album;
            o["in_library"] = inLib != null;
            o["offset"] = inLib != null ? (double)inLib.Id : null;
            o["library_title"] = inLib?.Title;
            o["library_subtitle"] = inLib?.Artist;
            o["services"] = inLib != null ? new List<object?>() : ShareLinks.ServiceLinks(act["name"], TJs.Truthy(album) ? album : "", locale, enabled);
            return (object?)o;
        }).ToList();
        ctx.Response.Headers.CacheControl = "no-store";
        return await SendJs(ctx, body);
    }
}
