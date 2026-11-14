"""Comparing two songs (sqtool/songs.py): common ground, the null test, dynamics, and the verdict's thresholds."""

import math
import os
import tempfile
import unittest

import numpy as np

import helpers  # noqa: F401  (puts SQ-tool on the path)
from song_signals import as_float, compress, master, quantise, song

from sqtool.common_ground import load_song
from sqtool.dynamics import dynamics
from sqtool.songs import compare_songs
from sqtool.wavio import Audio, AudioFileError, write_wav

RATE = 44100


def compare(a, b):
    return compare_songs(a, b)[0]


def delayed(x, samples):
    """x delayed by a (fractional) number of samples, exactly, in the frequency domain."""
    spec = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(len(x))
    return np.fft.irfft(spec * np.exp(-2j * math.pi * f * samples)[:, None], len(x), axis=0)


class Verdicts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.a = song(RATE, 24)

    def test_identical(self):
        res = compare(self.a, song(RATE, 24))
        self.assertEqual(res["verdict"], "IDENTICAL", res["words"])
        self.assertTrue(res["identical"])
        self.assertEqual(res["headline"], "Identical")
        self.assertEqual(res["offset"]["samples"], 0)

    def test_same_master_at_192_24_and_44_16(self):
        # The same master made at 192 kHz/24 and at 44.1 kHz/16 with dither: the 192 kHz one is resampled, and what
        # is left is the 16-bit file's dither, about -96 dBFS, spread evenly: 77 dB under music at -19 dBFS rms.
        res = compare(song(192000, 24), song(RATE, 16))
        self.assertEqual(res["verdict"], "SAME MASTER", res["words"])
        self.assertEqual(res["common"]["resampled"]["which"], "a")
        self.assertEqual((res["common"]["resampled"]["from"], res["common"]["resampled"]["to"]), (192000, RATE))
        self.assertEqual(res["common"]["resampled"]["with"], "ffmpeg's soxr resampler, precision 28 bits")
        self.assertLess(abs(res["null"]["in_band_dbfs"] - -96.3), 2.0, res["null"])
        self.assertTrue(-82 < res["null"]["depth_db"] < -72, res["null"])
        self.assertLess(abs(res["level_db"]), 0.01)
        self.assertEqual(res["where"], "at the noise floor, spread across the spectrum")
        self.assertIn("resampling", res["words"])
        self.assertIn("16 bits", res["words"])

    def test_same_master_differs_only_above_20k_after_resampling(self):
        # A loud tone at 21.8 kHz: in both, but the resampler's filter takes part of it away at 192 kHz -> 44.1.
        res = compare(song(192000, 24, extra=((21800, -30),)), song(RATE, 16, extra=((21800, -30),)))
        self.assertEqual(res["verdict"], "SAME MASTER", res["words"])
        self.assertGreater(res["spectrum"]["above_20k_share"], 0.9)
        self.assertTrue(res["where"].startswith("above 20 kHz only"), res["where"])
        self.assertLess(res["null"]["in_band_depth_db"], -72, res["null"])
        self.assertGreater(res["null"]["depth_db"], -40, res["null"])
        self.assertIn("above 20 kHz", res["words"])

    def test_different_only_above_20k(self):
        # Two 96 kHz files of one master, one with a tone at 30 kHz: nothing resampled, the rest at the floor.
        res = compare(song(96000, 24, seconds=4), song(96000, 24, seconds=4, extra=((30000, -40),)))
        self.assertEqual(res["verdict"], "ABOVE 20 KHZ", res["words"])
        self.assertEqual(res["headline"], "Different only above 20 kHz")
        self.assertIsNone(res["common"]["resampled"])

    def test_different_master_louder_and_more_compressed(self):
        # A remaster: 20 s with a quiet third at -33 dBFS rms and the rest at -19, compressed 2:1 above -30 dBFS (on
        # 10 ms), then brought up 9.4 dB, its peaks to just under full scale.
        x = master(RATE, seconds=20)
        b = compress(x, RATE, ratio=2.0, threshold_db=-30.0) * 10 ** (9.4 / 20)
        res = compare(as_float(x, RATE), as_float(b, RATE))
        self.assertEqual(res["verdict"], "DIFFERENT MASTER", res["words"])
        da, db = res["a"]["dynamics"], res["b"]["dynamics"]
        self.assertGreater(db["lufs"] - da["lufs"], 1.0)
        self.assertLess(db["lra_lu"], da["lra_lu"] - 1.0)
        self.assertLess(db["crest_db"], da["crest_db"])
        self.assertRegex(res["words"], r"^B is \d+\.\d dB louder and more compressed \(null depth −\d+ dB\)$")
        self.assertTrue(-40 < res["null"]["depth_db"] < -6, res["null"])

    def test_polarity_inverted(self):
        res = compare(self.a, Audio(-self.a.data, RATE, 24))
        self.assertEqual(res["verdict"], "SAME MASTER", res["words"])
        self.assertTrue(res["polarity_inverted"])
        self.assertEqual(res["polarity_channels"], [True, True])
        self.assertLess(res["null"]["residual_dbfs"], -200)
        self.assertEqual(res["words"], "B's polarity is inverted; nothing else differs")

    def test_time_offset_of_the_same_samples(self):
        b = Audio(np.concatenate([np.zeros((1234, 2), np.int32), self.a.data]), RATE, 24)
        res = compare(self.a, b)
        self.assertEqual(res["verdict"], "IDENTICAL", res["words"])
        self.assertEqual(res["offset"]["samples"], 1234)
        self.assertAlmostEqual(res["offset"]["ms"], 1234 / 44.1, places=6)

    def test_time_offset_and_level(self):
        b = as_float(np.concatenate([np.zeros((777, 2)), self.a.data / 2.0 ** 31 * 0.5]), RATE)
        res = compare(self.a, b)
        self.assertEqual(res["verdict"], "SAME MASTER", res["words"])
        self.assertEqual(res["offset"]["samples"], 777)
        self.assertAlmostEqual(res["level_db"], -6.0206, places=3)
        self.assertEqual(res["words"], "B is 6.02 dB quieter; nothing else differs")

    def test_offset_of_a_fraction_of_a_sample(self):
        x = master(RATE)
        res = compare(as_float(x, RATE), as_float(delayed(x, 0.37), RATE))
        self.assertAlmostEqual(res["offset"]["samples"], 0.37, delta=0.01)
        self.assertLess(res["null"]["depth_db"], -100, res["null"])
        self.assertEqual(res["verdict"], "SAME MASTER", res["words"])

    def test_different_recordings(self):
        res = compare(song(RATE, 24, seed=1), song(RATE, 24, seed=2))
        self.assertEqual(res["verdict"], "DIFFERENT RECORDINGS", res["words"])
        self.assertFalse(res["aligned"])
        self.assertIsNone(res["offset"])

    def test_different_lengths(self):
        cut = Audio(self.a.data[:-2 * RATE], RATE, 24)
        res = compare(self.a, cut)
        self.assertEqual(res["verdict"], "IDENTICAL", res["words"])
        self.assertIn("B's music is 1.75 s shorter than A's: compared where both have it", res["notes"])
        quieter = as_float(cut.data / 2.0 ** 31 * 0.5, RATE)
        res = compare(self.a, quieter)
        self.assertEqual(res["verdict"], "SAME MASTER", res["words"])
        self.assertAlmostEqual(res["overlap"]["seconds"], cut.duration, places=6)
        self.assertIn("B's music is 1.75 s shorter than A's: compared where both have it", res["notes"])

    def test_channel_counts_mixed_down(self):
        mono = (self.a.data.astype(np.int64).sum(axis=1, keepdims=True) // 2).astype(np.int32)
        res = compare(self.a, Audio(mono, RATE, 24))
        self.assertEqual(res["common"]["downmixed"], {"a": 2, "b": 1})
        self.assertIn("A has 2 channels and B 1: both compared as mono (their channels averaged)", res["notes"])
        self.assertEqual(res["verdict"], "SAME MASTER", res["words"])
        self.assertTrue(res["words"].startswith("Mixed down to mono"), res["words"])


class Refused(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def test_dsd_files(self):
        path = os.path.join(self.tmp.name, "song.dsf")
        with open(path, "wb") as f:
            f.write(b"DSD " + b"\0" * 100)
        with self.assertRaisesRegex(AudioFileError, "song.dsf is a DSD file: SQ-tool compares PCM only"):
            load_song(path)

    def test_dsd_over_pcm(self):
        n = 4096
        marks = np.where(np.arange(n) % 2 == 0, 0x05, 0xFA).astype(np.int64)
        data = ((marks << 24) | 0x1234).astype(np.uint32).view(np.int32)
        path = os.path.join(self.tmp.name, "dop.wav")
        write_wav(path, Audio(np.stack([data, data], axis=1), 176400, 24))
        with self.assertRaisesRegex(AudioFileError, r"dop.wav carries DSD over PCM \(DoP\)"):
            load_song(path)

    def test_silence(self):
        quiet = Audio(np.zeros((RATE, 2), np.int32), RATE, 16)
        with self.assertRaisesRegex(AudioFileError, "B is digital silence"):
            compare(song(RATE, 16, seconds=2), quiet)


class Dynamics(unittest.TestCase):
    def test_loudness_of_a_sine(self):
        # BS.1770: a 1 kHz sine on both channels of a stereo file reads its peak level in LUFS.
        t = np.arange(10 * 48000) / 48000
        x = 0.1 * np.sin(2 * math.pi * 1000 * t)
        d = dynamics(as_float(np.stack([x, x], axis=1), 48000))
        self.assertAlmostEqual(d["lufs"], -20.0, delta=0.02)
        self.assertAlmostEqual(d["peak_dbfs"], -20.0, delta=0.01)
        self.assertAlmostEqual(d["crest_db"], 3.01, delta=0.01)
        self.assertLess(d["lra_lu"], 0.1)

    def test_loudness_range_of_a_quiet_and_a_loud_part(self):
        # A third at 0.2 of the level, the rest at full: 14 dB between them, and the range shows it.
        d = dynamics(as_float(quantise(master(RATE, seconds=20), 24) / 2.0 ** 31, RATE))
        self.assertTrue(12.5 < d["lra_lu"] < 14.5, d)


if __name__ == "__main__":
    unittest.main()
