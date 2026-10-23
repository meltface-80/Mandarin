using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// Your Spotify library in Mandarin (bug list item 143, server/Mandarin.Server/Services/Spotify*.cs), against a stand-in
/// for Spotify's accounts service and Web API: signing in with your own Client ID (PKCE: the verifier checked against the
/// challenge, the state against the sign-in under way), the token refreshed with the refresh token Spotify last sent;
/// your saved albums (an album's later pages of tracks read too, Development Mode's "item" read as "album") kept in the
/// library as Spotify's, your liked songs and playlists as playlists (a podcast's episode left out); and a Spotify album
/// played from Mandarin started on Mandarin's own Soloist through the Web API (its device, the album at the track),
/// never fetched track by track.
/// </summary>
public sealed class SpotifyLibraryTests
{
    private const string ClientId = "0123456789abcdef0123456789abcdef";

    /* The stand-in for Spotify: what it was asked, and the tokens it handed out. */
    private sealed class FakeSpotify
    {
        public string Base = "";
        public string? Challenge;
        public string Access = "", Refresh = "";
        public int Tokens;
        public readonly ConcurrentQueue<string> Refreshed = new();
        public readonly ConcurrentQueue<(string Path, string Body)> Plays = new();
        public readonly ConcurrentQueue<string> Paths = new();

        private static JsonObject Track(string album, int n) => new()
        {
            ["id"] = $"{album}t{n}", ["name"] = $"Song {n} of {album}", ["artists"] = new JsonArray(new JsonObject { ["id"] = "ar1", ["name"] = "Ann Artist" }),
            ["track_number"] = n, ["disc_number"] = 1, ["duration_ms"] = 200_000, ["is_local"] = false, ["type"] = "track",
            ["album"] = new JsonObject { ["id"] = album }
        };

        private JsonObject Album(string id, string name, int count, int firstPage)
        {
            var items = new JsonArray(Enumerable.Range(1, firstPage).Select(n => (JsonNode)Track(id, n)).ToArray());
            return new JsonObject
            {
                ["id"] = id, ["name"] = name, ["release_date"] = "2021-05-07", ["total_tracks"] = count,
                ["artists"] = new JsonArray(new JsonObject { ["id"] = "ar1", ["name"] = "Ann Artist" }),
                ["images"] = new JsonArray(new JsonObject { ["url"] = Base + "/img/" + id + ".jpg", ["width"] = 640 }),
                ["tracks"] = new JsonObject { ["items"] = items, ["next"] = count > firstPage ? $"{Base}/v1/albums/{id}/tracks?offset={firstPage}&limit=50" : null }
            };
        }

        private static JsonObject Page(params JsonNode[] items) => new() { ["items"] = new JsonArray(items), ["next"] = null };

