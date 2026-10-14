"use strict";
/*
 * The page-names gate's verdict (tools/quality/page-names.js, v1.0.5): the
 * page's script is parts joined into one, so what a part declares at its top
 * is every part's. The verdict, free of parsing, on made-up pages: a name
 * declared twice, a browser's own name taken, a name read nowhere, a name
 * read that nothing declares. The gate itself runs over the real page in
 * `npm run gates` (it needs tools/lint's parser).
 */
const test = require("node:test");
const assert = require("node:assert");
const { judge } = require("../tools/quality/page-names");

const browser = new Set(["window", "close", "open", "fetch"]);
const decl = (name, where, read = true, kind = "const") => ({ name, where, read, kind });

test("a page whose names are each declared once, read, and nobody's else passes", () => {
  const page = { declared: [decl("openShare", "app/share-card.js:3"), decl("bar", "app/mini-transport.js:1", true, "let")], through: [{ name: "fetch", where: "app/x.js:1" }, { name: "ShareCardLib", where: "app/x.js:2" }] };
  assert.deepEqual(judge(page, { declared: [{ name: "ShareCardLib", where: "sharecard.js:1" }] }, browser), []);
});

test("a name declared in two parts, or in a part and another of the page's scripts, fails", () => {
  const f = judge({ declared: [decl("load", "app/a.js:1"), decl("load", "app/b.js:9", true, "FunctionName")], through: [] }, { declared: [] }, browser);
  assert.equal(f.length, 1);
  assert.match(f[0], /^load: declared 2 times .*app\/a\.js:1, app\/b\.js:9/);
  const g = judge({ declared: [decl("ShareCard", "app/a.js:1")], through: [] }, { declared: [{ name: "ShareCard", where: "sharecard.js:4" }] }, browser);
  assert.match(g[0], /ShareCard: declared 2 times/);
});

test("a part taking the browser's own name fails: a top-level close is window.close", () => {
  const f = judge({ declared: [decl("close", "app/share-card.js:20", true, "FunctionName")], through: [] }, { declared: [] }, browser);
  assert.deepEqual(f, ["app/share-card.js:20: close is the browser's own name (window.close); name it for what it is"]);
});

test("a name read nowhere fails, and so does a name read that nothing declares", () => {
  const f = judge({ declared: [decl("orphan", "app/a.js:5", false)], through: [{ name: "lostName", where: "app/b.js:7" }] }, { declared: [] }, browser);
  assert.deepEqual(f, [
    "app/a.js:5: orphan is read nowhere on the page",
    "app/b.js:7: lostName is declared in no part of the page, and isn't the browser's"
  ]);
});
