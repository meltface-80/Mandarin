"use strict";
/*
 * Settings on a tablet or a desktop (v0.6.6): the list opens as a drawer the
 * side menu's width, and each page only as wide as it needs (within
 * 360–680px), over the dimmed page; a click outside closes it. A phone, held
 * either way, still fills the screen. Skipped where no Chromium or Chrome is found.
 */
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = 3625;
const B = "http://127.0.0.1:" + PORT;

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  await until(() => document.querySelector("#home-random .album, #home-today .album"));
  const sheet = () => document.querySelector("#settings-overlay > .settings-sheet");
  const width = () => Math.round(sheet().getBoundingClientRect().width);
  const out = { vw: innerWidth };
  document.getElementById("menu-toggle").click(); await sleep(400);
  out.menu = Math.round(document.querySelector(".menu-drawer").getBoundingClientRect().width);
  document.querySelector(".menu-backdrop").click(); await sleep(400);
  document.getElementById("settings-toggle").click(); await sleep(400);
  out.list = { w: width(), left: Math.round(sheet().getBoundingClientRect().left) };
  out.panes = {};
  // The list's order (v0.6.21), and Setup's.
  const titles = sel => [...document.querySelectorAll(sel + ' .settings-nav-item:not(.hidden) .settings-nav-title')].map(t => t.textContent);
  out.order = titles('#settings-overlay .settings-view[data-view="home"]');
  out.setup_order = titles('#settings-overlay .settings-pane[data-pane="setup"]');
  const SETUP = ["ui", "homescreen"];
  for (const p of ["ui", "identify", "homescreen", "system"]) {
    if (SETUP.includes(p)) { document.querySelector('#settings-overlay .settings-nav-item[data-pane="setup"]').click(); await sleep(300); }
    document.querySelector('#settings-overlay .settings-nav-item[data-pane="' + p + '"]').click(); await sleep(500);
    out.panes[p] = { w: width(), overflow: sheet().scrollWidth > sheet().clientWidth + 1 };
    document.querySelector('#settings-overlay .settings-pane:not(.hidden) [data-settings-back]').click(); await sleep(200);
    if (SETUP.includes(p)) {
      // Back from one of Setup's pages is Setup, then the list.
      out["back_from_" + p] = !document.querySelector('#settings-overlay .settings-pane[data-pane="setup"]').classList.contains("hidden");
      document.querySelector('#settings-overlay .settings-pane:not(.hidden) [data-settings-back]').click(); await sleep(200);
    }
  }
  out.back_to_list = width();
  // +75% and +100% text: offered on a desktop only, and +50% anywhere else.
  document.querySelector('#settings-overlay .settings-nav-item[data-pane="setup"]').click(); await sleep(200);
  document.querySelector('#settings-overlay .settings-nav-item[data-pane="ui"]').click(); await sleep(300);
  out.text_options = [...document.querySelectorAll("#ui-text-select option")].filter(o => !o.hidden).map(o => o.textContent);
  window.__uiPrefs.set("text", "2");
  out.text_2 = window.__uiPrefs.get("text");
  window.__uiPrefs.set("text", "1");
  document.querySelector('#settings-overlay .settings-pane:not(.hidden) [data-settings-back]').click(); await sleep(200);
  document.querySelector('#settings-overlay .settings-pane:not(.hidden) [data-settings-back]').click(); await sleep(200);
  document.querySelector("#settings-overlay .settings-backdrop").click(); await sleep(300);
  out.closed = document.getElementById("settings-overlay").classList.contains("hidden");
  return out;
})()`;

test("Settings on a tablet or desktop: the list at the side menu's width, each page as wide as it needs", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    for (let i = 0; i < 100; i++) {
      const st = await (await fetch(B + "/api/status", { headers: H })).json();
      if (st.index_count >= 3 && !st.library_importing) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const run = async (size) => {
      const b = await Browser.launch(size);
      try {
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
        const r = await page.eval(DRIVER);
        assert.deepEqual(page.errors, []);
        return r;
      } finally { await b.close(); }
    };
    for (const size of [{ width: 1440, height: 900, mouse: true }, { width: 1180, height: 820 }, { width: 820, height: 1180 }]) {
    const desk = await run(size);
    assert.equal(desk.list.w, desk.menu, size.width + "px: the list is the side menu's width");
    assert.deepEqual(desk.order, ["Account", "Music Folders", "Services", "Audio Devices", "Wall Display", "Library Scanner", "Setup", "Backup & restore", "Updates"]);
    assert.deepEqual(desk.setup_order, ["Smart Picks", "Discover", "Record labels", "Home Screen", "UI Settings", "Share Card", "Away from home", "API Keys"]);
    assert.equal(desk.back_from_ui, true, "Back from UI Settings is Setup");
    assert.equal(desk.back_from_homescreen, true);
    assert.equal(desk.list.left, 0, "from the left, as the menu");
    for (const [p, v] of Object.entries(desk.panes)) {
      assert.ok(v.w >= 360 && v.w <= 680, p + " is " + v.w + "px");
      assert.equal(v.overflow, false, p + " fits its width");
    }
    assert.ok(desk.panes.ui.w < desk.panes.homescreen.w, "a short page is narrower than a long one");
    assert.equal(desk.back_to_list, desk.menu, "back on the list, back to the menu's width");
    assert.equal(desk.closed, true, "a click outside closes it");
    const isDesk = !!size.mouse;
    assert.deepEqual(desk.text_options, isDesk ? ["Normal", "+10%", "+25%", "+50%", "+75%", "+100%"] : ["Normal", "+10%", "+25%", "+50%"], size.width + "px: text sizes offered");
    assert.equal(desk.text_2, isDesk ? "2" : "1.5", size.width + "px: +100% is a desktop's");
    }

    const phone = await run({ width: 390, height: 844 });
    assert.equal(phone.list.w, 390, "a phone keeps the full screen");
    assert.deepEqual(phone.text_options, ["Normal", "+10%", "+25%", "+50%"], "a phone stops at +50%");
    assert.equal(phone.text_2, "1.5");
    for (const v of Object.values(phone.panes)) assert.equal(v.w, 390);
    const sideways = await run({ width: 844, height: 390 });
    assert.equal(sideways.list.w, 844, "a phone on its side keeps the full screen");
  } finally {
    await srv.stop();
  }
});
