"use strict";
/*
 * The wall display on a big screen (bug list item 163): on a 65" TV the
 * review card's and the "More from" card's writing was too small to read
 * from across the room. 1600px wide and up they grow with the screen: their
 * writing twice the size at 1920px, the covers as big as two rows of them
 * still fit. A laptop's stay as they were. And twice the size, they still
 * fit their cards (item 177): a long review or biography is cut at a whole
 * line with its attribution under it, and both rows of covers with their
 * titles show, at 1920 x 1080 and at 3840 x 2160. Skipped where no Chromium
 * or Chrome is found (test/browser-harness.js).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = !findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)";
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;

// The two cards as display.js builds them, measured where its stylesheet has them.
const MEASURE = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 200 && document.readyState !== "complete"; i++) await sleep(50);
  const make = (html) => { const d = document.createElement("div"); d.innerHTML = html; document.body.appendChild(d.firstChild); return document.body.lastChild; };
  const review = make('<div class="review-card"><h2>The Hunter</h2><div class="review-text">The Hunter is the seventh studio album by Jennifer Warnes.</div><div class="review-attrib">Album timeline — Wikipedia</div></div>');
  const more = make('<div class="more-card"><h2>More from Jennifer Warnes</h2><div class="more-sub">from your library</div><div class="more-grid"><div class="more-cell"><div class="more-title">Famous Blue Raincoat</div></div></div></div>');
  const px = (el, sel) => parseFloat(getComputedStyle(sel ? el.querySelector(sel) : el).fontSize);
  return {
    heading: px(review, "h2"), text: px(review, ".review-text"), attrib: px(review, ".review-attrib"),
    more: px(more, "h2"), sub: px(more, ".more-sub"), title: px(more, ".more-title"),
    moreWidth: parseFloat(getComputedStyle(more).maxWidth) || getComputedStyle(more).maxWidth
  };
})()`;

// The longest of each, as display.js builds them, in a slide where the stage shows it: a review of some 2,000
// characters under a heading of two lines, and eight covers with their titles.
const FULL = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 200 && document.readyState !== "complete"; i++) await sleep(50);
  const slide = (node) => { const s = document.createElement("div"); s.className = "slide visible"; s.appendChild(node); document.getElementById("stage").appendChild(s); return node; };
  const el = (cls, text, tag) => { const e = document.createElement(tag || "div"); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const words = "The Hunter is the seventh studio album by Jennifer Warnes, her first in nine years, recorded in Los Angeles with Roscoe Beck producing and a band of the city's best session players. ";
  const review = slide(el("review-card"));
  review.append(el("", "The Hunter (Remastered and Expanded Edition with the Private Recordings) — Jennifer Warnes", "h2"),
    el("review-text", words.repeat(11).slice(0, 2000)), el("review-attrib", "Album timeline — Wikipedia, under CC BY-SA 4.0"));
  const more = slide(el("more-card"));
  const grid = el("more-grid");
  const cover = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#357"/></svg>');
  for (let i = 0; i < 8; i++) {
    const cell = el("more-cell"); const img = document.createElement("img"); img.alt = ""; img.src = cover;
    cell.append(img, el("more-title", "Famous Blue Raincoat (20th Anniversary Edition) " + i)); grid.appendChild(cell);
  }
  more.append(el("", "More from Jennifer Warnes", "h2"), el("more-sub", "from your library"), grid);
  await Promise.all([...more.querySelectorAll("img")].map(i => i.decode().catch(() => null)));
  await sleep(100);
  const box = e => e.getBoundingClientRect();
  const text = review.querySelector(".review-text"), lh = parseFloat(getComputedStyle(text).lineHeight);
  return {
    height: innerHeight,
    review: { bottom: box(review).bottom, attrib: box(review.querySelector(".review-attrib")).bottom,
      lines: box(text).height / lh, size: parseFloat(getComputedStyle(text).fontSize) },
    more: { bottom: box(more).bottom, grid: box(grid).bottom, title: box(grid.lastElementChild.querySelector(".more-title")).bottom,
      size: parseFloat(getComputedStyle(grid.querySelector(".more-title")).fontSize) }
  };
})()`;

test("the wall display's review and More from cards, twice the size on a TV", { skip, timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-display-big-"));
  fs.mkdirSync(path.join(tmp, "music"));
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: path.join(tmp, "music"), dataDir: path.join(tmp, "data"), serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const at = async (width, height) => {
      const b = await Browser.launch({ width, height });
      try {
        const page = await b.page(B + "/display", { cookies: [{ name: "musicd_session", value: token, url: B }] });
        return await page.eval(MEASURE);
      } finally { await b.close(); }
    };
    const laptop = await at(1280, 800);
    assert.deepEqual([laptop.heading, laptop.text, laptop.attrib, laptop.sub, laptop.title], [26, 19, 13, 14, 13], "a laptop's as they were");
    const tv = await at(1920, 1080);
    const twice = (got, was, what) => assert.ok(Math.abs(got - 2 * was) < 0.6, `${what}: ${got}, twice ${was}`);
    twice(tv.heading, 26, "the review's heading");
    twice(tv.text, 19, "the review");
    twice(tv.attrib, 13, "whose words");
    twice(tv.more, 32, "More from's heading");
    twice(tv.sub, 14, "from your library");
    twice(tv.title, 13, "an album's title");
    assert.ok(Math.abs(tv.moreWidth - 1166.4) < 1, `the covers' card as wide as the height lets: ${tv.moreWidth}`);
  } finally {
    await srv.stop();
  }
});

test("twice the size, a long review and a full More from still fit their cards on a TV", { skip, timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-display-fit-"));
  fs.mkdirSync(path.join(tmp, "music"));
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: path.join(tmp, "music"), dataDir: path.join(tmp, "data"), serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    for (const [width, height] of [[1920, 1080], [3840, 2160]]) {
      const b = await Browser.launch({ width, height });
      let r;
      try {
        const page = await b.page(B + "/display", { cookies: [{ name: "musicd_session", value: token, url: B }] });
        r = await page.eval(FULL);
      } finally { await b.close(); }
      const at = `${width} x ${height}`;
      assert.ok(Math.abs(r.review.size - 38 * width / 1920) < 1, `${at}: the review still twice the size (${r.review.size}px)`);
      assert.ok(Math.abs(r.more.size - 26 * width / 1920) < 1, `${at}: the covers' titles still twice the size (${r.more.size}px)`);
      assert.ok(r.review.attrib <= r.review.bottom + 0.5, `${at}: whose words, inside the review's card (${r.review.attrib} of ${r.review.bottom})`);
      assert.ok(Math.abs(r.review.lines - Math.round(r.review.lines)) < 0.05, `${at}: the review cut at a whole line (${r.review.lines})`);
      assert.ok(r.more.grid <= r.more.bottom + 0.5 && r.more.title <= r.more.bottom + 0.5,
        `${at}: both rows of covers and their titles inside the card (grid ${r.more.grid}, last title ${r.more.title}, card ${r.more.bottom})`);
      for (const [what, bottom] of [["the review", r.review.bottom], ["More from", r.more.bottom]]) {
        assert.ok(bottom <= r.height * 0.86 + 0.5, `${at}: ${what} clear of the bottom strip (${bottom} of ${r.height})`);
      }
    }
  } finally {
    await srv.stop();
  }
});
