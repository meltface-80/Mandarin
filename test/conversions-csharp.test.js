"use strict";
/*
 * Stage 3 (v0.8.40): the conversions the Node server still made, made by the
 * C# server (server/Mandarin.Server/Streams.cs, Transcoder.cs):
 *
 *   - a ReplayGain (?g=), on Sonos's rule and on a renderer's rate and depth;
 *   - a zone's DSP (?o=), read from audio_devices as the device fetches (a
 *     Sonos room's own setting left out, as the Node server leaves it), with
 *     a gain too; the Node server told while one runs (playback's second core);
 *   - 32-bit output, where this ffmpeg writes 32-bit FLAC;
 *   - the Node server's "make these next" for them, handed over.
 *
 * Each file is the one ffmpeg makes with the Node server's own plan and
 * arguments (lib/stream.js), byte for byte, under the Node server's own name
 * for it. What this side can't read as Express does (?g[]=, ?g=1&g=2) and a
 * gain out of range are still the Node server's (a 400).
 *
 * Through the C# server only (MANDARIN_FRONT=1).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { signIn } = require("./auth-helper");

const skip = (process.env.MANDARIN_FRONT !== "1" && "the C# server's: MANDARIN_FRONT=1") || (!haveFfmpeg() && "ffmpeg is not installed");

async function until(fn, ms = 20000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting " + what);
    await new Promise(r => setTimeout(r, 100));
  }
}

test("ReplayGain, a zone's DSP and 32-bit output: converted by the C# server as the Node server converts them", { skip, timeout: 180000 }, async (t) => {
  const STREAM = require("../lib/stream");
  const DSP = require("../lib/dsp");
  const FF = require("../lib/ffmpeg");
  const CPU = require("../lib/cpu");
  const { planFor } = require("../lib/server/playback");
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token };
  await until(() => ctx.library.count === 3 && ctx.frontRuns, 30000, "the library and the hand-over");
  const row = title => ctx.db.raw.prepare("SELECT * FROM tracks WHERE title = ?").get(title);
  const info = r => ({ path: r.path, codec: r.codec, sampleRate: r.sample_rate, bitsPerSample: r.bits, channels: r.channels });
  const song = row("Song 1"), hi = row("Hi 1");
  const made = path.join(lib.data, "transcode");
  // The file ffmpeg makes with the Node server's own arguments for this plan.
  let n = 0;
  const nodeMade = (r, plan) => {
    const out = path.join(lib.root, "node-made-" + (++n) + ".flac");
    const x = spawnSync(FF.info().bin, STREAM.ffmpegArgs(r.path, plan, out));
    assert.equal(x.status, 0, String(x.stderr));
    return fs.readFileSync(out);
  };
  const keyOf = (r, plan) => ctx.transcoder.keyFor(r, plan);
  const fetchAll = async (addr) => {
    const r = await fetch(B + addr, { headers: H });
    return { status: r.status, by: r.headers.get("x-mandarin-answered"), type: r.headers.get("content-type"), body: Buffer.from(await r.arrayBuffer()) };
  };
  /*
   * Converted here, the very file the Node server's plan makes, kept under
   * the Node server's name for it. Compared once made: one sent while ffmpeg
   * is still writing it carries the header FLAC writes first, which gets its
   * length and checksum when the file ends (the Node server's own tail does
   * the same).
   */
  const convertedAsNode = async (addr, r, plan, what) => {
    const got = await fetchAll(addr);
    assert.deepEqual([got.status, got.by, got.type], [200, "C#", "audio/flac"], what);
    const key = keyOf(r, plan), file = path.join(made, key + ".flac");
    await until(() => fs.existsSync(file), 10000, what + ": kept as " + key);
    const want = nodeMade(r, plan);
    assert.equal(got.body.length, want.length, what + ": as long as the Node server's");
    assert.ok(fs.readFileSync(file).equals(want), what + ": the file ffmpeg makes with the Node server's plan, byte for byte");
    const again = await fetchAll(addr);
    assert.deepEqual([again.status, again.by, again.type], [200, "C#", "audio/flac"], what + ": again, from the cache");
    assert.ok(again.body.equals(want), what + ": the same file");
    return key;
  };

  await t.test("a ReplayGain: on Sonos's rule (the file as it is, or the 24/48 rule) and on a renderer's rate", async () => {
    // 16/44.1 FLAC, which Sonos takes as it is: with a gain, FLAC at its own rate, 24 bits.
    const p1 = STREAM.withGain(planFor(song), info(song), null, -3);
    assert.deepEqual([p1.rate, p1.bits, p1.gain, !!p1.hq], [44100, 24, -3, false]);
    assert.match(await convertedAsNode(`/stream/t${song.id}.flac?g=-3`, song, p1, "16/44.1 with -3 dB"), /-44100-24-g-3$/);
    // 24/96, which the 24/48 rule converts: the gain in the same conversion.
    const p2 = STREAM.withGain(planFor(hi), info(hi), null, 2.5);
    assert.deepEqual([p2.rate, p2.bits, p2.gain], [48000, 24, 2.5]);
    await convertedAsNode(`/stream/t${hi.id}.flac?g=2.5`, hi, p2, "24/96 with +2.5 dB");
    // A renderer's: the high-quality settings, the gain to a tenth of a dB.
    const p3 = Object.assign(STREAM.withGain({ transcode: true, hq: true, mime: "audio/flac", ext: "flac", rate: 96000, bits: 24, reason: "what the renderer was promised" },
      info(song), null, -6.04), { hq: true });
    assert.equal(p3.gain, -6);
    assert.match(await convertedAsNode(`/stream/t${song.id}.96000-24.flac?g=-6.04`, song, p3, "a renderer's 24/96 with -6 dB"), /-96000-24-hq-g-6$/);
    // A gain too small to hear is none: the file as it is.
    const quiet = await fetchAll(`/stream/t${song.id}.flac?g=0.04`);
    assert.deepEqual([quiet.status, quiet.by, quiet.body.equals(fs.readFileSync(song.path))], [200, "C#", true]);
  });

  await t.test("a zone's DSP, read as the device fetches; a Sonos room's left out; with a gain too", async () => {
    const now = Date.now();
    for (const [id, kind] of [["UPNP_test-dsp", "upnp"], ["RINCON_TESTDSP01400", "sonos"]]) {
      ctx.db.raw.prepare("INSERT INTO audio_devices(id, kind, network_name, first_seen, last_seen) VALUES(?, ?, ?, ?, ?)").run(id, kind, id, now, now);
    }
    ctx.devices.setDsp("UPNP_test-dsp", { enabled: true, peq: { bands: [{ type: "peak", freq: 1000, gain: 4, q: 1.2 }, { type: "low_shelf", freq: 90, gain: -3, q: 0.7 }] } });
    // A Sonos room is tuned with Trueplay: a setting written for one anyway is left out, as the Node server leaves it.
    ctx.db.raw.prepare("UPDATE audio_devices SET settings = ? WHERE id = ?").run(JSON.stringify({ dsp: { enabled: true, peq: { bands: [{ type: "peak", freq: 500, gain: 6, q: 1 }] } } }), "RINCON_TESTDSP01400");
    assert.equal(ctx.devices.dspFor("RINCON_TESTDSP01400"), null);
    const asked = (rate, bits, o) => {
      const p = { transcode: true, hq: true, mime: "audio/flac", ext: "flac", rate, bits, reason: "what the renderer was promised" };
      const part = DSP.planPart(ctx.devices.dspFor(o), rate);
      if (part) { p.dsp = part; p.inRate = Number(hi.sample_rate) || 0; }
      return p;
    };
    const dspBefore = CPU.plan().dsp;
    const p1 = asked(48000, 24, "UPNP_test-dsp");
    assert.ok(p1.dsp && p1.dsp.hash, "the Node server's plan has the DSP");
    const k1 = await convertedAsNode(`/stream/t${hi.id}.48000-24.flac?o=UPNP_test-dsp`, hi, p1, "24/96 to 48 kHz with the zone's DSP");
    assert.match(k1, new RegExp(`-48000-24-hq-d${p1.dsp.hash}$`));
    assert.equal(dspBefore, false, "no DSP in use before");
    await until(() => CPU.plan().dsp, 5000, "the Node server to be told: playback's second core while DSP runs, and for a while after");
    // With a gain as well: the gain first, then the DSP.
    const p2 = Object.assign(STREAM.withGain(asked(96000, 24, "UPNP_test-dsp"), info(hi), null, -4), { hq: true });
    assert.match(await convertedAsNode(`/stream/t${hi.id}.96000-24.flac?o=UPNP_test-dsp&g=-4`, hi, p2, "the zone's DSP and -4 dB"), /-hq-d[0-9a-f]+-g-4$/);
    // A Sonos room's, or a zone that isn't one: no DSP, the conversion alone.
    for (const o of ["RINCON_TESTDSP01400", "nobody"]) {
      const p = asked(44100, 24, o);
      assert.equal(p.dsp, undefined);
      assert.match(await convertedAsNode(`/stream/t${hi.id}.44100-24.flac?o=${o}`, hi, p, "?o=" + o), /-44100-24-hq$/);
    }
  });

  await t.test("32-bit output: made here where this ffmpeg writes 32-bit FLAC, else refused as before", async () => {
    const addr = `/stream/t${hi.id}.96000-32.flac`;
    if (FF.info().flac32) {
      await convertedAsNode(addr, hi, { transcode: true, hq: true, mime: "audio/flac", ext: "flac", rate: 96000, bits: 32, reason: "what the renderer was promised" }, "a renderer's 32/96");
    } else {
      const got = await fetchAll(addr);
      assert.deepEqual([got.status, got.by], [400, null], "this ffmpeg caps FLAC at 24 bits: the Node server's 400");
    }
  });

  await t.test("what this side can't read as Express does, and a gain out of range: the Node server's", async () => {
    for (const [q, status] of [["g%5B%5D=-3", 200], ["g[]=-3", 200], ["g=-3&g=-3", 400], ["g=99", 400], ["g=-30", 400], ["g=loud", 400]]) {
      const got = await fetchAll(`/stream/t${song.id}.flac?${q}`);
      assert.deepEqual([got.status, got.by], [status, null], q);
    }
  });

  await t.test("the Node server's \"make these next\" with a gain or a DSP: handed over, made here", async () => {
    const own = ctx.transcoder.delegate.owns;
    assert.equal(own({ path: song.path }, { transcode: true, rate: 44100, bits: 24, gain: -3 }), true, "a gain");
    assert.equal(own({ path: song.path }, { transcode: true, rate: 48000, bits: 24, hq: true, dsp: { hash: "x" } }), true, "a DSP");
    assert.equal(own({ path: song.path }, { transcode: true, rate: 96000, bits: 32, hq: true }), FF.info().flac32, "32 bits, where ffmpeg writes them");
    assert.equal(own({ path: "qobuz://track/1" }, { transcode: true, rate: 44100, bits: 24, gain: -3 }), false, "a service's track: still made by the Node server");
    const items = [
      { track: song, plan: STREAM.withGain(planFor(song), info(song), null, -9) },
      { track: hi, plan: Object.assign(STREAM.withGain({ transcode: true, hq: true, rate: 88200, bits: 24, reason: "what the renderer was promised" }, info(hi), null, 1.5), { hq: true }) }
    ];
    const dsp = DSP.planPart(ctx.devices.dspFor("UPNP_test-dsp"), 88200);
    items.push({ track: hi, plan: { transcode: true, hq: true, rate: 88200, bits: 24, reason: "what the renderer was promised", dsp, inRate: hi.sample_rate } });
    ctx.transcoder.prefetch(items);
    for (const it of items) {
      const file = path.join(made, keyOf(it.track, it.plan) + ".flac");
      await until(() => fs.existsSync(file), 30000, "the C# server to make " + path.basename(file));
      assert.ok(fs.readFileSync(file).equals(nodeMade(it.track, it.plan)), path.basename(file) + ": the Node server's file");
    }
    assert.equal(ctx.transcoder.jobs.size, 0, "none made by the Node server");
  });
});

