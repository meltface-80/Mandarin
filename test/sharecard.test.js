"use strict";
/*
 * The share card (public/sharecard.js), drawn in a browser: the app's icon
 * as a brass disc inside the pane's bottom-right corner (v0.7.4) — on the
 * glass, not on the card's border — and nothing there without a logo.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { Browser, findBrowser } = require("./browser-harness");

const PUBLIC = path.join(__dirname, "..", "public");
const PAGE = `<!doctype html><meta charset="utf-8"><body><script src="/sharecard.js"></script></body>`;

test("the share card carries the brass duck disc inside its bottom-right corner", { skip: !findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)", timeout: 60000 }, async () => {
  const srv = http.createServer((req, res) => {
    const p = req.url.split("?")[0];
    if (p === "/") { res.setHeader("Content-Type", "text/html"); return res.end(PAGE); }
    try {
      res.setHeader("Content-Type", p.endsWith(".png") ? "image/png" : "application/javascript");
      res.end(fs.readFileSync(path.join(PUBLIC, p)));
    } catch (e) { res.statusCode = 404; res.end(); }
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const b = await Browser.launch({ width: 800, height: 600 });
  try {
    const page = await b.page(`http://127.0.0.1:${srv.address().port}/`);
    const r = await page.eval(`(async () => {
      const draw = async (logoUrl) => {
        // A white sleeve: the worst case for anything drawn over the pane.
        const sleeve = document.createElement("canvas"); sleeve.width = sleeve.height = 400;
        sleeve.getContext("2d").fillStyle = "#fff"; sleeve.getContext("2d").fillRect(0, 0, 400, 400);
        const blob = await ShareCard.render({ coverUrl: sleeve.toDataURL(), logoUrl, wordmarkUrl: null, title: "White Sky", artist: "Peter Green", releaseRaw: "1982", label: "Sanctuary" });
        const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(blob); });
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
        const px = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
        // The disc: 72 px, 34 px in from the pane's bottom-right (the pane is 48 px in from the card's edge).
        const cx = img.width - 48 - 34 - 36, cy = img.height - 48 - 34 - 36;
        return { w: img.width, h: img.height, centre: px(cx, cy), rim: px(cx - 22, cy - 22), outside: px(cx + 44, cy + 44), border: px(img.width - 20, img.height - 20) };
      };
      return { with: await draw("/icons/icon-192.png"), without: await draw(null) };
    })()`);
    assert.deepEqual(page.errors, []);
    assert.equal(r.with.w, 1200); assert.equal(r.with.h, 600);
    const brass = ([R, G, B]) => R > 140 && G > 110 && B < 130 && R > B + 40;
    assert.ok(brass(r.with.rim), "the disc is brass at its top-left, where the icon is plain: " + r.with.rim);
    assert.ok(!brass(r.with.outside), "just outside the disc is the pane, not brass: " + r.with.outside);
    assert.ok(!brass(r.with.border), "nothing on the card's border: " + r.with.border);
    assert.ok(!brass(r.without.rim), "no logo given, no disc: " + r.without.rim);
  } finally { await b.close(); srv.close(); }
});
