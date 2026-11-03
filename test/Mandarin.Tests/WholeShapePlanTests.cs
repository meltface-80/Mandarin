using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The whole-track filter's shapes played (bug list item 248): a device set to Minimum phase or Gentle has a track
/// planned whole as Whole track has it, in that shape, and said so; PCM made DSD goes to 705.6 kHz in it too; the PCM
/// sent while a DSF is made is the standard filter's, no shape about it; each shape is a file of its own, a standard
/// conversion's name as it was; and a track asked for in a shape is made in it, a file that isn't the linear one's.
/// </summary>
public sealed class WholeShapePlanTests
{
    private static JsonObject J(object o) => JsonNode.Parse(Http.Json(o))!.AsObject();

    private static async Task<JsonNode> Plans(JsonObject job) { job["fn"] = "plans"; return await Score.Run(job); }

    private static object Dev(string filter, int? dsdOut = null) => new
    {
        name = "FiiO SR11", rates = new[] { 44100, 88200, 176400, 352800, 705600 }, maxBits = 24, containers = new[] { "flac", "wav", "dsd" },
        dsd = new[] { 64, 128, 256 }, dsdMimes = new { dsf = "audio/dsf", dff = (string?)null }, mode = "x2", filter, dsd_out = (object?)dsdOut ?? "off",
    };

    [Test]
    public async Task A_device_set_to_a_shape_is_planned_whole_in_it_and_says_so()
    {
        Needs.Server();
        var cd = J(new { path = "/m/a.flac", codec = "FLAC", sampleRate = 44100, bitsPerSample = 16, channels = 2 });
        var r = await Plans(new JsonObject
        {
            ["whole"] = JsonNode.Parse(Http.Json(new object[][] { [cd, Dev("whole")], [cd, Dev("minphase")], [cd, Dev("gentle")] })),
            ["dsd_up"] = JsonNode.Parse(Http.Json(new object[][] { [cd, Dev("minphase", 256)], [cd, Dev("whole", 256)] })),
        });
        var p = r["whole"]!.AsArray();
        Assert.Equal((true, (string?)null), (p[0].Bool("whole") ?? false, p[0].Str("shape")));
        Assert.Equal((true, "min"), (p[1].Bool("whole") ?? false, p[1].Str("shape")));
        Assert.Equal((true, "gentle"), (p[2].Bool("whole") ?? false, p[2].Str("shape")));
        Assert.EndsWith("(whole track)", p[0].Str("reason"), StringComparison.Ordinal);
        Assert.EndsWith("(minimum phase)", p[1].Str("reason"), StringComparison.Ordinal);
        Assert.EndsWith("(gentle filter)", p[2].Str("reason"), StringComparison.Ordinal);
        // Made DSD: the ×16 on the way in the device's shape; linear for Whole track.
        var d = r["dsd_up"]!.AsArray();
        Assert.Equal((256.0, "min"), (d[0].Num("dsdUp")!.Value, d[0].Str("shape")));
        Assert.Null(d[1].Str("shape"));
    }

    [Test]
    public async Task The_PCM_sent_while_a_DSF_is_made_has_no_shape_and_each_shape_is_a_file_of_its_own()
    {
        Needs.Server();
        // The stand-in for a DSF (item 246): the standard filter's, nothing of the whole track's shape left on it.
        var min = J(new { transcode = true, hq = true, mime = "audio/flac", ext = "flac", rate = 88200, bits = 24, upsampled = 2, whole = true, shape = "min", inRate = 44100, reason = "×2 (minimum phase)" });
        var w = (await Plans(new JsonObject { ["dsd_waiting"] = new JsonArray(new JsonArray(min, 256)) }))["dsd_waiting"]![0]!;
        Assert.Equal(((bool?)null, (string?)null, 256.0), (w.Bool("whole"), w.Str("shape"), w.Num("dsdMaking")!.Value));
        Assert.Equal("×2 (DSD256 being made)", w.Str("reason"));
        // [id, mtime, rate, bits, hq, exact, wav, whole, lowpass, dsdUp, shape]
        JsonArray Key(bool whole, int dsdUp, string? shape, bool wav = false) => new(7, 5, 88200, 24, true, false, wav, whole, 0, dsdUp, shape);
        var keys = (await Plans(new JsonObject
        {
            ["held_keys"] = new JsonArray(Key(true, 0, null), Key(true, 0, "min"), Key(true, 0, "gentle"), Key(false, 0, "min"), Key(false, 0, null),
                Key(false, 256, "min"), Key(true, 0, "min", wav: true)),
        }))["held_keys"]!.AsArray().Select(k => (string)k!).ToArray();
        Assert.Equal(keys[0] + "-min", keys[1]);
        Assert.Equal(keys[0] + "-gentle", keys[2]);
        // A standard conversion is named as it always was, whatever shape a plan carried.
        Assert.Equal(keys[4], keys[3]);
        // The shape before the endings a file's kind is read from: a DSF's and a WAV's stay theirs.
        Assert.EndsWith("-min-dsd256", keys[5], StringComparison.Ordinal);
        Assert.EndsWith("-w-min-wav", keys[6], StringComparison.Ordinal);
    }

    [Test]
    public async Task A_track_asked_for_in_a_shape_is_made_in_it()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var s = await Session.Started();
        await Session.Until(async () => (await s.Api("library-stats")).J.Num("albums") == 3, 30000, "the library");
        var song = s.Server.Rows("SELECT * FROM tracks WHERE title = $1", "Song 1")[0];
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        s.Server.Exec("INSERT INTO audio_devices(id, kind, network_name, first_seen, last_seen) VALUES($1, $2, $3, $4, $5)", "UPNP_test-shape", "upnp", "UPNP_test-shape", now, now);
        var set = await Http.Send(HttpMethod.Patch, s.Base + "/api/audio-devices/UPNP_test-shape",
            new StringContent(Http.Json(new { output = new { mode = "x2", filter = "minphase" } }), System.Text.Encoding.UTF8, "application/json"), s.H);
        Assert.Equal((200, "minphase"), (set.Status, set.J["output"].Str("filter")));
        // Asked for in minimum phase and as linear: each made, each its own file.
        var made = Path.Combine(s.Lib.Data, "transcode");
        foreach (var q in new[] { "&f=min", "" }) Assert.Equal(200, (await Bytes.Get(s.Base + $"/stream/t{song["id"]}.88200-24w.flac?o=UPNP_test-shape{q}", s.H)).Status);
        string? min = null, linear = null;
        await Session.Until(() =>
        {
            min = Directory.Exists(made) ? Directory.GetFiles(made, "*-w-min.flac").FirstOrDefault() : null;
            linear = Directory.Exists(made) ? Directory.GetFiles(made, "*-w.flac").FirstOrDefault() : null;
            return Task.FromResult(min != null && linear != null);
        }, 60000, "both made");
        var minBytes = await File.ReadAllBytesAsync(min!);
        var linearBytes = await File.ReadAllBytesAsync(linear!);
        Assert.False(minBytes.AsSpan().SequenceEqual(linearBytes), "minimum phase isn't the linear filter's");
        // The device's page says the shape and how the making goes.
        var dev = await s.Api("audio-devices/UPNP_test-shape");
        Assert.Equal("minphase", dev.J["output"].Str("filter"));
        Assert.True((dev.J["output"]?["whole"].Num("made") ?? 0) >= 2, "the made tracks counted");
    }
}
