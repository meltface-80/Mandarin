"""MQA's signalling in SQ-tool's bit-perfect check (Mandarin's item 418, sqtool/mqa.py): found in a song made to carry
it (real MQA audio can't be shipped), with its original rate and MQA Studio; not in a near miss or a plain song; and a
capture of an MQA song says "MQA signalling intact" where it is bit-identical, "MQA signalling lost: …" with what
changed where a volume, dither or a resampling broke it."""

import unittest

import numpy as np

from helpers import audio

from sqtool.analysis import compare
from sqtool.mqa import detect, label, rate_of
from sqtool.wavio import Audio

RATE = 44100
SYNC = 0xBE0498C88


def code_of(rate):
    return next(c for c in range(16) if rate_of(c) == rate)


def mqa_song(original=352800, studio=True, seconds=3.0, kind="mqa", seed=7, pos=16):
    """24-bit music-like noise, left-justified, both channels alike but for bit [pos], which carries MQA's stream."""
    rng = np.random.default_rng(seed)
    n = int(RATE * seconds)
    left = (np.clip(np.round(rng.standard_normal(n) * 0.1 * 2 ** 23), -2 ** 23, 2 ** 23 - 1).astype(np.int64) << 8)
    stream = np.zeros(n, dtype=np.int64)
    if kind != "plain":
        start = int(RATE * 0.4)
        for i in range(36):
            stream[start + i] = (SYNC >> (35 - i)) & 1
        if kind == "near":
            stream[start + 35] ^= 1
        end, code, provenance = start + 35, code_of(original), 17 if studio else 3
        for k in range(1, 34):
            stream[end + k] = (code >> (6 - k)) & 1 if 3 <= k <= 6 else (provenance >> (33 - k)) & 1 if k >= 29 else rng.integers(0, 2)
        # As MQA's own: the bits below the signalling each channel's (here at random), so that a gain or a filter
        # mixes them up into it.
        right = (left ^ (stream << pos)) & ~np.int64(0xFF00) | (rng.integers(0, 256, n).astype(np.int64) << 8)
    else:
        right = (np.clip(np.round(rng.standard_normal(n) * 0.1 * 2 ** 23), -2 ** 23, 2 ** 23 - 1).astype(np.int64) << 8)
    return np.stack([left, right], axis=1).astype(np.int32)


class Detect(unittest.TestCase):
    def test_mqa_and_mqa_studio_with_their_original_rates(self):
        self.assertEqual(detect(mqa_song(352800, True), RATE), {"studio": True, "original_rate": 352800})
        self.assertEqual(detect(mqa_song(96000, False), RATE), {"studio": False, "original_rate": 96000})
        self.assertEqual(detect(mqa_song(192000, True, pos=17), RATE), {"studio": True, "original_rate": 192000}, "one bit up, as the identifiers look")
        self.assertEqual([rate_of(c) for c in (0, 1, 4, 5, 8, 9, 12, 13)], [44100, 48000, 176400, 192000, 88200, 96000, 352800, 384000])

    def test_a_near_miss_a_bit_the_identifiers_dont_read_and_a_plain_song_are_not_mqa(self):
        self.assertIsNone(detect(mqa_song(kind="near"), RATE))
        self.assertIsNone(detect(mqa_song(pos=19), RATE))
        self.assertIsNone(detect(mqa_song(kind="plain"), RATE))

    def test_its_words_as_mandarin_says_them(self):
        self.assertEqual(label({"studio": True, "original_rate": 352800}, 24), "MQA Studio · 24/352.8 original")
        self.assertEqual(label({"studio": False, "original_rate": 192000}, 24), "MQA · 24/192 original")


class BitPerfectCheck(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.song = mqa_song()
        cls.ref = audio(cls.song, rate=RATE, bits=24)

    def lines(self, cap_data, rate=RATE):
        res = compare(self.ref, Audio(cap_data.astype(np.int32), rate, 32))
        return res, [n for n in res["notes"] if "MQA" in n]

    def test_bit_identical_says_its_signalling_is_intact(self):
        pad = np.zeros((2000, 2), dtype=np.int32)
        res, said = self.lines(np.vstack([pad, self.song, pad]))
        self.assertEqual(res["verdict"], "IDENTICAL")
        self.assertEqual(said, ["MQA Studio · 24/352.8 original: MQA signalling intact"])

    def test_a_volume_in_software_says_its_signalling_was_lost_and_why(self):
        quieter = np.round(self.song.astype(np.float64) * 10 ** (-1 / 20)).astype(np.int64)
        res, said = self.lines(quieter)
        self.assertNotEqual(res["verdict"], "IDENTICAL")
        self.assertEqual(len(said), 1, said)
        self.assertTrue(said[0].startswith("MQA Studio · 24/352.8 original: MQA signalling lost: the level changed by -1.00 dB"), said[0])

    def test_dither_and_a_resampling_lose_it_too(self):
        rng = np.random.default_rng(3)
        # Dithered to 16 bits: the bits the signalling is in, changed at random on each channel.
        to16 = ((self.song.astype(np.int64) >> 16) + rng.integers(-1, 2, self.song.shape)) << 16
        _, said = self.lines(to16)
        self.assertEqual(len(said), 1)
        self.assertTrue(said[0].startswith("MQA Studio · 24/352.8 original: MQA signalling lost: "), said[0])
        # Dithered at 24 bits: the sync word still there, the rest below it not the encoder's.
        to24 = self.song.astype(np.int64) + (rng.integers(-1, 2, self.song.shape) << 8)
        _, said = self.lines(to24)
        self.assertEqual(len(said), 1)
        self.assertTrue(said[0].startswith("MQA Studio · 24/352.8 original: MQA signalling still found, but not bit-perfect: "), said[0])
        # Resampled to 48 kHz (linearly, rounded to 24 bits).
        t = np.arange(int(len(self.song) * 48000 / RATE)) * RATE / 48000
        resampled = np.stack([np.round(np.interp(t, np.arange(len(self.song)), self.song[:, c].astype(np.float64)) / 256).astype(np.int64) << 8 for c in (0, 1)], axis=1)
        _, said = self.lines(resampled, rate=48000)
        self.assertEqual(said, ["MQA Studio · 24/352.8 original: MQA signalling lost: resampled from 44100 Hz to 48000 Hz"])

    def test_a_song_that_isnt_mqa_says_nothing_of_it(self):
        plain = mqa_song(kind="plain")
        res = compare(audio(plain, rate=RATE, bits=24), Audio(plain, RATE, 32))
        self.assertEqual(res["verdict"], "IDENTICAL")
        self.assertEqual([n for n in res["notes"] if "MQA" in n], [])


if __name__ == "__main__":
    unittest.main()
