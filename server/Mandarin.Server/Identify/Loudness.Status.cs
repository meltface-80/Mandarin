// Loudness.Status.cs — what the settings page reads of the measuring (v0.8.19; out of Loudness.cs in item 411):
// the counts, why it is or isn't measuring now, and the album being measured.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

internal sealed partial class Loudness
{
    /* The album being measured now ({ offset, title, subtitle }), or null: the Album Scanner's "Now:" line (item 411). */
    public JsObj? Measuring
    {
        get { lock (gate) return jobs.Count > 0 ? current : null; }
    }

    /* Albums queued or being measured: work under way between two of them. */
    public bool Busy
    {
        get { lock (gate) return jobs.Count > 0 || queue.Count > 0; }
    }

    /*
     * For the settings page: the counts (files here only — Qobuz and Tidal
     * tracks apart, as "streamed"), and why it is or isn't measuring now:
     * off, waiting (outside the hours), scanning (the library), identifying
     * (the scan first), measuring, done.
     */
    public JsObj Status(LibState? st)
    {
        double tracks, tagged, measured, failed, streamed;
        using (var c = Db.Open())
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = @"SELECT
                (SELECT COUNT(*) FROM tracks WHERE path NOT LIKE '%://%') AS tracks,
                (SELECT COUNT(*) FROM tracks WHERE rg_track_gain IS NOT NULL AND path NOT LIKE '%://%') AS tagged,
                (SELECT COUNT(*) FROM track_loudness l JOIN tracks t ON t.id = l.track_id WHERE t.rg_track_gain IS NULL AND l.lufs IS NOT NULL) AS measured,
                (SELECT COUNT(*) FROM track_loudness l JOIN tracks t ON t.id = l.track_id WHERE t.rg_track_gain IS NULL AND l.lufs IS NULL) AS failed,
                (SELECT COUNT(*) FROM tracks WHERE path LIKE '%://%') AS streamed";
            using var r = cmd.ExecuteReader();
            r.Read();
            tracks = r.GetInt64(0); tagged = r.GetInt64(1); measured = r.GetInt64(2); failed = r.GetInt64(3); streamed = r.GetInt64(4);
        }
        var left = Math.Max(0, tracks - tagged - measured - failed);
        bool running;
        JsObj? cur;
        string why;
        lock (gate) { running = jobs.Count > 0; cur = current; why = idle; }
        string reason = !On ? "off"
            : left == 0 && !running ? "done"
            : running ? "measuring"
            : !InHours() ? "waiting"
            : st is { Scanning: true } ? "scanning"
            : AlbumScanner.Playing() ? "playing"
            : why == "identifying" ? "identifying"
            : "measuring";
        var o = new JsObj();
        o["settings"] = Settings();
        o["tracks"] = tracks;
        o["tagged"] = tagged;
        o["measured"] = measured;
        o["failed"] = failed;
        o["left"] = left;
        o["streamed"] = streamed;
        o["reason"] = reason;
        o["current"] = reason == "measuring" ? cur : null;
        o["measuring"] = reason == "measuring";
        return o;
    }
}
