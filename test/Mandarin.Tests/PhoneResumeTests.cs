using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The app installed over itself (v0.9.5, Phones.Hello): its player starts empty and says hello, and is
/// handed back the list it was last playing. Until v0.9.5 that was always the server's queue, even when
/// the phone had since played a list of its own; now the phone's own list comes back when the server
/// can name its tracks, and nothing does when it can't; across a server restart too
/// (test/phone-resume.test.js, in C#: its three steps, in order, in one test, as they build on each other).
/// </summary>
public sealed class PhoneResumeTests
{
    [Test]
    public async Task Hello_after_a_reinstall_the_list_the_phone_last_played_comes_back_not_the_servers_older_queue()
    {
        await using var s = await Session.Started();
        async Task<JsonNode> Call(string method, string p, object? body = null)
        {
            var r = body == null ? await Http.Send(new HttpMethod(method), s.Base + p, null, s.H) : await Http.Post(s.Base + p, body, s.H);
            var o = r.Json as JsonObject ?? [];
            o["status"] = r.Status;
            return o;
        }
        Task<JsonNode> Hello() => Call("POST", "/api/phone/hello", new { name = "Pixel 8" });
        var albums = (await s.Api("library/albums?sort=album")).J["albums"].Items().ToList();
        var (older, later) = (albums[0]!, albums[1]!);
        Assert.True(older.Num("offset") != later.Num("offset"), "two albums");
        var zoneId = (await Hello()).Str("zone_id")!;
        double seq = 0;
        // The album played on the phone through the server: the tracks it is handed.
        async Task<List<JsonNode>> Play(JsonNode a)
        {
            await Call("POST", "/api/play", new { offset = a.Num("offset"), zone_or_output_id = zoneId, kind = "play_now" });
            var got = await Call("GET", $"/api/phone/commands?after={seq}");
            seq = got.Num("seq") ?? seq;
            var load = got["commands"].Items().FirstOrDefault(c => c.Str("op") == "load");
            Assert.True(load != null, got["commands"]?.ToJsonString());
            return [.. load["items"].Items().Select(i => i!)];
        }
        static List<double?> Ids(IEnumerable<JsonNode?> items) => [.. items.Select(i => i.Num("track_id"))];

        var laterItems = await Play(later);
        Assert.True(laterItems.Count >= 2 && laterItems.All(i => i.Num("track_id") > 0), Http.Json(laterItems));
        // Earlier in the day: an album played through the server, which keeps it as the phone's queue.
        var olderItems = await Play(older);
        await Call("POST", "/api/phone/state", new { index = 0, position = 3, duration = 60, state = "playing", volume = 40 });
        // Then a list of the phone's own: the later album, downloaded, its tracks named by the server's ids.
        var own = laterItems.Select(i => new { title = i.Str("title"), artist = i.Str("artist"), album = i.Str("album"), duration = i.Num("duration"), ext = "flac", track_id = i.Num("track_id") }).ToArray();
        await Call("POST", "/api/phone/state", new { index = 1, position = 30, duration = 60, state = "paused", volume = 40, local = true, local_rev = 1, local_items = own });

        // The phone's own list, named by the server's ids, is handed back at its place.
        {
            var h = await Hello();
            var resume = h["resume"];
            Assert.True(resume != null, "a list handed back");
            Assert.True(Ids(resume["items"].Items()).SequenceEqual(Ids(laterItems)), "the later album, not the older one (" + string.Join(",", olderItems.Select(i => i.Str("title"))) + ")");
            Assert.Equal(1, resume.Num("index"));
            Assert.True(Math.Abs(resume.Num("seconds")!.Value - 30) < 2, resume.Num("seconds")?.ToString());
            Assert.False(resume.Bool("play"));
            seq = h.Num("seq") ?? seq;
            // The zone shows that list until the app reports, and its queue is that list.
            var st = await Call("GET", "/api/zone-state?zone=" + zoneId);
            Assert.Equal("paused", st["zone"].Str("state"));
            Assert.Equal(laterItems[1].Str("title"), st["zone"]?["now_playing"].Str("line1"));
            var q = await Call("GET", "/api/queue?zone=" + zoneId);
            Assert.Equal(laterItems.Skip(1).Select(i => i.Str("title")), q["items"].Items().Select(i => i.Str("title")));
            // The app loads it and reports from it as the server's queue.
            await Call("POST", "/api/phone/state", new { index = 1, position = 31, duration = 60, state = "paused", volume = 40 });
            Assert.Equal(laterItems[1].Str("title"), (await Call("GET", "/api/zone-state?zone=" + zoneId))["zone"]?["now_playing"].Str("line1"));
        }

        // A list the server can't name (the phone's own music): nothing is handed back.
        {
            await Play(older);
            await Call("POST", "/api/phone/state", new { index = 0, position = 3, duration = 60, state = "playing", volume = 40 });
            var music = new[]
            {
                new { title = "Opening", artist = "Someone", album = "A Purchase", image_key = "phone-abc123", album_key = "abc123", duration = 200, ext = "flac" },
                new { title = "Closing", artist = "Someone", album = "A Purchase", image_key = "phone-abc123", album_key = "abc123", duration = 180, ext = "flac" }
            };
            await Call("POST", "/api/phone/state", new { index = 1, position = 12, duration = 180, state = "playing", volume = 40, local = true, local_rev = 2, local_items = music });
            var h = await Hello();
            Assert.True(h["resume"] == null, "not the older album: " + h["resume"]?.ToJsonString());
            seq = h.Num("seq") ?? seq;
            var st = await Call("GET", "/api/zone-state?zone=" + zoneId);
            Assert.NotEqual(older.Str("title"), st["zone"]?["now_playing"].Str("line3"));
        }

        // The server restarted while the phone played its own list: that list is what it keeps.
        {
            await Play(older);
            await Call("POST", "/api/phone/state", new { index = 0, position = 3, duration = 60, state = "playing", volume = 40 });
            await Call("POST", "/api/phone/state", new { index = 1, position = 20, duration = 60, state = "playing", volume = 40, local = true, local_rev = 3, local_items = own });
            // The store writes after a moment: what it kept, before the server goes.
            await Session.Until(() => Task.FromResult(s.Server.Setting("queue:" + zoneId) is { } k && k.Num("index") == 1 && k.Str("state") == "playing"), 15000, "the store to keep the phone's list");
            await s.Server.Stop();
            await s.Server.Start();
            await Session.Until(async () => (await Call("GET", "/api/status")).Num("status") == 200, 30000, "the server back");
            var h = await Hello();
            var resume = h["resume"];
            Assert.True(resume != null, "a list handed back");
            Assert.True(Ids(resume["items"].Items()).SequenceEqual(Ids(laterItems)), "the phone's list, not the older album");
            Assert.Equal(1, resume.Num("index"));
        }
    }
}
