// SpotifyRoutes.cs — Settings → Services → Spotify (bug list item 142; SpotifyLive.cs):
//
//   GET  /api/settings/spotify            the state: whether a key is set (never the key), the room, the name the
//                                         Spotify app shows, Soloist's status, its build and when it runs out
//   POST /api/settings/spotify            { api_key?, room?, device_name? }: kept; Soloist started again on them
//   POST /api/settings/spotify/download   Soloist downloaded from Spotify now (Download / Update)
//
// From item 143 the state carries the Spotify account too (account: the services' status, Services/SpotifyAccounts.cs),
// and { import } switches its favourites in the library on and off, as Qobuz's and Tidal's do; signing in and out and
// Update library now are the services' routes (ServiceRoutes.cs: /signin, /signin/code, /signout, /import).
//
// Once this server holds playback (Jobs.cs starts Soloist then); before that, not answered here.
using System.Text.Json.Nodes;
using Mandarin.Server.Spotify;

namespace Mandarin.Server;

internal static partial class Library
{
    /* The Spotify settings routes: true when answered here. */
    private static async Task<bool> SpotifyRoute(HttpContext ctx)
    {
        var p = ctx.Request.Path.Value ?? "";
        if (!p.StartsWith("/api/settings/spotify", StringComparison.Ordinal) || SpotifyLive.Player is not { } player) return false;
        var m = ctx.Request.Method;
        if ((HttpMethods.IsGet(m) || HttpMethods.IsHead(m)) && p == "/api/settings/spotify")
        {
            try { return await Send(ctx, SpotifyState(player)); }
            catch (Exception e) when (!ctx.Response.HasStarted) { return await Server.Failed(ctx, "spotify", e); }
        }
        if (!HttpMethods.IsPost(m)) return false;
        if (p == "/api/settings/spotify/download")
        {
            await SpotifyLive.Fetch();
            return await Send(ctx, SpotifyState(player), SpotifyLive.FetchError == "" ? 200 : 502);
        }
        var signing = p is "/api/settings/spotify/signin" or "/api/settings/spotify/signin/code" or "/api/settings/spotify/signin/cancel";
        if (p != "/api/settings/spotify" && !signing || !BodyFits(ctx)) return false;
        var (b, answered) = await JsBody(ctx);
        if (answered) return true;
        if (signing) return Account() is { } acct ? await SpotifySignIn(ctx, acct, p, b) : await JsError(ctx, 503, "Spotify isn't set up on this server");
        // The favourites in the library on or off: the services' own switch.
        if (Prop(b, "import") is not Tags.Undef && Account() is { } svc) return await SaveServiceSettings(ctx, svc, b);
        return await AfterBody(ctx, async () =>
        {
            var was = SpotifyLive.Settings();
            string Given(string k, string kept) => Prop(b, k) is string s ? s.Trim() : kept;
            var name = Given("device_name", was.DeviceName);
            var now = new SpotifySettings(Given("api_key", was.ApiKey), Given("room", was.Room), name != "" ? name : SpotifySettings.DefaultName);
            SpotifyLive.Save(now);
            // A new key or name: Soloist started again on it (the room is only read as Spotify starts playing).
            if (now.ApiKey != was.ApiKey || now.DeviceName != was.DeviceName)
            {
                if (now.ApiKey != "" && SpotifyLive.Build().Plan != "use") _ = SpotifyLive.Fetch();
                else player.Restart();
            }
            return await Send(ctx, SpotifyState(player));
        });
    }

    /*
     * Signing in to Spotify (item 143, Services/SpotifyAccounts.cs): your Client ID begins it (the page to approve
     * Mandarin on), the address Spotify sent the browser to finishes it, Cancel lets it go. Refused in its words.
     */
    private static async Task<bool> SpotifySignIn(HttpContext ctx, Services.SpotifyCatalogue svc, string p, object? b)
    {
        try
        {
            if (p.EndsWith("/code", StringComparison.Ordinal)) return await SendJs(ctx, await svc.FinishSignIn(Prop(b, "url")));
            if (p.EndsWith("/cancel", StringComparison.Ordinal)) { svc.CancelSignIn(); return await SendJs(ctx, svc.Status()); }
            return await SendJs(ctx, svc.BeginSignIn(Prop(b, "client_id")));
        }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            if (e is not (global::Mandarin.Server.Services.ServiceError or Tags.JsError)) Server.Log($"[spotify] sign-in: {e.GetType().Name}: {e.Message}");
            return await ImportFailed(ctx, e);
        }
    }

    /* The Spotify account's service, once this server holds the services' work. */
    private static Services.SpotifyCatalogue? Account() => Jobs.Holds("services") ? Jobs.Spotify : null;

    /* What Settings shows: never the key itself. */
    internal static JsonObject SpotifyState(Soloist player)
    {
        var s = SpotifyLive.Settings();
        var (version, expires, plan) = SpotifyLive.Build();
        return new JsonObject
        {
            ["has_key"] = s.ApiKey != "",
            ["room"] = s.Room,
            ["device_name"] = s.DeviceName,
            ["status"] = player.Status,
            ["signed_in"] = player.SignedIn,
            ["active"] = player.Active,
            ["playback"] = player.Playback,
            ["quality"] = SpotifyNow.FormatText(player.Proof.Says()),
            ["soloist"] = new JsonObject
            {
                ["version"] = version,
                ["expires"] = expires?.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
                ["plan"] = plan,
                ["fetching"] = SpotifyLive.Fetching,
                ["error"] = SpotifyLive.FetchError
            },
            ["pulseaudio"] = SpotifyLive.PulseAudio() != "",
            ["account"] = Account() is { } svc ? JsonNode.Parse(Tags.Js.Json(svc.Status()) ?? "null") : null
        };
    }
}
