using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// An MQA track planned for a room (bug list item 418, the server's Mqa/MqaPlan.cs, Playback/Items.cs PlanOf): to a
/// device with This DAC decodes MQA on, the file as it is, every step of Mandarin's own left out although the device
/// is set to upsample ×2 in a Gaussian filter, to make DSD256, to run its DSP, to dither at 20 bits, and the track has
/// a ReplayGain; repacked sample for sample where the device doesn't read FLAC; planned as ever where the device can't
/// take its rate. The same track to a room without the setting, and a track that isn't MQA to one with it, keep all of
/// their processing.
/// </summary>
public sealed class MqaPlanTests
{
    private static JsonObject J(object o) => JsonNode.Parse(Http.Json(o))!.AsObject();

    private static readonly int[] Rates = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000];

    private static JsonObject Device(bool mqaDac, string[]? containers = null, int[]? rates = null, int? dsdOut = null) => J(new
    {
        name = "MQA DAC", rates = rates ?? Rates, maxBits = 24, containers = containers ?? ["flac", "wav", "dsd"], dsd = new[] { 64, 128, 256 },
        dsdMimes = new { dsf = "audio/dsf", dff = (string?)null }, mode = "x2", bits = "auto", filter = "gaussian", dither = "ns5", real_bits = 20,
        dsd_out = (object?)dsdOut ?? "off", id = "uuid:mqa-dac", mqa_dac = mqaDac,
        dsp = JsonNode.Parse("""{ "enabled": true, "peq": { "bands": [{ "type": "peak", "freq": 1000, "gain": 6, "q": 1.41 }] }, "headroom": "auto" }"""),
    });

    private static readonly string[] Processing = ["gain", "dsp", "upsampled", "dsdUp", "dsd", "shape", "dither", "real_bits", "lowpass", "headroom", "wav"];

    [Test]
    public async Task To_an_MQA_DAC_an_MQA_track_skips_every_step_and_any_other_room_or_track_keeps_them()
    {
        Needs.Server();
        var row = J(new { id = 7, path = "/m/mqa.flac", codec = "flac", sample_rate = 44100, bits = 24, channels = 2, mtime = 5 });
        var p = (await Score.Run(new
        {
            fn = "mqa",
            items = new object?[][]
            {
                [row, Device(true), -6.5, true],                     // 0: MQA to an MQA DAC
                [row, Device(false), -6.5, true],                    // 1: MQA to a room without the setting
                [row, Device(true), -6.5, false],                    // 2: a track that isn't MQA to the MQA DAC
                [row, Device(true, dsdOut: 256), -6.5, true],        // 3: MQA to an MQA DAC set to make DSD256
                [row, Device(true, dsdOut: 256), -6.5, false],       // 4: and one that isn't
                [row, Device(true, containers: ["wav"]), -6.5, true],   // 5: a device that doesn't read FLAC
                [row, Device(true, rates: [48000, 96000]), -6.5, true], // 6: nor 44.1 kHz
            },
        }))["items"]!.AsArray();

        string Said(int i) => p[i]!.ToJsonString();
        // Untouched: the file itself, at its own rate and depth, nothing of Mandarin's on it.
        Assert.Equal((false, true, "MQA: sent untouched to the DAC", "flac"), (p[0].Bool("transcode") ?? true, p[0].Bool("mqa") ?? false, p[0].Str("reason"), p[0].Str("ext")));
        foreach (var k in Processing) Assert.True(p[0]![k] == null, $"{k} left out: {Said(0)}");
        Assert.True(p[3]!["dsdUp"] == null && p[3].Bool("mqa") == true && p[3].Bool("transcode") == false, "no DSD made of it either: " + Said(3));
        // Without the setting, or not MQA: upsampled in its filter, its DSP, its ReplayGain, as ever.
        foreach (var i in new[] { 1, 2 })
        {
            Assert.Equal((2.0, -6.5, "gauss"), (p[i].Num("upsampled") ?? 0, p[i].Num("gain") ?? 0, p[i].Str("shape")));
            Assert.True(p[i]!["dsp"] != null && p[i]!["mqa"] == null, Said(i));
        }
        Assert.Equal(256.0, p[4].Num("dsdUp") ?? 0);
        // Repacked sample for sample where FLAC isn't read: no dither, no gain, still untouched.
        Assert.Equal((true, true, true, 44100.0, 24.0), (p[5].Bool("transcode") ?? false, p[5].Bool("exact") ?? false, p[5].Bool("mqa") ?? false, p[5].Num("rate") ?? 0, p[5].Num("bits") ?? 0));
        foreach (var k in Processing) Assert.True(p[5]![k] == null, $"{k} left out of the repack: {Said(5)}");
        // A device that can't take its rate gets nothing untouched: planned as any track is.
        Assert.True(p[6]!["mqa"] == null && p[6]!["gain"] != null, Said(6));
    }
}
