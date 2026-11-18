"use strict";
/*
 * Upload from All drives, or several drives at once (item 472). The owner's three USB drives were out of the music
 * folders, so the library held none of their files, and "All music" (the library's files) sent nothing: "0 of 0 files
 * to look at". Now:
 *   - All drives is every drive offered, read from the drives themselves, the library's files or not;
 *   - any number of the drives can be chosen, 2 of 3 say, each file sent once;
 *   - a chosen drive that isn't connected is left out, and said; the upload is refused only when none is there.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { makeLibrary, haveFfmpeg, gen } = require("./fixtures");
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

test("item 472: Upload from All drives, or several drives at once, read from the drives", { skip, timeout: 240000 }, async (t) => {
  const lib = makeLibrary();
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "mandarin-storage-"));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "mandarin-music-"));
  t.after(() => { fs.rmSync(storage, { recursive: true, force: true }); fs.rmSync(empty, { recursive: true, force: true }); });
  const drive = n => path.join(storage, "USB", "Drive " + n);
  const file = (n, ...p) => path.join(drive(n), ...p);
  // What a drive's file is sent to iBroadcast as (item 480): its path from its drive.
  const sentAs = (n, ...p) => p.join("/");
  // Each file its own sound, so none is iBroadcast's already by its MD5.
  const hz = (n, k) => 200 + 37 * "ABC".indexOf(n) + 11 * k;
  for (const n of ["A", "B", "C"]) {
    gen(file(n, "Band " + n, "Record", "01 One.flac"), { freq: hz(n, 1), tags: { title: "One" } });
    gen(file(n, "Band " + n, "Record", "02 Two.flac"), { freq: hz(n, 2), tags: { title: "Two" } });
  }
  const ib = await new FakeIBroadcast().start();
  ib.slowOnce = false;
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: storage, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    ibroadcastBaseUrl: ib.base, ibroadcastUploadLimit: 50000000 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const call = async (method, p, body) => {
    const r = await fetch(base + "/api/" + p, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const state = () => call("GET", "settings/ibroadcast");
  const choose = body => call("POST", "settings/ibroadcast/upload/settings", body);
  // As the owner had it: the drives out of the music folders, the library holding none of their files.
  await until(async () => !(await call("GET", "status")).scanning, 60000, "no scan under way");
  assert.equal((await call("POST", "library/folders", { add: empty })).status, 200);
  await until(async () => (await call("POST", "library/folders", { remove: storage })).status === 200, 60000, "the storage folder taken out");
  await until(async () => !(await call("GET", "status")).scanning, 60000, "the library read");
  await sleep(1000);
  assert.equal(ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM tracks WHERE path NOT LIKE '%://%'").get().n, 0, "the library holds none of the drives' files");
  await call("POST", "settings/ibroadcast/signin");
  ib.approve();
  await until(async () => (await state()).connected, 15000, "signed in");
  const upload = async () => {
    const since = ((await state()).upload || {}).finished || 0;
    const r = await call("POST", "settings/ibroadcast/upload");
    if (r.status !== 200) return r;
    return until(async () => { const x = (await state()).upload; return x && !x.running && x.finished > since && x; }, 120000, "the upload done");
  };
  const sent = () => ib.uploads.map(x => x.file_path);

  await t.test("All drives: every drive's files, though the library has none of them", async () => {
    const s = await state();
    assert.deepEqual(s.upload_sources.map(x => x.name), ["Drive A", "Drive B", "Drive C"]);
    const kept = await choose({ from: "all" });
    assert.equal(kept.status, 200);
    assert.deepEqual([kept.upload_settings.from, kept.upload_settings.from_name], ["all", "All drives"]);
    const u = await upload();
    assert.deepEqual([u.from, u.uploaded, u.failed], ["All drives", 6, 0], JSON.stringify(u));
    assert.deepEqual(sent().sort(), ["A", "B", "C"].flatMap(n => [sentAs(n, "Band " + n, "Record", "01 One.flac"), sentAs(n, "Band " + n, "Record", "02 Two.flac")]).sort());
  });

  await t.test("two of three drives: theirs alone, each file once", async () => {
    for (const n of ["A", "B", "C"]) gen(file(n, "Band " + n, "Later", "01 Later.flac"), { freq: hz(n, 3), tags: { title: "Later" } });
    const kept = await choose({ drives: [drive("A"), drive("C")] });
    assert.equal(kept.status, 200, JSON.stringify(kept));
    assert.deepEqual([kept.upload_settings.from, kept.upload_settings.drives, kept.upload_settings.from_name], ["drives", [drive("A"), drive("C")], "Drive A, Drive C"]);
    const before = ib.uploads.length;
    const u = await upload();
    assert.deepEqual([u.from, u.uploaded], ["Drive A, Drive C", 2], JSON.stringify(u));
    assert.deepEqual(sent().slice(before).sort(), [sentAs("A", "Band A", "Later", "01 Later.flac"), sentAs("C", "Band C", "Later", "01 Later.flac")].sort());
    assert.equal(new Set(sent()).size, sent().length, "nothing sent twice");
  });

  await t.test("a chosen drive unplugged: left out, and said; none there, refused", async () => {
    const away = path.join(os.tmpdir(), "mandarin-unplugged-" + process.pid);
    fs.renameSync(drive("C"), away);
    t.after(() => fs.rmSync(away, { recursive: true, force: true }));
    assert.equal((await choose({ drives: [drive("B"), drive("C")] })).status, 200, "a drive chosen before stays choosable while unplugged");
    const before = ib.uploads.length;
    const u = await upload();
    assert.deepEqual([u.uploaded, u.failed], [1, 0], JSON.stringify(u));
    assert.deepEqual(sent().slice(before), [sentAs("B", "Band B", "Later", "01 Later.flac")]);
    assert.ok(ctx.logs.some(l => /\[ibroadcast\] upload: Drive C not connected: left out/.test(l)), "said");
    assert.equal((await choose({ drives: [drive("C")] })).status, 200);
    const none = await upload();
    assert.deepEqual([none.status, none.error], [409, "Drive C isn't there: connect it, or choose again"]);
    const off = await choose({ drives: [] });
    assert.deepEqual([off.upload_settings.from, off.upload_settings.from_name], [null, null], "none chosen");
    assert.equal((await choose({ drives: ["/not/a/drive"] })).status, 400, "only the drives offered");
  });
});
