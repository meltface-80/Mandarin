"use strict";
/*
 * The Pages site's languages in a browser (item 408): docs/ served as GitHub Pages serves it, with a small dictionary
 * of the test's own in place of docs/i18n/*.json.
 *   - the selector is the first thing at the far left of the top bar, on a phone and on a computer, and no page is
 *     wider than the phone;
 *   - choosing a language puts the marked texts (and attributes) in it, keeps the English where it has no words, and is
 *     remembered on another page;
 *   - a browser in German (de-DE) opens in Deutsch on a first visit, one in Norwegian Bokmål (nb-NO) in Norsk, one in a
 *     language of none of the nine in English;
 *   - English puts every text back as the page wrote it.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { Browser, findBrowser } = require("./browser-harness");

const skip = !findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)";
const DOCS = path.join(__dirname, "..", "docs");

// The test's dictionaries: a few keys, the rest left to fall back to English.
const WORDS = {
  fr: {
    "site.contents": "← Sommaire", "site.copy": "Copier", "site.copied": "Copié", "site.language": "Langue",
    "install.h1": "Installer le serveur", "install.linux.title": "Installer sous Linux <small>(l'autre façon)</small>",
    "how-it-works.h1": "Comment ça marche", "index.h1": "Votre musique, partout chez vous"
  },
  de: { "install.h1": "Den Server installieren", "site.contents": "← Inhalt", "index.h1": "Ihre Musik, überall zu Hause" }
};

function serve() {
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const lang = url.match(/^\/i18n\/([a-z]+)\.json$/);
    if (lang) {
      res.writeHead(200, { "content-type": types[".json"] });
      return res.end(JSON.stringify(WORDS[lang[1]] || {}));
    }
    const file = path.join(DOCS, path.normalize(url === "/" ? "/index.html" : url));
    if (!file.startsWith(DOCS) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r({ base: `http://127.0.0.1:${server.address().port}`, stop: () => new Promise(d => server.close(d)) })));
}

/** The page once i18n.js has put it in a language: that language. */
const settled = (page) => page.eval(`(async () => { for (let i = 0; i < 200; i++) { const l = document.documentElement.getAttribute("data-lang"); if (l) return l; await new Promise(r => setTimeout(r, 25)); } return null; })()`);
const choose = (page, lang) => page.eval(`(async () => { const s = document.getElementById("lang-select"); document.documentElement.removeAttribute("data-lang");
  s.value = ${JSON.stringify(lang)}; s.dispatchEvent(new Event("change")); })()`).then(() => settled(page));
const text = (page, key) => page.eval(`document.querySelector('[data-i18n="${key}"]').innerHTML`);

/** Where the top bar's visible items sit, left to right, and whether anything is wider than the window. */
const bar = (page) => page.eval(`JSON.stringify((() => {
  const wrap = document.querySelector("header.pagehead .wrap");
  const items = [...wrap.children].filter(e => e.getClientRects().length && e.getBoundingClientRect().width > 0 && !e.classList.contains("spacer"))
    .map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top) }; });
  return { items, first: wrap.firstElementChild.id, wide: document.documentElement.scrollWidth > window.innerWidth, width: window.innerWidth };
})())`).then(JSON.parse);

for (const [name, width, pages] of [["a phone", 360, ["install.html", "index.html", "mandarin-os.html"]], ["a computer", 1280, ["install.html", "index.html"]]]) {
  test(`the language selector is first, at the far left of the top bar, on ${name}`, { skip, timeout: 120000 }, async () => {
    const site = await serve();
    const b = await Browser.launch({ width, height: 800, mouse: width > 1000 });
    try {
      for (const p of pages) {
        const page = await b.page(`${site.base}/${p}`);
        await settled(page);
        const t = await bar(page);
        assert.equal(t.first, "lang-select", p + ": the first in the bar");
        assert.equal(t.items[0].id, "lang-select", p + ": the first seen: " + JSON.stringify(t.items));
        const leftmost = Math.min(...t.items.map(i => i.left));
        assert.equal(t.items[0].left, leftmost, p + ": the furthest left");
        assert.ok(t.items[0].left <= (width > 1000 ? (width - 980) / 2 + 24 : 24), p + ": at the bar's left edge: " + t.items[0].left);
        assert.ok(t.items.every(i => i.top === t.items[0].top || Math.abs(i.top - t.items[0].top) < 12), p + ": one row: " + JSON.stringify(t.items));
        assert.ok(t.items.every(i => i.right <= width), p + ": nothing off the screen: " + JSON.stringify(t.items));
        assert.equal(t.wide, false, p + ": no page wider than the window");
        assert.deepEqual(page.errors, [], p);
      }
    } finally { await b.close(); await site.stop(); }
  });
}

