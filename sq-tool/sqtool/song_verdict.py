"""The verdict on two songs compared (sqtool/songs.py), in plain words, and the thresholds behind it.

In order, the first that holds:

* IDENTICAL: the same samples (bit for bit, neither resampled nor mixed down), wherever both have music; or the same
  values in another sample format (nothing left below -200 dBFS, the analysis's own rounding, with no level change).
* DIFFERENT RECORDINGS: nothing lines up (no alignment, or a correlation under 0.3), or what is left after matching
  is within 6 dB of the music: they share little.
* Below 20 kHz, what is left is at the noise floor of the coarser of the two files (-6.02 dB per bit: -96 dBFS at
  16 bits, -144 dBFS at 24, a floating-point file counted as 24) or no more than 10 dB above it, or 90 dB or more
  below the music; then:
  * DIFFERENT ABOVE 20 kHz: neither was resampled, over the whole spectrum it is more than that, and 90% or more of
    what is left lies above 20 kHz;
  * otherwise SAME MASTER: the difference is only resampling, rounding and dither, and a level change or inverted
    polarity, which the words say.
* DIFFERENT MASTER: the same music, lined up, but more is left: the words say how B differs (louder or quieter by
  1 LU or more of loudness, more or less compressed by 1 LU or more of loudness range or 1 dB or more of crest
  factor), and how far below the music what is left lies.
"""

from __future__ import annotations

from typing import List, Optional

SILENT_DBFS = -200.0
MIN_CORRELATION = 0.3
RECORDINGS_DEPTH_DB = -6.0
FLOOR_MARGIN_DB = 10.0
SAME_MASTER_DEPTH_DB = -90.0
ABOVE_20K_SHARE = 0.9
LOUDER_LU = 1.0
COMPRESSED_LU = 1.0
COMPRESSED_CREST_DB = 1.0
LEVEL_SHOWN_DB = 0.05

HEADLINES = {
    "IDENTICAL": "Identical",
    "SAME MASTER": "The same master",
    "ABOVE 20 KHZ": "Different only above 20 kHz",
    "DIFFERENT MASTER": "The same music, a different master",
    "DIFFERENT RECORDINGS": "Different recordings",
}


def floor_dbfs(bits: Optional[int]) -> float:
    """The rms of rounding to `bits` with TPDF dither: half a step, -6.02 dB per bit."""
    return -6.0206 * (bits or 24)


def _neg(v: float) -> str:
    return "null depth −%.0f dB" % -v if v < 0 else "null depth %.0f dB" % v


def level_words(level_db: Optional[float], inverted: bool) -> List[str]:
    out = []
    if level_db is not None and abs(level_db) >= LEVEL_SHOWN_DB:
        out.append("B is %.2f dB %s" % (abs(level_db), "louder" if level_db > 0 else "quieter"))
    if inverted:
        out.append("B's polarity is inverted")
    return out


def master_words(a: dict, b: dict) -> List[str]:
    """How B's master differs from A's: louder or quieter, more or less compressed."""
    out = []
    la, lb = a.get("lufs"), b.get("lufs")
    if la is not None and lb is not None and abs(lb - la) >= LOUDER_LU:
        out.append("B is %.1f dB %s" % (abs(lb - la), "louder" if lb > la else "quieter"))
    ra, rb = a.get("lra_lu"), b.get("lra_lu")
    ca, cb = a.get("crest_db"), b.get("crest_db")
    less_range = ra is not None and rb is not None and ra - rb >= COMPRESSED_LU
    more_range = ra is not None and rb is not None and rb - ra >= COMPRESSED_LU
    less_crest = ca is not None and cb is not None and ca - cb >= COMPRESSED_CREST_DB
    more_crest = ca is not None and cb is not None and cb - ca >= COMPRESSED_CREST_DB
    if (less_range or less_crest) and not (more_range or more_crest):
        out.append("more compressed" if out else "B is more compressed")
    elif (more_range or more_crest) and not (less_range or less_crest):
        out.append("less compressed" if out else "B is less compressed")
    return out


def _null_ok(dbfs: Optional[float], depth: Optional[float], floor: float) -> bool:
    """At the floor of the coarser file (or within FLOOR_MARGIN_DB of it), or SAME_MASTER_DEPTH_DB below the music."""
    return (dbfs is not None and dbfs <= floor + FLOOR_MARGIN_DB) or (depth is not None and depth <= SAME_MASTER_DEPTH_DB)


def decide(res: dict) -> None:
    """Sets res["verdict"], res["headline"] and res["words"] from a comparison (sqtool/songs.py)."""
    null = res.get("null") or {}
    spec = res.get("spectrum") or {}
    resampled = (res.get("common") or {}).get("resampled")
    floor = res["floor_dbfs"]
    level = level_words(res.get("level_db"), res.get("polarity_inverted", False))
    rest = null.get("residual_dbfs")
    nothing = rest is not None and rest < SILENT_DBFS
    changed = resampled or (res.get("common") or {}).get("downmixed")
    if res.get("identical") or (nothing and not level and not changed):
        verdict = "IDENTICAL"
        words = "A and B carry exactly the same samples" if res.get("identical") else \
            "A and B carry the same values (in different sample formats)"
    elif not res.get("aligned") or (null.get("depth_db") or 0) > RECORDINGS_DEPTH_DB:
        verdict = "DIFFERENT RECORDINGS"
        words = ("they don't line up anywhere: different performances, or different songs" if not res.get("aligned")
                 else "they line up, but differ about as much as they agree (%s)" % _neg(null.get("depth_db") or 0))
    elif _null_ok(null.get("in_band_dbfs"), null.get("in_band_depth_db"), floor):
        whole = _null_ok(rest, null.get("depth_db"), floor)
        if not resampled and not whole and spec.get("above_20k_share", 0) >= ABOVE_20K_SHARE:
            verdict = "ABOVE 20 KHZ"
            words = "below 20 kHz they null to the noise floor, as one master does; %d%% of the difference " \
                "lies above 20 kHz (%s)" % (round(100 * spec["above_20k_share"]), _neg(null["depth_db"]))
        else:
            verdict = "SAME MASTER"
            causes = []
            if resampled:
                causes.append("resampling")
            if null.get("in_band_dbfs") is not None and null["in_band_dbfs"] >= SILENT_DBFS:
                causes.append("rounding and dither at %d bits" % (res.get("coarser_bits") or 24))
            if (res.get("common") or {}).get("downmixed"):
                level = ["mixed down to mono"] + level
            if causes:
                deep = null.get("in_band_depth_db")
                part = (" below 20 kHz" if deep is not None and null.get("depth_db") is not None
                        and null["depth_db"] - deep > 3 else "")
                said = "the difference is only from %s (%s%s)" % (
                    ", and ".join(causes), _neg(deep if part else null["depth_db"]), part)
                if resampled and spec.get("above_20k_share", 0) >= 0.5:
                    said += "; above 20 kHz, the resamplers' filters differ"
            else:
                said = "nothing else differs"
            words = "; ".join(level + [said])
    else:
        verdict = "DIFFERENT MASTER"
        how = master_words(res["a"].get("dynamics") or {}, res["b"].get("dynamics") or {})
        words = (" and ".join(how) if how else "they differ in EQ or processing") + \
            " (%s)" % _neg(null.get("depth_db") or 0)
    res["verdict"] = verdict
    res["headline"] = HEADLINES[verdict]
    res["words"] = words[0].upper() + words[1:] if words else ""
