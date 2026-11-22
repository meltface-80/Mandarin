// SoloistProof.cs — whether Spotify's sound reaches Mandarin bit for bit, from the samples themselves (bug list items
// 142, 506; as spotifast-lossless's pcm.rs Fidelity). Soloist doesn't say what it plays: it hands its sound server
// samples, which the sound server writes to Mandarin's pipe as 32-bit integers. Spotify's lossless audio is 16- or
// 24-bit FLAC, so every sample of it, untouched, sits on the 24-bit grid (or the 16-bit one): the lowest 8 bits of the
// 32 zero, as a shift puts them, or the value a float of it scaled by 2^31 − 1 rounds to, as a sound server converting
// floats may write it. Half a second of sound all on the grid proves it bit-perfect. Off it, it isn't: decoded Ogg
// Vorbis (Soloist's lossy quality) lands anywhere, but so does lossless audio Spotify's volume or loudness levelling has
// touched; the samples can't tell those apart (Music Assistant's Soloist notes found the same), so it is said as
// "not bit-perfect", and the first such sample kept for the log (item 506: real PulseAudio's showed "Lossy" for
// lossless). Silence proves nothing.
namespace Mandarin.Server.Connect;

internal sealed class SoloistProof
{
    /* Samples (each channel's) of sound, all on the grid, that prove it: half a second of stereo. */
    public const long Needed = Soloist.Rate;

    private long exact;          // samples of sound on the 24-bit grid since the last one off it
    private bool any24;          // one of them used the bits below the 16th
    private string said = "";    // "lossless 24-bit", "lossless 16-bit", "not bit-perfect", or "" (not heard enough yet)
    private readonly object gate = new();

    /* The first sample off the grid since heard afresh (for the log), or null. */
    public int? FirstOff { get; private set; }

    /* Whether [s] is a sample of a [bits]-bit one, untouched: shifted into the 32, or its float scaled by 2^31 − 1. */
    internal static bool OnGrid(int s, int bits)
    {
        int shift = 32 - bits;
        if ((s & ((1 << shift) - 1)) == 0) return true;
        // A float k / 2^(bits−1), times 2147483647, rounded: k found back, and the same value made from it.
        double step = 2147483647.0 / (1L << (bits - 1));
        var k = Math.Round(s / step);
        return Math.Abs(k) <= (1L << (bits - 1)) && (long)Math.Round(k * step, MidpointRounding.ToEven) == s;
    }

    /* A chunk of S32 LE stereo samples, as they came. */
    public void See(ReadOnlySpan<byte> chunk)
    {
        lock (gate)
        {
            for (int i = 0; i + 3 < chunk.Length; i += 4)
            {
                int s = chunk[i] | chunk[i + 1] << 8 | chunk[i + 2] << 16 | chunk[i + 3] << 24;
                if (s == 0) continue;   // silence
                if (!OnGrid(s, 24))
                {
                    exact = 0;
                    any24 = false;
                    said = "not bit-perfect";
                    FirstOff ??= s;
                    continue;
                }
                if (!OnGrid(s, 16)) any24 = true;
                exact++;
                // Kept across tracks, so a new one doesn't flash; one sample off the grid takes it back.
                if (exact >= Needed) said = any24 ? "lossless 24-bit" : said == "lossless 24-bit" ? said : "lossless 16-bit";
            }
        }
    }

    /* Heard afresh: a new run of Soloist may play at another quality (its prefs taken up, another account). */
    public void Reset() { lock (gate) { exact = 0; any24 = false; said = ""; FirstOff = null; } }

    /* "lossless 24-bit", "lossless 16-bit", "not bit-perfect", or "" before enough has been heard. */
    public string Says() { lock (gate) return said; }
}
