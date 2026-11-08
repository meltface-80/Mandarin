// TasteRoutes.cs — what your listening suggests (v0.8.20), from
// lib/server/api-library.js, in the same shapes: Smart Picks (today's five,
// made again, an artist kept out), from the taste work (Extras/Taste.cs). The
// three acts that were under the share card (/api/similar) went with item 336.
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
}
