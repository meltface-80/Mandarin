// SoloistProof.cs — whether Spotify's sound is lossless, from the samples themselves (bug list item 142; as
// spotifast-lossless's pcm.rs Fidelity). Soloist doesn't say what it plays: it hands its sound server 32-bit floats,
// which the sound server writes to Mandarin's pipe as 32-bit integers, exactly. Spotify's lossless audio is 16- or
// 24-bit FLAC, so every sample of it sits on the 24-bit grid (the lowest 8 bits of the 32 are zero), and a 16-bit
// track's on the 16-bit grid (the lowest 16); decoded Ogg Vorbis (Soloist's lossy quality) lands anywhere. So: half
// a second of sound all on the 24-bit grid proves it lossless; one sample off it, lossy. Silence proves nothing.
namespace Mandarin.Server.Spotify;

internal sealed class SoloistProof
{
    /* Samples (each channel's) of sound, all on the grid, that prove it: half a second of stereo. */
    public const long Needed = Soloist.Rate;

    private long exact;          // samples of sound on the 24-bit grid since the last one off it
    private bool any24;          // one of them used the bits below the 16th
    private string said = "";    // "lossless 24-bit", "lossless 16-bit", "lossy", or "" (not heard enough yet)
    private readonly object gate = new();

    /* A chunk of S32 LE stereo samples, as they came. */
    public void See(ReadOnlySpan<byte> chunk)
    {
        lock (gate)
        {
            for (int i = 0; i + 3 < chunk.Length; i += 4)
            {
                // Little-endian: byte 0 is bits 0–7, byte 1 bits 8–15.
                if (chunk[i] == 0 && chunk[i + 1] == 0 && chunk[i + 2] == 0 && chunk[i + 3] == 0) continue;   // silence
                if (chunk[i] != 0)
                {
                    exact = 0;
                    any24 = false;
                    said = "lossy";
                    continue;
                }
                if (chunk[i + 1] != 0) any24 = true;
                exact++;
                // Kept across tracks, so a new one doesn't flash lossy; one sample off the grid takes it back.
                if (exact >= Needed) said = any24 ? "lossless 24-bit" : said == "lossless 24-bit" ? said : "lossless 16-bit";
            }
        }
    }

    /* Heard afresh: a new run of Soloist may play at another quality (its prefs taken up, another account). */
    public void Reset() { lock (gate) { exact = 0; any24 = false; said = ""; } }

    /* "lossless 24-bit", "lossless 16-bit", "lossy", or "" before enough has been heard. */
    public string Says() { lock (gate) return said; }
}
