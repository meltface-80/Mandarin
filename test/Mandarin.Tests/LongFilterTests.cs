using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The long filters (bug list item 317, Upsample/StreamUpsample.cs): Standard's design made 8 and 32 times as long.
/// Long is flat to 21.8 kHz for a CD and 260 dB and more down from 22.1 kHz; Very long flat to 21.9 kHz and 280 dB
/// down; the standard filter, for comparison, is flat to 21 kHz and 113 dB down at 22.1 kHz. Their ringing, either
/// side of a click, is 28 and 47 ms where Standard's is 8. And they run as fast as the standard filter, a block at a time.
/// </summary>
public sealed class LongFilterTests
{
    private static async Task<JsonNode> Run(object job) => await Score.Run(job);

    private static async Task<(double[] Gains, double PreMs, double Length)> Taps(string? shape, params int[] at)
    {
        var r = await Run(new { fn = "upsample", taps = true, rate = 44100, factor = 16, shape, at });
        return (r["gains_db"]!.AsArray().Select(g => (double)g!).ToArray(), r.Num("pre_ms")!.Value, r.Num("length")!.Value);
    }

    [Test]
    public async Task Long_is_flat_to_21_8_kHz_and_more_than_260_dB_down_from_22_1_kHz()
    {
        var (g, pre, length) = await Taps("long", 1000, 20000, 21800, 22100, 22500, 24100);
        var (s, standardPre, _) = await Taps(null, 21800, 22100);
        Assert.Equal(16384.0 * 16 + 1, length);
        foreach (var x in g[..3]) Assert.True(Math.Abs(x) < 0.001, $"the band through 21.8 kHz: {x} dB");
        foreach (var x in g[3..]) Assert.True(x < -260, $"from 22.1 kHz: {x} dB");
        Assert.True(s[0] < -15 && s[1] > -120, $"the standard filter at 21.8 and 22.1 kHz: {s[0]}, {s[1]} dB");
        Assert.True(pre > 25 && pre < 31, $"its ringing before a click: {pre} ms (Standard's {standardPre})");
    }

    [Test]
    public async Task Very_long_is_a_million_taps_flat_to_21_9_kHz_and_more_than_280_dB_down_from_22_1_kHz()
    {
        var (g, pre, length) = await Taps("vlong", 1000, 20000, 21900, 22100, 22500);
        Assert.Equal(65536.0 * 16 + 1, length);
        foreach (var x in g[..3]) Assert.True(Math.Abs(x) < 0.001, $"the band through 21.9 kHz: {x} dB");
        foreach (var x in g[3..]) Assert.True(x < -280, $"from 22.1 kHz: {x} dB");
        Assert.True(pre > 44 && pre < 51, $"its ringing before a click: {pre} ms");
    }

    [Test]
    public async Task Tones_upsampled_by_the_long_filters_are_the_tones_at_the_higher_rate()
    {
        foreach (var shape in new[] { "long", "vlong" })
        {
            var r = await Run(new { fn = "upsample", rate = 44100, factor = 4, seconds = 4, shape, tones = new[] { new[] { 997.0, 0.5 }, new[] { 21000.0, 0.25 } } });
            Assert.True(r.Num("error_db") < -185, $"{shape}: against the tones made at the higher rate: {r.Num("error_db")} dB");
            Assert.True(r.Num("blocks_db") < -280, $"{shape}: a block at a time against the whole at once: {r.Num("blocks_db")} dB");
        }
    }
}
