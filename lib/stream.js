"use strict";
/*
 * stream.js — what a Sonos player is handed for each track, and serving it.
 *
 * THE RULE: Sonos S2 plays up to 24-bit / 48 kHz. Anything within that, in a
 * container Sonos reads, goes out as the stored file, byte for byte. Anything
 * above it is brought down to 24/48 — resampled, never dropped to a lossy
 * format, because losing the rate above 48 kHz is a far smaller loss than
 * losing lossless coding. Formats Sonos cannot read at all (DSD, WMA lossless,
 * APE, WavPack, Opus…) are converted to FLAC within the same ceiling.
 *
 * A transcode is written to a cache file, and a request that arrives while it
 * is still being written is served from the growing file: the speaker starts
 * as soon as the first frames exist, and every later request (a seek, a replay,
 * the next time the album is played) gets the finished file with a length and
 * byte ranges. Upcoming tracks are prepared ahead, so by the time Sonos asks for
 * the next track it is usually already complete.
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const FF = require("./ffmpeg");
const DSP = require("./dsp");

const MAX_RATE = 48000;
const MAX_BITS = 24;

// codec (as music-metadata names it, lowercased) → the MIME Sonos matches on.
function nativeMime(t) {
  const codec = String(t.codec || "").toLowerCase();
  const ext = path.extname(t.path || "").toLowerCase();
  if (codec === "flac" && (ext === ".flac" || ext === ".fla")) return "audio/flac";
  if (ext === ".mp3" && (!codec || /mpeg|mp3/.test(codec))) return "audio/mpeg";
  if (codec === "alac" && /\.(m4a|mp4|alac)$/.test(ext)) return "audio/mp4";
  if (/^aac|mpeg-4\/aac|^mp4a/.test(codec) && /\.(m4a|mp4|m4b)$/.test(ext)) return "audio/mp4";
  if (/^aac/.test(codec) && ext === ".aac") return "audio/aac";
  if (codec === "vorbis" && /\.(ogg|oga)$/.test(ext)) return "audio/ogg";
  // Uncompressed PCM: Sonos documents WAV/AIFF at 16 bits. Deeper files are
  // still lossless as FLAC, sample for sample, so they go that way instead.
  const pcm = /pcm|65534|^$/.test(codec);
  if (pcm && /\.wave?$/.test(ext) && (t.bitsPerSample || 16) <= 16) return "audio/wav";
  if (pcm && /\.aif[fc]?$/.test(ext) && (t.bitsPerSample || 16) <= 16) return "audio/aiff";
  return null;
}

// The extension a stream URL ends in → the MIME it is served as. The same
// table decides what the DIDL promises, so the two always agree.
const EXT_MIME = {
  flac: "audio/flac", fla: "audio/flac", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", alac: "audio/mp4",
  m4b: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
  wav: "audio/wav", wave: "audio/wav", aif: "audio/aiff", aiff: "audio/aiff", aifc: "audio/aiff",
  wma: "audio/x-ms-wma", dsf: "audio/x-dsf", dff: "audio/x-dff"
};
function mimeForExt(ext) { return EXT_MIME[String(ext || "").toLowerCase()] || "application/octet-stream"; }

/*
 * Decide how one track goes to the speaker.
 * → { transcode: false, mime, ext, reason }  or
 *   { transcode: true, mime: "audio/flac", ext: "flac", rate, bits, reason }
 *
 * With no target this is THE RULE above, for Sonos. A UPnP renderer passes
 * its own ceiling (lib/renderers/players.js): the rates and depth it takes
 * and the containers it advertises — and gets the same idea applied to it:
 * the file itself where it can be, FLAC at the best rate it takes otherwise.
 */
