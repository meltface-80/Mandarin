// ServiceRoutes.Play.cs — playing a Qobuz or Tidal album from its browser
// (api-service.js POST /api/<s>/play, v0.8.47): its rows written, then its
// tracks played by the hub (v0.8.49, stage 6).
using Mandarin.Server.Services;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    /*
     * Playing an album from the browser (api-service.js POST /api/<s>/play,
     * v0.8.47): its rows written (asked of the service each time) and the
     * library read again, then its tracks played — the album, or one track of
     * it (now, next, at the end) — by the hub (v0.8.49, stage 6: as that
     * route's play() plays them).
     */
    private static async Task<bool> PlayAlbum(HttpContext ctx, Catalogue svc, string albumId, object? b)
    {
        var zone = Prop(b, "zone_or_output_id");
        if (!TJs.Truthy(zone)) return await JsError(ctx, 400, "zone_or_output_id required");
        var k = Prop(b, "kind");
        var kind = k is "play_now" or "play_next" or "queue" or "shuffle" ? (string)k : "play_now";
        var offset = await svc.EnsureAlbum(albumId);
        await svc.Changed("opened");
        // No hub (stopping): as the Node server's answer failed to come.
        if (Playback.Hub.Current is not { } hub) return await JsError(ctx, 500, "fetch failed");
        return await PlayHere(ctx, hub, TJs.Str(zone), offset, kind, Prop(b, "track"));
    }

    /* api-service.js play(ctx, zone, offset, kind, track), by the hub here: the whole album, or one track of it. */
    private static async Task<bool> PlayHere(HttpContext ctx, Playback.Hub hub, string zone, long offset, string kind, object? track)
    {
        try
        {
            if (track is not Undef && track != null)
            {
                var s = await Library.CurrentCopy() ?? throw new Playback.HubError(503, "The library is still being scanned");
                List<Playback.PlayTrack> tracks;
                using (var c = Db.Open()) tracks = Playback.Tracks.OfAlbum(c, s, offset);
                var i = TJs.ToNumber(track);
                if (!double.IsInteger(i) || i < 0 || i >= tracks.Count) throw new Playback.HubError(409, "That track isn't on the album");
                if (kind == "play_now") await Playback.Items.PlayTracks(hub, zone, tracks, "play_now", i);
                else await Playback.Items.PlayTracks(hub, zone, [tracks[(int)i]], kind == "queue" ? "queue" : "add_next");
            }
            else await Playback.Items.PlayAlbum(hub, zone, offset, kind);
            return await SendJs(ctx, Jso(("ok", true), ("offset", (double)offset), ("action", kind)));
        }
        catch (Playback.HubError e)
        {
            var o = Jso(("error", e.Message));
            if (e.Status == 401) o["connected"] = false;
            return await SendJs(ctx, o, e.Status);
        }
    }
}
