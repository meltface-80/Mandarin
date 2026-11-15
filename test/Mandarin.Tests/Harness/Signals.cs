namespace Mandarin.Tests;

/// <summary>
/// Audio made by arithmetic alone, the same on every machine (bug list item 414c): the signals the Chromaprint
/// fingerprints are held to fpcalc's on (ChromaprintTests.cs). Each is 16-bit samples, interleaved when stereo; the
/// noise is a fixed xorshift, so nothing depends on a library's random numbers.
/// </summary>
public static class Signals
{
    private sealed class Noise(uint seed)
    {
        private uint s = seed;
        public double Next() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s / (double)uint.MaxValue * 2 - 1; }
    }

    private static short Clip(double v) => (short)Math.Max(short.MinValue, Math.Min(short.MaxValue, Math.Round(v * 32767)));

    /// <summary>Nothing: [seconds] of zeros at 11025 Hz.</summary>
    public static short[] Silence(int seconds) => new short[seconds * 11025];

    /// <summary>One sine at [hz], half scale, for [seconds] at 11025 Hz.</summary>
    public static short[] Tone(double hz, int seconds)
    {
        var s = new short[seconds * 11025];
        for (var i = 0; i < s.Length; i++) s[i] = Clip(0.5 * Math.Sin(2 * Math.PI * hz * i / 11025));
        return s;
    }

    /// <summary>A sweep from 50 Hz to 4 kHz, the frequency rising by octaves, over [seconds] at 11025 Hz.</summary>
    public static short[] Sweep(int seconds)
    {
        var s = new short[seconds * 11025];
        double phase = 0;
        for (var i = 0; i < s.Length; i++)
        {
            var hz = 50 * Math.Pow(80, (double)i / s.Length);
            phase += 2 * Math.PI * hz / 11025;
            s[i] = Clip(0.4 * Math.Sin(phase));
        }
        return s;
    }

    private static readonly int[] Tune = [0, 4, 7, 12, 9, 5, 2, 7, 0, 3, 7, 10, 8, 5, 3, 11];
    private static readonly int[][] Chords = [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]];

    /// <summary>
    /// Something like music: a tune with harmonics, chords under it changing every two seconds, a bass, and a hi-hat
    /// and a kick of noise on the beat, at [rate] Hz in [channels] (stereo: the chords leaning left, the tune right),
    /// for [seconds]; [seed] picks the noise and transposes the tune.
    /// </summary>
    public static short[] Music(int seconds, int rate = 11025, int channels = 1, uint seed = 1)
    {
        var n = seconds * rate;
        var s = new short[n * channels];
        var noise = new Noise(seed * 2654435761u + 1);
        var key = (int)(seed % 5);
        static double Hz(int semis) => 220 * Math.Pow(2, semis / 12.0);
        for (var i = 0; i < n; i++)
        {
            var t = (double)i / rate;
            var beat = t * 2;                       // 120 a minute
            var inBeat = beat - Math.Floor(beat);
            var note = Tune[(int)(beat * 2) % Tune.Length] + key;
            var chord = Chords[(int)(t / 2) % Chords.Length];
            double tune = 0;
            for (var h = 1; h <= 4; h++) tune += Math.Sin(2 * Math.PI * Hz(note + 12) * h * t) / (h * h);
            tune *= 0.18 * Math.Exp(-3 * (beat * 2 - Math.Floor(beat * 2)));
            double pad = 0;
            foreach (var c in chord) pad += Math.Sin(2 * Math.PI * Hz(c + key) * t) * 0.07;
            var bass = 0.2 * Math.Sin(2 * Math.PI * Hz(chord[0] + key - 24) * t);
            var hat = noise.Next() * 0.08 * Math.Exp(-40 * ((beat * 2) - Math.Floor(beat * 2)));
            var kick = 0.35 * Math.Sin(2 * Math.PI * (50 + 80 * Math.Exp(-30 * inBeat)) * inBeat) * Math.Exp(-8 * inBeat);
            if (channels == 1) s[i] = Clip(tune + pad + bass + hat + kick);
            else
            {
                s[i * 2] = Clip(0.6 * tune + 1.3 * pad + bass + hat + kick);
                s[i * 2 + 1] = Clip(1.4 * tune + 0.7 * pad + bass + 0.8 * hat + kick);
            }
        }
        return s;
    }

    /// <summary>[samples] as a 16-bit PCM WAV at [rate] Hz in [channels].</summary>
    public static byte[] Wav(short[] samples, int rate, int channels)
    {
        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        var data = samples.Length * 2;
        w.Write("RIFF"u8); w.Write(36 + data); w.Write("WAVE"u8);
        w.Write("fmt "u8); w.Write(16); w.Write((short)1); w.Write((short)channels); w.Write(rate); w.Write(rate * channels * 2); w.Write((short)(channels * 2)); w.Write((short)16);
        w.Write("data"u8); w.Write(data);
        foreach (var v in samples) w.Write(v);
        w.Flush();
        return ms.ToArray();
    }
}
