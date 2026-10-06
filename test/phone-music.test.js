"use strict";
/*
 * Music on device (v0.7.4), in a browser with a stand-in for the Android
 * app's phone-music bridge: the wall has Focus and Sort as the Library wall
 * does, worked out on the page; and an artist's page lists what the server
 * has of theirs AND what is on the phone, under "On this phone".
 */
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { FakeHousehold } = require("./fake-sonos");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = 3639, B = "http://127.0.0.1:" + PORT;

// The app's bridge, as MusicdDownloads provides it: downloads (none) and the
// phone's own music — three albums, one by an artist the server also has.
const INIT = `window.MusicdDownloads = {
  settings: () => "{}", set() {}, ids: () => "[]", all: () => "[]", status: () => "{}", play() {}, playLocal() {},
  localFolder: () => JSON.stringify({ name: "Music", scanning: false }),
  playLocal(key, index, kind) { (window.__playLocalCalls = window.__playLocalCalls || []).push([key, index, kind]); },
  localAlbums: () => JSON.stringify([
    { key: "p1", offset: "phone:p1", title: "Shore Ghosts", subtitle: "Dave Clarkson", image_key: null, source: "local", tracks: 8, year: 2019, quality: "16/48", hires: false },
    { key: "p2", offset: "phone:p2", title: "Abandoned Locations", subtitle: "Dave Clarkson", image_key: null, source: "local", tracks: 9, year: 2021, quality: "24/44.1", hires: true },
    { key: "p3", offset: "phone:p3", title: "Zebra Crossing", subtitle: "Artist A", image_key: null, source: "local", tracks: 5, year: 1999, quality: "MP3", hires: false }
  ])
};`;

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const until = async (f, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(50); } };
  const titles = () => [...document.querySelectorAll("#album-grid .album .album-title")].map(e => e.textContent);
  const out = {};
  await until(() => document.querySelector("#home-view .album"));
  // The wall, from the Home row's heading.
  document.querySelector(".home-section-local h2").click();
  await until(() => titles().length === 3);
  out.first = titles();
  out.count = $("album-count").textContent;
  const bar = $("local-controls");
  out.bar_shown = !!bar && !bar.classList.contains("hidden");
  out.ctls = bar ? [...bar.querySelectorAll(".lib-ctl .lib-ctl-text")].map(e => e.textContent) : [];
  // Sort by artist, then reversed.
  bar.querySelector(".lib-ctl-sort").click();
  const row = await until(() => [...document.querySelectorAll(".lib-sort-row")].find(r => r.textContent.includes("Artist")));
  row.click(); await sleep(100);
  out.by_artist = titles();
  bar.querySelector(".lib-ctl-sort").click();
  (await until(() => [...document.querySelectorAll(".lib-sort-row")].find(r => r.textContent.includes("Artist")))).click(); await sleep(100);
  out.by_artist_desc = titles();
  out.sort_label = bar.querySelector(".lib-ctl-sort").textContent;
  document.querySelector(".lib-sheet-backdrop .icon-btn").click(); await sleep(100);
  // Focus: Artist → Dave Clarkson.
  bar.querySelector(".lib-ctl-focus").click();
  const head = await until(() => [...document.querySelectorAll(".lib-sheet-section-head")].find(h => h.textContent.includes("Artist")));
  head.click(); await sleep(50);
  const chip = await until(() => [...document.querySelectorAll(".lib-chip")].find(c => c.textContent.startsWith("Dave Clarkson")));
  out.chip_text = chip.textContent;
  chip.click(); await sleep(100);
  out.focused = titles();
  out.focus_count = $("album-count").textContent;
  out.focus_badge = (bar.querySelector(".lib-ctl-badge") || {}).textContent || "";
  [...document.querySelectorAll(".lib-sheet-foot .action-btn")].find(b => b.textContent === "Clear").click(); await sleep(100);
  out.cleared = titles().length;
  // Multi-select on the wall: two of the phone's albums queued go to the phone's player, not the server.
  window.__enterAlbumSelectMode();
  const tiles = [...document.querySelectorAll("#album-grid .album")];
  tiles.find(t => t.querySelector(".album-title").textContent === "Shore Ghosts").click();
  tiles.find(t => t.querySelector(".album-title").textContent === "Zebra Crossing").click();
  await sleep(50);

  document.querySelector('[data-sel-act="queue"]').click();
  await sleep(300);
  out.play_local = window.__playLocalCalls || [];
  out.toast = (document.querySelector(".toast, #toast") || {}).textContent || "";
  out.select_left = document.querySelectorAll("#album-grid .album.is-selected").length;
  // Play next and Play now, the same way: in order, and the first plays now.
  for (const act of ["play_next", "play_now"]) {
    window.__playLocalCalls = [];
    window.__enterAlbumSelectMode();
    const ts = [...document.querySelectorAll("#album-grid .album")];
    ts.find(t => t.querySelector(".album-title").textContent === "Shore Ghosts").click();
    ts.find(t => t.querySelector(".album-title").textContent === "Zebra Crossing").click();
    document.querySelector('[data-sel-act="' + act + '"]').click();
    await sleep(200);
    out[act] = window.__playLocalCalls;
  }
  // The artist view: the server's album by Artist A and the phone's, together.
  window.__showArtistAlbums("Artist A");
  await until(() => document.querySelector("#album-grid .artist-section-header"));
  await sleep(200);
  out.artist_heads = [...document.querySelectorAll("#album-grid .artist-section-header")].map(e => e.textContent);
  out.artist_tiles = titles();
  // An artist only on the phone.
  window.__showArtistAlbums("Dave Clarkson");
  await until(() => titles().length === 2);
  out.phone_only = titles();
  out.phone_only_heads = [...document.querySelectorAll("#album-grid .artist-section-header")].map(e => e.textContent);
  // At home with a room chosen: a mixed selection sends the server's album to
  // the room and leaves the phone's out, with a word.
  window.__showArtistAlbums("Artist A");
  await until(() => document.querySelectorAll("#album-grid .album").length === 2);
  const sel = $("zone-select");
  const kitchen = [...sel.options].find(o => o.textContent.trim() === "Kitchen");
  sel.value = kitchen.value; sel.dispatchEvent(new Event("change"));
  await sleep(100);
  window.__playLocalCalls = [];
  window.__enterAlbumSelectMode();
  for (const t of document.querySelectorAll("#album-grid .album")) t.click();
  document.querySelector('[data-sel-act="queue"]').click();
  await until(() => $("toast").textContent.includes("Unable"), 8000);
  out.mixed_toast = $("toast").textContent;
  out.mixed_play_local = window.__playLocalCalls;
  return out;
})()`;

test("Music on device: Focus and Sort on the wall; an artist's page shows the server's and the phone's albums", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: ["127.0.0.11"], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    for (let i = 0; i < 100; i++) { const st = await (await fetch(B + "/api/status", { headers: { Authorization: "Bearer " + token } })).json(); if (st.index_count === 3) break; await new Promise(r => setTimeout(r, 100)); }
    const b = await Browser.launch({ width: 390, height: 844 });
    let r;
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], init: INIT });
      r = await page.eval(DRIVER);
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
    assert.deepEqual(r.first, ["Abandoned Locations", "Shore Ghosts", "Zebra Crossing"], "by album name to begin with");
    assert.equal(r.count, "Music on device · 3 albums");
    assert.equal(r.bar_shown, true, "the Focus / Sort row is up");
    assert.deepEqual(r.ctls, ["Focus", "Album name"]);
    assert.deepEqual(r.by_artist, ["Zebra Crossing", "Abandoned Locations", "Shore Ghosts"], "Artist A before Dave Clarkson, then by title");
    assert.deepEqual(r.by_artist_desc, ["Shore Ghosts", "Abandoned Locations", "Zebra Crossing"], "tapped again: reversed");
    assert.ok(r.sort_label.startsWith("Artist"), r.sort_label);
    assert.equal(r.chip_text, "Dave Clarkson (2)");
    assert.deepEqual(r.focused.sort(), ["Abandoned Locations", "Shore Ghosts"]);
    assert.equal(r.focus_count, "Music on device · 2 matching albums");
    assert.equal(r.focus_badge, "1");
    assert.equal(r.cleared, 3, "Clear puts every album back");
    assert.deepEqual(r.play_local, [["p1", -1, "queue"], ["p3", -1, "queue"]], "both phone albums to the phone's player, in order");
    assert.match(r.toast, /Queued 2 albums on this phone/, r.toast);
    assert.equal(r.select_left, 0, "the selection is cleared");
    assert.deepEqual(r.play_next, [["p3", -1, "play_next"], ["p1", -1, "play_next"]], "Play next: sent last to first, since the app puts each straight after the playing track");
    assert.deepEqual(r.play_now, [["p1", -1, "play_now"], ["p3", -1, "queue"]], "Play now: the first now, the rest after it");
    assert.deepEqual(r.artist_heads, ["Albums", "On this phone"]);
    assert.deepEqual(r.artist_tiles, ["Album One", "Zebra Crossing"], "the server's album and the phone's, under their headings");
    assert.deepEqual(r.phone_only.slice().sort(), ["Abandoned Locations", "Shore Ghosts"], "an artist only on the phone is found too");
    assert.deepEqual(r.phone_only_heads, [], "no heading when the phone is all there is");
    assert.match(r.mixed_toast, /Queued 1 album → Kitchen · Unable to add music on this phone to queue/, r.mixed_toast);
    assert.deepEqual(r.mixed_play_local, [], "the phone's album is left out, not played on the phone beside the room");
    assert.equal(house.room("Kitchen").queue.length, 3, "Album One's three tracks reached the room");
  } finally { await srv.stop(); await house.stop(); }
});