function plan(t, target) {
  if (target) return rendererPlan(t, target);
  const rate = Number(t.sampleRate) || 0;
  const bits = Number(t.bitsPerSample) || 0;
  const channels = Number(t.channels) || 2;
  const mime = nativeMime(t);
  const tooHigh = rate > MAX_RATE || bits > MAX_BITS;
  const dsd = /dsd|dsf|dff/i.test(String(t.codec || "")) || /\.(dsf|dff)$/i.test(t.path || "");
  if (mime && !tooHigh && channels <= 2 && !dsd) {
    return { transcode: false, mime, ext: path.extname(t.path).slice(1).toLowerCase(), reason: "bit-perfect" };
  }
  let reason;
  if (dsd) reason = "DSD, which Sonos does not play";
  else if (tooHigh) reason = `${bits || "?"}-bit/${rate ? rate / 1000 : "?"} kHz is above what Sonos takes`;
  else if (channels > 2) reason = `${channels} channels, folded down to stereo`;
  else if (/\.(wave?|aif[fc]?)$/i.test(t.path || "")) reason = `${bits || "?"}-bit uncompressed, repacked as FLAC with the same samples`;
  else reason = `a ${t.codec || "file"} Sonos cannot read`;
  // Anything resampled, or decoded from DSD / float, carries more than 16 bits
  // of information afterwards, so it goes out at 24. A native-rate 16-bit
  // source in an unreadable container stays 16-bit — nothing is added.
  const outRate = dsd ? MAX_RATE : (rate > MAX_RATE || !rate ? MAX_RATE : rate);
  const outBits = (dsd || rate > MAX_RATE || bits > 16 || !bits) ? 24 : 16;
  return repack({ transcode: true, mime: "audio/flac", ext: "flac", rate: outRate, bits: outBits, reason }, t);
}

// 44.1 kHz and its multiples are one family, 48 kHz and its multiples the
// other; a conversion stays in the file's family, as Roon's does.
function family(hz) { return hz % 44100 === 0 ? 44100 : 48000; }

/*
 * A conversion that changes only the container (v0.7.6): a WAV or AIFF the
 * device won't take, repacked as FLAC at the file's own rate and depth. The
 * samples must come out exactly as they went in — so no dither. Dither is
 * right when precision is being removed (a resample, a gain, DSP, or a
 * depth below the file's); here nothing is, and dither at the 32-bit output
 * followed by the encoder's cut to 24 bits took one 24-bit LSB off an eighth
 * of the samples, always downwards. Found by a bit-for-bit capture.
 */
function repack(p, t) {
  const rate = Number(t.sampleRate) || 0, bits = Number(t.bitsPerSample) || 0;
  const channels = Number(t.channels) || 2;
  const codec = String(t.codec || "").toLowerCase();
  if (!p || !p.transcode || p.dsd || p.dsp || p.gain || p.upsampled) return p;
  if (!rate || !bits || p.rate !== rate || p.bits < bits || channels > 2) return p;
  // Integer samples to begin with: a WAV, AIFF, FLAC, ALAC, APE, WavPack,
  // TTA, TAK or Shorten. A lossy file decodes to float and is rightly dithered.
  const integer = /flac|alac|pcm|65534|monkey|\bape\b|wavpack|\bwv\b|\btta\b|\btak\b|shorten|\bshn\b/.test(codec)
    || (!codec && /\.(wave?|aif[fc]?)$/i.test(t.path || ""));
  if (!integer) return p;
  p.exact = true;
  if (/\.(wave?|aif[fc]?)$/i.test(t.path || "")) p.reason = `${bits}-bit uncompressed, repacked as FLAC with the same samples`;
  return p;
}

// What most renderers take when theirs could not be read.
const USUAL_CONTAINERS = ["flac", "mp3", "aac", "alac", "wav", "aiff", "ogg"];

// The file's own container, if the renderer takes it.
function rendererMime(t, accepts) {
  const codec = String(t.codec || "").toLowerCase();
  const ext = path.extname(t.path || "").toLowerCase();
  if (codec === "flac" && (ext === ".flac" || ext === ".fla")) return accepts("flac") ? "audio/flac" : null;
  if (ext === ".mp3" && (!codec || /mpeg|mp3/.test(codec))) return accepts("mp3") ? "audio/mpeg" : null;
  if (codec === "alac" && /\.(m4a|mp4|alac)$/.test(ext)) return accepts("alac") ? "audio/mp4" : null;
  if (/^aac|mpeg-4\/aac|^mp4a/.test(codec) && /\.(m4a|mp4|m4b)$/.test(ext)) return accepts("aac") ? "audio/mp4" : null;
  if (/^aac/.test(codec) && ext === ".aac") return accepts("aac") ? "audio/aac" : null;
  if (codec === "vorbis" && /\.(ogg|oga)$/.test(ext)) return accepts("ogg") ? "audio/ogg" : null;
  if (codec === "opus" && /\.(opus|ogg)$/.test(ext)) return accepts("opus") ? "audio/ogg" : null;
  const pcm = /pcm|65534|^$/.test(codec);
  if (pcm && /\.wave?$/.test(ext)) return accepts("wav") ? "audio/wav" : null;
  if (pcm && /\.aif[fc]?$/.test(ext)) return accepts("aiff") ? "audio/aiff" : null;
  return null;
}

