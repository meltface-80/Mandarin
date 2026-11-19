"use strict";
/*
 * Files iBroadcast takes but doesn't keep (item 477). A real upload's same 46 files were sent on every Upload now:
 * iBroadcast answered each as taken, yet never listed it among the MD5s it has, nor in its library, and what it said
 * was nowhere. Now what it says as it takes a file is kept; one taken twice and still not kept is left while it stays
 * as it is, said on the page with iBroadcast's words, and not sent again for now (item 488: tried again after a day,
 * test/ibroadcast-upload-waits.test.js). A file that changes is sent again.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
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

test("item 477: a file iBroadcast takes but doesn't keep is sent twice, then left with iBroadcast's words, until it changes", { skip, timeout: 240000 }, async (t) => {
  const lib = makeLibrary();
  const ib = await new FakeIBroadcast().start();
  ib.slowOnce = false;
  ib.notKept = p => /Hi Res/.test(p);   // Artist B — Hi Res: its two files taken, never kept
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
  await until(async () => (await call("GET", "status")).index_count >= 3, 60000, "the library");
  await call("POST", "settings/ibroadcast/signin");
  ib.approve();
  await until(async () => (await state()).connected, 15000, "signed in");
  assert.equal((await call("POST", "settings/ibroadcast/upload/settings", { from: "all", at_once: 1 })).status, 200);
  const hiRes = () => ib.uploads.filter(u => /Hi Res/.test(u.file_path)).length;
  const upload = async () => {
    const was = (await state()).upload?.finished || 0;
    assert.equal((await call("POST", "settings/ibroadcast/upload")).status, 200);
    return until(async () => { const u = (await state()).upload; return u && !u.running && u.finished && u.finished !== was && u; }, 60000, "the upload done");
  };

  // First: everything sent; the two Hi Res files taken, not kept.
  let u = await upload();
  assert.equal(u.error, null, JSON.stringify(u));
  assert.equal(hiRes(), 2);
  assert.equal(u.uploaded, 7);
  // Second: only those two, sent again (once more: iBroadcast may yet keep them), said in the log with its words.
  u = await upload();
  assert.equal(hiRes(), 4, "sent once more");
  assert.equal(u.uploaded, 2);
  assert.ok(ctx.logs.some(l => /Hi 1\.flac was taken before but iBroadcast hasn't it \(it said: "Track already in library"\); sent again/.test(l)), "said with iBroadcast's words");
  // Third: taken twice and not kept: left, not sent, said on the page with iBroadcast's words.
  u = await upload();
  assert.equal(hiRes(), 4, "not sent a third time");
  assert.equal(u.uploaded, 0);
  assert.equal(u.skipped, 2);
  assert.equal(u.already, 5);
  assert.equal(u.problems.length, 2);
  for (const p of u.problems) assert.match(p.why, /iBroadcast took it 2 times but didn't keep it \(it said: "Track already in library"\); tried again after about 24 hours/);
  assert.ok(ctx.logs.some(l => /2 left for now as iBroadcast took them but didn't keep them \(from Hi Res\)/.test(l)), JSON.stringify(ctx.logs.filter(l => /ibroadcast/.test(l)).slice(-5)));
  // Changed: as any other file, sent again.
  const f = path.join(lib.music, "Artist B", "Hi Res", "01 Hi 1.flac");
  fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
  await call("POST", "library/rescan");
  await sleep(1500);
  u = await upload();
  assert.equal(hiRes(), 5, "the changed one sent; the other still left");
  assert.equal(u.skipped, 1);
});
