"use strict";
/*
 * The page, every screen of it, opened in a real browser with nothing thrown
 * (v1.0.5). Written before app.js is carved into parts (docs/specs/
 * page-modules.md): a part that loses a name another part needs fails only
 * when that screen is opened, which no compiler sees, so each is opened here:
 *   - Home, and each row's wall from its title;
 *   - each item of the side menu (Shelf, Rescan and Offline aside: they leave
 *     the page or change the library);
 *   - every Settings page and every page of Setup, from their lists;
 *   - an album, played to a room, Now playing over it, the room picker;
 *   - search, and an artist's albums.
 * At a desktop with a mouse and at a phone held upright (the touch layout).
 * Each screen is also checked to have opened, so a step that silently does
 * nothing is seen. Skipped where no Chromium or Chrome is found.
 */
const test = require("node:test");
const assert = require("node:assert");
const ports = require("./ports");
const { started } = require("./helpers");
const { FakeHousehold } = require("./fake-sonos");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");

const skip = built() || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

// In the page: waiting, and what is on screen.
const KIT = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const shown = (el) => !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
  const $ = (s) => document.querySelector(s);
  await until(() => document.querySelector("#home-random .album, #home-today .album, #home-library .album"), 20000);`;

/* Every page of Settings and of Setup: opened from its list, and open. */
const SETTINGS = `(async () => { ${KIT}
  const opened = [], missed = [];
  const view = (name) => document.querySelector('.settings-view[data-pane="' + name + '"]');
  $("#settings-toggle").click(); await sleep(400);
  const lists = [["home", '.settings-view[data-view="home"] > .settings-nav'], ["setup", '.settings-view[data-pane="setup"] .settings-nav']];
  for (const [parent, sel] of lists) {
    window.__settingsShowView(parent); await sleep(200);
    const names = [...document.querySelectorAll(sel + " > .settings-nav-item[data-pane]")].filter(shown).map(b => b.dataset.pane);
    for (const name of names) {
      window.__settingsShowView(parent); await sleep(150);
      const item = document.querySelector(sel + ' > .settings-nav-item[data-pane="' + name + '"]');
      item.click();
      if (await until(() => shown(view(name)), 5000)) opened.push(name); else missed.push(name);
      await sleep(350);   // what the page loads on opening, in
    }
  }
  return { opened, missed };
})()`;

/* A row's wall from its title on Home. */
const ROWS = `(async () => { ${KIT}
  return [...document.querySelectorAll(".home-section-title.home-section-link")].filter(shown).map(h => h.id);
})()`;
const ROW = (id) => `(async () => { ${KIT}
  const h = document.getElementById(${JSON.stringify(id)}); h.click();
  return await until(() => !shown($("#home-view")), 5000);
})()`;

/* An item of the side menu. */
const MENU = `(async () => { ${KIT}
  const skip = ["shelf", "rescan-library", "offline-mode"];
  return [...document.querySelectorAll(".menu-item")].filter(b => !b.classList.contains("hidden") && !skip.includes(b.dataset.action))
    .map(b => b.dataset.action || b.dataset.target);
})()`;
const ITEM = (key) => `(async () => { ${KIT}
  const open = $("#tnav-menu") && shown($("#tnav-menu")) ? $("#tnav-menu") : $("#menu-toggle");
  open.click(); await sleep(450);
  const b = [...document.querySelectorAll(".menu-item")].find(x => (x.dataset.action || x.dataset.target) === ${JSON.stringify(key)});
  b.click(); await sleep(1200);
  return !shown($("#menu-overlay"));
})()`;

/* An album played to the room, Now playing, the room picker; search; an artist. */
const PLAY = `(async () => { ${KIT}
  const out = {};
  ($("#home-library .album") || $(".album")).click();
  out.album = await until(() => shown($("#album-modal")), 8000);
  const playBtn = () => [...document.querySelectorAll("#modal-actions .action-btn")].find(b => /^Play Now$/.test(b.textContent.trim()) && shown(b));
  out.play = await until(() => playBtn(), 10000);
  // The room known to the page first (its rooms are read after the page opens), or Play asks which.
  out.room = await until(() => /Kitchen/.test(($("#mt-kicker") || {}).textContent || ""), 10000);
  if (out.play) playBtn().click();
  // The album closed straight away (the test tracks last seconds), then the mini player's
  // info tapped while it plays: what is playing, over the page.
  $("#modal-close-btn").click();
  out.closed = await until(() => !shown($("#album-modal")), 5000);
  out.playing = await until(() => /Song|Hi /.test(($("#mt-title") || {}).textContent || ""), 15000);
  // Tapped until it opens: the bar opens what is playing once it has read it (a poll away).
  const npOpen = () => shown($("#np-screen")) || shown($("#album-modal"));
  for (let i = 0; i < 6 && !npOpen(); i++) { $(".mt-info").click(); await until(npOpen, 2500); }
  out.np = npOpen();
  out.diag = { playing: out.playing, zone: localStorage.getItem("rra-zone"), kicker: ($("#mt-kicker") || {}).textContent, title: ($("#mt-title") || {}).textContent, info: !!$(".mt-info"), modal: $("#album-modal").className, np: $("#np-screen") && $("#np-screen").className };
  $("#np-device") && $("#np-device").click(); await sleep(800);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(300);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(300);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(300);
  return out;
})()`;
const SEARCH = `(async () => { ${KIT}
  const out = {};
  $("#search-open").click(); await sleep(300);
  const input = $("#search-input"); input.value = "Album One"; input.dispatchEvent(new Event("input", { bubbles: true }));
  out.search = await until(() => [...document.querySelectorAll("#album-grid .album")].some(a => shown(a) && /Album One/.test(a.textContent)), 8000);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(300);
  window.__showArtistAlbums("Artist A");
  out.artist = await until(() => window.__artistViewActive && window.__artistViewActive(), 8000);
  return out;
})()`;

for (const [layout, opts] of [["a desktop", { width: 1440, height: 900, mouse: true }], ["a phone", { width: 412, height: 915, touch: true }]]) {
  test(`every screen of the page opens with nothing thrown, at ${layout}`, { skip, timeout: 300000 }, async (t) => {
    const house = new FakeHousehold();
    await house.start();
    t.after(() => house.stop());
    const { base, token } = await started(t, { sonosHosts: [ports.host(0)] });
    const b = await Browser.launch({ width: opts.width, height: opts.height, mouse: !!opts.mouse });
    t.after(() => b.close());
    const cookies = [{ name: "musicd_session", value: token, url: base }];
    const fresh = (init) => b.page(base + "/", { cookies, touch: !!opts.touch, init });
    const errors = [];
    const step = async (name, js, init) => {
      const page = await fresh(init);
      const r = await page.eval(js);
      for (const e of page.errors) errors.push(name + ": " + String(e).split("\n")[0]);
      return r;
    };

    const s = await step("settings", SETTINGS);
    assert.deepEqual(s.missed, [], "every Settings and Setup page opens");
    for (const name of ["account", "folders", "playback", "setup", "backup", "system", "smartpicks", "display", "shelfset", "away"]) {
      assert.ok(s.opened.includes(name), name + " opened: " + s.opened.join(", "));
    }

    const rows = await step("rows", ROWS);
    assert.ok(rows.includes("home-library-title"), "Home's rows: " + rows.join(", "));
    for (const id of rows) assert.equal(await step("row " + id, ROW(id)), true, id + "'s wall opens");

    const items = await step("menu", MENU);
    assert.ok(items.includes("playlists") && items.includes("settings-toggle"), "the menu: " + items.join(", "));
    for (const key of items) await step("menu " + key, ITEM(key));

    const room = house.room("Kitchen");
    const zones = (await (await fetch(base + "/api/zones", { headers: { Authorization: "Bearer " + token } })).json()).zones || [];
    const kitchen = zones.find(z => z.display_name === "Kitchen");
    assert.ok(kitchen, "the Kitchen room: " + zones.map(z => z.display_name).join(", "));
    // The room chosen before, as the page remembers it.
    const p = await step("play", PLAY, `localStorage.setItem("rra-zone", ${JSON.stringify(kitchen.zone_id)});`);
    assert.equal(p.album, true, "an album opens");
    assert.equal(p.play, true, "it has a Play button");
    assert.equal(p.room, true, "the room chosen before is the page's");
    assert.equal(p.playing, true, "it plays: " + JSON.stringify(p.diag));
    await until(() => room.state === "PLAYING", 15000);
    assert.equal(p.closed, true, "the album closes");
    assert.equal(p.np, true, "Now playing opens: " + JSON.stringify(p.diag));

    const q = await step("search", SEARCH);
    assert.deepEqual(q, { search: true, artist: true });

    assert.deepEqual(errors, [], "nothing thrown on any screen");
  });
}

async function until(fn, ms) {
  const t0 = Date.now();
  while (!(await fn())) { if (Date.now() - t0 > ms) return false; await new Promise(r => setTimeout(r, 100)); }
  return true;
}
