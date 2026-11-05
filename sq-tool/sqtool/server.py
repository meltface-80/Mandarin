"""The web interface: pick a song, have Mandarin play it to a zone and record what its DAC is fed, compare.

Plain standard-library HTTP server with a small JSON API; the page itself lives in sqtool/web/. Mandarin starts it
on a port of its own computer only (127.0.0.1) and serves it at /sq-tool/ behind its sign-in; the recording comes
from Mandarin (POST /api/tests/<id>/recording).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import traceback
import urllib.parse
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, List, Optional

from . import __version__
from .sessions import Tests, clean
from .wavio import AudioFileError

WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
MAX_UPLOAD = 4 << 30
STATIC_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json"}


# --------------------------------------------------------------------------
# The tests


class App:
    def __init__(self, data_dir: str, music_dir: str, log: Callable[[str], None] = print):
        self.tests = Tests(data_dir, music_dir, log)
        self.log = log

    def state(self, tid: Optional[str] = None) -> dict:
        usage = shutil.disk_usage(self.tests.data_dir)
        out = {"version": __version__, "free_bytes": usage.free,
               "music": {"available": self.tests.music_available(), "root": self.tests.music_dir},
               "busy": not self.tests.idle()}
        if tid:
            try:
                out["test_rev"] = self.tests.rev(tid)
            except KeyError:
                out["test_rev"] = None
        return out


# --------------------------------------------------------------------------
# HTTP


def _content_disposition(filename: str) -> str:
    ascii_name = re.sub(r"[^A-Za-z0-9 ._()-]+", "_", filename)
    return "attachment; filename=\"%s\"; filename*=UTF-8''%s" % (ascii_name, urllib.parse.quote(filename))


def _num(query: dict, key: str, default: float) -> float:
    try:
        return float(query.get(key, default))
    except (TypeError, ValueError):
        raise ValueError("%s must be a number" % key)


class Handler(BaseHTTPRequestHandler):
    server_version = "sq-tool/" + __version__
    app: App  # set by make_server()

    def log_message(self, fmt, *args):  # keep the container log for what matters
        pass

    # -- helpers -----------------------------------------------------------------

    def _send(self, status: int, body: bytes, ctype: str, headers: Optional[dict] = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        headers = dict(headers or {})
        headers.setdefault("Cache-Control", "no-store")
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, status: int = 200) -> None:
        self._send(status, json.dumps(clean(obj)).encode(), "application/json")

    def _fail(self, status: int, message: str) -> None:
        self._json({"error": message}, status)

    def _body_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length < 0 or length > 1 << 20:
            raise ValueError("bad request length")
        data = self.rfile.read(length) if length else b""
        try:
            body = json.loads(data.decode() or "{}")
        except ValueError:
            raise ValueError("malformed JSON")
        if not isinstance(body, dict):
            raise ValueError("expected a JSON object")
        return body

    def _stream(self, chunks, size: int, ctype: str, filename: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        self.send_header("Content-Disposition", _content_disposition(filename))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command == "HEAD":
            return
        for chunk in chunks:
            self.wfile.write(chunk)

    def _file(self, path: str, ctype: str, filename: str) -> None:
        size = os.path.getsize(path)

        def chunks():
            with open(path, "rb") as f:
                while True:
                    block = f.read(1 << 20)
                    if not block:
                        return
                    yield block

        self._stream(chunks(), size, ctype, filename)

    # -- routing -----------------------------------------------------------------

    def do_GET(self):
        self._route("GET")

    def do_HEAD(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_PATCH(self):
        self._route("PATCH")

    def do_DELETE(self):
        self._route("DELETE")

    def _route(self, method: str) -> None:
        url = urllib.parse.urlsplit(self.path)
        query = dict(urllib.parse.parse_qsl(url.query))
        try:
            for m, pattern, func in ROUTES:
                match = re.fullmatch(pattern, url.path)
                if m == method and match:
                    func(self, *[urllib.parse.unquote(g) for g in match.groups()], query=query)
                    return
            if method == "GET":
                self._static(url.path)
            else:
                self._fail(404, "not found")
        except KeyError:
            self._fail(404, "not found")
        except (AudioFileError, ValueError) as exc:
            self._fail(400, str(exc))
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            traceback.print_exc()
            self._fail(500, "internal error: %s" % exc)

    def _static(self, path: str) -> None:
        name = "index.html" if path in ("/", "/index.html") else path.lstrip("/")
        full = os.path.join(WEB_DIR, name)
        if not re.fullmatch(r"[a-z0-9_.-]+", name) or not os.path.isfile(full):
            self._fail(404, "not found")
            return
        with open(full, "rb") as f:
            self._send(200, f.read(), STATIC_TYPES.get(os.path.splitext(name)[1], "application/octet-stream"))

    # -- API -----------------------------------------------------------------------

    def api_state(self, query):
        self._json(self.app.state(query.get("test")))

    def api_browse(self, query):
        self._json(self.app.tests.browse(query.get("path", "")))

    def api_search(self, query):
        self._json(self.app.tests.search(query.get("q", "")))

    def api_tests(self, query):
        self._json(self.app.tests.list())

    def api_test_create(self, query):
        path = str(self._body_json().get("path") or "")
        if not path:
            raise ValueError("choose a song")
        self._json({"id": self.app.tests.create(path)})

    def api_recording(self, tid, query):
        """What a zone's DAC was fed, recorded by Mandarin: a WAV as the body (its length given), the zone named."""
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_UPLOAD:
            raise ValueError("send the recording as the request body (up to 4 GB)")
        zone = str(query.get("zone") or "").strip()[:80]
        folder = os.path.join(self.app.tests.tmp, "recording-%s" % uuid.uuid4().hex[:8])
        os.makedirs(folder)
        wav = os.path.join(folder, "recording.wav")
        try:
            with open(wav, "wb") as f:
                left = length
                while left:
                    block = self.rfile.read(min(left, 1 << 20))
                    if not block:
                        raise ValueError("the recording was cut off")
                    f.write(block)
                    left -= len(block)
            # Read whole before anything is refused: an answer while it is still being sent breaks its connection.
            if not zone:
                raise ValueError("name the zone recorded")
            details = {k: query[k] for k in ("device", "said") if query.get(k)}
            self.app.tests.add_recording(tid, wav, zone, details)
        except BaseException:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        self._json({"id": tid})

    def api_test(self, tid, query):
        self._json(self.app.tests.get(tid))

    def api_test_delete(self, tid, query):
        self.app.tests.delete(tid)
        self._json({"deleted": tid})

    def api_spectrogram(self, tid, which, query):
        png, info = self.app.tests.spectrogram(
            tid, which, _num(query, "t0", 0), _num(query, "t1", 0), int(_num(query, "w", 1200)),
            int(_num(query, "h", 360)), query.get("scale", "log"), _num(query, "floor", -150),
            query.get("matched") in ("1", "true"))
        self._send(200, png, "image/png", {"X-Spectrogram": json.dumps(clean(info)),
                                           "Cache-Control": "private, max-age=86400"})

    def api_audio(self, tid, which, query):
        self._file(self.app.tests.audio_path(tid, which), "audio/wav", self.app.tests.audio_filename(tid, which))

    def api_difference(self, tid, key, query):
        chunks, size, filename = self.app.tests.difference_wav(tid, key, query.get("matched") in ("1", "true"))
        self._stream(chunks, size, "audio/wav", filename)


