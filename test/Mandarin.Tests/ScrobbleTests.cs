using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// Scrobbling to Last.fm (Extras/LastfmAccount.cs, Playback/Scrobbles.cs): the shared secret saved and checked; Connect
/// gives Last.fm's page to approve on, and the sign-in finishes once the owner has; a track starting is Last.fm's now
/// playing, and a play is scrobbled at Last.fm's own point (over 30 s, half way or four minutes), stamped when it
/// started, never at Mandarin's own 30 s; plays made while Last.fm is down are kept and go when it is back, a phone's
/// offline plays with them, stamped when played; Last.fm refusing the session leaves Mandarin disconnected. Every call
/// is signed with the secret (Last.fm's api_sig), checked here. Last.fm stood in for; the phone is this signed-in app.
/// </summary>
public sealed class ScrobbleTests
{
    private const string Secret = "s3cret";

    /* Last.fm as the tests have it: each call kept (its method and parameters), its signature checked. */
    private sealed class FakeLastfm
    {
        public readonly ConcurrentQueue<Dictionary<string, string>> Calls = new();
        public volatile int SessionAsks, ScrobbleError;
        public volatile bool BadSignature;

        public async Task Handle(HttpContext ctx)
        {
            var ps = ctx.Request.Query.ToDictionary(q => q.Key, q => q.Value.ToString());
            if (ctx.Request.HasFormContentType) foreach (var f in await ctx.Request.ReadFormAsync()) ps[f.Key] = f.Value.ToString();
            Calls.Enqueue(ps);
            var method = ps.GetValueOrDefault("method") ?? "";
            if (method is "artist.getSimilar" or "artist.getTopAlbums") { await Json(ctx, """{ "error": 6, "message": "not here" }"""); return; }
            var sig = string.Concat(ps.Where(p => p.Key is not ("format" or "api_sig")).OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => p.Key + p.Value)) + Secret;
            if (BadSignature || ps.GetValueOrDefault("api_sig") != Convert.ToHexStringLower(MD5.HashData(Encoding.UTF8.GetBytes(sig))))
            {
                await Json(ctx, """{ "error": 13, "message": "Invalid method signature supplied" }""");
                return;
            }
            switch (method)
            {
                case "auth.getToken": await Json(ctx, """{ "token": "tok1" }"""); break;
                // Not approved on the first ask, approved after.
                case "auth.getSession":
                    await Json(ctx, Interlocked.Increment(ref SessionAsks) == 1 ? """{ "error": 14, "message": "Unauthorized Token" }"""
                        : """{ "session": { "name": "meltface", "key": "sk1", "subscriber": 0 } }""");
                    break;
                case "track.updateNowPlaying": await Json(ctx, """{ "nowplaying": {} }"""); break;
                case "track.scrobble":
                    if (ScrobbleError != 0) await Json(ctx, $$"""{ "error": {{ScrobbleError}}, "message": "no" }""");
                    else await Json(ctx, """{ "scrobbles": { "@attr": { "accepted": 1, "ignored": 0 } } }""");
                    break;
                default: await Json(ctx, """{ "error": 3, "message": "Invalid Method" }"""); break;
            }
        }

