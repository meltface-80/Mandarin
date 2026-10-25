"use strict";
/*
 * Backup & restore (v0.6.14), against the real server:
 *   - a backup file holds the settings you changed, the players' own settings,
 *     your collection, the API keys, a device's screen settings and the app's;
 *   - restoring puts them back (settings not in it back to their defaults),
 *     keeps a "Before restore" backup first, and restarts the server;
 *   - the whole database restored keeps today's account and sign-ins;
 *   - this phone's player follows it to its new id after a reinstall;
 *   - a backup from a newer Mandarin is refused; backups kept here are listed,
 *     downloaded and deleted;
 *   - all of it away from home too (v0.6.17).
 * Made by the C# server (v0.8.22), started on its own (test/server.js, v0.8.50):
 * after a restore it starts again in its own process, a new boot id on
 * /server-info saying so.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");
const { score } = require("./score");

// The backup file and its rules, the C# server's (Admin/Backup.cs; lib/backup.js until v0.8.50).
const backup = (job) => score(Object.assign({ fn: "backup" }, job));
const writeBackup = (to, entries) => backup({ writes: [{ to, entries }] });
const readBackup = (file, db) => backup({ reads: [{ file, db }] }).read[0];
const skip = built();

const PORT = ports.port(), BASE = "http://127.0.0.1:" + PORT;
const byCs = (r, what) => { assert.equal(r.headers.get("x-mandarin-answered"), "C#", what + ": made by the C# server"); return r; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const boot = async () => { try { return (await (await fetch(BASE + "/server-info")).json()).boot; } catch (e) { return null; } };
// A restore's restart (half a second on): the same program started again, a boot id of its own.
const restarted = async (before) => {
  for (let i = 0; i < 300; i++) { const b = await boot(); if (b && b !== before) return b; await sleep(100); }
  throw new Error("the server didn't start again after the restore");
};

async function server(lib) {
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  return { srv, ctx, boot0: await boot() };
}

test("versions compare, parts are read", { skip }, () => {
  const r = backup({ newer: [["0.6.14", "0.6.9"], ["0.6.9", "0.6.14"], ["0.6.14", "0.6.14"], ["0.6.0", "0.6.0-RC4"], ["0.6.0-RC4", "0.6.0"]],
    parts_of: ["settings,keys,bogus", { database: 1, page: true, devices: false }] });
  assert.deepEqual(r.newer, [true, false, false, true, false]);
  assert.deepEqual(r.parts_of[0], { settings: true, keys: true });
  assert.deepEqual(r.parts_of[1], { database: true, page: true, devices: false });
});

test("the file format: written and read back, the database copy to its own file", { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mbk-"));
  const db = path.join(dir, "x.db");
  fs.writeFileSync(db, Buffer.alloc(70000, 7));
  const out = path.join(dir, "b.tar.gz");
  writeBackup(out, [
    { name: "manifest.json", data: { app: "mandarin", format: 1 } },
    { name: "server.json", data: { settings: { homeRows: [1, 2] } } },
    { name: "musicd.db", file: db }
  ]);
  const back = path.join(dir, "back.db");
  const r = readBackup(out, back);
  assert.equal(r.hasDb, true);
  assert.deepEqual(r.parts.server, { settings: { homeRows: [1, 2] } });
  assert.ok(fs.readFileSync(back).equals(fs.readFileSync(db)));
  // Not ours: refused.
  const other = path.join(dir, "o.tar.gz");
  writeBackup(other, [{ name: "manifest.json", data: { app: "else" } }]);
  assert.match(readBackup(other).error, /isn't a Mandarin backup/);
});

test("back up, change everything, restore: as it was, with a Before-restore backup and a restart", { timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const { srv, ctx, boot0 } = await server(lib);
  try {
    const token = await signIn(BASE);
    const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    const db = ctx.db;
    db.setSetting("smartPicksHour", 7);
    db.setSetting("waveformEnabled", true);
    db.setSetting("discogsToken", "secret-token");
    db.setSetting("userPlaylists", [{ id: "p1", name: "Mine" }]);
    db.raw.prepare("INSERT INTO favourites(key, added_at) VALUES('album-a', 1)").run();
    db.raw.prepare(`INSERT INTO audio_devices(id, kind, network_name, name, settings, first_seen, last_seen)
      VALUES('uuid:wiim', 'upnp', 'WiiM Pro', 'Lounge', '{"mode":"x2"}', 1, 1)`).run();
    // The server's Tailscale identity, as the engine keeps it (v0.7.2).
    fs.mkdirSync(path.join(lib.data, "tailscale"), { recursive: true });
    fs.writeFileSync(path.join(lib.data, "tailscale", "tailscaled.state"), "node-key-of-this-server");

    const r = await fetch(BASE + "/api/backup/file", { method: "POST", headers: H,
      body: JSON.stringify({ include: ["settings", "devices", "collection", "keys"], page: { "rra-ui-text": "1.25" } }) });
    byCs(r, "a backup file");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-disposition"), /mandarin-backup-.*\.tar\.gz/);
    const file = Buffer.from(await r.arrayBuffer());

    // Everything changed afterwards.
    db.setSetting("smartPicksHour", 2);
    db.setSetting("displayEnabled", true);          // not in the backup: back to its default
    db.setSetting("discogsToken", "other");
    db.setSetting("userPlaylists", []);
    db.raw.prepare("DELETE FROM favourites").run();
    db.raw.prepare("UPDATE audio_devices SET name = 'Changed', settings = '{}' WHERE id = 'uuid:wiim'").run();
    fs.rmSync(path.join(lib.data, "tailscale"), { recursive: true, force: true });   // a rebuilt data folder: a new node, unless restored

    const back = await fetch(BASE + "/api/backup/restore?parts=settings,devices,collection,keys,page", {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/gzip" }, body: file });
    byCs(back, "a restore");
    const j = await back.json();
    assert.equal(back.status, 200, JSON.stringify(j));
    assert.deepEqual(j.restored.sort(), ["collection", "devices", "keys", "page", "settings", "tailscale"], "the Tailscale identity came with the keys (v0.7.2)");
    assert.equal(fs.readFileSync(path.join(lib.data, "tailscale", "tailscaled.state"), "utf8"), "node-key-of-this-server", "the same node again");
    assert.deepEqual(j.page, { "rra-ui-text": "1.25" });
    assert.equal(j.restarting, true);
    assert.equal(db.setting("smartPicksHour"), 7);
    assert.equal(db.setting("displayEnabled", "default"), "default");
    assert.equal(db.setting("discogsToken"), "secret-token");
    assert.deepEqual(db.setting("userPlaylists"), [{ id: "p1", name: "Mine" }]);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM favourites").get().n, 1);
    assert.deepEqual(db.raw.prepare("SELECT name, settings FROM audio_devices WHERE id = 'uuid:wiim'").get(), { name: "Lounge", settings: '{"mode":"x2"}' });

    // The restore's restart (half a second on), seen through before anything more is asked.
    await restarted(boot0);
    const list = await (byCs(await fetch(BASE + "/api/backup", { headers: H }), "the list")).json();
    assert.equal(list.backups.filter(b => b.kind === "auto" && b.label === "Before restore").length, 1);
  } finally { await srv.stop(); }
});

test("the whole database: restored at the next start, today's account and sign-ins kept", { timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const { srv, ctx, boot0 } = await server(lib);
  try {
    const token = await signIn(BASE);
    const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    ctx.db.raw.prepare("INSERT INTO favourites(key, added_at) VALUES('then', 1)").run();
    ctx.db.setSetting("openAccess", true);   // the sign-in off when the backup was made…
    const r = await fetch(BASE + "/api/backup/file", { method: "POST", headers: H, body: JSON.stringify({ include: { database: true } }) });
    const file = Buffer.from(await r.arrayBuffer());
    ctx.db.raw.prepare("INSERT INTO favourites(key, added_at) VALUES('later', 2)").run();
    ctx.db.setSetting("openAccess", false);  // …and on now
    const back = await fetch(BASE + "/api/backup/restore?parts=database", {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/gzip" }, body: file });
    const j = await back.json();
    assert.deepEqual(j.restored, ["database"], JSON.stringify(j));
    // Staged for the next start, and that start swaps it in: the server's own restart.
    await restarted(boot0);
    ctx.db.close();
    const keys = ctx.db.raw.prepare("SELECT key FROM favourites ORDER BY key").all().map(x => x.key);
    assert.deepEqual(keys, ["then"], "the database as it was at the backup");
    assert.ok(!fs.existsSync(path.join(lib.data, "restore-staged.db")), "swapped in");
    const st = await fetch(BASE + "/api/backup", { headers: H });
    assert.equal(st.status, 200, "the same sign-in still works");
    assert.ok(fs.readdirSync(path.join(lib.data, "backups")).some(n => /^before-restore-.*\.db$/.test(n)), "the replaced one kept");
    // Whether a sign-in is asked for is today's, never the backup's (item 172).
    assert.equal(ctx.db.setting("openAccess"), false, "the sign-in still asked for");
    assert.equal((await fetch(BASE + "/api/status", { headers: { "X-Forwarded-For": "192.168.1.20" } })).status, 401);
  } finally { await srv.stop(); }
});

test("a database from before devices were marked made without a password: today's marks kept", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const { srv, ctx, boot0 } = await server(lib);
  try {
    const token = await signIn(BASE);
    // The backup's database as an older Mandarin's: no devices.joined (item 172). Taken with the
    // sign-in off and no token, as a signed-in device's is looked up by that column.
    ctx.db.setSetting("openAccess", true);
    ctx.db.raw.exec("ALTER TABLE devices DROP COLUMN joined");
    const r = await fetch(BASE + "/api/backup/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ include: { database: true } }) });
    assert.equal(r.status, 200);
    const file = Buffer.from(await r.arrayBuffer());
    ctx.db.raw.exec("ALTER TABLE devices ADD COLUMN joined INTEGER NOT NULL DEFAULT 0");
    ctx.db.setSetting("openAccess", false);
    ctx.db.raw.prepare("INSERT INTO devices(id, token_hash, name, kind, created_at, last_seen, last_ip, joined) VALUES('tv', 'h', 'TV', 'browser', 1, 1, '192.168.1.5', 1)").run();
    const back = await fetch(BASE + "/api/backup/restore?parts=database", {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/gzip" }, body: file });
    assert.deepEqual((await back.json()).restored, ["database"]);
    await restarted(boot0);
    ctx.db.close();
    const rows = ctx.db.raw.prepare("SELECT id, joined FROM devices").all();
    assert.equal(rows.length, 2);
    assert.equal(rows.find(d => d.id === "tv").joined, 1, "made without a password, still marked so");
    assert.equal(rows.find(d => d.id !== "tv").joined, 0, "signed in");
  } finally { await srv.stop(); }
});

test("this phone's own player follows it to its new id", { skip }, () => {
  const Database = require("better-sqlite3");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mbk-")), "x.db");
  let raw = new Database(file);
  raw.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE audio_devices(id TEXT PRIMARY KEY, kind TEXT, network_name TEXT, name TEXT, settings TEXT, first_seen INT, last_seen INT);`);
  const server = {
    settings: { radioZones: ["PHONE_old", "RINCON_1"] },
    devices: [{ id: "PHONE_old", kind: "phone", network_name: "Pixel", name: null, settings: '{"dsp":{"enabled":true}}', first_seen: 1, last_seen: 1 }]
  };
  raw.close();
  backup({ applies: [{ db: file, server, include: ["settings", "devices"], map: { PHONE_old: "PHONE_new" } }] });
  raw = new Database(file);
  assert.equal(raw.prepare("SELECT settings FROM audio_devices WHERE id = 'PHONE_new'").get().settings, '{"dsp":{"enabled":true}}');
  assert.deepEqual(JSON.parse(raw.prepare("SELECT value FROM settings WHERE key = 'radioZones'").get().value), ["PHONE_new", "RINCON_1"]);
});

test("kept on the server: saved, listed, downloaded, restored by id, deleted; a newer backup refused", { timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const { srv, ctx, boot0 } = await server(lib);
  try {
    const token = await signIn(BASE);
    const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    ctx.db.setSetting("smartPicksHour", 9);
    const s = await (await fetch(BASE + "/api/backup/save", { method: "POST", headers: H,
      body: JSON.stringify({ include: { settings: true }, page: { "rra-ui-cols": "2" }, label: "iPad" }) })).json();
    assert.equal(s.ok, true);
    assert.equal(s.backup.label, "iPad");
    const list = await (await fetch(BASE + "/api/backup", { headers: H })).json();
    assert.equal(list.backups[0].id, s.backup.id);
    const dl = byCs(await fetch(BASE + "/api/backup/download/" + s.backup.id, { headers: H }), "a download");
    assert.equal(dl.status, 200);
    assert.match(dl.headers.get("content-disposition"), /^attachment; filename="mandarin-backup-manual-\d{4}-\d\d-\d\d-\d{6}\.tar\.gz"$/);
    const got = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mbk-")), "dl.tar.gz");
    fs.writeFileSync(got, Buffer.from(await dl.arrayBuffer()));
    assert.equal(readBackup(got).parts.manifest.app, "mandarin", "read as written");
    ctx.db.setSetting("smartPicksHour", 3);
    const re = await (await fetch(BASE + "/api/backup/restore/" + s.backup.id, { method: "POST", headers: H,
      body: JSON.stringify({ include: { settings: true, page: true } }) })).json();
    assert.equal(ctx.db.setting("smartPicksHour"), 9);
    assert.deepEqual(re.page, { "rra-ui-cols": "2" });
    // The restore's restart (half a second on), seen through before anything more is asked: on a
    // busy machine the next request could otherwise reach the server as it starts again.
    await restarted(boot0);

    // Made by a newer Mandarin: refused, nothing changed.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mbk-"));
    const f = path.join(dir, "new.tar.gz");
    writeBackup(f, [
      { name: "manifest.json", data: { app: "mandarin", format: 1, version: "9.9.9", parts: ["settings"] } },
      { name: "server.json", data: { settings: { smartPicksHour: 1 } } }]);
    const no = await fetch(BASE + "/api/backup/restore?parts=settings", {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/gzip" }, body: fs.readFileSync(f) });
    assert.equal(no.status, 409);
    assert.match((await no.json()).error, /v9\.9\.9; update this server first/);
    assert.equal(ctx.db.setting("smartPicksHour"), 9);

    const del = await (byCs(await fetch(BASE + "/api/backup/" + s.backup.id, { method: "DELETE", headers: H }), "a delete")).json();
    assert.equal(del.ok, true);
  } finally { await srv.stop(); }
});

test("away from home (over Tailscale): back up to a file, keep one here, restore and delete, as at home", { timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const { srv, ctx, boot0 } = await server(lib);
  try {
    const token = await signIn(BASE);
    // Away: the request comes from a tailnet address.
    const H = { Authorization: "Bearer " + token, "X-Forwarded-For": "100.101.102.103" };
    const J = Object.assign({ "Content-Type": "application/json" }, H);
    assert.equal((await (await fetch(BASE + "/api/auth/status", { headers: H })).json()).away, true);
    ctx.db.setSetting("smartPicksHour", 8);
    // A device named as a browser's is ("iPhone · Safari"): the header carries
    // its name one byte a character, as the Node server wrote it (v0.8.22).
    ctx.db.raw.prepare("UPDATE devices SET name = ?").run("iPhone · Safari");
    const file = await fetch(BASE + "/api/backup/file", { method: "POST", headers: J, body: JSON.stringify({ include: { settings: true } }) });
    assert.equal(file.status, 200);
    // What the file holds, said up front for the app's list (v0.6.18).
    const said = JSON.parse(file.headers.get("x-mandarin-backup"));
    assert.deepEqual(said.parts, ["settings"]);
    assert.ok(said.created > 0 && /^\d+\.\d+\.\d+/.test(said.version), JSON.stringify(said));
    assert.equal(said.from, "iPhone · Safari");
    const body = Buffer.from(await file.arrayBuffer());
    const s = await (await fetch(BASE + "/api/backup/save", { method: "POST", headers: J, body: JSON.stringify({ include: { settings: true }, page: { "rra-ui-cols": "3" } }) })).json();
    assert.equal(s.ok, true);
    // Restored by id (this device's part only: no restart), deleted, then from the file.
    const byId = await fetch(BASE + "/api/backup/restore/" + s.backup.id, { method: "POST", headers: J, body: JSON.stringify({ include: { page: true } }) });
    assert.equal(byId.status, 200);
    assert.equal((await (await fetch(BASE + "/api/backup/" + s.backup.id, { method: "DELETE", headers: H })).json()).ok, true);
    ctx.db.setSetting("smartPicksHour", 2);
    const re = await fetch(BASE + "/api/backup/restore?parts=settings", {
      method: "POST", headers: Object.assign({ "Content-Type": "application/gzip" }, H), body });
    assert.equal(re.status, 200);
    assert.equal(ctx.db.setting("smartPicksHour"), 8);
    await restarted(boot0);
  } finally { await srv.stop(); }
});
