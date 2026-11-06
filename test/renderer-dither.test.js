"use strict";
/*
 * Mandarin's own dither, end to end (item 301, server Upsample/Dither.cs): a device set to the 5th order's shaped
 * dither at the DAC's 20 real bits is handed a CD rip upsampled ×2 whose URL asks it (dn=ns5, rb=20); what it fetches
 * is 24-bit FLAC every sample of which is on the 20-bit grid (the four bits below left at zero), and Now playing's
 * signal path says the dither. Back to as sent and flat, the URL asks neither, and the samples use every bit again.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("child_process");
const { haveFfmpeg, makeLibrary, probe, FFMPEG } = require("./fixtures");
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

/** The fewest bits at the bottom of a 24-bit FLAC's samples [buf] none of which uses: 0, or 4 on the 20-bit grid. */
function zeroBits(buf) {
  const pcm = execFileSync(FFMPEG, ["-v", "error", "-i", "pipe:0", "-f", "s32le", "-"], { input: buf, maxBuffer: 1 << 28 });
  let or = 0;
  for (let i = 0; i < pcm.length; i += 4) or |= pcm.readInt32LE(i) >> 8;
  let n = 0;
  while (n < 24 && !(or & (1 << n))) n++;
  return n;
}

test("a device's dither: shaped at 20 real bits, the made FLAC on the 20-bit grid and the signal path saying it", { skip, timeout: 150000 }, async (t) => {
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
  const albums = (await api("library/albums?sort=album")).albums;
  const cd = albums.find(a => a.title === "Album One");   // 16/44.1 FLAC

  // Refused: a dither or real bits the server doesn't make.
  assert.equal((await call("PATCH", "audio-devices/" + W, { enabled: true, output: { dither: "ns7" } })).status, 400);
  assert.equal((await call("PATCH", "audio-devices/" + W, { output: { real_bits: 19 } })).status, 400);
  let r = await call("PATCH", "audio-devices/" + W, { enabled: true, output: { mode: "x2", bits: 24, dither: "ns5", real_bits: 20 } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual([r.output.dither, r.output.real_bits], ["ns5", 20]);
  await until(async () => (await api("zones")).zones.some(x => x.zone_id === W), 20000);

  const made = (from) => until(() => wiim.fetches.slice(from).filter(x => x.done && x.body && x.body.length > 1000 && /88200-24/.test(x.uri)).pop(), 30000, "the made FLAC fetched");
  let from = wiim.fetches.length;
  assert.equal((await api("play", { offset: cd.offset, zone_or_output_id: W, kind: "play_now" })).status, 200);
  const f = await made(from);
  assert.match(f.uri, /\.88200-24\.flac\?(.*&)?dn=ns5(&|$)/, f.uri);
  assert.match(f.uri, /[?&]rb=20(&|$)/, f.uri);
  assert.deepEqual(probe(f.body), { rate: 88200, channels: 2, bits: 24 });
  assert.equal(zeroBits(f.body), 4, "every sample on the 20-bit grid");
  const sp = await until(async () => { const z = (await api("zone-state?zone=" + W)).zone; const s = z && z.now_playing && z.now_playing.signal; return s && s.steps.some(x => x.kind === "dither") && s; }, 15000, "the signal path's dither");
  const step = sp.steps.find(x => x.kind === "dither");
  assert.deepEqual([step.title, step.detail], ["Dither", "Shaped (5th order) at 20 bits, in 24-bit words, Mandarin’s own"]);
  assert.deepEqual(sp.steps.map(x => x.kind).slice(0, 3), ["source", "upsample", "dither"]);

  // As sent and flat: nothing asked, ffmpeg's own dither at 24 bits, every bit used.
  r = await call("PATCH", "audio-devices/" + W, { output: { dither: "flat", real_bits: "sent" } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual([r.output.dither ?? null, r.output.real_bits ?? null], [null, null]);
  from = wiim.fetches.length;
  await api("control", { zone_or_output_id: W, command: "stop" });
  assert.equal((await api("play", { offset: cd.offset, zone_or_output_id: W, kind: "play_now" })).status, 200);
  const g = await made(from);
  assert.doesNotMatch(g.uri, /[?&](dn|rb)=/, g.uri);
  assert.equal(zeroBits(g.body), 0, "the samples use every bit");
});
