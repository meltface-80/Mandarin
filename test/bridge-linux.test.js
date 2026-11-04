"use strict";
/*
 * Mandarin Bridge for Linux (bridge/linux, item 282), end to end: the Bridge started on a computer whose one USB DAC
 * is a Mojo (its /proc/asound written here: PCM to 384 kHz in 32 bits, native DSD to DSD256), played to by
 * Mandarin's own server over UPnP. Mandarin finds it, reads its DAC whole from /dac.json (every rate, the depths,
 * DSD), plays an album to it, and confirms what the DAC is fed; the audio engine under the Bridge writes the
 * samples (here, to a file in place of the DAC) exactly as the track's own. Its web page says what it plays, and a
 * name set there is the name Mandarin knows it by.
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
const { idFor } = require("./fake-renderer");
const { signIn } = require("./auth-helper");

const ROOT = path.join(__dirname, "..");
const BRIDGE = path.join(ROOT, "bridge", "linux", "bin", "mandarin-bridge");
const ENGINE = path.join(ROOT, "engine", "bin", "mandarin-audio");
const built = fs.existsSync(BRIDGE) && fs.existsSync(ENGINE);
const skip = !haveFfmpeg() ? "ffmpeg is not installed" : !built && !process.env.CI && "bridge/linux/build.sh and engine/build.sh not run";
const PORT = ports.port(), BRIDGE_PORT = ports.port();
const B = "http://127.0.0.1:" + PORT, BR = "http://127.0.0.1:" + BRIDGE_PORT;
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

// A computer with a Chord Mojo on its USB port, as the kernel lists it.
function asound(root) {
  const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); };
  w("cards", " 0 [PCH            ]: HDA-Intel - HDA Intel PCH\n                      HDA Intel PCH at 0xf7f10000 irq 32\n" +
    " 1 [Mojo           ]: USB-Audio - Chord Mojo\n                      Chord Electronics Ltd Chord Mojo at usb-0000:00:14.0-2, high speed\n");
  w("card0/pcm0p/info", "name: ALC892 Analog\n");
  w("card1/usbid", "20b1:301f\n");
  w("card1/pcm0p/info", "name: USB Audio\n");
  w("card1/stream0", ["Chord Electronics Ltd Chord Mojo at usb-0000:00:14.0-2, high speed : USB Audio", "", "Playback:", "  Status: Stop",
    "  Interface 1", "    Altset 1", "    Format: S32_LE", "    Channels: 2", "    Endpoint: 0x01 (1 OUT) (ASYNC)", "    Rates: 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000", "    Bits: 32",
    "  Interface 1", "    Altset 2", "    Format: DSD_U32_BE", "    Channels: 2", "    Rates: 88200, 176400, 352800", "    Bits: 32", ""].join("\n"));
}

test("Mandarin Bridge for Linux: found, its DAC read whole, played to bit-perfect, set up from its own page", { skip, timeout: 180000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-bridge-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  asound(path.join(tmp, "asound"));
  const out = path.join(tmp, "dac.raw");
  const bridge = spawn(BRIDGE, ["--port", String(BRIDGE_PORT), "--data", path.join(tmp, "data"), "--asound", path.join(tmp, "asound"), "--device", "file:" + out,
    "--address", "127.0.0.1", "--engine", ENGINE, "--ffmpeg", FFMPEG], { stdio: ["ignore", "ignore", "pipe"] });
  let said = "";
  bridge.stderr.on("data", d => { said += d; });
  t.after(() => bridge.kill());
  const dac = await until(async () => (await fetch(BR + "/dac.json")).json(), 15000);
  assert.equal(dac.model, "Mandarin Bridge");
  assert.equal(dac.platform, "linux");
  assert.deepEqual([dac.dac.device, dac.dac.rates, dac.dac.bits, dac.dac.dsd_native, dac.dac.dsd_dop, dac.dac.dsd],
    ["Chord Mojo", [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000], [16, 24, 32], [64, 128, 256], [64, 128], [64, 128, 256]], JSON.stringify(dac));
  assert.match(await (await fetch(BR + "/")).text(), /Mandarin Bridge/);

  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  t.after(() => house.stop());
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpHosts: [BR + "/description.xml"], upnpMulticast: false });
  await srv.start();
  t.after(() => srv.stop());
  const auth = { Authorization: "Bearer " + await signIn(B) };
  const api = async (p, body, method) => {
    const r = await fetch(B + "/api/" + p, body || method ? { method: method || "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify(body || {}) } : { headers: auth });
    return { status: r.status, ...await r.json().catch(() => ({})) };
  };
  const ID = idFor(dac.udn);
  try {
    await until(async () => (await api("status")).index_count >= 3);
    const d = await until(async () => (await api("audio-devices")).devices.find(x => x.id === ID));
    assert.equal(d.model, "Mandarin Bridge");
    assert.deepEqual(d.rates.filter(c => c.on).map(c => c.hz), dac.dac.rates);
    assert.deepEqual(d.dsd.filter(c => c.on).map(c => c.n), [64, 128, 256]);
    assert.equal((await api("audio-devices/" + ID, { enabled: true }, "PATCH")).status, 200);
    await until(async () => (await api("zones")).zones.some(z => z.zone_id === ID));

    // An album played to it: 24/96, the engine fed it, the DAC said to be fed 96 kHz and the track confirmed.
    const hi = (await api("library/albums?sort=album")).albums.find(a => a.title === "Hi Res");
    assert.equal((await api("play", { offset: hi.offset, zone_or_output_id: ID, kind: "play_now" })).ok, true);
    await until(async () => { const z = (await api("zone-state?zone=" + ID)).zone; return z && z.state === "playing" && z.now_playing && z.now_playing.line1 === "Hi 1"; });
    const now = await until(async () => { const j = await (await fetch(BR + "/dac.json")).json(); return j.now && j.now.rate === 96000 && j.now; });
    assert.equal(now.kind, "pcm");
    // Mandarin's own check of what the DAC is fed (/dac.json's "now"): the track confirmed on Now playing.
    await until(async () => { const np = (await api("zone-state?zone=" + ID)).zone.now_playing; return np && np.signal && np.signal.steps.some(x => x.kind === "verified"); }, 15000);
    const state = await (await fetch(BR + "/api/state")).json();
    assert.equal(state.track.title, "Hi 1");
    assert.match(state.status, /^Playing · 96 kHz/);

    // What reached the "DAC" is the track's own samples: its first half-second, as ffmpeg decodes the file, found whole in it.
    const file = path.join(lib.music, "Artist B", "Hi Res", "01 Hi 1.flac");
    const want = spawnSync(FFMPEG, ["-v", "error", "-i", file, "-f", "s32le", "-c:a", "pcm_s32le", "-"], { maxBuffer: 1 << 26 }).stdout;
    const got = await until(() => { const b = fs.existsSync(out) ? fs.readFileSync(out) : Buffer.alloc(0); return b.length > want.length / 2 && b; }, 20000);
    const firstSound = want.findIndex(x => x !== 0) & ~7;
    const at = got.indexOf(want.subarray(firstSound, firstSound + 4096));
    assert.ok(at >= 0, "the track's samples are in what the engine wrote");
    const span = 96000 * 8 / 2;
    assert.ok(got.subarray(at, at + span).equals(want.subarray(firstSound, firstSound + span)), "half a second, bit for bit");

    // On to the next track, gapless (the next given to the engine ahead): the Bridge and Mandarin both say Hi 2.
    await until(async () => (await (await fetch(BR + "/api/state")).json()).track.title === "Hi 2", 15000);
    await until(async () => (await api("zone-state?zone=" + ID)).zone.now_playing.line1 === "Hi 2", 10000);
    assert.ok((await (await fetch(BR + "/api/state")).json()).joined >= 1, "the engine went on to Hi 2 by itself");

    // A name set on its page: the name Mandarin knows it by.
    const set = await (await fetch(BR + "/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Study DAC" }) })).json();
    assert.equal(set.name, "Study DAC");
    assert.match(await (await fetch(BR + "/description.xml")).text(), /<friendlyName>Study DAC<\/friendlyName>/);
    await until(async () => (await api("audio-devices/rescan", {})).devices.find(x => x.id === ID && x.network_name === "Study DAC"), 20000);
  } catch (e) { console.log(said); throw e; }
});
