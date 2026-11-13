"use strict";
/*
 * The Pages site's languages (item 408): every page's prose marked for translation, docs/i18n/en.json the English of
 * every mark, each other language with the same keys and the same markup (tools/docs/i18n.js), the selector first in
 * every page's top bar, and the Features page what tools/docs/features.py writes, its cards marked too. A docs change
 * without its translations fails here. (The selector at work, in a browser: site-languages-browser.test.js.)
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const i18n = require("../tools/docs/i18n");

const ROOT = path.join(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const pages = fs.readdirSync(DOCS).filter(f => f.endsWith(".html")).sort();
const noPython = spawnSync("python3", ["--version"]).status !== 0 && "python3 is not installed";

test("every page's prose is marked, en.json is the pages' English, and each language keeps the English's markup", () => {
  // Every language has every key: a page changed without its translations fails here.
  const problems = i18n.check();
  assert.deepEqual(problems, [], problems.slice(0, 20).join("\n"));
  const en = JSON.parse(fs.readFileSync(path.join(DOCS, "i18n", "en.json"), "utf8"));
  assert.ok(Object.keys(en).length > 800, "every page's texts: " + Object.keys(en).length);
  for (const k of ["site.language", "site.contents", "site.copy", "site.copied", "site.coffee", "features.home.title", "features.home.how", "features.home.info", "install.h1", "index.lead"]) {
    assert.ok(typeof en[k] === "string" && en[k], k);
  }
});

test("a language file is held to the English: every key, no stale one, the same tags, links and code", () => {
  const en = { strings: { "p.a": 'Open <a href="x.html">the page</a> and type <code>yes</code>.', "p.b": "Two <b>words</b>", "p.c": "Language" }, attrKeys: new Set(["p.c"]), problems: [] };
  const ok = { "p.a": 'Ouvrez <a href="x.html">la page</a> et tapez <code>yes</code>.', "p.b": "Deux <b>mots</b>", "p.c": "Langue" };
  assert.deepEqual(i18n.checkLanguage("fr", ok, en), []);
  const said = (dict) => i18n.checkLanguage("fr", dict, en).join("\n");
  assert.match(said({ ...ok, "p.b": undefined }), /"p\.b" is not a text/);
  const { "p.b": _gone, ...short } = ok;
  assert.match(said(short), /"p\.b" is missing/);
  assert.match(said({ ...ok, "p.z": "x" }), /"p\.z" is no longer on any page/);
  assert.match(said({ ...ok, "p.a": "Ouvrez la page et tapez <code>yes</code>." }), /"p\.a": its tags/, "a link dropped");
  assert.match(said({ ...ok, "p.a": 'Ouvrez <a href="y.html">la page</a> et tapez <code>yes</code>.' }), /"p\.a": its tags/, "a link moved");
  assert.match(said({ ...ok, "p.a": 'Ouvrez <a href="x.html">la page</a> et tapez <code>oui</code>.' }), /<code> must hold/, "code translated");
  assert.match(said({ ...ok, "p.b": "Deux <b>mots" }), /left open/);
  assert.match(said({ ...ok, "p.c": "<b>Langue</b>" }), /attribute's text: no markup/);
  assert.match(said({}), /"p\.a" is missing/, "an empty file is reported");
  assert.match(said([]), /not a \{ key: text \} object/);
});

test("the page scan finds prose left unmarked, a mark inside a mark, and one key with two Englishes", () => {
  const scan = (html) => i18n.scan(html, "p.html");
  const page = '<!DOCTYPE html><html><head><title data-i18n="p.t">A page</title></head><body>' +
    '<p data-i18n="p.a">Some <b>words</b></p><div class="badges" translate="no"><span>Mandarin OS 0.1.6</span></div>' +
    '<pre>curl -fsSL a | sudo sh</pre><h3>Linux</h3><span>v1.3.2</span><button data-i18n-attr="aria-label:p.l" aria-label="Say it">i</button></body></html>';
  const r = scan(page);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.texts.map(t => [t.key, t.value, t.attr]), [["p.t", "A page", false], ["p.a", "Some <b>words</b>", false], ["p.l", "Say it", true]]);
  assert.match(scan("<body><p>Left as it is</p></body>").problems.join(), /prose with no data-i18n: "Left as it is"/);
  assert.match(scan("<body><h2>Downloads</h2></body>").problems.join(), /prose with no data-i18n/, "one word that isn't a name");
  assert.match(scan('<body><p data-i18n="p.a">One <span data-i18n="p.b">two</span></p></body>').problems.join(), /inside data-i18n="p\.a"/);
  assert.match(scan("<body><p>One</b></body>").problems.join(), /<\/b> closes <p>/);
  // Across pages: a key shared (the top bar's, the footer's) holds one English.
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "site-languages-"));
  fs.writeFileSync(path.join(dir, "a.html"), '<body><a data-i18n="site.back">← Contents</a></body>');
  fs.writeFileSync(path.join(dir, "b.html"), '<body><a data-i18n="site.back">← Contents</a></body>');
  assert.deepEqual(i18n.extract(dir).problems, []);
  fs.writeFileSync(path.join(dir, "b.html"), '<body><a data-i18n="site.back">← Back</a></body>');
  assert.match(i18n.extract(dir).problems.join(), /"site\.back" is also at a\.html:1 with other English/);
  assert.match(i18n.check({ dir }).join("\n"), /en\.json is not what the pages say/);
});

test("every page has the language selector first in its top bar, and loads i18n.js", () => {
  const nine = ["en 🇬🇧 English", "fr 🇫🇷 Français", "de 🇩🇪 Deutsch", "es 🇪🇸 Español", "it 🇮🇹 Italiano", "nl 🇳🇱 Nederlands", "sv 🇸🇪 Svenska", "da 🇩🇰 Dansk", "no 🇳🇴 Norsk"];
  assert.deepEqual(i18n.LANGS, nine.slice(1).map(s => s.slice(0, 2)));
  assert.ok(pages.length >= 19 && pages.includes("index.html"), pages.join());
  for (const f of pages) {
    const html = fs.readFileSync(path.join(DOCS, f), "utf8");
    const bar = html.match(/<header class="pagehead">\s*<div class="wrap">\s*(<[a-z]+[^>]*>)/);
    assert.ok(bar, f + ": a top bar");
    assert.match(bar[1], /^<select id="lang-select" class="lang-select"/, f + ": the selector first in the top bar");
    const options = [...html.matchAll(/<option value="([a-z]+)">([^<]+)<\/option>/g)].map(m => m[1] + " " + m[2]);
    assert.deepEqual(options, nine, f);
    assert.match(html, /<script src="i18n\.js"><\/script>\s*<\/body>/, f + ": i18n.js, last");
    assert.match(html, /<a href="https:\/\/buymeacoffee\.com\/musicd_projects"><img [^>]*alt="Buy Me a Coffee"/, f + ": Buy Me a Coffee");
  }
  assert.match(fs.readFileSync(path.join(DOCS, "i18n.js"), "utf8"), /"mandarin-lang"/);
});

test("the Features page is what tools/docs/features.py writes, each card marked", { skip: noPython }, () => {
  const r = spawnSync("python3", ["tools/docs/features.py", "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const html = fs.readFileSync(path.join(DOCS, "features.html"), "utf8");
  const cards = [...html.matchAll(/<div class="card[^"]*"><h3>/g)].length;
  assert.ok(cards > 50, "cards: " + cards);
  for (const part of ["title", "what", "how"]) {
    assert.equal([...html.matchAll(new RegExp(`data-i18n="features\\.[a-z0-9-]+\\.${part}"`, "g"))].length, cards, part);
  }
  assert.equal([...html.matchAll(/data-i18n-attr="aria-label:features\.[a-z0-9-]+\.info"/g)].length, cards, "each ⓘ's label");
  assert.doesNotMatch(html, /github\.com\/meltface-80\/Mandarin#/, "links to the site's pages, not to the README's sections");
});

test("the README is short and sends readers to the site", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.match(readme, /^# Mandarin — v\d+\.\d+\.\d+$/m);
  assert.match(readme, /\[!?[^\]]*\]\(https:\/\/meltface-80\.github\.io\/Mandarin\/\)/, "the site, linked");
  assert.match(readme, /<a href="https:\/\/buymeacoffee\.com\/musicd_projects"><img [^>]*alt="Buy Me a Coffee"/);
  assert.ok(readme.indexOf("buymeacoffee") < readme.indexOf("## "), "the button near the top");
  for (const h of ["## Downloads", "### Mandarin OS", "### Install on Linux", "## Updating", "## License"]) assert.ok(readme.includes(h + "\n"), h);
  assert.doesNotMatch(readme, /features:start/, "the feature list is the site's");
  assert.ok(readme.split("\n").length < 200, "short: " + readme.split("\n").length + " lines");
  for (const m of readme.matchAll(/\]\(#([a-z0-9-]+)\)/g)) {
    const slugs = [...readme.matchAll(/^#+ (.+)$/gm)].map(h => h[1].toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-"));
    assert.ok(slugs.includes(m[1]), "a link to a section the README has: #" + m[1]);
  }
});