/*
 * target: { name, rates: [hz…] the device takes, maxBits, containers: [...],
 *           mode: "original" | "x2" | "x4" | "max", bits: "auto" | 24 | 32 }
 *
 * Original: the file itself when its rate, depth and container are all
 * within the device; otherwise FLAC at the highest rate the device takes in
 * the file's family below the file's own (a 352.8 kHz file on a device that
 * stops at 192 plays at 176.4), at 24 bits, or 16 where nothing was added.
 *
 * Upsample ×2 / ×4 / Max: the file's rate times that, capped at the top of
 * the device's ladder in the file's family (Max is that top outright); off
 * the ladder, the rung below. A file already at the top stays as it is. The
 * conversion runs in 64-bit float (ffmpegArgs) and goes out at 24 bits, or
 * 32 where the device takes it and the setting allows.
 */
function rendererPlan(t, target) {
  const rate = Number(t.sampleRate) || 0;
  const bits = Number(t.bitsPerSample) || 0;
  const channels = Number(t.channels) || 2;
  const rates = [...new Set((target.rates || []).map(Number).filter(r => r > 0))].sort((a, b) => a - b);
  if (!rates.length) rates.push(44100, 48000);
  const maxBits = [16, 24, 32].includes(Number(target.maxBits)) ? Number(target.maxBits) : 24;
  const containers = Array.isArray(target.containers) && target.containers.length ? target.containers : USUAL_CONTAINERS;
  const accepts = c => containers.includes(c);
  const who = target.name || "this device";
  const mode = ["x2", "x4", "max"].includes(target.mode) ? target.mode : "original";
  const dsd = /dsd|dsf|dff/i.test(String(t.codec || "")) || /\.(dsf|dff)$/i.test(t.path || "");
  // Native DSD (Stage 9.3): a DSF or DFF file as it is, where the device
  // takes that multiple of 44.1 kHz (DSD64 = 2.8224 MHz) as DSD.
  if (dsd && /\.(dsf|dff)$/i.test(t.path || "") && rate > 0 && (target.dsd || []).includes(Math.round(rate / 44100))) {
    const ext = path.extname(t.path).slice(1).toLowerCase();
    // Named as the device names it (a renderer lists audio/dsf, audio/x-dsf…), else as ours.
    const own = target.dsdMimes && target.dsdMimes[ext];
    return { transcode: false, mime: own || mimeForExt(ext), ext, dsd: Math.round(rate / 44100), reason: `DSD${Math.round(rate / 44100)} as it is` };
  }
  const mime = rendererMime(t, accepts);
  const rateOk = rate > 0 && rates.includes(rate);
  const bitsOk = !bits || bits <= maxBits;
  const top = list => list.length ? list[list.length - 1] : null;
  // The output depth after any processing: 24, or 32 where allowed and taken.
  const want32 = maxBits >= 32 && (target.bits === 32 || target.bits === "auto" || target.bits == null);
  const processedBits = want32 ? 32 : Math.min(maxBits, 24);

  // Upsampling: only from a readable rate, within the file's family.
  if (mode !== "original" && rate > 0 && !dsd) {
    const ladder = rates.filter(r => family(r) === family(rate));
    const ceiling = top(ladder);
    let up = null;
    if (mode === "max") up = ceiling;
    else {
      const wanted = rate * (mode === "x2" ? 2 : 4);
      up = top(ladder.filter(r => r <= wanted));
    }
    if (up && up > rate) {
      const factor = Math.round(up / rate);
      return withDsp({ transcode: true, hq: true, mime: "audio/flac", ext: "flac", rate: up, bits: processedBits,
        upsampled: factor, reason: `upsampled ×${factor} to ${up / 1000} kHz for ${who}` }, target, rate);
    }
    // Already at (or above) the top of the ladder: Original rules below.
  }

  // DSP on (the zone's switch, with bands to run): every track is decoded,
  // filtered and re-encoded — at the file's own rate where it would have
  // gone as it is, to 24 bits (32 where taken).
  const dspOn = DSP.Biquad.active(target.dsp);
  if (mime && rateOk && bitsOk && channels <= 2 && !dsd && !dspOn) {
    return { transcode: false, mime, ext: path.extname(t.path).slice(1).toLowerCase(), reason: "bit-perfect" };
  }
  if (dspOn && mime && rateOk && bitsOk && channels <= 2 && !dsd) {
    return withDsp({ transcode: true, hq: true, mime: "audio/flac", ext: "flac", rate, bits: processedBits, reason: "DSP" }, target, rate);
  }
  let outRate, reason;
  if (dsd) {
    // Until native DSD: PCM at the top of the 44.1 ladder, up to 176.4 kHz.
    outRate = top(rates.filter(r => family(r) === 44100 && r <= 176400)) || top(rates);
    reason = `DSD, played as PCM for ${who}`;
  } else if (!rate) {
    outRate = rates.includes(44100) ? 44100 : rates[0];
    reason = `a ${t.codec || "file"} ${who} cannot read`;
  } else if (rateOk) {
    outRate = rate;
    reason = !bitsOk ? `${bits}-bit is above what ${who} takes`
      : channels > 2 ? `${channels} channels, folded down to stereo`
      : `a ${t.codec || "file"} ${who} cannot read`;
  } else {
    outRate = top(rates.filter(r => family(r) === family(rate) && r <= rate)) || top(rates.filter(r => r <= rate)) || rates[0];
    reason = `${rate / 1000} kHz is not a rate ${who} takes`;
  }
  const changed = outRate !== rate;
  const outBits = dspOn ? processedBits : Math.min(maxBits, (dsd || changed || bits > 16 || !bits) ? 24 : 16);
  return repack(withDsp({ transcode: true, hq: true, mime: "audio/flac", ext: "flac", rate: outRate, bits: outBits, reason }, target, rate), t);
}

