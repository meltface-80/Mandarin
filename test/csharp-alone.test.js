"use strict";
/*
 * csharp-alone.test.js — the C# server with no Node server anywhere (v0.8.50,
 * stage 7 part 1 of docs/specs/csharp-migration.md): started by test/server.js
 * as the image will start it, it stands on its own — the account and the
 * sign-in, the scan made at the start and the library read from it, the
 * pages, the rooms and devices (none here), a heart (the library's state its
 * own: the version moves and the copy is read again), /api/health — every
 * answer its own. Runs wherever the program is built, through the C# server
 * or not: nothing here is a Node server's.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("child_process");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeHousehold } = require("./fake-sonos");
const { FakeRenderer } = require("./fake-renderer");
const { start, built, BIN } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");

async function until(fn, ms = 30000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await new Promise(r => setTimeout(r, 100));
  }
}

test("the C# server alone: the account, the scan, the library, the pages, the rooms, a heart, health", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const PORT = ports.port();
  const srv = await start({ port: PORT, musicDir: lib.music, dataDir: lib.data });
  const B = srv.base;
  try {
    const ask = async (p, init = {}) => {
      const r = await fetch(B + p, init);
      return { status: r.status, by: r.headers.get("x-mandarin-answered") || "nobody", type: r.headers.get("content-type"), json: await r.clone().json().catch(() => null), text: await r.text() };
    };
    // Before the account: the sign-in state, the gate, the sign-in page.
    let x = await ask("/api/auth/status");
    assert.deepEqual([x.status, x.by, x.json.setup_required], [200, "C#", true]);
    x = await ask("/api/library/albums");
    assert.deepEqual([x.status, x.json.setup_required], [401, true]);
    x = await ask("/", { redirect: "manual" });
    assert.equal(x.status, 302, "to the sign-in page");
    x = await ask("/login");
    assert.deepEqual([x.status, x.by], [200, "C#"]);
    assert.match(x.text, /<html/i);
    // The account made, the sign-in (SRP, against this server alone).
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    // The scan made at the start: the three albums, read by this server from its own database.
    const st = await until(async () => { const s = (await ask("/api/status", { headers: H })).json; return s && s.index_count === 3 && !s.scanning && s; }, 60000, "the library");
    assert.equal(st.zone_count, 0, "no rooms here");
    x = await ask("/api/library/albums?sort=album", { headers: H });
    assert.deepEqual([x.status, x.by, x.json.total, x.json.albums.map(a => a.title)], [200, "C#", 3, ["Album One", "Best Of", "Hi Res"]]);
    const one = x.json.albums[0];
    x = await ask("/api/album?offset=" + one.offset, { headers: H });
    assert.deepEqual([x.status, x.json.tracks.length], [200, 3]);
    // The page and its files, Home's rows, the search: answered here.
    for (const p of ["/", "/app.js", "/api/home/history", "/api/home/unplayed", "/api/home/genre-groups", "/api/search?q=song", "/api/artists", "/api/library/facets",
      "/api/zones", "/api/outputs", "/api/audio-devices", "/api/filters/labels", "/api/filters/genres", "/api/library/folders"]) {
      x = await ask(p, { headers: H });
      assert.deepEqual([p, x.status, x.by], [p, 200, "C#"]);
    }
    assert.deepEqual((await ask("/api/zones", { headers: H })).json.zones, [], "no rooms, no phones");
    // A heart: written here, and the library's state moved by this server (the copy read again).
    x = await ask("/api/favourites", { method: "POST", headers: H, body: JSON.stringify({ offset: one.offset, on: true }) });
    assert.deepEqual([x.status, x.by, x.json.favourite], [200, "C#", true]);
    x = await ask("/api/library/albums?sort=album", { headers: H });
    assert.deepEqual(x.json.albums.map(a => [a.title, !!a.favourite]), [["Album One", true], ["Best Of", false], ["Hi Res", false]], "the heart shown at once");
    x = await ask("/api/favourites", { method: "POST", headers: H, body: JSON.stringify({ offset: one.offset, on: false }) });
    assert.equal((await ask("/api/library/albums?sort=album", { headers: H })).json.albums.some(a => a.favourite), false, "and taken off at once");
    // A change made to the database by hand (the tests, stage 7 part 2): told from this machine with the front
    // key, the copy is read again (the version moves; a mark the marks); without the key, not there.
    const told = async (headers, body) => ask("/internal/library/changed", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify(body) });
    x = await told({ "X-Mandarin-Front-Key": srv.key }, { marks: true });
    assert.deepEqual([x.status, x.json.ok, x.json.marks >= 1], [200, true, true], JSON.stringify(x.json));
    const v0 = x.json.version;
    x = await told({ "X-Mandarin-Front-Key": srv.key }, { edits: true });
    assert.equal(x.json.version, v0 + 1, "the version moved: the copy is read again");
    assert.equal((await told({}, { marks: true })).status, 404, "without the key: not there");
    // The tests' revision route (the hub's change counter set, then bumped), the hub's own.
    x = await ask("/internal/playback/revision", { method: "POST", headers: { "X-Mandarin-Front-Key": srv.key, "Content-Type": "application/json" }, body: JSON.stringify({ revision: 500 }) });
    assert.deepEqual([x.status, x.json.ok, x.json.revision >= 500], [200, true, true], JSON.stringify(x.json));
    // A cover drawn here: Best Of has none of its own, so its placeholder (its words too where this ffmpeg draws text).
    const best = (await ask("/api/library/albums?sort=album", { headers: H })).json.albums.find(a => a.title === "Best Of");
    x = await ask("/api/image/" + best.image_key + "?size=300", { headers: H });
    assert.deepEqual([x.status, x.by, x.type], [200, "C#", "image/jpeg"], "the placeholder");
    // The day's album and the week's label: this clock's day and week.
    x = await ask("/api/home/album-of-the-day", { headers: H });
    assert.deepEqual([x.status, x.by], [200, "C#"]);
    assert.match(String(x.json.day), /^\d{4}-\d{1,2}-\d{1,2}$/);
    // Health, open: this version, the rooms, the engines; nothing of a Node server to match.
    x = await ask("/api/health");
    assert.deepEqual([x.status, x.by, x.json.version, x.json.rooms, "csharp" in x.json], [200, "C#", require("../package.json").version, 0, false]);
    // The image's health check: the program asking itself on its port (0, the answer printed), and on one nothing holds (1).
    const health = (port) => spawnSync(BIN, ["--health"], { env: Object.assign({}, process.env, { PORT: String(port) }), encoding: "utf8", timeout: 20000 });
    let h = health(PORT);
    assert.deepEqual([h.status, JSON.parse(h.stdout).ok], [0, true], "--health on the server's port: " + h.stderr);
    h = health(ports.port());
    assert.deepEqual([h.status, h.stdout], [1, ""], "--health on an empty port: " + h.stderr);
    // The Node server's private addresses: nothing there to ask, 404 at the door as before.
    assert.equal((await ask("/internal/library", { headers: H })).status, 404);
    // What no route answers (stage 7 part 2): not there, as Express said it — an /api/ address as
    // JSON with its path under /api (the tag readers' check among them, gone with the Node reader), the rest finalhandler's page.
    for (const p of ["/api/no-such-thing", "/api/tagcheck", "/api/tagcheck/report"]) {
      x = await ask(p, { headers: H });
      assert.deepEqual([p, x.status, x.by, x.json], [p, 404, "C#", { error: "No such endpoint: GET " + p.slice(4) }]);
    }
    x = await ask("/nothing-here", { method: "POST", headers: H });
    assert.deepEqual([x.status, x.by, /<pre>Cannot POST \/nothing-here<\/pre>/.test(x.text)], [404, "C#", true]);
    // A renderer's event: taken by the hub (200, whoever it is from), as the Node server took it.
    x = await ask("/upnp/event/uuid:nobody", { method: "NOTIFY", headers: { "Content-Type": "text/xml", NT: "upnp:event", NTS: "upnp:propchange", SID: "uuid:x" }, body: "<e:propertyset xmlns:e=\"urn:schemas-upnp-org:event-1-0\"/>" });
    assert.deepEqual([x.status, x.by], [200, "C#"]);
    // Forgot the password (reset-password.js as a subcommand, stage 7 part 2): the account removed and every
    // device signed out while the server runs — its gate reads the database on each request; then nothing to remove.
    const reset = () => spawnSync(BIN, ["reset-password"], { env: Object.assign({}, process.env, { DATA_DIR: lib.data }), encoding: "utf8", timeout: 20000 });
    let rp = reset();
    assert.deepEqual([rp.status, /^The account "tester" was removed and 1 device\(s\) signed out\.$/m.test(rp.stdout)], [0, true], rp.stdout + rp.stderr);
    assert.deepEqual([(await ask("/api/auth/status")).json.setup_required, (await ask("/api/library/albums", { headers: H })).status], [true, 401]);
    rp = reset();
    assert.deepEqual([rp.status, /^There was no account to remove\.$/m.test(rp.stdout)], [0, true], rp.stdout + rp.stderr);
  } finally { await srv.stop(); }
});

/*
 * Playback alone: the household at SONOS_HOSTS (Config.cs) found by this
 * server's hub, the phone's hello, a renderer at UPNP_HOSTS in the device
 * list and, switched on, a zone; a play on a room — the speaker fetches the
 * track from this server's own address (Library.State.cs LocalBaseUrl:
 * SERVER_IP and the port, with no Node server to say it).
 */
