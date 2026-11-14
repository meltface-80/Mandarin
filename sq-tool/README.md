# SQ-tool, Mandarin's

Does a zone's DAC get exactly what is in the file? SQ-tool proves it, sample by sample. It is part of Mandarin
(**Settings → SQ-tool**), served at `/sq-tool/` behind Mandarin's sign-in.

1. **Choose a song** from Mandarin's music folder.
2. **Choose the zone and press Record.** Mandarin plays the song there alone, from its start, and records exactly what
   the zone's DAC is fed, every sample to the song's last (Mandarin's `/api/sq-tool/record`, `SqToolRecord.cs`):
   * **Mandarin Bridge** on an Android device with a USB DAC: what its USB driver feeds the DAC (its `/capture`,
     in parts that Mandarin joins into one recording);
   * a **USB DAC on Mandarin's server**: what goes down its USB cable, read off the USB bus (usbmon).
   Mandarin hands the recording to SQ-tool (`POST /api/tests/<id>/recording`).
3. **See the result**: bit-perfect or not, and where not, how: the level, what remains after matching it, where in the
   song the samples differ, with spectrograms of the song, of what the DAC was fed and of the difference, charts, and
   the recordings to download.

It also compares two songs, file against file, with a null test: see [Compare two songs](#compare-two-songs).

Mandarin starts SQ-tool the first time it is opened, on a port of its own computer only (127.0.0.1), with its data in
Mandarin's data folder (`sq-tool/`). It needs Python 3 and numpy (Mandarin's image has both).

## Reading the result

| Verdict | Meaning |
|---|---|
| **BIT-PERFECT** | Every sample the DAC was fed equals the sample in the file. Silence before and after the song is allowed, and so is a bigger container: 16-bit samples fed as 32-bit words, padded with zeros, keep their values. |
| **BIT-PERFECT** with part of the song missing | Every recorded sample matches, but part of the song isn't in the recording, for example because playback was stopped early. |
| **DROPOUTS** | The samples are unchanged, but the stream has gaps or jumps: silence inserted (an underrun), samples lost, or audio repeated. |
| **ALTERED** | Most of the stream matches the file; some parts differ. |
| **NOT BIT-PERFECT** | The samples differ throughout. SQ-tool says how: a level change, dither, rounding, EQ, channel changes. |
| **RESAMPLED** | The DAC was fed another sample rate than the file's (Output upsampled, or a device's own resampling). |

Where it is not bit-perfect, the numbers mean:

* **level**: the volume difference, for example −1.00 dB (a volume in software).
* **what remains after matching the level**: how far below the music the rest
  of the difference lies, and its level in dBFS rms. It is typically one of
  these:
  * dither: about −144 dBFS at 24 bits, or −96 dBFS at 16 bits;
  * plain rounding: about −149 dBFS at 24 bits, or −101 dBFS at 16 bits;
  * or, if higher, a sign of heavier processing.

For a bit-perfect result, the zone's Output in Mandarin is Original (upsampling, DSD from PCM, DSP and volume
levelling change the samples on purpose), and its volume fixed or the DAC's own.

## What it can and cannot tell you

* The recording is what the DAC is fed: after everything Mandarin and the device do. Bit-perfect means the DAC
  converts exactly the numbers in the file.
* The same values in another container count as identical (16-bit samples in 32-bit words, say). The *Details*
  table shows each.
* It cannot measure what happens electrically: jitter, noise on the USB cable or ground, or the DAC's own behaviour.

## Compare two songs

SQ-tool also compares one song with another, file against file: a 24/192 against a 16/44.1, an original against a
remaster. On its page, **Compare two songs** (beside *Does your DAC get exactly the file?*): choose song A and song B
from Mandarin's music folder, search or browse, and **Compare** (`POST /api/comparisons {"a": path, "b": path}`,
`sqtool/comparisons.py`; each song read from the music folder by its path, as a test's song is).