/* The plan with the zone's DSP attached (when on), for ffmpegArgs and the
 * cache name. The file's rate is kept for the resample stage. */
function withDsp(p, target, inRate) {
  const part = DSP.planPart(target.dsp, p.rate);
  if (part) { p.dsp = part; p.inRate = inRate || 0; }
  return p;
}

/*
 * The plan with a ReplayGain (lib/loudness.js, v0.6.0-RC5) in it: the gain
 * can only be applied by converting, so a file that would have gone as it is
 * goes as FLAC at its own rate — 24 bits, since a gain adds what 16 can't
 * hold (32 where a renderer takes it and its setting allows). DSD sent as DSD
 * is left alone: there is no gain without turning it into PCM.
 */
function withGain(p, t, target, gain) {
  const g = Number(gain);
  if (!p || !Number.isFinite(g) || Math.abs(g) < 0.05 || p.dsd) return p;
  if (p.transcode) {
    const out = Object.assign({}, p, { gain: Math.round(g * 10) / 10 });
    delete out.exact;   // a gain is applied: no longer sample for sample
    if (out.bits === 16) out.bits = 24;
    return out;
  }
  const rate = Number(t.sampleRate) || 44100;
  let bits = 24;
  if (target) {
    const maxBits = [16, 24, 32].includes(Number(target.maxBits)) ? Number(target.maxBits) : 24;
    const want32 = maxBits >= 32 && (target.bits === 32 || target.bits === "auto" || target.bits == null);
    bits = want32 ? 32 : Math.min(maxBits, 24);
  }
  const out = { transcode: true, mime: "audio/flac", ext: "flac", rate, bits, gain: Math.round(g * 10) / 10, reason: "ReplayGain" };
  if (target) out.hq = true;
  return out;
}

/*
 * The Sonos conversion runs SoX at 28-bit precision. A renderer's (p.hq)
 * runs it at 33 — SoX's double-precision mode — with libswresample carrying
 * the audio as 64-bit float (dblp) from decoder to the final requantise, so
 * the whole chain is 64-bit float; dither is triangular at 24 bits and none
 * at 32, where there is nothing left to hide.
 */
function ffmpegArgs(src, p, dest) {
  // As it comes (a Qobuz stream already at the rate and depth wanted): the
  // FLAC frames copied into the cache, nothing decoded.
  if (p.copy) return ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", src, "-map", "0:a:0", "-vn", "-c:a", "copy", "-f", "flac", dest];
  const ff = FF.info();
  const resampler = ff.soxr ? (p.hq ? "resampler=soxr:precision=33:" : "resampler=soxr:precision=28:") : "";
  const internal = p.hq ? "internal_sample_fmt=dblp:" : "";
  // None where nothing is taken away (p.exact: a repack, or a 32-bit output).
  const dither = (p.exact || p.bits === 32) ? "dither_method=0" : p.bits === 16 ? "dither_method=triangular_hp" : "dither_method=triangular";
  // With DSP (lib/dsp.js): 64-bit float → headroom → resample → the bands,
  // then the one requantise with dither. Without: the resample and the
  // requantise in one, as ever.
  let graph = p.dsp
    ? DSP.filters(p.dsp.dsp, { inRate: p.inRate, rate: p.rate, soxr: ff.soxr }).concat([`aresample=osr=${p.rate}:${dither}`]).join(",")
    : `aresample=${resampler}${internal}osr=${p.rate}:${dither}`;
  // ReplayGain first, in 64-bit float, before anything else is done.
  if (p.gain) graph = `volume=volume=${p.gain}dB:precision=double,` + graph;
  return [
    "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
    "-i", src,
    "-map", "0:a:0",
    "-vn",
    "-af", graph,
    "-ar", String(p.rate),
    "-ac", "2",
    "-sample_fmt", p.bits === 16 ? "s16" : "s32",
    "-bits_per_raw_sample", String(p.bits),
    "-map_metadata", "0",
    "-c:a", "flac", "-compression_level", "5",
    "-f", "flac",
    dest
  ];
}

