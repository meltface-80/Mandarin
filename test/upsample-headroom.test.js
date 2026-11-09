"use strict";
/*
 * Clipping, and Headroom when upsampling (item 348: Upsample/Headroom.cs). A track whose samples reach full scale has
 * peaks between them above it (here a tone at a quarter of the rate, its samples at ±0.999, its peaks 3 dB over):
 * upsampled, PCM's word can't hold them. With Headroom when upsampling off, the making says what it clipped as it goes,
 * and Now playing's upsampling line turns red, its step saying how much. With it Auto, the track is turned down by what
 * its peaks need and half a dB, from its true peak as measured, a step of its own; nothing is clipped.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { gen, haveFfmpeg } = require("./fixtures");
const { FakeSlim } = require("./fake-slim");
const { signIn } = require("./auth-helper");
const { start, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 20000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? ": " + what : ""));
    await sleep(100);
  }
}

test("a track that clips when upsampled: said in red as it is made; Auto headroom turns it down just enough", { skip, timeout: 150000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-headroom-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const music = path.join(root, "music");
  // A quarter of the rate, a quarter turn in: each sample at ±0.999 of full scale, the wave between them 3 dB over it.
  for (const i of [1, 2])
    gen(path.join(music, "Artist L", "Loud", `0${i}.flac`), { seconds: 30, expr: "1.4128*sin(2*PI*11025*t+PI/4)|1.4128*sin(2*PI*11025*t+PI/4)", tags: { title: `Loud ${i}`, artist: "Artist L", album: "Loud", track: i } });
  const SLIM = ports.port();
  const srv = await start({ port: ports.port(), musicDir: music, dataDir: path.join(root, "data"), env: { SLIMPROTO_PORT: String(SLIM) } });
  const player = new FakeSlim({ port: SLIM, name: "Loud Pi", seconds: 30, early: true });
  t.after(async () => { player.close(); await srv.stop(); });
  const token = await signIn(srv.base);
  const call = async (method, p, body) => {
    const r = await fetch(srv.base + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  await until(async () => { const s = await api("status"); return s.index_count === 1 && !s.scanning; }, 60000, "the library");
  await player.connect();
  const ID = "SLIM_020000000031";
  await until(async () => (await api("audio-devices")).devices.some(d => d.id === ID), 15000, "the player");
  assert.equal((await call("PATCH", "audio-devices/" + ID, { enabled: true })).status, 200);
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === ID), 20000, "the room");

  // Its setting: Auto by its absence, Off, nothing else.
  assert.equal((await call("PATCH", "audio-devices/" + ID, { output: { headroom: "loud" } })).status, 400);
  const off = await call("PATCH", "audio-devices/" + ID, { output: { mode: "x2", filter: "gaussian", headroom: "off" } });
  assert.equal(off.status, 200);
  assert.equal(off.output.headroom, "off");
  const album = (await api("library/albums?sort=album")).albums.find(a => a.title === "Loud");
  const signal = async () => { const z = (await api("zone-state?zone=" + ID)).zone; return z && z.now_playing && z.now_playing.line1 === "Loud 1" && z.now_playing.signal; };

  // Off: clipped as it is made, the upsampling line red, its step saying so.
  assert.equal((await api("play", { offset: album.offset, zone_or_output_id: ID, kind: "play_now" })).status, 200);
  const red = await until(async () => { const s = await signal(); return s && s.alert !== undefined && s; }, 30000, "the line in red");
  assert.match(red.lines[red.alert], /^Gaussian ×2 · 24\/88\.2 kHz/, "the upsampling's line");
  const up = red.steps.find(s => s.kind === "upsample");
  assert.equal(up.quality, "lossy");
  assert.match(up.detail, / · clipped: [\d,.]+ samples over full scale, peaks \+[23]\.\d dB$/);
  assert.equal(red.steps.some(s => s.kind === "headroom"), false);
  await until(() => srv.logs.some(l => /01\.flac: ×2, .* sample\(s\) clipped/.test(l)), 30000, "the clipping in the log");

  // Auto: turned down by its peaks' 3 dB and half a dB, a step of its own; nothing clipped, nothing red.
  assert.equal((await call("PATCH", "audio-devices/" + ID, { output: { headroom: "auto" } })).status, 200);
  assert.equal((await api("audio-devices/" + ID)).output.headroom, undefined, "Auto by its absence");
  assert.equal((await api("play", { offset: album.offset, zone_or_output_id: ID, kind: "play_now" })).status, 200);
  await until(() => player.log.some(l => /^strm s .*[?&]g=-3\.\d/.test(l)), 30000, "the track asked for turned down");
  const calm = await until(async () => { const s = await signal(); return s && s.steps.find(x => x.kind === "headroom") && s.steps.find(x => x.kind === "keeping" && /^Made at/.test(x.detail)) && s; }, 30000, "made, with its headroom");
  assert.match(calm.steps.find(s => s.kind === "headroom").detail, /^−3\.\d dB, so that its peaks between samples aren’t clipped when it is upsampled$/);
  assert.equal(calm.alert, undefined, "nothing in red");
  assert.equal(calm.steps.find(s => s.kind === "upsample").quality, "enhanced");
  assert.ok(calm.lines.some(l => /Headroom −3\.\d dB/.test(l)), calm.lines.join(" / "));
});
