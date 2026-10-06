"use strict";
/*
 * Play next (v0.6.22) from the page, phone-sized, against a fake Sonos room:
 * a track's buttons are Play now, Play next, Queue; a selection's menu has
 * Play next under Play now; what is chosen goes straight after the track
 * playing, in the order chosen, with the rest of the queue after it.
 * Skipped where no Chromium or Chrome is found (test/browser-harness.js).
 */
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = 3633;
const B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(100);
  }
}

const DRIVER = (album) => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const out = {};
  await until(() => document.querySelector("#home-random .album, #home-today .album"));
  window.__openAlbum(${JSON.stringify(album)}, { source: "home", filter: null });
  await until(() => document.querySelectorAll("#modal-tracks li").length === 3);
  const li = n => document.querySelectorAll("#modal-tracks li")[n];
  // A track's buttons (the page is given a moment to settle after the album opens).
  await sleep(800);
  li(2).click(); await until(() => document.querySelector("#modal-tracks .t-actions"));
  out.track_buttons = [...document.querySelectorAll("#modal-tracks .t-actions button")].map(b => b.textContent);
  const next = [...document.querySelectorAll("#modal-tracks .t-actions button")].find(b => b.textContent === "Play next");
  next.click(); await sleep(800);
  // A selection: held on a track, which is the first pick (v0.6.24), one more tapped, the menu's Play next.
  li(1).dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); await sleep(700);
  li(1).dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  li(1).click(); await sleep(50);         // the tap that ends a long press changes nothing
  li(2).click(); await sleep(50);
  document.getElementById("select-menu-btn").click(); await sleep(100);
  out.menu = [...document.querySelectorAll("#select-menu .sel-menu-item")].map(b => b.textContent);
  out.menu_title = document.getElementById("select-menu-title").textContent;
  document.querySelector('#select-menu [data-sel-act="play_next"]').click(); await sleep(1500);
  return out;
})()`;

test("Play next: a track's button, a selection's menu item, and the order they land in", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: ["127.0.0.11"], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    const api = async (p, body) => (await fetch(B + "/api/" + p, body ? { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify(body) } : { headers: H })).json();
    await until(async () => (await api("status")).index_count === 3);
    const kitchen = await until(async () => (await api("zones")).zones.find(z => z.display_name === "Kitchen"));
    const cd = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");
    await api("play", { offset: cd.offset, zone_or_output_id: kitchen.zone_id, kind: "play_now" });
    const room = house.room("Kitchen");
    await until(() => room.queue.length === 3);
    const titles = () => room.queue.map(q => /<dc:title>([^<]*)/.exec(q.meta)[1]);

    const b = await Browser.launch({ width: 390, height: 844 });
    let r;
    try {
      // The page on the Kitchen, as a phone that chose it before.
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      await page.eval(`localStorage.setItem("rra-zone", ${JSON.stringify(kitchen.zone_id)}); location.reload(); true`);
      await sleep(1500);
      const page2 = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      r = await page2.eval(DRIVER(cd));
      assert.deepEqual(page2.errors, []);
    } finally { await b.close(); }
    assert.deepEqual(r.track_buttons, ["Play now", "Play next", "Queue"]);
    assert.deepEqual(r.menu, ["Play now", "Play next", "Add to end of queue", "Add to playlist…", "Listen later", "Clear selection"]);
    assert.match(r.menu_title, /2 tracks selected/i);
    // Song 1 is playing. Song 3 went next; then Songs 2 and 3, in that order, before it.
    await until(() => room.queue.length === 6);
    assert.deepEqual(titles(), ["Song 1", "Song 2", "Song 3", "Song 3", "Song 2", "Song 3"]);
  } finally { await srv.stop(); await house.stop(); }
});
