// Levelled.cs — the headroom a DSP setting is given, less what volume levelling has already left under full scale
// (bug list item 263).
//
// The headroom (Biquad.Headroom) is what the DSP's bands and a room correction lift a track by at most, and half a
// dB more: enough for a track that peaks at full scale. Levelling comes first, in the order the owner set (decode →
// 64-bit float → levelling → headroom → DSP → upsampling → out), and a loud record levelled down 8 dB already peaks
// 8 dB under full scale: the headroom taken off it as well left it that much quieter than it need be. Now a track
// levelled (a gain on its plan) whose peak is known (tagged with its gain, else measured, as Gain.InfoOf has it) has
// its headroom less what its levelled peak is under full scale, never above 0 dB: what is lifted never clips, and
// nothing more is taken off. A headroom set by hand is as it was set; a track whose peak isn't known, as before.
//
// It is worked out where the file is made (Transcoder.Start), and its name is the plan's as it was: the track and its
// gain name what it is made from, and the file a device is promised is the one it is sent.
using Microsoft.Data.Sqlite;
using TJs = Mandarin.Server.Tags.Js;

namespace Mandarin.Server.Playback;

internal static class Levelled
{
    /* [p] as it is made from track [id]: its DSP's headroom less what its gain leaves its peak under full scale. */
    public static ConvPlan Into(long id, ConvPlan p)
    {
        if (p.Dsp == null || p.Gain == 0 || Fixed(Jv.Get(p.Dsp, "dsp"))) return p;
        double? peak;
        try { using var c = Db.Open(); peak = PeakOf(c, id); }
        catch (SqliteException) { return p; }
        if (peak is not { } pk || Jv.Get(p.Dsp, "headroom") is not double auto) return p;
        var dsp = Jv.CopyWithout(p.Dsp, "headroom");
        dsp["headroom"] = Headroom(auto, pk, p.Gain);
        return p with { Dsp = dsp };
    }

    /* The headroom for a track peaking at [peak] (linear, 1 full scale) turned [gain] dB by levelling, the DSP's own being [auto] (≤ 0). */
    public static double Headroom(double auto, double peak, double gain)
    {
        if (!(peak > 0) || !double.IsFinite(peak)) return auto;
        var under = -(20 * Math.Log10(peak) + gain);   // how far under full scale the levelled track peaks
        return Math.Min(0, TJs.Round((auto + under) * 10) / 10);
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
