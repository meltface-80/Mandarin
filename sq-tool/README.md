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

## Command line

    ./sq-tool compare song.flac recording.wav    the comparison, without Mandarin
    ./sq-tool analyze recording.wav
    ./sq-tool gen -o test-tracks                 deterministic test tracks

## Tests

    python3 -m unittest discover -s tests

From SQ-tool by the same author (github.com/meltface-80/SQ-tool), made Mandarin's own in item 290: one recording a
test, made by Mandarin; SQ-tool's own recording (the Loopback card, usbmon) and its comparison of two players are gone.