        public async Task Handle(HttpContext ctx)
        {
            var path = ctx.Request.Path.Value ?? "";
            var body = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
            Paths.Enqueue(ctx.Request.Method + " " + path);
            if (path == "/api/token") { await Token(ctx, body); return; }
            if (path.StartsWith("/img/", StringComparison.Ordinal)) { ctx.Response.ContentType = "image/jpeg"; await ctx.Response.Body.WriteAsync(new byte[] { 0xFF, 0xD8, 0xFF, 0xD9 }); return; }
            if ((string?)ctx.Request.Headers.Authorization != "Bearer " + Access) { ctx.Response.StatusCode = 401; await ctx.Response.WriteAsync("{\"error\":{\"status\":401,\"message\":\"The access token expired\"}}"); return; }
            JsonNode? answer = path switch
            {
                "/v1/me" => new JsonObject { ["id"] = "ann1", ["display_name"] = "Ann" },
                "/v1/me/albums" => Page(new JsonObject { ["added_at"] = "2026-01-02T03:04:05Z", ["album"] = Album("al1", "First Light", 2, 2) },
                                        new JsonObject { ["added_at"] = "2026-02-02T03:04:05Z", ["item"] = Album("al2", "Second Wind", 3, 2) }),
                "/v1/albums/al2/tracks" => Page(Track("al2", 3)),
                "/v1/albums/al1" => Album("al1", "First Light", 2, 2),
                "/v1/albums/al2" => Album("al2", "Second Wind", 3, 2),
                "/v1/albums/al3" => Album("al3", "Third Way", 1, 1),
                "/v1/me/tracks" => Page(new JsonObject { ["track"] = Track("al3", 1) }),
                "/v1/me/playlists" => Page(new JsonObject { ["id"] = "pl1", ["name"] = "Road" }),
                "/v1/playlists/pl1/items" => Page(new JsonObject { ["item"] = Track("al1", 2) }, new JsonObject { ["item"] = new JsonObject { ["id"] = "ep1", ["type"] = "episode" } }),
                "/v1/me/player/devices" => new JsonObject { ["devices"] = new JsonArray(new JsonObject { ["id"] = "dev-mandarin", ["name"] = "Mandarin" }, new JsonObject { ["id"] = "dev-phone", ["name"] = "Ann's phone" }) },
                "/v1/me/player/play" => null,
                _ => new JsonObject { ["error"] = new JsonObject { ["status"] = 404, ["message"] = "Not found" } }
            };
            if (path == "/v1/me/player/play") { Plays.Enqueue((path + ctx.Request.QueryString, body)); ctx.Response.StatusCode = 204; return; }
            if (answer is JsonObject e && e["error"] != null) ctx.Response.StatusCode = 404;
            ctx.Response.ContentType = "application/json";
            await ctx.Response.WriteAsync(answer!.ToJsonString());
        }

        private async Task Token(HttpContext ctx, string body)
        {
            var f = body.Split('&').Select(p => p.Split('=', 2)).ToDictionary(p => p[0], p => Uri.UnescapeDataString(p[1]));
            bool good = f["client_id"] == ClientId && f["grant_type"] switch
            {
                "authorization_code" => f["code"] == "AQ-good" && f["redirect_uri"] == "http://127.0.0.1:43143/mandarin-spotify"
                    && Convert.ToBase64String(SHA256.HashData(Encoding.ASCII.GetBytes(f["code_verifier"]))).TrimEnd('=').Replace('+', '-').Replace('/', '_') == Challenge,
                "refresh_token" => f["refresh_token"] == Refresh,
                _ => false
            };
            if (f["grant_type"] == "refresh_token") Refreshed.Enqueue(f["refresh_token"]);
            ctx.Response.ContentType = "application/json";
            if (!good) { ctx.Response.StatusCode = 400; await ctx.Response.WriteAsync("{\"error\":\"invalid_grant\",\"error_description\":\"Invalid authorization code\"}"); return; }
            Tokens++;
            (Access, Refresh) = ($"acc{Tokens}", $"ref{Tokens}");
            // A second's life: every call refreshes it, with the refresh token Spotify sent last.
            await ctx.Response.WriteAsync(new JsonObject { ["access_token"] = Access, ["refresh_token"] = Refresh, ["expires_in"] = 1 }.ToJsonString());
        }
    }

    private static string QueryOf(string url, string key) =>
        url[(url.IndexOf('?', StringComparison.Ordinal) + 1)..].Split('&').Select(p => p.Split('=', 2)).First(p => p[0] == key)[1] is var v ? Uri.UnescapeDataString(v) : "";

