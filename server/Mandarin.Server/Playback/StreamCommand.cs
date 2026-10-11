// StreamCommand.cs — the ports of v0.8.38 asked directly, through
// `mandarin-server score` (Identify/ScoreCommand.cs), a line of JSON in and a
// line out, so test/streams-csharp.test.js holds them to the Node server's:
//
//   { fn: "plans", native, ext_mime, family, renderer_mime, plan, repack, with_gain, with_dsp, args, keys, plan_for, service,
//     held_native, held_mime, held_sonos, held_keys, held_args }   lib/stream.js, playback.js; Streams.cs, Transcoder.cs
//   { fn: "gain", levelling, patch, ebur, combine, held_combine, album, info, gain_of, gains_for }   lib/loudness.js
//   { fn: "dsp", coeffs, section_db, response, sweep, peak, bands_of, headroom, normalise_band, normalise, active,
//     fingerprint, num, band_filter, filters, plan_part, held_autoeq }   public/biquad.js, lib/dsp.js; Extras/AutoEq.cs
//   { fn: "sign", secret, sigs, urls, valid, targets, queries, decode }   lib/server/auth.js
//   { fn: "radio", keys, runs: [{ saved, start, window, ops }] }   lib/radio-memory.js
//   { fn: "math", sin, cos, log, log10, pow }   JsMath.cs itself, against this machine's Math
//
// Each list is answered in order, one result for each case. Numbers JSON
// can't carry travel as { "$js": "NaN" | "Infinity" | "-Infinity" | "-0" }
// both ways, so a NaN or a −0 is compared too; a case that throws (as it
// does there) is { "$throws": true }, or { "error": message } where the
// message is what the Node server answers with.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

using Js = Mandarin.Server.Tags.Js;

internal static class StreamCommand
{
    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static object? Arg(object? args, int i) { var l = L(args); return i < l.Count ? l[i] : Undef.V; }
    private static JsObj O(object? v) => v as JsObj ?? new JsObj();

    public static JsObj Run(string fn, JsObj job0)
    {
        var job = (JsObj)Revive(job0)!;
        var o = fn switch
        {
            "plans" => Plans(job),
            "gain" => Gains(job),
            "dsp" => DspFns(job),
            "sign" => Sign(job),
            "radio" => Radio(job),
            "math" => MathFns(job),
            _ => throw new JsError("unknown fn")
        };
        return (JsObj)Mark(o)!;
    }

    // ---------------------------------------------------------------- the wire

    /* { $js: "NaN" } and the like → the value. */
    private static object? Revive(object? v)
    {
        switch (v)
        {
            case JsObj o when o.Count == 1 && o["$js"] is string s:
                return s switch
                {
                    "NaN" => double.NaN,
                    "Infinity" => double.PositiveInfinity,
                    "-Infinity" => double.NegativeInfinity,
                    "-0" => -0.0,
                    "undefined" => Undef.V,
                    _ => o
                };
            case JsObj o:
                foreach (var k in o.Keys.ToList()) o[k] = Revive(o[k]);
                return o;
            case List<object?> l:
                for (var i = 0; i < l.Count; i++) l[i] = Revive(l[i]);
                return l;
            default:
                return v;
        }
    }

    /* The other way: a NaN, an infinity or a −0 as { $js }, so it is compared. */
    private static object? Mark(object? v)
    {
        switch (v)
        {
            case double d when double.IsNaN(d) || double.IsInfinity(d) || (d == 0 && double.IsNegative(d)):
                return Jv.Obj(("$js", double.IsNaN(d) ? "NaN" : d == 0 ? "-0" : d > 0 ? "Infinity" : "-Infinity"));
            case JsObj o:
            {
                var c = new JsObj();
                foreach (var k in o.Keys) c[k] = Mark(o[k]);
                return c;
            }
            case List<object?> l:
                return l.Select(Mark).ToList();
            default:
                return v;
        }
    }

    private static readonly JsObj Throws = Jv.Obj(("$throws", true));

    /* Each case answered; one that throws, as { $throws }. */
    private static List<object?> Each(object? list, Func<object?, object?> f) => L(list).Select(x =>
    {
        try { return f(x); }
        catch (Exception e) when (e is JsError or InvalidCastException or ArgumentException or IndexOutOfRangeException) { return Throws; }
    }).ToList();

