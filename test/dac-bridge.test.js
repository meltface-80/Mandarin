"use strict";
/*
 * dac-bridge.test.js — a USB DAC on a Mac (v0.9.0). Mandarin's audio engine
 * plays through ALSA, so a Mac's own sound devices are counted and not
 * offered; Audio Devices points to Mandarin DAC Bridge
 * (github.com/meltface-80/Mandarin-DAC-Bridge), which holds each DAC and
 * offers it as a UPnP renderer, "<DAC> (Bridge)".
 *
 * The last test plays to the bridge itself, end to end: its fake DAC (played
 * by the clock) and Mandarin's queue on it. CI builds the bridge at the
 * version .github/workflows/ci.yml names and gives it as
 * MANDARIN_DAC_BRIDGE_BIN; elsewhere that test says it isn't built here.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { haveFfmpeg, makeLibrary, FFMPEG } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { createServer, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const noBrowser = skip || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const BRIDGE = process.env.MANDARIN_DAC_BRIDGE_BIN || "";
const noBridge = skip || (!BRIDGE && !process.env.CI && "Mandarin DAC Bridge isn't built here (MANDARIN_DAC_BRIDGE_BIN; CI builds it)");

async function until(fn, ms = 30000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await new Promise(r => setTimeout(r, 100));
  }
}

// A Mac's USB DAC, as system_profiler lists it (Local/LocalDevices.cs ParseMac).
const MAC_DAC = { id: "LOCAL_mac_topping", kind: "local", family: "local", network_name: "Topping E30", manufacturer: "Topping", model: "USB audio",
  location: "coreaudio:Topping E30", playable: true, caps: { advertised: { containers: ["flac"], rates: [44100, 96000], bits: [16, 24, 32] } } };

async function onAMac() {
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    localDevices: { devices: [MAC_DAC], platform: "darwin", hidden: 0 } });
  await srv.start();
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token };
  return { B, H, srv, token };
}

test("a Mac's own sound devices are counted, not offered: they play through Mandarin DAC Bridge (v0.9.0)", { skip, timeout: 120000 }, async (t) => {
  const { B, H, srv } = await onAMac();
  t.after(() => srv.stop());
  const j = await until(async () => { const r = await (await fetch(B + "/api/audio-devices", { headers: H })).json(); return r.local && r.local.mac === 1 && r; }, 30000, "the Mac's devices counted");
  assert.deepEqual([j.local.platform, j.local.count, j.local.mac], ["darwin", 0, 1]);
  assert.ok(!j.devices.some(d => d.id === MAC_DAC.id || d.kind === "local"), "not offered: " + JSON.stringify(j.devices.map(d => d.name)));
  assert.ok(!(await (await fetch(B + "/api/zones", { headers: H })).json()).zones.some(z => z.zone_id === MAC_DAC.id), "nor a zone");
});

test("Audio Devices on a Mac points to Mandarin DAC Bridge (v0.9.0)", { skip: noBrowser, timeout: 120000 }, async (t) => {
  const { B, H, srv, token } = await onAMac();
  t.after(() => srv.stop());
  await until(async () => (await (await fetch(B + "/api/audio-devices", { headers: H })).json()).local?.mac === 1, 30000, "the Mac's devices counted");
  await until(async () => (await (await fetch(B + "/api/status", { headers: H })).json()).index_count === 3, 60000, "the library");
  const b = await Browser.launch({ width: 390, height: 844 });
  t.after(() => b.close());
  const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
  const r = await page.eval(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const until = async (f, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(50); } };
    await until(() => document.querySelector("#home-random .album, #home-today .album"));
    document.getElementById("settings-toggle").click(); await sleep(400);
    document.querySelector('.settings-nav-item[data-pane="playback"]').click();
    const a = await until(() => document.getElementById("devices-bridge"));
    return a && { href: a.href, note: a.closest(".settings-note").textContent };
  })()`);
  assert.ok(r, "the note with its link");
  assert.equal(r.href, "https://github.com/meltface-80/Mandarin-DAC-Bridge#install-on-a-mac");
  assert.match(r.note, /USB DAC .* Mac .* Mandarin DAC Bridge\. Each DAC then shows here as “… \(Bridge\)”\./);
});

test("end to end: an album played through Mandarin DAC Bridge's DAC, track after track, with Mandarin owning it (v0.9.0)", { skip: noBridge, timeout: 180000 }, async (t) => {
  assert.ok(BRIDGE, "MANDARIN_DAC_BRIDGE_BIN, the bridge CI builds (.github/workflows/ci.yml)");
  const lib = makeLibrary();
  const MPORT = ports.port(), BPORT = ports.port(), BB = "http://127.0.0.1:" + BPORT;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "dac-bridge-"));
  // The bridge's fake DAC, played by the clock (BRIDGE_TEST_SINK), told Mandarin's port so it knows its streams.
  const bridge = spawn(BRIDGE, [], { stdio: ["ignore", "pipe", "pipe"], env: Object.assign({}, process.env, {
    PORT: String(BPORT), DATA_DIR: data, BRIDGE_IP: "127.0.0.1", MANDARIN_PORT: String(MPORT), FFMPEG,
    BRIDGE_TEST_SINK: "fake", BRIDGE_TEST_DEVICES: JSON.stringify([{ key: "mojo", name: "Mojo", spec: "mojo", rates: [44100, 48000, 96000], bits: [16, 24, 32], channels: 2 }]) }) });
  let said = "";
  bridge.stdout.on("data", d => { said += d; });
  bridge.stderr.on("data", d => { said += d; });
  t.after(() => { bridge.kill(); });
  const dacs = async () => (await (await fetch(BB + "/api/dacs")).json()).dacs || [];
  const dac = await until(async () => (await dacs())[0], 30000, "the bridge's DAC (it said: " + said.slice(-400) + ")");
  // Mandarin, given the DAC's description as a renderer's address (UPNP_HOSTS), as SSDP would find it.
  const srv = createServer({ port: MPORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    upnpHosts: BB + "/upnp/" + dac.id + "/description.xml" });
  await srv.start();
  t.after(() => srv.stop());
  const B = "http://127.0.0.1:" + MPORT;
  const token = await signIn(B);
  const api = async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  await until(async () => (await api("GET", "/api/status")).json.index_count === 3, 60000, "the library");
  // "Mojo (Bridge)": found, switched on, a zone.
  const dev = await until(async () => (await api("GET", "/api/audio-devices")).json.devices.find(d => / \(Bridge\)$/.test(d.name)), 30000, "the bridge's DAC in Audio Devices");
  assert.equal(dev.name, "Mojo (Bridge)");
  assert.equal((await api("PATCH", "/api/audio-devices/" + dev.id, { enabled: true })).status, 200);
  await until(async () => (await api("GET", "/api/zones")).json.zones.find(z => z.zone_id === dev.id), 30000, "the DAC as a zone");
  // Album One played: the DAC plays its first track, then the next by itself, Mandarin owning it.
  const cd = (await api("GET", "/api/library/albums?sort=album")).json.albums.find(a => a.title === "Album One");
  const play = await api("POST", "/api/play", { offset: cd.offset, zone_or_output_id: dev.id, kind: "play_now" });
  assert.equal(play.status, 200, JSON.stringify(play.json));
  const first = await until(async () => { const d = (await dacs())[0]; return d.player && /PLAYING/i.test(d.player.transport) && d.player.title === "Song 1" && d; }, 30000, "Song 1 on the DAC");
  assert.equal(first.control.owner, "Mandarin", "Mandarin owns the DAC while it plays: " + JSON.stringify(first.control));
  await until(async () => { const d = (await dacs())[0]; return d.player && d.player.title === "Song 2"; }, 30000, "Song 2 on the DAC, by itself");
  const z = await until(async () => { const s = (await api("GET", "/api/zone-state?zone=" + dev.id)).json.zone; return s && s.state === "playing" && s.now_playing && s.now_playing.line1 === "Song 2" && s; }, 30000, "Mandarin showing Song 2");
  assert.equal(z.now_playing.line1, "Song 2");
});
