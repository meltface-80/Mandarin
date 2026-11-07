using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Mandarin's own dither (bug list item 301, Upsample/Dither.cs): flat, or shaped of the 3rd or the 5th order, at the
/// word's depth or at the DAC's real bits. Each measured on a 997 Hz tone at half scale, as the device's page says it:
/// at 705.6 kHz and 20 bits, flat −130 dB in the audio band and −117 dB in all; shaped of the 3rd order 60 dB and more
/// under flat in the band, of the 5th 100 dB and more, each with more noise above the band than flat. At 44.1 kHz no
/// shaping is made (there is no room above the band to move the noise to). Every sample on the grid of the depth the
/// dither goes in at.
/// </summary>
public sealed class DitherTests
{
    private static double N(JsonNode n, string key) => n.Num(key) ?? double.NaN;

    private static async Task<JsonNode> Dither(int rate, int bits, int real = 0, string? shape = null) =>
        await Score.Run(new { fn = "dither", rate, bits, real, shape });

    [Test]
    public async Task Flat_at_20_bits_is_triangular_dither_at_that_bit_its_noise_even_at_every_frequency()
    {
        Needs.Server();
        var f = await Dither(705600, 24, real: 20);
        Assert.Equal(20.0, N(f, "depth"));
        Assert.Equal(0.0, N(f, "order"));
        Assert.True(f["on_grid"]!.GetValue<bool>(), "every sample on the 20-bit grid");
        Assert.True(Math.Abs(N(f, "band_db") + 130) < 1.5, $"in the band: {N(f, "band_db")} dB");
        Assert.True(Math.Abs(N(f, "all_db") + 117) < 1.5, $"in all: {N(f, "all_db")} dB");
    }

    [Test]
    public async Task Shaped_moves_its_noise_above_the_band_the_5th_order_further_than_the_3rd()
    {
        Needs.Server();
        var flat = await Dither(705600, 24, real: 20);
        var n3 = await Dither(705600, 24, real: 20, shape: "ns3");
        var n5 = await Dither(705600, 24, real: 20, shape: "ns5");
        Assert.Equal(3.0, N(n3, "order"));
        Assert.Equal(5.0, N(n5, "order"));
        Assert.True(N(flat, "band_db") - N(n3, "band_db") > 60, $"3rd order in the band: {N(n3, "band_db")} against {N(flat, "band_db")} dB");
        Assert.True(N(flat, "band_db") - N(n5, "band_db") > 100, $"5th order in the band: {N(n5, "band_db")} against {N(flat, "band_db")} dB");
        // What it costs: more noise in all than flat, the 5th's more than the 3rd's.
        Assert.True(N(n3, "all_db") > N(flat, "all_db") && N(n5, "all_db") > N(n3, "all_db"), $"in all: {N(flat, "all_db")}, {N(n3, "all_db")}, {N(n5, "all_db")} dB");
        Assert.True(n5["on_grid"]!.GetValue<bool>() && N(n5, "held") == 0, "on the grid, none held at full scale");
    }

    [Test]
    public async Task At_44_1_kHz_no_shaping_is_made_flat_instead()
    {
        Needs.Server();
        var s = await Dither(44100, 24, real: 20, shape: "ns5");
        Assert.Equal(0.0, N(s, "order"));
        Assert.True(Math.Abs(N(s, "band_db") + 118) < 1.5, $"in the band: {N(s, "band_db")} dB");
        Assert.Equal(3.0, N(await Dither(88200, 24, real: 20, shape: "ns3"), "order"));
    }

    [Test]
    public async Task As_sent_the_dither_goes_in_at_the_word_s_own_depth()
    {
        Needs.Server();
        var s = await Dither(705600, 24);
        Assert.Equal(24.0, N(s, "depth"));
        Assert.True(Math.Abs(N(s, "band_db") + 154) < 1.5, $"in the band: {N(s, "band_db")} dB");
        // Real bits at or above the word's are the word's.
        Assert.Equal(16.0, N(await Dither(705600, 16, real: 20), "depth"));
    }
}