ID = r"([A-Za-z0-9][A-Za-z0-9._-]*)"
ROUTES = [
    ("GET", r"/api/state", Handler.api_state),
    ("GET", r"/api/browse", Handler.api_browse),
    ("GET", r"/api/search", Handler.api_search),
    ("GET", r"/api/tests", Handler.api_tests),
    ("POST", r"/api/tests", Handler.api_test_create),
    ("GET", r"/api/tests/" + ID, Handler.api_test),
    ("DELETE", r"/api/tests/" + ID, Handler.api_test_delete),
    ("POST", r"/api/tests/" + ID + r"/recording", Handler.api_recording),
    ("GET", r"/api/tests/" + ID + r"/spectrogram/([a-z-]+)\.png", Handler.api_spectrogram),
    ("GET", r"/api/tests/" + ID + r"/audio/([a-z]+)\.wav", Handler.api_audio),
    ("GET", r"/api/tests/" + ID + r"/difference/([a-z]+)\.wav", Handler.api_difference),
]


def make_server(data_dir: str, music_dir: str, host: str = "0.0.0.0", port: int = 3400,
                log: Callable[[str], None] = print) -> ThreadingHTTPServer:
    app = App(data_dir, music_dir, log)
    handler = type("BoundHandler", (Handler,), {"app": app})
    httpd = ThreadingHTTPServer((host, port), handler)
    httpd.daemon_threads = True
    httpd.app = app  # type: ignore[attr-defined]
    return httpd


def serve(data_dir: str, music_dir: str, host: str = "127.0.0.1", port: int = 3400,
          log: Callable[[str], None] = print) -> None:
    httpd = make_server(data_dir, music_dir, host, port, log)
    log("SQ-tool %s is running on %s:%d, for Mandarin to serve at /sq-tool/."
        % (__version__, httpd.server_address[0], httpd.server_address[1]))
    log("Data folder: %s" % os.path.abspath(data_dir))
    log("Music folder: %s%s" % (os.path.abspath(music_dir), "" if os.path.isdir(music_dir) else " (not found)"))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
