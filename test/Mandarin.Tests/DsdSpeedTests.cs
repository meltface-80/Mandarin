using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// DSD made faster (bug list item 251), and nothing else about it changed: the seventh order's modulator with its
/// sections held in locals makes the same bits as the loops it stands for, and a track made with each channel's
/// modulator on a thread beside its doublings is the same file, byte for byte, as one made with them in turn; and a
/// doubling done with only its odd taps, in pairs, is the whole filter's, to the last bits of a double.
/// </summary>
public sealed class DsdSpeedTests
{
    private static async Task<JsonNode> Run(object job) => await Score.Run(job);

    [Test]
    public async Task The_seventh_orders_own_path_makes_the_same_bits_as_the_loops()
    {
        foreach (var rate in new[] { 2822400, 11289600 })
        {
            var r = await Run(new { fn = "dsdmod", paths = true, rate, seconds = 1 });
            Assert.True(r.Bool("same") ?? false, $"DSD{rate / 44100}: the same bits");
        }
    }

    [Test]
    public async Task A_track_made_with_its_modulators_beside_its_doublings_is_the_same_file()
    {
        foreach (var dsd in new[] { 2822400, 11289600 })
        {
            var r = await Run(new { fn = "dsdmod", make = dsd, seconds = 5, compare = true });
            Assert.True(r.Bool("same") ?? false, $"DSD{dsd / 44100}: the same file");
            Assert.Equal(0.0, r.Num("resets"));
        }
    }

    [Test]
    public async Task A_doubling_by_its_odd_taps_in_pairs_is_the_whole_filters()
    {
        var r = await Run(new { fn = "dsdmod", halfband = true });
        Assert.True(r.Num("worst") < 1e-14, $"against every tap: {r.Num("worst")}");
        Assert.Equal(2.0, r.Num("gain")!.Value, 3);
    }
}