class Transcoder {
  constructor({ cacheDir, maxBytes = 4 * 1024 ** 3, log = console.log }) {
    this.dir = cacheDir;
    this.maxBytes = maxBytes;
    this.log = log;
    this.jobs = new Map();   // key -> { promise, part, proc, done, failed }
    this.queue = [];         // background prefetch: [{ key, track, plan }]
    this.running = 0;
    this.concurrency = Math.max(1, Number(process.env.TRANSCODE_CONCURRENCY) || 2);
    fs.mkdirSync(this.dir, { recursive: true });
    // Leftover partial files from a crash are never complete.
    for (const f of fs.readdirSync(this.dir)) {
      if (f.endsWith(".part")) { try { fs.unlinkSync(path.join(this.dir, f)); } catch (e) { /* removed by someone else */ } }
    }
  }

  keyFor(track, p) {
    const mtime = Math.floor(Number(track.mtime) || 0);
    // A renderer's conversion (64-bit float, SoX at 33 bits) is its own file,
    // even at the same rate and depth as a Sonos one.
    return `${track.id}-${mtime}-${p.rate}-${p.bits}${p.hq ? "-hq" : ""}${p.dsp ? "-d" + p.dsp.hash : ""}${p.gain ? "-g" + p.gain : ""}${p.exact ? "-x" : ""}`;
  }

  finalPath(key) { return path.join(this.dir, key + ".flac"); }

  status(track, p) {
    const key = this.keyFor(track, p);
    if (fs.existsSync(this.finalPath(key))) return "ready";
    const j = this.jobs.get(key);
    return j ? "running" : "none";
  }

  /* Start (or join) a transcode now. Resolves with the job. */
  start(track, p) {
    const key = this.keyFor(track, p);
    const dest = this.finalPath(key);
    if (fs.existsSync(dest)) {
      const now = new Date();
      try { fs.utimesSync(dest, now, now); } catch (e) { /* LRU touch is best-effort */ }
      return { key, done: true, failed: false, final: dest, part: dest };
    }
    const existing = this.jobs.get(key);
    if (existing) return existing;

    const part = dest + ".part";
    const job = { key, done: false, failed: false, final: dest, part, waiters: new Set(), error: "" };
    const ff = FF.info();
    let err = "";
    let settle;
    job.promise = new Promise((resolve) => { settle = resolve; });
    const finish = (code) => {
      if (code === 0 && fs.existsSync(part)) {
        try { fs.renameSync(part, dest); } catch (e) { job.failed = true; err += e.message; }
      } else {
        job.failed = true;
        try { fs.unlinkSync(part); } catch (e) { /* ffmpeg may not have created it */ }
      }
      job.done = true;
      job.error = err.trim();
      if (job.failed) this.log(`[stream] transcode failed for ${track.path}: ${job.error.slice(0, 300)}`);
      this.jobs.delete(key);
      for (const w of job.waiters) w();
      settle(job);
      this.prune();
    };
    const begin = (src, plan) => {
      const proc = spawn(ff.bin, ffmpegArgs(src, plan, part), { stdio: ["ignore", "ignore", "pipe"] });
      job.proc = proc;
      proc.stderr.on("data", d => { if (err.length < 4000) err += d.toString(); });
      proc.on("error", (e) => { err += e.message; });
      proc.on("close", finish);
      this.log(`[stream] ${path.basename(track.path)}: ${plan.reason} → FLAC ${plan.bits}/${plan.rate / 1000} kHz${plan.copy ? " (as it comes)" : ""}`);
    };
    this.jobs.set(key, job);
    // A track whose audio has to be asked for first (a Qobuz track, lib/qobuz):
    // the resolver says where it is, and whether it can be copied as it is.
    if (this.resolve && this.resolve.wants(track)) {
      this.resolve.get(track, p).then(r => begin(r.src, r.plan || p)).catch(e => { err += e.message; finish(-1); });
    } else begin(track.path, p);
    return job;
  }

