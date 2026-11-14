"""Comparing two songs, file against file: a 24/192 against a 16/44.1, an original against a remaster.

    res, used = compare_songs(load_song(path_a), load_song(path_b))

Both are brought to common ground (sqtool/common_ground.py), checked for identical samples (analysis.exact_compare,
as a recording is checked against its song), and otherwise null-tested (sqtool/nulltest.py): B lined up with A,
its level and polarity matched, A subtracted. The result says how deep the null is, overall, per channel and below
20 kHz; the level difference, the time offset and the polarity; where in the spectrum the difference lies; each
song's dynamics (sqtool/dynamics.py); and the verdict in plain words (sqtool/song_verdict.py). `used` holds A and B
as compared (B moved by any sub-sample offset), the lag and the gains, for spectrograms and difference files.
"""

from __future__ import annotations

import math
import os
from typing import Optional, Tuple

import numpy as np

from .analysis import _exact_verdict, comparable, exact_compare, resolution
from .common_ground import common_ground
from .dynamics import dynamics
from .nulltest import IN_BAND_HZ, null_test, overlap
from .song_verdict import MIN_CORRELATION, SILENT_DBFS, decide, floor_dbfs
from .wavio import Audio, AudioFileError


def describe(audio: Audio) -> dict:
    """What a song is, as found."""
    res = resolution(audio)
    return {"path": audio.path, "name": os.path.basename(audio.path) if audio.path else "", "label": audio.label,
            "rate": audio.rate, "bits": audio.bits, "is_float": audio.is_float, "channels": audio.channels,
            "seconds": audio.duration, "resolution": res, "lossy": audio.meta.get("lossy_source")}


def _bits(info: dict) -> int:
    """Bits that count for the noise floor: the resolution in use, at most 24 (a float file counts as 24)."""
    if info["is_float"] and not info["resolution"]:
        return 24
    return min(24, info["resolution"] or info["bits"] or 24)


def where(spec: dict, null: dict, floor: float, resampled: bool) -> str:
    """Where in the spectrum the difference lies, in words."""
    if not spec or null.get("residual_dbfs") is None or not math.isfinite(null["residual_dbfs"]):
        return ""
    if null["residual_dbfs"] < SILENT_DBFS:
        return "nothing is left"
    if spec["above_20k_share"] >= 0.9:
        return "above 20 kHz only" + (" (the resampled song's top octave)" if resampled else "")
    if null.get("in_band_dbfs") is not None and null["in_band_dbfs"] <= floor + 10:
        tail = " and above 20 kHz" if spec["above_20k_share"] >= 0.5 else ""
        return "at the noise floor, spread across the spectrum" + tail
    if spec["below_200_share"] >= 0.8:
        return "mostly in the bass, below 200 Hz"
    f = spec["worst_band_hz"]
    return "most of all, against the music, around %s" % ("%.0f Hz" % f if f < 1000 else "%g kHz" % round(f / 1000, 1))


def _lengths(res: dict, a: Audio, b: Audio, lag: int) -> None:
    """Where A and B (as compared) overlap; and how long each one's music is, as found (resampling leaves ringing
    in silence, so the songs' own samples say where their music starts and ends)."""
    s0, s1 = overlap(a, b, lag)
    res["overlap"] = {"seconds": max(0, s1 - s0) / a.rate, "a_start": s0 / a.rate, "b_start": (s0 + lag) / a.rate}
    ma, mb = res["a"]["dynamics"]["music_seconds"], res["b"]["dynamics"]["music_seconds"]
    if abs(ma - mb) >= 0.05:
        res["notes"].append("B's music is %.2f s %s than A's: compared where both have it" % (
            abs(mb - ma), "longer" if mb > ma else "shorter"))


def compare_songs(a: Audio, b: Audio, work_dir: Optional[str] = None) -> Tuple[dict, dict]:
    """(the comparison, what was compared). See the module's notes."""
    res: dict = {"a": describe(a), "b": describe(b), "notes": [], "identical": False, "aligned": False}
    for key, audio in (("a", a), ("b", b)):
        res[key]["dynamics"] = dynamics(audio)
        if res[key]["dynamics"].get("silent"):
            raise AudioFileError("%s is digital silence: there is nothing to compare" % key.upper())
        if res[key]["lossy"]:
            res["notes"].append("%s is a lossy file (%s): its decoder adds differences of its own"
                                % (key.upper(), res[key]["lossy"]))
    res["coarser_bits"] = min(_bits(res["a"]), _bits(res["b"]))
    res["floor_dbfs"] = floor_dbfs(res["coarser_bits"])
    a2, b2, done = common_ground(a, b, work_dir)
    res["common"] = done
    rate = done["rate"]
    if done["resampled"]:
        r = done["resampled"]
        res["notes"].append("%s resampled from %g to %g kHz for the comparison (%s)" % (
            r["which"].upper(), r["from"] / 1000, r["to"] / 1000, r["with"]))
    if done["downmixed"]:
        res["notes"].append("A has %d channels and B %d: both compared as mono (their channels averaged)"
                            % (done["downmixed"]["a"], done["downmixed"]["b"]))
    used = {"a": a2, "b": b2, "lag": 0, "gains": np.ones(a2.channels)}
    exact = None
    if not done["resampled"] and not done["downmixed"]:
        exact = exact_compare(*comparable(a2, b2), rate)
    if exact is not None and _exact_verdict(exact) in ("IDENTICAL", "PARTIAL"):
        res.update({"identical": True, "aligned": True, "correlation": 1.0, "level_db": 0.0,
                    "level_db_channels": [0.0] * a2.channels, "polarity_inverted": False,
                    "polarity_channels": [False] * a2.channels})
        lag, frac = exact["lag"], 0.0
        res["null"] = {"depth_db": None, "residual_dbfs": None, "in_band_dbfs": None, "in_band_depth_db": None,
                       "channels": [{"depth_db": None, "residual_dbfs": None} for _ in range(a2.channels)]}
        used["lag"] = lag
    else:
        nt = null_test(a2, b2)
        res["correlation"] = nt.get("correlation")
        res["aligned"] = bool(nt["aligned"] and abs(nt["correlation"] or 0) >= MIN_CORRELATION)
        if not res["aligned"]:
            decide(res)
            res["offset"] = None
            return res, used
        lag, frac, g = nt["lag"], nt["fraction"], np.array(nt["gains"])
        res["level_db_channels"] = [20 * math.log10(abs(x)) if x else None for x in g]
        res["level_db"] = 10 * math.log10(float(np.mean(g * g))) if np.any(g) else None
        res["polarity_channels"] = [bool(x < 0) for x in g]
        res["polarity_inverted"] = bool(np.all(g < 0))
        res["null"], res["spectrum"] = nt["null"], nt["spectrum"]
        used.update({"b": nt["shifted_b"], "lag": lag, "gains": g})
        if frac:
            res["notes"].append("B lined up to a fraction of a sample (%.2f samples)" % frac)
    res["offset"] = {"samples": lag + frac, "ms": 1000.0 * (lag + frac) / rate, "rate": rate}
    _lengths(res, a2, b2, lag)
    res["where"] = where(res.get("spectrum") or {}, res["null"], res["floor_dbfs"], bool(done["resampled"]))
    res["in_band_hz"] = IN_BAND_HZ
    decide(res)
    return res, used
