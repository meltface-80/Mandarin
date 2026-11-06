using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The upsampler (bug list items 237, 248, 259, Upsample/StreamUpsample.cs): a track taken two to sixteen times its
/// rate a block at a time, as it plays, by a filter of a fixed length run by overlap-save. Measured against the
/// arithmetic itself: the transform against a DFT done by hand, tones upsampled against the same tones worked out
/// exactly at the output rate, the two channels apart, the output exactly the input's length times the factor and the
/// same however the input comes in blocks. Its shapes: minimum phase rings only after a transient and keeps the band's
/// level; gentle rolls off from 90% of the band and rings for less.
/// </summary>
public sealed class UpsampleTests
{
    private static async Task<JsonNode> Run(object job) => await Score.Run(job);

    [Test]
    public async Task The_transform_is_the_DFT_and_comes_back_to_where_it_started()
    {
        var r = await Run(new { fn = "upsample", fft = 1024 });
        Assert.True(r.Num("fft_db") < -280, $"the FFT against the DFT: {r.Num("fft_db")} dB");
        Assert.True(r.Bool("staged_same") ?? false, "four butterflies at a time (item 319): the same bits as one at a time");
        Assert.True(r.Num("round_trip_db") < -280, $"forward then inverse: {r.Num("round_trip_db")} dB");
    }

    [Test]
    public async Task Tones_upsampled_a_block_at_a_time_are_the_tones_at_the_higher_rate()
    {
        foreach (var factor in new[] { 2, 4, 16 })
        {
            var r = await Run(new { fn = "upsample", rate = 44100, factor, seconds = 4, tones = new[] { new[] { 1000, 0.5 }, new[] { 15000, 0.2 }, new[] { 20000, 0.1 } } });
            // Below what a 32-bit sample can hold (-192 dB): nothing added, nothing taken away in the passband.
            Assert.True(r.Num("error_db") < -185, $"×{factor}: {r.Num("error_db")} dB from the exact tones");
            Assert.True(r.Num("leak_db") < -250, $"×{factor}: the right channel stays its own ({r.Num("leak_db")} dB)");
            // As long as the input times the factor, and in time with it: the filter's delay taken off.
            Assert.Equal(4.0 * 44100 * factor, r.Num("out_frames"));
            // The input in blocks of other sizes: the same output, sample for sample.
            Assert.True(r.Num("blocks_db") < -280, $"×{factor}: other blocks, {r.Num("blocks_db")} dB apart");
        }
    }

    [Test]
    public async Task Minimum_phase_rings_only_after_a_transient_and_keeps_the_band_as_it_was()
    {
        // A click: the linear filter rings either side of it; the minimum-phase one only after.
        var linear = await Run(new { fn = "upsample", impulse = true, rate = 44100, factor = 4 });
        var min = await Run(new { fn = "upsample", impulse = true, rate = 44100, factor = 4, shape = "min" });
        Assert.True(linear.Num("pre_db") > -70, $"the linear filter rings before the click ({linear.Num("pre_db")} dB)");
        Assert.True(min.Num("pre_db") < -170, $"the minimum-phase filter doesn't ({min.Num("pre_db")} dB a millisecond before)");
        Assert.True(min.Num("pre_energy_db") < -150, $"nothing of the click before it ({min.Num("pre_energy_db")} dB of its energy)");
        Assert.True(min.Num("post_db") > -40, "its ringing all after it");
        // Its levels the linear filter's: every tone of the band through as it went in, the channels apart.
        var r = await Run(new { fn = "upsample", gains = true, rate = 44100, factor = 16, seconds = 4, shape = "min", tones = new[] { new[] { 1000, 0.5 }, new[] { 15000, 0.2 }, new[] { 20000, 0.1 } } });
        foreach (var g in r["gains_db"]!.AsArray()) Assert.True(Math.Abs((double)g!) < 1e-6, $"a tone through at {(double)g!} dB");
        Assert.True(r.Num("leak_db") < -250, $"the right channel stays its own ({r.Num("leak_db")} dB)");
        Assert.True(r.Num("blocks_db") < -280, $"other blocks, {r.Num("blocks_db")} dB apart");
    }

    [Test]
    public async Task Gentle_rolls_off_from_nine_tenths_of_the_band_and_rings_for_less()
    {
        object Tones(string? shape) => new { fn = "upsample", gains = true, rate = 44100, factor = 4, seconds = 4, shape,
            tones = new[] { new[] { 1000, 0.5 }, new[] { 15000, 0.2 }, new[] { 21000, 0.05 } } };
        var linear = (await Run(Tones(null)))["gains_db"]!.AsArray().Select(g => (double)g!).ToArray();
        var gentle = (await Run(Tones("gentle")))["gains_db"]!.AsArray().Select(g => (double)g!).ToArray();
        // Below 19.8 kHz as it was; at 21 kHz, halfway down its slope, some 6.7 dB down where the linear one is all but flat.
        Assert.True(Math.Abs(gentle[0]) < 1e-9 && Math.Abs(gentle[1]) < 1e-9, $"the band through: {gentle[0]}, {gentle[1]} dB");
        Assert.True(gentle[2] < -6 && gentle[2] > -7.5, $"21 kHz: {gentle[2]} dB");
        Assert.True(linear[2] > -0.1, $"the linear filter's 21 kHz: {linear[2]} dB");
        // Its ringing a millisecond from a click, before and after alike, well below the linear one's.
        var l = await Run(new { fn = "upsample", impulse = true, rate = 44100, factor = 4 });
        var g2 = await Run(new { fn = "upsample", impulse = true, rate = 44100, factor = 4, shape = "gentle" });
        Assert.True(g2.Num("post_db") < l.Num("post_db") - 10, $"gentle {g2.Num("post_db")} dB against linear {l.Num("post_db")} dB");
        Assert.Equal(g2.Num("pre_db")!.Value, g2.Num("post_db")!.Value, 6);
    }
}