    [Test]
    public async Task Your_Spotify_library_comes_into_Mandarin_and_plays_on_its_own_Soloist()
    {
        var fake = new FakeSpotify();
        await using var srv = await FakeServer.Start(fake.Handle);
        fake.Base = srv.Base;
        await using var s = await Session.Started(env: new Dictionary<string, string> { ["SPOTIFY_API_URL"] = srv.Base + "/v1/", ["SPOTIFY_ACCOUNTS_URL"] = srv.Base + "/" });

        Assert.False((await s.Api("settings/spotify")).J["account"]!["connected"]!.GetValue<bool>());
        Assert.Null((await s.Api("library/cleanup")).J["spotify"]);   // Clean up says nothing of Spotify until it is used
        Assert.Equal(400, (await s.Api("settings/spotify/signin", new { client_id = "not an id" })).Status);

        // Signing in: Spotify's page with the PKCE challenge; the answer from another sign-in refused; this one taken.
        var begun = (await s.Api("settings/spotify/signin", new { client_id = ClientId })).J;
        var url = (string)begun["pending"]!["url"]!;
        Assert.StartsWith(srv.Base + "/authorize?response_type=code&client_id=" + ClientId, url);
        Assert.Equal("S256", QueryOf(url, "code_challenge_method"));
        Assert.Equal("http://127.0.0.1:43143/mandarin-spotify", QueryOf(url, "redirect_uri"));
        fake.Challenge = QueryOf(url, "code_challenge");
        var state = QueryOf(url, "state");
        Assert.Equal(400, (await s.Api("settings/spotify/signin/code", new { url = "http://127.0.0.1:43143/mandarin-spotify?code=AQ-good&state=another" })).Status);
        var signed = await s.Api("settings/spotify/signin/code", new { url = $"http://127.0.0.1:43143/mandarin-spotify?code=AQ-good&state={state}" });
        Assert.True(signed.Status == 200, signed.Text);
        Assert.True(signed.J["connected"]!.GetValue<bool>());
        Assert.Equal("Ann", (string?)signed.J["user"]!["name"]);
        Assert.DoesNotContain("acc", signed.Text);   // no token is ever sent back

        // The favourites in the library: the saved albums kept, the liked song's and the playlist's albums held.
        await s.Api("settings/spotify", new { import = true });
        await Session.Until(async () => (await s.Api("settings/spotify")).J["account"]!["last_import"] is JsonObject li && li["albums"] != null, 30000, "the import");
        foreach (var title in new[] { "First Light", "Second Wind" })
        {
            var al = await s.Album(title);
            Assert.True(al != null, title + " in the library");
            Assert.Equal("spotify", (string?)al!["source"]);
        }
        var second = (await s.Album("Second Wind"))!;
        var page = (await s.Api("album?offset=" + (int)second["offset"]!)).J;
        Assert.Equal(3, page["tracks"]!.AsArray().Count);   // its second page of tracks read too

        var counted = (await s.Api("library/cleanup")).J["spotify"]!;
        Assert.Equal((0, true), (counted["albums"]!.GetValue<int>(), counted["signed_in"]!.GetValue<bool>()));

        var lists = (await s.Api("user-playlists")).J["playlists"]!.AsArray();
        Assert.Contains(lists, p => (string?)p!["name"] == "Road");
        var road = (await s.Api("user-playlist?id=spotify-pl-pl1")).J;
        Assert.Single(road["tracks"]!.AsArray());   // the episode left out

        // The token refreshed each time with the refresh token Spotify sent last (it sends a new one each time).
        var used = fake.Refreshed.ToArray();
        Assert.True(used.Length >= 2, "refreshed: " + used.Length);
        Assert.Equal(Enumerable.Range(1, used.Length).Select(n => "ref" + n), used);

        // Played from Mandarin: started on Mandarin's Soloist ("Mandarin" among the devices), the album at the track asked for.
        var played = await s.Api("play-track", new { zone_or_output_id = "RINCON_LOUNGE", offset = (int)second["offset"]!, track_index = 1, kind = "play_now" });
        Assert.True(played.Status == 200, played.Text);
        Assert.True(fake.Plays.TryDequeue(out var play), "the Web API asked to play");
        Assert.Equal("/v1/me/player/play?device_id=dev-mandarin", play.Path);
        var body = JsonNode.Parse(play.Body)!;
        Assert.Equal("spotify:album:al2", (string?)body["context_uri"]);
        Assert.Equal("spotify:track:al2t2", (string?)body["offset"]!["uri"]);
        Assert.DoesNotContain(fake.Paths, p => p.Contains("/stream", StringComparison.Ordinal));

        // Signed out: the account let go, Soloist's settings kept; the albums off the walls.
        await s.Api("settings/spotify", new { device_name = "Lounge" });
        var gone = (await s.Api("settings/spotify/signout", new { })).J;
        Assert.False(gone["connected"]!.GetValue<bool>());
        Assert.Equal("Lounge", (string?)(await s.Api("settings/spotify")).J["device_name"]);
        Assert.Null(await s.Album("First Light"));
    }
}
