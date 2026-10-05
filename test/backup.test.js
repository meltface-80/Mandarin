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
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const B = require("../lib/backup");
const { newer, partsOf } = require("../lib/server/api-backup");

const PORT = 3625, BASE = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function server(lib, exits) {
  delete require.cache[require.resolve("../index.js")];
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [],
    upnpMulticast: false, identify: false, exitProcess: c => exits.push(c), powerEnv: {}, powerPlatform: "linux" });
  const ctx = await srv.start();
  return { srv, ctx };
}

test("versions compare, parts are read", () => {
  assert.equal(newer("0.6.14", "0.6.9"), true);
  assert.equal(newer("0.6.9", "0.6.14"), false);
  assert.equal(newer("0.6.14", "0.6.14"), false);
  assert.equal(newer("0.6.0", "0.6.0-RC4"), true);
  assert.equal(newer("0.6.0-RC4", "0.6.0"), false);
  assert.deepEqual(partsOf("settings,keys,bogus"), { settings: true, keys: true });
  assert.deepEqual(partsOf({ database: 1, page: true, devices: false }), { database: true, page: true, devices: false });
});

test("the file format: written and read back, the database copy to its own file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mbk-"));
  const db = path.join(dir, "x.db");
  fs.writeFileSync(db, Buffer.alloc(70000, 7));
  const out = path.join(dir, "b.tar.gz");
  await B.writeBackup(fs.createWriteStream(out), [
    { name: "manifest.json", data: { app: "mandarin", format: 1 } },
    { name: "server.json", data: { settings: { homeRows: [1, 2] } } },
    { name: "musicd.db", file: db }
  ]);
  const back = path.join(dir, "back.db");
  const r = await B.readBackup(fs.createReadStream(out), { dbFile: back });
  assert.equal(r.hasDb, true);
  assert.deepEqual(r.parts.server, { settings: { homeRows: [1, 2] } });
  assert.ok(fs.readFileSync(back).equals(fs.readFileSync(db)));
  // Not ours: refused.
  const other = path.join(dir, "o.tar.gz");
  await B.writeBackup(fs.createWriteStream(other), [{ name: "manifest.json", data: { app: "else" } }]);
  await assert.rejects(B.readBackup(fs.createReadStream(other)), /isn't a Mandarin backup/);
});