  /* Queue tracks to be prepared in the background, in order. */
  prefetch(items) {
    for (const { track, plan: p } of items) {
      if (!p.transcode) continue;
      const key = this.keyFor(track, p);
      if (this.jobs.has(key) || fs.existsSync(this.finalPath(key))) continue;
      if (this.queue.some(q => q.key === key)) continue;
      this.queue.push({ key, track, plan: p });
    }
    this.pump();
  }

  pump() {
    while (this.running < this.concurrency && this.queue.length) {
      const { track, plan: p } = this.queue.shift();
      const job = this.start(track, p);
      if (job.done) continue;
      this.running++;
      job.promise.then(() => { this.running--; this.pump(); });
    }
  }

  /* Keep the cache under its ceiling, least recently used first. */
  prune() {
    let files;
    try {
      files = fs.readdirSync(this.dir).filter(f => f.endsWith(".flac")).map(f => {
        const full = path.join(this.dir, f);
        const st = fs.statSync(full);
        return { full, size: st.size, t: st.mtimeMs };
      });
    } catch (e) { return; }
    let total = files.reduce((a, f) => a + f.size, 0);
    files.sort((a, b) => a.t - b.t);
    while (total > this.maxBytes && files.length > 1) {
      const f = files.shift();
      try { fs.unlinkSync(f.full); total -= f.size; } catch (e) { /* in use or gone */ }
    }
  }

  cacheStats() {
    try {
      const files = fs.readdirSync(this.dir).filter(f => f.endsWith(".flac"));
      const bytes = files.reduce((a, f) => a + fs.statSync(path.join(this.dir, f)).size, 0);
      return { files: files.length, bytes, running: this.jobs.size, queued: this.queue.length };
    } catch (e) { return { files: 0, bytes: 0, running: 0, queued: 0 }; }
  }
}

/*
 * Serve a file that is still being written: send what exists, wait for more,
 * stop when the writer finishes. No Content-Length — the length is not known
 * yet — so this goes out chunked, the way an internet radio stream does.
 */
function tailFollow(req, res, job, mime) {
  res.status(200);
  res.set({ "Content-Type": mime, "Cache-Control": "no-store", "Accept-Ranges": "none" });
  if (req.method === "HEAD") return res.end();
  let pos = 0;
  let fd = null;
  let closed = false;
  const buf = Buffer.alloc(256 * 1024);
  const cleanup = () => {
    closed = true;
    job.waiters && job.waiters.delete(wake);
    if (fd != null) { try { fs.closeSync(fd); } catch (e) { /* already closed */ } fd = null; }
  };
  let timer = null;
  const wake = () => { if (timer) { clearTimeout(timer); timer = null; } setImmediate(pump); };
  req.on("close", cleanup);
  const openFile = () => {
    const f = job.done && !job.failed ? job.final : job.part;
    try { return fs.openSync(f, "r"); } catch (e) { return null; }
  };
  function pump() {
    if (closed) return;
    if (fd == null) fd = openFile();
    if (fd == null) {
      if (job.done) { cleanup(); return job.failed ? res.destroy() : res.end(); }
      timer = setTimeout(pump, 100);
      return;
    }
    let n = 0;
    try { n = fs.readSync(fd, buf, 0, buf.length, pos); } catch (e) {
      // The .part was renamed under us: reopen the finished file at the same place.
      try { fs.closeSync(fd); } catch (e2) { /* already closed */ }
      fd = null;
      return setImmediate(pump);
    }
    if (n > 0) {
      pos += n;
      const ok = res.write(Buffer.from(buf.subarray(0, n)));
      if (ok) setImmediate(pump); else res.once("drain", pump);
      return;
    }
    if (job.done) {
      // Renamed? The part fd still reads the same inode, so a zero read here
      // after done really is the end.
      cleanup();
      return res.end();
    }
    job.waiters && job.waiters.add(wake);
    timer = setTimeout(pump, 200);
  }
  pump();
}

module.exports = { plan, withGain, nativeMime, mimeForExt, ffmpegArgs, Transcoder, tailFollow, MAX_RATE, MAX_BITS };
