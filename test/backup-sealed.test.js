"use strict";
/*
 * backup-sealed.test.js — a backup sealed with a passphrase (v0.9.0, the
 * audit's S1, server/Mandarin.Server/Admin/Backup.Seal.cs):
 *   - the API keys, the Qobuz and Tidal sign-ins and the server's Tailscale
 *     identity are in no part of the file but the sealed one; a whole
 *     database's copy leaves them out too, with the account, the signed-in
 *     devices and the signing secret, which a restore never takes from it;
 *   - restoring them asks for the passphrase: without it, or with another,
 *     refused before anything changes; with it, back as from a backup without
 *     one. The rest of a sealed backup restores without it;
 *   - a passphrase under 8 characters is refused.
 * A backup without a passphrase restores as before: test/backup.test.js.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const Database = require("better-sqlite3");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");
const { score } = require("./score");

const skip = built();
const readBackup = (file, db) => score({ fn: "backup", reads: [{ file, db }] }).read[0];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PASS = "corréct horse 🐴 battery";
// The header carries it as base64 of its UTF-8: a header is one byte a character.
const passHeader = p => ({ "X-Mandarin-Passphrase": Buffer.from(p, "utf8").toString("base64") });

async function started(t) {
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const boot = async () => { try { return (await (await fetch(B + "/server-info")).json()).boot; } catch (e) { return null; } };
  let last = await boot();
  // A restore's restart: the same program started again, a boot id of its own.
  const restarted = async () => {
    for (let i = 0; i < 300; i++) { const b = await boot(); if (b && b !== last) { last = b; return; } await sleep(100); }
    throw new Error("the server didn't start again after the restore");
  };
  const token = await signIn(B);
  const A = { Authorization: "Bearer " + token };
  return { lib, B, ctx, A, J: Object.assign({ "Content-Type": "application/json" }, A), restarted };
}

const answer = async (r) => [r.status, await r.json().catch(() => null)];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "mandarin-sealed-"));

test("sealed: the keys and the Tailscale identity in no part but the sealed one, back only with the passphrase", { skip, timeout: 120000 }, async (t) => {
  const { lib, B, ctx, A, J, restarted } = await started(t);
  const db = ctx.db;
  db.setSetting("smartPicksHour", 7);
  db.setSetting("discogsToken", "secret-discogs-S1");
  db.setSetting("qobuz", { user_auth_token: "secret-qobuz-S1", user: { id: 1 } });
  const tsDir = path.join(lib.data, "tailscale");
  fs.mkdirSync(tsDir, { recursive: true });
  fs.writeFileSync(path.join(tsDir, "tailscaled.state"), "secret-node-key-S1");

  // Too short a passphrase: refused, no file.
  assert.deepEqual(await answer(await fetch(B + "/api/backup/file", { method: "POST", headers: J, body: JSON.stringify({ include: ["keys"], passphrase: "short" }) })),
    [400, { error: "A passphrase needs 8 characters or more" }]);

  const r = await fetch(B + "/api/backup/file", { method: "POST", headers: J, body: JSON.stringify({ include: ["settings", "collection", "keys"], passphrase: PASS }) });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.headers.get("x-mandarin-backup")).sealed, true, "said up front, for the app's list");
  const file = Buffer.from(await r.arrayBuffer());
  const raw = zlib.gunzipSync(file).toString("latin1");
  for (const secret of ["secret-discogs-S1", "secret-qobuz-S1", "secret-node-key-S1", Buffer.from("secret-node-key-S1").toString("base64")])
    assert.ok(!raw.includes(secret), secret + " is not in the file in the clear");
  const at = path.join(tmp(), "sealed.tar.gz");
  fs.writeFileSync(at, file);
  const { parts } = readBackup(at);
  assert.equal(parts.manifest.sealed, true);
  assert.equal(parts.server.keys, undefined, "server.json without its keys");
  assert.equal(parts.server.settings.smartPicksHour, 7, "and with the rest");
  assert.equal(parts.tailscale, undefined, "no tailscale.json");
  assert.deepEqual([parts.sealed.cipher, parts.sealed.kdf, parts.sealed.rounds], ["AES-256-GCM", "PBKDF2-SHA256", 600000]);

  // Everything changed afterwards.
  db.setSetting("smartPicksHour", 2);
  db.setSetting("discogsToken", "other");
  fs.rmSync(tsDir, { recursive: true, force: true });
  const restore = (parts, headers) => fetch(B + "/api/backup/restore?parts=" + parts, { method: "POST", headers: Object.assign({ "Content-Type": "application/gzip" }, A, headers), body: file });
  const kept = async () => (await (await fetch(B + "/api/backup", { headers: A })).json()).backups.length;

  // The keys without the passphrase, or with another: refused, nothing changed, no "Before restore" kept.
  assert.deepEqual(await answer(await restore("keys")), [422, { error: "This backup is sealed with a passphrase: enter it to restore the keys or the whole database" }]);
  assert.deepEqual(await answer(await restore("settings,keys", passHeader("correct horse battery"))), [422, { error: "That passphrase doesn't open this backup" }]);
  assert.deepEqual(await answer(await restore("keys", { "X-Mandarin-Passphrase": "not base64!" })), [400, { error: "The passphrase didn't arrive whole" }]);
  assert.deepEqual([db.setting("discogsToken"), db.setting("smartPicksHour"), await kept()], ["other", 2, 0]);

  // The rest without it.
  let [status, j] = await answer(await restore("settings"));
  assert.equal(status, 200, JSON.stringify(j));
  assert.deepEqual(j.restored, ["settings"]);
  assert.deepEqual([db.setting("smartPicksHour"), db.setting("discogsToken")], [7, "other"]);
  await restarted();

  // The keys with it: as from a backup without one, the Tailscale identity too.
  [status, j] = await answer(await restore("keys", passHeader(PASS)));
  assert.equal(status, 200, JSON.stringify(j));
  assert.deepEqual(j.restored.sort(), ["keys", "tailscale"]);
  assert.equal(db.setting("discogsToken"), "secret-discogs-S1");
  assert.deepEqual(db.setting("qobuz"), { user_auth_token: "secret-qobuz-S1", user: { id: 1 } });
  assert.equal(fs.readFileSync(path.join(tsDir, "tailscaled.state"), "utf8"), "secret-node-key-S1");
  await restarted();
});

test("sealed on the server: listed as sealed; the whole database's copy without its keys or sign-ins, put back with the passphrase", { skip, timeout: 120000 }, async (t) => {
  const { B, ctx, A, J, restarted } = await started(t);
  const db = ctx.db;
  db.setSetting("discogsToken", "secret-discogs-S1");
  db.raw.prepare("INSERT INTO favourites(key, added_at) VALUES('then', 1)").run();
  const authSecret = db.setting("authSecret");
  assert.ok(authSecret, "the server's signing secret");

  const [status, s] = await answer(await fetch(B + "/api/backup/save", { method: "POST", headers: J, body: JSON.stringify({ include: { database: true }, passphrase: PASS }) }));
  assert.equal(status, 200, JSON.stringify(s));
  assert.equal(s.backup.sealed, true);
  const listed = (await (await fetch(B + "/api/backup", { headers: A })).json()).backups.find(b => b.id === s.backup.id);
  assert.equal(listed.sealed, true, "the list says so: the page asks for the passphrase");

  // The file as downloaded: no key, no signing secret, no sign-in in it, not even in the database's free pages.
  const file = Buffer.from(await (await fetch(B + "/api/backup/download/" + s.backup.id, { headers: A })).arrayBuffer());
  const raw = zlib.gunzipSync(file).toString("latin1");
  for (const secret of ["secret-discogs-S1", authSecret]) assert.ok(!raw.includes(secret), "not in the file in the clear: " + secret.slice(0, 6) + "…");
  const dir = tmp(), copy = path.join(dir, "copy.db");
  fs.writeFileSync(path.join(dir, "b.tar.gz"), file);
  assert.equal(readBackup(path.join(dir, "b.tar.gz"), copy).hasDb, true);
  const c = new Database(copy, { readonly: true });
  const count = sql => c.prepare(sql).get().n;
  assert.deepEqual([count("SELECT COUNT(*) AS n FROM account"), count("SELECT COUNT(*) AS n FROM devices"),
    count("SELECT COUNT(*) AS n FROM settings WHERE key IN ('discogsToken', 'authSecret', 'tailscale')"), count("SELECT COUNT(*) AS n FROM favourites")], [0, 0, 0, 1]);
  c.close();

  db.setSetting("discogsToken", "later");
  db.raw.prepare("INSERT INTO favourites(key, added_at) VALUES('later', 2)").run();
  const byId = body => fetch(B + "/api/backup/restore/" + s.backup.id, { method: "POST", headers: J, body: JSON.stringify(body) });
  assert.deepEqual(await answer(await byId({ include: ["database"] })), [422, { error: "This backup is sealed with a passphrase: enter it to restore the keys or the whole database" }]);
  assert.deepEqual(await answer(await byId({ include: ["database"], passphrase: "not the passphrase" })), [422, { error: "That passphrase doesn't open this backup" }]);
  const [ok, j] = await answer(await byId({ include: ["database"], passphrase: PASS }));
  assert.equal(ok, 200, JSON.stringify(j));
  assert.deepEqual(j.restored, ["database"]);
  // Swapped in at the restart: the database as it was, its keys back, today's sign-in still good.
  await restarted();
  db.close();
  assert.deepEqual(db.raw.prepare("SELECT key FROM favourites ORDER BY key").all().map(x => x.key), ["then"]);
  assert.equal(db.setting("discogsToken"), "secret-discogs-S1");
  assert.equal(db.setting("authSecret"), authSecret, "today's signing secret kept");
  assert.equal((await fetch(B + "/api/backup", { headers: A })).status, 200, "the same sign-in still works");
});
