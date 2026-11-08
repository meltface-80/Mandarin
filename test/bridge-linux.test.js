"use strict";
/*
 * Mandarin Bridge for Linux (bridge/linux, item 282), end to end: the Bridge started on a computer whose one USB DAC
 * is a Mojo (its /proc/asound written here: PCM to 384 kHz in 32 bits, native DSD to DSD256), played to by
 * Mandarin's own server over SlimProto (item 316; UPnP before). It connects to Mandarin (pointed at it here, as
 * --server; on a network it finds it by itself), Mandarin reads its DAC whole from /dac.json (every rate, the depths,
 * DSD), plays an album to it, and confirms what the DAC is fed; the audio engine under the Bridge writes the
 * samples (here, to a file in place of the DAC) exactly as the track's own. Its web page says what it plays, and a
 * name set there is the name Mandarin knows it by.
 *
 * Played as Mandarin's continuous PCM (item 322): the album at 24/96, then one at 16/44.1 queued after it, reach the
 * DAC as one stream of samples a format, every track's whole and nothing between them; between the two albums, half
 * a second of silence at 44.1 kHz, the DAC let settle at the new rate before the music.
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
const crypto = require("crypto");
const { signIn } = require("./auth-helper");

const ROOT = path.join(__dirname, "..");
const BRIDGE = path.join(ROOT, "bridge", "linux", "bin", "mandarin-bridge");
const ENGINE = path.join(ROOT, "engine", "bin", "mandarin-audio");
const built = fs.existsSync(BRIDGE) && fs.existsSync(ENGINE);
const skip = !haveFfmpeg() ? "ffmpeg is not installed" : !built && !process.env.CI && "bridge/linux/build.sh and engine/build.sh not run";
const PORT = ports.port(), BRIDGE_PORT = ports.port(), SLIM = ports.port();
// Its SlimProto id: six bytes from its UDN, locally administered (Slim.cs).
const slimId = udn => { const h = crypto.createHash("sha256").update(udn).digest().subarray(0, 6); h[0] = (h[0] & 0xfc) | 0x02; return "SLIM_" + h.toString("hex").toUpperCase(); };
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
    "--address", "127.0.0.1", "--engine", ENGINE, "--ffmpeg", FFMPEG, "--server", "127.0.0.1:" + SLIM], { stdio: ["ignore", "ignore", "pipe"] });
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
    upnpMulticast: false, slimprotoPort: SLIM });
  const { logs } = await srv.start();
  t.after(() => srv.stop());
  const auth = { Authorization: "Bearer " + await signIn(B) };
  const api = async (p, body, method) => {
    const r = await fetch(B + "/api/" + p, body || method ? { method: method || "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify(body || {}) } : { headers: auth });
    return { status: r.status, ...await r.json().catch(() => ({})) };
  };
  const ID = slimId(dac.udn);
  try {
    await until(async () => (await api("status")).index_count >= 3);
    const d = await until(async () => (await api("audio-devices")).devices.find(x => x.id === ID));
    assert.equal(d.model, "Mandarin Bridge");
    assert.equal(d.kind, "slim", "played over SlimProto");
    assert.deepEqual(d.rates.filter(c => c.on).map(c => c.hz), dac.dac.rates);
    assert.deepEqual(d.dsd.filter(c => c.on).map(c => c.n), [64, 128, 256]);
    assert.equal((await api("audio-devices/" + ID, { enabled: true }, "PATCH")).status, 200);
    await until(async () => (await api("zones")).zones.some(z => z.zone_id === ID));

    // An album played to it: 24/96, the engine fed it, the DAC said to be fed 96 kHz and the track confirmed.
    const albums = (await api("library/albums?sort=album")).albums;
    const hi = albums.find(a => a.title === "Hi Res"), cd = albums.find(a => a.title === "Album One");
    assert.equal((await api("play", { offset: hi.offset, zone_or_output_id: ID, kind: "play_now" })).ok, true);
    assert.equal((await api("play", { offset: cd.offset, zone_or_output_id: ID, kind: "queue" })).ok, true);
    await until(async () => { const z = (await api("zone-state?zone=" + ID)).zone; return z && z.state === "playing" && z.now_playing && z.now_playing.line1 === "Hi 1"; });
    const now = await until(async () => { const j = await (await fetch(BR + "/dac.json")).json(); return j.now && j.now.rate === 96000 && j.now; });
    assert.equal(now.kind, "pcm");
    // What the DAC is fed, as the Bridge reports it (/dac.json's "now", item 287): the signal path's last step, in its words.
    const fed = await until(async () => { const np = (await api("zone-state?zone=" + ID)).zone.now_playing; return np && np.signal && np.signal.steps.find(x => x.kind === "fed"); }, 15000);
    assert.equal(fed.title, "The DAC is fed");
    assert.match(fed.detail, /^PCM 96 kHz, the \d+-bit samples padded to 32 bits for the DAC, fixed volume: the samples untouched — as Mandarin Bridge reports it$/);
    assert.equal(fed.quality, "lossless");
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

    // Its port has no sign-in, so nothing but JSON from its own page or from Mandarin changes it (item 352): a web page
    // elsewhere could send a plain form's POST without the browser asking first, or name itself as another site.
    const post = (headers, name) => fetch(BR + "/api/settings", { method: "POST", headers, body: JSON.stringify({ name }) });
    const plain = await post({ "Content-Type": "text/plain" }, "Owned");
    assert.equal(plain.status, 403, "a plain form's POST refused");
    assert.match((await plain.json()).error, /only JSON/);
    const foreign = await post({ "Content-Type": "application/json", Origin: "http://evil.example" }, "Owned");
    assert.equal(foreign.status, 403, "JSON from another site refused");
    assert.notEqual((await (await fetch(BR + "/api/state")).json()).name, "Owned", "neither changed its name");
    // A name set on its page (its own Origin): the name Mandarin knows it by.
    const set = await (await post({ "Content-Type": "application/json", Origin: BR }, "Study DAC")).json();
    assert.equal(set.name, "Study DAC");
    assert.equal((await fetch(BR + "/description.xml")).status, 404, "no UPnP description any more");
    await until(async () => (await api("audio-devices")).devices.find(x => x.id === ID && x.network_name === "Study DAC"), 20000);

    // The whole of what the DAC was fed (item 322): Hi 1 and Hi 2 one on into the other, half a second of silence at
    // 44.1 kHz, then Album One's three tracks one on into the next; each track's samples whole, in 32-bit words.
    const pcm = f => spawnSync(FFMPEG, ["-v", "error", "-i", f, "-f", "s32le", "-c:a", "pcm_s32le", "-"], { maxBuffer: 1 << 27 }).stdout;
    const tracks = [1, 2].map(i => path.join(lib.music, "Artist B", "Hi Res", `0${i} Hi ${i}.flac`));
    const songs = [1, 2, 3].map(i => path.join(lib.music, "Artist A", "Album One", `0${i} Song ${i}.flac`));
    const whole = Buffer.concat([...tracks.map(pcm), Buffer.alloc(44100 / 2 * 8), ...songs.map(pcm)]);
    await until(async () => (await api("zone-state?zone=" + ID)).zone.state === "stopped" && fs.statSync(out).size >= whole.length, 40000);
    const all = fs.readFileSync(out);
    assert.equal(all.length, whole.length, "every track's samples, the silence between the albums, nothing else");
    assert.ok(all.equals(whole), "one stream a format, bit for bit, half a second of silence where the rate changes");
    // Made by Mandarin as runs of PCM (two, as a rule: one an album), each after the first given ahead, none begun again
    // by a stop; the album at 44.1 kHz given ahead where the rate changed, and tracks one on into the next in a run.
    const runs = logs.filter(l => /\[slimproto\] .*run \d/.test(l));
    assert.match(runs.join("\n"), /run 1: PCM 24\/96 kHz/);
    assert.match(runs.join("\n"), /run \d+ given ahead: PCM 16\/44\.1 kHz/);
    assert.ok(runs.every(l => /run 1: PCM 24\/96|given ahead: PCM (24\/96|16\/44\.1) kHz|\((24\/96|16\/44\.1) kHz\) made to its end/.test(l)), runs.join("\n"));
    assert.ok(runs.some(l => /made to its end, [2-9] track\(s\)/.test(l)), "tracks one on into the next in a run: " + runs.join("\n"));
  } catch (e) { console.log(said); throw e; }
});
