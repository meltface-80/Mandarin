// DsdOut.cs — a track upsampled whole and made DSD (bug list item 242): 705.6 kHz by WholeTrack.cs, then each
// channel through its own chain (DsdChain.cs) on a core of its own, written as a DSF (DsfWriter.cs).
namespace Mandarin.Server.Upsample;

internal static class DsdOut
{
    /*
     * The modulator's gain out of band at [dsdRate] (item 255): low enough that the loop holds past SACD's highest
     * level, +3.1 dB over its reference (71.4% modulation), with room to spare. 1.4 was quieter in the band but held
     * only to 62%. Measured, no reset to 75% or more: 1.3 at DSD64 (its noise in the band −126 dB); 1.25 at DSD128 and
     * DSD256 (−161 dB and −204 dB), where 1.3 no longer held at 75%.
     */
    public static double Hinf(int dsdRate) => dsdRate <= 2822400 ? 1.3 : 1.25;

    /* The modulator Mandarin uses: seventh order, its gain out of band [Hinf]. */
    public static DsdNtf Ntf(int dsdRate) => new(7, dsdRate / 2.0 / 20000, Hinf(dsdRate));

    /*
     * [left] and [right] at [rate] (44.1 kHz's family, 352.8 kHz or less) made DSD at [dsdRate] into the file [path],
     * upsampled in [shape] (item 248; null: linear): the whole-track result, and the times the modulators were
     * overloaded and started again (none, measured).
     */
    public static (WholeTrack.Result R, long Resets) Make(double[] left, double[] right, int rate, int dsdRate, int maxOutBits, string path, string? shape = null, bool pipelined = true)
    {
        if (rate <= 0 || DsdChain.InRate % rate != 0 || !WholePlan.Takes(DsdChain.InRate / rate))
            throw new ArgumentException("the track must reach DSD from a rate of 44.1 kHz's family, 352.8 kHz or less: " + rate);
        var factor = DsdChain.InRate / rate;
        var ntf = Ntf(dsdRate);
        var frames = left.LongLength * factor;
        using var file = File.Create(path);
        using var w = new DsfWriter(file, dsdRate, frames * new DsdChain(dsdRate, ntf).Factor);
        // Pipelined (item 251): each channel's modulator on a thread of its own beside its doublings, the writer taking
        // each channel's bits under one lock as they come. Else (the tests' comparison) the two in turn, as before.
        var gate = new object();
        DsdChain l = pipelined ? new(dsdRate, ntf, x => { lock (gate) w.Write(0, x); }) : new(dsdRate, ntf);
        DsdChain r = pipelined ? new(dsdRate, ntf, x => { lock (gate) w.Write(1, x); }) : new(dsdRate, ntf);
        const int chunk = 1 << 15;
        var result = WholeTrack.Run(left, right, rate, WholeTrack.Options.For(factor, shape, maxOutBits), (re, im, from, count, gain) =>
        {
            for (long done = 0; done < count; done += chunk)
            {
                var n = (int)Math.Min(chunk, count - done);
                double[] a = new double[n], b = new double[n];
                for (var i = 0; i < n; i++) { a[i] = re[from + done + i] * gain; b[i] = im[from + done + i] * gain; }
                if (pipelined) { Parallel.Invoke(() => l.Push(a), () => r.Push(b)); continue; }
                List<byte> ba = [], bb = [];
                Parallel.Invoke(() => l.Push(a, x => ba.AddRange(x.ToArray())), () => r.Push(b, x => bb.AddRange(x.ToArray())));
                w.Write(0, [.. ba]); w.Write(1, [.. bb]);
            }
        });
        if (pipelined) Parallel.Invoke(() => l.Finish(frames), () => r.Finish(frames));
        else
        {
            List<byte> ta = [], tb = [];
            l.Finish(frames, x => ta.AddRange(x.ToArray()));
            r.Finish(frames, x => tb.AddRange(x.ToArray()));
            w.Write(0, [.. ta]); w.Write(1, [.. tb]);
        }
        return (result, l.Modulator.Resets + r.Modulator.Resets);
    }
}
