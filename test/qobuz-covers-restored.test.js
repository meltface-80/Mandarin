"use strict";
/*
 * Qobuz's covers where the files Mandarin kept of them are gone (item 530): a backup carries the library's rows, not
 * the covers fetched into the data folder, so after a backup was put back on a new install the owner's Qobuz albums
 * showed drawn stand-ins, kept under their image keys for good. Against the fake Qobuz:
 *   - a cover's hash is its picture's, not its address's;
 *   - as after a restore (the files gone, a restart): each is fetched again, its key now its picture's, and a stand-in
 *     drawn under the old key let go;
 *   - a cover asked for while its file is gone: "not now" (404), never a drawn stand-in, and fetched again.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { FakeQobuz } = require("./fake-qobuz");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const md5 = b => crypto.createHash("md5").update(b).digest("hex").slice(0, 12);
async function until(fn, ms = 30000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await sleep(200);
  }
}

test("item 530: Qobuz covers whose files are gone are fetched again, never kept as drawn stand-ins", { skip, timeout: 240000 }, async (t) => {
  const lib = makeLibrary();
  const art = path.join(lib.music, "Artist A", "Album One", "cover.jpg");
  const picture = md5(fs.readFileSync(art));
  const qobuz = new FakeQobuz({ art, albums: [
    { id: "q1", title: "Remote One", artist: "Somebody", tracks: [{ id: 501, title: "R1", duration: 60 }] },
    { id: "q2", title: "Remote Two", artist: "Somebody Else", tracks: [{ id: 502, title: "R2", duration: 60 }] }] });
  await qobuz.start();
  t.after(() => qobuz.stop());
  qobuz.favourites.add("q1");
  qobuz.favourites.add("q2");
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    qobuzBaseUrl: qobuz.base, qobuzSyncDelayMs: 100000 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  let token = await signIn(base);
  const call = async (method, p, body) => {
    const r = await fetch(base + "/api/" + p, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const album = async key => (await call("GET", "random-albums?count=30")).albums.find(a => a.source === "qobuz" && a.title === key);
  const image = async (key, size) => fetch(`${base}/api/image/${key}?size=${size}`, { headers: { Authorization: "Bearer " + token } });
  const row = key => ctx.db.raw.prepare("SELECT id, art_path, art_hash FROM albums WHERE key = ?").get(key);

  await until(async () => (await call("GET", "status")).index_count >= 3 && !(await call("GET", "status")).scanning, 60000, "the library");
  assert.equal((await call("POST", "settings/qobuz/signin", { username: "tester@example.com", password: "pw" })).status, 200);
  assert.equal((await call("POST", "settings/qobuz", { import: true })).status, 200);
  await until(async () => (await album("Remote One")) && (await album("Remote Two")), 30000, "Qobuz's albums in the library");

  await t.test("a cover's hash is its picture's, not its address's", async () => {
    const r = row("qobuz:q1");
    assert.ok(r.art_path && fs.existsSync(r.art_path), "its cover kept in the data folder");
    assert.equal(r.art_hash, picture, "the picture's hash");
    assert.notEqual(r.art_hash, md5(fs.readFileSync(r.art_path + ".url", "utf8")), "not its address's");
    assert.equal((await album("Remote One")).image_key, `al-${r.id}-${picture}`);
  });

  await t.test("as after a restore: the files gone and the server started again, each fetched again; a stand-in under the old key let go", async () => {
    const r = row("qobuz:q1");
    const address = md5(fs.readFileSync(r.art_path + ".url", "utf8"));
    // As a backup of v1.3.6 brought it back: the hash its address's, no cover file, a stand-in drawn under its key.
    ctx.db.raw.prepare("UPDATE albums SET art_hash = ? WHERE id = ?").run(address, r.id);
    ctx.db.raw.prepare("DELETE FROM settings WHERE key = 'coverHashesOfPictures'").run();
    for (const f of [r.art_path, r.art_path + ".url"]) fs.rmSync(f, { force: true });
    const standIn = path.join(lib.data, "art", `al-${r.id}-${address}@300.jpg`);
    fs.mkdirSync(path.dirname(standIn), { recursive: true });
    fs.writeFileSync(standIn, fs.readFileSync(art));
    await ctx.restart(token);
    await until(() => fs.existsSync(r.art_path), 30000, "its cover fetched again");
    await until(async () => (await album("Remote One")).image_key === `al-${r.id}-${picture}`, 15000, "its key its picture's");
    assert.equal(row("qobuz:q1").art_hash, picture);
    assert.ok(!fs.existsSync(standIn), "the stand-in drawn under the old key let go");
    const got = await image(`al-${r.id}-${picture}`, 300);
    assert.equal(got.status, 200);
    assert.ok(ctx.logs.some(l => /\[covers\] 1 Qobuz or Tidal cover\(s\) not in the data folder/.test(l)), "said in the log");
  });

  await t.test("asked for while its file is gone: not now (404), no stand-in drawn, and fetched again", async () => {
    const r = row("qobuz:q2");
    for (const f of [r.art_path, r.art_path + ".url"]) fs.rmSync(f, { force: true });
    // A size not drawn before, so the cover is looked for now.
    const key = `al-${r.id}-${r.art_hash}`;
    const first = await image(key, 1200);
    assert.equal(first.status, 404, "not a drawn stand-in");
    assert.ok(!fs.readdirSync(path.join(lib.data, "art")).some(f => f.startsWith(key + "@1200")), "nothing kept for it");
    await until(() => fs.existsSync(r.art_path), 30000, "its cover fetched again");
    await until(async () => (await image(`al-${r.id}-${picture}`, 1200)).status === 200, 15000, "its cover drawn");
  });
});
