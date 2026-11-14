"""The web API of "Compare two songs" (sqtool/comparisons.py), part of SQ-tool's server (sqtool/server.py).

    GET    /api/comparisons                                  every comparison, newest first
    POST   /api/comparisons {"a": path, "b": path}           a new one, of two songs by their paths in the music folder
    GET    /api/comparisons/<id>                             its state and, once ready, its result
    DELETE /api/comparisons/<id>
    GET    /api/comparisons/<id>/spectrogram/<a|b|diff>.png  ?w=&h=&scale=log|linear&floor=dBFS
    GET    /api/comparisons/<id>/audio/<a|b>.wav             A or B as compared
    GET    /api/comparisons/<id>/difference.wav              B - A, matched; ?normalised=1: gain-normalised
"""

from __future__ import annotations

import json


def _num(query: dict, key: str, default: float) -> float:
    try:
        return float(query.get(key, default))
    except (TypeError, ValueError):
        raise ValueError("%s must be a number" % key)


class CompareRoutes:
    """Handler methods for the routes above (mixed into server.Handler, whose helpers they use)."""

    def api_comparisons(self, query):
        self._json(self.app.comparisons.list())

    def api_comparison_create(self, query):
        body = self._body_json()
        self._json({"id": self.app.comparisons.create(str(body.get("a") or ""), str(body.get("b") or ""))})

    def api_comparison(self, cid, query):
        self._json(self.app.comparisons.get(cid))

    def api_comparison_delete(self, cid, query):
        self.app.comparisons.delete(cid)
        self._json({"deleted": cid})

    def api_comparison_spectrogram(self, cid, which, query):
        from .sessions import clean
        png, info = self.app.comparisons.spectrogram(cid, which, int(_num(query, "w", 1200)), int(_num(query, "h", 300)),
                                                     query.get("scale", "log"), _num(query, "floor", -150))
        self._send(200, png, "image/png", {"X-Spectrogram": json.dumps(clean(info)),
                                           "Cache-Control": "private, max-age=86400"})

    def api_comparison_audio(self, cid, which, query):
        path, filename = self.app.comparisons.audio_path(cid, which)
        self._file(path, "audio/wav", filename)

    def api_comparison_difference(self, cid, query):
        chunks, size, filename = self.app.comparisons.difference_wav(cid, query.get("normalised") in ("1", "true"))
        self._stream(chunks, size, "audio/wav", filename)


def routes(ident: str) -> list:
    """(method, pattern, handler) for each route, ids matching `ident`."""
    base = r"/api/comparisons/" + ident
    return [
        ("GET", r"/api/comparisons", CompareRoutes.api_comparisons),
        ("POST", r"/api/comparisons", CompareRoutes.api_comparison_create),
        ("GET", base, CompareRoutes.api_comparison),
        ("DELETE", base, CompareRoutes.api_comparison_delete),
        ("GET", base + r"/spectrogram/(a|b|diff)\.png", CompareRoutes.api_comparison_spectrogram),
        ("GET", base + r"/audio/(a|b)\.wav", CompareRoutes.api_comparison_audio),
        ("GET", base + r"/difference\.wav", CompareRoutes.api_comparison_difference),
    ]
