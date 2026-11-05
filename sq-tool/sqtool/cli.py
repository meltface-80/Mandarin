"""Command line: sq-tool serve | gen | analyze | compare."""

from __future__ import annotations

import argparse
import itertools
import json
import os
import sys

from . import __version__

DESCRIPTION = """\
Compare what a DAC was fed with the song, sample by sample: Mandarin's bit-perfect tool. Mandarin plays the
song to a zone, records what its DAC is fed (Mandarin Bridge, or a USB DAC on Mandarin's server) and hands
the recording to SQ-tool, which Mandarin serves at Settings -> SQ-tool.

The web interface (Mandarin starts it):
  sq-tool serve --music ~/Music --host 127.0.0.1 --port 3400

From the command line:
  sq-tool compare song.flac recording.wav
"""


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="sq-tool", description=DESCRIPTION,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--version", action="version", version="sq-tool %s" % __version__)
    sub = p.add_subparsers(dest="command", metavar="command")

    g = sub.add_parser("gen", help="write deterministic test tracks (WAV)")
    g.add_argument("-o", "--outdir", default=".", help="directory to write to (default: current)")
    g.add_argument("--bits", type=int, choices=(16, 24, 32), help="one track with this bit depth...")
    g.add_argument("--rate", type=int, help="...and this sample rate (default: a standard set)")

    w = sub.add_parser("serve", help="run the web interface (port 3400)")
    w.add_argument("--data", default=os.environ.get("SQTOOL_DATA", "sq-data"),
                   help="folder for tests: recordings, analyses and charts (default: ./sq-data)")
    w.add_argument("--music", default=os.environ.get("SQTOOL_MUSIC", "/music"),
                   help="your music folder, to pick songs from (default: /music)")
    w.add_argument("--host", default="127.0.0.1", help="address to listen on (default: this computer only)")
    w.add_argument("--port", type=int, default=int(os.environ.get("PORT", "3400")),
                   help="port (default 3400)")

    a = sub.add_parser("analyze", help="describe captures or audio files")
    a.add_argument("files", nargs="+")
    a.add_argument("--json", metavar="FILE", help="also write the results as JSON")

    m = sub.add_parser("compare", help="compare captures with a reference, sample by sample",
                       description="Compares each FILE with REFERENCE (the source track or another "
                       "capture), and the FILEs with each other. Exit status: 0 if everything is "
                       "identical, 1 if anything differs, 2 on errors.")
    m.add_argument("reference", help="source track (WAV, or FLAC etc. with ffmpeg) or a capture")
    m.add_argument("files", nargs="+", metavar="FILE")
    m.add_argument("--json", metavar="FILE", help="also write the results as JSON")
    return p


def _write_json(path: str, data) -> None:
    from .sessions import clean
    with open(path, "w") as f:
        json.dump(clean(data), f, indent=2)
    print("Results written to %s" % path)


def cmd_gen(args) -> int:
    from .generate import DEFAULT_SET, write_test_track
    os.makedirs(args.outdir, exist_ok=True)
    if args.bits or args.rate:
        todo = [(args.bits or 24, args.rate or 96000)]
    else:
        todo = DEFAULT_SET
    for bits, rate in todo:
        print("wrote %s" % write_test_track(args.outdir, bits, rate))
    print("Add these to your player's library. They are test signals, not music: keep the volume "
          "low if they ever play through speakers.")
    return 0


def cmd_serve(args) -> int:
    from .server import serve
    serve(args.data, args.music, args.host, args.port)
    return 0


def cmd_analyze(args) -> int:
    from .analysis import analyze_file
    from .report import format_analysis
    from .wavio import load_audio
    results = []
    for path in args.files:
        res = analyze_file(load_audio(path))
        results.append(res)
        print(format_analysis(res))
        print()
    _print_fingerprint_groups(results)
    if args.json:
        _write_json(args.json, results)
    return 0


def _print_fingerprint_groups(results) -> None:
    if len(results) < 2:
        return
    groups = {}
    for r in results:
        if r.get("fingerprint"):
            groups.setdefault(r["fingerprint"], []).append(r["path"])
    same = [paths for paths in groups.values() if len(paths) > 1]
    for paths in same:
        print("Identical sample data (same fingerprint): %s" % ", ".join(paths))
    if not same:
        print("No two files have the same fingerprint (use `compare` to see how they differ).")


def cmd_compare(args) -> int:
    from .analysis import compare
    from .report import format_comparison, format_summary, short_verdict
    from .wavio import load_audio
    ref = load_audio(args.reference)
    files = [load_audio(path) for path in args.files]
    pairs = [(ref, f) for f in files] + list(itertools.combinations(files, 2))
    results, rows = [], []
    for a, b in pairs:
        res = compare(a, b)
        results.append(res)
        print(format_comparison(res))
        print()
        rows.append((os.path.basename(b.path), os.path.basename(a.path), short_verdict(res)))
    if len(rows) > 1:
        print(format_summary(rows))
    if args.json:
        _write_json(args.json, results)
    return 0 if all(r["verdict"] == "IDENTICAL" for r in results) else 1


COMMANDS = {"gen": cmd_gen, "analyze": cmd_analyze, "compare": cmd_compare, "serve": cmd_serve}


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 2
    import importlib.util
    if importlib.util.find_spec("numpy") is None:
        print("sq-tool needs numpy. Install it with:  sudo apt install python3-numpy  "
              "(Fedora: sudo dnf install python3-numpy, or: pip install numpy)", file=sys.stderr)
        return 2
    from .wavio import AudioFileError
    try:
        return COMMANDS[args.command](args)
    except (AudioFileError, OSError) as exc:
        print("sq-tool: %s" % exc, file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nstopped", file=sys.stderr)
        return 130
