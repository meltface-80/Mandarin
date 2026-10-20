"use strict";
/*
 * The page against the screens contract (docs/specs/screens.json,
 * docs/specs/native-parity.md): each screen the Android app draws natively,
 * opened on the page in a browser at a phone's size, shows what the contract
 * says and nothing it doesn't. Every control on it and every thing it shows
 * carries a contract key (data-parity); every key in the contract is there,
 * where and when the contract says, called what it says. A button added to
 * the page and not to the contract fails here; one added to the contract
 * fails in the app's gate (npm run parity) until the app has it too.
 * Skipped where no Chromium or Chrome is found.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ports = require("./ports");
const { pdf } = require("./fixtures");
const { started, until } = require("./helpers");
const { FakeHousehold } = require("./fake-sonos");
const { FakeWeb } = require("./fake-web");
const { pitchforkPages, fakeQobuz } = require("./fake-pitchfork");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");
const contract = require("../docs/specs/screens.json");
const { CHECK } = require("./parity-check");

const skip = built() || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

/* Now playing on the page: an album played to the Kitchen, then the mini player tapped. */
const OPEN_NOW_PLAYING = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const shown = e => !!e && e.getClientRects().length > 0;
  const $ = s => document.querySelector(s);
  await until(() => $("#home-library .album") && /Kitchen/.test(($("#mt-kicker") || {}).textContent || ""));
  $("#home-library .album").click();
  const playBtn = () => [...document.querySelectorAll("#modal-actions .action-btn")].find(b => /^Play Now$/.test(b.textContent.trim()) && shown(b));
  if (!(await until(() => playBtn()))) return "no Play Now";
  playBtn().click();
  $("#modal-close-btn").click();
  await until(() => !shown($("#album-modal")));
  if (!(await until(() => /Song/.test(($("#mt-title") || {}).textContent || "")))) return "nothing playing";
  for (let i = 0; i < 6 && !shown($("#np-screen")); i++) { $(".mt-info").click(); await until(() => shown($("#np-screen")), 2500); }
  if (!shown($("#np-screen"))) return "no Now playing";
  await until(() => /^\\d+:\\d\\d$/.test(($("#np-tot") || {}).textContent || "") && $("#np-tot").textContent !== "0:00");
  await sleep(500);
  return "open";
})()`;

/* Now playing's Queue tab, a track played (so there is a "played earlier") and two to come. */
const OPEN_QUEUE = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const $ = s => document.querySelector(s);
  if (await ${OPEN_NOW_PLAYING} !== "open") return "no Now playing";
  await until(() => !$("#np-next").disabled); $("#np-next").click();
  if (!(await until(() => /Song 2/.test(($("#np-track") || {}).textContent || "")))) return "no next track";
  document.querySelector('.modal-tab[data-tab="queue"]').click();
  if (!(await until(() => $(".q-history-head") && document.querySelectorAll("#queue-list [data-parity='queue.track']").length === 2, 15000))) return "no queue";
  await sleep(500);
  return "open";
})()`;

/* The page's yes-or-no sheet, as a queue's Play from here asks it. */
const OPEN_CONFIRM = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 400 && !window.__confirmDialog; i++) await sleep(50);
  window.__confirmDialog('Play from "Song 3"?');
  await sleep(300);
  return document.getElementById("confirm-overlay").classList.contains("hidden") ? "not open" : "open";
})()`;

/* An album's page, opened from the Library row on Home (so it has a previous and a next). */
const OPEN_ALBUM = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const $ = s => document.querySelector(s);
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 1))) return "no albums";
  await sleep(500);
  [...document.querySelectorAll("#home-library .album")].find(t => /Album One/.test(t.textContent)).click();
  if (!(await until(() => $("#modal-total").textContent && document.querySelectorAll("#modal-tracks li").length === 3 && $("#modal-actions .overflow-btn")))) return "no album";
  await sleep(800);
  return "open";
})()`;

