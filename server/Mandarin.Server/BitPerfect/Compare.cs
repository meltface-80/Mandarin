// Compare.cs — what reached the DAC against what was sent, frame by frame (bug list item 275), as SQ-tool compares
// a recording with its file (github.com/meltface-80/SQ-tool, analysis.py).
//
// The recording is found in what was sent by its first frames that aren't silence: [Window] of them, the same
// numbers in the same order, wherever they are in the track (a recording may begin anywhere in it). From there the
// two are walked together. Where they part: silence in the recording that the track hasn't (an underrun), or the
// track found again a little before or after (a seek's flush, a repeat, frames lost), is a dropout, and the walk goes
// on from there; else the frames differ. Silence after the track's end is the device idling, not a difference.
//
// The verdict, SQ-tool's: bit-perfect (every frame compared the same), dropouts (the same, with gaps or jumps),
// altered (most the same), not bit-perfect (the frames differ throughout: the level it is off by said, where PCM),
// or resampled (another rate than was sent: nothing to compare frame by frame).
namespace Mandarin.Server.BitPerfect;

internal static class Compare
{
    /* The frames that find a recording in what was sent, and that find the track again after a dropout. */
    public const int Window = 64;

    /* A dropout found again within this many seconds of where it was lost. */
    public const double Reach = 2;

    /* A dropout: where in the track (seconds), and what: "silence" (an underrun), "skip" (frames lost), "repeat". */
    public sealed record Dropout(double At, string Kind);

    /* What one recording showed. */
    public sealed record Result(string Verdict, long Compared, long Same, long Differing, double? FirstDifference,
        double From, double To, List<Dropout> Dropouts, double? LevelDb)
    {
        public static Result Resampled() => new("resampled", 0, 0, 0, null, 0, 0, [], null);
        public static Result NotFound() => new("not-found", 0, 0, 0, null, 0, 0, [], null);
    }

    /* [got] (what reached the DAC) against [sent] (what was sent). */
    public static Result Of(Frames sent, Frames got)
    {
        if (sent.Dsd != got.Dsd || Math.Abs(sent.Rate - got.Rate) > 0.5) return Result.Resampled();
        if (Find(sent, got, First(got, 0), 0, sent.Count) is not { } start) return Level(sent, got);
        var (i, j) = start;
        long same = 0, differing = 0, compared = 0;
        double? first = null;
        var drops = new List<Dropout>();
        var reach = (long)(sent.Rate * Reach);
        double sumS = 0, sumG = 0;
        var from = j;
        long retryAt = 0;
        while (i < got.Count && j < sent.Count)
        {
            var g = got[i];
            var s = sent[j];
            if (g == s) { same++; compared++; i++; j++; continue; }
            // Where the recording is silence to its end, the track has stopped playing: nothing more to compare.
            if (got.Quiet(g) && QuietFrom(got, i)) break;
            if (compared >= retryAt)
            {
                // Silence in the recording, and the track found again just after it: an underrun.
                var after = First(got, i);
                if (after > i && Find(sent, got, after, j, Math.Min(sent.Count, j + reach)) is { } back && back.Item2 == j)
                {
                    drops.Add(new(j / sent.Rate, "silence"));
                    i = back.Item1; continue;
                }
                // The track found again a little before or after: frames lost, or played again.
                if (Find(sent, got, i, Math.Max(0, j - reach), Math.Min(sent.Count, j + reach)) is { } again && again.Item2 != j)
                {
                    drops.Add(new(j / sent.Rate, again.Item2 > j ? "skip" : "repeat"));
                    j = again.Item2; continue;
                }
                retryAt = compared + (long)sent.Rate;   // not found: a second on before looking again
            }
            first ??= j / sent.Rate;
            differing++; compared++;
            if (!sent.Dsd) { sumS += Energy(s); sumG += Energy(g); }
            i++; j++;
        }
        var verdict = differing == 0 ? drops.Count == 0 ? "bit-perfect" : "dropouts" : differing * 2 < compared ? "altered" : "not-bit-perfect";
        double? level = !sent.Dsd && differing > 0 && sumS > 0 && sumG > 0 ? Math.Round(10 * Math.Log10(sumG / sumS), 2) : null;
        return new(verdict, compared, same, differing, first, from / sent.Rate, j / sent.Rate, drops, level);
    }

    // The recording's first frame from [i] that isn't silence (its end where there's none).
    private static long First(Frames f, long i)
    {
        while (i < f.Count && f.Quiet(f[i])) i++;
        return i;
    }

    private static bool QuietFrom(Frames f, long i) => First(f, i) >= f.Count;

    // [got]'s [Window] frames from [at] in [sent] between [lo] and [hi]: where they start in each; null where not found.
    private static (long, long)? Find(Frames sent, Frames got, long at, long lo, long hi)
    {
        var n = (int)Math.Min(Window, got.Count - at);
        if (n <= 0) return null;
        var head = got[at];
        for (var j = lo; j + n <= hi; j++)
        {
            if (sent[j] != head) continue;
            var k = 1;
            while (k < n && sent[j + k] == got[at + k]) k++;
            if (k == n) return (at, j);
        }
        return null;
    }

    private static double Energy(ulong f)
    {
        double l = (int)(f >> 32), r = (int)(uint)f;
        return l * l + r * r;
    }

    // Found nowhere: PCM whose level was changed, its sound the track's (their first sounds lined up, and the two
    // the same but for their level: correlated to 0.999); anything else isn't the track that was sent.
    private static Result Level(Frames sent, Frames got)
    {
        if (sent.Dsd || got.Count == 0) return Result.NotFound();
        long a = First(sent, 0), b = First(got, 0);
        var n = Math.Min(sent.Count - a, got.Count - b);
        if (n <= 0) return Result.NotFound();
        double s = 0, g = 0, sg = 0;
        for (long k = 0; k < n; k++)
        {
            var x = sent[a + k]; var y = got[b + k];
            double xl = (int)(x >> 32), xr = (int)(uint)x, yl = (int)(y >> 32), yr = (int)(uint)y;
            s += xl * xl + xr * xr; g += yl * yl + yr * yr; sg += xl * yl + xr * yr;
        }
        if (s <= 0 || g <= 0 || sg / Math.Sqrt(s * g) < 0.999) return Result.NotFound();
        return new("not-bit-perfect", n, 0, n, a / sent.Rate, a / sent.Rate, (a + n) / sent.Rate, [], Math.Round(10 * Math.Log10(g / s), 2));
    }
}
