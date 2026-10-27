// @ts-check
"use strict";
/*
 * The page's own numbers for every item of the screens contract (bug list
 * item 54; docs/specs/native-parity.md, "The look"): each screen opened in a
 * browser at a phone's size, as test/parity.test.js opens it, and each
 * keyed element's place, size, line boxes and computed style written out,
 * with a screenshot of each screen at a phone's density. The native
 * screens are held to these by hand, number for number, as the app can't be
 * drawn here: a native screen's sizes come from this, not from a reading of
 * the stylesheet (whose rules a palette or a width overrides).
 *
 *   MANDARIN_SERVER_BIN=… CHROME_PATH=… node tools/quality/page-metrics.js [out-dir] [screen,…]
 *
 * Writes out-dir/page-metrics.json (default tools/quality/out) and
 * out-dir/<screen>.png; a screen's nested states (its sheets and menus, the
 * contract's `in`) as "<screen>+<opener>", and the Library's filter as
 * "library+filter". Needs the built server (test/server.js) and a Chromium.
 */
const fs = require("fs");
const path = require("path");
const ports = require("../../test/ports");
const { pdf } = require("../../test/fixtures");
const { until, started } = require("../../test/helpers");
const { FakeHousehold } = require("../../test/fake-sonos");
const { FakeWeb } = require("../../test/fake-web");
const { pitchforkPages, fakeQobuz } = require("../../test/fake-pitchfork");
const { Browser } = require("../../test/browser-harness");
const contract = require("../../docs/specs/screens.json");

/** The Android app's WebView by its name to the server (test/parity.test.js's APP_UA): the page as the app has it. */
const APP_UA = "Mozilla/5.0 (Linux; Android 16) MusicDAndroid/1.0.17";

/** The openers test/parity.test.js drives each screen with: read from it, so there is one way to open a screen. */
function openers() {
  const src = fs.readFileSync(path.join(__dirname, "../../test/parity.test.js"), "utf8");
  const block = src.slice(src.indexOf("const OPEN_NOW_PLAYING"), src.indexOf('test("every screen'));
  return /** @type {Record<string, { open: string, root: string, init?: string, app?: boolean, url?: string, before?: (api: any) => Promise<unknown> }>} */ (new Function(block + "\nreturn SCREENS;")());
}

/** In the page: every keyed element (and the frame's parts) with its rect, line boxes, style and inner texts. */
const DUMP = `(() => {
  const props = ["font-size", "font-weight", "line-height", "letter-spacing", "font-family", "color", "background-color", "border-radius", "border-top-width", "border-top-color",
    "padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-bottom", "gap", "text-transform", "opacity", "box-shadow", "-webkit-line-clamp"];
  const frame = ["#mini-transport", ".mt-text", ".mt-controls", "#touch-nav", ".topbar", "main", "#album-grid", "#tnav-heading", "#album-modal .modal-panel", ".modal-body", ".modal-head",
    ".modal-actions", "#modal-tracks", ".np-transport", ".np-secondary", "#np-screen", ".modal-tabs", ".np-device-popover", ".np-vol-popover", ".mt-zone-popover", ".mt-vol-popover",
    ".lib-sheet", ".lib-sheet-head", ".lib-sheet-body", ".lib-sheet-foot", "#queue-list", ".q-history-head", "#confirm-overlay .confirm-box", ".library-controls", "#booklet-viewer .booklet-head"];
  const els = [...document.querySelectorAll("[data-parity]")].map(e => ({ e, key: e.getAttribute("data-parity") }));
  for (const sel of frame) for (const e of document.querySelectorAll(sel)) els.push({ e, key: "<" + sel + ">" });
  const out = [];
  for (const { e: el, key } of els) {
    const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
    const cs = getComputedStyle(el);
    const o = { key, tag: el.tagName.toLowerCase(), text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 60), x: r.x, y: r.y, w: r.width, h: r.height };
    for (const p of props) o[p.replace(/^-webkit-/, "")] = cs.getPropertyValue(p);
    const rg = document.createRange(); rg.selectNodeContents(el);
    const ls = [...rg.getClientRects()].filter(q => q.width > 0);
    if (ls.length) o.lines = [[ls[0].x, ls[0].y, ls[0].width, ls[0].height], [ls[ls.length - 1].x, ls[ls.length - 1].y, ls[ls.length - 1].width, ls[ls.length - 1].height], ls.length];
    const svg = el.querySelector("svg"); if (svg) { const s = svg.getBoundingClientRect(); o.svg = [s.x - r.x, s.y - r.y, s.width, s.height]; }
    const img = el.querySelector("img"); if (img) { const s = img.getBoundingClientRect(); o.img = [s.x - r.x, s.y - r.y, s.width, s.height, getComputedStyle(img).borderRadius]; }
    const inner = [];
    for (const d of el.querySelectorAll("*")) {
      if (inner.length >= 14) break;
      const own = [...d.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!own && !/^(img|svg|canvas)$/i.test(d.tagName)) continue;
      const dr = d.getBoundingClientRect(); if (!dr.width && !dr.height) continue;
      const ds = getComputedStyle(d);
      inner.push({ tag: d.tagName.toLowerCase(), cls: typeof d.className === "string" ? d.className : "", x: dr.x - r.x, y: dr.y - r.y, w: dr.width, h: dr.height,
        text: own ? (d.textContent || "").trim().slice(0, 24) : "", fs: ds.fontSize, fw: ds.fontWeight, lh: ds.lineHeight, ls: ds.letterSpacing, c: ds.color, bg: ds.backgroundColor,
        br: ds.borderRadius, b: ds.borderTopWidth + " " + ds.borderTopColor, p: [ds.paddingTop, ds.paddingRight, ds.paddingBottom, ds.paddingLeft].join(" "), m: ds.marginTop + " " + ds.marginBottom, tt: ds.textTransform });
    }
    if (inner.length) o.inner = inner;
    out.push(o);
  }
  return out;
})()`;

