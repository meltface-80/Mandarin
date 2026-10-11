// Gain.cs — ReplayGain's levelling (v0.8.38), the pure half of lib/loudness.js,
// rule for rule: a device's Volume Levelling setting (Off, Track, Album or
// Auto, a target level, the adjustment for a track whose loudness isn't
// known) checked and changed; ebur128's summary read; tracks' loudness
// combined into an album's; a track's four numbers, from its tags or what was
// measured; and the gain each track of a list gets, in dB.
//
// The reference is ReplayGain 2.0's −18 LUFS. The target moves every gain by
// its distance from that; the peak caps the gain, so turning a track up never
// clips it; the gain is rounded to a tenth of a dB, kept within −24…+12, and
// none at all under 0.05. Auto takes the album's gain when a record is played
// in order, the track's own when tracks from different records follow one
// another or the list is shuffled.
//
// The database is the caller's: what was measured for a track and an album's
// rows are handed in (Identify/Loudness.cs measures, as before). Powers and
// logarithms are V8's (JsMath.cs), so a gain lands on the same tenth.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

using Js = Mandarin.Server.Tags.Js;

/* A levelling change refused (a 400, as the Node server answers it). */
internal sealed class LevellingError(string message) : JsError(message)
{
    public int Status => 400;
}

internal static class Gain
{
    public const double Ref = -18;
    public static readonly string[] Modes = ["off", "track", "album", "auto"];
    public const double TargetMin = -25, TargetMax = -14, UnknownMin = -12, UnknownMax = 0;
    private const string DefaultMode = "off";
    private const double DefaultTarget = -14, DefaultUnknown = -5;

    /* A device's Volume Levelling as stored, checked: { mode, target, unknown }. */
    public static JsObj Levelling(object? v)
    {
        var o = Jv.T(v) && v is JsObj or List<object?> ? v : new JsObj();
        static double Int(object? n, double lo, double hi, double d)
        {
            var x = Js.Round(Jv.Num(n));
            return double.IsFinite(x) && x >= lo && x <= hi ? x : d;
        }
        var mode = Jv.Get(o, "mode");
        return Jv.Obj(("mode", Jv.OneOf(mode, Modes) ? mode : DefaultMode),
            ("target", Int(Jv.Get(o, "target"), TargetMin, TargetMax, DefaultTarget)),
            ("unknown", Int(Jv.Get(o, "unknown"), UnknownMin, UnknownMax, DefaultUnknown)));
    }

    private static bool IsInteger(double n) => double.IsFinite(n) && Math.Floor(n) == n;

    /* A change to it, refused when out of range. */
    public static JsObj LevellingPatch(object? cur, object? patch)
    {
        if (!Jv.T(patch) || patch is not JsObj) throw new LevellingError("levelling must be an object");
        var next = Levelling(cur);
        var mode = Jv.Get(patch, "mode");
        if (mode is not Undef)
        {
            if (!Jv.OneOf(mode, Modes)) throw new LevellingError("mode is off, track, album or auto");
            next["mode"] = mode;
        }
        var target = Jv.Get(patch, "target");
        if (target is not Undef)
        {
            var n = Jv.Num(target);
            if (!IsInteger(n) || n < TargetMin || n > TargetMax) throw new LevellingError($"target is a whole number of LUFS from {Js.Num(TargetMax)} to {Js.Num(TargetMin)}");
            next["target"] = n;
        }
        var unknown = Jv.Get(patch, "unknown");
        if (unknown is not Undef)
        {
            var n = Jv.Num(unknown);
            if (!IsInteger(n) || n < UnknownMin || n > UnknownMax) throw new LevellingError($"unknown is a whole number of dB from {Js.Num(UnknownMax)} to {Js.Num(UnknownMin)}");
            next["unknown"] = n;
        }
        return next;
    }

