import contextlib
import io
import json
import os
import tempfile
import unittest

import numpy as np

from helpers import music

from sqtool.cli import main
from sqtool.wavio import Audio, read_wav, write_wav


def run(*argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        code = main(list(argv))
    return code, out.getvalue()


class Cli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def p(self, name):
        return os.path.join(self.dir, name)

    def test_gen_analyze_compare(self):
        code, text = run("gen", "-o", self.dir, "--bits", "16", "--rate", "44100")
        self.assertEqual(code, 0, text)
        src = self.p("sq-test_16bit_44100Hz.wav")
        ref = read_wav(src)
        # Two "captures": one bit-perfect in a 32-bit container, one with -0.5 dB of gain.
        pad = np.zeros((500, 2), np.int32)
        write_wav(self.p("a.wav"), Audio(np.vstack([pad, ref.data]), 44100, 32))
        quiet = np.round(ref.data * 10 ** (-0.5 / 20) / 256) * 256
        write_wav(self.p("b.wav"), Audio(quiet.astype(np.int32), 44100, 32))

        code, text = run("analyze", self.p("a.wav"), src, "--json", self.p("an.json"))
        self.assertEqual(code, 0, text)
        self.assertIn("16 significant bits: the low 16 bits of every sample are zero", text)
        self.assertIn("Identical sample data (same fingerprint)", text)
        with open(self.p("an.json")) as f:
            self.assertEqual(len(json.load(f)), 2)

        code, text = run("compare", src, self.p("a.wav"), self.p("b.wav"), "--json", self.p("c.json"))
        self.assertEqual(code, 1, text)  # b differs
        self.assertIn("BIT-PERFECT: every sample of the reference arrives unchanged.", text)
        self.assertIn("NOT BIT-PERFECT: the samples differ throughout.", text)
        self.assertIn("level changed: -0.500 dB", text)
        self.assertIn("a.wav  vs  sq-test_16bit_44100Hz.wav : BIT-PERFECT", text)
        with open(self.p("c.json")) as f:
            results = json.load(f)
        self.assertEqual([r["verdict"] for r in results], ["IDENTICAL", "DIFFERENT", "DIFFERENT"])

        code, text = run("compare", src, self.p("a.wav"))
        self.assertEqual(code, 0, text)

    def test_errors_exit_2(self):
        code, text = run("compare", self.p("missing.wav"), self.p("missing2.wav"))
        self.assertEqual(code, 2)
        self.assertIn("no such file", text)
        self.assertEqual(run()[0], 2)

    def test_capture_vs_capture_wording(self):
        data = music(seconds=1)
        write_wav(self.p("x.wav"), Audio(data, 44100, 32))
        write_wav(self.p("y.wav"), Audio(data, 44100, 32))
        for name in ("x.wav", "y.wav"):
            with open(self.p(name) + ".json", "w") as f:
                json.dump({"capture": {"alsa_format": "S32_LE"}}, f)
        code, text = run("compare", self.p("x.wav"), self.p("y.wav"))
        self.assertEqual(code, 0, text)
        self.assertIn("IDENTICAL: both files carry exactly the same samples.", text)

    def test_compare_files(self):
        # Two songs of one master, 96 kHz/24 and 44.1 kHz/16: the report of the null test, and its JSON.
        from song_signals import song
        write_wav(self.p("hi.wav"), song(96000, 24, seconds=3))
        write_wav(self.p("lo.wav"), song(44100, 16, seconds=3))
        code, text = run("compare-files", self.p("hi.wav"), self.p("lo.wav"), "--bands", "--json", self.p("s.json"))
        self.assertEqual(code, 1, text)  # not identical
        self.assertIn("THE SAME MASTER: The difference is only from resampling, and rounding and dither at 16 bits "
                      "(null depth −", text)
        self.assertRegex(text, r"Null depth   -7\d\.\d dB against the music \(what is left: -9\d\.\d dBFS rms\)")
        self.assertIn("Offset       none: they start together", text)
        self.assertIn("Polarity     the same", text)
        self.assertRegex(text, r"Loudness +-\d+\.\d LUFS +-\d+\.\d LUFS")
        self.assertIn("Note: A resampled from 96 to 44.1 kHz for the comparison", text)
        self.assertRegex(text, r"\n +1 kHz +-1\d\d\.\d +-\d+\.\d\n")  # a third-octave band: what is left, the music
        with open(self.p("s.json")) as f:
            self.assertEqual(json.load(f)["verdict"], "SAME MASTER")
        code, text = run("compare-files", self.p("lo.wav"), self.p("lo.wav"))
        self.assertEqual(code, 0, text)
        self.assertIn("IDENTICAL: A and B carry exactly the same samples.", text)
        code, text = run("compare-files", self.p("lo.wav"), self.p("missing.wav"))
        self.assertEqual(code, 2, text)
        self.assertIn("could not read missing.wav: no such file", text)


if __name__ == "__main__":
    unittest.main()