/*
 * 32-bit output end to end, on any machine: the C# server started behind an
 * ffmpeg that says, when asked, that it writes 32-bit FLAC (the probe's
 * STREAMINFO answered with 32 bits) and is otherwise the real one. The
 * request, the plan, the name and the arguments are then the 32-bit ones,
 * and the file the very one the real ffmpeg makes from the Node server's plan.
 */
test("32-bit output, end to end: an ffmpeg that writes it", { skip, timeout: 120000 }, async (t) => {
  const STREAM = require("../lib/stream");
  const FF = require("../lib/ffmpeg");
  const lib = makeLibrary();
  const wrapper = path.join(lib.root, "ffmpeg-32");
  fs.writeFileSync(wrapper, `#!/bin/sh
# The 32-bit FLAC probe answered yes: a STREAMINFO of 32 bits per sample. Anything else: the real ffmpeg.
case " $* " in *" anullsrc=r=44100:cl=stereo "*) printf 'fLaC\\200\\000\\000\\042'; head -c 12 /dev/zero; printf '\\001\\360'; head -c 28 /dev/zero; exit 0;; esac
exec "$REAL_FFMPEG" "$@"
`, { mode: 0o755 });
  const was = { FFMPEG_PATH: process.env.FFMPEG_PATH, REAL_FFMPEG: process.env.REAL_FFMPEG };
  const real = FF.info().bin;   // the Node server's own, asked (and kept) before the C# server is given the wrapper
  process.env.FFMPEG_PATH = wrapper; process.env.REAL_FFMPEG = real;
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  let ctx;
  try { ctx = await srv.start(); }
  finally { for (const [k, v] of Object.entries(was)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
  t.after(() => srv.stop());
  const token = await signIn(B);
  await until(() => ctx.library.count === 3 && ctx.frontRuns, 30000, "the library and the hand-over");
  const hi = ctx.db.raw.prepare("SELECT * FROM tracks WHERE title = ?").get("Hi 1");
  const plan = { transcode: true, hq: true, mime: "audio/flac", ext: "flac", rate: 96000, bits: 32, reason: "what the renderer was promised" };
  const r = await fetch(B + `/stream/t${hi.id}.96000-32.flac`, { headers: { Authorization: "Bearer " + token } });
  const body = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([r.status, r.headers.get("x-mandarin-answered")], [200, "C#"], "a renderer's 32/96, converted by C#");
  const file = path.join(lib.data, "transcode", ctx.transcoder.keyFor(hi, plan) + ".flac");
  assert.match(path.basename(file), /-96000-32-hq\.flac$/);
  await until(() => fs.existsSync(file), 10000, "kept as " + path.basename(file));
  const out = path.join(lib.root, "node-made-32.flac");
  const x = spawnSync(real, STREAM.ffmpegArgs(hi.path, plan, out));
  assert.equal(x.status, 0, String(x.stderr));
  const want = fs.readFileSync(out);
  assert.ok(fs.readFileSync(file).equals(want), "the file the Node server's 32-bit plan makes, byte for byte");
  assert.equal(body.length, want.length);
});

