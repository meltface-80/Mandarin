// Shape.cs — the upsampling filter's shapes (bug list items 248, 259, 298): standard, minimum phase, gentle, and the
// three Gaussian ones.
//
// Standard is linear phase: no shift at any frequency, its ringing, where a transient is filtered, falling evenly
// before and after it. Minimum phase keeps those levels and gives them the one phase that puts all the ringing after
// the transient, none before it. Gentle is linear phase with the roll-off begun earlier, at [GentlePass] of the
// Nyquist frequency: twice as wide a slope, so its ringing lasts half as long, at the cost of the top of the band
// (from 19.8 kHz for a CD, down 6 dB by 21 kHz). The Gaussian ones (item 298, Gaussian.cs) roll off along a Gaussian's
// integral, so their ringing dies away along a Gaussian too, far sooner than a sinc's: Gaussian, for CD rates, down
// 100 dB by the source's Nyquist; Gaussian steep, flat almost to it and half down at it, keeping every sample of the
// source as it was; Gaussian hi-res, short and smooth, for sources of 88.2 kHz and up. StreamUpsample.cs runs them
// all, a block at a time, as a track plays.
namespace Mandarin.Server.Upsample;

internal static class Shape
{
    public enum Kind { Standard, Minimum, Gentle, Gaussian, GaussianSteep, GaussianHires }

    /* The fraction of the input's Nyquist frequency the standard filter's roll-off begins at, and the gentle one's. */
    public const double StandardPass = 0.95;
    public const double GentlePass = 0.90;

    /* The source rates above which a device's filter for hi-res sources is the one (item 298): 88.2 kHz and up. */
    public const double HiresAbove = 48000;

    /* The device filters (Settings → Audio Devices → Output) and the plan's word for each; standard has none. */
    public static readonly string[] Filters = ["standard", "minphase", "gentle", "gaussian", "gaussian-steep", "gaussian-hires"];

    /* A plan's "shape": "min", "gentle", "gauss", "gauss-steep", "gauss-hires"; anything else standard. */
    public static Kind Of(string? shape) => shape switch
    {
        "min" => Kind.Minimum, "gentle" => Kind.Gentle, "gauss" => Kind.Gaussian, "gauss-steep" => Kind.GaussianSteep, "gauss-hires" => Kind.GaussianHires,
        _ => Kind.Standard,
    };

    /* The plan's word for [kind]; null for standard. */
    public static string? Word(Kind kind) => kind switch
    {
        Kind.Minimum => "min", Kind.Gentle => "gentle", Kind.Gaussian => "gauss", Kind.GaussianSteep => "gauss-steep", Kind.GaussianHires => "gauss-hires",
        _ => null,
    };

    /* A device's Output filter ("standard", "minphase", "gentle", "gaussian"…) as a plan's shape; null for standard or none. */
    public static string? OfFilter(object? filter) => filter switch
    {
        "minphase" => "min", "gentle" => "gentle", "gaussian" => "gauss", "gaussian-steep" => "gauss-steep", "gaussian-hires" => "gauss-hires",
        _ => null,
    };

    /*
     * The shape a track of [inRate] is upsampled in for a device's stream [target] (item 298): above [HiresAbove], its
     * filter for hi-res sources where one is set ("filter_hires", the standard one included), else its filter.
     */
    public static string? ForTrack(object? target, double inRate)
    {
        var hires = inRate > HiresAbove ? Playback.Jv.Get(target, "filter_hires") as string : null;
        return OfFilter(hires != null && Array.IndexOf(Filters, hires) >= 0 ? hires : Playback.Jv.Get(target, "filter"));
    }

    /* The words for the filter of [shape], as Now playing says them. */
    public static string Name(string? shape) => Of(shape) switch
    {
        Kind.Minimum => "Minimum-phase filter",
        Kind.Gentle => "Gentle filter",
        Kind.Gaussian => "Gaussian filter",
        Kind.GaussianSteep => "Gaussian steep filter",
        Kind.GaussianHires => "Gaussian hi-res filter",
        _ => "Standard filter",
    };

    /* The same in a line of words: "minimum phase", "gentle filter", "Gaussian filter"…, "standard filter". */
    public static string Words(string? shape) => Of(shape) switch
    {
        Kind.Minimum => "minimum phase",
        Kind.Gentle => "gentle filter",
        Kind.Gaussian => "Gaussian filter",
        Kind.GaussianSteep => "Gaussian steep filter",
        Kind.GaussianHires => "Gaussian hi-res filter",
        _ => "standard filter",
    };
}
