"use strict";
/*
 * A Mandarin Bridge over SlimProto (item 315, Renderers/Devices.Slim.cs): the Bridge's hello names its own web port
 * (MandarinBridge=…), and Mandarin reads its DAC there (/dac.json) as it read a UPnP Bridge's: the rates are its DAC's,
 * by its word; it is listed in Settings → Updates; and each track's request says what the track is (title, artist,
 * album), for the Bridge's screen. A stand-in Bridge here: test/fake-slim.js with a /dac.json beside it. A Bridge
 * that was a UPnP renderer before (up to 0.2.3) keeps, over SlimProto, the name it was given and its settings: its
 * hello names its UDN, the UPnP device it was.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { FakeSlim } = require("./fake-slim");
const { FakeRenderer, idFor } = require("./fake-renderer");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), SLIM = ports.port(), B = "http://127.0.0.1:" + PORT;
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
const DAC = { attached: true, permission: true, device: "SMSL SU-1", rates: [44100, 48000, 96000, 192000], bits: [16, 24, 32], dsd: [], volume_control: false, fixed: true };

test("a Mandarin Bridge over SlimProto: its DAC read from its own web port, in Updates, each track said", { skip, timeout: 120000 }, async (t) => {
  const web = http.createServer((req, res) => {
    if (req.url === "/dac.json") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ model: "Mandarin Bridge", version: "0.3.0", platform: "android", updates: true, log: "/log", dac: DAC, now: null })); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => web.listen(0, "127.0.0.1", r));
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, slimprotoPort: SLIM });
  await srv.start();
  const bridge = new FakeSlim({ port: SLIM, name: "R7 Bridge", mac: "02:00:00:00:00:77", seconds: 3,
    caps: `Model=mandarinbridge,ModelName=Mandarin Bridge,Firmware=0.3.0,MaxSampleRate=192000,MandarinBridge=${web.address().port},flc,pcm,wav,dsf,dff` });
  t.after(async () => { bridge.close(); await srv.stop(); web.close(); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  await until(async () => (await api("status")).index_count === 3, 30000, "the library");
  await bridge.connect();
  const ID = "SLIM_020000000077";
  const dev = await until(async () => { const d = (await api("audio-devices/" + ID)); return d.caps && d.caps.mandarin && d; }, 15000, "its DAC read");
  assert.equal(dev.caps.mandarin.base, "http://127.0.0.1:" + web.address().port, "where its own web service is");
  assert.equal(dev.manufacturer, "Mandarin");
  assert.deepEqual(dev.rates.filter(r => r.on).map(r => r.hz), DAC.rates, "its DAC's rates, by its word");
  assert.equal(dev.profile.id, "mandarin-usb");
  // Listed in Settings → Updates, under the name it gave (its answer to setd, which may come just after its hello).
  await until(async () => JSON.stringify(await api("update/bridges")).includes("R7 Bridge"), 15000, "listed in Settings → Updates");

  // Played: each track's request says what it is.
  assert.equal((await call("PATCH", "audio-devices/" + ID, { enabled: true })).status, 200);
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === ID), 20000, "the room");
  const album = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");
  assert.equal((await api("play", { offset: album.offset, zone_or_output_id: ID, kind: "play_now" })).status, 200);
  const req = await until(() => bridge.requests[0], 15000, "track 1 asked for");
  assert.match(req, /\r\nX-Mandarin-Title: Song%201\r\n/);
  assert.match(req, /\r\nX-Mandarin-Album: Album%20One\r\n/);
  // A seek fetches the track again from there (item 313): what it is said of it again.
  await until(async () => { const z = (await api("zone-state?zone=" + ID)).zone; return z && z.state === "playing"; }, 15000, "playing");
  await api("seek", { zone_or_output_id: ID, how: "absolute", seconds: 1 });
  const again = await until(() => bridge.requests.find(r => /[?&]ss=1\b/.test(r)), 15000, "the track asked for from 1 s in");
  assert.match(again, /\r\nX-Mandarin-Title: Song%201\r\n/, "its title said after a seek");
});

test("a Bridge that was a UPnP renderer keeps its name and settings over SlimProto", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const usb = new FakeRenderer({ name: "FiiO R7 USB", manufacturer: "Mandarin", model: "Mandarin Bridge", sink: "http-get:*:audio/flac:*", dac: DAC });
  await usb.start();
  const P2 = ports.port(), S2 = ports.port(), B2 = "http://127.0.0.1:" + P2;
  const { createServer } = require("./server");
  const srv = createServer({ port: P2, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpHosts: [usb.location], upnpMulticast: false, identify: false, slimprotoPort: S2 });
  await srv.start();
  const bridge = new FakeSlim({ port: S2, name: "FiiO R7 USB", mac: "02:00:00:00:00:78", seconds: 3,
    caps: `Model=mandarinbridge,ModelName=Mandarin Bridge,Firmware=0.3.0,MaxSampleRate=192000,MandarinBridge=1,UDN=${usb.udn},flc,pcm` });
  t.after(async () => { bridge.close(); await srv.stop(); await usb.stop(); });
  const token = await signIn(B2);
  const call = async (method, p, body) => {
    const r = await fetch(B2 + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const UPNP = idFor(usb.udn), ID = "SLIM_020000000078";
  await until(async () => (await call("GET", "audio-devices")).devices.some(d => d.id === UPNP), 20000, "the UPnP Bridge");
  assert.equal((await call("PATCH", "audio-devices/" + UPNP, { name: "Lounge DAC", enabled: true })).status, 200);
  await usb.stop();
  await bridge.connect();
  const dev = await until(async () => { const d = (await call("GET", "audio-devices")).devices.find(x => x.id === ID); return d && d.name === "Lounge DAC" && d; }, 15000, "its name kept");
  assert.equal(dev.kind, "slim");
  await until(async () => (await call("GET", "zones")).zones.some(z => z.zone_id === ID), 20000, "switched on, as it was");
});

test("a Bridge installed again (a new UDN, so a new id) takes over the device it was: one Bridge, one device", { skip, timeout: 120000 }, async (t) => {
  const web = http.createServer((req, res) => {
    if (req.url === "/dac.json") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ model: "Mandarin Bridge", version: "0.3.0", platform: "android", updates: true, log: "/log", dac: DAC, now: null })); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => web.listen(0, "127.0.0.1", r));
  const lib = makeLibrary();
  const P3 = ports.port(), S3 = ports.port(), B3 = "http://127.0.0.1:" + P3;
  const { createServer } = require("./server");
  const srv = createServer({ port: P3, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, slimprotoPort: S3 });
  await srv.start();
  const hello = (udn) => `Model=mandarinbridge,ModelName=Mandarin Bridge,Firmware=0.3.0,MaxSampleRate=192000,MandarinBridge=${web.address().port},UDN=${udn},flc,pcm`;
  const first = new FakeSlim({ port: S3, name: "FiiO R7 USB", mac: "02:00:00:00:00:79", seconds: 3, caps: hello("uuid:00000000-0000-4000-8000-000000000079") });
  const again = new FakeSlim({ port: S3, name: "QUALCOMM FiiO R7 USB", mac: "02:00:00:00:00:7a", seconds: 3, caps: hello("uuid:00000000-0000-4000-8000-00000000007a") });
  t.after(async () => { first.close(); again.close(); await srv.stop(); web.close(); });
  const token = await signIn(B3);
  const call = async (method, p, body) => {
    const r = await fetch(B3 + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const WAS = "SLIM_020000000079", NOW = "SLIM_02000000007A";
  const list = async () => (await call("GET", "audio-devices")).devices.map(d => d.id).filter(id => id === WAS || id === NOW);
  await first.connect();
  await until(async () => { const d = await call("GET", "audio-devices/" + WAS); return d.caps && d.caps.mandarin; }, 15000, "the Bridge as it was");
  assert.equal((await call("PATCH", "audio-devices/" + WAS, { name: "Lounge DAC", enabled: true })).status, 200);
  // Its app installed again: it goes, and comes back from the same address under a new id.
  first.close();
  await until(async () => !(await call("GET", "audio-devices")).devices.find(d => d.id === WAS).online, 15000, "gone");
  await again.connect();
  await until(async () => JSON.stringify(await list()) === JSON.stringify([NOW]), 15000, "the device it was forgotten");
  const dev = await until(async () => { const d = (await call("GET", "audio-devices")).devices.find(x => x.id === NOW); return d && d.name === "Lounge DAC" && d; }, 15000, "its name kept");
  assert.equal(dev.kind, "slim");
  await until(async () => (await call("GET", "zones")).zones.some(z => z.zone_id === NOW), 20000, "switched on, as it was");
  const rows = (await call("GET", "update/bridges")).bridges;
  assert.deepEqual(rows.map(r => r.id), [NOW], "one row in Settings → Updates");
});
