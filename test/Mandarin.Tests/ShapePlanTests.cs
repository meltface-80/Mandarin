using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The upsampling filter's shapes played (bug list items 248, 259): a device set to Minimum phase or Gentle has a track
/// upsampled by a power of two planned in that shape, and said so; PCM made DSD goes to 705.6 kHz in it too; a device
/// left at Whole track (scrapped) has the standard filter, and Whole track is no longer taken; each shape is a file of
/// its own, a standard conversion's name as it was; and a track asked for in a shape is made in it as it plays.
/// </summary>
public sealed class ShapePlanTests
{
    private static JsonObject J(object o) => JsonNode.Parse(Http.Json(o))!.AsObject();

    private static async Task<JsonNode> Plans(JsonObject job) { job["fn"] = "plans"; return await Score.Run(job); }

    private static object Dev(string filter, int? dsdOut = null) => new
    {
        name = "FiiO SR11", rates = new[] { 44100, 88200, 176400, 352800, 705600 }, maxBits = 24, containers = new[] { "flac", "wav", "dsd" },
        dsd = new[] { 64, 128, 256 }, dsdMimes = new { dsf = "audio/dsf", dff = (string?)null }, mode = "x2", filter, dsd_out = (object?)dsdOut ?? "off",
    };

    [Test]
    public async Task A_device_set_to_a_shape_is_planned_in_it_and_says_so()
    {
        Needs.Server();
        var cd = J(new { path = "/m/a.flac", codec = "FLAC", sampleRate = 44100, bitsPerSample = 16, channels = 2 });
        var r = await Plans(new JsonObject
        {
            ["shaped"] = JsonNode.Parse(Http.Json(new object[][] { [cd, Dev("standard")], [cd, Dev("minphase")], [cd, Dev("gentle")], [cd, Dev("whole")] })),
            ["dsd_up"] = JsonNode.Parse(Http.Json(new object[][] { [cd, Dev("minphase", 256)], [cd, Dev("standard", 256)] })),
        });
        var p = r["shaped"]!.AsArray();
        Assert.Null(p[0].Str("shape"));
        Assert.Equal(("min", 44100.0), (p[1].Str("shape"), p[1].Num("inRate")!.Value));
        Assert.Equal("gentle", p[2].Str("shape"));
        Assert.EndsWith("(minimum phase)", p[1].Str("reason"), StringComparison.Ordinal);
        Assert.EndsWith("(gentle filter)", p[2].Str("reason"), StringComparison.Ordinal);
        // A device left at Whole track: the standard filter, nothing made ahead.
        Assert.Equal(((string?)null, (bool?)null), (p[3].Str("shape"), p[3].Bool("whole")));
        // Made DSD: the ×16 on the way in the device's shape; the standard one's has none.
        var d = r["dsd_up"]!.AsArray();
        Assert.Equal((256.0, "min"), (d[0].Num("dsdUp")!.Value, d[0].Str("shape")));
        Assert.EndsWith("made as it plays", d[0].Str("reason"), StringComparison.Ordinal);
        Assert.Null(d[1].Str("shape"));
    }

