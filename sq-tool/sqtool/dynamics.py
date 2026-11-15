"""How loud and how compressed a song is: peak, rms, crest factor, loudness and loudness range.

For comparing two songs (sqtool/songs.py), so that a louder, more compressed remaster shows beside the original:

* peak: the highest sample, dBFS (a full-scale square wave is 0 dBFS, a full-scale sine's rms is -3 dBFS);
* rms: the level of the music (from its first to its last non-silent sample), dBFS, all channels together;
* crest factor: peak minus rms, dB; compression and limiting lower it;
* loudness: integrated loudness after ITU-R BS.1770 (K-weighting, 400 ms blocks every 100 ms, gated at -70 LUFS and
  10 LU below), in LUFS. The K-weighting is applied to each block in the frequency domain (its two filters' response
  at each FFT bin) rather than as running filters: the same figure within a few hundredths of a LU on music, at a
  fraction of the time in numpy. A full-scale 1 kHz sine on both channels of a stereo file reads 0 LUFS;
* loudness range: the spread of the 3-second loudness, 10th to 95th percentile, gated at -70 LUFS and 20 LU below
  (EBU Tech 3342's LRA), in LU; compression lowers it;
* peak to loudness ratio: peak minus loudness, dB.
"""

from __future__ import annotations

import math
from typing import List, Optional

import numpy as np

from .analysis import _chunks, db_amp, db_pow, silence_bounds, to_float
from .wavio import Audio

BLOCK_S = 0.4  # BS.1770's gating block
HOP_S = 0.1  # 75% overlap
SHORT_TERM_BLOCKS = 27  # 400 ms blocks every 100 ms starting within 3 s: one 3-second window
ABSOLUTE_GATE = -70.0
RELATIVE_GATE = -10.0
LRA_RELATIVE_GATE = -20.0


def _biquad_power(b: List[float], a: List[float], w: np.ndarray) -> np.ndarray:
    """|H(e^jw)|^2 of a biquad at angular frequencies w (radians per sample)."""
    z = np.exp(-1j * w)
    num = b[0] + b[1] * z + b[2] * z * z
    den = a[0] + a[1] * z + a[2] * z * z
    return np.abs(num / den) ** 2


def k_weighting(rate: int, freqs: np.ndarray) -> np.ndarray:
    """Power response of BS.1770's K-weighting (its high shelf, then its high-pass) at `freqs` Hz, for `rate`."""
    w = 2 * math.pi * freqs / rate
    # Stage 1: the head's high shelf (+4 dB above about 1.5 kHz), its coefficients worked out for any rate.
    gain, q, fc = 3.99984385397, 0.7071752369554193, 1681.9744509555319
    k = math.tan(math.pi * fc / rate)
    vh, vb = 10 ** (gain / 20), (10 ** (gain / 20)) ** 0.4996667741545416
    a0 = 1 + k / q + k * k
    shelf = _biquad_power([(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0],
                          [1.0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0], w)
    # Stage 2: the RLB high-pass (about 38 Hz).
    q, fc = 0.5003270373253953, 38.13547087613982
    k = math.tan(math.pi * fc / rate)
    a0 = 1 + k / q + k * k
    highpass = _biquad_power([1.0, -2.0, 1.0], [1.0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0], w)
    return shelf * highpass


def block_loudness(audio: Audio, start: int = 0, end: Optional[int] = None) -> np.ndarray:
    """Mean square of the K-weighted signal, summed over the channels, for each 400 ms block every 100 ms."""
    end = audio.frames if end is None else end
    size, hop = int(round(BLOCK_S * audio.rate)), int(round(HOP_S * audio.rate))
    if end - start < size:
        return np.zeros(0)
    count = (end - start - size) // hop + 1
    weight = k_weighting(audio.rate, np.fft.rfftfreq(size, 1.0 / audio.rate))
    weight[1:(size + 1) // 2] *= 2  # one side of the spectrum stands for both
    out = np.empty(count)
    per = max(1, (1 << 21) // size)
    for i0 in range(0, count, per):
        i1 = min(count, i0 + per)
        s = start + i0 * hop
        x = to_float(audio, s, s + (i1 - i0 - 1) * hop + size)
        idx = (np.arange(i1 - i0) * hop)[:, None] + np.arange(size)[None, :]
        acc = np.zeros(i1 - i0)
        for c in range(x.shape[1]):
            spec = np.abs(np.fft.rfft(x[:, c][idx], axis=1)) ** 2
            acc += spec @ weight / (size * size)
        out[i0:i1] = acc
    return out


def _lufs(power) -> float:
    return -0.691 + 10 * math.log10(power) if power > 0 else float("-inf")


def integrated(blocks: np.ndarray) -> Optional[float]:
    """Gated integrated loudness of BS.1770 from block_loudness(), LUFS (None for silence)."""
    loud = blocks[blocks > 10 ** ((ABSOLUTE_GATE + 0.691) / 10)]
    if not loud.size:
        return None
    gate = _lufs(float(loud.mean())) + RELATIVE_GATE
    kept = loud[loud > 10 ** ((gate + 0.691) / 10)]
    return _lufs(float(kept.mean())) if kept.size else None


def loudness_range(blocks: np.ndarray) -> Optional[float]:
    """EBU Tech 3342's loudness range from block_loudness(): 3-second loudness, 10th to 95th percentile, LU."""
    n = len(blocks) - SHORT_TERM_BLOCKS + 1
    if n < 2:
        return None
    sums = np.concatenate(([0.0], np.cumsum(blocks)))
    short = (sums[SHORT_TERM_BLOCKS:] - sums[:-SHORT_TERM_BLOCKS]) / SHORT_TERM_BLOCKS
    short = short[::10]  # a 3-second window each second
    short = short[short > 10 ** ((ABSOLUTE_GATE + 0.691) / 10)]
    if short.size < 2:
        return None
    gate = _lufs(float(short.mean())) + LRA_RELATIVE_GATE
    kept = short[short > 10 ** ((gate + 0.691) / 10)]
    if kept.size < 2:
        return None
    db = -0.691 + 10 * np.log10(kept)
    return float(np.percentile(db, 95) - np.percentile(db, 10))


def dynamics(audio: Audio) -> dict:
    """Peak, rms, crest factor, loudness, loudness range and peak to loudness ratio of a song (see above)."""
    first, end = silence_bounds(audio.data)
    if end <= first:
        return {"silent": True}
    ch = audio.channels
    peak, sq = np.zeros(ch), np.zeros(ch)
    for a, b in _chunks(first, end):
        x = to_float(audio, a, b)
        peak = np.maximum(peak, np.abs(x).max(axis=0))
        sq += (x * x).sum(axis=0)
    n = end - first
    rms = db_pow(float(sq.sum() / (n * ch)))
    top = db_amp(float(peak.max()))
    blocks = block_loudness(audio, first, end)
    lufs = integrated(blocks)
    return {
        "peak_dbfs": top,
        "rms_dbfs": rms,
        "crest_db": top - rms,
        "lufs": lufs,
        "lra_lu": loudness_range(blocks),
        "plr_db": top - lufs if lufs is not None else None,
        "channels": [{"peak_dbfs": db_amp(float(peak[c])), "rms_dbfs": db_pow(float(sq[c] / n))} for c in range(ch)],
        "music_seconds": n / audio.rate,
    }
