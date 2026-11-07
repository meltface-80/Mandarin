// AlbumRun.cs — an album's tracks made as one stream, start to end (bug list item 300).
//
// Each track goes to a device as a file of its own, made on from the one before so the two are the one stream the
// album makes (Joins.cs, item 262): gapless only as far as the device joins them, and a Chord Poly playing DSD to a
// Mojo 2 squealed between two such files, and named the first all through the second (item 299). With a device's
// "Albums as one stream" on, a run of an album's tracks in order goes as one: their files decoded one after the other
// (ffmpeg's concat), upsampled once, made DSD once, into one WAV, FLAC or DSF, as one track is (MadeAsPlayed.cs). The
// device opens one file at the album's start, and never another until the album is done; the server says which track
// is playing from where it is in the run (Renderers/Players.Albums.cs). A run begins at any of its tracks, and some
// way into it ([Start], seconds): a skip, or a seek, starts it again there.
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Mandarin.Server.Upsample;

internal sealed class AlbumRun(IReadOnlyList<ConvTrack> tracks, IReadOnlyList<double> seconds, double start)
{
    /* The run's tracks in order, each its length as the library has it, and the seconds into the first it begins at. */
    public IReadOnlyList<ConvTrack> Tracks { get; } = tracks;
    public IReadOnlyList<double> Seconds { get; } = seconds;
    public double Start { get; } = Math.Max(0, start);

    /* Its length in seconds, from where it begins. */
    public double Total => Math.Max(0, Seconds.Sum() - Start);

    /* The cache's name of the run made by [p]: its tracks (each with its time) and where it begins, then the first track's own name for [p], whose end says the file's kind. */
    public string KeyFor(ConvPlan p)
    {
        var who = string.Join(",", Tracks.Select(t => t.Id.ToString(CultureInfo.InvariantCulture) + ":" + t.Mtime.ToString(CultureInfo.InvariantCulture)));
        var h = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(who)))[..16].ToLowerInvariant();
        var at = Start > 0 ? "s" + ((long)Math.Round(Start * 1000)).ToString(CultureInfo.InvariantCulture) : "";
        return "a" + h + at + "-" + Transcoder.KeyFor(Tracks[0], p);
    }

    /* Whether [p] makes a run: a DSF from PCM, or PCM upsampled by a power of two (each in Mandarin's own filter). */
    public static bool Takes(ConvPlan p) => p.DsdUp != 0 || p.InRate > 0 && p.Rate % (long)p.InRate == 0 && MadeAsPlayed.Power(p.Rate / (long)p.InRate);

    /* The run's file's size in bytes made by [p]: a DSF's or a WAV's, its header's length; 0 for a FLAC, whose length isn't said. */
    public long Bytes(ConvPlan p) => p.DsdUp != 0 ? DsdPlan.RunBytes(p, Total) : p.Wav ? WavHeader.FileBytes(p, Total) : 0;

    /* ffmpeg's concat list of the run's files, written beside [dest]. */
    public string List(string dest)
    {
        var list = dest + ".txt";
        File.WriteAllText(list, string.Concat(Tracks.Select(t => "file '" + t.Path.Replace("'", "'\\''", StringComparison.Ordinal) + "'\n")));
        return list;
    }

    /*
     * The making's job (UpsampleCommand.cs) for the run by [p] into [dest]: the first track's job, read from [list] (the
     * tracks one after the other) instead of its file, from [Start] (the samples before it dropped, at the files' own
     * rate), its length the run's. Nothing joined: the run is the album's stream itself.
     */
    public JsonObject Job(ConvPlan p, string dest, string list)
    {
        var first = Tracks[0].Path;
        var o = p.DsdUp != 0 ? DsdPlan.Job(first, p, dest, Transcoder.Soxr, Total) : MadeAsPlayed.PcmJob(first, p, dest, null, Total);
        var decode = (JsonArray)o["decode"]!;
        var i = Enumerable.Range(0, decode.Count - 1).First(k => (string?)decode[k] == "-i" && (string?)decode[k + 1] == first);
        decode[i + 1] = list;
        foreach (var a in new[] { "concat", "-f", "0", "-safe" }) decode.Insert(i, a);   // -safe 0 -f concat -i <list>
        if (Start > 0)
        {
            var trim = "atrim=start_sample=" + ((long)Math.Round(Start * p.InRate)).ToString(CultureInfo.InvariantCulture) + ",asetpts=N/SR/TB";
            var af = Enumerable.Range(0, decode.Count - 1).FirstOrDefault(k => (string?)decode[k] == "-af", -1);
            if (af >= 0) decode[af + 1] = trim + "," + (string?)decode[af + 1];
            else
            {
                var vn = Enumerable.Range(0, decode.Count).First(k => (string?)decode[k] == "-vn");
                decode.Insert(vn + 1, trim);
                decode.Insert(vn + 1, "-af");
            }
        }
        return o;
    }
}
