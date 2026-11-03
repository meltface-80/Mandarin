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
        // With the track's own rate, which the job divides by: a queue's plan carried none (item 244).
        Assert.Equal(44100.0, p[0].Num("inRate"));
        Assert.Equal(44100.0, p[4].Num("inRate"));
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
        // One play keeps one file (item 239): a track sent with the standard filter keeps it until it has gone
        // unasked for this long (half an hour unless said).
        const int hold = 3000;
        await using var s = await Session.Started(env: new Dictionary<string, string> { ["MANDARIN_WHOLE_HOLD_MS"] = hold.ToString(System.Globalization.CultureInfo.InvariantCulture) });
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
        // Read again and again as a renderer reads (a range, a seek) while the whole one is made: the same file each time.
        string? whole = null;
        int reads = 0, others = 0;
        await Session.Until(async () =>
        {
            whole = Directory.Exists(made) ? Directory.GetFiles(made, "*-w.flac").FirstOrDefault() : null;
            var read = await Bytes.Get(s.Base + addr, s.H);
            reads++;
            if (!read.Body.AsSpan().SequenceEqual(first.Body)) others++;
            return whole != null;
        }, 60000, "the whole track made");
        Assert.True(others == 0, $"one play, one file: {others} of {reads} reads while it was made weren't the standard filter's");
        var file = await File.ReadAllBytesAsync(whole!);
        // Twice the frames at twice the rate: the track, upsampled whole.
        var source = await File.ReadAllBytesAsync((string)song["path"]!);
        Assert.Equal((88200L, 2 * Frames(source)), (Rate(file), Frames(file)));
        Assert.False(first.Body.AsSpan().SequenceEqual(file), "the first time, the standard filter's");
        // Made, but this play started on the standard filter's: it keeps it.
        var held = await Bytes.Get(s.Base + addr, s.H);
        Assert.True(held.Body.AsSpan().SequenceEqual(first.Body), "made while it played: the play keeps its file");
        // The device's page says how the making went.
        var dev = await s.Api("audio-devices/UPNP_test-whole");
        Assert.Equal((1.0, (string?)null, 0.0), (dev.J["output"]?["whole"].Num("made") ?? -1, dev.J["output"]?["whole"].Str("making"), dev.J["output"]?["whole"].Num("waiting") ?? -1));
        // Played again once that play is over: its own file.
        await Task.Delay(hold + 500);
        var again = await Bytes.Get(s.Base + addr, s.H);
        Assert.Equal(200, again.Status);
        Assert.True(again.Body.AsSpan().SequenceEqual(file), "then the whole track's own file");
        // Without the mark (the standard filter asked for): not that file.
        var standard = await Bytes.Get(s.Base + $"/stream/t{song["id"]}.88200-24.flac?o=UPNP_test-whole", s.H);
        Assert.False(standard.Body.AsSpan().SequenceEqual(file), "the standard filter's is its own");
    }

    [Test]
    public async Task Now_playing_says_whether_the_whole_track_went_out_and_if_not_why()
    {
        Needs.Server();
        // [sent: true | false | null, the making: queued | making | failed | null]
        var r = (await Plans(new JsonObject
        {
            ["whole_badge"] = new JsonArray(new JsonArray(true, null), new JsonArray(false, "making"), new JsonArray(null, "queued"),
                new JsonArray(false, "failed"), new JsonArray(false, null)),
        }))["whole_badge"]!.AsArray().Select(x => (string)x!).ToArray();
        Assert.Equal([" · whole track", " · standard (whole track being made)", " · standard (whole track being made)",
            " · standard (whole track failed: see the log)", " · standard (whole track next play)"], r);
    }

    // A FLAC's STREAMINFO: its rate (20 bits from byte 18) and its frames (36 bits from byte 21's low half).
    private static long Rate(byte[] f) => (f[18] << 12) | (f[19] << 4) | (f[20] >> 4);

    private static long Frames(byte[] f) => ((long)(f[21] & 0x0F) << 32) | ((long)f[22] << 24) | ((long)f[23] << 16) | ((long)f[24] << 8) | f[25];
}
