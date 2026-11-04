"""Web API tests: the real server, handed its recordings as Mandarin hands them."""

import json
import os
import shutil
import tempfile
import time
import unittest
import urllib.error
import urllib.request

import numpy as np

import fake_server

from sqtool.wavio import read_wav


def call(base, path, method="GET", json_body=None, data=None):
    headers = {}
    body = None
    if json_body is not None:
        body = json.dumps(json_body).encode()
        headers["Content-Type"] = "application/json"
    if data is not None:
        body = data
        headers["Content-Type"] = "application/octet-stream"
    req = urllib.request.Request(base + path, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if r.headers.get("Content-Type") == "application/json" else raw), r.headers
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read()), e.headers


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="sq-server-test-")
        cls.music = os.path.join(cls.tmp, "music")
        cls.httpd, cls.base = fake_server.start(os.path.join(cls.tmp, "data"), music_dir=cls.music, seconds=4.0)
        cls.app = cls.httpd.app

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def wait_test(self, tid, ready, timeout=120):
        deadline = time.time() + timeout
        while time.time() < deadline:
            t = call(self.base, "/api/tests/" + tid)[1]
            if ready(t):
                return t
            time.sleep(0.1)
        self.fail("timed out: %s" % json.dumps({k: t[k] for k in ("source", "captures", "results")}))

    def recorded(self, tid, **kw):
        self.assertEqual(fake_server.post_recording(self.base, self.app, tid, **kw), {"id": tid})
        return self.wait_test(tid, lambda t: (t["results"].get("a") or {}).get("state") == "ready")

    def song(self):
        found = call(self.base, "/api/search?q=demo%2016")[1]
        self.assertEqual([f["name"] for f in found], ["02 Demo Song (16-44).wav"])
        status, r, _ = call(self.base, "/api/tests", "POST", {"path": found[0]["path"]})
        self.assertEqual(status, 200, r)
        t = self.wait_test(r["id"], lambda t: t["source"]["state"] != "preparing")
        self.assertEqual(t["source"]["state"], "ready", t["source"])
        return t

    def test_full_flow(self):
        status, state, _ = call(self.base, "/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(sorted(state), ["busy", "free_bytes", "music", "version"])  # no recorder, no settings
        self.assertTrue(state["music"]["available"])

        root = call(self.base, "/api/browse")[1]
        self.assertEqual(root["dirs"], ["SQ-tool Demo"])
        album = call(self.base, "/api/browse?path=SQ-tool%20Demo/Example%20Album")[1]
        self.assertEqual([f["name"] for f in album["files"]], ["01 Demo Song (24-96).wav", "02 Demo Song (16-44).wav"])

        t = self.song()
        tid = t["id"]
        self.assertEqual((t["title"], t["artist"], t["source"]["rate"], t["players"]), ("Demo Song (16-44)", "SQ-tool Demo", 44100, {"a": ""}))
        self.assertEqual(call(self.base, "/api/state?test=" + tid)[1]["test_rev"], t["rev"])

        t = self.recorded(tid)  # bit-perfect
        self.assertEqual((t["results"]["a"]["verdict"], t["results"]["a"]["short"]), ("IDENTICAL", "BIT-PERFECT"))
        self.assertEqual((t["players"]["a"], t["captures"]["a"]["player"], t["captures"]["a"]["method"]), ("FiiO R7 USB", "FiiO R7 USB", "mandarin"))
        self.assertEqual(sorted(t["results"]), ["a"])
        listed = call(self.base, "/api/tests")[1]
        self.assertEqual((listed[0]["id"], listed[0]["results"]["a"]["short"]), (tid, "BIT-PERFECT"))

        # Spectrograms (PNG + their axis information in a header): the song, what the DAC was fed, the difference.
        for which in ("source", "a", "diff-a"):
            status, png, headers = call(self.base, "/api/tests/%s/spectrogram/%s.png?w=400&h=120&floor=-160" % (tid, which))
            self.assertEqual(status, 200, png)
            self.assertEqual(headers["Content-Type"], "image/png")
            self.assertTrue(png.startswith(b"\x89PNG"))
            info = json.loads(headers["X-Spectrogram"])
            self.assertEqual((info["width"], info["height"], info["db_low"], info["rate"]), (400, 120, -160, 44100))
        for gone in ("b", "diff-b", "diff-ab", "nope"):
            self.assertEqual(call(self.base, "/api/tests/%s/spectrogram/%s.png" % (tid, gone))[0], 404, gone)
        status, err, _ = call(self.base, "/api/tests/%s/spectrogram/a.png?t0=x" % tid)
        self.assertEqual((status, err["error"]), (400, "t0 must be a number"))

        # Downloads: the recording and the difference.
        status, wav, headers = call(self.base, "/api/tests/%s/audio/a.wav" % tid)
        self.assertIn("attachment", headers["Content-Disposition"])
        self.assertIn("FiiO R7 USB.wav", headers["Content-Disposition"])
        self.assertEqual(read_wav(bytes(wav)).label, "WAV PCM 32-bit")
        status, wav, headers = call(self.base, "/api/tests/%s/difference/a.wav" % tid)
        self.assertEqual(status, 200)
        diff = read_wav(bytes(wav))
        self.assertTrue(diff.is_float)
        self.assertFalse(diff.data.any())
        self.assertEqual(call(self.base, "/api/tests/%s/difference/ab.wav" % tid)[0], 404)

        # Recorded again with the volume in software: not bit-perfect, and how not.
        t = self.recorded(tid, zone="Kitchen", scaled=True)
        self.assertEqual((t["players"]["a"], t["results"]["a"]["verdict"]), ("Kitchen", "DIFFERENT"))
        self.assertIn("level changed: -0.500 dB, -0.500 dB (by channel)", t["results"]["a"]["lines"])
        self.assertEqual(os.listdir(os.path.join(self.tmp, "data", "tmp")), [])  # the upload went to the test

        status, _, _ = call(self.base, "/api/tests/" + tid, "DELETE")
        self.assertEqual(status, 200)
        self.assertEqual(call(self.base, "/api/tests/" + tid)[0], 404)
        self.assertIsNone(call(self.base, "/api/state?test=" + tid)[1]["test_rev"])

    def test_recordings_refused(self):
        tid = self.song()["id"]
        wav = fake_server.fed(self.app, tid)
        status, err, _ = call(self.base, "/api/tests/%s/recording" % tid, "POST", data=wav)
        self.assertEqual((status, err["error"]), (400, "name the zone recorded"))
        status, err, _ = call(self.base, "/api/tests/20990101-000000-none/recording?zone=X", "POST", data=wav)
        self.assertEqual(status, 404)
        status, err, _ = call(self.base, "/api/tests/%s/recording?zone=X" % tid, "POST", data=b"")
        self.assertEqual((status, err["error"]), (400, "send the recording as the request body (up to 4 GB)"))
        # Not a WAV: the recording can't be analysed, and says so.
        status, _, _ = call(self.base, "/api/tests/%s/recording?zone=X" % tid, "POST", data=b"not audio at all")
        self.assertEqual(status, 200)
        t = self.wait_test(tid, lambda t: (t["captures"].get("a") or {}).get("state") == "error")
        self.assertTrue(t["captures"]["a"]["message"])
        self.assertEqual(os.listdir(os.path.join(self.tmp, "data", "tmp")), [])
        call(self.base, "/api/tests/" + tid, "DELETE")

    def test_static_files_and_errors(self):
        status, html, headers = call(self.base, "/")
        self.assertEqual(status, 200)
        self.assertIn(b"SQ-tool", html)
        self.assertTrue(headers["Content-Type"].startswith("text/html"))
        for name in ("app.js", "app.css", "icon.svg"):
            self.assertEqual(call(self.base, "/" + name)[0], 200)
        self.assertEqual(call(self.base, "/../server.py")[0], 404)
        self.assertEqual(call(self.base, "/api/tests/nope")[0], 404)
        self.assertEqual(call(self.base, "/api/tests/../../etc")[0], 404)
        status, err, _ = call(self.base, "/api/tests", "POST", {"path": "../../etc/passwd"})
        self.assertEqual((status, err["error"]), (400, "that is outside the music folder"))
        status, err, _ = call(self.base, "/api/tests", "POST", {"path": "SQ-tool Demo/missing.flac"})
        self.assertEqual(status, 404)
        # What SQ-tool no longer does: record, its settings, an upload of a song Mandarin couldn't play.
        for method, path in (("GET", "/api/settings"), ("POST", "/api/record/stop"), ("POST", "/api/loopback/load"), ("POST", "/api/tests/upload")):
            self.assertEqual(call(self.base, path, method, data=b"x" if method == "POST" else None)[0], 404, path)
        import http.client
        conn = http.client.HTTPConnection(self.base[len("http://"):], timeout=10)
        conn.putrequest("POST", "/api/tests")
        conn.putheader("Content-Length", "-1")
        conn.endheaders()
        resp = conn.getresponse()
        self.assertEqual((resp.status, json.loads(resp.read())["error"]), (400, "bad request length"))
        conn.close()


if __name__ == "__main__":
    unittest.main()
