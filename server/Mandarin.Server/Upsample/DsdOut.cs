// DsdOut.cs — the modulator a track is made DSD with (bug list items 242, 255): seventh order, its gain out of band
// set for each rate. UpsampleCommand.cs runs each channel through its own chain (DsdChain.cs) as the track plays.
namespace Mandarin.Server.Upsample;

internal static class DsdOut
{
    /*
     * The modulator's gain out of band at [dsdRate] (item 255): low enough that the loop holds past SACD's highest
     * level, +3.1 dB over its reference (71.4% modulation), with room to spare. 1.4 was quieter in the band but held
     * only to 62%. Measured, no reset to 75% or more: 1.3 at DSD64 (its noise in the band −126 dB); 1.25 at DSD128 and
     * DSD256 (−161 dB and −204 dB), where 1.3 no longer held at 75%.
     */
    public static double Hinf(int dsdRate) => dsdRate <= 2822400 ? 1.3 : 1.25;

    /* The modulator Mandarin uses: seventh order, its gain out of band [Hinf]. */
    public static DsdNtf Ntf(int dsdRate) => new(7, dsdRate / 2.0 / 20000, Hinf(dsdRate));
}