/* An album's editor: Album One's page, its ⋯, Edit album; its title changed, so what the files say shows under it with Put back. */
const OPEN_ALBUM_EDIT = `(async () => {
  const opened = await ${OPEN_ALBUM};
  if (opened !== "open") return opened;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const $ = s => document.querySelector(s);
  $("#modal-actions .overflow-btn").click();
  if (!(await until(() => $('[data-parity~="album.edit"]')))) return "no Edit album";
  $('[data-parity~="album.edit"]').click();
  if (!(await until(() => !$("#album-edit-overlay").classList.contains("hidden") && !$("#ae-save").disabled && /cover/i.test($("#ae-cover-status").textContent)))) return "no editor";
  $("#ae-title").value = "Album One (Remaster)";
  $("#ae-title").dispatchEvent(new Event("input"));
  if (!(await until(() => $('[data-parity~="album-edit.put-back"]')))) return "no Put back";
  await sleep(400);
  return "open";
})()`;

/* The Share card: Album One's page, its share button, the card drawn and its buttons under it. */
const OPEN_SHARE_CARD = `(async () => {
  const opened = await ${OPEN_ALBUM};
  if (opened !== "open") return opened;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  document.getElementById("modal-share-btn").click();
  if (!(await until(() => document.querySelector("#share-frame img") && document.querySelector("#share-actions [data-parity]")))) return "no card";
  await sleep(1500);
  return "open";
})()`;

/* Settings, as the side menu's Settings opens it; a section's page by its row ([path]: the rows tapped, in turn). */
const OPEN_SETTINGS = (path, ready) => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const shown = e => !!e && e.getClientRects().length > 0;
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 0))) return "no home";
  document.getElementById("settings-toggle").click();
  if (!(await until(() => shown(document.querySelector('#settings-overlay .settings-view[data-view="home"]'))))) return "no settings";
  for (const pane of ${JSON.stringify(path)}) {
    const row = [...document.querySelectorAll('#settings-overlay .settings-nav-item[data-pane="' + pane + '"]')].find(shown);
    if (!row) return "no " + pane;
    row.click();
    if (!(await until(() => shown(document.querySelector('#settings-overlay .settings-view[data-pane="' + pane + '"]'))))) return "no " + pane + " page";
  }
  if (!(await until(() => ${ready || "true"}))) return "not ready";
  await sleep(800);
  return "open";
})()`;

/* The mini player: an album played to the Kitchen, the bar showing its first track. */
const OPEN_MINI_PLAYER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const shown = e => !!e && e.getClientRects().length > 0;
  const $ = s => document.querySelector(s);
  await until(() => $("#home-library .album") && /Kitchen/.test(($("#mt-kicker") || {}).textContent || ""));
  $("#home-library .album").click();
  const playBtn = () => [...document.querySelectorAll("#modal-actions .action-btn")].find(b => /^Play Now$/.test(b.textContent.trim()) && shown(b));
  if (!(await until(() => playBtn()))) return "no Play Now";
  playBtn().click();
  $("#modal-close-btn").click();
  await until(() => !shown($("#album-modal")));
  if (!(await until(() => /Song/.test(($("#mt-title") || {}).textContent || "") && $("#mt-playpause").getAttribute("aria-label") === "Pause"))) return "nothing playing";
  await sleep(500);
  return shown($("#mini-transport")) ? "open" : "no mini player";
})()`;

/* An album's booklet: Album One's page (its folder given one before this runs), the book on its cover tapped. */
const OPEN_BOOKLET = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const shown = e => !!e && e.getClientRects().length > 0;
  const $ = s => document.querySelector(s);
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 1))) return "no albums";
  [...document.querySelectorAll("#home-library .album")].find(t => /Album One/.test(t.textContent)).click();
  if (!(await until(() => shown($("#modal-booklet")), 15000))) return "no booklet";
  $("#modal-booklet").click();
  if (!(await until(() => shown($("#booklet-viewer")) && $("#booklet-viewer .booklet-page"), 10000))) return "no viewer";
  await sleep(300);
  return "open";
})()`;

/* The touch layout's row: on Home, as the page opens on a phone. */
const OPEN_NAV = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  if (!(await until(() => document.querySelector("#home-library .album")))) return "no Home";
  await sleep(300);
  return document.getElementById("touch-nav").getClientRects().length ? "open" : "no row";
})()`;