    /* combine(parts): several tracks' loudness as one — their energy, weighted by length. */
    public static double? Combine(IEnumerable<(double Lufs, double Seconds)> parts)
    {
        double e = 0, w = 0;
        foreach (var (lufs, seconds) in parts)
        {
            var d = seconds > 0 ? seconds : 1;
            e += d * JsMath.Pow(10, lufs / 10);
            w += d;
        }
        return w > 0 && e > 0 ? 10 * JsMath.Log10(e / w) : null;
    }

    // num(v): a finite number, or null.
    private static object? Finite(object? v)
    {
        if (Jv.Nullish(v)) return null;
        var n = Jv.Num(v);
        return double.IsFinite(n) ? n : null;
    }

    /*
     * albumOf: an album's loudness from its tracks' rows ({ duration,
     * rg_track_gain, rg_track_peak, lufs, peak }) — tagged or measured — once
     * every one is known; null otherwise. → { gain, peak }
     */
    public static JsObj? AlbumOf(List<object?> rows)
    {
        if (rows.Count == 0) return null;
        var parts = new List<(object?, object?)>();
        object? peak = null;
        foreach (var r in rows)
        {
            var tg = Jv.Get(r, "rg_track_gain");
            var lufs = !Jv.Nullish(tg) ? (object?)(Ref - Jv.Num(tg)) : Jv.Get(r, "lufs");
            if (Jv.Nullish(lufs)) return null;
            parts.Add((lufs, Jv.Get(r, "duration")));
            var p = !Jv.Nullish(tg) ? Jv.Get(r, "rg_track_peak") : Jv.Get(r, "peak");
            if (!Jv.Nullish(p)) peak = Math.Max(Jv.T(peak) ? Jv.Num(peak) : 0, Jv.Num(p));
        }
        var all = CombineValues(parts);
        return all == null ? null : Jv.Obj(("gain", Ref - all.Value), ("peak", peak));
    }

    /* combine over the rows' own values: a length that is text is joined, not added, as w += d does there. */
    private static double? CombineValues(List<(object? Lufs, object? Seconds)> parts)
    {
        double e = 0;
        object w = 0.0;
        foreach (var (lufs, seconds) in parts)
        {
            var d = Jv.Num(seconds) > 0 ? seconds : 1.0;
            e += Jv.Num(d) * JsMath.Pow(10, Jv.Num(lufs) / 10);
            w = w is string || d is string or List<object?> or JsObj ? Jv.Str(w) + Jv.Str(d) : (double)w + Jv.Num(d);
        }
        var wn = Jv.Num(w);
        return wn > 0 && e > 0 ? 10 * JsMath.Log10(e / wn) : null;
    }

    /*
     * infoOf: a track's four numbers, from its tags or else from what was
     * measured. measured(id) → { lufs, peak } or null; albumRows(albumId) →
     * the album's rows; albums: the albums worked out so far, by id.
     */
    public static JsObj InfoOf(object? t, Dictionary<string, JsObj?> albums, Func<object?, object?> measured, Func<object?, List<object?>> albumRows)
    {
        object? tg = Jv.Get(t, "rg_track_gain"), tp = Jv.Get(t, "rg_track_peak");
        if (Jv.Nullish(tg))
        {
            var m = measured(Jv.Get(t, "id"));
            if (Jv.T(m)) { tg = Ref - Jv.Num(Jv.Get(m, "lufs")); tp = Jv.Get(m, "peak"); }
        }
        object? ag = Jv.Get(t, "rg_album_gain"), ap = Jv.Get(t, "rg_album_peak");
        var albumId = Jv.Get(t, "album_id");
        if (Jv.Nullish(ag) && !Jv.Nullish(albumId))
        {
            var key = MapKey(albumId);
            if (!albums.TryGetValue(key, out var a)) albums[key] = a = AlbumOf(albumRows(albumId));
            if (a != null) { ag = a["gain"]; ap = a["peak"]; }
        }
        return Jv.Obj(("track_gain", Finite(tg)), ("track_peak", Finite(tp)), ("album_gain", Finite(ag)), ("album_peak", Finite(ap)));
    }

    // A Map's key: the same for values SameValueZero calls the same.
    private static string MapKey(object? v) => v switch
    {
        double d => "n" + Js.Num(d),
        string s => "s" + s,
        bool b => b ? "true" : "false",
        _ => "o" + System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(v!)
    };

