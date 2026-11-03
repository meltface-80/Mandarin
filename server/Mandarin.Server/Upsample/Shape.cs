// Shape.cs — the upsampling filter's shapes (bug list items 248, 259): standard, minimum phase, gentle.
//
// Standard is linear phase: no shift at any frequency, its ringing, where a transient is filtered, falling evenly
// before and after it. Minimum phase keeps those levels and gives them the one phase that puts all the ringing after
// the transient, none before it. Gentle is linear phase with the roll-off begun earlier, at [GentlePass] of the
// Nyquist frequency: twice as wide a slope, so its ringing lasts half as long, at the cost of the top of the band
// (from 19.8 kHz for a CD, down 6 dB by 21 kHz). StreamUpsample.cs runs them, a block at a time, as a track plays.
namespace Mandarin.Server.Upsample;

internal static class Shape
{
    public enum Kind { Standard, Minimum, Gentle }

    /* The fraction of the input's Nyquist frequency the standard filter's roll-off begins at, and the gentle one's. */
    public const double StandardPass = 0.95;
    public const double GentlePass = 0.90;

    /* A plan's "shape": "min" for minimum phase, "gentle", anything else standard. */
    public static Kind Of(string? shape) => shape switch { "min" => Kind.Minimum, "gentle" => Kind.Gentle, _ => Kind.Standard };

    /* The plan's word for [kind]: "min", "gentle", or null for standard. */
    public static string? Word(Kind kind) => kind switch { Kind.Minimum => "min", Kind.Gentle => "gentle", _ => null };

    /* A device's Output filter ("standard", "minphase", "gentle") as a plan's shape; null for standard or none. */
    public static string? OfFilter(object? filter) => filter switch { "minphase" => "min", "gentle" => "gentle", _ => null };

    /* The words for the filter of [shape], as Now playing says them. */
    public static string Name(string? shape) => Of(shape) switch
    {
        Kind.Minimum => "Minimum-phase filter",
        Kind.Gentle => "Gentle filter",
        _ => "Standard filter",
    };

    /* The same in a line of words: "minimum phase", "gentle filter", "standard filter". */
    public static string Words(string? shape) => Of(shape) switch
    {
        Kind.Minimum => "minimum phase",
        Kind.Gentle => "gentle filter",
        _ => "standard filter",
    };
}
