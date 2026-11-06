using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Minimum phase on every filter (bug list item 318, Upsample/Shape.cs, StreamUpsample.cs): each filter's levels, at
/// every frequency, as its linear filter's, and all its ringing after a click (0.15 ms before it at most, where the
/// linear filters ring 0.2 to 47 ms before); Gentle's, Gaussian's and the long ones' words for it, and the standard
/// one's as they always were ("min", "Minimum-phase filter"). Each runs in the upsampler as the others do: the band
/// through, the same output however the input comes in blocks.
/// </summary>
public sealed class MinimumPhaseTests
{
    private static async Task<JsonNode> Run(object job) => await Score.Run(job);

    private static async Task<(double[] Gains, double Before, double After)> Taps(int rate, int factor, string? shape, params int[] at)
    {
        var r = await Run(new { fn = "upsample", taps = true, rate, factor, shape, at });
        return (r["gains_db"]!.AsArray().Select(g => (double)g!).ToArray(), r.Num("before_ms")!.Value, r.Num("after_ms")!.Value);
    }

    [Test]
    public async Task Each_filter_in_minimum_phase_has_its_linear_levels_and_rings_only_after_a_click()
    {
        int[] at = [1000, 15000, 20000, 21000, 21800, 22050, 22100, 24000];
        foreach (var (linear, min) in new[] { ((string?)null, "min"), ("gentle", "gentle-min"), ("gauss", "gauss-min"), ("long", "long-min") })
        {
            var (lg, lb, _) = await Taps(44100, 16, linear, at);
            var (mg, mb, ma) = await Taps(44100, 16, min, at);
            for (var i = 0; i < at.Length; i++)
                if (lg[i] > -150) Assert.True(Math.Abs(mg[i] - lg[i]) < 0.01, $"{min} at {at[i]} Hz: {mg[i]} dB, linear {lg[i]} dB");
            Assert.True(mb < 0.15, $"{min}: {mb} ms of ringing before a click (linear: {lb} ms)");
            Assert.True(lb > 1 && ma > mb, $"{min}: rings after it, {ma} ms");
        }
        var (hg, hb, _) = await Taps(96000, 4, "gauss-hires-min", 1000, 25900, 48000);
        var (lh, _, _) = await Taps(96000, 4, "gauss-hires", 1000, 25900, 48000);
        for (var i = 0; i < 3; i++) Assert.True(Math.Abs(hg[i] - lh[i]) < 0.01, $"Gaussian hi-res, minimum phase, from 96 kHz: {hg[i]} dB, linear {lh[i]} dB");
        Assert.True(hb < 0.15, $"Gaussian hi-res, minimum phase: {hb} ms before");
    }

    [Test]
    public async Task Tones_upsampled_in_minimum_phase_are_the_tones_at_the_higher_rate()
    {
        foreach (var shape in new[] { "gentle-min", "gauss-min", "vlong-min" })
        {
            var r = await Run(new { fn = "upsample", rate = 44100, factor = 4, seconds = 4, shape, tones = new[] { new[] { 997.0, 0.5 } } });
            Assert.True(r.Num("blocks_db") < -280, $"{shape}: a block at a time against the whole at once: {r.Num("blocks_db")} dB");
            Assert.Equal(4.0 * 44100 * 4, r.Num("out_frames"));
        }
    }
}