/* The Library wall: Home's Library heading tapped, the wall's tiles and its count up. */
const OPEN_LIBRARY = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 1 && /Kitchen/.test((document.getElementById("mt-kicker") || {}).textContent || "")))) return "no Home";
  await sleep(400);
  const up = () => /Library · \\d/.test(document.getElementById("album-count").textContent) && document.querySelectorAll("#album-grid .album:not(.skeleton)").length >= 3;
  const banner = () => { const b = document.getElementById("status-banner"); return !!b && !b.classList.contains("hidden"); };
  // Asked for while the library is being read again (the suite's own files changing under the watch), the wall says so
  // and waits to be entered again: Back to Home and in once more, a few times.
  for (let tries = 0; tries < 6; tries++) {
    document.getElementById("home-library-title").click();
    if (await until(() => up() || banner(), 8000) && up()) { await sleep(500); return "open"; }
    document.getElementById("topbar-back").click();
    await sleep(2000);
  }
  return "no wall";
})()`;

/* A wall Home links to: Random albums (its heading tapped), the one wall the suite's library always fills. */
const OPEN_WALL = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  // Home as painted from its cache comes first; the startup's own showHome() follows once the rooms are loaded (the mini player names one), and would undo a wall opened before it.
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 1 && /Kitchen/.test((document.getElementById("mt-kicker") || {}).textContent || "")))) return "no Home";
  await sleep(400);
  document.getElementById("home-random-title").click();
  if (!(await until(() => /Random albums/.test(document.getElementById("album-count").textContent) && document.querySelectorAll("#album-grid .album:not(.skeleton)").length >= 3))) return "no wall";
  await sleep(500);
  return "open";
})()`;

/* An artist's page: Artist A's, as an album's artist link opens it. */
const OPEN_ARTIST = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 1 && /Kitchen/.test((document.getElementById("mt-kicker") || {}).textContent || "")))) return "no Home";
  await sleep(400);
  window.__showArtistAlbums("Artist A");
  if (!(await until(() => /albums? · Artist A/.test(document.getElementById("album-count").textContent) && document.querySelectorAll("#album-grid .album").length >= 1))) return "no artist";
  await sleep(800);
  return "open";
})()`;

/* Home, as the page opens on a phone, its rows drawn: the strip's Random Album, and today's album where it hasn't been played
   today (the day's album leaves Home once played, and the day decides which album it is: on a day it is the one an earlier
   screen's check plays, Home comes up without it, which is Home as well). */
const OPEN_HOME = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const day = await fetch("/api/home/album-of-the-day", { cache: "no-store" }).then(r => r.json()).catch(() => null);
  const today = () => !(day && day.album) || document.querySelector("#home-today .home-aotd");
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 1 && document.querySelectorAll("#home-genres .home-genre-card").length > 0 &&
    today() && /Kitchen/.test((document.getElementById("mt-kicker") || {}).textContent || "")))) return "no Home";
  await sleep(500);
  return "open";
})()`;

/* Smart Picks: the day's picks made (the server makes them after the scan), the row's heading tapped, the cards up. */
const OPEN_PICKS = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 1 && /Kitchen/.test((document.getElementById("mt-kicker") || {}).textContent || "")))) return "no Home";
  let made = false;
  for (let i = 0; i < 60 && !made; i++) { made = ((await (await fetch("/api/smart-picks")).json()).picks || []).length > 0; if (!made) await sleep(500); }
  if (!made) return "no picks";
  showSmartPicks();
  if (!(await until(() => /Smart Picks/.test(document.getElementById("album-count").textContent) && document.querySelectorAll("#album-grid .pick-card-full").length > 0))) return "no screen";
  await sleep(500);
  return "open";
})()`;

/* Random Album's choice: the tile in the strip tapped, the disc's turn waited out, the album offered. */
const OPEN_RANDOM_PICK = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  if (!(await until(() => document.getElementById("home-unheard-tile") && /Kitchen/.test((document.getElementById("mt-kicker") || {}).textContent || "")))) return "no Home";
  document.getElementById("home-unheard-tile").click();
  if (!(await until(() => !document.getElementById("random-pick-overlay").classList.contains("hidden") && document.getElementById("random-pick-title").textContent, 15000))) return "no pick";
  await sleep(300);
  return "open";
})()`;

