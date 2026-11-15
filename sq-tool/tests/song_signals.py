"""One "master" at any sample rate, for comparing two songs (test_songs.py).

The master is a formula, not samples: tones at fixed frequencies and phases under slow, smooth swells, evaluated at
each rate. The same master at 192 kHz and at 44.1 kHz is then exactly what a perfect resampler would give, without a
resampler of our own in the test: what SQ-tool's resampling leaves is its own. A quiet stretch and a loud one give it
dynamics to compress.
"""

import math

import numpy as np

from sqtool.wavio import Audio


def master(rate, seconds=6.0, seed=1, top_hz=18000.0, extra=()):
    """Float stereo at `rate`: 48 tones from 40 Hz to `top_hz` (seeded), and any `extra` (Hz, dBFS) tones."""
    rng = np.random.default_rng(seed)
    freqs = np.exp(rng.uniform(math.log(40.0), math.log(top_hz), 48))
    phases = rng.uniform(0, 2 * math.pi, (48, 2))
    levels = 10 ** (rng.uniform(-40, -26, 48) / 20)
    n = int(round(seconds * rate))
    t = np.arange(n) / rate
    out = np.zeros((n, 2))
    for f, p, a in zip(freqs, phases, levels):
        out[:, 0] += a * np.sin(2 * math.pi * f * t + p[0])
        out[:, 1] += a * np.sin(2 * math.pi * f * t + p[1])
    for f, db in extra:
        out += 10 ** (db / 20) * np.sin(2 * math.pi * f * t)[:, None]
    # A quiet first third, a loud rest, the change smooth (a raised cosine over half a second); faded in and out.
    swell = np.clip((t - seconds / 3) / 0.5, 0, 1)
    env = 0.2 + 0.8 * (0.5 - 0.5 * np.cos(math.pi * swell))
    fade = np.clip(np.minimum(t, seconds - t) / 0.05, 0, 1)
    return out * (env * fade)[:, None]


def quantise(x, bits, seed=7):
    """Float samples to `bits` with TPDF dither, as left-justified int32."""
    rng = np.random.default_rng(seed)
    scale = 2.0 ** (bits - 1)
    q = np.round(x * scale + rng.random(x.shape) - rng.random(x.shape))
    return (np.clip(q, -scale, scale - 1).astype(np.int64) << (32 - bits)).astype(np.int32)


def song(rate, bits, pad=0.25, **kw):
    """The master as a song file would hold it: `bits` deep, with `pad` seconds of silence each side."""
    x = quantise(master(rate, **kw), bits)
    z = np.zeros((int(pad * rate), 2), np.int32)
    return Audio(data=np.concatenate([z, x, z]), rate=rate, bits=bits, label="WAV PCM %d-bit" % bits)


def as_float(data, rate):
    """Float samples as a 64-bit float song."""
    return Audio(data=np.asarray(data, np.float64), rate=rate, bits=64, is_float=True, label="WAV float 64-bit")


def compress(x, rate, ratio=3.0, threshold_db=-24.0, attack=0.01):
    """A gentle compressor: above the threshold, the level over 10 ms rises 1 dB for each `ratio` dB."""
    p = (x * x).mean(axis=1)
    k = max(1, int(attack * rate))
    level = np.sqrt(np.convolve(p, np.ones(k) / k, mode="same") + 1e-20)
    over = np.maximum(0.0, 20 * np.log10(level) - threshold_db)
    return x * (10 ** (-over * (1 - 1 / ratio) / 20))[:, None]
