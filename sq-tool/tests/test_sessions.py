"""Test sessions end to end: a song from the music folder, and what a zone's DAC was fed, as Mandarin records it."""

import json
import os
import shutil
import struct
import tempfile
import time
import unittest
import zlib

import numpy as np

from helpers import music

from sqtool.sessions import Tests, _steps, readable_formats
from sqtool.spectrogram import LUT
from sqtool.wavio import Audio, info_chunk, read_wav, write_wav

RATE = 44100


def png_pixels(png: bytes) -> np.ndarray:
    """Decode the 8-bit RGB, filter-0 PNGs that sq-tool writes."""
    w, h = struct.unpack(">II", png[16:24])
    pos, idat = 8, b""
    while pos < len(png):
        n = struct.unpack(">I", png[pos:pos + 4])[0]
        if png[pos + 4:pos + 8] == b"IDAT":
            idat += png[pos + 8:pos + 8 + n]
        pos += 12 + n
    rows = np.frombuffer(zlib.decompress(idat), np.uint8).reshape(h, 1 + 3 * w)
    return rows[:, 1:].reshape(h, w, 3)


def is_black(png: bytes) -> bool:
    return bool((png_pixels(png) == LUT[0]).all())


def volume_in_software(data, db=-0.5):
    """What a Bridge with its volume in software does: the samples scaled, at 32 bits."""
    return np.round(data.astype(np.float64) * 10 ** (db / 20)).astype(np.int32)


def wait_for(fn, timeout=60.0, what="condition"):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError("timed out waiting for " + what)


class SessionBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="sq-sessions-")
        cls.music_dir = os.path.join(cls.tmp, "music")
        album = os.path.join(cls.music_dir, "Artist", "Album")
        os.makedirs(album)
        cls.src = music(rate=RATE, seconds=4.0, lead=0.5, tail=0.5, bits=16)
        cls.song = os.path.join(album, "01 Song.wav")
        tags = info_chunk({"INAM": "Song", "IART": "Artist", "IPRD": "Album"})
        write_wav(cls.song, Audio(data=cls.src, rate=RATE, bits=16), extra_chunks=[(b"LIST", tags)])
        with open(os.path.join(album, "cover.jpg"), "wb") as f:
            f.write(b"\xff\xd8")
        cls.tests = Tests(os.path.join(cls.tmp, "data"), cls.music_dir, log=lambda m: None)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def new_test(self):
        tid = self.tests.create("Artist/Album/01 Song.wav")
        wait_for(lambda: self.tests.get(tid)["source"]["state"] in ("ready", "error"), what="the source")
        self.assertEqual(self.tests.get(tid)["source"]["state"], "ready", self.tests.get(tid)["source"])
        return tid

    def recorded(self, tid, data, zone="FiiO R7 USB", rate=RATE, details=None):
        """What zone [zone]'s DAC was fed, handed over as Mandarin hands it: a WAV in 32-bit words."""
        d = tempfile.mkdtemp(dir=self.tests.tmp)
        path = os.path.join(d, "recording.wav")
        write_wav(path, Audio(data=data, rate=rate, bits=32))
        self.tests.add_recording(tid, path, zone, details)

    def add(self, tid, slot, data, rate=RATE, bits=32, meta=None):
        """File a recording as it is (its samples as given)."""
        d = tempfile.mkdtemp(dir=self.tests.tmp)
        path = os.path.join(d, slot + ".wav")
        write_wav(path, Audio(data=data, rate=rate, bits=bits))
        with open(path + ".json", "w") as f:
            json.dump({"capture": dict({"method": "mandarin", "rate": rate, "channels": data.shape[1]},
                                       **(meta or {}))}, f)
        self.tests.add_capture(tid, slot, path)

    def results(self, tid, keys):
        def ready():
            t = self.tests.get(tid)
            states = [(t["results"].get(k) or {}).get("state") for k in keys]
            caps = [c.get("state") for c in t["captures"].values()]
            if "error" in caps:
                raise AssertionError(t["captures"])
            return t if all(s == "ready" for s in states + caps) else None
        return wait_for(ready, what="results " + ",".join(keys))