test("choosing a language puts the marked texts in it, is remembered on another page, and English puts them back", { skip, timeout: 120000 }, async () => {
  const site = await serve();
  const b = await Browser.launch({ width: 1280, height: 800, mouse: true });
  try {
    const page = await b.page(`${site.base}/install.html`, { init: `Object.defineProperty(Navigator.prototype, "language", { get: () => "en-GB" });` });
    assert.equal(await settled(page), "en");
    const english = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll("[data-i18n]")].map(e => [e.getAttribute("data-i18n"), e.innerHTML]))`));
    assert.ok(english.length > 30, "the page's marked texts: " + english.length);
    const lead = await text(page, "install.lead");

    assert.equal(await choose(page, "fr"), "fr");
    assert.equal(await text(page, "install.h1"), "Installer le serveur");
    assert.equal(await text(page, "install.linux.title"), "Installer sous Linux <small>(l'autre façon)</small>");
    assert.equal(await text(page, "site.contents"), "← Sommaire");
    assert.equal(await text(page, "install.lead"), lead, "a key the language lacks keeps the English");
    assert.equal(await page.eval(`document.documentElement.lang`), "fr");
    assert.equal(await page.eval(`document.getElementById("lang-select").getAttribute("aria-label")`), "Langue", "an attribute too");
    assert.equal(await page.eval(`document.querySelector(".copy-btn").textContent + "/" + document.querySelector(".copy-btn").getAttribute("data-copied")`), "Copier/Copié");
    assert.equal(await page.eval(`localStorage.getItem("mandarin-lang")`), "fr");

    // Another page, in another tab: French already, and the selector says so.
    const other = await b.page(`${site.base}/how-it-works.html`, { init: `Object.defineProperty(Navigator.prototype, "language", { get: () => "en-GB" });` });
    assert.equal(await settled(other), "fr", "remembered");
    assert.equal(await text(other, "how-it-works.h1"), "Comment ça marche");
    assert.equal(await other.eval(`document.getElementById("lang-select").value`), "fr");

    // German, then English: every text as the page wrote it, none of either language left.
    assert.equal(await choose(page, "de"), "de");
    assert.equal(await text(page, "install.h1"), "Den Server installieren");
    assert.equal(await text(page, "install.linux.title"), english.find(e => e[0] === "install.linux.title")[1], "a key German lacks: English, not the French before it");
    assert.equal(await choose(page, "en"), "en");
    const back = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll("[data-i18n]")].map(e => [e.getAttribute("data-i18n"), e.innerHTML]))`));
    assert.deepEqual(back, english, "English restores the original text");
    assert.equal(await page.eval(`document.getElementById("lang-select").getAttribute("aria-label") + "/" + document.documentElement.lang`), "Language/en");
    assert.equal(await page.eval(`localStorage.getItem("mandarin-lang")`), "en");
    assert.deepEqual(page.errors, []);
  } finally { await b.close(); await site.stop(); }
});

for (const [said, lang, h1] of [["de-DE", "de", "Ihre Musik, überall zu Hause"], ["nb-NO", "no", null], ["pt-BR", "en", null]]) {
  test(`a first visit from a browser in ${said} opens in ${lang}`, { skip, timeout: 120000 }, async () => {
    const site = await serve();
    const b = await Browser.launch({ width: 1280, height: 800, mouse: true });
    try {
      const page = await b.page(`${site.base}/index.html`, { init: `Object.defineProperty(Navigator.prototype, "language", { get: () => ${JSON.stringify(said)} });` });
      assert.equal(await settled(page), lang);
      assert.equal(await page.eval(`document.getElementById("lang-select").value`), lang);
      if (h1) assert.equal(await text(page, "index.h1"), h1);
      // The choice made by hand outlasts the browser's language.
      assert.equal(await choose(page, "fr"), "fr");
      const again = await b.page(`${site.base}/index.html`, { init: `Object.defineProperty(Navigator.prototype, "language", { get: () => ${JSON.stringify(said)} });` });
      assert.equal(await settled(again), "fr");
    } finally { await b.close(); await site.stop(); }
  });
}
