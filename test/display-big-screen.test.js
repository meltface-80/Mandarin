"use strict";
/*
 * The wall display on a big screen (bug list item 163): on a 65" TV the
 * review card's and the "More from" card's writing was too small to read
 * from across the room. 1600px wide and up they grow with the screen: their
 * writing twice the size at 1920px, the covers as big as two rows of them
 * still fit. A laptop's stay as they were. Skipped where no Chromium or
 * Chrome is found (test/browser-harness.js).
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
