// Biquad.cs — the DSP maths (v0.8.38), from public/biquad.js, rule for rule:
// the parametric bands (peak, shelves, passes) as second-order sections (the
// Audio EQ Cookbook's, which is what ffmpeg's equalizer, lowshelf, highshelf,
// lowpass and highpass compute), their combined response, the headroom a set
// of bands needs, a setting as stored, and the fingerprint its conversions
// are named by in the transcode folder.
//
// A setting is read as the page and the Node server keep it (JSON, any shape
// they might find), so the values here are JavaScript's (Tags/Js.cs): a band's
// numbers are read with Number(), a missing one is undefined. The sines,
// cosines, powers and logarithms are V8's (JsMath.cs), so the curve, the
// headroom and so the names come out to the bit.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

using Js = Mandarin.Server.Tags.Js;

internal sealed class BandError(string message) : JsError(message);

internal static class Biquad
{
    public static readonly string[] Types = ["peak", "low_shelf", "high_shelf", "low_pass", "high_pass"];
    public const int MaxBands = 10;
    public const double HeadroomMargin = 0.5;   // dB under the peak, so a full-scale peak never clips

    /* A section's coefficients, normalised (a0 = 1). */
    public readonly record struct Section(double B0, double B1, double B2, double A1, double A2)
    {
        public JsObj Js() => Jv.Obj(("b0", B0), ("b1", B1), ("b2", B2), ("a1", A1), ("a2", A2));
    }

    private static bool IsPass(object? type) => Jv.Same(type, "low_pass") || Jv.Same(type, "high_pass");