1. **Common ground** (`sqtool/common_ground.py`). Both are decoded as a test's song is (WAV and AIFF by SQ-tool, the
   rest by ffmpeg). Different sample rates: the higher is resampled to the lower by ffmpeg's soxr resampler at its
   highest precision (`aresample=resampler=soxr:precision=28:cutoff=0.97`, worked in double precision); where an
   ffmpeg has no soxr, its own resampler with a 256-tap filter, and the result says which. Different channel counts:
   both are mixed down to mono (the channels averaged), and the result says so. DSD files (`.dsf`, `.dff`, and DSD
   over PCM) are refused: SQ-tool compares PCM. A lossy file is compared with a note that its decoder adds
   differences of its own.
2. **Identical?** Neither resampled nor mixed down, the samples are compared as a recording is with its song: the
   same samples, wherever both have music, are **Identical** (whatever the offset, the container or the lengths).
3. **The null test** (`sqtool/nulltest.py`). B is lined up with A to the sample by correlation, then to a fraction
   of a sample from the slope of their cross spectrum's phase (a 129-tap windowed-sinc interpolator moves B when
   the fraction is a hundredth of a sample or more). For each channel, the gain that makes A closest to B below
   20 kHz (least squares) matches the level; a negative gain is inverted polarity. Then A is subtracted from B,
   where both play.
4. **The result** (`sqtool/songs.py`): the **null depth** (what is left against the music, in dB) and what is left
   in dBFS rms, overall, below 20 kHz and per channel; the **level difference**; the **time offset** (samples and
   ms; B later is positive); the **polarity**; **where** the difference lies, from its spectrum by third octave
   (above 20 kHz only, at the noise floor, in the bass, or most of all around a frequency against the music);
   spectrograms of A, B and the difference; each song's **dynamics** (`sqtool/dynamics.py`: peak, rms, crest
   factor, integrated loudness after BS.1770 in LUFS, loudness range after EBU Tech 3342 in LU, peak to loudness
   ratio); and the downloads: the difference as a 32-bit float WAV, as it is or gain-normalised to −1 dBFS peak
   (made loud on purpose), and A and B as compared.

| Verdict | When (`sqtool/song_verdict.py`, in this order) |
|---|---|
| **Identical** | The same samples, bit for bit, wherever both have music; or the same values in another sample format (nothing left below −200 dBFS, no level change, nothing resampled or mixed down). |
| **Different recordings** | Nothing lines up (a correlation under 0.3), or what is left is within 6 dB of the music. |
| **Different only above 20 kHz** | Neither was resampled; below 20 kHz they null as one master does (as below); over the whole spectrum more is left, 90% or more of it above 20 kHz. |
| **The same master** | Below 20 kHz, what is left is at the noise floor of the coarser file (−6.02 dB per bit: −96 dBFS at 16 bits, −144 dBFS at 24, a floating-point file counted as 24) or within 10 dB of it, or 90 dB or more below the music. The difference is then only resampling, rounding and dither, and any level change or inverted polarity, which the words say. |
| **The same music, a different master** | Lined up, but more is left. The words say whether B is louder or quieter (1 LU or more of loudness) and more or less compressed (1 LU or more of loudness range, or 1 dB or more of crest factor). |

A 24-bit/192 kHz file and a 16-bit/44.1 kHz file of one master, for example: the same master, with what is left
below 20 kHz at about −96 dBFS (the 16-bit file's dither), some 77 dB below music at −19 dBFS rms. Songs of
different lengths are compared where both play, and the result says by how much their music differs in length.
Memory and time are bounded as for a test: both songs are held decoded, and the spectra are averaged over at most
400 stretches spread across the songs.

## Command line

    ./sq-tool compare song.flac recording.wav    the comparison, without Mandarin
    ./sq-tool compare-files a.flac b.flac        two songs: common ground, then the null test (--bands, --json)
    ./sq-tool analyze recording.wav
    ./sq-tool gen -o test-tracks                 deterministic test tracks

## Tests

    python3 -m unittest discover -s tests

From SQ-tool by the same author (github.com/meltface-80/SQ-tool), made Mandarin's own in item 290: one recording a
test, made by Mandarin; SQ-tool's own recording (the Loopback card, usbmon) and its comparison of two players are gone.
