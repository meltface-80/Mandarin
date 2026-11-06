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
// source as it was; Gaussian hi-res, short and smooth, for sources of 88.2 kHz and up. Long and very long (item 317)
// are Standard's design made eight and thirty-two times as long: flat to 21.8 and 21.9 kHz for a CD and some 270 dB
// down from 22.1 kHz, their ringing longer, at 22 kHz. StreamUpsample.cs runs them all, a block at a time, as a track plays.
namespace Mandarin.Server.Upsample;

internal static class Shape
{
    /*
     * The filters, and Minimum on any of them (item 318): their linear filter's levels with the one phase that puts all
     * the ringing after a transient. Minimum alone is the standard filter's (items 248, 259), as it always was.
     */
    [Flags]
    public enum Kind { Standard = 0, Gentle = 1, Gaussian = 2, GaussianSteep = 3, GaussianHires = 4, Long = 5, VeryLong = 6, Minimum = 0x100 }

    /* [kind] in linear phase: the filter its levels are. */
    public static Kind Linear(Kind kind) => kind & ~Kind.Minimum;

    /* Whether [kind] is in minimum phase. */
    public static bool IsMinimum(Kind kind) => (kind & Kind.Minimum) != 0;

    /* The fraction of the input's Nyquist frequency the standard filter's roll-off begins at, and the gentle one's. */
    public const double StandardPass = 0.95;
    public const double GentlePass = 0.90;

    /* The source rates above which a device's filter for hi-res sources is the one (item 298): 88.2 kHz and up. */
    public const double HiresAbove = 48000;

    /*
     * The device filters (Settings → Audio Devices → Output) and the plan's word for each; standard has none.
     * "minphase", the standard filter in minimum phase before Phase was its own choice (item 318), is still taken.
     */
    public static readonly string[] Filters = ["standard", "minphase", "gentle", "gaussian", "gaussian-steep", "gaussian-hires", "long", "very-long"];

    /* A device's Phase (item 318): "linear" (by its absence) or "minimum". */
    public static readonly string[] Phases = ["linear", "minimum"];

    private static readonly (Kind Kind, string Word, string Name)[] Linears =
    [
        (Kind.Gentle, "gentle", "Gentle filter"), (Kind.Gaussian, "gauss", "Gaussian filter"), (Kind.GaussianSteep, "gauss-steep", "Gaussian steep filter"),
        (Kind.GaussianHires, "gauss-hires", "Gaussian hi-res filter"), (Kind.Long, "long", "Long filter"), (Kind.VeryLong, "vlong", "Very long filter"),
    ];

    /* A plan's "shape": "min", "gentle", "gauss", …, any of them in minimum phase with "-min" after ("gauss-min"); anything else standard. */
    public static Kind Of(string? shape)
    {
        if (shape == "min") return Kind.Minimum;
        var min = shape != null && shape.EndsWith("-min", StringComparison.Ordinal);
        var word = min ? shape![..^4] : shape;
        foreach (var (k, w, _) in Linears) if (w == word) return min ? k | Kind.Minimum : k;
        return Kind.Standard;
    }

    /* The plan's word for [kind]; null for standard. */
    public static string? Word(Kind kind)
    {
        if (kind == Kind.Minimum) return "min";
        foreach (var (k, w, _) in Linears) if (k == Linear(kind)) return IsMinimum(kind) ? w + "-min" : w;
        return null;
    }

    /* A device's Output filter ("standard", "gentle", "gaussian"…) in [phase] as a plan's shape; null for the standard one in linear phase, or none. Gaussian steep keeps every sample of the source only in linear phase, and is never made otherwise. */
    public static string? OfFilter(object? filter, bool minimum = false)
    {
        var linear = filter switch
        {
            "minphase" => "min", "gentle" => "gentle", "gaussian" => "gauss", "gaussian-steep" => "gauss-steep", "gaussian-hires" => "gauss-hires",
            "long" => "long", "very-long" => "vlong",
            _ => null,
        };
        if (!minimum || linear is "min" or "gauss-steep") return linear;
        return linear == null ? "min" : linear + "-min";
    }

    /*
     * A device's Phase (item 318): minimum where it is set so, or where either of its filters was "minphase", the
     * standard filter in minimum phase from before Phase was its own choice; else linear.
     */
    public static bool MinimumOf(object? target) =>
        Playback.Jv.Get(target, "phase") is "minimum" || Playback.Jv.Get(target, "filter") is "minphase" || Playback.Jv.Get(target, "filter_hires") is "minphase";

    /*
     * The shape a track of [inRate] is upsampled in for a device's stream [target] (item 298): above [HiresAbove], its
     * filter for hi-res sources where one is set ("filter_hires", the standard one included), else its filter; in the
     * device's Phase (item 318).
     */
    public static string? ForTrack(object? target, double inRate)
    {
        var hires = inRate > HiresAbove ? Playback.Jv.Get(target, "filter_hires") as string : null;
        return OfFilter(hires != null && Array.IndexOf(Filters, hires) >= 0 ? hires : Playback.Jv.Get(target, "filter"), MinimumOf(target));
    }

    /* The words for the filter of [shape], as Now playing says them: "Gaussian filter", "Gaussian filter, minimum phase"; the standard one's "Minimum-phase filter". */
    public static string Name(string? shape)
    {
        var kind = Of(shape);
        if (kind == Kind.Minimum) return "Minimum-phase filter";
        foreach (var (k, _, n) in Linears) if (k == Linear(kind)) return IsMinimum(kind) ? n + ", minimum phase" : n;
        return "Standard filter";
    }

    /* The same in a line of words: "minimum phase", "gentle filter", "Gaussian filter, minimum phase"…, "standard filter". */
    public static string Words(string? shape)
    {
        var kind = Of(shape);
        if (kind == Kind.Minimum) return "minimum phase";
        var name = Name(shape);
        return name.StartsWith("Gaussian", StringComparison.Ordinal) ? name : char.ToLowerInvariant(name[0]) + name[1..];
    }
}