    /* coeffs(band, fs): one band at sample rate fs. */
    public static Section Coeffs(object? band, double fs)
    {
        var type = Jv.Get(band, "type");
        var f0 = Math.Min(Math.Max(Jv.Or(Jv.Num(Jv.Get(band, "freq")), 1000), 1), fs / 2 - 1);
        var Q = Math.Min(Math.Max(Jv.Or(Jv.Num(Jv.Get(band, "q")), 0.707), 0.01), 100);
        var g = IsPass(type) ? 0 : Jv.Or(Jv.Num(Jv.Get(band, "gain")), 0);
        var A = JsMath.Pow(10, g / 40);
        var w0 = 2 * Math.PI * f0 / fs;
        double cs = JsMath.Cos(w0), sn = JsMath.Sin(w0);
        var alpha = sn / (2 * Q);
        double b0, b1, b2, a0, a1, a2;
        switch (type as string)
        {
            case "low_shelf":
            {
                var s = 2 * Math.Sqrt(A) * alpha;
                b0 = A * ((A + 1) - (A - 1) * cs + s);
                b1 = 2 * A * ((A - 1) - (A + 1) * cs);
                b2 = A * ((A + 1) - (A - 1) * cs - s);
                a0 = (A + 1) + (A - 1) * cs + s;
                a1 = -2 * ((A - 1) + (A + 1) * cs);
                a2 = (A + 1) + (A - 1) * cs - s;
                break;
            }
            case "high_shelf":
            {
                var s = 2 * Math.Sqrt(A) * alpha;
                b0 = A * ((A + 1) + (A - 1) * cs + s);
                b1 = -2 * A * ((A - 1) + (A + 1) * cs);
                b2 = A * ((A + 1) + (A - 1) * cs - s);
                a0 = (A + 1) - (A - 1) * cs + s;
                a1 = 2 * ((A - 1) - (A + 1) * cs);
                a2 = (A + 1) - (A - 1) * cs - s;
                break;
            }
            case "low_pass":
                b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2;
                a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
                break;
            case "high_pass":
                b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2;
                a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
                break;
            default:   // peak
                b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A;
                a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A;
                break;
        }
        return new Section(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
    }

    /* |H(f)| in dB of one section. */
    public static double SectionDb(Section c, double f, double fs)
    {
        var w = 2 * Math.PI * f / fs;
        double c1 = JsMath.Cos(w), s1 = JsMath.Sin(w), c2 = JsMath.Cos(2 * w), s2 = JsMath.Sin(2 * w);
        double nr = c.B0 + c.B1 * c1 + c.B2 * c2, ni = -(c.B1 * s1 + c.B2 * s2);
        double dr = 1 + c.A1 * c1 + c.A2 * c2, di = -(c.A1 * s1 + c.A2 * s2);
        var mag2 = (nr * nr + ni * ni) / Math.Max(dr * dr + di * di, 1e-30);
        return 10 * JsMath.Log10(Math.Max(mag2, 1e-30));
    }

    /* The bands' combined response in dB at each frequency. */
    public static List<double> Response(List<object?> bands, double fs, IReadOnlyList<double> freqs)
    {
        var cs = bands.Select(b => Coeffs(b, fs)).ToList();
        var out_ = new List<double>(freqs.Count);
        foreach (var f in freqs)
        {
            double db = 0;
            foreach (var c in cs) db += SectionDb(c, f, fs);
            out_.Add(db);
        }
        return out_;
    }

    /* Log-spaced frequencies over the audible band, plus each band's centre, in order. */
    public static List<double> Sweep(List<object?> bands, double n)
    {
        var out_ = new List<double>();
        double lo = JsMath.Log10(20), hi = JsMath.Log10(20000);
        for (var i = 0; i < n; i++) out_.Add(JsMath.Pow(10, lo + (hi - lo) * i / (n - 1)));
        foreach (var b in bands)
        {
            var f = Jv.Num(Jv.Get(b, "freq"));
            if (f > 20 && f < 20000) out_.Add(f);
        }
        out_.Sort();
        return out_;
    }

    /* The highest point of the combined response (dB, ≥ 0). */
    public static double PeakDb(List<object?> bands, double fs)
    {
        if (bands.Count == 0) return 0;
        double m = 0;
        foreach (var v in Response(bands, fs, Sweep(bands, 400)))
        {
            if (double.IsNaN(v)) return double.NaN;   // Math.max with a NaN
            if (v > m) m = v;
        }
        return m;
    }

    /* All the bands a setting applies, in order: the headphone's, then the PEQ's. */
    public static List<object?> BandsOf(object? dsp)
    {
        var hp = Jv.T(dsp) && Jv.T(Jv.Get(dsp, "headphone")) && Jv.Get(Jv.Get(dsp, "headphone"), "bands") is List<object?> h ? h : [];
        var pq = Jv.T(dsp) && Jv.T(Jv.Get(dsp, "peq")) && Jv.Get(Jv.Get(dsp, "peq"), "bands") is List<object?> p ? p : [];
        return [.. hp, .. pq];
    }

    /* fs || 48000, read as a number. */
    public static double RateOr48k(object? fs) => Jv.T(fs) ? Jv.Num(fs) : 48000;

    /*
     * The preamp in dB (≤ 0): half a dB under the combined peak, a headphone
     * profile's own where it covers that, or a number set by hand as it is.
     */
    public static double Headroom(object? dsp, object? fs)
    {
        if (!Jv.T(dsp)) return 0;
        if (Jv.Get(dsp, "headroom") is double h && double.IsFinite(h)) return Math.Min(0, h);
        var bands = BandsOf(dsp);
        if (bands.Count == 0) return 0;
        var needed = -(PeakDb(bands, RateOr48k(fs)) + HeadroomMargin);
        var hp = Jv.Get(dsp, "headphone");
        if (Jv.T(hp) && Jv.Get(hp, "preamp") is double own && own <= needed) return own;
        return Js.Round(needed * 10) / 10;
    }

    /* A band as stored: types and ranges checked, numbers rounded sanely. Throws on anything that isn't a band. */
    public static JsObj NormaliseBand(object? b)
    {
        if (!Jv.T(b) || b is not (JsObj or List<object?>)) throw new BandError("a band must be an object");
        var type = Jv.Get(b, "type");
        if (!Jv.OneOf(type, Types)) throw new BandError("band type must be one of " + string.Join(", ", Types));
        var freq = Jv.Num(Jv.Get(b, "freq"));
        if (!(freq >= 10 && freq <= 24000)) throw new BandError("band frequency must be 10–24000 Hz");
        var q = Jv.Num(Jv.Nullish(Jv.Get(b, "q")) ? 0.707 : Jv.Get(b, "q"));
        if (!(q >= 0.1 && q <= 20)) throw new BandError("band Q must be 0.1–20");
        var gain = IsPass(type) ? 0 : Jv.Num(Jv.Nullish(Jv.Get(b, "gain")) ? 0.0 : Jv.Get(b, "gain"));
        if (!(gain >= -20 && gain <= 20)) throw new BandError("band gain must be −20–20 dB");
        return Jv.Obj(("type", type), ("freq", Js.Round(freq * 10) / 10), ("gain", Js.Round(gain * 10) / 10), ("q", Js.Round(q * 1000) / 1000));
    }

    private static string Slice(string s, int n) => s.Length > n ? s[..n] : s;

    /* A DSP setting as stored. Missing parts are the defaults; bad parts throw. */
    public static JsObj Normalise(object? d)
    {
        var cur = Jv.T(d) && d is JsObj or List<object?> ? d : new JsObj();
        var out_ = Jv.Obj(("enabled", Jv.T(Jv.Get(cur, "enabled"))), ("headphone", null), ("peq", null), ("headroom", "auto"));
        var hp = Jv.Get(cur, "headphone");
        if (Jv.T(hp) && hp is JsObj or List<object?>)
        {
            var bands = (Jv.Get(hp, "bands") as List<object?> ?? []).Select(x => (object?)NormaliseBand(x)).ToList();
            if (bands.Count > MaxBands) throw new BandError("a headphone profile has at most " + MaxBands + " bands");
            var preamp = Jv.Get(hp, "preamp");
            out_["headphone"] = Jv.Obj(
                ("source", Slice(Jv.Str(Jv.Or(Jv.Get(hp, "source"), "custom")), 20)),
                ("id", Slice(Jv.Str(Jv.Or(Jv.Get(hp, "id"), "")), 200)),
                ("name", Slice(Jv.Str(Jv.Or(Jv.Get(hp, "name"), "")), 120)),
                ("preamp", preamp is double p && double.IsFinite(p) ? Math.Min(0, Js.Round(p * 10) / 10) : null),
                ("bands", bands));
        }
        var peq = Jv.Get(cur, "peq");
        if (Jv.T(peq) && peq is JsObj or List<object?>)
        {
            var bands = (Jv.Get(peq, "bands") as List<object?> ?? []).Select(x => (object?)NormaliseBand(x)).ToList();
            if (bands.Count > MaxBands) throw new BandError("the PEQ has at most " + MaxBands + " bands");
            out_["peq"] = Jv.Obj(("bands", bands));
        }
        if (Jv.Get(cur, "headroom") is double hr)
        {
            if (!(hr >= -30 && hr <= 0)) throw new BandError("headroom must be 0 to −30 dB");
            out_["headroom"] = Js.Round(hr * 10) / 10;
        }
        return out_;
    }

    /* Does this setting change the sound at all? */
    public static bool Active(object? dsp) => Jv.T(dsp) && Jv.T(Jv.Get(dsp, "enabled")) && BandsOf(dsp).Count > 0;

    /*
     * A short stable name for what a setting does, for cache files: FNV-1a,
     * 32 bits, twice over JSON.stringify({ b: bands, h: headroom }).
     */
    public static string Fingerprint(object? dsp, object? fs)
    {
        var s = Js.Json(Jv.Obj(("b", BandsOf(dsp)), ("h", Headroom(dsp, fs)))) ?? "";
        uint h1 = 0x811c9dc5, h2 = 0x01000193;
        for (var i = 0; i < s.Length; i++)
        {
            int c = s[i];
            h1 = (uint)JsMath.Imul((int)h1 ^ c, 0x01000193);
            h2 = (uint)JsMath.Imul((int)h2 ^ (c * 31 + i), 0x01000193);
        }
        return h1.ToString("x8", System.Globalization.CultureInfo.InvariantCulture) + h2.ToString("x8", System.Globalization.CultureInfo.InvariantCulture);
    }
}
