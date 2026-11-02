using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The whole-track upsampler (bug list item 237, Upsample/): a track to the frequency domain in one transform and back
/// at two to sixteen times its rate, the filter as long as the track. Measured against the arithmetic itself: the
/// transform against a DFT done by hand, tones upsampled against the same tones worked out exactly at the output
/// rate, the two channels apart, a track done in sections against the same done whole, and a track whose peaks
/// between samples go over full scale brought under it, never clipped.
/// </summary>
public sealed class WholeTrackTests
{
    private static async Task<JsonNode> Run(object job) => await Score.Run(job);

    [Test]
    public async Task The_transform_is_the_DFT_and_comes_back_to_where_it_started()
    {
        var r = await Run(new { fn = "wholetrack", fft = 1024 });
        Assert.True(r.Num("fft_db") < -280, $"the FFT against the DFT: {r.Num("fft_db")} dB");
        Assert.True(r.Num("round_trip_db") < -280, $"forward then inverse: {r.Num("round_trip_db")} dB");
    }

    [Test]
    public async Task Tones_upsampled_are_the_tones_at_the_higher_rate()
    {
        foreach (var factor in new[] { 2, 4, 16 })
        {
            var r = await Run(new { fn = "wholetrack", rate = 44100, factor, seconds = 4, tones = new[] { new[] { 1000, 0.5 }, new[] { 15000, 0.2 }, new[] { 20000, 0.1 } } });
            // Below what a 32-bit sample can hold (-192 dB): nothing added, nothing taken away in the passband.
            Assert.True(r.Num("error_db") < -185, $"×{factor}: {r.Num("error_db")} dB from the exact tones");
            Assert.True(r.Num("leak_db") < -250, $"×{factor}: the right channel stays its own ({r.Num("leak_db")} dB)");
            Assert.Equal(4.0 * 44100 * factor, r.Num("frames"));
            Assert.Equal(1.0, r.Num("gain"));
        }
    }

    [Test]
    public async Task Over_full_scale_between_the_samples_the_whole_track_is_brought_under_it()
    {
        // Three tones that add up past 1 where the original samples don't show it.
        var r = await Run(new { fn = "wholetrack", rate = 48000, factor = 8, seconds = 3, tones = new[] { new[] { 997, 0.8 }, new[] { 11000, 0.3 }, new[] { 19000, 0.1 } } });
        Assert.True(r.Num("peak") > 1, "the peak over full scale");
        // −0.1 dBFS at the peak: one gain for the track.
        Assert.Equal(Math.Pow(10, -0.1 / 20), r.Num("peak")!.Value * r.Num("gain")!.Value, 9);
        Assert.True(r.Num("error_db") < -185, "and otherwise the same tones");
    }

    [Test]
    public async Task A_track_too_long_for_one_transform_is_done_in_sections_that_join_without_a_trace()
    {
        var r = await Run(new { fn = "wholetrack", rate = 44100, factor = 4, seconds = 20, compare = true, section_bits = 22,
            tones = new[] { new[] { 440, 0.5 }, new[] { 18000, 0.2 } } });
        Assert.True(r.Num("section_count") >= 2, "done in sections");
        Assert.True(r.Num("joins_db") < -240, $"the sections against the whole: {r.Num("joins_db")} dB");
    }
}