    private static List<object?> Strs(IEnumerable<string> s) => s.Select(x => (object?)x).ToList();

    // ---------------------------------------------------------------- stream plans

    private static JsObj Plans(JsObj job)
    {
        var o = new JsObj();
        o["native"] = Each(job["native"], t => StreamPlans.NativeMime(t));
        o["ext_mime"] = Each(job["ext_mime"], StreamPlans.MimeForExt);
        o["family"] = Each(job["family"], h => StreamPlans.Family(Jv.Num(h)));
        o["renderer_mime"] = Each(job["renderer_mime"], a =>
        {
            var containers = L(Arg(a, 1));
            return StreamPlans.RendererMime(Arg(a, 0), c => containers.Exists(x => x is string s && s == c));
        });
        o["plan"] = Each(job["plan"], a => StreamPlans.Plan(Arg(a, 0), Arg(a, 1)));
        o["repack"] = Each(job["repack"], a => StreamPlans.Repack(Arg(a, 0), Arg(a, 1)));
        o["with_gain"] = Each(job["with_gain"], a => StreamPlans.WithGain(Arg(a, 0), Arg(a, 1), Arg(a, 2), Arg(a, 3)));
        o["with_dsp"] = Each(job["with_dsp"], a => StreamPlans.WithDsp((JsObj)Arg(a, 0)!, Arg(a, 1), Arg(a, 2)));
        o["args"] = Each(job["args"], a => StreamPlans.FfmpegArgs(Arg(a, 0), Arg(a, 1), Arg(a, 2), Jv.T(Arg(a, 3))));
        o["keys"] = Each(job["keys"], a => StreamPlans.KeyFor(Arg(a, 0), Arg(a, 1)));
        o["plan_for"] = Each(job["plan_for"], a => StreamPlans.PlanFor(Arg(a, 0), Arg(a, 1), Arg(a, 2)));
        o["service"] = Each(job["service"], p => StreamPlans.ServiceOf(p));

        // What the C# server already does, held to the same answers.
        o["held_native"] = Each(job["held_native"], a => Streams.NativeMime(Js.Str(Arg(a, 0)), Js.Str(Arg(a, 1)), (long)Jv.Num(Arg(a, 2))));
        o["held_mime"] = Each(job["held_mime"], e => Streams.MimeForExt(Js.Str(e)));
        o["held_sonos"] = Each(job["held_sonos"], a =>
        {
            var (mime, conv) = Streams.SonosRule(Js.Str(Arg(a, 0)), Js.Str(Arg(a, 1)), (long)Jv.Num(Arg(a, 2)), (long)Jv.Num(Arg(a, 3)), (long)Jv.Num(Arg(a, 4)));
            // A conversion is sent as FLAC whatever the file's own type.
            return Jv.Obj(("mime", conv == null ? mime : "audio/flac"), ("conv", conv == null ? null
                : Jv.Obj(("rate", (double)conv.Rate), ("bits", (double)conv.Bits), ("hq", conv.Hq), ("exact", conv.Exact), ("reason", conv.Reason))));
        });
        o["held_keys"] = Each(job["held_keys"], a =>
        {
            var t = new ConvTrack((long)Jv.Num(Arg(a, 0)), "", (long)Jv.Num(Arg(a, 1)));
            return Transcoder.KeyFor(t, new ConvPlan((long)Jv.Num(Arg(a, 2)), (int)Jv.Num(Arg(a, 3)), Jv.T(Arg(a, 4)), Jv.T(Arg(a, 5)), ""));
        });
        o["held_args"] = Each(job["held_args"], a =>
        {
            var p = new ConvPlan((long)Jv.Num(Arg(a, 1)), (int)Jv.Num(Arg(a, 2)), Jv.T(Arg(a, 3)), Jv.T(Arg(a, 4)), "");
            return Strs(Transcoder.Args(Js.Str(Arg(a, 0)), p, Js.Str(Arg(a, 5)), Jv.T(Arg(a, 6))));
        });
        return o;
    }

    // ---------------------------------------------------------------- ReplayGain

