"use strict";
/*
 * Keeping up, and a safety net (item 346: Upsample/KeepingUp.cs, Renderers/Players.Safety.cs). A device keeps the Output
 * that last played well. Set to what it can't play (DSD to a SlimProto player that says STMn), or to more than the
 * server can make in time (a making slower than real time over a whole window: here a DSD64 making stopped from
 * outside, as a starved processor would leave it), its Output is put back to the one that played, the track played on
 * under it, the device's page says what happened, and choosing that Output again says what happened last time. While a
 * track is made as it plays, its signal path says how fast ("Processing · Keeping up at 4.2× real time").
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
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

function album(music, title, seconds, n = 2) {
  for (let i = 1; i <= n; i++)
    gen(path.join(music, "Artist K", title, `0${i}.flac`), { seconds, freq: 300 + i * 50, tags: { title: `${title} ${i}`, artist: "Artist K", album: title, track: i } });
}

/* A server with SlimProto on, and a fake player of it switched on; what the tests call it by. */
async function rig(t, { refuse = null, refuseError = 0, seconds = 3, early = false, albums }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-safety-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const music = path.join(root, "music");
  for (const [title, secs] of albums) album(music, title, secs);
  const SLIM = ports.port();
  const srv = await start({ port: ports.port(), musicDir: music, dataDir: path.join(root, "data"), env: { SLIMPROTO_PORT: String(SLIM) } });
  const player = new FakeSlim({ port: SLIM, name: "Den Pi", seconds, refuse, refuseError, early });
  t.after(async () => { player.close(); await srv.stop(); });
  const token = await signIn(srv.base);
  const call = async (method, p, body) => {
    const r = await fetch(srv.base + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  await until(async () => { const s = await api("status"); return s.index_count === albums.length && !s.scanning; }, 60000, "the library");
  await player.connect();
  const ID = "SLIM_020000000031";
  await until(async () => (await api("audio-devices")).devices.some(d => d.id === ID), 15000, "the player");
  assert.equal((await call("PATCH", "audio-devices/" + ID, { enabled: true })).status, 200);
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === ID), 20000, "the room");
  const device = () => api("audio-devices/" + ID);
  const play = async (title) => {
    const a = (await api("library/albums?sort=album")).albums.find(x => x.title === title);
    const ids = (await api("album?offset=" + a.offset)).tracks.map(x => x.track_id);
    assert.equal((await api("play", { offset: a.offset, zone_or_output_id: ID, kind: "play_now" })).status, 200);
    return ids;
  };
  return { srv, player, call, api, ID, device, play };
}