/** A tap on [sel] in the page, true when it was there to tap. */
const tap = (/** @type {string} */ sel) => `(async () => {
  const b = document.querySelector(${JSON.stringify(sel)});
  if (!b || !b.getClientRects().length) return false;
  b.click(); await new Promise(r => setTimeout(r, 900)); return true;
})()`;

async function main() {
  const outDir = process.argv[2] || path.join(__dirname, "out");
  const only = process.argv[3] ? process.argv[3].split(",") : null;
  fs.mkdirSync(outDir, { recursive: true });
  const house = new FakeHousehold();
  await house.start();
  /** Stand-ins for a test's context: what is started here is stopped at the end. */
  const stops = /** @type {(() => unknown)[]} */ ([]);
  const t = { after: (/** @type {() => unknown} */ fn) => { stops.push(fn); } };
  try {
    // Pitchfork's listings on loopback, for its screens (item 70).
    const web = new FakeWeb(pitchforkPages());
    const qobuz = fakeQobuz();
    await Promise.all([web.start(), qobuz.start()]);
    t.after(() => Promise.all([web.stop(), qobuz.stop()]));
    const { lib, base, token, api } = await started(/** @type {any} */ (t), { sonosHosts: [ports.host(0)], pitchforkBaseUrl: web.base, qobuzBaseUrl: qobuz.base, qobuzSyncDelayMs: 100000 });
    fs.writeFileSync(path.join(lib.music, "Artist A", "Album One", "Booklet.pdf"), pdf(["0 0 1"]));
    const kitchen = await until(async () => ((await api("zones")).json.zones || []).find((/** @type {{ display_name: string }} */ z) => z.display_name === "Kitchen"), 20000, "the Kitchen room");
    const b = await Browser.launch({ width: 412, height: 915 });
    stops.push(() => b.close());
    /** @type {Record<string, unknown>} */
    const all = {};
    for (const [name, how] of Object.entries(openers())) {
      if (only && !only.includes(name)) continue;
      if (how.before) await how.before(api);
      const page = await b.page(base + (how.url || "/"), { cookies: [{ name: "musicd_session", value: token, url: base }], touch: true, init: `localStorage.setItem("rra-zone", ${JSON.stringify(kitchen.zone_id)});` + (how.init || ""),
        userAgent: how.app ? APP_UA : null });
      await page.send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
      const opened = await page.eval(how.open);
      console.log(name + ": " + opened);
      if (opened !== "open") { all[name] = { error: opened }; continue; }
      all[name] = await page.eval(DUMP);
      await page.screenshot(path.join(outDir, name + ".png"));
      const items = contract.screens[name].items;
      const ins = [...new Set(Object.values(items).map((/** @type {{ in?: string }} */ it) => it.in).filter(Boolean))];
      if (name === "library") ins.push("#tnav-search");
      for (const op of ins) {
        const sel = op.startsWith("#") ? op : `[data-parity~="${name}.${op}"]`;
        const state = name + "+" + (op === "#tnav-search" ? "filter" : op);
        if (!(await page.eval(tap(sel)))) { console.log(state + ": no opener"); continue; }
        all[state] = await page.eval(DUMP);
        await page.screenshot(path.join(outDir, state + ".png"));
        await page.eval(`(async () => {
          const c = document.querySelector('[data-parity~="${name}.${op}-close"]');
          if (c && c.getClientRects().length) c.click(); else { const b = document.querySelector(${JSON.stringify(sel)}); if (b) b.click(); }
          await new Promise(r => setTimeout(r, 400));
        })()`);
      }
    }
    fs.writeFileSync(path.join(outDir, "page-metrics.json"), JSON.stringify(all, null, 1));
    console.log("written: " + path.join(outDir, "page-metrics.json"));
  } finally {
    for (const stop of stops.reverse()) await stop();
    await house.stop();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
