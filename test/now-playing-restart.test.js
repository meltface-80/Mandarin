"use strict";
/*
 * Now playing after the server started again (v0.8.46). The owner left the
 * Android app for another, came back, and played a track further down the
 * queue: it played, but Now playing kept the track from before, and only
 * closing the app and opening it again put it right.
 *
 * Every answer the page polls for carries the server's change counter, and
 * the page drops one older than the last it painted (a slow one-off answer
 * landing after a newer one). The counter starts again at 1 when the server
 * does (an update, a restore), so a page kept from before took every answer
 * after it for an old one: the screen stayed as it was, and the page asked
 * four times a second, the server answering at once each time.
 *
 * Now a counter below the one the page waited on is taken for what it is: the
 * server's counter now.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(100);
  }
}

test("Now playing follows the room after the server started again", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  t.after(async () => { await srv.stop(); await house.stop(); });
  const token = await signIn(B);
  const api = async (p, body) => {
    const r = await fetch(B + "/api/" + p, body ? { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : { headers: { Authorization: "Bearer " + token } });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  await until(async () => (await api("status")).index_count === 3);
  const kitchen = (await until(async () => (await api("zones")).zones.find(z => z.display_name === "Kitchen"))).zone_id;
  const one = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");
  const room = house.room("Kitchen");
  assert.equal((await api("play", { offset: one.offset, zone_or_output_id: kitchen, kind: "play_now" })).status, 200);
  assert.ok(await until(() => room.queue.length === 3 && room.state === "PLAYING"), "playing");
  // A server that has been up a while: its counter well along.
  ctx.zones.revision = 5000;
  ctx.zones.bump();

  const b = await Browser.launch({ width: 390, height: 844 });
  t.after(() => b.close());
  const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true,
    init: `localStorage.setItem("rra-zone", ${JSON.stringify(kitchen)});` });
  const TITLE = `document.getElementById("mt-title").textContent`;
  const shows = (title, ms) => until(async () => (await page.eval(TITLE)) === title, ms);
  assert.ok(await shows("Song 1", 20000), "Now playing: " + await page.eval(TITLE));

  // The server started again: its counter from 1. Then a track further down the queue, played.
  ctx.zones.revision = 1;
  ctx.zones.bump();
  assert.equal((await api("play-from-here", { zone_or_output_id: kitchen, queue_item_id: 3 })).status, 200);
  assert.ok(await shows("Song 3", 15000), "Now playing follows it: " + await page.eval(TITLE));
  // And the page waits on the server again, rather than asking over and over.
  await page.eval(`(() => { window.__asks = 0; const f = window.fetch; window.fetch = function (u) { if (String(u).includes("/api/zone-state")) window.__asks++; return f.apply(this, arguments); }; })()`);
  await sleep(4000);
  const asks = await page.eval("window.__asks");
  assert.ok(asks <= 3, `${asks} asks in 4 s`);
  assert.deepEqual(page.errors, []);
});