class MusicFolder(SessionBase):
    def test_browse_and_search(self):
        root = self.tests.browse("")
        self.assertEqual((root["path"], root["dirs"], root["files"], root["available"]), ("", ["Artist"], [], True))
        album = self.tests.browse("Artist/Album")
        self.assertEqual([f["name"] for f in album["files"]], ["01 Song.wav"])  # not cover.jpg
        self.assertEqual(self.tests.search("song artist"),
                         [{"path": "Artist/Album/01 Song.wav", "name": "01 Song.wav", "folder": "Artist/Album",
                           "ok": True}])
        self.assertEqual(self.tests.search("nothing like this"), [])
        with self.assertRaises(ValueError):
            self.tests.browse("../..")
        with self.assertRaises(KeyError):
            self.tests.browse("Nope")
        with self.assertRaises(ValueError):
            self.tests.create("../data/test.json")

    def test_formats_that_cannot_be_read_here(self):
        from unittest import mock
        path = os.path.join(self.music_dir, "Artist", "Album", "02 Other.m4a")
        with open(path, "wb") as f:
            f.write(b"\0" * 64)
        self.tests._index = None  # searched before this file existed
        try:
            files = {f["name"]: f["ok"] for f in self.tests.browse("Artist/Album")["files"]}
            self.assertEqual(files, {"01 Song.wav": True, "02 Other.m4a": ".m4a" in readable_formats()})
            with mock.patch("shutil.which", return_value=None):  # no ffmpeg, no flac
                self.assertEqual(readable_formats(), {".wav", ".wave", ".aif", ".aiff", ".aifc"})
                self.assertFalse(self.tests.search("other")[0]["ok"])
                with self.assertRaises(ValueError):
                    self.tests.create("Artist/Album/02 Other.m4a")
        finally:
            os.unlink(path)


class MandarinsRecording(SessionBase):
    def test_bit_perfect_then_scaled(self):
        tid = self.new_test()
        t = self.tests.get(tid)
        self.assertEqual((t["title"], t["artist"], t["album"]), ("Song", "Artist", "Album"))
        self.assertEqual((t["source"]["rate"], t["source"]["bits"], t["source"]["label"]), (RATE, 16, "WAV PCM 16-bit"))
        self.assertEqual(t["players"], {"a": ""})  # no zone yet: none recorded

        # The Bridge, its samples untouched: the 16-bit song in 32-bit words (as the helper makes it), after 0.2 s of silence.
        lead = int(0.2 * RATE)
        padded = np.concatenate([np.zeros((lead, 2), np.int32), self.src])
        self.recorded(tid, padded, details={"device": "Mandarin Bridge", "said": "the whole track, in 2 parts"})
        t = self.results(tid, ["a"])
        self.assertEqual(t["players"], {"a": "FiiO R7 USB"})
        cap = t["captures"]["a"]
        self.assertEqual((cap["rate"], cap["method"], cap["player"], cap["resolution"]), (RATE, "mandarin", "FiiO R7 USB", 16))
        self.assertEqual(cap["fingerprint"], t["source"]["fingerprint"])
        self.assertEqual(sorted(t["results"]), ["a"])  # the one comparison: the song and what its DAC was fed
        res = t["results"]["a"]
        self.assertEqual((res["verdict"], res["short"], res["match"]), ("IDENTICAL", "BIT-PERFECT", True))
        self.assertEqual(res["alignment"]["steps"], [[0, lead]])
        self.assertIsNone(res["zoom"])
        self.assertEqual(sorted(t["analysis"]), ["a", "source"])
        with open(self.tests.audio_path(tid, "a") + ".json") as f:
            side = json.load(f)["capture"]
        self.assertEqual((side["device"], side["said"]), ("Mandarin Bridge", "the whole track, in 2 parts"))

        # Spectrograms on the song's timeline: the difference is digital silence.
        png, info = self.tests.spectrogram(tid, "source", 0, 0, 600, 200)
        self.assertEqual(png_pixels(png).shape, (200, 600, 3))
        self.assertAlmostEqual(info["t1"], 5.0, places=2)
        self.assertFalse(is_black(png))
        self.assertTrue(is_black(self.tests.spectrogram(tid, "diff-a", 0, 0, 600, 200)[0]))
        for gone in ("b", "diff-b", "diff-ab"):
            with self.assertRaises(KeyError):
                self.tests.spectrogram(tid, gone, 0, 0, 600, 200)
        self.assertEqual(self.tests.spectrogram(tid, "source", 0, 0, 600, 200)[0], png)

        # The difference file: silence. The recording: the song, to its last sample.
        chunks, size, name = self.tests.difference_wav(tid, "a")
        wav = b"".join(chunks)
        self.assertEqual(len(wav), size)
        self.assertEqual(name, "Song - FiiO R7 USB minus the source.wav")
        diff = read_wav(wav)
        self.assertEqual((diff.frames, diff.is_float), (len(self.src), True))
        self.assertFalse(diff.data.any())
        with self.assertRaises(KeyError):
            self.tests.difference_wav(tid, "ab")
        fed = read_wav(self.tests.audio_path(tid, "a")).data
        self.assertTrue(np.array_equal(fed[lead:], self.src))
        self.assertEqual(self.tests.audio_filename(tid, "a"), "Song - FiiO R7 USB.wav")
        listed = [x for x in self.tests.list() if x["id"] == tid][0]
        self.assertEqual((listed["players"], listed["results"]["a"]["short"]), ({"a": "FiiO R7 USB"}, "BIT-PERFECT"))

        # Recorded again, its volume in software: the result replaced, the samples scaled, said.
        self.recorded(tid, volume_in_software(self.src), zone="Kitchen Bridge")
        t = self.results(tid, ["a"])
        res = t["results"]["a"]
        self.assertEqual((t["players"]["a"], res["verdict"], res["match"]), ("Kitchen Bridge", "DIFFERENT", False))
        np.testing.assert_allclose(res["gain_db"], [-0.5, -0.5], atol=0.005)
        self.assertTrue(res["plots"]["envelope"]["t"] and res["plots"]["spectrum"]["freqs"])
        self.assertTrue(res["zoom"]["ref"] and res["zoom"]["cap"])
        self.assertFalse(is_black(self.tests.spectrogram(tid, "diff-a", 0, 0, 600, 200)[0]))
        raw = png_pixels(self.tests.spectrogram(tid, "diff-a", 0, 0, 600, 200)[0]).astype(int).sum()
        matched = png_pixels(self.tests.spectrogram(tid, "diff-a", 0, 0, 600, 200, matched=True)[0]).astype(int).sum()
        self.assertLess(matched, raw * 0.8)  # the level matched, little is left
        self.assertEqual(os.listdir(self.tests.tmp), [])

        self.tests.delete(tid)
        with self.assertRaises(KeyError):
            self.tests.get(tid)

    def test_a_recording_for_a_test_not_there(self):
        d = tempfile.mkdtemp(dir=self.tests.tmp)
        path = os.path.join(d, "recording.wav")
        write_wav(path, Audio(data=self.src, rate=RATE, bits=32))
        with self.assertRaises(KeyError):
            self.tests.add_recording("20990101-000000-none", path, "FiiO R7 USB")
        shutil.rmtree(d)


