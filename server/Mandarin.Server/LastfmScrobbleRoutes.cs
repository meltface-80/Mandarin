// LastfmScrobbleRoutes.cs — scrobbling's routes (Extras/LastfmAccount.cs,
// Playback/Scrobbles.cs), for Settings → API Keys on the page and in the app:
//
//   GET  /api/settings/lastfm-secret            { set, masked, check }, as the keys
//   POST /api/settings/lastfm-secret { secret } kept and checked (a token asked
//                                               for: Last.fm refuses a wrong secret's
//                                               signature, error 13); a session
//                                               signed with the old one goes
//   GET  /api/lastfm/scrobbling                 { key_set, secret_set, connected, name,
//                                               pending, queued, error }: a sign-in
//                                               waiting is asked about there and then
//   POST /api/lastfm/connect                    { url }: Last.fm's page to approve on
//   POST /api/lastfm/disconnect                 the status, not connected
using System.Text.Json.Nodes;
using Mandarin.Server.Extras;
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;
using TJs = Mandarin.Server.Tags.Js;

namespace Mandarin.Server;

internal static partial class Library
{
    /* The secret's check: "ok", "invalid" (Last.fm refused its signature or the key), or null (Last.fm not reached, or no key). */
    private static async Task<string?> CheckLastfmSecret(CancellationToken ct)
    {
        if (LastfmKey().Length == 0 || LastfmAccount.Secret().Length == 0) return null;
        try { await LastfmAccount.Call("auth.getToken", new Dictionary<string, string>(), false, ct); return "ok"; }
        catch (LastfmError e) when (e.Code is 13 or 10 or 26) { return "invalid"; }
        catch (Exception e) when (e is LastfmError or HttpRequestException or TaskCanceledException) { return null; }
    }

    private static JsonObject SecretState(string? check)
    {
        var s = LastfmAccount.Secret();
        return new JsonObject { ["set"] = s.Length > 0, ["masked"] = s.Length > 0 ? "••••" + (s.Length > 4 ? s[^4..] : s) : "", ["check"] = check };
    }

    /* GET /api/settings/lastfm-secret */
    private static async Task<bool> LastfmSecretState(HttpContext ctx, Snapshot s, LibState st) =>
        await Send(ctx, SecretState(await CheckLastfmSecret(ctx.RequestAborted)));

    /* POST /api/settings/lastfm-secret { secret } */
    private static async Task<bool> SaveLastfmSecret(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var given = (FromNode(b) as JsObj ?? new JsObj())["secret"];
        LastfmAccount.SetSecret(TJs.Truthy(given) ? TJs.Str(given) : "");
        var state = SecretState(await CheckLastfmSecret(ctx.RequestAborted));
        state["ok"] = true;
        return await Send(ctx, state);
    }

    /* GET /api/lastfm/scrobbling */
    private static async Task<bool> LastfmScrobbling(HttpContext ctx, Snapshot s, LibState st) =>
        await Send(ctx, await LastfmAccount.Status(Scrobbles.Queued(), Scrobbles.LastError, ctx.RequestAborted));

    /* POST /api/lastfm/connect */
    private static async Task<bool> LastfmConnect(HttpContext ctx, Snapshot s, LibState st)
    {
        try { return await Send(ctx, new JsonObject { ["url"] = await LastfmAccount.Connect(ctx.RequestAborted) }); }
        catch (LastfmError e) when (e.Code is "nokey") { return await Send(ctx, new JsonObject { ["error"] = "Save the Last.fm key and shared secret first" }, 400); }
        catch (LastfmError e) when (e.Code is 13 or 10 or 26) { return await Send(ctx, new JsonObject { ["error"] = "Last.fm refused the key or shared secret" }, 400); }
        catch (Exception e) when (e is LastfmError or HttpRequestException or TaskCanceledException) { return await Send(ctx, new JsonObject { ["error"] = "Last.fm did not answer" }, 502); }
    }

    /* POST /api/lastfm/disconnect */
    private static async Task<bool> LastfmDisconnect(HttpContext ctx, Snapshot s, LibState st)
    {
        LastfmAccount.Disconnect();
        return await Send(ctx, await LastfmAccount.Status(Scrobbles.Queued(), null, ctx.RequestAborted));
    }
}
