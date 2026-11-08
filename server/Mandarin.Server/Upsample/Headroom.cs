// Headroom.cs — a track turned down just enough that its upsampling doesn't clip, and what was clipped said as it is
// made (bug list item 348).
//
// A track mastered to full scale has peaks between its samples above it: the upsampler draws them (a sine at a quarter
// of the rate, its samples at full scale, peaks 3 dB over them), and PCM's word can't hold them, so the file made was
// clipped there, silently. The DSP's Auto headroom (Playback/Biquad.cs) allowed for what its bands lift, never for
// this, and nothing at all with the DSP off. Now:
//
//   - Each making counts the samples it clips (UpsampleCommand.cs: PCM's over full scale, DSD's held at +2.9 dB) and
//     says so as it goes; the track's upsampling line on Now playing turns red (Playback/SignalPath.cs).
//   - A device's Output has Headroom when upsampling: Auto (the default) or Off. Auto turns a track that Mandarin
//     upsamples, or makes DSD of, down by what its peaks between samples need after its levelling, and half a dB more:
//     its true peak as the loudness scan measured it, or as an upsampling of it measured it, whichever is the higher.
//     A track that doesn't need it keeps its level. DSD has room to +2.9 dB before anything is held, which is allowed
//     for. With the DSP's Auto headroom on, that already has its half a dB; one set by hand is left as set.
//   - Its turn-down travels in the stream's gain (?g=), so the file is named by it and made with it; the signal path
//     says it as a step of its own.
using System.Collections.Concurrent;
using Microsoft.Data.Sqlite;
using JsObj = Mandarin.Server.Tags.JsObj;
using Jv = Mandarin.Server.Playback.Jv;

namespace Mandarin.Server.Upsample;

internal static class Headroom
{
    /* Half a dB under full scale, as the DSP's own (Biquad.HeadroomMargin). */
    public const double Margin = 0.5;
    /* DSD's room over full-scale PCM before a sample is held (UpsampleCommand.Most: 1.4, +2.9 dB). */
    public static readonly double DsdRoom = 20 * Math.Log10(UpsampleCommand.Most);

    /* What a making has clipped so far ([Samples]), its peak ([Peak], linear), and whether it is [Done]. */
    public sealed record Clipped(long Samples, double Peak, bool Done);

    private static readonly ConcurrentDictionary<string, Clipped> Live = new();

    /* Making [key] has clipped [samples] so far, its peak [peak]. */
    public static void Saw(string key, long samples, double peak)
    {
        if (Live.Count > 64) foreach (var k in Live.Where(kv => kv.Value.Done).Select(kv => kv.Key).Take(32).ToList()) Live.TryRemove(k, out _);
        Live[key] = new Clipped(samples, peak, false);
    }

    /* Making [key] done: [samples] clipped in all, its peak [peak]. */
    public static void Finished(string key, long samples, double peak) => Live[key] = new Clipped(samples, peak, true);

    /* What making [key] has clipped; null where nothing is known of it. */
    public static Clipped? Of(string? key) => key != null && Live.TryGetValue(key, out var c) ? c : null;

    /* Whether [target] (a device's) has Headroom when upsampling off. */
    public static bool Off(object? target) => Jv.Same(Jv.Get(target, "headroom"), "off");

    /*
     * The turn-down in dB (≤ 0) for track [id] upsampled for [target] at [gain] dB of levelling, made DSD where [dsd]:
     * as much as its true peak is over full scale (DSD's room allowed), and half a dB, where the DSP's Auto headroom
     * doesn't already give it; 0 where nothing is known of its peak, or Headroom when upsampling is off.
     */
    public static double For(long id, object? target, double gain, bool dsd)
    {
        if (Off(target)) return 0;
        var dsp = Jv.Get(target, "dsp");
        var dspOn = Playback.Biquad.Active(dsp) || Playback.Convolution.Files(dsp) != null;
        if (dspOn && Jv.Get(dsp, "headroom") is double) return 0;   // set by hand: as set
        double? peak;
        try { using var c = Db.Open(); peak = PeakOf(c, id); }
        catch (SqliteException) { peak = null; }
        if (peak is not { } p || p <= 0 || !double.IsFinite(p)) return 0;
        var over = 20 * Math.Log10(p) + gain - (dsd ? DsdRoom : 0) + (dspOn ? 0 : Margin);
        return over > 0 ? -Math.Round(over * 10, MidpointRounding.AwayFromZero) / 10 : 0;
    }

    /* Track [id]'s true peak, linear: the higher of the loudness scan's and what an upsampling of it measured; null if neither. */
    public static double? PeakOf(SqliteConnection c, long id)
    {
        Ensure(c);
        var rows = Library.Rows(c, "SELECT (SELECT peak FROM track_loudness WHERE track_id = $1), (SELECT peak FROM track_peaks WHERE track_id = $1)", id);
        if (rows.Count == 0) return null;
        static double? D(object? v) => v switch { double d => d, long l => l, _ => null };
        var (scan, made) = (D(rows[0][0]), D(rows[0][1]));
        return scan is null && made is null ? null : Math.Max(scan ?? 0, made ?? 0);
    }

    /* What a making of track [id] by [p] measured, its peak [peak] at the rate it was made: kept as the track's own (its gain taken off). */
    public static void Measured(long id, ConvPlan p, double peak)
    {
        if (peak <= 0 || !double.IsFinite(peak) || p.Dsp != null) return;   // through a DSP: its bands' lift in it, not the track's own
        var own = peak / Math.Pow(10, p.Gain / 20);
        try
        {
            using var c = Db.Open();
            Ensure(c);
            using var cmd = c.CreateCommand();
            cmd.CommandText = @"INSERT INTO track_peaks(track_id, peak, measured_at) SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM tracks WHERE id = $1)
                ON CONFLICT(track_id) DO UPDATE SET peak = max(peak, excluded.peak), measured_at = excluded.measured_at";
            cmd.Parameters.AddWithValue("$1", id);
            cmd.Parameters.AddWithValue("$2", own);
            cmd.Parameters.AddWithValue("$3", (long)Playback.Hub.Now());
            cmd.ExecuteNonQuery();
        }
        catch (SqliteException e) { Server.Log("[upsample] couldn't keep a track's peak: " + e.Message); }
    }

    // The table of peaks measured by upsampling, made where it isn't yet (Schema.cs is full).
    private static volatile bool made;
    private static void Ensure(SqliteConnection c)
    {
        if (made) return;
        using var cmd = c.CreateCommand();
        cmd.CommandText = "CREATE TABLE IF NOT EXISTS track_peaks (track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE, peak REAL NOT NULL, measured_at INTEGER NOT NULL)";
        cmd.ExecuteNonQuery();
        made = true;
    }

    /* [plan] (a renderer's, for track [id] at [target]) turned down where its upsampling needs it: its gain and its "headroom". */
    public static JsObj Into(JsObj plan, long id, object? target)
    {
        if (target == null || !Jv.T(plan["transcode"])) return plan;
        var dsd = Jv.T(plan["dsdUp"]);
        if (!dsd && !Jv.T(plan["upsampled"])) return plan;
        var gain = Jv.T(plan["gain"]) ? Jv.Num(plan["gain"]) : 0;
        var h = For(id, target, gain, dsd);
        if (h >= 0) return plan;
        plan["gain"] = Math.Round((gain + h) * 10, MidpointRounding.AwayFromZero) / 10;
        plan["headroom"] = h;
        return plan;
    }
}
