"use strict";
/*
 * Addresses handed to speakers and players expire (item 368, the security audit's seventh finding). A signed address
 * carried an HMAC of its path alone and never expired, so one that leaked gave its holder that track for good. Each
 * address handed out now carries its expiry in its signature (s=<the 22>.<thirty days on>), the 22 of the path and the
 * expiry: it plays until then; a changed expiry, or a past one, is refused. One signed by the path alone, as every one
 * was before, is taken for thirty days from the first start of this version (nothing queued stops at the update), then
 * never again.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const path = require("path");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { FakeSlim } = require("./fake-slim");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), SLIM = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 20000) { const t0 = Date.now(); for (;;) { const v = await Promise.resolve().then(fn).catch(() => null); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(100); } }

test("an address handed to a player: good until its expiry, never past it, never with its expiry changed", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  gen(path.join(lib.music, "Artist E", "Expiring", "01 One.flac"), { seconds: 2, tags: { title: "One", artist: "Artist E", album: "Expiring", track: 1 } });
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, slimprotoPort: SLIM });
  const ctx = await srv.start();
  const player = new FakeSlim({ port: SLIM, name: "Kitchen", seconds: 2 });
  t.after(async () => { player.close(); await srv.stop(); });
  const token = await signIn(B);
  const call = async (method, p, body) => { const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined }); return Object.assign({ status: r.status }, await r.json().catch(() => ({}))); };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  await until(async () => (await api("status")).index_count >= 2, 30000);
  await player.connect();
  const ID = "SLIM_020000000031";
  await until(async () => (await api("audio-devices")).devices.find(x => x.id === ID));
  assert.equal((await call("PATCH", "audio-devices/" + ID, { enabled: true })).status, 200);
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === ID));
  const album = (await api("library/albums?sort=album")).albums.find(a => a.title === "Expiring");
  assert.equal((await api("play", { offset: album.offset, zone_or_output_id: ID, kind: "play_now" })).status, 200);
  const given = await until(() => player.current());

  // As handed out: its expiry, about thirty days on, then its signature; it plays.
  const m = /^(\/stream\/[^?]+)\?(?:.*&)?s=([A-Za-z0-9_-]{22})\.(\d+)$/.exec(given);
  assert.ok(m, "an expiry and a signature: " + given);
  const days = (Number(m[3]) - Date.now() / 1000) / 86400;
  assert.ok(days > 29.9 && days <= 30.01, "good for thirty days: " + days);
  const get = async (u) => (await fetch(B + u)).status;
  assert.equal(await get(given), 200, "it plays");
  // Its expiry changed: refused (the signature is of the path and the expiry).
  assert.equal(await get(given.replace("." + m[3], "." + (Number(m[3]) + 86400 * 365))), 401, "a later expiry written in: refused");
  // Signed for a time already past, with the install's secret: refused.
  const secret = ctx.db.setting("authSecret", "");
  const past = String(Math.floor(Date.now() / 1000) - 60);
  const sig = crypto.createHmac("sha256", secret).update(m[1] + "\ne=" + past).digest("base64url").slice(0, 22);
  assert.equal(await get(`${m[1]}?s=${sig}.${past}`), 401, "past its expiry: refused");
  // Signed by the path alone, as before this version: taken while the thirty days from the update run, then not.
  const legacy = ctx.auth.signUrl(m[1]);
  assert.equal(await get(legacy), 200, "an address from before the update, within its thirty days: plays");
  ctx.db.setSetting("linksLegacyUntil", Math.floor(Date.now() / 1000) - 1);
  await ctx.restart(token);   // read again as it starts
  assert.equal(await get(legacy), 401, "after them: refused");
  assert.equal(await get(given), 200, "an address with its expiry still plays");
});