        public List<Dictionary<string, string>> Of(string method) => [.. Calls.Where(c => c.GetValueOrDefault("method") == method)];
    }

    private static Task Json(HttpContext ctx, string body)
    {
        ctx.Response.ContentType = "application/json";
        return ctx.Response.WriteAsync(body);
    }

    /* Signed in to Last.fm through Settings, as the owner would. */
    private static async Task Connected(Session s, FakeLastfm fm)
    {
        var secret = (await s.Api("settings/lastfm-secret", new { secret = Secret })).J;
        Assert.Equal("ok", secret.Str("check"));
        Assert.Equal("••••cret", secret.Str("masked"));
        var url = (await s.Api("lastfm/connect", new { })).J.Str("url");
        Assert.Equal("https://www.last.fm/api/auth/?api_key=k&token=tok1", url);
        var waiting = (await s.Api("lastfm/scrobbling")).J;
        Assert.True(waiting.Bool("pending"), "the owner hasn't approved yet");
        Assert.False(waiting.Bool("connected"));
        await Session.Until(async () => (await s.Api("lastfm/scrobbling")).J.Bool("connected") == true, 10000, "approved on Last.fm");
        Assert.Equal("meltface", (await s.Api("lastfm/scrobbling")).J.Str("name"));
        Assert.Equal("tok1", fm.Of("auth.getSession").Last()["token"]);
    }

    [Test]
    public async Task Connected_a_track_is_now_playing_and_scrobbled_at_Last_fm_s_point_stamped_when_it_started()
    {
        Needs.Server(); Needs.Ffmpeg();
        var fm = new FakeLastfm();
        await using var fake = await FakeServer.Start(fm.Handle);
        await using var s = await Session.Started(new Dictionary<string, object?> { ["lastfmBaseUrl"] = fake.Base, ["lastfmKey"] = "k" });
        var before = (await s.Api("lastfm/scrobbling")).J;
        Assert.True(before.Bool("key_set"));
        Assert.False(before.Bool("secret_set"));
        Assert.False(before.Bool("connected"));
        Assert.Equal(400, (await s.Api("lastfm/connect", new { })).Status);   // no secret yet
        await Connected(s, fm);

        var cd = (await s.Album("Album One"))!;
        var zoneId = (await s.Api("phone/hello", new { name = "Pixel 8" })).J.Str("zone_id");
        Assert.Equal(200, (await s.Api("play", new { offset = cd.Num("offset"), zone_or_output_id = zoneId, kind = "play_now" })).Status);
        async Task Say(int index, double position, double duration) =>
            await s.Api("phone/state", new { index, position, duration, state = "playing", volume = 40 });

        // A track starts: Last.fm's now playing, the library's names, the session's key.
        await Say(0, 2, 60);
        await Session.Until(() => Task.FromResult(fm.Of("track.updateNowPlaying").Count == 1), 10000, "now playing");
        var now = fm.Of("track.updateNowPlaying")[0];
        Assert.Equal(("Artist A", "Song 1", "Album One", "sk1"), (now["artist"], now["track"], now["album"], now["sk"]));
        Assert.False(now.ContainsKey("timestamp"));

        // Half way through a 60 s track: scrobbled, stamped when it started (31 s ago).
        var at = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        await Say(0, 31, 60);
        await Session.Until(() => Task.FromResult(fm.Of("track.scrobble").Count == 1), 10000, "scrobbled");
        var sc = fm.Of("track.scrobble")[0];
        Assert.Equal(("Artist A", "Song 1", "Album One", "sk1", "60"), (sc["artist[0]"], sc["track[0]"], sc["album[0]"], sc["sk"], sc["duration[0]"]));
        Assert.InRange(long.Parse(sc["timestamp[0]"], System.Globalization.CultureInfo.InvariantCulture), at - 34, at - 28);

        // A long track: Mandarin's play at 30 s, Last.fm's not until four minutes (half of 600 s is more).
        await Say(1, 2, 600);
        await Say(1, 120, 600);
        await Session.Until(() => Task.FromResult(Convert.ToInt64(s.Server.Scalar("SELECT COUNT(*) FROM plays"), System.Globalization.CultureInfo.InvariantCulture) == 2), 10000, "Mandarin's play");
        await Task.Delay(500);
        Assert.Single(fm.Of("track.scrobble"));
        await Say(1, 241, 600);
        await Session.Until(() => Task.FromResult(fm.Of("track.scrobble").Count == 2), 10000, "four minutes in");
        Assert.Equal("Song 2", fm.Of("track.scrobble")[1]["track[0]"]);
        // A track of 30 s or less is never scrobbled.
        await Say(2, 2, 30);
        await Say(2, 29, 30);
        await Task.Delay(500);
        Assert.Equal(2, fm.Of("track.scrobble").Count);

        // Disconnected: nothing more goes.
        Assert.False((await s.Api("lastfm/disconnect", new { })).J.Bool("connected"));
        await Say(0, 2, 60);
        await Say(0, 40, 60);
        await Task.Delay(800);
        Assert.Equal(2, fm.Of("track.scrobble").Count);
        Assert.Equal(0.0, (await s.Api("lastfm/scrobbling")).J.Num("queued"));
    }

    [Test]
    public async Task Plays_kept_while_Last_fm_is_down_go_with_the_phone_s_offline_ones_and_a_refused_session_disconnects()
    {
        Needs.Server(); Needs.Ffmpeg();
        var fm = new FakeLastfm();
        await using var fake = await FakeServer.Start(fm.Handle);
        await using var s = await Session.Started(new Dictionary<string, object?> { ["lastfmBaseUrl"] = fake.Base, ["lastfmKey"] = "k" });
        // A wrong secret is said so.
        fm.BadSignature = true;
        Assert.Equal("invalid", (await s.Api("settings/lastfm-secret", new { secret = "wrong" })).J.Str("check"));
        fm.BadSignature = false;
        await Connected(s, fm);

        var cd = (await s.Album("Album One"))!;
        var zoneId = (await s.Api("phone/hello", new { name = "Pixel 8" })).J.Str("zone_id");
        Assert.Equal(200, (await s.Api("play", new { offset = cd.Num("offset"), zone_or_output_id = zoneId, kind = "play_now" })).Status);

        // Last.fm down (error 16): the play kept.
        fm.ScrobbleError = 16;
        await s.Api("phone/state", new { index = 0, position = 2, duration = 60, state = "playing", volume = 40 });
        await s.Api("phone/state", new { index = 0, position = 31, duration = 60, state = "playing", volume = 40 });
        await Session.Until(async () => (await s.Api("lastfm/scrobbling")).J.Str("error") == "no", 10000, "Last.fm's failure said");
        Assert.Equal(1.0, (await s.Api("lastfm/scrobbling")).J.Num("queued"));

        // Back: the phone's offline play (a day ago) sends both, oldest first, in one call.
        fm.ScrobbleError = 0;
        var tracks = (await s.Api("album?offset=" + cd.Num("offset"))).J["tracks"]!.AsArray();
        var dayAgo = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 86400000;
        Assert.Equal(1.0, (await s.Api("phone/plays", new { plays = new[] { new { track_id = tracks[1]!.Num("track_id"), ts = dayAgo } } })).J.Num("recorded"));
        await Session.Until(async () => (await s.Api("lastfm/scrobbling")).J.Num("queued") == 0, 10000, "sent");
        var batch = fm.Of("track.scrobble").Last();
        Assert.Equal(("Song 2", "Song 1"), (batch["track[0]"], batch["track[1]"]));
        Assert.Equal((dayAgo / 1000).ToString(System.Globalization.CultureInfo.InvariantCulture), batch["timestamp[0]"]);
        Assert.Null((await s.Api("lastfm/scrobbling")).J.Str("error"));

        // Last.fm refusing the session (error 9): disconnected, the play kept, the owner asked to connect again.
        fm.ScrobbleError = 9;
        await s.Api("phone/state", new { index = 1, position = 2, duration = 60, state = "playing", volume = 40 });
        await s.Api("phone/state", new { index = 1, position = 31, duration = 60, state = "playing", volume = 40 });
        await Session.Until(async () => (await s.Api("lastfm/scrobbling")).J.Bool("connected") == false, 10000, "refused");
        var after = (await s.Api("lastfm/scrobbling")).J;
        Assert.Contains("connect again", after.Str("error"));
        Assert.Equal(1.0, after.Num("queued"));
    }

    private const string Look = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          const shown = e => !!e && e.getClientRects().length > 0;
          const $ = id => document.getElementById(id);
          await until(() => document.querySelector("#home-view .album"));
          $("settings-toggle").click();
          for (const pane of ["setup", "metadata"]) {
            await until(() => [...document.querySelectorAll('#settings-overlay .settings-nav-item[data-pane="' + pane + '"]')].some(shown));
            [...document.querySelectorAll('#settings-overlay .settings-nav-item[data-pane="' + pane + '"]')].find(shown).click();
          }
          const btn = $("lastfm-scrobble-btn"), line = $("lastfm-scrobble-status");
          await until(() => shown(btn) && line.textContent);
          const out = { before: [line.textContent, btn.textContent, btn.disabled] };
          // The secret saved here: Connect can be asked.
          $("lastfm-secret-input").value = "s3cret";
          $("lastfm-secret-save").click();
          await until(() => !btn.disabled);
          out.ready = [line.textContent, btn.textContent];
          // Connect: Last.fm's page opened beside this one, the block waiting; then connected once allowed there.
          const opened = [];
          window.open = () => ({ close() {}, location: { set href(u) { opened.push(u); } } });
          btn.click();
          await until(() => opened.length && /Allow Mandarin/.test(line.textContent));
          out.waiting = line.textContent;
          out.opened = opened[0];
          await until(() => btn.textContent === "Disconnect");
          out.connected = line.textContent;
          btn.click();
          await until(() => btn.textContent === "Connect to Last.fm");
          out.after = line.textContent;
          return out;
        })()
        """;

    [Test]
    public async Task The_page_s_Scrobbling_block_connects_and_disconnects()
    {
        Needs.Server(); Needs.Ffmpeg();
        var fm = new FakeLastfm();
        await using var fake = await FakeServer.Start(fm.Handle);
        await using var s = await Session.Started(new Dictionary<string, object?> { ["lastfmBaseUrl"] = fake.Base, ["lastfmKey"] = "k" });
        await using var b = await Browser.Launch(390, 844);
        var page = await b.Page(s.Base + "/", [new { name = "musicd_session", value = s.Token, url = s.Base }], touch: true);
        var r = (await page.Eval(Look))!;
        Assert.Equal(["Save the Last.fm key and shared secret above, then connect.", "Connect to Last.fm", "true"], r["before"]!.AsArray().Select(x => x!.ToString()).Select(x => x == "True" ? "true" : x));
        Assert.Equal(["Not connected.", "Connect to Last.fm"], r["ready"]!.AsArray().Select(x => (string?)x));
        Assert.Equal("https://www.last.fm/api/auth/?api_key=k&token=tok1", (string?)r["opened"]);
        Assert.Equal("Allow Mandarin on Last.fm, then come back here.", (string?)r["waiting"]);
        Assert.Equal("Scrobbling as meltface: every room, Bridge and this phone.", (string?)r["connected"]);
        Assert.Equal("Not connected.", (string?)r["after"]);
        Assert.Empty(page.Errors);
    }
}
