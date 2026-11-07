"use strict";
/*
 * A device's Phase, end to end (item 318, server Upsample/Shape.cs): Gaussian in minimum phase is asked of the
 * stream as f=gauss-min and Now playing says "Gaussian, minimum phase ×2 · 24/88.2 kHz"; Gaussian steep stays linear (it keeps
 * every sample only so); "minphase" from before is the standard filter with Phase minimum, its stream f=min as
 * before; Phase linear clears it, and the standard filter is SoX's again. A Phase there isn't, refused.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
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

test("a device's Phase: minimum for its filters, Gaussian steep kept linear, minphase from before its standard one", { skip, timeout: 150000 }, async (t) => {
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
  const cd = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");   // 16/44.1 FLAC
  assert.equal((await call("PATCH", "audio-devices/" + W, { enabled: true, output: { mode: "x2", phase: "zero" } })).status, 400, "a Phase there isn't");
  await until(async () => (await api("zones")).zones.some(x => x.zone_id === W), 20000);
  // Played with [output], the stream fetched and the signal path's filter.
  const play = async (output) => {
    const r = await call("PATCH", "audio-devices/" + W, { enabled: true, output: Object.assign({ mode: "x2", bits: 24 }, output) });
    assert.equal(r.status, 200, JSON.stringify(r));
    const from = wiim.fetches.length;
    await api("control", { zone_or_output_id: W, command: "stop" });
    assert.equal((await api("play", { offset: cd.offset, zone_or_output_id: W, kind: "play_now" })).status, 200);
    const f = await until(() => wiim.fetches.slice(from).filter(x => x.done && x.body && x.body.length > 1000 && /88200-24/.test(x.uri)).pop(), 60000, JSON.stringify(output) + ": the made FLAC");
    const sp = await until(async () => { const z = (await api("zone-state?zone=" + W)).zone; const np = z && z.now_playing; return np && np.signal && np.signal.lines[1] && np.signal; }, 15000, "the signal path");
    return { out: r.output, uri: f.uri, filter: sp.lines[1] };
  };
  let p = await play({ filter: "gaussian", phase: "minimum" });
  assert.deepEqual([p.out.filter, p.out.phase], ["gaussian", "minimum"]);
  assert.match(p.uri, /[?&]f=gauss-min(&|$)/, p.uri);
  assert.equal(p.filter, "Gaussian, minimum phase ×2 · 24/88.2 kHz");
  p = await play({ filter: "gaussian-steep" });
  assert.match(p.uri, /[?&]f=gauss-steep(&|$)/, "Gaussian steep, linear only: " + p.uri);
  // "minphase" from before: the standard filter, Phase minimum.
  p = await play({ filter: "minphase", phase: undefined });
  assert.deepEqual([p.out.filter, p.out.phase], [undefined, "minimum"]);
  assert.match(p.uri, /[?&]f=min(&|$)/, p.uri);
  assert.equal(p.filter, "Minimum-phase ×2 · 24/88.2 kHz");
  // Phase linear: the standard filter, SoX's, nothing asked of the stream.
  const r = await call("PATCH", "audio-devices/" + W, { output: { phase: "linear" } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual([r.output.filter, r.output.phase], [undefined, undefined]);
});