    /*
     * gainOf(info, kind, offset, unknown): the gain for one track as "track"
     * or "album", in dB; null for none. offset: the target's distance from
     * −18 LUFS; unknown: dB for a track with no loudness known.
     */
    public static object? GainOf(object? info, object? kind, double offset = 0, double unknown = 0) => GainOf(info, kind, (object?)offset, unknown);

    /* The same with offset and unknown as given there: undefined is the default 0, anything else is used as it is. */
    public static object? GainOf(object? info, object? kind, object? offset, object? unknown)
    {
        if (offset is Undef) offset = 0.0;
        if (unknown is Undef) unknown = 0.0;
        var albumFirst = Jv.Same(kind, "album");
        object? g, p;
        var ag = Jv.Get(info, "album_gain");
        var tg = Jv.Get(info, "track_gain");
        if (albumFirst) { g = !Jv.Nullish(ag) ? ag : tg; p = !Jv.Nullish(ag) ? Jv.Get(info, "album_peak") : Jv.Get(info, "track_peak"); }
        else { g = !Jv.Nullish(tg) ? tg : ag; p = !Jv.Nullish(tg) ? Jv.Get(info, "track_peak") : Jv.Get(info, "album_peak"); }
        if (Jv.Nullish(g)) return Jv.T(unknown) ? Math.Max(-24, Math.Min(0, Jv.Num(unknown))) : null;
        // g += offset: text joins rather than adds, as + does there ("3" and −7 is "3-7").
        static bool Text(object? v) => v is string or List<object?> or JsObj;
        var x = Text(g) || Text(offset) ? Js.StringToNumber(Jv.Str(g) + Jv.Str(offset)) : Jv.Num(g) + Jv.Num(offset);
        if (!Jv.Nullish(p) && Jv.Num(p) > 0) x = Math.Min(x, -20 * JsMath.Log10(Jv.Num(p)));
        x = Math.Max(-24, Math.Min(12, Js.Round(x * 10) / 10));
        return Math.Abs(x) < 0.05 ? null : x;
    }

    /*
     * gainsFor(tracks, shuffled, levelling): the gain for each of a list of
     * tracks about to be played (null for none). Auto: the album's gain for a
     * track whose neighbour is from the same record, unless shuffled.
     */
    public static List<object?> GainsFor(List<object?> tracks, object? shuffled, object? levelling, Func<object?, object?> measured, Func<object?, List<object?>> albumRows)
    {
        var s = Levelling(levelling);
        if (Jv.Same(s["mode"], "off")) return tracks.Select(_ => (object?)null).ToList();
        var albums = new Dictionary<string, JsObj?>();
        var target = (double)s["target"]!;
        var unknown = (double)s["unknown"]!;
        var out_ = new List<object?>(tracks.Count);
        for (var i = 0; i < tracks.Count; i++)
        {
            var t = tracks[i];
            var kind = (string)s["mode"]!;
            if (kind == "auto")
            {
                var album = Jv.Get(t, "album_id");
                bool Same(object? x) => Jv.T(x) && !Jv.Nullish(Jv.Get(x, "album_id")) && Jv.Same(Jv.Get(x, "album_id"), album);
                var prev = i > 0 ? tracks[i - 1] : Undef.V;
                var next = i + 1 < tracks.Count ? tracks[i + 1] : Undef.V;
                kind = !Jv.T(shuffled) && (Same(prev) || Same(next)) ? "album" : "track";
            }
            out_.Add(GainOf(InfoOf(t, albums, measured, albumRows), kind, target - Ref, unknown));
        }
        return out_;
    }

    /* parseEbur128(text): how loud a measured stretch is, from ebur128's summary. */
    public static JsObj ParseEbur128(object? text)
    {
        var (lufs, peak) = Identify.Loudness.ParseEbur128(Jv.Str(Jv.Or(text, "")));
        return Jv.Obj(("lufs", lufs), ("peak", peak));
    }
}
