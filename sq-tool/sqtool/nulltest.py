"""The null test of two songs on common ground (sqtool/common_ground.py): line B up with A, match its level and
polarity, subtract, and say how much is left, and where.

* Alignment: to the sample by correlation (analysis.approximate_align, as a recording is lined up with its song),
  then to a fraction of a sample from the slope of the phase of A and B's cross spectrum, where the two are coherent.
  A fraction of more than a hundredth of a sample is taken out of B with a 129-tap windowed-sinc interpolator.
* Level and polarity: for each channel, the gain g that makes g x A closest to B below 20 kHz (least squares over the
  in-band bins of their averaged cross spectrum). A negative g is B's polarity inverted.
* The residual, B - g x A: its rms against the music's (B's) rms, the null depth, in dB, and its own level in dBFS
  rms, overall and per channel, over the part of A's music both cover.
* Its spectrum: averaged over up to 400 Hann-windowed stretches spread across the overlap, in third-octave bands from
  20 Hz to the Nyquist frequency, as dBFS rms in each band beside the music's, and how much of it lies above 20 kHz
  and below it.
"""

from __future__ import annotations

import math
from typing import List, Optional, Tuple

import numpy as np

from .analysis import _chunks, approximate_align, db_pow, silence_bounds, to_float
from .wavio import Audio

INTERP_HALF = 64  # taps on each side of the sub-sample interpolator
MIN_FRACTION = 0.01  # sub-sample offsets smaller than this are left alone
IN_BAND_HZ = 20000.0


def _nfft(rate: int) -> int:
    return 8192 if rate <= 96000 else 16384


