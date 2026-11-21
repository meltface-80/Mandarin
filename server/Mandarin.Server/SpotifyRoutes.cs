// SpotifyRoutes.cs — signing in to Spotify (bug list item 497, Services/SpotifySignIn.cs):
//
//   POST /api/settings/spotify/signin          the state, with Spotify's address to approve Mandarin on (url) and the
//                                              address Spotify sends the person back to (redirect)
//   POST /api/settings/spotify/signin/finish   { address } (the whole address Spotify sent back to), or { code, state }
//                                              (the Android app's, caught): the state, signed in; 400 in plain words
//
// The rest of Settings → Services → Spotify is Qobuz's and Tidal's (ServiceRoutes.cs): GET the state, POST { import },
// …/import (Update library now), …/signin/cancel, …/signout.
using Mandarin.Server.Services;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

internal static partial class Library
{
    /* Spotify's new from the artists you follow, still being gathered (item 499): said, so the page shows it; the others' answers as they were. */
    private static JsObj Gathering(Catalogue svc, JsObj o)
    {
        if (svc is SpotifyCatalogue s) o["building"] = s.Gathering;
        return o;
    }

    /* Spotify's sign-in: true when answered here. */
    private static async Task<bool> SpotifyRoute(HttpContext ctx)
    {
        var p = ctx.Request.Path.Value ?? "";
        if (p is not ("/api/settings/spotify/signin" or "/api/settings/spotify/signin/finish") || !HttpMethods.IsPost(ctx.Request.Method)) return false;
        if (!Jobs.Holds("services") || Jobs.Spotify is not { } svc || !BodyFits(ctx)) return false;
        var (ok, b) = await ServiceBody(ctx);
        if (!ok) return false;
        try
        {
            if (p.EndsWith("/signin", StringComparison.Ordinal)) return await SendJs(ctx, svc.BeginSignIn());
            static string? Text(object? v) => v is string s ? s : null;
            return await SendJs(ctx, await svc.FinishSignIn(Text(Prop(b, "address")), Text(Prop(b, "code")), Text(Prop(b, "state"))));
        }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            if (e is not (ServiceError or Tags.JsError)) Server.Log($"[spotify] sign-in: {e.GetType().Name}: {e.Message}");
            return await ImportFailed(ctx, e);
        }
    }
}
