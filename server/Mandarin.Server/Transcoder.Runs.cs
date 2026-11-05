// Transcoder.Runs.cs — an album's tracks made as one file (bug list item 300: Upsample/AlbumRun.cs).
//
// As a track's conversion is (Transcoder.cs Start): made already, that file; being made, that making joined; else
// begun now, made as it plays by `mandarin-server upsample`, and kept in the cache under the run's own name.
using System.Globalization;
using System.Text;

namespace Mandarin.Server;

internal static partial class Transcoder
{
    /* [run] made by [p]: its file where it is made already, its making where one is under way, else one begun now. */
    public static ConvJob StartRun(Upsample.AlbumRun run, ConvPlan p)
    {
        var key = run.KeyFor(p);
        var dest = FinalPath(key);
        if (File.Exists(dest))
        {
            var now = DateTime.UtcNow;
            try { File.SetLastWriteTimeUtc(dest, now); File.SetLastAccessTimeUtc(dest, now); } catch (IOException) { /* best effort */ }
            var done = new ConvJob { Key = key, Part = dest, Final = dest, Done = true };
            done.Finished.TrySetResult();
            return done;
        }
        var job = new ConvJob { Key = key, Part = dest + ".part", Final = dest };
        var existing = Jobs.GetOrAdd(key, job);
        if (existing != job) return existing;
        var err = new StringBuilder();
        var first = run.Tracks[0].Path;
        Server.Log($"[stream] {Path.GetFileName(first)} and the {run.Tracks.Count - 1} track(s) after it, as one stream: {p.Reason} → {(p.DsdUp != 0 ? $"DSF, DSD{p.DsdUp}" : $"{(p.Wav ? "WAV" : "FLAC")} {p.Bits}/{(p.Rate / 1000.0).ToString(CultureInfo.InvariantCulture)} kHz")}");
        Upsample.MadeAsPlayed.StartRun(run, p, job, code => Ended(job, dest, first, err, code), err);
        Watched(job);
        return job;
    }
}