    private static Func<object?, object?> Measured(object? m) => id => Jv.Get(O(m), Js.Str(id));
    private static Func<object?, List<object?>> AlbumRows(object? a) => id => L(Jv.Get(O(a), Js.Str(id)));

    private static JsObj Gains(JsObj job)
    {
        var o = new JsObj();
        o["levelling"] = Each(job["levelling"], Gain.Levelling);
        o["patch"] = Each(job["patch"], a =>
        {
            try { return Gain.LevellingPatch(Arg(a, 0), Arg(a, 1)); }
            catch (LevellingError e) { return Jv.Obj(("error", e.Message), ("status", (double)e.Status)); }
        });
        o["ebur"] = Each(job["ebur"], Gain.ParseEbur128);
        static List<(double, double)> Parts(object? list) => L(list).Select(p => (Jv.Num(Jv.Get(p, "lufs")), Jv.Num(Jv.Get(p, "seconds")))).ToList();
        o["combine"] = Each(job["combine"], ps => Gain.Combine(Parts(ps)));
        o["held_combine"] = Each(job["combine"], ps => Library.Combine(Parts(ps)));
        o["album"] = Each(job["album"], rows => Gain.AlbumOf(L(rows)));
        o["info"] = Each(job["info"], c =>
        {
            var x = O(c);
            var albums = new Dictionary<string, JsObj?>();
            return L(x["tracks"]).Select(t => (object?)Gain.InfoOf(t, albums, Measured(x["measured"]), AlbumRows(x["albums"]))).ToList();
        });
        o["gain_of"] = Each(job["gain_of"], a => Gain.GainOf(Arg(a, 0), Arg(a, 1), Arg(a, 2), Arg(a, 3)));
        o["gains_for"] = Each(job["gains_for"], c =>
        {
            var x = O(c);
            return Gain.GainsFor(L(x["tracks"]), x["shuffled"], x["levelling"], Measured(x["measured"]), AlbumRows(x["albums"]));
        });
        return o;
    }

    // ---------------------------------------------------------------- DSP

    private static List<double> Nums(object? list) => L(list).Select(Jv.Num).ToList();

    private static JsObj DspFns(JsObj job)
    {
        var o = new JsObj();
        o["coeffs"] = Each(job["coeffs"], a => Biquad.Coeffs(Arg(a, 0), Jv.Num(Arg(a, 1))).Js());
        o["section_db"] = Each(job["section_db"], a => Biquad.SectionDb(Biquad.Coeffs(Arg(a, 0), Jv.Num(Arg(a, 2))), Jv.Num(Arg(a, 1)), Jv.Num(Arg(a, 2))));
        o["response"] = Each(job["response"], a => Biquad.Response(L(Arg(a, 0)), Jv.Num(Arg(a, 1)), Nums(Arg(a, 2))).Select(d => (object?)d).ToList());
        o["sweep"] = Each(job["sweep"], a => Biquad.Sweep(L(Arg(a, 0)), Jv.Num(Arg(a, 1))).Select(d => (object?)d).ToList());
        o["peak"] = Each(job["peak"], a => Biquad.PeakDb(L(Arg(a, 0)), Jv.Num(Arg(a, 1))));
        o["bands_of"] = Each(job["bands_of"], d => Biquad.BandsOf(d));
        o["headroom"] = Each(job["headroom"], a => Biquad.Headroom(Arg(a, 0), Arg(a, 1)));
        o["normalise_band"] = Each(job["normalise_band"], b =>
        {
            try { return Biquad.NormaliseBand(b); }
            catch (BandError e) { return Jv.Obj(("error", e.Message)); }
        });
        o["normalise"] = Each(job["normalise"], d =>
        {
            try { return Biquad.Normalise(d); }
            catch (BandError e) { return Jv.Obj(("error", e.Message)); }
        });
        o["active"] = Each(job["active"], d => Biquad.Active(d));
        o["fingerprint"] = Each(job["fingerprint"], a => Biquad.Fingerprint(Arg(a, 0), Arg(a, 1)));
        o["num"] = Each(job["num"], Dsp.Num);
        o["band_filter"] = Each(job["band_filter"], Dsp.BandFilter);
        o["filters"] = Each(job["filters"], a => Strs(Dsp.Filters(Arg(a, 0), Arg(a, 1), Arg(a, 2), Jv.T(Arg(a, 3)))));
        o["plan_part"] = Each(job["plan_part"], a => Dsp.PlanPart(Arg(a, 0), Arg(a, 1)));
        // AutoEq's typed twin of normaliseBand (Extras/AutoEq.cs).
        o["held_autoeq"] = Each(job["held_autoeq"], a =>
        {
            try { return Extras.AutoEq.NormaliseBand(Js.Str(Arg(a, 0)), Jv.Num(Arg(a, 1)), Jv.Num(Arg(a, 2)), Jv.Num(Arg(a, 3))); }
            catch (Extras.AutoEqError e) { return Jv.Obj(("error", e.Message)); }
        });
        return o;
    }

