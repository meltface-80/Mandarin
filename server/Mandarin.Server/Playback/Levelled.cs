// Levelled.cs — the headroom a DSP setting is given, allowing for what volume levelling has done (bug list item 263).
//
// Levelling comes first, in the order the owner set (decode → 64-bit float → levelling → headroom → DSP → upsampling
// → out). The headroom (Biquad.Headroom) is what the DSP's bands and a room correction lift a track by at most, and
// half a dB more: enough for a track that peaks at full scale. Levelling never takes a track whose peak is known over
// full scale (Gain.GainOf caps the gain by the peak), so for it that headroom is the right one, and it is the same for
// every track: a headroom that changed with each track's peak would undo the levelling, a track that peaks low
// playing louder than its neighbour by up to all the DSP lifts. A track turned up whose peak isn't known (a gain with
// no peak beside it) may go over full scale: its headroom is the DSP's and that much more, so that it doesn't clip.
// A headroom set by hand is as it was set.
//
// It is worked out where the file is made (Transcoder.Start), and its name is the plan's as it was: the track and its
// gain name what it is made from, and the file a device is promised is the one it is sent.
using Microsoft.Data.Sqlite;
using TJs = Mandarin.Server.Tags.Js;

namespace Mandarin.Server.Playback;

internal static class Levelled
{
    /* [p] as it is made from track [id]: its DSP's headroom and what its gain may take over full scale. */
    public static ConvPlan Into(long id, ConvPlan p)
    {
        if (p.Dsp == null || p.Gain <= 0 || Fixed(Jv.Get(p.Dsp, "dsp")) || Jv.Get(p.Dsp, "headroom") is not double auto) return p;
        double? peak;
        try { using var c = Db.Open(); peak = PeakOf(c, id); }
        catch (SqliteException) { peak = null; }
        var h = Headroom(auto, peak ?? 1, p.Gain);
        if (h == auto) return p;
        var dsp = Jv.CopyWithout(p.Dsp, "headroom");
        dsp["headroom"] = h;
        return p with { Dsp = dsp };
    }

    /*
     * The headroom for a track peaking at [peak] (linear, 1 full scale; 0 or less: not known, taken as full scale)
     * turned [gain] dB by levelling, the DSP's own being [auto] (≤ 0): [auto], and as much more as the levelled peak is over full scale.
     */
    public static double Headroom(double auto, double peak, double gain)
    {
        var p = peak > 0 && double.IsFinite(peak) ? Math.Min(1, peak) : 1;
        var over = Math.Max(0, 20 * Math.Log10(p) + gain);
        return Math.Min(0, TJs.Round((auto - over) * 10) / 10);
    }

    // A headroom set by hand (a number, not "auto").
    private static bool Fixed(object? dsp) => Jv.Get(dsp, "headroom") is double;

    // Track [id]'s own peak, linear: its tag where its gain is tagged, else what was measured of it; null if neither.
    private static double? PeakOf(SqliteConnection c, long id)
    {
        var rows = Library.Rows(c, "SELECT t.rg_track_gain, t.rg_track_peak, l.lufs, l.peak FROM tracks t LEFT JOIN track_loudness l ON l.track_id = t.id WHERE t.id = $1", id);
        if (rows.Count == 0) return null;
        var r = rows[0];
        var v = r[0] != null ? r[1] : r[2] != null ? r[3] : null;
        return v switch { double d => d, long l => l, _ => null };
    }
}
