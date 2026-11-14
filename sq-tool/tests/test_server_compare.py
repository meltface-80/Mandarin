"""The web API of "Compare two songs": two songs of the music folder compared, the result, its pictures and files."""

import json
import os
import shutil
import tempfile
import time
import unittest

import numpy as np

import fake_server
from test_server import call

from sqtool.wavio import read_wav

DEMO = "SQ-tool Demo/Example Album/"
HI, LO = DEMO + "01 Demo Song (24-96).wav", DEMO + "02 Demo Song (16-44).wav"


class CompareApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="sq-compare-test-")
        cls.music = os.path.join(cls.tmp, "music")
        cls.httpd, cls.base = fake_server.start(os.path.join(cls.tmp, "data"), music_dir=cls.music, seconds=4.0)
        with open(os.path.join(cls.music, "song.dsf"), "wb") as f:
            f.write(b"DSD " + b"\0" * 64)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def compared(self, a, b, timeout=120):
        status, r, _ = call(self.base, "/api/comparisons", "POST", {"a": a, "b": b})
        self.assertEqual(status, 200, r)
        deadline = time.time() + timeout
        while time.time() < deadline:
            c = call(self.base, "/api/comparisons/" + r["id"])[1]
            if c["state"] != "comparing":
                self.assertEqual(c["state"], "ready", c)
                return c
            time.sleep(0.1)
        self.fail("timed out")

    def test_two_songs_at_different_rates(self):
        c = self.compared(HI, LO)
        r = c["result"]
        self.assertEqual((c["a"]["music_path"], c["b"]["music_path"]), (HI, LO))
        self.assertEqual((r["a"]["path"], r["b"]["path"]), (HI, LO))  # the music folder's paths, not the disk's
        self.assertEqual(r["common"]["resampled"]["which"], "a")
        self.assertEqual((r["common"]["resampled"]["from"], r["common"]["rate"]), (96000, 44100))
        # The demo songs' hi-hats are noise drawn anew at each rate: the same music, not quite the same master.
        self.assertEqual(r["verdict"], "DIFFERENT MASTER", r["words"])
        for key in ("headline", "words", "null", "level_db", "offset", "polarity_inverted", "where", "spectrum"):
            self.assertIn(key, r)
        self.assertLess(r["null"]["depth_db"], -20)
        self.assertTrue(all(b["freq"] >= 20 for b in r["spectrum"]["bands"]))
        self.assertEqual(r["a"]["dynamics"].keys(), r["b"]["dynamics"].keys())
        self.assertIn("lufs", r["a"]["dynamics"])
        base = "/api/comparisons/" + c["id"]
        # A and B as compared: both at 44.1 kHz.
        for which in ("a", "b"):
            status, wav, headers = call(self.base, base + "/audio/%s.wav" % which)
            self.assertEqual(status, 200)
            self.assertEqual(headers["Content-Type"], "audio/wav")
            self.assertIn("%s as compared.wav" % which.upper(), headers["Content-Disposition"])
            self.assertEqual(read_wav(wav).rate, 44100)
        # The difference, as it is and gain-normalised to -1 dBFS peak.
        status, wav, headers = call(self.base, base + "/difference.wav")
        self.assertEqual(status, 200)
        diff = read_wav(wav)
        self.assertTrue(diff.is_float)
        peak = 20 * np.log10(np.abs(diff.data).max())
        self.assertAlmostEqual(peak, r["difference_peak_dbfs"], places=3)
        status, wav, headers = call(self.base, base + "/difference.wav?normalised=1")
        self.assertIn("gain-normalised to -1 dBFS", headers["Content-Disposition"])
        self.assertAlmostEqual(20 * np.log10(np.abs(read_wav(wav).data).max()), -1.0, places=3)
        # Spectrograms of A, B and the difference.
        for which in ("a", "b", "diff"):
            status, png, headers = call(self.base, base + "/spectrogram/%s.png?w=300&h=100" % which)
            self.assertEqual(status, 200)
            self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
            self.assertEqual(json.loads(headers["X-Spectrogram"])["rate"], 44100)
        self.assertIn(c["id"], [x["id"] for x in call(self.base, "/api/comparisons")[1]])

    def test_a_song_with_itself(self):
        c = self.compared(LO, LO)
        self.assertEqual(c["result"]["verdict"], "IDENTICAL")
        self.assertEqual(c["result"]["headline"], "Identical")
        self.assertIsNone(c["result"]["difference_peak_dbfs"])
        status, wav, _ = call(self.base, "/api/comparisons/%s/difference.wav?normalised=1" % c["id"])
        self.assertEqual(status, 200)
        self.assertFalse(read_wav(wav).data.any())  # silence, not scaled up from nothing
        self.assertEqual(call(self.base, "/api/comparisons/" + c["id"], "DELETE")[0], 200)
        self.assertEqual(call(self.base, "/api/comparisons/" + c["id"])[0], 404)

    def test_refused(self):
        status, r, _ = call(self.base, "/api/comparisons", "POST", {"a": LO})
        self.assertEqual((status, r["error"]), (400, "choose song B"))
        status, r, _ = call(self.base, "/api/comparisons", "POST", {"a": LO, "b": "song.dsf"})
        self.assertEqual(status, 400)
        self.assertIn("song B is a DSD file: SQ-tool compares PCM only", r["error"])
        status, r, _ = call(self.base, "/api/comparisons", "POST", {"a": LO, "b": "nothing.wav"})
        self.assertEqual(status, 404)
        status, r, _ = call(self.base, "/api/comparisons", "POST", {"a": LO, "b": "../../etc/passwd"})
        self.assertEqual((status, r["error"]), (400, "that is outside the music folder"))
        self.assertEqual(call(self.base, "/api/comparisons/nothing-here")[0], 404)


if __name__ == "__main__":
    unittest.main()
