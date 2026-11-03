// DsdOut.cs — a track upsampled whole and made DSD (bug list item 242): 705.6 kHz by WholeTrack.cs, then each
// channel through its own chain (DsdChain.cs) on a core of its own, written as a DSF (DsfWriter.cs).
namespace Mandarin.Server.Upsample;

internal static class DsdOut
{
    /* The modulator Mandarin uses: seventh order, its gain out of band 1.4 (measured stable to 60% modulation). */
    public static DsdNtf Ntf(int dsdRate) => new(7, dsdRate / 2.0 / 20000, 1.4);

    /*
     * [left] and [right] at [rate] (44.1 kHz's family, 352.8 kHz or less) made DSD at [dsdRate] into the file [path]:
     * the whole-track result, and the times the modulators were overloaded and started again (none, measured).
     */
    public static (WholeTrack.Result R, long Resets) Make(double[] left, double[] right, int rate, int dsdRate, int maxOutBits, string path)
    {
        if (rate <= 0 || DsdChain.InRate % rate != 0 || !WholePlan.Takes(DsdChain.InRate / rate))
            throw new ArgumentException("the track must reach DSD from a rate of 44.1 kHz's family, 352.8 kHz or less: " + rate);
        var factor = DsdChain.InRate / rate;
        var ntf = Ntf(dsdRate);
        DsdChain l = new(dsdRate, ntf), r = new(dsdRate, ntf);
        var frames = left.LongLength * factor;
        using var file = File.Create(path);
        using var w = new DsfWriter(file, dsdRate, frames * l.Factor);
        const int chunk = 1 << 15;
        var result = WholeTrack.Run(left, right, rate, new WholeTrack.Options(factor, MaxOutBits: maxOutBits), (re, im, from, count, gain) =>
        {
            for (long done = 0; done < count; done += chunk)
            {
                var n = (int)Math.Min(chunk, count - done);
                double[] a = new double[n], b = new double[n];
                for (var i = 0; i < n; i++) { a[i] = re[from + done + i] * gain; b[i] = im[from + done + i] * gain; }
                List<byte> ba = [], bb = [];
                Parallel.Invoke(() => l.Push(a, x => ba.AddRange(x.ToArray())), () => r.Push(b, x => bb.AddRange(x.ToArray())));
                w.Write(0, [.. ba]); w.Write(1, [.. bb]);
            }
        });
        List<byte> ta = [], tb = [];
        l.Finish(frames, x => ta.AddRange(x.ToArray()));
        r.Finish(frames, x => tb.AddRange(x.ToArray()));
        w.Write(0, [.. ta]); w.Write(1, [.. tb]);
        return (result, l.Modulator.Resets + r.Modulator.Resets);
    }
}