test("the C# server alone: the rooms from a fake household, a phone's hello, a renderer, a play", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const wiim = new FakeRenderer({ name: "WiiM Pro Plus", manufacturer: "Linkplay Technology Inc.", model: "WiiM Pro Plus", linkplay: { DeviceName: "Living Room WiiM" } });
  await wiim.start();
  const PORT = ports.port();
  const srv = await start({ port: PORT, musicDir: lib.music, dataDir: lib.data, env: { SONOS_HOSTS: ports.host(0), UPNP_HOSTS: wiim.location } });
  const B = srv.base;
  try {
    const token = await signIn(B);  // kind "android": the phone
    const api = async (method, p, body) => {
      const r = await fetch(B + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, by: r.headers.get("x-mandarin-answered") || "nobody", json: await r.json().catch(() => null) };
    };
    const zones = async () => (await api("GET", "/api/zones")).json.zones;
    // The rooms: the two of the household, read by this server's hub from the one address it was given.
    const rooms = await until(async () => { const z = (await zones()).filter(z => !z.is_phone); return z.length === 2 && z; }, 30000, "the rooms");
    assert.deepEqual(rooms.map(z => z.display_name).sort(), ["Kitchen", "Study"]);
    assert.equal((await api("GET", "/api/health")).json.rooms, 2);
    const st = await until(async () => { const s = (await api("GET", "/api/status")).json; return s && s.index_count === 3 && s; }, 60000, "the library");
    assert.deepEqual([st.zone_count, st.sonos.rooms], [2, 2]);
    // The phone's hello: a zone of its own, "This phone" to itself.
    const h = await api("POST", "/api/phone/hello", { name: "Pixel 8" });
    assert.deepEqual([h.status, h.by, /^PHONE_/.test(h.json.zone_id)], [200, "C#", true]);
    const mine = (await zones()).find(z => z.zone_id === h.json.zone_id);
    assert.deepEqual([mine.display_name, mine.is_phone], ["This phone", true]);
    // The renderer: found at its address, off until switched on, then a zone under its own name.
    const W = "UPNP_" + wiim.udn.replace(/^uuid:/, "");
    await until(async () => (await api("GET", "/api/audio-devices")).json.devices.some(d => d.id === W), 30000, "the renderer in the device list");
    assert.ok(!(await zones()).some(z => z.zone_id === W), "off until switched on");
    const on = await api("PATCH", "/api/audio-devices/" + W, { enabled: true });
    assert.deepEqual([on.status, on.by, on.json.enabled], [200, "C#", true]);
    const wz = await until(async () => (await zones()).find(z => z.zone_id === W), 30000, "the renderer as a zone");
    assert.equal(wz.display_name, "Living Room WiiM");
    // A play on the Kitchen: the speaker is handed the album and fetches the track from this server.
    const kitchen = rooms.find(z => z.display_name === "Kitchen");
    const cd = (await api("GET", "/api/library/albums?sort=album")).json.albums.find(a => a.title === "Album One");
    const play = await api("POST", "/api/play", { offset: cd.offset, zone_or_output_id: kitchen.zone_id, kind: "play_now" });
    assert.deepEqual([play.status, play.by], [200, "C#"], JSON.stringify(play.json));
    await until(() => house.room("Kitchen").state === "PLAYING", 30000, "the Kitchen playing");
    const f = await until(() => house.room("Kitchen").fetches.find(x => x.done), 30000, "the speaker's fetch");
    assert.equal(f.status, 200, "the track, from this server: " + f.uri + " gave " + f.status + " " + (f.error || ""));
    assert.ok(f.uri.startsWith(B + "/stream/"), "at this server's own address: " + f.uri);
    const playing = await until(async () => { const z = (await api("GET", "/api/zone-state?zone=" + kitchen.zone_id)).json.zone; return z && z.state === "playing" && z.now_playing && z; }, 30000, "now playing");
    assert.equal(playing.now_playing.line1, "Song 1");
  } finally { await srv.stop(); await house.stop(); await wiim.stop(); }
});