    // ---------------------------------------------------------------- signing

    private static JsObj Sign(JsObj job)
    {
        var secret = Js.Str(job["secret"]);
        var o = new JsObj();
        o["sigs"] = Each(job["sigs"], p => Signing.Sig(secret, Js.Str(p)));
        o["urls"] = Each(job["urls"], u => Signing.SignUrl(secret, Js.Str(u)));
        o["valid"] = Each(job["valid"], a => Signing.Valid(secret, Js.Str(Arg(a, 0)), Js.Str(Arg(a, 1))));
        o["targets"] = Each(job["targets"], t => Signing.Gate(secret, Js.Str(t)) is { } b ? b : null);
        o["queries"] = Each(job["queries"], q => Signing.QueryS(Js.Str(q)));
        o["decode"] = Each(job["decode"], s => Signing.DecodeURIComponent(Js.Str(s)));
        return o;
    }

    // ---------------------------------------------------------------- V8's Math, as JsMath.cs has it

    private static JsObj MathFns(JsObj job)
    {
        var o = new JsObj();
        o["sin"] = Each(job["sin"], x => JsMath.Sin(Jv.Num(x)));
        o["cos"] = Each(job["cos"], x => JsMath.Cos(Jv.Num(x)));
        o["log"] = Each(job["log"], x => JsMath.Log(Jv.Num(x)));
        o["log10"] = Each(job["log10"], x => JsMath.Log10(Jv.Num(x)));
        o["pow"] = Each(job["pow"], a => JsMath.Pow(Jv.Num(Arg(a, 0)), Jv.Num(Arg(a, 1))));
        return o;
    }

    // ---------------------------------------------------------------- the radio's memory

    private static JsObj Radio(JsObj job)
    {
        var o = new JsObj();
        o["keys"] = Each(job["keys"], al => RadioMemory.RadioKey(al));
        o["runs"] = Each(job["runs"], r0 =>
        {
            var r = O(r0);
            var clock = Jv.Num(r["start"]);
            JsObj? written = null;
            var saved = r["saved"];
            var m = new RadioMemory(() => saved, x => written = x, () => clock, r["window"]);
            var results = new List<object?>();
            foreach (var op0 in L(r["ops"]))
            {
                var op = O(op0);
                switch (Js.Str(op["op"]))
                {
                    case "tick": clock += Jv.Num(op["ms"]); results.Add(null); break;
                    case "note": m.Note(op["key"] as string); results.Add(null); break;
                    case "at": results.Add(m.PlayedAt(op["key"] as string)); break;
                    case "size": results.Add((double)m.Size); break;
                    case "pick":
                    {
                        var pool = L(op["pool"]);
                        var heard = op["heard"] is List<object?> ids ? (Func<object?, bool>)(al => Jv.Includes(ids, Jv.Get(al, "id"))) : null;
                        var rnd = L(op["rnd"]).Select(Jv.Num).ToList();
                        var i = 0;
                        Func<object?, string?> keyOf = Js.Str(op["by"]) == "radio" ? al => RadioMemory.RadioKey(al) : al => Jv.Get(al, "key") as string;
                        var at = m.Pick(pool, keyOf, heard, () => rnd[i++ % rnd.Count]);
                        results.Add(at < 0 ? null : (double)at);
                        break;
                    }
                    default: results.Add(Throws); break;
                }
            }
            return Jv.Obj(("results", results), ("saved", written));
        });
        return o;
    }
}
