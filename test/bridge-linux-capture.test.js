"use strict";
/*
 * Mandarin Bridge for Linux records what it feeds the DAC (item 412), so SQ-tool's bit-perfect check works with it:
 * the Bridge started on a computer whose one USB DAC is an SMSL SU-1 (its /proc/asound written here), the audio
 * engine under it writing to a file in place of the DAC, played to by Mandarin's own server over SlimProto.
 *
 *   - /dac.json says it records ("capture", "capture_parts"); its /capture answers as the Android Bridge's does: a
 *     recording asked for is armed, a second refused while it runs, one stopped is let go; nothing but JSON starts one;
 *   - asked by Mandarin for the track playing (the server's check, BitPerfect/Check.cs, unchanged), the Bridge records
 *     the whole track from the restart, in parts each fetched and let go: bit-perfect, every sample, the DAC fed
 *     PCM in the engine's 32-bit words; nothing is left in its data folder after;
 *   - the same Bridge with an engine that alters what it plays (its gain at one half: a stand-in engine that says so to
 *     the real one): not bit-perfect, 6 dB down.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const ports = require("./ports");
const { haveFfmpeg, makeLibrary, FFMPEG } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");

const ROOT = path.join(__dirname, "..");
const BRIDGE = path.join(ROOT, "bridge", "linux", "bin", "mandarin-bridge");
const ENGINE = path.join(ROOT, "engine", "bin", "mandarin-audio");
const built = fs.existsSync(BRIDGE) && fs.existsSync(ENGINE);
const skip = !haveFfmpeg() ? "ffmpeg is not installed" : !built && !process.env.CI && "bridge/linux/build.sh and engine/build.sh not run";
const PORT = ports.port(), BRIDGE_PORT = ports.port(), SLIM = ports.port();
const B = "http://127.0.0.1:" + PORT, BR = "http://127.0.0.1:" + BRIDGE_PORT;
// Its SlimProto id: six bytes from its UDN, locally administered (Slim.cs).
const slimId = udn => { const h = crypto.createHash("sha256").update(udn).digest().subarray(0, 6); h[0] = (h[0] & 0xfc) | 0x02; return "SLIM_" + h.toString("hex").toUpperCase(); };
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

// A computer with an SMSL SU-1 on its USB port, as the kernel lists it.
function asound(root) {
  const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); };
  w("cards", " 0 [SU1            ]: USB-Audio - SMSL USB AUDIO\n                      SMSL SMSL USB AUDIO at usb-0000:00:14.0-1, high speed\n");
  w("card0/usbid", "152a:85de\n");
  w("card0/pcm0p/info", "name: USB Audio\n");
  w("card0/stream0", ["SMSL SMSL USB AUDIO at usb-0000:00:14.0-1, high speed : USB Audio", "", "Playback:", "  Status: Stop",
    "  Interface 1", "    Altset 1", "    Format: S32_LE", "    Channels: 2", "    Endpoint: 0x01 (1 OUT) (ASYNC)",
    "    Rates: 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000", "    Bits: 32", ""].join("\n"));
}

test("Mandarin Bridge for Linux records what it feeds the DAC: SQ-tool's check says bit-perfect, and not when the engine alters it", { skip, timeout: 240000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-bridge-capture-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  asound(path.join(tmp, "asound"));
  const data = path.join(tmp, "data");
  let said = "";
  const bridges = [];
  t.after(() => bridges.forEach(b => b.kill()));
  const start = (engine) => {
    const b = spawn(BRIDGE, ["--port", String(BRIDGE_PORT), "--data", data, "--asound", path.join(tmp, "asound"), "--device", "file:" + path.join(tmp, "dac.raw"),
      "--address", "127.0.0.1", "--engine", engine, "--ffmpeg", FFMPEG, "--server", "127.0.0.1:" + SLIM, "--sys", path.join(tmp, "sys")], { stdio: ["ignore", "ignore", "pipe"] });
    b.stderr.on("data", d => { said += d; });
    bridges.push(b);
    return b;
  };
  const stop = (b) => new Promise(r => { if (b.exitCode !== null) return r(); b.once("exit", r); b.kill(); });
  let bridge = start(ENGINE);
  const dac = await until(async () => (await fetch(BR + "/dac.json")).json(), 15000);
  const cap = (method, body, headers) => fetch(BR + "/capture", body === undefined ? { method } : { method, headers: Object.assign({ "Content-Type": "application/json" }, headers), body });
  try {
    // It says it records, as the Android Bridge does, whole tracks in parts.
    assert.deepEqual([dac.platform, dac.capture, dac.capture_parts], ["linux", "/capture", true], JSON.stringify(dac));

    // Its /capture: armed when asked; a second refused while it runs; stopped, let go; nothing but JSON starts one.
    await until(async () => (await (await fetch(BR + "/api/state")).json()).dac_json.dac.attached);
    let r = await until(async () => { const x = await cap("POST", JSON.stringify({ seconds: 5 })); return x.status === 202 && x; }, 15000);
    let st = await r.json();
    assert.deepEqual([st.state, st.seconds, st.part_seconds], ["armed", 5, 0], JSON.stringify(st));
    r = await cap("POST", JSON.stringify({ seconds: 5 }));
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /a capture is running/);
    assert.equal((await (await cap("DELETE")).json()).state, "idle");
    assert.equal((await cap("POST", JSON.stringify({ seconds: 5 }), { "Content-Type": "text/plain" })).status, 403, "a plain form's POST refused");
    assert.equal((await (await fetch(BR + "/capture")).json()).state, "idle");
    assert.equal((await fetch(BR + "/capture/1.wav")).status, 404);

    // Mandarin, playing to it.
    const lib = makeLibrary();
    const house = new FakeHousehold();
    await house.start();
    t.after(() => house.stop());
    const { createServer } = require("./server");
    const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)], upnpMulticast: false, slimprotoPort: SLIM });
    await srv.start();
    t.after(() => srv.stop());
    const auth = { Authorization: "Bearer " + await signIn(B) };
    const api = async (p, body, method) => {
      const x = await fetch(B + "/api/" + p, body || method ? { method: method || "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify(body || {}) } : { headers: auth });
      return { status: x.status, ...await x.json().catch(() => ({})) };
    };
    const ID = slimId(dac.udn);
    await until(async () => (await api("status")).index_count >= 3);
    await until(async () => (await api("audio-devices")).devices.find(x => x.id === ID));
    assert.equal((await api("audio-devices/" + ID, { enabled: true }, "PATCH")).status, 200);
    await until(async () => (await api("zones")).zones.some(z => z.zone_id === ID));
    const one = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");
    const playing = async () => {
      assert.equal((await api("play", { offset: one.offset, zone_or_output_id: ID, kind: "play_now" })).ok, true);
      await until(async () => { const z = (await api("zone-state?zone=" + ID)).zone; return z && z.state === "playing" && z.now_playing && z.now_playing.line1 === "Song 1"; }, 30000);
    };
    const checked = async () => {
      const x = await api("bitperfect", { zone_or_output_id: ID });
      assert.equal(x.status, 200, JSON.stringify(x));
      return until(async () => { const c = await api("bitperfect?zone=" + ID); return c.state === "done" || c.state === "failed" ? c : null; }, 90000);
    };

    // The check, as SQ-tool's page asks it: the whole track recorded from its restart, compared sample by sample.
    await playing();
    let c = await checked();
    assert.equal(c.state, "done", JSON.stringify(c));
    assert.equal(c.report.verdict, "bit-perfect", JSON.stringify(c.report));
    assert.ok(c.report.coverage >= 0.995, JSON.stringify(c.report));
    assert.deepEqual(c.report.unrecorded, []);
    assert.match(c.report.says, /^Bit-perfect: every sample of the track reached the DAC exactly as it was sent$/);
    assert.deepEqual([c.report.fed.kind, c.report.fed.rate, c.report.fed.container_bits, c.report.fed.device.device], ["pcm", 44100, 32, "SMSL USB AUDIO"], JSON.stringify(c.report.fed));
    // Each part fetched and let go: nothing of it left in the Bridge's data folder.
    st = await (await fetch(BR + "/capture")).json();
    assert.deepEqual(st.parts, [], JSON.stringify(st));
    const left = fs.existsSync(path.join(data, "capture")) ? fs.readdirSync(path.join(data, "capture")).filter(f => f.endsWith(".wav")) : [];
    assert.deepEqual(left, [], "every part let go");

    // The same Bridge, its engine altering what it plays (the gain the Bridge gives it, 1, made a half): not bit-perfect, by how much.
    const halved = path.join(tmp, "halved-engine.sh");
    fs.writeFileSync(halved, `#!/bin/sh\nsed -u 's/{"cmd":"gain","value":1}/{"cmd":"gain","value":0.5}/' | "${ENGINE}" "$@"\n`, { mode: 0o755 });
    await stop(bridge);
    bridge = start(halved);
    await until(async () => (await fetch(BR + "/dac.json")).ok, 15000);
    await until(async () => (await api("zones")).zones.some(z => z.zone_id === ID), 30000);
    await until(async () => (await (await fetch(BR + "/api/state")).json()).mandarin, 30000);
    await playing();
    c = await checked();
    assert.equal(c.report.verdict, "not-bit-perfect", JSON.stringify(c.report));
    assert.ok(Math.abs(c.report.level_db + 6.02) < 0.1, JSON.stringify(c.report));
  } catch (e) { console.log(said); throw e; }
});
