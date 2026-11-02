using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Whole-track upsampling played (bug list item 237): a renderer or a sound device of the server's set to Whole track
/// has a library track upsampled by a power of two planned so; the track is made ahead in the background, played
/// with the standard filter until it is, and from its own file once it is. Sonos rooms and phones have no Output, a
/// stream of Qobuz's or Tidal's comes as it comes, and anything else plays as before.
/// </summary>
public sealed class WholeTrackPlayTests
{
    private static JsonObject J(object o) => JsonNode.Parse(Http.Json(o))!.AsObject();

    private static async Task<JsonNode> Plans(JsonObject job) { job["fn"] = "plans"; return await Score.Run(job); }

    private static readonly int[] Rates = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000];

    [Test]
    public async Task Planned_whole_only_for_a_device_set_to_it_a_library_track_and_a_power_of_two()
    {
        Needs.Server();
        var cd = J(new { path = "/m/a.flac", codec = "FLAC", sampleRate = 44100, bitsPerSample = 16, channels = 2 });
        var qobuz = J(new { path = "qobuz://track/123", codec = "FLAC", sampleRate = 44100, bitsPerSample = 16, channels = 2 });
        object Dev(string mode, string? filter, int[]? rates = null) => filter == null
            ? new { name = "FiiO SR11", rates = rates ?? Rates, maxBits = 24, containers = new[] { "flac", "wav" }, mode }
            : new { name = "FiiO SR11", rates = rates ?? Rates, maxBits = 24, containers = new[] { "flac", "wav" }, mode, filter };
        var cases = new object[][]
        {
            [cd, Dev("x4", "whole")], [cd, Dev("x4", null)], [cd, Dev("original", "whole")], [qobuz, Dev("x4", "whole")],
            [cd, Dev("max", "whole")], [cd, Dev("max", "whole", [44100, 132300])],
        };
        var p = (await Plans(new JsonObject { ["whole"] = JsonNode.Parse(Http.Json(cases)) }))["whole"]!.AsArray();

        // ×4, set to Whole track: so planned, and said.
        Assert.Equal((176400.0, true), (p[0].Num("rate")!.Value, p[0].Bool("whole") ?? false));
        Assert.EndsWith("(whole track)", p[0].Str("reason"), StringComparison.Ordinal);
        // The standard filter (no setting), the file as it is, a Qobuz stream: as before.
        Assert.Equal((176400.0, (bool?)null), (p[1].Num("rate")!.Value, p[1].Bool("whole")));
        Assert.Null(p[2].Bool("whole"));
        Assert.Null(p[3].Bool("whole"));
        // ×16 above FLAC's rates: whole, and as WAV (item 238).
        Assert.Equal((705600.0, true, true), (p[4].Num("rate")!.Value, p[4].Bool("whole") ?? false, p[4].Bool("wav") ?? false));
        // ×3 isn't a size the transform takes: the standard filter.
        Assert.Equal((132300.0, (bool?)null), (p[5].Num("rate")!.Value, p[5].Bool("whole")));
    }

    [Test]
    public async Task A_whole_plan_has_its_own_cache_file()
    {
        Needs.Server();
        // [id, mtime, rate, bits, hq, exact, wav, whole]
        var r = await Plans(new JsonObject
        {
            ["held_keys"] = new JsonArray(new JsonArray(7, 5, 176400, 24, true, false, false, false), new JsonArray(7, 5, 176400, 24, true, false, false, true),
                new JsonArray(7, 5, 705600, 24, true, false, true, true)),
        });
        var keys = r["held_keys"]!.AsArray().Select(k => (string)k!).ToArray();
        Assert.Equal(keys[0] + "-w", keys[1]);
        Assert.EndsWith("-w-wav", keys[2], StringComparison.Ordinal);
    }

    [Test]
    public async Task A_device_set_to_whole_track_plays_the_standard_filter_until_the_whole_track_is_made_then_that()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var s = await Session.Started();
        await Session.Until(async () => (await s.Api("library-stats")).J.Num("albums") == 3, 30000, "the library");
        var song = s.Server.Rows("SELECT * FROM tracks WHERE title = $1", "Song 1")[0];
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        s.Server.Exec("INSERT INTO audio_devices(id, kind, network_name, first_seen, last_seen) VALUES($1, $2, $3, $4, $5)", "UPNP_test-whole", "upnp", "UPNP_test-whole", now, now);
        async Task<Http.Answer> Patch(object body) => await Http.Send(HttpMethod.Patch, s.Base + "/api/audio-devices/UPNP_test-whole",
            new StringContent(Http.Json(body), System.Text.Encoding.UTF8, "application/json"), s.H);

        // Set, and said back; a filter there isn't, refused.
        var set = await Patch(new { output = new { mode = "x2", filter = "whole" } });
        Assert.True(set.Status == 200, set.Text);
        Assert.Equal("whole", set.J["output"].Str("filter"));
        var bad = await Patch(new { output = new { filter = "sinc" } });
        Assert.Equal((400, "filter must be standard or whole"), (bad.Status, bad.J.Str("error")));

        // Asked for before it is made: the standard filter's file, and the whole one made in the background.
        var made = Path.Combine(s.Lib.Data, "transcode");
        var addr = $"/stream/t{song["id"]}.88200-24w.flac?o=UPNP_test-whole";
        var first = await Bytes.Get(s.Base + addr, s.H);
        Assert.Equal((200, "audio/flac"), (first.Status, first.Header("content-type")));
        string? whole = null;
        await Session.Until(() => Task.FromResult((whole = Directory.Exists(made) ? Directory.GetFiles(made, "*-w.flac").FirstOrDefault() : null) != null), 60000, "the whole track made");
        var file = await File.ReadAllBytesAsync(whole!);
        // Twice the frames at twice the rate: the track, upsampled whole.
        var source = await File.ReadAllBytesAsync((string)song["path"]!);
        Assert.Equal((88200L, 2 * Frames(source)), (Rate(file), Frames(file)));
        Assert.False(first.Body.AsSpan().SequenceEqual(file), "the first time, the standard filter's");
        // Asked for again: that file.
        var again = await Bytes.Get(s.Base + addr, s.H);
        Assert.Equal(200, again.Status);
        Assert.True(again.Body.AsSpan().SequenceEqual(file), "then the whole track's own file");
        // Without the mark (the standard filter asked for): not that file.
        var standard = await Bytes.Get(s.Base + $"/stream/t{song["id"]}.88200-24.flac?o=UPNP_test-whole", s.H);
        Assert.False(standard.Body.AsSpan().SequenceEqual(file), "the standard filter's is its own");
    }

    // A FLAC's STREAMINFO: its rate (20 bits from byte 18) and its frames (36 bits from byte 21's low half).
    private static long Rate(byte[] f) => (f[18] << 12) | (f[19] << 4) | (f[20] >> 4);

    private static long Frames(byte[] f) => ((long)(f[21] & 0x0F) << 32) | ((long)f[22] << 24) | ((long)f[23] << 16) | ((long)f[24] << 8) | f[25];
}
