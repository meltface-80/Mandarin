// DsdOut.cs — the modulator a track is made DSD with (bug list items 242, 255, 303): seventh order by default, its
// gain out of band set for each rate; or, chosen on the device's page, the seventh order quiet to 50 kHz, or the
// ninth. UpsampleCommand.cs runs each channel through its own chain (DsdChain.cs) as the track plays.
namespace Mandarin.Server.Upsample;

internal static class DsdOut
{
    /*
     * The modulator's gain out of band at [dsdRate] (item 255): low enough that the loop holds past SACD's highest
     * level, +3.1 dB over its reference (71.4% modulation), with room to spare. 1.4 was quieter in the band but held
     * only to 62%. Measured, no reset to 75% or more: 1.3 at DSD64 and 48 kHz's 3.072 MHz (item 261; DSD64's noise in the band −126 dB); 1.25 at DSD128 and
     * DSD256 (−161 dB and −204 dB), where 1.3 no longer held at 75%.
     */
    public static double Hinf(int dsdRate) => dsdRate <= 3072000 ? 1.3 : 1.25;

    /*
     * The modulators a device can choose (item 303), each measured through the whole chain (DsdRules.cs): "7", the
     * seventh order, its noise held out of 20 kHz (DSD64 −127 dB in the band, DSD128 −163, DSD256 −207); "7w", the
     * same held out of 50 kHz (DSD128 −107 dB to 20 kHz and −106 to 50 kHz, where the seventh is −79; DSD256 −151 and
     * −151, the seventh −124); "9", the ninth order (DSD64 −136 dB in the band, DSD128 −181), a little louder above
     * it, and a fifth slower to make. Each held to 75% modulation and more.
     */
    public static readonly string[] Mods = ["7", "7w", "9"];

    /* Whether [mod] is made at DSD[multiple]: the wide seventh at 128 and 256 (at 64 it gives the band too much); the ninth at 64 and 128 (at 256 it is too slow). */
    public static bool Offered(string mod, int multiple) => mod switch
    {
        "7" => true,
        "7w" => multiple >= 128,
        "9" => multiple <= 128,
        _ => false,
    };

    /* A setting's modulator other than the seventh order's ("7w" or "9"); null for the seventh, or anything else. */
    public static string? Of(object? v) => v is string s && s != "7" && Array.IndexOf(Mods, s) >= 0 ? s : null;

    /* The modulator [mod] (null: the seventh order) at [dsdRate]. */
    public static DsdNtf Ntf(int dsdRate, string? mod = null) => mod switch
    {
        "7w" => new(7, dsdRate / 2.0 / 50000, Hinf(dsdRate)),
        "9" => new(9, dsdRate / 2.0 / 20000, Hinf(dsdRate)),
        _ => new(7, dsdRate / 2.0 / 20000, Hinf(dsdRate)),
    };

    /* [mod] in a few words, for the signal path. */
    public static string Words(string? mod) => mod switch
    {
        "7w" => "7th-order modulator, quiet to 50 kHz",
        "9" => "9th-order modulator",
        _ => "7th-order modulator",
    };

    /* [mod]'s line in the signal path. */
    public static string Line(string? mod) => mod switch
    {
        "7w" => "Seventh order, its noise shaped out of the band to 50 kHz",
        "9" => "Ninth order, its noise shaped out of the audio band",
        _ => "Seventh order, its noise shaped out of the audio band",
    };
}
