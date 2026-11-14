"""Comparisons of two songs from Mandarin's music folder, for the page's "Compare two songs" (sqtool/songs.py).

Layout of a comparison under <data>/comparisons/<id>/:

    compare.json    the two songs (their paths in the music folder), its state, and the result
    a.wav, b.wav    A and B as compared: at the common rate and channel count, B moved by any sub-sample offset
    cache/*.png     rendered spectrograms

Made in the background, one at a time, by a worker of its own; the songs are read from the music folder by their
paths in it, as a test's song is (sessions.Tests.create).
"""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import queue
import re
import shutil
import threading
import traceback
import uuid
from typing import Iterator, List, Optional, Tuple

import numpy as np

from .analysis import _chunks, db_amp, to_float
from .common_ground import DSD_EXTENSIONS, load_song
from .sessions import AUDIO_EXTENSIONS, ID_RE, Tests, _filename, _read_json, _write_json, readable_formats
from .songs import compare_songs
from .spectrogram import COLOUR_MAP, difference, fetch_from, render
from .wavio import AudioFileError, float_wav_header, read_tags, write_wav

ITEMS = ("a", "b")
SPECTROGRAMS = ("a", "b", "diff")
NORMALISED_PEAK_DB = -1.0  # the gain-normalised difference file peaks here


def _now() -> str:
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


