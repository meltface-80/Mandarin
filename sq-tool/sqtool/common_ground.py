"""Two songs brought to common ground for a null test: one sample rate, one channel count, floating point.

* Each is decoded as SQ-tool decodes a song (wavio.load_audio: WAV and AIFF itself, the rest through ffmpeg).
* DSD is refused: SQ-tool doesn't decode DSD files to PCM (a .dsf or .dff, or DSD carried over PCM as DoP).
* Different sample rates: the higher-rate song is resampled to the lower rate by ffmpeg's soxr resampler at its
  highest precision (aresample=resampler=soxr:precision=28, worked in double precision, its passband to 0.97 of the
  lower rate's Nyquist frequency). Where ffmpeg has no soxr, its own resampler at its best settings, and the result
  says which.
* Different channel counts: both are mixed down to mono (the channels averaged), and the result says so.
* Then both are compared in floating point (sqtool/songs.py). A song neither resampled nor mixed down keeps its own
  samples, so two identical files are found identical sample for sample.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from typing import List, Optional, Tuple

import numpy as np

from .analysis import _chunks, detect_dop, to_float
from .wavio import Audio, AudioFileError, load_audio, write_wav

DSD_EXTENSIONS = (".dsf", ".dff", ".dsd")
SOXR = "resampler=soxr:precision=28:cutoff=0.97:internal_sample_fmt=dblp"
SWR = "resampler=swr:filter_size=256:phase_shift=20:linear_interp=1:cutoff=0.97:internal_sample_fmt=dblp"
SOXR_SAYS = "ffmpeg's soxr resampler, precision 28 bits"
SWR_SAYS = "ffmpeg's own resampler (its soxr isn't available), 256-tap filter"


def load_song(path: str, name: str = "") -> Audio:
    """A song decoded as SQ-tool decodes one; DSD refused, with why."""
    who = name or os.path.basename(path)
    if os.path.splitext(path)[1].lower() in DSD_EXTENSIONS:
        raise AudioFileError("%s is a DSD file: SQ-tool compares PCM only (it doesn't convert DSD to PCM)" % who)
    try:
        audio = load_audio(path)
    except AudioFileError as exc:
        raise AudioFileError("could not read %s: %s" % (who, str(exc).replace(path, who)))
    if detect_dop(audio):
        raise AudioFileError("%s carries DSD over PCM (DoP): SQ-tool compares PCM only" % who)
    return audio


def _ffmpeg_resample(src: str, channels: int, rate: int, how: str) -> Tuple[Optional[np.ndarray], str]:
    """(float32 frames, '') from ffmpeg resampling `src` to `rate`, or (None, what ffmpeg said)."""
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", src, "-map", "0:a:0", "-af",
           "aresample=osr=%d:%s" % (rate, how), "-f", "f64le", "-acodec", "pcm_f64le", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    parts: List[np.ndarray] = []
    rest = b""
    frame = 8 * channels
    assert proc.stdout is not None and proc.stderr is not None
    while True:
        block = proc.stdout.read(1 << 22)
        if not block:
            break
        block = rest + block
        cut = len(block) - len(block) % frame
        rest = block[cut:]
        # Read in double precision, kept in single: a quarter of a 24-bit step at most, well below any file's floor.
        parts.append(np.frombuffer(block[:cut], dtype="<f8").astype(np.float32).reshape(-1, channels))
    said = proc.stderr.read().decode(errors="replace").strip()
    if proc.wait() != 0:
        return None, said
    data = np.concatenate(parts) if parts else np.zeros((0, channels), np.float32)
    return data, ""


def resample(audio: Audio, rate: int, work_dir: Optional[str] = None) -> Tuple[Audio, str]:
    """`audio` at `rate` (see the module's notes), as float32, and which resampler did it."""
    if not (shutil.which("ffmpeg")):
        raise AudioFileError("songs at different sample rates (%g and %g kHz) are brought to one rate by ffmpeg, "
                             "which isn't installed here" % (audio.rate / 1000, rate / 1000))
    tmp = None
    src = audio.path if audio.path and os.path.isfile(audio.path) and not audio.meta.get("changed") else ""
    try:
        if not src:
            fd, tmp = tempfile.mkstemp(suffix=".wav", dir=work_dir)
            os.close(fd)
            write_wav(tmp, audio)
            src = tmp
        data, said = _ffmpeg_resample(src, audio.channels, rate, SOXR)
        how = SOXR_SAYS
        if data is None:
            data, said2 = _ffmpeg_resample(src, audio.channels, rate, SWR)
            how = SWR_SAYS
            if data is None:
                raise AudioFileError("ffmpeg could not resample %s: %s" % (audio.label or "the song", said2 or said))
    finally:
        if tmp:
            os.unlink(tmp)
    out = Audio(data=data, rate=rate, bits=32, is_float=True, label=audio.label, path=audio.path,
                meta=dict(audio.meta, changed="resampled"))
    return out, how


def downmix(audio: Audio) -> Audio:
    """The channels averaged into one, float32."""
    out = np.empty((audio.frames, 1), np.float32)
    for a, b in _chunks(0, audio.frames):
        out[a:b, 0] = to_float(audio, a, b).mean(axis=1)
    return Audio(data=out, rate=audio.rate, bits=32, is_float=True, label=audio.label, path=audio.path,
                 meta=dict(audio.meta, changed="mixed down"))


def common_ground(a: Audio, b: Audio, work_dir: Optional[str] = None) -> Tuple[Audio, Audio, dict]:
    """A and B at one rate and channel count, and what was done to get there."""
    done: dict = {"rate": min(a.rate, b.rate), "resampled": None, "downmixed": False,
                  "channels": a.channels if a.channels == b.channels else 1}
    if a.rate != b.rate:
        which = "a" if a.rate > b.rate else "b"
        high = a if which == "a" else b
        moved, how = resample(high, done["rate"], work_dir)
        done["resampled"] = {"which": which, "from": high.rate, "to": done["rate"], "with": how}
        if which == "a":
            a = moved
        else:
            b = moved
    if a.channels != b.channels:
        done["downmixed"] = {"a": a.channels, "b": b.channels}
        a, b = downmix(a), downmix(b)
    return a, b, done
