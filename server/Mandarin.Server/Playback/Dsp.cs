// Dsp.cs — a zone's DSP setting turned into ffmpeg's filter graph (v0.8.38),
// from lib/dsp.js, rule for rule. The maths is Biquad.cs (public/biquad.js);
// this is what ffmpeg runs, in the owner's order:
//
//   decode → 64-bit float → headroom → [upsample] → DSP → dither → 24/32-bit
//
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
     * The filters after decoding, for a conversion to `rate` Hz (`inRate` is
     * the file's): [aformat, volume, (resample), bands…].
     */
    public static List<string> Filters(object? dsp, object? inRate, object? rate, bool soxr)
    {
        var out_ = new List<string> { "aformat=sample_fmts=dbl" };
        var pre = Biquad.Headroom(dsp, rate);
        if (pre < 0) out_.Add($"volume={Num(pre)}dB:precision=double");
        if (Jv.T(rate) && Jv.T(inRate) && !Jv.Same(rate, inRate))
            out_.Add($"aresample={(soxr ? "resampler=soxr:precision=33:" : "")}internal_sample_fmt=dblp:osr={Jv.Str(rate)}:out_sample_fmt=dbl");
        foreach (var b in Biquad.BandsOf(dsp)) out_.Add(BandFilter(b));
        return out_;
    }

    /* What a plan carries for a conversion with DSP: enough to make the file and to name it; null when off. */
    public static JsObj? PlanPart(object? dsp, object? rate)
    {
        if (!Biquad.Active(dsp)) return null;
        return Jv.Obj(("hash", Biquad.Fingerprint(dsp, rate)), ("headroom", Biquad.Headroom(dsp, rate)),
            ("bands", (double)Biquad.BandsOf(dsp).Count), ("dsp", dsp));
    }
}