def _starts(a: int, b: int, nfft: int, most: int) -> List[int]:
    if b - a < nfft:
        return []
    count = min(most, max(1, (b - a - nfft) // (nfft // 2) + 1))
    return [int(s) for s in np.linspace(a, b - nfft, count)]


def overlap(a: Audio, b: Audio, lag: int) -> Tuple[int, int]:
    """A's frames [start, end) that B covers, with B's frame = A's frame + lag."""
    return max(0, -lag), min(a.frames, b.frames - lag)


def align(a: Audio, b: Audio) -> Optional[Tuple[int, float]]:
    """(lag, correlation): B's frame = A's frame + lag, to the sample. None where nothing lines up."""
    return approximate_align(a, b)


def cross_spectra(a: Audio, b: Audio, lag: int, most: int = 128):
    """(freqs, A's power, B's power, B x conj(A)), each per bin and channel, averaged over up to `most`
    Hann-windowed stretches spread across where both play. None where they overlap too little."""
    s0, s1 = overlap(a, b, lag)
    nfft = _nfft(a.rate)
    starts = _starts(s0, s1, nfft, most)
    if not starts:
        return None
    win = np.hanning(nfft)[:, None]
    shape = (nfft // 2 + 1, a.channels)
    sab, saa, sbb = np.zeros(shape, complex), np.zeros(shape), np.zeros(shape)
    for s in starts:
        fa = np.fft.rfft(to_float(a, s, s + nfft) * win, axis=0)
        fb = np.fft.rfft(to_float(b, s + lag, s + lag + nfft) * win, axis=0)
        sab += fb * np.conj(fa)
        saa += np.abs(fa) ** 2
        sbb += np.abs(fb) ** 2
    return np.fft.rfftfreq(nfft, 1.0 / a.rate), saa, sbb, sab


def in_band(freqs: np.ndarray, rate: int) -> np.ndarray:
    """The bins that count for matching: 20 Hz to 20 kHz, and below 0.45 of the rate."""
    return (freqs >= 20) & (freqs < min(IN_BAND_HZ, 0.45 * rate))


def fraction(a: Audio, b: Audio, lag: int) -> float:
    """B's sub-sample delay after `lag`, in samples (B(t) = A(t - lag - fraction)), from the cross spectrum's phase."""
    got = cross_spectra(a, b, lag, 64)
    if got is None:
        return 0.0
    freqs, saa, sbb, sab = got
    saa, sbb, sab = saa.sum(axis=1), sbb.sum(axis=1), sab.sum(axis=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        coherence = np.abs(sab) ** 2 / (saa * sbb)
    use = (freqs > 50) & (freqs < 0.45 * a.rate) & (coherence > 0.9) & (saa > saa.max() * 1e-8)
    if use.sum() < 8:
        return 0.0
    sign = 1.0 if sab[use].real.sum() >= 0 else -1.0  # an inverted B turns every phase by half a turn
    phase = np.angle(sab[use] * sign)
    omega = 2 * math.pi * freqs[use] / a.rate
    weight = coherence[use] * np.sqrt(saa[use] * sbb[use])
    tau = -float((weight * omega * phase).sum() / (weight * omega * omega).sum())
    return tau if abs(tau) < 1.0 else 0.0


def shift(audio: Audio, tau: float) -> Audio:
    """`audio` moved earlier by `tau` samples (|tau| < 1): out(n) = in(n + tau), by a Kaiser-windowed sinc."""
    k = np.arange(-INTERP_HALF, INTERP_HALF + 1)
    taps = np.sinc(k - tau) * np.kaiser(len(k), 12.0)
    taps /= taps.sum()
    n, ch = audio.frames, audio.channels
    out = np.empty((n, ch), np.float32)
    for s, e in _chunks(0, n):
        lo, hi = max(0, s - INTERP_HALF), min(n, e + INTERP_HALF)
        x = np.zeros((e - s + 2 * INTERP_HALF, ch))
        x[lo - (s - INTERP_HALF):hi - (s - INTERP_HALF)] = to_float(audio, lo, hi)
        acc = np.zeros((e - s, ch))
        for i, t in enumerate(taps):
            acc += t * x[i:i + e - s]
        out[s:e] = acc
    return Audio(data=out, rate=audio.rate, bits=32, is_float=True, label=audio.label, path=audio.path,
                 meta=dict(audio.meta, changed="shifted"))


def music_span(a: Audio, b: Audio, lag: int) -> Tuple[int, int]:
    """The part of A's music (first to last non-silent sample) that B covers, in A's frames."""
    s0, s1 = overlap(a, b, lag)
    first, end = silence_bounds(a.data)
    return max(s0, first), min(s1, end)


def gains(a: Audio, b: Audio, lag: int) -> np.ndarray:
    """Per channel, the g that makes g x A closest to B below 20 kHz (least squares over the in-band bins: what
    lies above, such as a resampler's filter, doesn't pull the level that the rest is matched at)."""
    got = cross_spectra(a, b, lag)
    if got is None:
        return np.ones(a.channels)
    freqs, saa, _, sab = got
    band = in_band(freqs, a.rate)
    aa, ab = saa[band].sum(axis=0), sab[band].real.sum(axis=0)
    return np.where(aa > 0, ab / np.where(aa > 0, aa, 1), 0.0)


def residual(a: Audio, b: Audio, lag: int, g: np.ndarray, s0: int, s1: int) -> dict:
    """The null: B - g x A over [s0, s1) of A, overall and per channel."""
    rr, bb = np.zeros(a.channels), np.zeros(a.channels)
    for s, e in _chunks(s0, s1):
        r = to_float(b, s + lag, e + lag) - to_float(a, s, e) * g
        rr += (r * r).sum(axis=0)
        bb += (to_float(b, s + lag, e + lag) ** 2).sum(axis=0)
    n = max(1, s1 - s0)
    return {
        "depth_db": db_pow(float(rr.sum() / bb.sum())) if bb.sum() > 0 else None,
        "residual_dbfs": db_pow(float(rr.sum() / (n * a.channels))),
        "music_dbfs": db_pow(float(bb.sum() / (n * a.channels))),
        "channels": [{"depth_db": db_pow(float(rr[c] / bb[c])) if bb[c] > 0 else None,
                      "residual_dbfs": db_pow(float(rr[c] / n))} for c in range(a.channels)],
    }


def third_octaves(rate: int) -> List[Tuple[float, float, float]]:
    """(low, centre, high) of each third-octave band from 20 Hz up to the Nyquist frequency."""
    out = []
    for k in range(-17, 40):
        fc = 1000.0 * 2 ** (k / 3)
        lo, hi = fc / 2 ** (1 / 6), min(fc * 2 ** (1 / 6), rate / 2)
        if lo < 17.8 or lo >= rate / 2:
            continue
        out.append((lo, fc, hi))
    return out


def residual_spectrum(a: Audio, b: Audio, lag: int, g: np.ndarray, s0: int, s1: int) -> dict:
    """The residual's and the music's power by third-octave band (dBFS rms), and its share above and below 20 kHz."""
    nfft = _nfft(a.rate)
    starts = _starts(s0, s1, nfft, 400)
    if not starts:
        return {}
    win = np.hanning(nfft)[:, None]
    scale = 2.0 / (nfft * float((win ** 2).sum()))  # one-sided power per bin: the bins add up to the mean square
    pr, pb = np.zeros(nfft // 2 + 1), np.zeros(nfft // 2 + 1)
    for s in starts:
        x, y = to_float(a, s, s + nfft), to_float(b, s + lag, s + lag + nfft)
        pr += (np.abs(np.fft.rfft((y - x * g) * win, axis=0)) ** 2).mean(axis=1)
        pb += (np.abs(np.fft.rfft(y * win, axis=0)) ** 2).mean(axis=1)
    pr *= scale / len(starts)
    pb *= scale / len(starts)
    freqs = np.fft.rfftfreq(nfft, 1.0 / a.rate)
    bands = []
    for lo, fc, hi in third_octaves(a.rate):
        sel = (freqs >= lo) & (freqs < hi)
        if not sel.any():
            continue
        bands.append({"freq": round(fc, 1), "residual_dbfs": db_pow(float(pr[sel].sum())),
                      "music_dbfs": db_pow(float(pb[sel].sum()))})
    total = float(pr.sum())
    above = float(pr[freqs >= IN_BAND_HZ].sum())
    loudest = max(bands, key=lambda x: x["residual_dbfs"] if x["residual_dbfs"] is not None else -1e9)
    worst = max(bands, key=lambda x: (x["residual_dbfs"] - x["music_dbfs"])
                if x["residual_dbfs"] is not None and x["music_dbfs"] is not None else -1e9)
    return {
        "bands": bands,
        "above_20k_share": above / total if total > 0 else 0.0,
        "in_band_share": 1.0 - above / total if total > 0 else 1.0,
        "below_200_share": float(pr[freqs < 200].sum()) / total if total > 0 else 0.0,
        "loudest_band_hz": loudest["freq"],
        "worst_band_hz": worst["freq"],
        "segments": len(starts),
        "nfft": nfft,
    }


def null_test(a: Audio, b: Audio) -> dict:
    """Align B with A, match its level and polarity, subtract. {"aligned": False} where nothing lines up."""
    found = align(a, b)
    if found is None:
        return {"aligned": False, "correlation": None}
    lag, rho = found
    out: dict = {"aligned": True, "correlation": rho, "lag": lag}
    tau = fraction(a, b, lag)
    if abs(tau) >= MIN_FRACTION:
        b = shift(b, tau)
    out["fraction"] = tau if abs(tau) >= MIN_FRACTION else 0.0
    s0, s1 = music_span(a, b, lag)
    if s1 - s0 < 64:
        out["aligned"] = False
        return out
    g = gains(a, b, lag)
    out["gains"] = g.tolist()
    out["span"] = [s0, s1]
    out["null"] = residual(a, b, lag, g, s0, s1)
    spec = residual_spectrum(a, b, lag, g, s0, s1)
    out["spectrum"] = spec
    null = out["null"]
    if spec and null["residual_dbfs"] is not None and math.isfinite(null["residual_dbfs"]):
        share = max(spec["in_band_share"], 1e-30)
        null["in_band_dbfs"] = null["residual_dbfs"] + 10 * math.log10(share)
        null["in_band_depth_db"] = (null["depth_db"] + 10 * math.log10(share)) if null["depth_db"] is not None else None
    else:
        null["in_band_dbfs"], null["in_band_depth_db"] = null["residual_dbfs"], null["depth_db"]
    out["shifted_b"] = b
    return out
