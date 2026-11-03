// ConvolutionLead.cs — where a response resampled to a track's rate starts (bug list item 258).
//
// A response made at another rate than the track's is resampled to it, with silence laid before it so the resampler
// doesn't cut its start; the track then comes out of the convolution that much later and is trimmed by it. By the
// arithmetic, silence of L of the response's samples is L × track ÷ own of the track's; ffmpeg 6.1's resampler keeps
// to that, but not every build does (CI's newer static build came out a sample or so off, 0.05 out on a track). So
// where the response starts is measured, once for each pair of rates, with the ffmpeg this server runs: a lone
// sample through the same chain, and where it comes out the largest.
using System.Collections.Concurrent;

namespace Mandarin.Server.Playback;

internal static class ConvolutionLead
{
    private static readonly ConcurrentDictionary<(long Own, long Track, bool Soxr, long Lead), long> Found = new();

    /* The chain a response at [own] Hz goes through to [track] Hz: [leadOwn] of its samples of silence, then resampled. */
    public static string Chain(long track, bool soxr, long leadOwn) =>
        $"adelay=delays={leadOwn}S:all=1,aresample={(soxr ? "resampler=soxr:precision=33:" : "")}osr={track}";

    /* Where, in the track's samples, the response's start comes out of [Chain]: as measured, else [reckoned]. */
    public static long Out(long own, long track, bool soxr, long leadOwn, long reckoned) =>
        Found.GetOrAdd((own, track, soxr, leadOwn), _ => Measure(own, track, soxr, leadOwn) ?? reckoned);

    // A lone sample at [own] Hz through the chain: where it comes out the largest, or null where ffmpeg can't say.
    private static long? Measure(long own, long track, bool soxr, long leadOwn)
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo(Transcoder.Bin) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            var seconds = Jv.Str((leadOwn + own / 10.0) / own);
            foreach (var a in new[] { "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", $"aevalsrc=exprs=if(eq(n\\,0)\\,1\\,0):s={own}:d={seconds}",
                         "-af", "aformat=sample_fmts=dbl," + Chain(track, soxr, leadOwn), "-f", "f64le", "-c:a", "pcm_f64le", "-" })
                psi.ArgumentList.Add(a);
            using var p = System.Diagnostics.Process.Start(psi)!;
            var err = p.StandardError.ReadToEndAsync();
            using var ms = new MemoryStream();
            p.StandardOutput.BaseStream.CopyTo(ms);
            p.WaitForExit(10000);
            _ = err.Result;
            var b = ms.ToArray();
            if (p.ExitCode != 0 || b.Length < 8) return null;
            long at = 0;
            double most = 0;
            for (var i = 0; i < b.Length / 8; i++)
            {
                var v = Math.Abs(BitConverter.ToDouble(b, i * 8));
                if (v > most) (most, at) = (v, i);
            }
            return most > 0.1 ? at : null;
        }
        catch (Exception) { return null; }
    }
}
