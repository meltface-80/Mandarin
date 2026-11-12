"use strict";
/*
 * Mandarin OS's system page as it looks on a phone (item 389, 0.1.1), from the OptiPlex's first install:
 *   - each row's state (✓ Running, ✓ Ready, ✓ Connected, ✓ Up to date…) on the row's right, level with it, however long
 *     what the row says on its left (they dropped below it);
 *   - the tab chosen outlined in brass, a pill round its name, and the tabs scrolling without a scrollbar;
 *   - the power button drawn (its ⏻ was two empty boxes in a phone's font), and no page wider than the phone;
 *   - "1 room", and the upkeep's timer "Scheduled", not "Running".
 */
const test = require("node:test");
const assert = require("node:assert");
const { standIn, noPython } = require("./os-standin");
const { Browser, findBrowser } = require("./browser-harness");

const skip = noPython || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

test("the system page on a phone: states on the right, the tab chosen in brass, a drawn power button", { skip, timeout: 120000 }, async () => {
  const box = await standIn({ albums: 0, rooms: 1 });
  const b = await Browser.launch({ width: 412, height: 900 });
  try {
    const page = await b.page(box.base + "/");
    const wait = (js) => page.eval(`(async () => { for (let i = 0; i < 200; i++) { const v = (${js}); if (v) return v; await new Promise(r => setTimeout(r, 50)); } return null; })()`);
    assert.ok(await wait(`document.querySelectorAll("#services .state").length > 5`), "the services shown");
    const rows = await page.eval(`JSON.stringify([...document.querySelectorAll(".row")].filter(r => r.offsetParent && r.querySelector(":scope > .state")).map(r => {
      const row = r.getBoundingClientRect(), s = r.querySelector(":scope > .state").getBoundingClientRect(), t = r.firstElementChild.getBoundingClientRect();
      return { what: r.innerText.split("\\n")[0], right: Math.round(row.right - s.right), level: s.top < t.bottom && s.bottom > t.top, beside: s.left >= t.right - 1 };
    }))`);
    const placed = JSON.parse(rows);
    assert.ok(placed.length >= 12, rows);
    for (const r of placed) assert.ok(r.right <= 1 && r.level && r.beside, "a state on the right of its row, beside what it says: " + JSON.stringify(r));
    assert.match(await page.eval(`document.getElementById("status-rows").innerText`), /0 albums · 1 room\b/);
    assert.match(await page.eval(`document.getElementById("services").innerText`), /Weekly upkeep[\s\S]*✓ Scheduled/);

    const tab = JSON.parse(await page.eval(`(() => { const on = document.querySelector("nav button.on"), cs = getComputedStyle(on), nav = getComputedStyle(document.querySelector("nav"));
      return JSON.stringify({ name: on.textContent, colour: cs.borderTopColor, sides: [cs.borderTopStyle, cs.borderBottomStyle, cs.borderLeftStyle, cs.borderRightStyle], round: parseFloat(cs.borderTopLeftRadius) >= on.offsetHeight / 2, bar: nav.scrollbarWidth }); })()`));
    assert.equal(tab.name, "Overview");
    assert.ok(["rgb(201, 164, 92)", "rgb(155, 122, 53)"].includes(tab.colour), "brass, dark's or light's: " + tab.colour);
    assert.deepEqual(tab.sides, ["solid", "solid", "solid", "solid"], "an outline all round, not an underline");
    assert.ok(tab.round, "a pill");
    assert.equal(tab.bar, "none", "no scrollbar under the tabs");

    assert.ok(await page.eval(`!!document.querySelector("#power-btn svg") && !/[⏻▾]/.test(document.getElementById("power-btn").textContent)`), "the power button drawn");
    assert.ok(await page.eval(`document.documentElement.scrollWidth <= window.innerWidth`), "no page wider than the phone");
    // The last tab, chosen: outlined, and scrolled into sight.
    await page.eval(`document.querySelector('nav button[data-tab="support"]').click()`);
    assert.ok(await wait(`(() => { const r = document.querySelector('nav button[data-tab="support"]').getBoundingClientRect(); return r.right <= window.innerWidth + 1 && r.left >= 0; })()`), "the tab chosen in sight");
  } finally { await b.close(); await box.stop(); }
});