class Comparisons:
    """Every comparison of two songs, and the worker that makes them."""

    def __init__(self, tests: Tests):
        self.tests = tests
        self.root = os.path.join(tests.data_dir, "comparisons")
        os.makedirs(self.root, exist_ok=True)
        self._lock = threading.RLock()
        self._jobs: "queue.Queue" = queue.Queue()
        self.busy: Optional[str] = None
        self._render = threading.BoundedSemaphore(2)
        for cid in os.listdir(self.root):  # one interrupted by a restart: said, not left comparing for ever
            path = os.path.join(self.root, cid, "compare.json")
            c = _read_json(path)
            if c.get("state") == "comparing":
                c.update({"state": "error", "message": "SQ-tool stopped while comparing: compare them again"})
                _write_json(path, c)
        threading.Thread(target=self._worker, name="comparisons", daemon=True).start()

    def idle(self) -> bool:
        return self.busy is None and self._jobs.empty()

    # -- the comparisons -----------------------------------------------------------------

    def _song(self, rel: str, which: str) -> dict:
        if not rel:
            raise ValueError("choose song %s" % which.upper())
        path = self.tests._music_path(rel)
        if not os.path.isfile(path):
            raise KeyError(rel)
        ext = os.path.splitext(path)[1].lower()
        if ext in DSD_EXTENSIONS:
            raise ValueError("song %s is a DSD file: SQ-tool compares PCM only (it doesn't convert DSD to PCM)"
                             % which.upper())
        if ext in AUDIO_EXTENSIONS and ext not in readable_formats():
            raise ValueError("SQ-tool can't read %s files here: choose the FLAC, WAV or AIFF version" % ext)
        tags = read_tags(path)
        name = os.path.basename(path)
        return {"music_path": rel, "filename": name, "title": tags.get("title") or os.path.splitext(name)[0],
                "artist": tags.get("artist")}

    def _dir(self, cid: str) -> str:
        if not ID_RE.match(cid or ""):
            raise KeyError(cid)
        d = os.path.join(self.root, cid)
        if not os.path.isfile(os.path.join(d, "compare.json")):
            raise KeyError(cid)
        return d

    def _update(self, cid: str, fn) -> dict:
        with self._lock:
            path = os.path.join(self._dir(cid), "compare.json")
            c = _read_json(path)
            fn(c)
            _write_json(path, c)
            return c

    def create(self, a_rel: str, b_rel: str) -> str:
        """A new comparison of song A with song B, both by their paths in the music folder."""
        a, b = self._song(a_rel, "a"), self._song(b_rel, "b")
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        slug = re.sub(r"[^a-z0-9]+", "-", a["title"].lower()).strip("-")[:40] or "songs"
        with self._lock:
            cid, n = "%s-%s" % (stamp, slug), 2
            while os.path.exists(os.path.join(self.root, cid)):
                cid, n = "%s-%s-%d" % (stamp, slug, n), n + 1
            d = os.path.join(self.root, cid)
            os.makedirs(os.path.join(d, "cache"))
            _write_json(os.path.join(d, "compare.json"),
                        {"id": cid, "created": _now(), "a": a, "b": b, "state": "comparing"})
        self._jobs.put(cid)
        return cid

    def list(self) -> List[dict]:
        out = []
        for cid in os.listdir(self.root):
            c = _read_json(os.path.join(self.root, cid, "compare.json"))
            if c:
                r = c.get("result") or {}
                out.append({"id": cid, "created": c.get("created"), "state": c.get("state"),
                            "a": c.get("a"), "b": c.get("b"), "verdict": r.get("verdict"),
                            "headline": r.get("headline")})
        out.sort(key=lambda x: x.get("created") or "", reverse=True)
        return out

    def get(self, cid: str) -> dict:
        d = self._dir(cid)
        with self._lock:
            c = _read_json(os.path.join(d, "compare.json"))
        c["rev"] = os.stat(os.path.join(d, "compare.json")).st_mtime_ns
        return c

    def delete(self, cid: str) -> None:
        d = self._dir(cid)
        with self._lock:
            trash = os.path.join(self.tests.tmp, "deleted-%s-%s" % (cid, uuid.uuid4().hex[:6]))
            os.rename(d, trash)
        self.tests._forget(d)
        shutil.rmtree(trash, ignore_errors=True)

    # -- the work ------------------------------------------------------------------------

    def _worker(self) -> None:
        while True:
            cid = self._jobs.get()
            self.busy = cid
            try:
                self._compare(cid)
            except KeyError:
                pass  # deleted meanwhile
            except Exception as exc:
                if not isinstance(exc, (AudioFileError, ValueError)):
                    traceback.print_exc()
                msg = str(exc) or exc.__class__.__name__
                try:
                    self._update(cid, lambda c: c.update({"state": "error", "message": msg}))
                except KeyError:
                    pass
            finally:
                self.busy = None

    def _compare(self, cid: str) -> None:
        d = self._dir(cid)
        c = _read_json(os.path.join(d, "compare.json"))
        names = {w: c[w]["filename"] for w in ITEMS}
        a = load_song(self.tests._music_path(c["a"]["music_path"]), "song A (%s)" % names["a"])
        b = load_song(self.tests._music_path(c["b"]["music_path"]), "song B (%s)" % names["b"])
        res, used = compare_songs(a, b, self.tests.tmp)
        del a, b
        for w in ITEMS:
            res[w]["path"] = c[w]["music_path"]
            self.tests._forget(os.path.join(d, "%s.wav" % w))
            write_wav(os.path.join(d, "%s.wav" % w), used[w])
        lag, g = used["lag"], np.asarray(used["gains"], dtype=np.float64)
        res["lag"], res["gains"] = lag, g.tolist()
        res["difference_peak_dbfs"] = self._peak(used["a"], used["b"], lag, g)
        res["seconds"] = used["a"].duration
        self._update(cid, lambda c: c.update({"state": "ready", "result": res, "finished": _now()}))

    @staticmethod
    def _peak(a, b, lag: int, g: np.ndarray) -> Optional[float]:
        s0, s1 = max(0, -lag), min(a.frames, b.frames - lag)
        peak = 0.0
        for s, e in _chunks(s0, s1):
            peak = max(peak, float(np.abs(to_float(b, s + lag, e + lag) - to_float(a, s, e) * g).max(initial=0)))
        return db_amp(peak) if peak > 0 else None

    # -- outputs ---------------------------------------------------------------------------

    def _ready(self, cid: str) -> Tuple[str, dict]:
        d = self._dir(cid)
        c = _read_json(os.path.join(d, "compare.json"))
        if c.get("state") != "ready":
            raise ValueError("the comparison isn't ready")
        return d, c

    def _fetch(self, cid: str, which: str):
        """(fetch on A's timeline, rate, A's frames) for A, B or their difference (B - g x A)."""
        d, c = self._ready(cid)
        r = c["result"]
        a = self.tests._audio(os.path.join(d, "a.wav"))
        if which == "a":
            return fetch_from(a, 0), a.rate, a.frames
        b = self.tests._audio(os.path.join(d, "b.wav"))
        fb = fetch_from(b, int(r["lag"]))
        if which == "b":
            return fb, a.rate, a.frames
        return difference(fb, fetch_from(a, 0), np.diag(r["gains"])), a.rate, a.frames

    def audio_path(self, cid: str, which: str) -> Tuple[str, str]:
        if which not in ITEMS:
            raise KeyError(which)
        d, c = self._ready(cid)
        title = c[which]["title"]
        return os.path.join(d, "%s.wav" % which), _filename("%s - %s as compared.wav" % (title, which.upper()))

    def difference_wav(self, cid: str, normalised: bool = False) -> Tuple[Iterator[bytes], int, str]:
        """B - g x A over where both play, on A's timeline, as 32-bit float WAV; gain-normalised if asked."""
        _, c = self._ready(cid)
        r = c["result"]
        fetch, rate, frames = self._fetch(cid, "diff")
        lag = int(r["lag"])
        b = self.tests._audio(os.path.join(self._dir(cid), "b.wav"))
        s0, s1 = max(0, -lag), min(frames, b.frames - lag)
        n, ch = max(0, s1 - s0), b.channels
        peak = r.get("difference_peak_dbfs")
        gain = 10 ** ((NORMALISED_PEAK_DB - peak) / 20) if normalised and peak is not None else 1.0
        header = float_wav_header(rate, ch, n)

        def chunks() -> Iterator[bytes]:
            yield header
            for s in range(s0, s1, 1 << 16):
                yield (fetch(s, min(s1, s + (1 << 16))) * gain).astype("<f4").tobytes()

        what = "difference, gain-normalised to %g dBFS" % NORMALISED_PEAK_DB if normalised else "difference"
        name = _filename("%s - B minus A, %s.wav" % (c["a"]["title"], what))
        return chunks(), len(header) + n * ch * 4, name

    def spectrogram(self, cid: str, which: str, width: int, height: int, scale: str = "log",
                    db_low: float = -150.0) -> Tuple[bytes, dict]:
        """A spectrogram of A, B or their difference, over all of A's timeline."""
        if which not in SPECTROGRAMS:
            raise KeyError(which)
        scale = "linear" if scale == "linear" else "log"
        db_low = float(min(-20.0, max(-300.0, db_low)))
        width, height = int(min(max(width, 64), 4096)), int(min(max(height, 64), 2048))
        d, _ = self._ready(cid)
        sig = json.dumps([COLOUR_MAP, which, width, height, scale, db_low,
                          [os.path.getmtime(os.path.join(d, "%s.wav" % w)) for w in ITEMS]])
        cache = os.path.join(d, "cache", hashlib.sha1(sig.encode()).hexdigest()[:20] + ".png")
        if os.path.exists(cache) and os.path.exists(cache[:-4] + ".json"):
            with open(cache, "rb") as f:
                return f.read(), _read_json(cache[:-4] + ".json")
        fetch, rate, frames = self._fetch(cid, which)
        with self._render:
            png, info = render(fetch, rate, 0, frames, width, height, scale, 20.0, db_low, 0.0, rate / 2.0)
        info.update({"which": which, "t0": 0.0, "t1": frames / rate, "rate": rate, "db_low": db_low, "scale": scale})
        tmp = cache + ".%s.tmp" % uuid.uuid4().hex[:6]
        with open(tmp, "wb") as f:
            f.write(png)
        os.replace(tmp, cache)
        _write_json(cache[:-4] + ".json", info)
        return png, info
