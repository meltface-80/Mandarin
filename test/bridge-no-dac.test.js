"use strict";
/*
 * Mandarin Bridge for Linux with no DAC plugged in (item 282): told to play, it says why it can't, as the Android app
 * does (STOPPED, ERROR_OCCURRED, "No USB DAC plugged in" on its page), rather than loading for ever; and the track plays
 * by itself once a DAC is plugged in (its card in /proc/asound), from its start.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const ports = require("./ports");
const { haveFfmpeg, gen, FFMPEG } = require("./fixtures");

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
const AVT = "urn:schemas-upnp-org:service:AVTransport:1";
const soap = async (base, action, args) => {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action} xmlns:u="${AVT}"><InstanceID>0</InstanceID>` +
    Object.entries(args || {}).map(([k, v]) => `<${k}>${v}</${k}>`).join("") + `</u:${action}></s:Body></s:Envelope>`;
  return (await fetch(base + "/control/AVTransport", { method: "POST", headers: { "Content-Type": "text/xml", SOAPACTION: `"${AVT}#${action}"` }, body })).text();
};
const field = (xml, name) => (xml.match(new RegExp(`<${name}>([^<]*)</${name}>`)) || [])[1];

test("no DAC: a play refused with its reason, then played once a DAC is plugged in", { skip, timeout: 60000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-bridge-nodac-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const asound = path.join(tmp, "asound");
  fs.mkdirSync(asound);
  const track = path.join(tmp, "tone.flac");
  gen(track, { seconds: 20 });
  const out = path.join(tmp, "dac.raw");
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const p = spawn(BRIDGE, ["--port", String(port), "--data", path.join(tmp, "data"), "--asound", asound, "--device", "file:" + out, "--address", "127.0.0.1",
    "--engine", ENGINE, "--ffmpeg", FFMPEG], { stdio: ["ignore", "ignore", "pipe"] });
  let said = "";
  p.stderr.on("data", d => { said += d; });
  t.after(() => p.kill());
  try {
    await until(async () => (await fetch(base + "/dac.json")).ok);
    await soap(base, "SetAVTransportURI", { CurrentURI: track, CurrentURIMetaData: "" });
    await soap(base, "Play", { Speed: "1" });
    const info = await soap(base, "GetTransportInfo");
    assert.deepEqual([field(info, "CurrentTransportState"), field(info, "CurrentTransportStatus")], ["STOPPED", "ERROR_OCCURRED"], info);
    assert.equal((await (await fetch(base + "/api/state")).json()).status, "No USB DAC plugged in");
    assert.ok(!fs.existsSync(out), "nothing played");

    // A DAC plugged in: the track plays by itself.
    fs.writeFileSync(path.join(asound, "cards"), " 1 [Mojo           ]: USB-Audio - Chord Mojo\n                      Chord Electronics Ltd Chord Mojo at usb-0000:00:14.0-2, high speed\n");
    fs.mkdirSync(path.join(asound, "card1", "pcm0p"), { recursive: true });
    fs.writeFileSync(path.join(asound, "card1", "usbid"), "20b1:301f\n");
    fs.writeFileSync(path.join(asound, "card1", "stream0"), "Playback:\n  Interface 1\n    Altset 1\n    Format: S32_LE\n    Rates: 44100, 48000\n    Bits: 32\n");
    await until(async () => field(await soap(base, "GetTransportInfo"), "CurrentTransportState") === "PLAYING", 20000);
    assert.equal(field(await soap(base, "GetTransportInfo"), "CurrentTransportStatus"), "OK");
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
