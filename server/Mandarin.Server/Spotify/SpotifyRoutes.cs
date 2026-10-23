// SpotifyRoutes.cs — Settings → Services → Spotify (bug list item 142; SpotifyLive.cs):
//
//   GET  /api/settings/spotify            the state: whether a key is set (never the key), the room, the name the
//                                         Spotify app shows, Soloist's status, its build and when it runs out
//   POST /api/settings/spotify            { api_key?, room?, device_name? }: kept; Soloist started again on them
//   POST /api/settings/spotify/download   Soloist downloaded from Spotify now (Download / Update)
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
        if ((HttpMethods.IsGet(m) || HttpMethods.IsHead(m)) && p == "/api/settings/spotify") return await Send(ctx, SpotifyState(player));
        if (!HttpMethods.IsPost(m)) return false;
        if (p == "/api/settings/spotify/download")
        {
            await SpotifyLive.Fetch();
            return await Send(ctx, SpotifyState(player), SpotifyLive.FetchError == "" ? 200 : 502);
        }
        if (p != "/api/settings/spotify" || !BodyFits(ctx)) return false;
        var (b, answered) = await JsBody(ctx);
        if (answered) return true;
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
            ["pulseaudio"] = SpotifyLive.PulseAudio() != ""
        };
    }
}