/* The search: the row's Search tapped on Home, "artist" typed; the library's artists as chips and its albums as tiles. */
const OPEN_SEARCH = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 1 && /Kitchen/.test((document.getElementById("mt-kicker") || {}).textContent || "")))) return "no Home";
  await sleep(400);
  document.getElementById("tnav-search").click();
  const field = document.getElementById("search-input");
  if (!(await until(() => document.getElementById("topbar-search").classList.contains("is-open")))) return "no field";
  field.value = "artist"; field.dispatchEvent(new Event("input", { bubbles: true }));
  if (!(await until(() => document.querySelectorAll("#album-grid .search-chip").length > 0 && document.querySelectorAll("#album-grid .album").length > 0 &&
    /album/.test(document.getElementById("search-status").textContent)))) return "no results";
  await sleep(1500);
  return "open";
})()`;

/* A playlist of Album One's first two tracks, made through the page's own API (once: a second opener finds it), its id. */
const MAKE_PLAYLIST = `const makePlaylist = async () => {
  const mine = ((await (await fetch("/api/user-playlists")).json()).playlists || []).find(p => p.name === "Road trip");
  if (mine) return mine.id;
  const one = ((await (await fetch("/api/library/albums?count=60")).json()).albums || []).find(a => a.title === "Album One");
  const al = await (await fetch("/api/album?offset=" + one.offset)).json();
  const tracks = al.tracks.slice(0, 2).map((t, i) => ({ album_offset: one.offset, album_title: one.title, album_subtitle: one.subtitle, track_index: i, title: t.title, subtitle: one.subtitle, image_key: one.image_key }));
  const r = await (await fetch("/api/user-playlists/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Road trip", tracks }) })).json();
  return r.id;
};`;

/* The Playlists screen, as the side menu opens it, one playlist on it. */
const OPEN_PLAYLISTS = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  ${MAKE_PLAYLIST}
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 1 && /Kitchen/.test((document.getElementById("mt-kicker") || {}).textContent || "")))) return "no Home";
  await makePlaylist();
  await sleep(400);
  showPlaylists();
  if (!(await until(() => /Playlists/.test(document.getElementById("album-count").textContent) && document.querySelectorAll("#album-grid .album").length > 0))) return "no screen";
  await sleep(800);
  return "open";
})()`;

