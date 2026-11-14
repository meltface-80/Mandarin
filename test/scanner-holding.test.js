"use strict";
/*
 * What holds the Album Scanner (bug list item 417b, Playback/Hub.Heard.cs, Identify/ScannerHeld.cs). The owner's
 * Library Scanner said "Paused while music plays" all evening with nothing of Mandarin's playing: their Sonos Beam,
 * hidden in Mandarin, was playing a film from the TV, and Hub.PlayingNow counted every room that said PLAYING. Now:
 *   - a room hidden or switched off in Audio Devices never counts;
 *   - a room counts only while it plays Mandarin's own music: a Sonos on its TV input (x-sonos-htastream:) doesn't, nor
 *     a renderer playing another app's address; the same Sonos playing one of this server's streams does;
 *   - what holds it is named: GET /api/album-scanner's now.holding, the readout ("Paused while music plays in Lounge",
 *     drawn at a phone's 412 by 800), and the log, once when held and once when let go.
 * A Sonos of the test's own and a renderer of its own (a WiiM) play an album of the library, then something else.
 */
const test = require("node:test");
const assert = require("node:assert");
const ports = require("./ports");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeHousehold } = require("./fake-sonos");
const { FakeRenderer, idFor } = require("./fake-renderer");
const { Browser, findBrowser } = require("./browser-harness");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const noBrowser = !findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)";
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const LOUNGE = "RINCON_LOUNGE001400";
const TV = "x-sonos-htastream:" + LOUNGE + ":spdif";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function until(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(200);
  }
}