    private static readonly int[] Rates = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000];

    [Test]
    public async Task Shaped_only_for_a_library_track_upsampled_by_a_power_of_two()
    {
        Needs.Server();
        var cd = J(new { path = "/m/a.flac", codec = "FLAC", sampleRate = 44100, bitsPerSample = 16, channels = 2 });
        var qobuz = J(new { path = "qobuz://track/123", codec = "FLAC", sampleRate = 44100, bitsPerSample = 16, channels = 2 });
        object Dev(string mode, int[]? rates = null) => new { name = "FiiO SR11", rates = rates ?? Rates, maxBits = 24, containers = new[] { "flac", "wav" }, mode, filter = "minphase" };
        var cases = new object[][] { [cd, Dev("x4")], [cd, Dev("original")], [qobuz, Dev("x4")], [cd, Dev("max")], [cd, Dev("max", [44100, 132300])] };
        var p = (await Plans(new JsonObject { ["shaped"] = JsonNode.Parse(Http.Json(cases)) }))["shaped"]!.AsArray();
        // ×4: in its shape, with the track's own rate, which the job divides by (a queue's plan carried none, item 244).
        Assert.Equal((176400.0, "min", 44100.0), (p[0].Num("rate")!.Value, p[0].Str("shape"), p[0].Num("inRate")!.Value));
        // The file as it is, a Qobuz stream: the standard filter, as they come.
        Assert.Null(p[1].Str("shape"));
        Assert.Null(p[2].Str("shape"));
        // ×16 above FLAC's rates: in its shape, and as WAV (item 238).
        Assert.Equal((705600.0, "min", true), (p[3].Num("rate")!.Value, p[3].Str("shape"), p[3].Bool("wav") ?? false));
        // ×3 isn't a factor the filter takes: the standard one.
        Assert.Equal((132300.0, (string?)null), (p[4].Num("rate")!.Value, p[4].Str("shape")));
    }

    [Test]
    public async Task Each_shape_is_a_file_of_its_own_and_the_standard_filters_name_is_as_it_was()
    {
        Needs.Server();
        // [id, mtime, rate, bits, hq, exact, wav, (whole, gone), lowpass, dsdUp, shape]
        JsonArray Key(int dsdUp, string? shape, bool wav = false) => new(7, 5, 88200, 24, true, false, wav, false, 0, dsdUp, shape);
        var keys = (await Plans(new JsonObject
        {
            ["held_keys"] = new JsonArray(Key(0, null), Key(0, "min"), Key(0, "gentle"), Key(256, "min"), Key(0, "min", wav: true)),
        }))["held_keys"]!.AsArray().Select(k => (string)k!).ToArray();
        Assert.Equal("7-5-88200-24-hq", keys[0]);
        // "j": made joined to the album's neighbours (item 262), not mixed with those made before.
        Assert.Equal(keys[0] + "-minj", keys[1]);
        Assert.Equal(keys[0] + "-gentlej", keys[2]);
        // The shape before the endings a file's kind is read from: a DSF's and a WAV's stay theirs.
        Assert.EndsWith("-minj-dsd256j", keys[3], StringComparison.Ordinal);
        Assert.EndsWith("-minjh-wav", keys[4], StringComparison.Ordinal);   // "h": its length in its header (item 270)
    }

    [Test]
    public async Task A_track_asked_for_in_a_shape_is_made_in_it_as_it_plays()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var s = await Session.Started();
        await Session.Until(async () => (await s.Api("library-stats")).J.Num("albums") == 3, 30000, "the library");
        var song = s.Server.Rows("SELECT * FROM tracks WHERE title = $1", "Song 1")[0];
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        s.Server.Exec("INSERT INTO audio_devices(id, kind, network_name, first_seen, last_seen) VALUES($1, $2, $3, $4, $5)", "UPNP_test-shape", "upnp", "UPNP_test-shape", now, now);
        Task<Http.Answer> Patch(object output) => Http.Send(HttpMethod.Patch, s.Base + "/api/audio-devices/UPNP_test-shape",
            new StringContent(Http.Json(new { output }), System.Text.Encoding.UTF8, "application/json"), s.H);
        // Whole track is gone: refused.
        Assert.Equal(400, (await Patch(new { filter = "whole" })).Status);
        var set = await Patch(new { mode = "x2", filter = "minphase" });
        // "minphase" is the standard filter in Phase minimum (item 318).
        Assert.Equal((200, (string?)null, "minimum"), (set.Status, set.J["output"].Str("filter"), set.J["output"].Str("phase")));
        Assert.StartsWith("Made as it plays", set.J["output"].Str("making"), StringComparison.Ordinal);
        // Asked for in minimum phase and with the standard filter: each sent whole, each its own file.
        var made = Path.Combine(s.Lib.Data, "transcode");
        var min = await Bytes.Get(s.Base + $"/stream/t{song["id"]}.88200-24.flac?o=UPNP_test-shape&f=min", s.H);
        var standard = await Bytes.Get(s.Base + $"/stream/t{song["id"]}.88200-24.flac?o=UPNP_test-shape", s.H);
        Assert.Equal((200, 200), (min.Status, standard.Status));
        Assert.False(min.Body.AsSpan().SequenceEqual(standard.Body), "minimum phase isn't the standard filter's");
        string? file = null;
        await Session.Until(() => Task.FromResult((file = Directory.Exists(made) ? Directory.GetFiles(made, "*-minj.flac").FirstOrDefault() : null) != null), 30000, "its file kept");
        // What was sent is the file kept, every byte but those ffmpeg writes into the FLAC's STREAMINFO once it has
        // made the whole (its frames' least and most sizes, its samples, its MD5: bytes 12 to 17 and 20 to 41), which
        // a FLAC sent as it is made has yet to have, and has where it was made first (in one run in six or so).
        var kept = await File.ReadAllBytesAsync(file!);
        Assert.Equal(kept.Length, min.Body.Length);
        Assert.True(kept.AsSpan(0, 12).SequenceEqual(min.Body.AsSpan(0, 12)) && kept.AsSpan(18, 2).SequenceEqual(min.Body.AsSpan(18, 2)), "the same FLAC: its block sizes, its rate");
        Assert.True(kept.AsSpan(42).SequenceEqual(min.Body.AsSpan(42)), "what was sent is the file kept");
        // How fast it was made, said under the filter.
        var dev = await s.Api("audio-devices/UPNP_test-shape");
        Assert.Matches(@"^Made as it plays: this server made the last at [\d.]+× real time", dev.J["output"].Str("making"));
    }
}
