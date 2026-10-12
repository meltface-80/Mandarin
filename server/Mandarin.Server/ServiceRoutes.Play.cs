// ServiceRoutes.Play.cs — playing a Qobuz or Tidal album from its browser
// (api-service.js POST /api/<s>/play, v0.8.47): its rows written, then its
// tracks played by the hub here (v0.8.49, stage 6) or, until this server holds
// playback, by the Node server at this one's ask (POST /internal/playback/play).
using System.Text;
using Mandarin.Server.Services;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    /*
     * Playing an album from the browser (api-service.js POST /api/<s>/play,
     * v0.8.47): its rows written (asked of the service each time), the Node
     * server told and its library read again, then its tracks played — the
     * album, or one track of it (now, next, at the end) — by the hub here once
     * this server holds playback (v0.8.49, stage 6: as that route's play()
     * plays them), else by the Node server as that route plays them (POST
     * /internal/playback/play), its answer the answer.
     */
    private static async Task<bool> PlayAlbum(HttpContext ctx, Catalogue svc, string albumId, object? b)
    {
        var zone = Prop(b, "zone_or_output_id");
        if (!TJs.Truthy(zone)) return await JsError(ctx, 400, "zone_or_output_id required");
        var k = Prop(b, "kind");
        var kind = k is "play_now" or "play_next" or "queue" or "shuffle" ? (string)k : "play_now";
        var offset = await svc.EnsureAlbum(albumId);
        await svc.Changed("opened");
        if (Playback.Hub.Current is { } hub) return await PlayHere(ctx, hub, TJs.Str(zone), offset, kind, Prop(b, "track"));
        var ask = new JsObj();
        ask["zone_or_output_id"] = zone;
        ask["offset"] = (double)offset;
        ask["kind"] = kind;
        if (Prop(b, "track") is var track && track is not Undef) ask["track"] = track;
        if (await AskNode("/internal/playback/play", TJs.Json(ask) ?? "{}") is not var (status, text)) return await JsError(ctx, 500, "fetch failed");
        return await SendNodeJson(ctx, text, status);
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

    /* An answer the Node server made (res.json's text), sent on as it is, with its status, as Express would send it. */
    private static async Task<bool> SendNodeJson(HttpContext ctx, string text, int status)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        var tag = "W/\"" + bytes.Length.ToString("x") + "-" + Convert.ToBase64String(System.Security.Cryptography.SHA1.HashData(bytes))[..27] + "\"";
        var h = ctx.Response.Headers;
        h["X-Mandarin-Answered"] = "C#";
        h.ETag = tag;
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        ctx.Response.ContentLength = bytes.Length;
        await ctx.Response.Body.WriteAsync(bytes);
        return true;
    }
}
