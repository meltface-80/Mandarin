"use strict";
/*
 * The long filters, end to end (item 317, server Upsample/StreamUpsample.cs): a device set to the Long filter, and
 * then the Very long one, is handed a CD rip upsampled ×2 whose URL asks it (f=long, f=vlong); what it fetches is
 * 24/88.2 FLAC as long as the track, and Now playing's signal path names the filter. A filter there isn't, refused.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("child_process");
const { haveFfmpeg, makeLibrary, probe, FFMPEG } = require("./fixtures");
const { FakeRenderer, idFor } = require("./fake-renderer");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? ": " + what : ""));
    await sleep(100);
  }
}

test("the long filters: a CD rip upsampled ×2 in Long and Very long, its URL asking each, the signal path naming it", { skip, timeout: 150000 }, async (t) => {
  const lib = makeLibrary();
  const wiim = new FakeRenderer({ name: "WiiM Pro Plus", manufacturer: "Linkplay Technology Inc.", model: "WiiM Pro Plus", linkplay: { DeviceName: "Living Room WiiM" } });
  await wiim.start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [],
    upnpHosts: [wiim.location], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(async () => { await srv.stop(); await wiim.stop(); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  const W = idFor(wiim.udn);
  await until(async () => (await api("status")).index_count > 0, 30000);
  await until(async () => (await api("audio-devices")).devices.some(x => x.id === W), 20000);
  const cd = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");   // 16/44.1 FLAC, 3 s tracks
  assert.equal((await call("PATCH", "audio-devices/" + W, { enabled: true, output: { mode: "x2", bits: 24, filter: "longest" } })).status, 400, "a filter there isn't");
  await until(async () => (await api("zones")).zones.some(x => x.zone_id === W), 20000);
  for (const [filter, shape, name] of [["long", "long", "Long filter"], ["very-long", "vlong", "Very long filter"]]) {
    const r = await call("PATCH", "audio-devices/" + W, { enabled: true, output: { mode: "x2", bits: 24, filter } });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.output.filter, filter);
    const from = wiim.fetches.length;
    await api("control", { zone_or_output_id: W, command: "stop" });
    assert.equal((await api("play", { offset: cd.offset, zone_or_output_id: W, kind: "play_now" })).status, 200);
    const f = await until(() => wiim.fetches.slice(from).filter(x => x.done && x.body && x.body.length > 1000 && /88200-24/.test(x.uri)).pop(), 60000, filter + ": the made FLAC fetched");
    assert.match(f.uri, new RegExp("\\.88200-24\\.flac\\?(.*&)?f=" + shape + "(&|$)"), f.uri);
    assert.deepEqual(probe(f.body), { rate: 88200, channels: 2, bits: 24 });
    // As long as the track: 3 s at 88.2 kHz, every frame.
    const pcm = execFileSync(FFMPEG, ["-v", "error", "-i", "pipe:0", "-f", "s32le", "-"], { input: f.body, maxBuffer: 1 << 28 });
    assert.equal(pcm.length / 8, 3 * 88200, filter + ": its length");
    const sp = await until(async () => { const z = (await api("zone-state?zone=" + W)).zone; const s = z && z.now_playing && z.now_playing.signal; return s && s.lines[1] === name && s; }, 15000, filter + ": the signal path");
    assert.equal(sp.steps.find(x => x.kind === "upsample").detail, "×2 to 88.2 kHz · " + name);
  }
});