/* One of your playlists: its tile on the Playlists screen tapped, its two tracks up. */
const OPEN_PLAYLIST = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  ${MAKE_PLAYLIST}
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 1 && /Kitchen/.test((document.getElementById("mt-kicker") || {}).textContent || "")))) return "no Home";
  await makePlaylist();
  await sleep(400);
  showPlaylists();
  if (!(await until(() => document.querySelector("#album-grid .album")))) return "no list";
  document.querySelector("#album-grid .album").click();
  if (!(await until(() => document.querySelectorAll("#album-grid .playlist-tracks .track-row").length === 2))) return "no playlist";
  await sleep(800);
  return "open";
})()`;

/* A Dynamic Playlist of Artist A's and B's albums, made of their tracks, made through the page's own API (once), its id. */
const MAKE_SMART = `const makeSmart = async () => {
  const mine = ((await (await fetch("/api/smart-playlists")).json()).playlists || []).find(p => p.name === "Artists");
  if (mine) return mine.id;
  const r = await (await fetch("/api/smart-playlists", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Artists", view: { sort: "album", dir: "asc" }, mode: "tracks", order: "album" }) })).json();
  return r.playlist.id;
};`;

/* The Dynamic Playlists screen, as the side menu opens it, one saved. */
const OPEN_SMART_PLAYLISTS = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  ${MAKE_SMART}
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 1 && /Kitchen/.test((document.getElementById("mt-kicker") || {}).textContent || "")))) return "no Home";
  await makeSmart();
  await sleep(400);
  showSmartPlaylists();
  if (!(await until(() => /Dynamic Playlists/.test(document.getElementById("album-count").textContent) && document.querySelectorAll("#album-grid .album:not(#new-smart-tile)").length > 0))) return "no screen";
  await sleep(800);
  return "open";
})()`;

/* A Dynamic Playlist made of tracks: its tile tapped, its tracks all read. */
const OPEN_SMART_PLAYLIST = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  ${MAKE_SMART}
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 1 && /Kitchen/.test((document.getElementById("mt-kicker") || {}).textContent || "")))) return "no Home";
  await makeSmart();
  await sleep(400);
  showSmartPlaylists();
  const tile = () => document.querySelector('#album-grid [data-parity="smart-playlists.playlist"]');
  if (!(await until(() => /Dynamic Playlists/.test(document.getElementById("album-count").textContent) && tile()))) return "no list";
  await sleep(300);
  tile().click();
  if (!(await until(() => / from \\d+ album/.test((document.querySelector(".playlist-detail .playlist-empty") || {}).textContent || "")))) return "no tracks";
  await sleep(800);
  return "open";
})()`;

/* The side menu: the row's Menu tapped on Home, the library's age under Rescan. */
const OPEN_MENU = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 1 && /Kitchen/.test((document.getElementById("mt-kicker") || {}).textContent || "")))) return "no Home";
  await sleep(400);
  document.getElementById("tnav-menu").click();
  if (!(await until(() => !document.getElementById("menu-overlay").classList.contains("hidden") && /albums/.test(document.getElementById("rescan-sub").textContent)))) return "no menu";
  await sleep(600);
  return "open";
})()`;

/* Group zones and Device power: the page's sheets, opened as Play on opens them, in the room the mini player is in. */
const OPEN_GROUP = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  if (!(await until(() => /Kitchen/.test((document.getElementById("mt-kicker") || {}).textContent || "")))) return "no room";
  openGroupSheet();
  if (!(await until(() => document.querySelectorAll(".lib-sheet .group-row").length > 1))) return "no rows";
  await sleep(600);
  return "open";
})()`;
const OPEN_POWER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  if (!(await until(() => /Kitchen/.test((document.getElementById("mt-kicker") || {}).textContent || "")))) return "no room";
  openDevicePowerSheet();
  if (!(await until(() => !!document.querySelector(".lib-sheet .lib-sheet-note, .lib-sheet .dev-row")))) return "no sheet";
  await sleep(600);
  return "open";
})()`;

/* Pitchfork: the side menu's Pitchfork, its Latest Reviews read; then a review's page, the first one's (an album the library has). */
const OPEN_PITCHFORK = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 0))) return "no Home";
  document.getElementById("pitchfork-toggle").click();
  if (!(await until(() => document.querySelectorAll("#pitchfork-list .pf-card").length > 3))) return "no reviews";
  await sleep(600);
  return "open";
})()`;
const OPEN_PITCHFORK_REVIEW = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 0))) return "no Home";
  document.getElementById("pitchfork-toggle").click();
  if (!(await until(() => document.querySelectorAll("#pitchfork-list .pf-card").length > 3))) return "no reviews";
  document.querySelector("#pitchfork-list .pf-card").click();
  if (!(await until(() => !!document.querySelector("#pitchfork-detail .pf-action-primary")))) return "no review";
  await sleep(600);
  return "open";
})()`;

