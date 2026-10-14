using System.Diagnostics;

namespace Mandarin.Tests;

/// <summary>
/// What a track's waveform is, as the Node server drew it (test/waveform-rule.js, in C#; lib/waveform.js
/// until v0.8.50), so the C# server's waveforms are still held to it: the first audio stream decoded by
/// ffmpeg to 16-bit stereo at 44.1 kHz, the level (RMS) of every 10 ms, those levels brought to 4000
/// buckets (RMS of the levels in each, or the nearest level when there are fewer), and scaled so the
/// loudest is 255. Nothing decoded, or less than 90% of the length the track is said to have, is none.
/// </summary>
public static class WaveformRule
{
    private const int Rate = 44100, Channels = 2, Stride = Rate * Channels * 10 / 1000;
    private const double MinCoverage = 0.9;

    /// <summary>The number of buckets.</summary>
    public const int Buckets = 4000;

    /// <summary>The waveform of a file, base64 of its 4000 bytes, or null.</summary>
    public static string? Of(string file, double expectSeconds = 0)
    {
        var psi = new ProcessStartInfo(Fixtures.Ffmpeg) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in new[] { "-v", "error", "-nostdin", "-i", file, "-map", "0:a:0", "-f", "s16le", "-ac", Channels.ToString(System.Globalization.CultureInfo.InvariantCulture), "-ar", Rate.ToString(System.Globalization.CultureInfo.InvariantCulture), "-" }) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        _ = p.StandardError.ReadToEndAsync();
        using var ms = new MemoryStream();
        p.StandardOutput.BaseStream.CopyTo(ms);
        p.WaitForExit();
        var pcm = ms.ToArray();
        if (pcm.Length == 0) return null;
        if (expectSeconds > 0 && pcm.Length / (2.0 * Channels * Rate) < expectSeconds * MinCoverage) return null;
        var levels = new List<double>();
        double sum = 0; int n = 0;
        for (int i = 0; i + 1 < pcm.Length; i += 2)
        {
            double v = BitConverter.ToInt16(pcm, i);
            sum += v * v;
            if (++n >= Stride) { levels.Add(Math.Sqrt(sum / n)); sum = 0; n = 0; }
        }
        if (n > 0) levels.Add(Math.Sqrt(sum / n));
        var output = new double[Buckets];
        if (levels.Count > 0)
        {
            for (int i = 0; i < Buckets; i++)
            {
                if (levels.Count <= Buckets) { output[i] = levels[Math.Min(levels.Count - 1, (int)Math.Floor((double)i * levels.Count / Buckets))]; continue; }
                int a = (int)Math.Floor((double)i * levels.Count / Buckets);
                int b = Math.Min(levels.Count, Math.Max(a + 1, (int)Math.Floor((double)(i + 1) * levels.Count / Buckets)));
                double s = 0;
                for (int j = a; j < b; j++) s += levels[j] * levels[j];
                output[i] = Math.Sqrt(s / (b - a));
            }
        }
        double max = Math.Max(0, output.Max());
        var bytes = new byte[Buckets];
        // JavaScript's Math.round: halves up, as the Node server rounded.
        if (max > 0) for (int i = 0; i < Buckets; i++) bytes[i] = (byte)Math.Max(0, Math.Min(255, Math.Floor(output[i] * 255 / max + 0.5)));
        return Convert.ToBase64String(bytes);
    }
}