class Alignment(SessionBase):
    def test_dropout_keeps_the_rest_aligned(self):
        tid = self.new_test()
        # 50 ms of inserted silence 2 s in (an underrun): the samples themselves are untouched.
        at = 2 * RATE
        gap = np.zeros((int(0.05 * RATE), 2), np.int32)
        self.add(tid, "a", np.concatenate([self.src[:at], gap, self.src[at:]]))
        t = self.results(tid, ["a"])
        res = t["results"]["a"]
        self.assertEqual(res["verdict"], "GAPS")
        self.assertEqual(res["alignment"]["steps"], [[0, 0], [at, len(gap)]])
        # On the source's timeline the dropout is skipped, so nothing else shows as different.
        self.assertTrue(is_black(self.tests.spectrogram(tid, "diff-a", 0, 0, 400, 100)[0]))
        self.assertFalse(read_wav(b"".join(self.tests.difference_wav(tid, "a")[0])).data.any())

    def test_spectrogram_time_range(self):
        tid = self.new_test()
        # Zoomed in further than one sample per pixel: the picture still spans exactly what was asked.
        png, info = self.tests.spectrogram(tid, "source", 2.0, 2.01, 2000, 100)
        self.assertEqual(png_pixels(png).shape, (100, 2000, 3))
        self.assertAlmostEqual(info["t0"], 2.0, places=4)
        self.assertAlmostEqual(info["t1"], 2.01, places=4)
        # Beyond the end of the song: kept within it.
        png, info = self.tests.spectrogram(tid, "source", 0, 1e7, 200, 64)
        self.assertAlmostEqual(info["t1"], 5.0, places=4)
        png, info = self.tests.spectrogram(tid, "source", 1e6, 0, 200, 64)
        self.assertLess(info["t0"], 5.0)
        self.tests.delete(tid)

    def test_resampled_capture(self):
        tid = self.new_test()
        up = np.repeat(self.src, 2, axis=0)  # stands in for a player upsampling to 88.2 kHz
        self.add(tid, "a", np.concatenate([np.zeros((8820, 2), np.int32), up]), rate=2 * RATE)
        t = self.results(tid, ["a"])
        res = t["results"]["a"]
        self.assertEqual(res["verdict"], "RESAMPLED")
        self.assertAlmostEqual(res["alignment"]["offset_seconds"], 0.1, places=4)
        png, info = self.tests.spectrogram(tid, "a", 0, 0, 400, 100)
        self.assertEqual(info["rate"], 2 * RATE)
        self.assertEqual(info["fmax"], RATE)  # the highest Nyquist frequency of the test
        with self.assertRaises(ValueError):
            self.tests.spectrogram(tid, "diff-a", 0, 0, 400, 100)

    def test_steps(self):
        exact = {"segments": [{"ref_start": 0, "ref_end": 100, "lag": 5},
                              {"ref_start": 90, "ref_end": 200, "lag": 25},  # 10 frames played twice
                              {"ref_start": 200, "ref_end": 300, "lag": 25}]}
        self.assertEqual(_steps(exact), [[0, 5], [100, 25]])


if __name__ == "__main__":
    unittest.main()
