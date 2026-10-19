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
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 1))) return "no Home";
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
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 1))) return "no Home";
  document.getElementById("home-random-title").click();
  if (!(await until(() => /Random albums/.test(document.getElementById("album-count").textContent) && document.querySelectorAll("#album-grid .album:not(.skeleton)").length >= 3))) return "no wall";
  await sleep(500);
  return "open";
})()`;

/* An artist's page: Artist A's, as an album's artist link opens it. */
const OPEN_ARTIST = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  if (!(await until(() => document.querySelectorAll("#home-library .album").length > 1))) return "no Home";
  window.__showArtistAlbums("Artist A");
  if (!(await until(() => /albums? · Artist A/.test(document.getElementById("album-count").textContent) && document.querySelectorAll("#album-grid .album").length >= 1))) return "no artist";
  await sleep(800);
  return "open";
})()`;

/* How the page is brought to each screen of the contract, and what holds it; `shared`: screens of the contract's under the same root, held by their own checks. */
const SCREENS = {
  "now-playing": { open: OPEN_NOW_PLAYING, root: "#album-modal .modal-panel" },
  "queue": { open: OPEN_QUEUE, root: "#album-modal .modal-panel" },
  "confirm": { open: OPEN_CONFIRM, root: "#confirm-overlay" },
  "mini-player": { open: OPEN_MINI_PLAYER, root: "#mini-transport" },
  "nav": { open: OPEN_NAV, root: "#touch-nav" },
  "booklet": { open: OPEN_BOOKLET, root: "#booklet-viewer" },
  "album": { open: OPEN_ALBUM, root: "#album-modal .modal-panel" },
  "library": { open: OPEN_LIBRARY, root: "body", shared: ["mini-player", "nav"] },
  "wall": { open: OPEN_WALL, root: "body", shared: ["mini-player", "nav"] },
  "artist": { open: OPEN_ARTIST, root: "body", shared: ["mini-player", "nav"] }
};

test("every screen of the contract has a way to open it on the page", () => {
  assert.deepEqual(Object.keys(SCREENS).sort(), Object.keys(contract.screens).sort());
});

test("the page keeps the screens contract: each native screen's controls and readouts, and nothing else", { skip, timeout: 240000 }, async (t) => {
  const house = new FakeHousehold();
  await house.start();
  t.after(() => house.stop());
  const { lib, base, token, api } = await started(t, { sonosHosts: [ports.host(0)] });
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
