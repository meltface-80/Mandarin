"use strict";
/*
 * Each Mandarin Bridge's own log in Mandarin's (item 291, Admin/BridgeLogs.cs: GET /api/diagnostics/bridges, which the
 * Android app's Save log adds after the server's), end to end with Mandarin Bridge for Linux itself (its last lines
 * kept, Kept.cs, at /log) and two fake Android ones (BridgeLog.kt's /log, and an older app with none):
 *   - every Bridge under its name, its platform, version and build, then its lines;
 *   - what is the owner's alone taken out, as from the server's own lines (LogScrub);
 *   - an older Bridge, and one not answering, said so; nothing without signing in.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const ports = require("./ports");
const { haveFfmpeg, makeLibrary, FFMPEG } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { FakeRenderer } = require("./fake-renderer");
const { signIn } = require("./auth-helper");

const ROOT = path.join(__dirname, "..");
const BRIDGE = path.join(ROOT, "bridge", "linux", "bin", "mandarin-bridge");
const ENGINE = path.join(ROOT, "engine", "bin", "mandarin-audio");
const built = fs.existsSync(BRIDGE) && fs.existsSync(ENGINE);
const skip = !haveFfmpeg() ? "ffmpeg is not installed" : !built && !process.env.CI && "bridge/linux/build.sh and engine/build.sh not run";
const PORT = ports.port(), BRIDGE_PORT = ports.port(), SLIM = ports.port();
const B = "http://127.0.0.1:" + PORT, BR = "http://127.0.0.1:" + BRIDGE_PORT;
const SINK = "http-get:*:audio/flac:*,http-get:*:audio/wav:*";
const DAC = { device: "FiiO K11", rates: [44100, 96000], bits: [16, 24, 32], dsd: [], volume_control: false, fixed: true };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(150);
  }
}

test("every Mandarin Bridge's own log, in Mandarin's", { skip, timeout: 120000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-bridge-logs-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // A Chord Mojo on its USB port, as the kernel lists it.
  const w = (f, x) => { fs.mkdirSync(path.dirname(path.join(tmp, "asound", f)), { recursive: true }); fs.writeFileSync(path.join(tmp, "asound", f), x); };
  w("cards", " 1 [Mojo           ]: USB-Audio - Chord Mojo\n                      Chord Electronics Ltd Chord Mojo at usb-0000:00:14.0-2, high speed\n");
  w("card1/usbid", "20b1:301f\n");
  w("card1/pcm0p/info", "name: USB Audio\n");
  w("card1/stream0", ["Chord Electronics Ltd Chord Mojo at usb-0000:00:14.0-2, high speed : USB Audio", "", "Playback:", "  Status: Stop",
    "  Interface 1", "    Altset 1", "    Format: S32_LE", "    Channels: 2", "    Endpoint: 0x01 (1 OUT) (ASYNC)", "    Rates: 44100, 96000", "    Bits: 32", ""].join("\n"));

  // Mandarin Bridge for Linux, its log its own lines since it started.
  const linux = spawn(BRIDGE, ["--port", String(BRIDGE_PORT), "--data", path.join(tmp, "data"), "--asound", path.join(tmp, "asound"),
    "--device", "file:" + path.join(tmp, "dac.raw"), "--address", "127.0.0.1", "--engine", ENGINE, "--ffmpeg", FFMPEG, "--server", "127.0.0.1:" + SLIM], { stdio: ["ignore", "ignore", "pipe"] });
  linux.stderr.resume();
  t.after(() => linux.kill());
  const dac = await until(async () => (await fetch(BR + "/dac.json")).json(), 15000);
  assert.equal(dac.log, "/log");
  const own = await (await fetch(BR + "/log")).text();
  assert.match(own, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d \[http\] listening on \d+$/m, own);
  const commit = spawnSync(BRIDGE, ["--version"]).stdout.toString().match(/\(([^)]+)\)/)[1];

  // An Android Bridge, its log as Android keeps it, with what is the owner's alone in it; and an older one, with none.
  const phone = new FakeRenderer({ name: "FiiO R7 USB", manufacturer: "Mandarin", model: "Mandarin Bridge", sink: SINK, dac: Object.assign({}, DAC, {
    log: "2026-11-05 09:00:01.000  4242  4250 I UsbDriver: opened 96000 Hz, 2 × 32-bit\n" +
      "2026-11-05 09:00:02.000  4242  4251 W Updater: asked by owner@example.com with token=abcdef0123456789\n" }) });
  const older = new FakeRenderer({ name: "Old Bridge", manufacturer: "Mandarin", model: "Mandarin Bridge", sink: SINK, dac: DAC });
  await phone.start(); await older.start();
  t.after(() => phone.stop()); t.after(() => older.stop());

  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  t.after(() => house.stop());
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpHosts: [phone.location, older.location], upnpMulticast: false, slimprotoPort: SLIM });
  await srv.start();
  t.after(() => srv.stop());
  const auth = { Authorization: "Bearer " + await signIn(B) };
  const logs = async () => (await fetch(B + "/api/diagnostics/bridges", { headers: auth })).text();

  const text = await until(async () => { const s = await logs(); return (s.match(/^— Mandarin Bridge: /gm) || []).length === 3 && s; }, 30000);
  // Each under its name, what it is, then its lines.
  const re = x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(text, new RegExp(`^— Mandarin Bridge: ${re(dac.name)} \\(linux ${re(dac.version)}, build ${commit}\\) —\\n(.+\\n)*.*\\[http\\] listening on`, "m"), text);
  assert.match(text, /^— Mandarin Bridge: FiiO R7 USB \(android 0\.2\.0\) —\n2026-11-05 09:00:01\.000 .*UsbDriver: opened 96000 Hz/m, text);
  // The owner's alone taken out: the email and the token.
  assert.match(text, /Updater: asked by \[email\] with token=\[…\]$/m, text);
  assert.ok(!text.includes("owner@example.com") && !text.includes("abcdef0123456789"), text);
  // An older app keeps none for Mandarin; one that has gone isn't answering.
  assert.match(text, /^— Mandarin Bridge: Old Bridge \(android 0\.2\.0\) —\n\(its app is older and keeps no log for Mandarin\)$/m, text);
  // What an older app doesn't say is nothing, never "undefined": on Settings → Updates too.
  assert.ok(!text.includes("undefined"), text);
  const rows = (await (await fetch(B + "/api/update/bridges", { headers: auth })).json()).bridges;
  assert.deepEqual(rows.filter(r => r.name !== dac.name).map(r => [r.name, r.platform, r.version, r.commit]).sort(),
    [["FiiO R7 USB", "android", "0.2.0", null], ["Old Bridge", "android", "0.2.0", null]]);
  await older.stop();
  assert.match(await until(async () => { const s = await logs(); return /Old Bridge —\n\(it isn't answering/.test(s) && s; }, 15000),
    /^— Mandarin Bridge: Old Bridge —\n\(it isn't answering: its log isn't here\)$/m);

  // Not signed in: nothing.
  assert.equal((await fetch(B + "/api/diagnostics/bridges")).status, 401);
});
