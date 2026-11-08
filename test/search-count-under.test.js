"use strict";
/*
 * Search's count under the field, never beside it (item 372). Reported from the app: "1 artist, 60+ albums" stood to the
 * right of the search field, which gave up its width to it, more the longer the count. Now the count is a line of its
 * own under the field, on the page (hung in the gap between the top bar and the results' first heading) and in the app
 * (a line under the field's row): the field is as wide with a count as without one, on a phone's width and a desktop's.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s);
  const until = async (f, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(30); } };
  await until(() => document.querySelector("#home-view .album"));
  window.__runSearch("");   // opened, nothing asked: no count yet
  await sleep(400);
  const box = () => { const r = $(".search-box").getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width }; };
  const before = box();
  const input = $("#search-input"); input.value = "Album"; input.dispatchEvent(new Event("input", { bubbles: true }));
  await until(() => $("#search-status").textContent.trim().length > 0 && [...document.querySelectorAll("#album-grid .album")].length > 0);
  await sleep(200);
  const status = $("#search-status"), s = status.getBoundingClientRect();
  const head = [...document.querySelectorAll(".search-section-header")].find(h => h.getBoundingClientRect().height > 0);
  const tile = [...document.querySelectorAll("#album-grid .album")].find(a => a.getBoundingClientRect().height > 0);
  const first = (head || tile).getBoundingClientRect();
  return { text: status.textContent.trim(), before, after: box(), status: { l: s.left, t: s.top, r: s.right, b: s.bottom, h: s.height }, firstTop: first.top,
    visible: getComputedStyle(status).display !== "none" && getComputedStyle(status).visibility !== "hidden", vw: innerWidth };
})()`;

test("the search count under the field: the field as wide with it as without it", { skip, timeout: 150000 }, async (t) => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  for (const [w, h, touch] of [[390, 844, true], [1280, 800, false]]) {
    const size = `${w}x${h}`;
    const b = await Browser.launch({ width: w, height: h });
    let r;
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch });
      r = await page.eval(DRIVER);
      assert.deepEqual(page.errors, [], size);
    } finally { await b.close(); }
    assert.ok(r.before.w > 100, `${size}: the field open (${r.before.w} wide)`);
    assert.ok(r.text.length > 0 && r.visible && r.status.h > 0, `${size}: a count shown (${r.text})`);
    assert.ok(Math.abs(r.after.w - r.before.w) < 1, `${size}: the field as wide with the count as without it (${r.before.w} → ${r.after.w})`);
    assert.ok(r.status.t >= r.after.b - 0.5, `${size}: the count under the field (${r.status.t} under ${r.after.b})`);
    assert.ok(r.status.l >= r.after.l - 0.5 && r.status.r <= r.vw, `${size}: within the page's width, from the field's left`);
    assert.ok(r.status.b <= r.firstTop + 0.5, `${size}: clear of the results under it (${r.status.b} over ${r.firstTop})`);
  }
});

test("the app: the count a line under the field's row, never in it", () => {
  const kt = fs.readFileSync(path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android/SearchScreen.kt"), "utf8");
  const bar = kt.slice(kt.indexOf("private fun FieldBar("), kt.indexOf("/** The ✕ in the field"));
  const row = bar.indexOf("Row(Modifier.fillMaxWidth().height(64.dp)");
  const status = bar.indexOf('parity("search.status")');
  const divider = bar.indexOf("HorizontalDivider(");
  assert.ok(row > 0 && status > row && divider > status, "the count after the row, before the hairline");
  // The row closed before the count: its braces balanced between the row's opening and the count.
  const between = bar.slice(row, status);
  const open = (between.match(/\{/g) || []).length, shut = (between.match(/\}/g) || []).length;
  assert.equal(open, shut, "the row's block closed before the count: it is no longer beside the field");
});
