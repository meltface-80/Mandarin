"use strict";
/*
 * Rescan library brings the services' albums up to date too (item 457): the owner found it read the music folders
 * only. Signed in to Qobuz (its albums in the library), a rescan asks it again, as its own Update library now does,
 * and says so; Qobuz's albums switched out of the library, it isn't asked.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
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

test("item 457: Rescan library asks the signed-in services again, and says which", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const qobuz = new FakeQobuz({ art: path.join(lib.music, "Artist A", "Album One", "cover.jpg"), albums: [
    { id: "q1", title: "Remote One", artist: "Somebody", tracks: [{ id: 501, title: "R1", duration: 60 }] }] });
  await qobuz.start();
  t.after(() => qobuz.stop());
  qobuz.favourites.add("q1");
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    qobuzBaseUrl: qobuz.base, qobuzSyncDelayMs: 100000 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const call = async (method, p, body) => {
    const r = await fetch(base + "/api/" + p, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  await until(async () => (await call("GET", "status")).index_count >= 3 && !(await call("GET", "status")).scanning, 60000, "the library");
  assert.equal((await call("POST", "settings/qobuz/signin", { username: "tester@example.com", password: "pw" })).status, 200);
  await until(async () => (await call("GET", "settings/qobuz")).connected, 10000, "Qobuz signed in");
  assert.equal((await call("POST", "settings/qobuz", { import: true })).status, 200);
  // What signing in and switching on asked of it, done with.
  await until(async () => { const q = await call("GET", "settings/qobuz"); return !q.importing && q.last_import; }, 15000, "Qobuz's first import");
  await sleep(1500);
  // Every call Qobuz is asked (its library update asks its favourites and purchases; the sign-in its account).
  const favs = () => Object.entries(qobuz.calls).filter(([c]) => c !== "user/login").reduce((n, [, k]) => n + k, 0);
  const logged = re => ctx.logs.filter(l => re.test(l)).length;

  await t.test("each signed-in service asked again beside the scan, and named", async () => {
    const q0 = favs();
    const r = await call("POST", "library/rescan", {});
    assert.deepEqual(r.services, ["Qobuz"]);
    await until(() => favs() > q0, 20000, "Qobuz asked again");
    assert.equal(logged(/\[scan\] rescan: Qobuz brought up to date too/), 1);
  });

  await t.test("Qobuz's albums out of the library: not asked", async () => {
    assert.equal((await call("POST", "settings/qobuz", { import: false })).status, 200);
    await until(async () => !(await call("GET", "status")).scanning, 60000, "no scan under way");
    await sleep(1500);
    const q0 = favs();
    const r = await call("POST", "library/rescan", {});
    assert.deepEqual(r.services || [], []);
    await sleep(3000);
    assert.equal(favs(), q0, "Qobuz not asked");
  });
});
