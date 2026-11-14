"""MQA's signalling, found in a song and looked for again in what the DAC was fed (Mandarin's item 418).

Detection only, as the open identifiers do it (purpl3F0x's MQA_identifier, its Python port MQA-identifier-python; the
server's Mqa/MqaDetect.cs reads the same way): over stereo samples left-justified in 32-bit words, left XOR right, bit
16, 17 or 18 of each frame read as a stream, the newest bit lowest of a 36-bit register; MQA's sync word 0xbe0498c88
in one of them; then, counted from the frame that completes it, frames 3 to 6 the original sample rate's code and
frames 29 to 33 the provenance (above 8, MQA Studio). Nothing here decodes MQA.

A comparison of an MQA song with its capture says, under its verdict:

* "MQA signalling intact" where the capture is bit-identical (IDENTICAL, PARTIAL) and the signalling is found in it;
* "MQA signalling lost: <what changed>" where it isn't found there: the rate, the level, the samples, as the
  comparison found them;
* "MQA signalling still found, but not bit-perfect: <what changed>" where the sync word survived a change below it
  (dither at 24 bits, say): what the DAC decodes from it is no longer the encoder's.
"""

from __future__ import annotations

from typing import List, Optional

import numpy as np

SYNC = 0xBE0498C88
SECONDS = 10


def rate_of(code: int) -> int:
    """The original sample rate a 4-bit code says (the identifiers' OriginalSampleRateDecoder)."""
    base = 48000 if code & 1 else 44100
    times = 1 << (((code >> 3) & 1) | (((code >> 2) & 1) << 1) | (((code >> 1) & 1) << 2))
    if times > 16:
        times *= 2
    return base * times


def detect(data: np.ndarray, rate: int, seconds: float = SECONDS) -> Optional[dict]:
    """{ studio, original_rate } where the first [seconds] of stereo int32 [data] carry MQA's sync word, else None."""
    if data.ndim != 2 or data.shape[1] != 2 or data.dtype.kind != "i":
        return None
    n = min(len(data), int(rate * seconds))
    if n < 36:
        return None
    x = (data[:n + 40, 0].astype(np.int64) ^ data[:n + 40, 1].astype(np.int64)) & 0xFFFFFFFF
    weights = np.array([1 << (35 - j) for j in range(36)], dtype=np.int64)
    best = None
    for pos in (16, 17, 18):
        bits = ((x >> pos) & 1).astype(np.int64)
        # Each frame's register: the 36 bits up to and including it, the oldest highest.
        regs = np.lib.stride_tricks.sliding_window_view(bits[:n], 36) @ weights
        hits = np.flatnonzero(regs == SYNC)
        if len(hits) and (best is None or hits[0] + 35 < best[0]):
            best = (int(hits[0]) + 35, bits)
    if best is None:
        return None
    i, bits = best
    if i + 33 >= len(bits):
        return None
    code = 0
    for k in range(3, 7):
        code = (code << 1) | int(bits[i + k])
    provenance = 0
    for k in range(29, 34):
        provenance = (provenance << 1) | int(bits[i + k])
    return {"studio": provenance > 8, "original_rate": rate_of(code)}


def label(m: dict, bits: Optional[int] = None) -> str:
    """"MQA Studio · 24/352.8 original", as Mandarin says it."""
    rate = m.get("original_rate") or 0
    khz = ("%g" % (round(rate / 100) / 10)) if rate else ""
    return ("MQA Studio" if m.get("studio") else "MQA") + ((" · " + ("%d/" % bits if bits else "") + khz + " original") if rate else "")


def _changed(res: dict) -> str:
    """What the comparison found changed, in a few words."""
    if res.get("verdict") == "RESAMPLED":
        return "resampled from %d Hz to %d Hz" % (res["ref"]["rate"], res["cap"]["rate"])
    if res.get("verdict") == "CHANNELS":
        return "the channels changed"
    approx = res.get("approx") or {}
    gains = approx.get("gain_db")
    gain = (gains[0] if gains else None) if isinstance(gains, (list, tuple)) else gains
    if gain is not None and abs(gain) >= 0.005:
        return "the level changed by %+.2f dB" % gain
    findings = approx.get("findings") or []
    if findings:
        return findings[0]
    exact = res.get("exact") or {}
    if exact.get("events"):
        return "parts of the stream were dropped, inserted or altered"
    return "the samples were changed"


def notes(ref, cap, res: dict) -> List[str]:
    """The lines a comparison of [ref] (the song) with [cap] (what the DAC was fed) adds where the song is MQA."""
    if getattr(ref, "is_float", False) or getattr(ref, "channels", 0) != 2:
        return []
    found = detect(ref.data, ref.rate)
    if found is None:
        return []
    said = label(found, ref.bits if ref.bits in (16, 24) else None)
    kept = None if getattr(cap, "is_float", False) or cap.channels != 2 else detect(cap.data, cap.rate)
    if res.get("verdict") in ("IDENTICAL", "PARTIAL") and kept is not None:
        return ["%s: MQA signalling intact" % said]
    if kept is not None:
        return ["%s: MQA signalling still found, but not bit-perfect: %s" % (said, _changed(res))]
    return ["%s: MQA signalling lost: %s" % (said, _changed(res))]