/* Labels: switched on (as Settings → Record labels does), then the side menu's Labels; a label's albums and its logo sheet; two labels merged and the merged ones' sheet. */
const LABELS_KIT = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const post = (p, b) => fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 0))) return "no Home";
  await post("/api/settings/labels", { enabled: true });
  // The labels read from the server first (their index is made as they are switched on), then one tap.
  const list = async (n = 2) => {
    for (let i = 0; i < 40; i++) { const j = await (await fetch("/api/filters/labels", { cache: "no-store" })).json(); if ((j.labels || []).length >= n && !j.scanning) break; await sleep(500); }
    // The page may come back on the labels as it was left (page-state.js): a tap then would leave them.
    if (await until(() => document.querySelectorAll(".label-tile").length >= n, 1500)) return true;
    document.getElementById("labels-toggle").click();
    return until(() => document.querySelectorAll(".label-tile").length >= n, 10000);
  };`;
const OPEN_LABELS = `(async () => { ${LABELS_KIT}
  if (!(await list())) return "no labels";
  await sleep(600);
  return "open";
})()`;
const OPEN_LABEL_LOGO = `(async () => { ${LABELS_KIT}
  if (!(await list())) return "no labels";
  document.querySelector(".label-tile").click();
  if (!(await until(() => document.querySelectorAll("#album-grid .album:not(.label-tile)").length > 0 && !document.getElementById("labels-logo-btn").classList.contains("hidden")))) return "no albums";
  document.getElementById("labels-logo-btn").click();
  if (!(await until(() => !/Searching/.test(document.getElementById("logo-candidates").textContent)))) return "no answer";
  await sleep(400);
  return "open";
})()`;
const OPEN_LABEL_UNMERGE = `(async () => { ${LABELS_KIT}
  const labels = (await (await fetch("/api/filters/labels")).json()).labels || [];
  if (labels.length < 2) return "no labels";
  await post("/api/labels/merge", { items: labels.slice(0, 2).map(l => ({ key: l.key, display: l.title })) });
  if (!(await list(1))) return "no list";
  const merged = await until(() => !!document.querySelector(".album-merged-info"));
  if (!merged) return "not merged";
  document.querySelector(".album-merged-info").click();
  if (!(await until(() => !document.getElementById("label-unmerge-sheet").classList.contains("hidden")))) return "no sheet";
  await sleep(400);
  return "open";
})()`;

/* The Qobuz browser: signed in to the stand-in Qobuz, opened from its hidden button, a search made (its artists and albums); then an artist of it. */
const SERVICE_KIT = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 0))) return "no Home";
  await fetch("/api/settings/qobuz/signin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "tester@example.com", password: "pw" }) });
  document.getElementById("qobuz-toggle").click();
  // The stand-in's albums are years old: New Releases answers with none (its status says so), then the search.
  if (!(await until(() => /releases/.test(document.getElementById("qobuz-nr-status").textContent) && !/Loading/.test(document.getElementById("qobuz-nr-status").textContent)))) return "no releases";
  const input = document.getElementById("qobuz-search-input");
  input.value = "Q"; input.dispatchEvent(new Event("input", { bubbles: true }));
  input.value = "Q Artist"; input.dispatchEvent(new Event("input", { bubbles: true }));
  if (!(await until(() => document.querySelectorAll("#qobuz-artists .qobuz-artist-chip").length > 0 && /albums for/.test(document.getElementById("qobuz-nr-status").textContent)))) return "no search";
  input.blur();`;
const OPEN_SERVICE = `(async () => { ${SERVICE_KIT}
  await sleep(600);
  return "open";
})()`;
const OPEN_SERVICE_ARTIST = `(async () => { ${SERVICE_KIT}
  document.querySelector("#qobuz-artists .qobuz-artist-chip").click();
  if (!(await until(() => !!document.querySelector("#qobuz-artist-head .qobuz-artist-head-name") && document.querySelectorAll("#qobuz-nr-list .qobuz-tile").length > 0))) return "no artist";
  await sleep(600);
  return "open";
})()`;

