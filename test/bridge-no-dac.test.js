"use strict";
/*
 * Mandarin Bridge for Linux with no DAC plugged in (item 282): told to play (over SlimProto, item 316: a stand-in
 * server here, test/fake-slim-server.js), it says it couldn't (STMn), as the Android app does, with "No USB DAC plugged
 * in" on its page, rather than loading for ever; and the track plays by itself once a DAC is plugged in (its card in
 * /proc/asound), from its start: begun (STMs).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const ports = require("./ports");
const http = require("http");
const { haveFfmpeg, gen, FFMPEG } = require("./fixtures");
const { FakeSlimServer } = require("./fake-slim-server");

const ROOT = path.join(__dirname, "..");
const BRIDGE = path.join(ROOT, "bridge", "linux", "bin", "mandarin-bridge");
const ENGINE = path.join(ROOT, "engine", "bin", "mandarin-audio");
const skip = !haveFfmpeg() ? "ffmpeg is not installed" : !(fs.existsSync(BRIDGE) && fs.existsSync(ENGINE)) && !process.env.CI && "bridge/linux/build.sh and engine/build.sh not run";
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(100);
  }
}
test("no DAC: a play refused with its reason, then played once a DAC is plugged in", { skip, timeout: 60000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-bridge-nodac-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const asound = path.join(tmp, "asound");
  fs.mkdirSync(asound);
  const track = path.join(tmp, "tone.flac");
  gen(track, { seconds: 20 });
  const out = path.join(tmp, "dac.raw");
  const files = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "audio/flac" }); fs.createReadStream(track).pipe(res); });
  await new Promise(r => files.listen(0, "127.0.0.1", r));
  t.after(() => files.close());
  const mandarin = new FakeSlimServer();
  await mandarin.start();
  t.after(() => mandarin.close());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const p = spawn(BRIDGE, ["--port", String(port), "--data", path.join(tmp, "data"), "--asound", asound, "--device", "file:" + out, "--address", "127.0.0.1",
    "--engine", ENGINE, "--ffmpeg", FFMPEG, "--server", "127.0.0.1:" + mandarin.port], { stdio: ["ignore", "ignore", "pipe"] });
  let said = "";
  p.stderr.on("data", d => { said += d; });
  t.after(() => p.kill());
  try {
    await until(async () => (await fetch(base + "/dac.json")).ok);
    await until(() => mandarin.heard.some(h => h.op === "HELO"), 15000);
    mandarin.strm("s", { port: files.address().port, path: "/tone.flac", autostart: "1" });
    await until(() => mandarin.events().includes("STMn"));
    assert.ok(!mandarin.events().includes("STMs"), "not begun");
    assert.equal((await (await fetch(base + "/dac.json")).json()).now, null);
    assert.equal((await (await fetch(base + "/api/state")).json()).status, "No USB DAC plugged in");
    assert.ok(!fs.existsSync(out), "nothing played");

    // A DAC plugged in: the track plays by itself.
    fs.writeFileSync(path.join(asound, "cards"), " 1 [Mojo           ]: USB-Audio - Chord Mojo\n                      Chord Electronics Ltd Chord Mojo at usb-0000:00:14.0-2, high speed\n");
    fs.mkdirSync(path.join(asound, "card1", "pcm0p"), { recursive: true });
    fs.writeFileSync(path.join(asound, "card1", "usbid"), "20b1:301f\n");
    fs.writeFileSync(path.join(asound, "card1", "stream0"), "Playback:\n  Interface 1\n    Altset 1\n    Format: S32_LE\n    Rates: 44100, 48000\n    Bits: 32\n");
    await until(() => mandarin.events().includes("STMs"), 20000);
    await until(async () => /^Playing/.test((await (await fetch(base + "/api/state")).json()).status), 10000);
    await until(() => fs.existsSync(out) && fs.statSync(out).size > 44100 * 8);
  } catch (e) { console.log(said); throw e; }
});

// The address the system reaches the world from (its default route), asked as the Bridge asks it: a UDP "connect", nothing sent.
function routeAddress() {
  return new Promise((resolve) => {
    const s = require("dgram").createSocket("udp4");
    s.on("error", () => { s.close(); resolve(null); });
    s.connect(9, "192.0.2.1", () => { const a = s.address().address; s.close(); resolve(a); });
  });
}

test("the address it says it is at is the one it reaches the home network by, never a Docker or VPN bridge's", { skip, timeout: 30000 }, async (t) => {
  const route = await routeAddress();
  if (!route) { t.skip("this machine has no default route"); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-bridge-addr-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const port = ports.port();
  const p = spawn(BRIDGE, ["--port", String(port), "--data", path.join(tmp, "data"), "--asound", path.join(tmp, "none"), "--engine", ENGINE], { stdio: "ignore" });
  t.after(() => p.kill());
  const state = await until(async () => (await fetch("http://127.0.0.1:" + port + "/api/state")).json());
  assert.equal(state.address, "http://" + route + ":" + port);
});
