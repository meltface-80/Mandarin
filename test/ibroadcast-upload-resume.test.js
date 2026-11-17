"use strict";
/*
 * Upload now goes on after the server restarts (item 467). Each update restarts the server, and an upload under way
 * stopped with it as Stop upload stops it, left so until begun again by hand. Now one under way when the server stops
 * is begun again as it starts, going on where it was (nothing sent twice); one stopped by Stop upload stays stopped.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { FakeIBroadcast } = require("./fake-ibroadcast");
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

test("item 467: an Upload now under way goes on after the server restarts; one stopped by hand doesn't", { skip, timeout: 240000 }, async (t) => {
  const lib = makeLibrary();
  const ib = await new FakeIBroadcast().start();
  ib.slowOnce = false;
  t.after(() => ib.stop());
  let srv = null, ctx = null, base = "", token = "";
  const start = async () => {
    const port = ports.port();
    base = "http://127.0.0.1:" + port;
    srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
      ibroadcastBaseUrl: ib.base, ibroadcastUploadLimit: 50000000 });
    ctx = await srv.start();
    token = await signIn(base);
  };
  t.after(() => srv && srv.stop());
  const call = async (method, p, body) => {
    const r = await fetch(base + "/api/" + p, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const state = () => call("GET", "settings/ibroadcast");
  const names = () => ib.uploads.map(u => u.file_path || u.name);
  await start();
  await until(async () => (await call("GET", "status")).index_count >= 3, 60000, "the library");
  await call("POST", "settings/ibroadcast/signin");
  ib.approve();
  await until(async () => (await state()).connected, 15000, "signed in");
  assert.equal((await call("POST", "settings/ibroadcast/upload/settings", { from: "all", at_once: 1 })).status, 200);

  await t.test("under way when the server stops: begun again as it starts, going on where it was", async () => {
    ib.uploadDelayMs = 700;
    assert.equal((await call("POST", "settings/ibroadcast/upload")).status, 200);
    await until(() => ib.uploads.length >= 2, 30000, "two files sent");
    await srv.stop();
    const before = ib.uploads.length;
    assert.ok(before < 7, "stopped part way: " + before);
    ib.uploadDelayMs = 0;
    await start();
    await until(() => new Set(names()).size === 7, 60000, "the rest sent after the restart");
    const u = await until(async () => { const x = (await state()).upload; return x && !x.running && x.finished && x; }, 30000, "the upload done");
    assert.equal(u.error, null, JSON.stringify(u));
    assert.ok(ib.uploads.length <= 8, "nothing sent twice but the file under way as it stopped: " + JSON.stringify(names()));
    assert.ok(ctx.logs.some(l => /\[ibroadcast\] upload: begun again after the server restarted/.test(l)), "said so");
  });

  await t.test("stopped by Stop upload, then the server restarts: it stays stopped", async () => {
    // Something new to send.
    const { gen } = require("./fixtures"), path = require("path");
    for (const i of [1, 2, 3, 4]) gen(path.join(lib.music, "Later", "Four", `0${i} Later.flac`), { freq: 300 + 20 * i, tags: { title: "Later " + i, artist: "Later", album: "Four", track: i } });
    await call("POST", "library/rescan");
    await until(async () => ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM tracks").get().n >= 11 && !(await call("GET", "status")).scanning, 60000, "the new files");
    ib.uploadDelayMs = 700;
    const sent = ib.uploads.length;
    assert.equal((await call("POST", "settings/ibroadcast/upload")).status, 200);
    await until(() => ib.uploads.length >= sent + 1, 30000, "one sent");
    await call("POST", "settings/ibroadcast/upload/stop");
    await until(async () => !(await state()).upload.running, 15000, "stopped");
    await srv.stop();
    await until(() => ib.sending === 0, 10000, "the fake done with what it held");
    const after = ib.uploads.length;
    ib.uploadDelayMs = 0;
    await start();
    await sleep(3000);
    assert.equal(ib.uploads.length, after, "nothing more sent");
    assert.equal((await state()).upload.running, false);
    assert.ok(!ctx.logs.some(l => /begun again after the server restarted/.test(l)));
  });
});