/* How the page is brought to each screen of the contract, and what holds it; `shared`: screens of the contract's under the same root, held by their own checks. */
const SCREENS = {
  // Home and what opens from it first, before any screen's check plays an album: today's album is still on Home, so its badge is checked too.
  "home": { open: OPEN_HOME, root: "body", shared: ["mini-player", "nav"] },
  "picks": { open: OPEN_PICKS, root: "body", shared: ["mini-player", "nav"] },
  "random-pick": { open: OPEN_RANDOM_PICK, root: "#random-pick-overlay" },
  "now-playing": { open: OPEN_NOW_PLAYING, root: "#album-modal .modal-panel" },
  "queue": { open: OPEN_QUEUE, root: "#album-modal .modal-panel" },
  "confirm": { open: OPEN_CONFIRM, root: "#confirm-overlay" },
  "mini-player": { open: OPEN_MINI_PLAYER, root: "#mini-transport" },
  "nav": { open: OPEN_NAV, root: "#touch-nav" },
  "booklet": { open: OPEN_BOOKLET, root: "#booklet-viewer" },
  "album": { open: OPEN_ALBUM, root: "#album-modal .modal-panel" },
  "album-edit": { open: OPEN_ALBUM_EDIT, root: "#album-edit-overlay .album-edit-sheet" },
  "share-card": { open: OPEN_SHARE_CARD, root: "#share-overlay .share-panel" },
  "settings": { open: OPEN_SETTINGS([], `/Mandarin v/.test(document.getElementById("settings-version").textContent)`), root: '#settings-overlay .settings-view[data-view="home"]' },
  "settings-setup": { open: OPEN_SETTINGS(["setup"]), root: '#settings-overlay .settings-view[data-pane="setup"]' },
  "settings-account": { open: OPEN_SETTINGS(["account"], `document.querySelectorAll("#acct-devices .acct-device").length > 0`), root: '#settings-overlay .settings-view[data-pane="account"]' },
  "settings-keys": { open: OPEN_SETTINGS(["setup", "metadata"], `!!document.getElementById("lastfm-key-status").textContent`), root: '#settings-overlay .settings-view[data-pane="metadata"]' },
  "settings-picks": { open: OPEN_SETTINGS(["setup", "smartpicks"]), root: '#settings-overlay .settings-view[data-pane="smartpicks"]' },
  "settings-labels": { open: OPEN_SETTINGS(["setup", "labels"], `/label|Off/.test(document.getElementById("labels-enabled-note").textContent) && !!document.getElementById("label-folder-depth-status").textContent`), root: '#settings-overlay .settings-view[data-pane="labels"]' },
  "settings-ui": { open: OPEN_SETTINGS(["setup", "ui"]), root: '#settings-overlay .settings-view[data-pane="ui"]' },
  "settings-display": { open: OPEN_SETTINGS(["setup", "display"]), root: '#settings-overlay .settings-view[data-pane="display"]' },
  "settings-shelf": { open: OPEN_SETTINGS(["setup", "shelfset"]), root: '#settings-overlay .settings-view[data-pane="shelfset"]' },
  "settings-sharecard": { open: OPEN_SETTINGS(["setup", "sharecard"], `document.querySelectorAll("#share-services-list .switch").length > 0 && document.querySelectorAll("#share-reviews-list .switch").length > 0`), root: '#settings-overlay .settings-view[data-pane="sharecard"]' },
  "settings-homescreen": { open: OPEN_SETTINGS(["setup", "homescreen"], `document.querySelectorAll("#home-rows-list .home-row-item").length > 0`), root: '#settings-overlay .settings-view[data-pane="homescreen"]' },
  "settings-services": { open: OPEN_SETTINGS(["streaming"], `!!document.getElementById("qobuz-status").textContent`), root: '#settings-overlay .settings-view[data-pane="streaming"]' },
  "settings-folders": { open: OPEN_SETTINGS(["folders"], `!!document.querySelector("#folders-pane-body .mf-row, #folders-pane-body .settings-note")`), root: '#settings-overlay .settings-view[data-pane="folders"]' },
  "settings-scanner": { open: OPEN_SETTINGS(["identify"], `!!document.querySelector("#identify-pane-body .id-progress") && !document.querySelector("#identify-pane-body .id-wait")`), root: '#settings-overlay .settings-view[data-pane="identify"]' },
  "settings-away": { open: OPEN_SETTINGS(["setup", "away"], `!!document.querySelector("#away-pane-body .settings-note")`), root: '#settings-overlay .settings-view[data-pane="away"]' },
  "library": { open: OPEN_LIBRARY, root: "body", shared: ["mini-player", "nav"] },
  "wall": { open: OPEN_WALL, root: "body", shared: ["mini-player", "nav"] },
  "artist": { open: OPEN_ARTIST, root: "body", shared: ["mini-player", "nav"] },
  "search": { open: OPEN_SEARCH, root: "body", shared: ["mini-player", "nav"] },
  "playlists": { open: OPEN_PLAYLISTS, root: "body", shared: ["mini-player", "nav"] },
  "playlist": { open: OPEN_PLAYLIST, root: "body", shared: ["mini-player", "nav"] },
  "smart-playlists": { open: OPEN_SMART_PLAYLISTS, root: "body", shared: ["mini-player", "nav"] },
  "smart-playlist": { open: OPEN_SMART_PLAYLIST, root: "body", shared: ["mini-player", "nav"] },
  "menu": { open: OPEN_MENU, root: "#menu-overlay" },
  "group": { open: OPEN_GROUP, root: ".lib-sheet-backdrop" },
  "device-power": { open: OPEN_POWER, root: ".lib-sheet-backdrop" },
  "pitchfork": { open: OPEN_PITCHFORK, root: "#pitchfork-overlay" },
  "pitchfork-review": { open: OPEN_PITCHFORK_REVIEW, root: "#pitchfork-overlay", shared: ["pitchfork"] },
  "service-browser": { open: OPEN_SERVICE, root: "#qobuz-overlay" },
  "service-artist": { open: OPEN_SERVICE_ARTIST, root: "#qobuz-overlay", shared: ["service-browser"] },
  // Last, as they switch the labels on (Home's Label of the week with them) and merge two.
  "labels": { open: OPEN_LABELS, root: "body", shared: ["mini-player", "nav"] },
  "label-logo": { open: OPEN_LABEL_LOGO, root: "#logo-url-sheet" },
  "label-unmerge": { open: OPEN_LABEL_UNMERGE, root: "#label-unmerge-sheet" }
};

