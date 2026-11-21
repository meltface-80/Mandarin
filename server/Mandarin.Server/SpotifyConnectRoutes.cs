// SpotifyConnectRoutes.cs — Settings → Services → Spotify → Spotify Connect (bug list item 501; Connect/SpotifyLive.cs):
//
//   GET  /api/settings/spotify-connect            the state: whether a key is set (never the key), the room and the
//                                                 rooms to choose from, the name the Spotify app shows, Soloist's
//                                                 status, what plays and how the room is sent it, its build and when
//                                                 it runs out, whether PulseAudio is here
//   POST /api/settings/spotify-connect            { api_key?, room?, device_name? }: kept; Soloist started again on a
//                                                 new key or name (downloaded first where it isn't here or runs out)
//   POST /api/settings/spotify-connect/download   Soloist downloaded from Spotify now (Download / Update)
//
// Once this server holds playback (Jobs.cs starts Soloist then); before that, not answered here.
using System.Text.Json.Nodes;
using Mandarin.Server.Connect;

namespace Mandarin.Server;

internal static partial class Library
{
    private const string ConnectPath = "/api/settings/spotify-connect";

    /* Spotify Connect's settings: true when answered here. */
    private static async Task<bool> SpotifyConnectRoute(HttpContext ctx)
    {
        var p = ctx.Request.Path.Value ?? "";
        if (p is not (ConnectPath or ConnectPath + "/download") || SpotifyLive.Player is not { } player) return false;
        var m = ctx.Request.Method;
        if (p == ConnectPath && (HttpMethods.IsGet(m) || HttpMethods.IsHead(m))) return await Send(ctx, ConnectState(player));
        if (!HttpMethods.IsPost(m)) return false;
        if (p.EndsWith("/download", StringComparison.Ordinal))
        {
            await SpotifyLive.Fetch();
            return await Send(ctx, ConnectState(player), SpotifyLive.FetchError == "" ? 200 : 502);
        }
        if (!BodyFits(ctx)) return false;
        var (ok, b) = await ServiceBody(ctx);
        if (!ok) return false;
        var was = SpotifyLive.Settings();
        string Given(string k, string kept) => Prop(b, k) is string s ? s.Trim() : kept;
        var name = Given("device_name", was.DeviceName);
        var now = new ConnectSettings(Given("api_key", was.ApiKey), Given("room", was.Room), name != "" ? name : ConnectSettings.DefaultName);
        SpotifyLive.Save(now);
        // A new key or name: Soloist started again on it (the room is read as Spotify starts playing).
        if (now.ApiKey != was.ApiKey || now.DeviceName != was.DeviceName)
        {
            if (now.ApiKey != "" && SpotifyLive.Build().Plan != "use") _ = SpotifyLive.Fetch();
            else player.Restart();
        }
        return await Send(ctx, ConnectState(player));
    }

    /* What Settings shows: never the key itself. */
    internal static JsonObject ConnectState(Soloist player)
    {
        var s = SpotifyLive.Settings();
        var (version, expires, plan) = SpotifyLive.Build();
        var rooms = new JsonArray();
        if (Playback.Hub.Current is { } hub)
            foreach (var z in hub.Zones())
                rooms.Add(new JsonObject { ["id"] = z.ZoneId, ["name"] = z.DisplayName, ["sound"] = SpotifyRoomPlan.For(hub.TargetFor(z.ZoneId)).Words() });
        var t = player.Track;
        return new JsonObject
        {
            ["has_key"] = s.ApiKey != "",
            ["room"] = s.Room,
            ["rooms"] = rooms,
            ["device_name"] = s.DeviceName,
            ["status"] = player.Status,
            ["signed_in"] = player.SignedIn,
            ["active"] = player.Active,
            ["playback"] = player.Playback,
            ["track"] = t.Title == "" ? null : new JsonObject { ["title"] = t.Title, ["artists"] = t.Artists, ["album"] = t.Album },
            ["quality"] = SpotifyNow.FormatText(player.Proof.Says()),
            ["sent"] = SpotifyLive.Sound.Words(),
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
