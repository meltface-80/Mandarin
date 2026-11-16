// IBroadcastRoutes.cs — Settings → Services → iBroadcast (item 443, Services/IBroadcast/):
//
//   GET  /api/settings/ibroadcast                 { connected, user: { name }, premium, formats, since }, or signed out
//                                                 { connected: false, pending?: { url, code, expires_at, error } }
//   POST /api/settings/ibroadcast/signin          a code to approve on iBroadcast: the state, its pending among it
//   POST /api/settings/ibroadcast/signin/cancel   the sign-in under way let go
//   POST /api/settings/ibroadcast/signout         signed out, here and at iBroadcast
//
// Signed in, the account is read again from iBroadcast when the page asks and six hours have gone by since it was.
// A failure is answered in iBroadcast's words, with its status (401: signed out, or to sign in again).
using System.Text.Json.Nodes;
using Mandarin.Server.Services;
using IB = Mandarin.Server.Services.IBroadcast;

namespace Mandarin.Server;

internal static partial class Library
{
    private const double IBroadcastRecheckMs = 6 * 3600 * 1000;

    /* The iBroadcast page's routes: true when answered here. */
    private static async Task<bool> IBroadcastRoute(HttpContext ctx)
    {
        var p = ctx.Request.Path.Value ?? "";
        if (!p.StartsWith("/api/settings/ibroadcast", StringComparison.Ordinal) || Jobs.IBroadcast is not { } ib) return false;
        var m = ctx.Request.Method;
        var get = HttpMethods.IsGet(m) || HttpMethods.IsHead(m);
        try
        {
            switch (p)
            {
                case "/api/settings/ibroadcast" when get:
                    if (IB.IBroadcast.Connected() && IB.IBroadcast.Account()?["checked"] is var at
                        && (at is not JsonValue v || !v.TryGetValue<double>(out var ms) || IB.IBroadcastApi.Now() - ms > IBroadcastRecheckMs))
                        _ = Task.Run(async () => { try { await ib.Describe(); } catch (ServiceError e) { Server.Log("[ibroadcast] the account couldn't be read: " + e.Message); } });
                    return await Http.Json(ctx, ib.Status());
                case "/api/settings/ibroadcast/signin" when HttpMethods.IsPost(m):
                    return await Http.Json(ctx, await ib.BeginSignIn());
                case "/api/settings/ibroadcast/signin/cancel" when HttpMethods.IsPost(m):
                    ib.CancelSignIn();
                    return await Http.Json(ctx, ib.Status());
                case "/api/settings/ibroadcast/signout" when HttpMethods.IsPost(m):
                    return await Http.Json(ctx, await ib.SignOut());
                default:
                    return false;
            }
        }
        catch (ServiceError e) when (!ctx.Response.HasStarted)
        {
            var o = new JsonObject { ["error"] = e.Message };
            if (e.Status == 401) o["connected"] = false;
            return await Http.Json(ctx, o, e.Status);
        }
    }
}
