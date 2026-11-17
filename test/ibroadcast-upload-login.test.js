"use strict";
/*
 * An upload whose login iBroadcast doesn't take (item 454): a real upload had two files answered "Your login couldn't
 * be confirmed, so nothing was uploaded. Sign out and back in, then try again." (result false, not a 401), each counted
 * failed. Now the sign-in is refreshed and the file sent once more, sent; refused again with a fresh sign-in, the
 * upload ends, saying to sign in again, rather than failing file after file.
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

test("item 454: a login iBroadcast doesn't take is signed in again and the file sent once more; refused again, the upload ends", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const ib = await new FakeIBroadcast().start();
  ib.slowOnce = false;
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    ibroadcastBaseUrl: ib.base, ibroadcastUploadLimit: 50000000 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const call = async (method, p, body) => {
    const r = await fetch(base + "/api/" + p, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const state = () => call("GET", "settings/ibroadcast");
  const finished = since => until(async () => { const u = (await state()).upload; return u && !u.running && u.finished > since && u; }, 60000, "the upload done");
  await until(async () => (await call("GET", "status")).index_count >= 3, 60000, "the library");
  await call("POST", "settings/ibroadcast/signin");
  ib.approve();
  await until(async () => (await state()).connected, 15000, "signed in");
  assert.equal((await call("POST", "settings/ibroadcast/upload/settings", { from: "all", at_once: 1 })).status, 200);
  const logged = re => ctx.logs.filter(l => re.test(l)).length;

  await t.test("refused twice, files apart: each signed in again and sent once more, none failed", async () => {
    // The 1st asked refused (the 2nd its resend), and the 4th (the 5th its resend).
    ib.refuseLoginOn = new Set([1, 4]);
    const refreshes = ib.refreshes;
    await call("POST", "settings/ibroadcast/upload");
    const u = await finished(0);
    ib.refuseLoginOn = new Set();
    assert.deepEqual([u.uploaded, u.failed, u.error], [7, 0, null], JSON.stringify(u));
    assert.equal(ib.refusedWith.length, 2);
    assert.equal(ib.refreshes, refreshes + 2, "signed in again for each");
    assert.equal(logged(/\[ibroadcast\] upload: iBroadcast didn't take the sign-in; signed in again, and sent once more/), 2);
  });

  await t.test("refused again after signing in again: the upload ends, saying so, with nothing counted failed", async () => {
    const last = (await state()).upload.finished;
    // Something new to send: what was sent is kept.
    require("./fixtures").gen(require("path").join(lib.music, "New", "One", "01 New.flac"), { freq: 432, tags: { title: "New", artist: "New", album: "One", track: 1 } });
    await call("POST", "library/rescan");
    await until(async () => ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM tracks").get().n >= 8 && !(await call("GET", "status")).scanning, 60000, "the new file");
    ib.refuseLogin = 2;
    await call("POST", "settings/ibroadcast/upload");
    const u = await finished(last);
    assert.equal(u.error, "iBroadcast turned the sign-in down twice: sign out and back in on iBroadcast's page");
    assert.equal(u.failed, 0, JSON.stringify(u));
    assert.equal(ib.uploads.length, 7, "nothing more sent");
  });
});