test("back up, change everything, restore: as it was, with a Before-restore backup and a restart", { timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const exits = [];
  let { srv, ctx } = await server(lib, exits);
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

    const r = await fetch(BASE + "/api/backup/file", { method: "POST", headers: H,
      body: JSON.stringify({ include: ["settings", "devices", "collection", "keys"], page: { "rra-ui-text": "1.25" } }) });
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

    const back = await fetch(BASE + "/api/backup/restore?parts=settings,devices,collection,keys,page", {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/gzip" }, body: file });
    const j = await back.json();
    assert.equal(back.status, 200, JSON.stringify(j));
    assert.deepEqual(j.restored.sort(), ["collection", "devices", "keys", "page", "settings"]);
    assert.deepEqual(j.page, { "rra-ui-text": "1.25" });
    assert.equal(j.restarting, true);
    assert.equal(db.setting("smartPicksHour"), 7);
    assert.equal(db.setting("displayEnabled", "default"), "default");
    assert.equal(db.setting("discogsToken"), "secret-token");
    assert.deepEqual(db.setting("userPlaylists"), [{ id: "p1", name: "Mine" }]);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM favourites").get().n, 1);
    assert.deepEqual(db.raw.prepare("SELECT name, settings FROM audio_devices WHERE id = 'uuid:wiim'").get(), { name: "Lounge", settings: '{"mode":"x2"}' });

    const list = await (await fetch(BASE + "/api/backup", { headers: H })).json();
    assert.equal(list.backups.filter(b => b.kind === "auto" && b.label === "Before restore").length, 1);
    for (let i = 0; i < 20 && !exits.length; i++) await sleep(100);
    assert.deepEqual(exits, [75], "restarted");
  } finally { try { await srv.stop(); } catch (e) { /* stopped by the restart */ } }
});

test("the whole database: restored at the next start, today's account and sign-ins kept", { timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const exits = [];
  let { srv, ctx } = await server(lib, exits);
  const token = await signIn(BASE);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  ctx.db.raw.prepare("INSERT INTO favourites(key, added_at) VALUES('then', 1)").run();
  const r = await fetch(BASE + "/api/backup/file", { method: "POST", headers: H, body: JSON.stringify({ include: { database: true } }) });
  const file = Buffer.from(await r.arrayBuffer());
  ctx.db.raw.prepare("INSERT INTO favourites(key, added_at) VALUES('later', 2)").run();
  const back = await fetch(BASE + "/api/backup/restore?parts=database", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/gzip" }, body: file });
  const j = await back.json();
  assert.deepEqual(j.restored, ["database"], JSON.stringify(j));
  assert.ok(fs.existsSync(path.join(lib.data, "restore-staged.db")), "staged for the next start");
  for (let i = 0; i < 20 && !exits.length; i++) await sleep(100);
  try { await srv.stop(); } catch (e) { /* already */ }

  ({ srv, ctx } = await server(lib, exits));
  try {
    const keys = ctx.db.raw.prepare("SELECT key FROM favourites ORDER BY key").all().map(x => x.key);
    assert.deepEqual(keys, ["then"], "the database as it was at the backup");
    const st = await fetch(BASE + "/api/backup", { headers: H });
    assert.equal(st.status, 200, "the same sign-in still works");
    assert.ok(fs.readdirSync(path.join(lib.data, "backups")).some(n => /^before-restore-.*\.db$/.test(n)), "the replaced one kept");
  } finally { await srv.stop(); }
});

test("this phone's own player follows it to its new id", () => {
  const Database = require("better-sqlite3");
  const raw = new Database(":memory:");
  raw.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE audio_devices(id TEXT PRIMARY KEY, kind TEXT, network_name TEXT, name TEXT, settings TEXT, first_seen INT, last_seen INT);`);
  const server = {
    settings: { radioZones: ["PHONE_old", "RINCON_1"] },
    devices: [{ id: "PHONE_old", kind: "phone", network_name: "Pixel", name: null, settings: '{"dsp":{"enabled":true}}', first_seen: 1, last_seen: 1 }]
  };
  B.apply(raw, server, { settings: true, devices: true }, { map: { PHONE_old: "PHONE_new" } });
  assert.equal(raw.prepare("SELECT settings FROM audio_devices WHERE id = 'PHONE_new'").get().settings, '{"dsp":{"enabled":true}}');
  assert.deepEqual(JSON.parse(raw.prepare("SELECT value FROM settings WHERE key = 'radioZones'").get().value), ["PHONE_new", "RINCON_1"]);
});

test("kept on the server: saved, listed, downloaded, restored by id, deleted; a newer backup refused", { timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const exits = [];
  const { srv, ctx } = await server(lib, exits);
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
    const dl = await fetch(BASE + "/api/backup/download/" + s.backup.id, { headers: H });
    assert.equal(dl.status, 200);
    ctx.db.setSetting("smartPicksHour", 3);
    const re = await (await fetch(BASE + "/api/backup/restore/" + s.backup.id, { method: "POST", headers: H,
      body: JSON.stringify({ include: { settings: true, page: true } }) })).json();
    assert.equal(ctx.db.setting("smartPicksHour"), 9);
    assert.deepEqual(re.page, { "rra-ui-cols": "2" });

    // Made by a newer Mandarin: refused, nothing changed.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mbk-"));
    const f = path.join(dir, "new.tar.gz");
    await B.writeBackup(fs.createWriteStream(f), [
      { name: "manifest.json", data: { app: "mandarin", format: 1, version: "9.9.9", parts: ["settings"] } },
      { name: "server.json", data: { settings: { smartPicksHour: 1 } } }]);
    const no = await fetch(BASE + "/api/backup/restore?parts=settings", {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/gzip" }, body: fs.readFileSync(f) });
    assert.equal(no.status, 409);
    assert.match((await no.json()).error, /v9\.9\.9; update this server first/);
    assert.equal(ctx.db.setting("smartPicksHour"), 9);

    const del = await (await fetch(BASE + "/api/backup/" + s.backup.id, { method: "DELETE", headers: H })).json();
    assert.equal(del.ok, true);
    // The restore's restart, before the next test takes the port.
    for (let i = 0; i < 20 && !exits.length; i++) await sleep(100);
  } finally { try { await srv.stop(); } catch (e) { /* stopped by the restart */ } }
});

test("away from home (over Tailscale): back up to a file, keep one here, restore and delete, as at home", { timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const exits = [];
  const { srv, ctx } = await server(lib, exits);
  try {
    const token = await signIn(BASE);
    // Away: the request comes from a tailnet address.
    const H = { Authorization: "Bearer " + token, "X-Forwarded-For": "100.101.102.103" };
    const J = Object.assign({ "Content-Type": "application/json" }, H);
    assert.equal((await (await fetch(BASE + "/api/auth/status", { headers: H })).json()).away, true);
    ctx.db.setSetting("smartPicksHour", 8);
    const file = await fetch(BASE + "/api/backup/file", { method: "POST", headers: J, body: JSON.stringify({ include: { settings: true } }) });
    assert.equal(file.status, 200);
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
    for (let i = 0; i < 20 && !exits.length; i++) await sleep(100);
    assert.deepEqual(exits, [75], "and the server restarted");
  } finally { try { await srv.stop(); } catch (e) { /* stopped by the restart */ } }
});