test("a device that can't play what its Output makes: put back to the Output that played, the track played on, said", { skip, timeout: 120000 }, async (t) => {
  const { player, call, ID, device, play } = await rig(t, { refuse: /\.dsf\b/, albums: [["Plain", 3], ["Deep", 3]] });

  // Played as it is, half through: the Output that plays well, kept.
  await play("Plain");
  const good = await until(async () => (await device()).settings.output_good, 20000, "the Output kept as good");
  assert.deepEqual(good, {}, "Original: nothing of Output set");

  // DSD64, which this player turns down: back to Original, the track played as FLAC, the device's page saying so.
  assert.equal((await call("PATCH", "audio-devices/" + ID, { output: { dsd_out: 64 } })).status, 200);
  const ids = await play("Deep");
  await until(() => player.log.some(l => l.startsWith("strm s ") && l.includes(`/stream/t${ids[0]}.d64.dsf`)), 20000, "DSD64 sent");
  const d = await until(async () => { const x = await device(); return x.output.dsd_out === undefined && x; }, 20000, "the Output put back");
  await until(() => player.log.some(l => /^strm s f /.test(l) && l.includes(`/stream/t${ids[0]}.`)), 20000, "the track played on as FLAC");
  assert.equal(d.last_error.message, "DSD64, 7th-order modulator couldn't be played by the device: the Output is back to Original (nothing upsampled), the last that played well");
  assert.deepEqual(d.settings.output_failed.map(f => [f.output, f.why]), [[{ dsd_out: 64 }, "couldn't be played by the device"]]);

  // Chosen again: what happened last time said where the making is; the note put back gone, seen to.
  const again = await call("PATCH", "audio-devices/" + ID, { output: { dsd_out: 64 } });
  assert.match(again.output.making, /Last time DSD64, 7th-order modulator couldn't be played by the device, and the Output was put back\.$/);
  assert.equal((await device()).last_error, null);
});

test("a DAC unplugged (the Bridge's STMn says the DAC): the Output kept, the room stopped saying why", { skip, timeout: 120000 }, async (t) => {
  // Every failure used to be said as "couldn't play the track", so an unplugged DAC put the owner's Output back.
  const { player, call, ID, device, play } = await rig(t, { refuse: /\.dsf\b/, refuseError: 1, albums: [["Plain", 3], ["Deep", 3]] });
  await play("Plain");
  await until(async () => (await device()).settings.output_good, 20000, "the Output kept as good");
  assert.equal((await call("PATCH", "audio-devices/" + ID, { output: { dsd_out: 64 } })).status, 200);
  const ids = await play("Deep");
  await until(() => player.log.some(l => l.startsWith("strm s ") && l.includes(`/stream/t${ids[0]}.d64.dsf`)), 20000, "DSD64 sent");
  const d = await until(async () => { const x = await device(); return x.last_error && x; }, 20000, "the failure said");
  assert.match(d.last_error.message, /the DAC isn't there or stopped/);
  assert.equal(d.output.dsd_out, 64, "the Output as the owner set it");
  assert.equal(d.settings.output_failed, undefined);
});

test("a making slower than it plays: its speed said as it goes, then the Output put back and the track played on from there", { skip, timeout: 150000 }, async (t) => {
  const { srv, player, call, api, ID, device, play } = await rig(t, { seconds: 240, early: true, albums: [["Short", 3], ["Long", 240]] });
  const children = () => execFileSync("ps", ["-e", "-o", "pid=,ppid=,args="], { encoding: "utf8" }).split("\n")
    .map(l => l.trim().split(/\s+/)).filter(f => Number(f[1]) === srv.proc.pid && f.slice(2).includes("upsample")).map(f => Number(f[0]));
  const signal = (sig) => { for (const pid of children()) { try { process.kill(pid, sig); } catch (e) { /* gone */ } } };
  t.after(() => signal("SIGCONT"));

  await play("Short");
  await until(async () => (await device()).settings.output_good, 20000, "the Output kept as good");
  await call("PATCH", "audio-devices/" + ID, { output: { dsd_out: 64 } });
  const ids = await play("Long");

  // As it is made: how fast, in its signal path.
  const step = await until(async () => {
    const np = (await api("zone-state?zone=" + ID)).zone.now_playing;
    return np && np.signal && np.signal.steps.find(s => s.kind === "keeping" && s.quality !== "pending");
  }, 30000, "the making's speed");
  assert.equal(step.title, "Processing");
  assert.match(step.detail, /^(Keeping up at|Made at) [\d.]+× real time/);
  assert.equal(step.quality, "enhanced");

  // Starved: stopped from outside. Slower than real time over a whole window, it is put back to Original, the track
  // fetched again under it from where it was.
  await until(() => children().length > 0, 20000, "the making");
  signal("SIGSTOP");
  const d = await until(async () => { const x = await device(); return x.output.dsd_out === undefined && x; }, 40000, "the Output put back");
  assert.match(d.last_error.message, /^DSD64, 7th-order modulator was made at [\d.]+× real time, too slow to keep up: the Output is back to Original \(nothing upsampled\), the last that played well$/);
  assert.match(d.settings.output_failed[0].why, /too slow to keep up/);
  await until(() => player.log.find(l => /^strm s f /.test(l) && l.includes(`/stream/t${ids[0]}.`) && /[?&]ss=\d/.test(l)), 20000, "the track played on as FLAC, from where it was");
});
