// Streams.Runs.cs — /stream/a<id>_<id>….<plan>.<ext>: an album's tracks as one stream (bug list item 300).
//
// The plan is the first track's, as /stream/t<id> has it (its rate and depth, or DSD from PCM, its filter, gain and
// DSP); the tracks are the album's, one after the other, each a lossless file of the library at the first's rate.
// ?ss=<seconds>: begun that far into the first. Made as it plays, as one track is (Upsample/AlbumRun.cs), and sent as
// it is made: a DSF or a WAV with its length, which takes ranges; a FLAC without.
using System.Globalization;

namespace Mandarin.Server;

internal static partial class Streams
{
    // The run [ids] by [p], its first track at [rate], begun [ss] into it.
    private static async Task<bool> AnswerRun(HttpContext ctx, string ids, Tags.JsObj p, long rate, (bool Here, string? Value)? ss)
    {
        var at = 0.0;
        if (ss is { Here: true } sq && (!double.TryParse(sq.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out at) || !double.IsFinite(at) || at < 0)) return Refuse(ctx, 400);
        var tracks = new List<ConvTrack>();
        var seconds = new List<double>();
        using (var c = Db.Open())
        {
            foreach (var part in ids.Split('_'))
            {
                if (!long.TryParse(part, out var id)) return Refuse(ctx, 400);
                using var cmd = c.CreateCommand();
                cmd.CommandText = "SELECT path, mtime, duration, sample_rate, lossless FROM tracks WHERE id = $id";
                cmd.Parameters.AddWithValue("$id", id);
                using var r = cmd.ExecuteReader();
                if (!r.Read()) return Refuse(ctx, 404);
                var path = r.GetString(0);
                // Each a lossless file of the library, there, at the first's rate: one stream of one rate.
                if (r.IsDBNull(4) || r.GetInt64(4) == 0 || (r.IsDBNull(3) ? 0 : r.GetInt64(3)) != rate || path.Contains("://", StringComparison.Ordinal) || !File.Exists(path)) return Refuse(ctx, 400);
                tracks.Add(new ConvTrack(id, path, r.IsDBNull(1) ? 0 : (long)Math.Floor(Convert.ToDouble(r.GetValue(1), CultureInfo.InvariantCulture))));
                seconds.Add(r.IsDBNull(2) ? 0 : Convert.ToDouble(r.GetValue(2), CultureInfo.InvariantCulture));
            }
        }
        if (at >= seconds[0]) return Refuse(ctx, 400);
        // The run is made from the tracks' own rate, as a track's upsampling is.
        if (!Playback.Jv.T(p["inRate"])) p["inRate"] = (double)rate;
        var plan = ConvPlan.Of(p);
        if (!Upsample.AlbumRun.Takes(plan)) return Refuse(ctx, 400);
        var albumRun = new Upsample.AlbumRun(tracks, seconds, at);
        var job = Transcoder.StartRun(albumRun, plan);
        var mime = Playback.Jv.Str(p["mime"]);
        if (job.Done && !job.Failed) return await SendFile(ctx, job.Final, mime);
        if (job.Done) { ctx.Response.StatusCode = 500; ctx.Response.Headers["X-Mandarin-Answered"] = "C#"; return true; }
        var length = albumRun.Bytes(plan);
        await Transcoder.TailFollow(ctx, job, mime, length > 0 ? length : -1);
        return true;
    }
}
