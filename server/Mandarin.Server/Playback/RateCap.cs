// RateCap.cs — the highest rate a device is sent, set by its owner (bug list item 240).
//
// A device's rates are what it reports, or what its owner switched on; Max upsampling goes to the highest of them.
// The cap is a limit beside them, under Output: nothing goes above it, upsampled or not (a file above it is
// converted down to it). It is named by 48 kHz's family (96, 192, 384, 768 kHz) and holds 44.1 kHz's family to the
// rate that matches (88.2, 176.4, 352.8, 705.6 kHz).
namespace Mandarin.Server.Playback;

internal static class RateCap
{
    /* The caps there are, in Hz, by 48 kHz's family. */
    public static readonly double[] Caps = [96000, 192000, 384000, 768000];

    /* A device's setting as a cap: one of Caps, or null (none: Auto). */
    public static double? Of(object? setting) => setting is double d && Caps.Contains(d) ? d : null;

    /* The cap for [rate]'s family: [cap] itself, or for 44.1 kHz's family the rate that matches it. */
    public static double For(double rate, double cap) => rate % 44100 == 0 ? cap / 48000 * 44100 : cap;

    /* [rates] (Hz) held to [cap]; all of them where there is none, or where none would be left. */
    public static List<object?> Limit(List<object?> rates, double? cap)
    {
        if (cap is not { } c) return rates;
        var kept = rates.Where(r => Jv.Num(r) <= For(Jv.Num(r), c)).ToList();
        return kept.Count > 0 ? kept : rates;
    }
}
