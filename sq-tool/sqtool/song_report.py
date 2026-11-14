"""The plain-text report of two songs compared (`sq-tool compare-files a b`; sqtool/songs.py)."""

from __future__ import annotations

import math
from typing import List, Optional


def db(v: Optional[float], digits: int = 1, sign: bool = False) -> str:
    """A level in dB as text: -inf for nothing, a sign when asked."""
    if v is None or (isinstance(v, float) and (math.isinf(v) or math.isnan(v))):
        return "-inf"
    return ("%+.*f" if sign else "%.*f") % (digits, v)


def freq(f: float) -> str:
    return "%.0f Hz" % f if f < 1000 else "%g kHz" % round(f / 1000, 1)


def song_line(info: dict) -> str:
    kind = "float" if info["is_float"] else "%d-bit" % info["bits"]
    return "%s: %s, %d ch, %g kHz, %.3f s" % (info["label"] or "?", kind, info["channels"], info["rate"] / 1000,
                                              info["seconds"])


def null_lines(res: dict) -> List[str]:
    null = res.get("null") or {}
    out = []
    if res.get("identical"):
        return ["Null depth   nothing left: the samples are identical"]
    if null.get("depth_db") is None:
        return out
    if null["residual_dbfs"] is not None and null["residual_dbfs"] < -200:
        return ["Null depth   nothing left once matched (below -200 dBFS)"]
    out.append("Null depth   %s dB against the music (what is left: %s dBFS rms)"
               % (db(null["depth_db"]), db(null["residual_dbfs"])))
    if null.get("in_band_depth_db") is not None and null["depth_db"] - null["in_band_depth_db"] > 0.5:
        out.append("             below 20 kHz: %s dB against the music (%s dBFS rms)"
                   % (db(null["in_band_depth_db"]), db(null["in_band_dbfs"])))
    chans = null.get("channels") or []
    if len(chans) > 1:
        out.append("             by channel: " + " | ".join(
            "ch%d %s dB (%s dBFS)" % (i + 1, db(c["depth_db"]), db(c["residual_dbfs"])) for i, c in enumerate(chans)))
    return out


def offset_text(res: dict) -> str:
    off = res.get("offset")
    if not off:
        return "-"
    s = off["samples"]
    if abs(s) < 0.005:
        return "none: they start together"
    return "B starts %s samples (%.3f ms) %s than A" % (("%.2f" % abs(s)).rstrip("0").rstrip("."), abs(off["ms"]),
                                                       "later" if s > 0 else "earlier")


DYNAMICS = [("Peak", "peak_dbfs", "dBFS"), ("RMS", "rms_dbfs", "dBFS"), ("Crest factor", "crest_db", "dB"),
            ("Loudness", "lufs", "LUFS"), ("Loudness range", "lra_lu", "LU"), ("Peak to loudness", "plr_db", "dB")]


def dynamics_lines(res: dict) -> List[str]:
    a, b = res["a"].get("dynamics") or {}, res["b"].get("dynamics") or {}
    out = ["Dynamics     %-16s %10s %10s %10s" % ("", "A", "B", "B - A")]
    for name, key, unit in DYNAMICS:
        va, vb = a.get(key), b.get(key)
        diff = db(vb - va, 1, True) if va is not None and vb is not None else "-"
        out.append("             %-16s %10s %10s %10s" % (name, db(va) + " " + unit if va is not None else "-",
                                                         db(vb) + " " + unit if vb is not None else "-", diff))
    return out


def band_lines(res: dict) -> List[str]:
    bands = (res.get("spectrum") or {}).get("bands") or []
    if not bands:
        return []
    out = ["Difference by third octave (dBFS rms: what is left | the music)"]
    for b in bands:
        out.append("  %10s  %8s  %8s" % (freq(b["freq"]), db(b["residual_dbfs"]), db(b["music_dbfs"])))
    return out


def format_song_comparison(res: dict, bands: bool = False) -> str:
    lines = []
    for key in ("a", "b"):
        info = res[key]
        lines.append("%s  %s" % (key.upper(), info["path"] or "(file)"))
        lines.append("   %s" % song_line(info))
    lines.append("")
    lines.append("%s: %s." % (res["headline"].upper(), res["words"]))
    lines.append("")
    lines.extend(null_lines(res))
    if res.get("aligned"):
        lines.append("Level        %s" % ("B %s dB against A" % db(res.get("level_db"), 2, True)
                                         + ("" if len(set(round(x or 0, 2) for x in res.get("level_db_channels") or []))
                                            <= 1 else " (by channel: %s)" % " | ".join(
                                                db(x, 2, True) for x in res["level_db_channels"]))))
        lines.append("Offset       %s" % offset_text(res))
        lines.append("Polarity     %s" % ("inverted" if res.get("polarity_inverted") else "the same" if not any(
            res.get("polarity_channels") or []) else "inverted on some channels"))
        if res.get("where"):
            lines.append("Where        %s" % res["where"])
        if res.get("overlap"):
            lines.append("Compared     %.3f s where both play" % res["overlap"]["seconds"])
    elif res.get("correlation") is not None:
        lines.append("Alignment    none found (best correlation %.3f)" % res["correlation"])
    lines.append("")
    lines.extend(dynamics_lines(res))
    if res.get("notes"):
        lines.append("")
        lines.extend("Note: " + n for n in res["notes"])
    if bands:
        lines.append("")
        lines.extend(band_lines(res))
    return "\n".join(lines)
