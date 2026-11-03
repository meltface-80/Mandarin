// Dsp.cs — a zone's DSP setting turned into ffmpeg's filter graph (v0.8.38),
// from lib/dsp.js, rule for rule. The maths is Biquad.cs (public/biquad.js);
// this is what ffmpeg runs, in the owner's order (item 263; before, the DSP ran after the resample, at the rate sent):
//
//   decode → 64-bit float → volume levelling → headroom → DSP, at the track's own rate → [resample] → dither → 24/32-bit
//
// The headroom is what the DSP lifts the track by, less what levelling has already left under full scale
// (Playback/Levelled.cs). A DSD file's DSP is after its resample, as before: DSD's own rate is no rate to run one at.
// `aformat` pins the samples to 64-bit float, the biquads then choose their
// double-precision form by themselves, `volume` is told to, and the resample
// is SoX at 33 bits. The final requantise with dither is StreamPlans.cs's
// (lib/stream.js), so the chain is the same whichever depth goes out. Numbers
// are written as the Node server wrote them (rounded to a thousandth, then
// String()), so the graph, like the plan's name, is the same text.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

using Js = Mandarin.Server.Tags.Js;

internal static class Dsp
{
    private static readonly Dictionary<string, string> Filter = new(StringComparer.Ordinal)
    {
        ["peak"] = "equalizer", ["low_shelf"] = "lowshelf", ["high_shelf"] = "highshelf", ["low_pass"] = "lowpass", ["high_pass"] = "highpass"
    };

    // What FILTER[type] finds on a plain object's prototype for these names,
    // as a template string writes it (a type no stored setting has; the page
    // never makes one).
    private static readonly Dictionary<string, string> Inherited = new(StringComparer.Ordinal)
    {
        ["__proto__"] = "[object Object]",
        ["constructor"] = "function Object() { [native code] }",
        ["__defineGetter__"] = "function __defineGetter__() { [native code] }",
        ["__defineSetter__"] = "function __defineSetter__() { [native code] }",
        ["hasOwnProperty"] = "function hasOwnProperty() { [native code] }",
        ["__lookupGetter__"] = "function __lookupGetter__() { [native code] }",
        ["__lookupSetter__"] = "function __lookupSetter__() { [native code] }",
        ["isPrototypeOf"] = "function isPrototypeOf() { [native code] }",
        ["propertyIsEnumerable"] = "function propertyIsEnumerable() { [native code] }",
        ["toString"] = "function toString() { [native code] }",
        ["valueOf"] = "function valueOf() { [native code] }",
        ["toLocaleString"] = "function toLocaleString() { [native code] }"
    };

    /* num(v): rounded to a thousandth, as String() writes it. */
    public static string Num(object? v) => Js.Num(Js.Round(Jv.Num(v) * 1000) / 1000);

    /* One band as an ffmpeg filter. Q as width_type=q; a pass filter has no gain. */
    public static string BandFilter(object? b)
    {
        var type = Jv.Get(b, "type");
        var key = Jv.Str(type);
        var f = Filter.TryGetValue(key, out var name) ? name : Inherited.TryGetValue(key, out var inherited) ? inherited : "equalizer";
        var parts = new List<string> { "f=" + Num(Jv.Get(b, "freq")), "width_type=q", "w=" + Num(Jv.Get(b, "q")) };
        if (!Jv.Same(type, "low_pass") && !Jv.Same(type, "high_pass")) parts.Add("g=" + Num(Jv.Get(b, "gain")));
        return f + "=" + string.Join(":", parts);
    }

    /*
     * The filters after decoding, for a conversion to `rate` Hz (`inRate` is the file's): [aformat, volume, bands…,
     * (resample)], the headroom [headroom] where it is said (the plan's, Levelled.cs), else the setting's own.
     */
    public static List<string> Filters(object? dsp, object? inRate, object? rate, bool soxr, object? headroom = null)
    {
        var out_ = new List<string> { "aformat=sample_fmts=dbl" };
        var at = At(inRate, rate);
        var pre = headroom is double h && double.IsFinite(h) ? h : Biquad.Headroom(dsp, at);
        if (pre < 0) out_.Add($"volume={Num(pre)}dB:precision=double");
        var resample = Jv.T(rate) && Jv.T(inRate) && !Jv.Same(rate, inRate)
            ? $"aresample={(soxr ? "resampler=soxr:precision=33:" : "")}internal_sample_fmt=dblp:osr={Jv.Str(rate)}:out_sample_fmt=dbl" : null;
        if (resample != null && !Jv.Same(at, inRate)) out_.Add(resample);
        foreach (var b in Biquad.BandsOf(dsp)) out_.Add(BandFilter(b));
        if (resample != null && Jv.Same(at, inRate)) out_.Add(resample);
        return out_;
    }

    /* The rate the DSP runs at: the track's own (item 263), a DSD file's aside (the rate it is sent at); without one, [rate]. */
    public static object? At(object? inRate, object? rate) => Jv.T(inRate) && Jv.Num(inRate) > 0 && Jv.Num(inRate) <= 768000 ? inRate : rate;

    /* What a plan carries for a conversion with DSP: enough to make the file and to name it, at the rate it runs at (At); null when off. */
    public static JsObj? PlanPart(object? dsp, object? rate, object? inRate = null)
    {
        if (!Biquad.Active(dsp)) return null;
        var at = At(inRate, rate);
        return Jv.Obj(("hash", Biquad.Fingerprint(dsp, at)), ("headroom", Biquad.Headroom(dsp, at)),
            ("bands", (double)Biquad.BandsOf(dsp).Count), ("dsp", dsp));
    }
}