// Settings → Library Scanner opened at a phone's size: its Now line, and whether the page is wider than the phone.
const NOW_LINE = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  await until(() => document.getElementById("settings-toggle"));
  const navItem = () => document.querySelector('#settings-overlay .settings-nav-item[data-pane="identify"]');
  document.getElementById("settings-toggle").click(); for (let i = 0; i < 200 && !(navItem() && navItem().offsetParent); i++) await sleep(25);
  navItem().click();
  const now = () => document.querySelector("[data-parity='settings-scanner.now']");
  await until(() => now() && /Lounge/.test(now().textContent));
  const r = now() && now().getBoundingClientRect();
  return { text: now() ? now().textContent : null, inside: !!r && r.left >= 0 && r.right <= innerWidth, wide: document.documentElement.scrollWidth > innerWidth };
})()`;

test("only Mandarin's music, in a room in use, holds the Album Scanner, and what holds it is named", { skip, timeout: 240000 }, async (t) => {
  const lib = makeLibrary();
  const house = new FakeHousehold([{ uid: LOUNGE, name: "Lounge", ip: ports.host(0), model: "Sonos Beam" }]);
  await house.start();
  const wiim = new FakeRenderer({ name: "WiiM", manufacturer: "Linkplay Technology Inc.", model: "WiiM Pro" });
  await wiim.start();
  const room = house.room("Lounge");
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpHosts: [wiim.location], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  t.after(async () => { await srv.stop(); await house.stop(); await wiim.stop(); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  const now = async () => (await api("album-scanner")).now;
  const playing = async () => (await now()).reason === "playing";
  const said = re => ctx.logs.filter(l => re.test(l));
  await until(async () => (await api("status")).index_count > 0, 30000, "the library");
  await until(async () => ((await api("zones")).zones || []).some(z => z.zone_id === LOUNGE), 30000, "the Sonos room");
  const album = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");
  assert.equal((await api("album-scanner", { on: true, schedule: false })).on, true);
  assert.equal(await playing(), false, "nothing plays yet");
  const playIn = async zone => assert.equal((await api("play", { offset: album.offset, zone_or_output_id: zone, kind: "play_now" })).status, 200);

  await t.test("a Sonos playing an album of the library holds it, named, in the readout and once in the log", async () => {
    await playIn(LOUNGE);
    await until(() => room.queue.length === 3 && room.state === "PLAYING", 15000, "the album given the Sonos");
    assert.match(room.queue[0].uri, new RegExp("^" + B.replace(/\./g, "\\.") + "/stream/"), "one of this server's streams");
    const n = await until(async () => { const x = await now(); return x.reason === "playing" && x; }, 15000, "the Sonos playing");
    assert.equal(n.holding.length, 1);
    assert.deepEqual([n.holding[0].kind, n.holding[0].name, n.holding[0].state], ["room", "Lounge", "playing"]);
    assert.ok(n.holding[0].since > 0 && n.holding[0].heard >= n.holding[0].since, JSON.stringify(n.holding[0]));
    // At a phone's size, the readout says where.
    if (!noBrowser) {
      const b = await Browser.launch({ width: 412, height: 800 });
      try {
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true });
        const r = await page.eval(NOW_LINE);
        assert.deepEqual(page.errors, []);
        assert.deepEqual(r, { text: "Paused while music plays in Lounge", inside: true, wide: false });
      } finally { await b.close(); }
    }
    await sleep(3000);
    assert.deepEqual(said(/\[scanner\] held:/).map(l => l.replace(/^.*\[scanner\] /, "").replace(/since \S+, last heard \d+ s ago/, "since …")),
      ["held: Lounge playing (the Sonos says PLAYING since …)"], "held: said once, not at every ask");
    // Paused: let go, said once.
    room.state = "PAUSED_PLAYBACK";
    await until(async () => !await playing(), 15000, "the Sonos paused");
    await sleep(3000);
    assert.equal(await playing(), false);
    assert.equal(said(/\[scanner\] going on: nothing playing/).length, 1, "let go: said once");
    assert.equal(said(/\[scanner\] held:/).length, 1);
  });

  await t.test("the same Sonos playing the TV is no music of Mandarin's", async () => {
    room.queue = [{ uri: TV, meta: "" }];
    room.track = 1;
    room.currentUri = TV;
    room.state = "PLAYING";
    room.setPos(600);
    await until(async () => { const z = (await api("zone-state?zone=" + LOUNGE)).zone; return z && z.state === "playing"; }, 15000, "the Sonos read playing the TV");
    await sleep(2500);
    assert.equal(await playing(), false, "a Sonos playing its TV input held the Album Scanner");
    assert.deepEqual((await now()).holding, []);
  });

  await t.test("a Sonos hidden, or switched off, in Audio Devices never holds it, playing Mandarin's music or not", async () => {
    await playIn(LOUNGE);
    await until(() => room.queue.length === 3 && room.state === "PLAYING", 15000, "the album given the Sonos again");
    await until(playing, 15000, "the Sonos playing the album again");
    await until(async () => (await api("audio-devices")).devices.some(d => d.id === LOUNGE), 20000, "the Sonos in Audio Devices");
    assert.equal((await call("PATCH", "audio-devices/" + LOUNGE, { hidden: true })).status, 200);
    await until(async () => !await playing(), 15000, "the hidden Sonos let go of");
    await sleep(2500);
    assert.equal(await playing(), false, "a hidden Sonos playing held the Album Scanner");
    assert.equal(room.state, "PLAYING", "still playing: hiding a Sonos doesn't stop it");
    // Shown again, but switched off (hiding switched it off): still not; switched on, it holds it again.
    assert.equal((await call("PATCH", "audio-devices/" + LOUNGE, { hidden: false })).status, 200);
    await sleep(2500);
    assert.equal(await playing(), false, "a Sonos switched off held the Album Scanner");
    assert.equal((await call("PATCH", "audio-devices/" + LOUNGE, { enabled: true })).status, 200);
    await until(playing, 15000, "the Sonos shown and on again");
    room.state = "PAUSED_PLAYBACK";
    await until(async () => !await playing(), 15000, "the Sonos paused again");
  });

  await t.test("a renderer holds it while it plays Mandarin's stream, not while it plays another app's", async () => {
    const W = idFor(wiim.udn);
    await until(async () => (await api("audio-devices")).devices.some(x => x.id === W), 20000, "the WiiM");
    assert.equal((await call("PATCH", "audio-devices/" + W, { enabled: true })).status, 200);
    await until(async () => (await api("zones")).zones.some(z => z.zone_id === W), 20000, "the WiiM's zone");
    const name = (await api("zones")).zones.find(z => z.zone_id === W).display_name;
    await playIn(W);
    await until(() => wiim.state === "PLAYING" && wiim.uri.startsWith(B + "/stream/"), 20000, "the album given the WiiM");
    wiim.hold();   // its tracks are 3 s: playing on, its clock stopped
    // Read playing (not only loading, as the play left it): held by it.
    const n = await until(async () => { const x = await now(); return x.reason === "playing" && x.holding.length && x.holding[0].state === "playing" && x; }, 15000, "the WiiM playing");
    assert.deepEqual(n.holding.map(h => [h.kind, h.name]), [["room", name]]);
    await sleep(2500);
    assert.equal(await playing(), true, "the WiiM playing Mandarin's stream");
    // Another app plays on it: its address isn't this server's.
    wiim.uri = wiim.setUri = "http://192.0.2.10:8080/another-app/track.flac";
    wiim.meta = "";
    await until(async () => !await playing(), 15000, "the WiiM playing another app's");
    await sleep(2500);
    assert.equal(wiim.state, "PLAYING");
    assert.equal(await playing(), false, "a renderer playing another app's address held the Album Scanner");
  });
});
