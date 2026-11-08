// @ts-check
/*
 * A speaker asking by its own address, unsigned (item 369, the security audit's eighth finding): let have the streams
 * and covers this server handed it, and nothing else. Before, a request from any speaker's address got every stream
 * and every cover, so a speaker that wasn't to be trusted could copy the whole library.
 *
 *   - before any play: a track and a cover asked for unsigned from a speaker's address are turned away;
 *   - a play on the Kitchen: the track handed to it, and its cover, asked for with no signature from the Kitchen are sent;
 *     another album's track is not; the handed track from an address that is no speaker's is not;
 *   - after a restart: what was handed out is still let through (kept in the database), a queue made before it plays.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeHousehold } = require("./fake-sonos");
const { start, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");

/** @param {() => any} fn @param {number} ms @param {string} what */
async function until(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await new Promise(r => setTimeout(r, 200));
  }
}

/** GET [url] from [localAddress], no token: its status. @param {string} url @param {string} localAddress */
function ask(url, localAddress) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const r = http.get({ host: u.hostname, port: u.port, path: u.pathname + u.search, localAddress, agent: false }, (x) => { x.resume(); resolve(x.statusCode); });
    r.on("error", (e) => resolve(e.message));
  });
}

/** [url] without its signature. @param {string} url */
const unsigned = (url) => { const u = new URL(url); u.searchParams.delete("s"); return u.toString(); };

test("a speaker asking by its own address gets what it was handed, and nothing else (item 369)", { skip, timeout: 180000 }, async () => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const PORT = ports.port();
  const opts = { port: PORT, musicDir: lib.music, dataDir: lib.data, env: { SONOS_HOSTS: ports.host(0) } };
  let srv = await start(opts);
  const B = srv.base;
  const kitchenIp = ports.host(0), stranger = ports.host(3);   // the Kitchen's address (fake-sonos.js), and no speaker's
  try {
    const token = await signIn(B);
    /** @param {string} p */
    const get = async (p) => (await fetch(B + p, { headers: { Authorization: "Bearer " + token } })).json();
    const rooms = await until(async () => { const z = (await get("/api/zones")).zones.filter((/** @type {any} */ z) => !z.is_phone); return z.length === 2 && z; }, 30000, "the rooms");
    await until(async () => (await get("/api/status")).index_count === 3, 60000, "the library");
    const albums = (await get("/api/library/albums?sort=album")).albums;
    const one = albums.find((/** @type {any} */ a) => a.title === "Album One"), other = albums.find((/** @type {any} */ a) => a !== one && a.image_key);

    // Nothing handed out yet: a speaker unsigned is turned away, as anyone is.
    assert.equal(await ask(`${B}/api/image/${encodeURIComponent(one.image_key)}?size=600`, kitchenIp), 401, "a cover never handed out");
    assert.equal(await ask(`${B}/stream/t1.flac`, kitchenIp), 401, "a track never handed out yet");

    // A play on the Kitchen: the speaker is handed the album, and fetches it.
    const kitchen = rooms.find((/** @type {any} */ z) => z.display_name === "Kitchen");
    const play = await fetch(B + "/api/play", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ offset: one.offset, zone_or_output_id: kitchen.zone_id, kind: "play_now" }) });
    assert.equal(play.status, 200);
    const f = await until(() => house.room("Kitchen").fetches.find((/** @type {any} */ x) => x.done), 30000, "the speaker's fetch");
    assert.equal(f.status, 200, "signed, as handed: " + f.uri);
    const q = house.room("Kitchen").queue;
    const art = (/<upnp:albumArtURI>([^<]+)</.exec(q[0].meta.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")) || [])[1];
    assert.ok(art, "the cover handed with the track: " + q[0].meta.slice(0, 200));
    const cover = art.replace(/&amp;/g, "&");
    // A track of the library (seven, ids 1 to 7) that isn't in the Kitchen's queue: never handed out.
    const queued = q.map((/** @type {any} */ x) => Number((/\/stream\/t(\d+)/.exec(x.uri) || [])[1]));
    const otherTrack = [1, 2, 3, 4, 5, 6, 7].find(id => !queued.includes(id));
    assert.ok(otherTrack && queued.every((/** @type {number} */ id) => id > 0), "a track not handed out: queued " + queued.join(", "));

    // Unsigned, from the Kitchen: what it was handed is sent.
    assert.equal(await ask(unsigned(f.uri), kitchenIp), 200, "the track handed to it, its signature dropped: " + unsigned(f.uri));
    assert.equal(await ask(unsigned(cover), kitchenIp), 200, "its cover, its signature dropped: " + unsigned(cover));
    // And nothing else: another album's track, never handed; the handed one from an address that is no speaker's.
    assert.equal(await ask(`${B}/stream/t${otherTrack}.flac`, kitchenIp), 401, "another album's track, never handed out");
    assert.equal(await ask(`${B}/api/image/${encodeURIComponent(other.image_key)}?size=600`, kitchenIp), 401, "another album's cover, never handed out");
    assert.equal(await ask(unsigned(f.uri), stranger), 401, "no speaker's address: the handed track turned away unsigned");

    // A restart: what was handed out is kept, so the queue it made still plays.
    await new Promise(r => setTimeout(r, 2500));   // written within two seconds of being handed out
    await srv.stop();
    srv = await start(opts);
    await until(async () => (await (await fetch(B + "/api/health")).json()).rooms >= 2, 30000, "the rooms again");
    assert.equal(await ask(unsigned(f.uri), kitchenIp), 200, "after a restart: the track handed before it");
    assert.equal(await ask(`${B}/api/image/${encodeURIComponent(other.image_key)}?size=600`, kitchenIp), 401, "after a restart: still nothing else");
  } finally { await srv.stop(); await house.stop(); }
});
