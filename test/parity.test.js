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
const ports = require("./ports");
const { started, until } = require("./helpers");
const { FakeHousehold } = require("./fake-sonos");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");
const contract = require("../docs/specs/screens.json");

const skip = built() || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

/*
 * In the page: the screen [name] under [rootSel] checked against [items].
 * Returns what is wrong, one line each: an empty list is a screen that keeps
 * the contract.
 */
const CHECK = (name, items, rootSel) => `(async () => {
  const S = ${JSON.stringify(name)}, items = ${JSON.stringify(items)};
  const root = document.querySelector(${JSON.stringify(rootSel)});
  if (!root) return ["no " + ${JSON.stringify(rootSel)} + " on the page"];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const shown = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const CONTROL = "button, input, select, textarea, a[href], [role=button], [role=tab], [role=slider], [tabindex]:not([tabindex='-1']), [contenteditable=true]";
  const keysOf = e => (e.getAttribute && e.getAttribute("data-parity") || "").split(/\\s+/).filter(k => k.startsWith(S + ".")).map(k => k.slice(S.length + 1));
  const keyOf = e => { for (let x = e; x && x !== root.parentElement; x = x.parentElement) { const k = keysOf(x); if (k.length) return k[0]; } return null; };
  const describe = e => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\\s+/).join(".") : "");
  const labelOf = e => (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\\s+/g, " ");
  const pattern = l => new RegExp("^" + l.replace(/[.*+?^$()|[\\]\\\\]/g, "\\\\$&").replace(/\\{[^}]+\\}/g, ".+") + "$");
  const el = k => root.querySelector('[data-parity~="' + S + "." + k + '"]');
  const out = new Set();
  // What is on screen now: each control and each thing shown carries a key of the right kind.
  const sweep = (state) => {
    for (const e of root.querySelectorAll(CONTROL)) {
      if (!shown(e)) continue;
      const k = keyOf(e);
      if (!k) out.add(state + ": a control the contract doesn't list: " + describe(e) + " (" + labelOf(e) + ")");
      else if (items[k] && items[k].kind !== "action") out.add(state + ": " + k + " is a control; the contract says it only shows");
    }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const p = n.parentElement;
      if (n.textContent.trim() && shown(p) && !p.closest(CONTROL) && !keyOf(p)) out.add(state + ": text the contract doesn't list: " + describe(p) + " (" + n.textContent.trim().slice(0, 40) + ")");
    }
    for (const e of root.querySelectorAll("img, canvas, svg, video")) {
      if (shown(e) && !e.closest(CONTROL) && !keyOf(e)) out.add(state + ": a picture the contract doesn't list: " + describe(e));
    }
    for (const e of root.querySelectorAll("[data-parity]")) for (const k of keysOf(e)) if (!items[k]) out.add("the page has " + S + "." + k + ", which the contract doesn't");
  };
  // Each item of [opener] (none: the screen as it opens) there, and called what the contract says.
  const present = (opener) => {
    for (const [k, it] of Object.entries(items)) {
      if ((it.in || null) !== opener) continue;
      const e = el(k);
      if (!e) { out.add(S + "." + k + " is not on the page"); continue; }
      if (it.when || it.only) continue;
      if (!shown(e)) { out.add(S + "." + k + " is not shown" + (opener ? " once " + opener + " is tapped" : "")); continue; }
      if (it.kind !== "action" || !it.label) continue;
      const target = e.matches(CONTROL) ? e : [...e.querySelectorAll(CONTROL)].find(shown);
      if (!target) { out.add(S + "." + k + " has nothing to tap"); continue; }
      const labels = [].concat(it.label), got = labelOf(target);
      if (!labels.some(l => pattern(l).test(got))) out.add(S + "." + k + " is called \\"" + got + "\\", the contract says " + labels.map(l => "\\"" + l + "\\"").join(" or "));
    }
  };
  sweep("as it opens");
  present(null);
  for (const opener of [...new Set(Object.values(items).map(it => it.in).filter(Boolean))]) {
    const b = el(opener);
    if (!b || !shown(b)) continue;
    b.click(); await sleep(500);
    sweep(opener + " tapped");
    present(opener);
    b.click(); await sleep(300);
  }
  return [...out];
})()`;

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

/* How the page is brought to each screen of the contract, and what holds it. */
const SCREENS = {
  "now-playing": { open: OPEN_NOW_PLAYING, root: "#album-modal .modal-panel" }
};

test("every screen of the contract has a way to open it on the page", () => {
  assert.deepEqual(Object.keys(SCREENS).sort(), Object.keys(contract.screens).sort());
});

test("the page keeps the screens contract: each native screen's controls and readouts, and nothing else", { skip, timeout: 240000 }, async (t) => {
  const house = new FakeHousehold();
  await house.start();
  t.after(() => house.stop());
  const { base, token, api } = await started(t, { sonosHosts: [ports.host(0)] });
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
      const wrong = await page.eval(CHECK(name, contract.screens[name].items, how.root));
      assert.deepEqual(wrong, [], name + ": the page and the contract differ:\n  " + wrong.join("\n  "));
      assert.deepEqual(page.errors, [], "nothing thrown");
    });
  }
});
