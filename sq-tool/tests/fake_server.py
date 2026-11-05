#!/usr/bin/env python3
"""Run the web interface with a music folder of two generated songs, and hand it recordings as Mandarin does.

For tests and for looking at the page without Mandarin: post_recording() sends what a zone's DAC "was fed" to
POST /api/tests/<id>/recording, as Mandarin does once it has played the song and recorded it (its
/api/sq-tool/record): the song in 32-bit words after a moment of silence, as it is or its volume scaled.

    python3 tests/fake_server.py --port 3400 --data /tmp/sq-data
"""

import argparse
import os
import tempfile
import threading
import time
import urllib.request

import numpy as np

from sqtool.wavio import Audio, info_chunk, read_wav, write_wav


def demo_song(rate: int, bits: int, seconds: float = 20.0, seed: int = 3) -> np.ndarray:
    """Something with the look of music: chords with harmonics, a kick drum and hi-hats."""
    rng = np.random.default_rng(seed)
    n = int(seconds * rate)
    t = np.arange(n) / rate
    out = np.zeros((n, 2))
    chords = [[220.0, 277.18, 329.63], [196.0, 246.94, 293.66], [174.61, 220.0, 261.63], [196.0, 246.94, 311.13]]
    for i in range(int(seconds / 2.0)):
        s0 = int(i * 2.0 * rate)
        s1 = min(n, s0 + int(2.6 * rate))
        tt = t[s0:s1] - t[s0]
        sig = np.zeros(s1 - s0)
        for f in chords[i % len(chords)]:
            for h in range(1, 9):
                if f * h < rate / 2:
                    sig += np.sin(2 * np.pi * f * h * tt + rng.random() * 6.283) / h ** 1.6
        env = np.exp(-tt * 1.1) * np.minimum(1.0, tt / 0.01)
        out[s0:s1, 0] += 0.07 * sig * env
        out[s0:s1, 1] += 0.06 * sig * env
    for k in range(int(seconds / 0.5)):
        s0 = int(k * 0.5 * rate)
        m = min(n - s0, int(0.25 * rate))
        tt = np.arange(m) / rate
        kick = np.sin(2 * np.pi * (50 + 80 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 12) * 0.25
        out[s0:s0 + m] += kick[:, None]
    for k in range(int(seconds / 0.25)):
        s0 = int(k * 0.25 * rate) + int(0.125 * rate)
        m = min(n - s0, int(0.05 * rate))
        if m <= 0:
            continue
        burst = np.diff(rng.standard_normal(m + 1)) * np.exp(-np.arange(m) / (0.008 * rate)) * 0.02
        out[s0:s0 + m, 0] += burst
        out[s0:s0 + m, 1] += 0.8 * burst
    fade = int(0.05 * rate)
    out[:fade] *= np.linspace(0, 1, fade)[:, None]
    out[-fade:] *= np.linspace(1, 0, fade)[:, None]
    scale = 2.0 ** (bits - 1)
    q = np.round(out * scale + rng.random(out.shape) - rng.random(out.shape))
    q = np.clip(q, -scale, scale - 1).astype(np.int64) << (32 - bits)
    pad = lambda s: np.zeros((int(s * rate), 2), np.int64)  # noqa: E731
    return np.concatenate([pad(0.3), q, pad(0.5)]).astype(np.int32)


def make_music(music_dir: str, seconds: float = 20.0) -> None:
    album = os.path.join(music_dir, "SQ-tool Demo", "Example Album")
    os.makedirs(album, exist_ok=True)
    for name, rate, bits in (("01 Demo Song (24-96).wav", 96000, 24), ("02 Demo Song (16-44).wav", 44100, 16)):
        path = os.path.join(album, name)
        if not os.path.exists(path):
            tags = info_chunk({"INAM": name[3:-4], "IART": "SQ-tool Demo", "IPRD": "Example Album"})
            write_wav(path, Audio(data=demo_song(rate, bits, seconds), rate=rate, bits=bits), extra_chunks=[(b"LIST", tags)])


def volume_in_software(data: np.ndarray, db: float = -0.5) -> np.ndarray:
    """What a Bridge with its volume in software feeds its DAC: the samples scaled, at 32 bits."""
    return np.round(data.astype(np.float64) * 10 ** (db / 20)).astype(np.int32)


def fed(app, tid: str, scaled: bool = False) -> bytes:
    """What a zone's DAC is fed of test [tid]'s song, as a WAV: 0.15 s of silence, then the song."""
    src = read_wav(app.tests.audio_path(tid, "source"))
    data = volume_in_software(src.data) if scaled else src.data
    payload = np.concatenate([np.zeros((int(0.15 * src.rate), src.channels), np.int32), data])
    path = os.path.join(app.tests.data_dir, "fed-%s.wav" % tid)
    write_wav(path, Audio(data=payload, rate=src.rate, bits=32))
    with open(path, "rb") as f:
        body = f.read()
    os.unlink(path)
    return body


def post_recording(base: str, app, tid: str, zone: str = "FiiO R7 USB", scaled: bool = False) -> dict:
    """The recording handed to SQ-tool as Mandarin hands it."""
    import json
    import urllib.parse
    req = urllib.request.Request("%s/api/tests/%s/recording?zone=%s&device=%s" % (
        base, tid, urllib.parse.quote(zone), urllib.parse.quote("Mandarin Bridge")),
        data=fed(app, tid, scaled), method="POST", headers={"Content-Type": "audio/wav"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def start(data_dir: str, port: int = 0, music_dir: str = None, seconds: float = 20.0):
    """Start the server in a thread; returns (httpd, base URL)."""
    music_dir = music_dir or os.path.join(tempfile.mkdtemp(prefix="sq-music-"), "music")
    make_music(music_dir, seconds)
    from sqtool.server import make_server
    httpd = make_server(data_dir, music_dir, "127.0.0.1", port, log=lambda msg: None)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, "http://127.0.0.1:%d" % httpd.server_address[1]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=3400)
    ap.add_argument("--data", default=tempfile.mkdtemp(prefix="sq-data-"))
    ap.add_argument("--seconds", type=float, default=20.0, help="length of the generated songs")
    args = ap.parse_args()
    httpd, url = start(args.data, args.port, seconds=args.seconds)
    print("SQ-tool on %s (data in %s)" % (url, args.data), flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
