"use strict";
/*
 * A Qobuz track upsampled as a file of the library is (item 440): made DSD from PCM where the device is set to it, and
 * in the filter's shape where the device asks one, by Mandarin's own upsampler reading the track's address on Qobuz
 * (track/getFileUrl) as it reads a file. Before, both were refused for a service's track: DSD asked of one was a 404,
 * and its shape left off. Against the stand-in Qobuz, its tracks the fixture library's own CD files.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { haveFfmpeg, makeLibrary, probe } = require("./fixtures");
const { FakeQobuz } = require("./fake-qobuz");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await sleep(100);
  }
}

test("item 440: a Qobuz track made DSD from PCM and in the filter's shape, as a library file is", { skip, timeout: 240000 }, async () => {
  const lib = makeLibrary();
  const cd = [1, 2].map(i => path.join(lib.music, "Artist A", "Album One", `0${i} Song ${i}.flac`));
  const qobuz = new FakeQobuz({ art: path.join(lib.music, "Artist A", "Album One", "cover.jpg"), albums: [
    { id: 1001, title: "Q Album", artist: "Q Artist", year: 2021, rate: 44100, bits: 16, tracks: cd.map((f, i) => ({ id: 5001 + i, title: "Q Song " + (i + 1), file: f, duration: 3 })) }
  ] });
  await qobuz.start();
  qobuz.favourites.add("1001");
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    qobuzBaseUrl: qobuz.base, qobuzSyncDelayMs: 100000 });
  const ctx = await srv.start();
  const token = await signIn(base);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const api = async (p, body) => {
    const r = await fetch(base + "/api/" + p, body ? { method: "POST", headers: H, body: JSON.stringify(body) } : { headers: H });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  try {
    await until(async () => (await api("status")).index_count >= 3, 60000, "the library");
    assert.equal((await api("settings/qobuz/signin", { username: "tester@example.com", password: "pw" })).status, 200);
    await api("settings/qobuz", { import: true });
    await until(async () => !(await api("settings/qobuz")).importing, 30000, "the import");
    assert.equal((await api("settings/qobuz/import", {})).status, 200);
    const id = await until(() => ctx.db.raw.prepare("SELECT id FROM tracks WHERE path = 'qobuz://track/5001'").get()?.id, 30000, "the Qobuz track");

    // DSD64 from PCM: a DSF, made as it plays from the track's address.
    const dsf = await fetch(base + "/stream/t" + id + ".d64.dsf", { headers: H });
    assert.equal(dsf.status, 200, "DSD from a Qobuz track is made, not refused");
    const bytes = Buffer.from(await dsf.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "DSD ", "a DSF");
    assert.ok(bytes.length > 3 * 2822400 * 2 / 8 * 0.8, "about three seconds of DSD64 stereo: " + bytes.length + " bytes");

    // ×4 in the minimum-phase shape: Mandarin's own filter, at 176.4 kHz.
    const shaped = await fetch(base + "/stream/t" + id + ".176400-24.flac?f=min", { headers: H });
    assert.equal(shaped.status, 200);
    const p = probe(Buffer.from(await shaped.arrayBuffer()));
    assert.equal(p && p.rate, 176400, JSON.stringify(p));
    // Made by Mandarin's own upsampler, in its shape: the log says so.
    const logged = await until(() => { const t = require("fs").readFileSync(path.join(lib.data, "Logs", "Mandarin_log.txt"), "utf8"); return /\[upsample\] 5001: .*made as it played/.test(t) && t; }, 30000, "the upsampler's line");
    assert.ok(logged);
  } finally {
    await srv.stop();
    await qobuz.stop();
  }
});
