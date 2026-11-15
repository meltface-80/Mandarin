"use strict";
/*
 * Every Mandarin Bridge's lines in Mandarin's one log (item 425; Admin/BridgeLogsKept.cs), end to end with Mandarin
 * Bridge for Linux itself (its log kept in rolling files in its data folder, Kept.cs, item 389, the newest lines at
 * /log) and two fake Android ones (BridgeLog.kt's /log, and an older app with none):
 *   - each Bridge's new lines in <data>/Logs/Mandarin_log.txt as "[bridge <its name>]", with the time each was said;
 *   - what is the owner's alone taken out, as from the server's own lines (LogScrub);
 *   - a line taken once, also when the server starts again (where it read to is kept);
 *   - on Mandarin OS (MANDARIN_LOG=journal) the Linux Bridge keeps no files (those from before let go), says each line
 *     on standard error with where it came from, for the box's one log, and names no log for the server to fetch.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
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
  assert.match(own, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} UTC {2}INFO {3}\[http\] listening on \d+$/m, own);
  // Kept on disk too, in its data folder's Logs, the file opening with which Bridge it is (item 389).
  const file = fs.readFileSync(path.join(tmp, "data", "Logs", "MandarinBridge_log.txt"), "utf8");
  assert.match(file, /^# Mandarin Bridge \S+ \(build [^)]+\) log, begun /);
  assert.match(file, /\[http\] listening on \d+$/m);

  // An Android Bridge, its log as Android keeps it, with what is the owner's alone in it; and an older one, with none.
  // Its lines said a minute ago, as logcat dates them (UTC); one from yesterday, before this log, not taken.
  const at = ms => new Date(Date.now() - ms).toISOString().replace("T", " ").slice(0, 23);
  const [t0, t1, t2] = [at(86400000), at(60000), at(59000)];
  const phone = new FakeRenderer({ name: "FiiO R7 USB", manufacturer: "Mandarin", model: "Mandarin Bridge", sink: SINK, dac: Object.assign({}, DAC, {
    log: `${t0}  4242  4250 I UsbDriver: yesterday's line\n` +
      `${t1}  4242  4250 I UsbDriver: opened 96000 Hz, 2 × 32-bit\n` +
      `${t2}  4242  4251 W Updater: asked by owner@example.com with token=abcdef0123456789\n` }) });
  const older = new FakeRenderer({ name: "Old Bridge", manufacturer: "Mandarin", model: "Mandarin Bridge", sink: SINK, dac: DAC });
  await phone.start(); await older.start();
  t.after(() => phone.stop()); t.after(() => older.stop());

  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  t.after(() => house.stop());
  const { createServer } = require("./server");
  const opts = { port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpHosts: [phone.location, older.location], upnpMulticast: false, slimprotoPort: SLIM, bridgeLogsEvery: 1 };
  let srv = createServer(opts);
  await srv.start();
  t.after(() => srv.stop());
  const auth = { Authorization: "Bearer " + await signIn(B) };
  const log = () => { try { return fs.readFileSync(path.join(lib.data, "Logs", "Mandarin_log.txt"), "utf8"); } catch (e) { return ""; } };
  const count = (re) => (log().match(re) || []).length;
  const re = x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Each Bridge's lines under its name, with the time it said each, without being asked.
  await until(() => /\[http\] listening on/.test(log()) && /UsbDriver: opened/.test(log()), 30000);
  assert.match(log(), new RegExp(`^\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d\\.\\d{3} UTC {2}INFO {3}\\[bridge ${re(dac.name)}\\] \\[http\\] listening on \\d+$`, "m"), log());
  assert.match(log(), new RegExp(`^${t1} UTC {2}INFO {3}\\[bridge FiiO R7 USB\\] UsbDriver: opened 96000 Hz, 2 × 32-bit$`, "m"), log());
  // The owner's alone taken out: the email and the token.
  assert.match(log(), new RegExp(`^${t2} UTC {2}WARN {3}\\[bridge FiiO R7 USB\\] Updater: asked by \\[email\\] with token=\\[…\\]$`, "m"), log());
  assert.ok(!log().includes("owner@example.com") && !log().includes("abcdef0123456789"), log());
  // What it said before this log began isn't carried into it; an older app keeps none for Mandarin.
  assert.ok(!log().includes("yesterday's line"), log());
  assert.ok(!log().includes("[bridge Old Bridge]"), log());
  // What an older app doesn't say is nothing, never "undefined": on Settings → Updates too.
  const rows = (await (await fetch(B + "/api/update/bridges", { headers: auth })).json()).bridges;
  assert.deepEqual(rows.filter(r => r.name !== dac.name).map(r => [r.name, r.platform, r.version, r.commit]).sort(),
    [["FiiO R7 USB", "android", "0.2.0", null], ["Old Bridge", "android", "0.2.0", null]]);
  // Asked again and again, and the server started again: a line taken once.
  await sleep(2500);
  await srv.stop();
  srv = createServer(opts);
  await srv.start();
  await until(() => count(/\[server\] \[start\] Mandarin Server /g) === 2, 20000);
  await sleep(3000);
  assert.equal(count(/UsbDriver: opened/g), 1, log());
  assert.equal(count(new RegExp(`\\[bridge ${re(dac.name)}\\] \\[http\\] listening on`, "g")), 1, log());

});

test("on Mandarin OS the Linux Bridge keeps no files and says each line with where it came from", { skip, timeout: 60000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-bridge-journal-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const data = path.join(tmp, "data");
  // Its files from before.
  fs.mkdirSync(path.join(data, "Logs"), { recursive: true });
  fs.writeFileSync(path.join(data, "Logs", "MandarinBridge_log.txt"), "# Mandarin Bridge 0.3.13 log\n");
  fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ name: "Kitchen [box]", udn: "uuid:00000425-0000-4000-8000-000000000425" }));
  fs.mkdirSync(path.join(tmp, "asound"));
  fs.writeFileSync(path.join(tmp, "asound", "cards"), "");
  const port = ports.port();
  const b = spawn(BRIDGE, ["--port", String(port), "--data", data, "--asound", path.join(tmp, "asound"), "--address", "127.0.0.1", "--engine", ENGINE, "--ffmpeg", FFMPEG],
    { stdio: ["ignore", "ignore", "pipe"], env: Object.assign({}, process.env, { MANDARIN_LOG: "journal" }) });
  let said = "";
  b.stderr.on("data", d => { said += d; });
  t.after(() => b.kill());
  const dac = await until(async () => (await fetch(`http://127.0.0.1:${port}/dac.json`)).json(), 15000);
  assert.equal(dac.name, "Kitchen [box]");
  assert.ok(dac.log == null, "no log named for the server to fetch: " + dac.log);
  await until(() => /\[http\] listening on/.test(said), 10000);
  assert.match(said, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} UTC {2}INFO {3}\[bridge Kitchen \(box\)\] \[http\] listening on \d+$/m, said);
  assert.ok(!fs.existsSync(path.join(data, "Logs")), "its files from before let go, none kept");
});