test("every screen of the contract has a way to open it on the page", () => {
  assert.deepEqual(Object.keys(SCREENS).sort(), Object.keys(contract.screens).sort());
});

test("the page keeps the screens contract: each native screen's controls and readouts, and nothing else", { skip, timeout: 240000 }, async (t) => {
  const house = new FakeHousehold();
  await house.start();
  t.after(() => house.stop());
  // Pitchfork's listings on loopback, for its screens (item 70); a stand-in Qobuz, signed in to only by its browser's screens (item 72).
  const web = new FakeWeb(pitchforkPages());
  const qobuz = fakeQobuz();
  await Promise.all([web.start(), qobuz.start()]);
  t.after(() => Promise.all([web.stop(), qobuz.stop()]));
  const { lib, base, token, api } = await started(t, { sonosHosts: [ports.host(0)], pitchforkBaseUrl: web.base, qobuzBaseUrl: qobuz.base, qobuzSyncDelayMs: 100000 });
  // Album One's booklet (one blue page), found in its folder when its page asks: the booklet screen's way in.
  fs.writeFileSync(path.join(lib.music, "Artist A", "Album One", "Booklet.pdf"), pdf(["0 0 1"]));
  const kitchen = await until(async () => ((await api("zones")).json.zones || []).find(z => z.display_name === "Kitchen"), 20000, "the Kitchen room");
  const b = await Browser.launch({ width: 412, height: 915 });
  t.after(() => b.close());
  for (const [name, how] of Object.entries(SCREENS)) {
    await t.test(name, async () => {
      const page = await b.page(base + "/", {
        cookies: [{ name: "musicd_session", value: token, url: base }], touch: true,
        init: `localStorage.setItem("rra-zone", ${JSON.stringify(kitchen.zone_id)});`
      });
      assert.equal(await page.eval(how.open), "open", name + " opened");
      const wrong = await page.eval(CHECK(name, contract.screens[name].items, how.root, how.shared || []));
      assert.deepEqual(wrong, [], name + ": the page and the contract differ:\n  " + wrong.join("\n  "));
      assert.deepEqual(page.errors, [], "nothing thrown");
    });
  }
});
