"use strict";
/*
 * The server's notice, worked out by the app (android/core ServerNotices.kt, bug list item 112) as the page's
 * server-notice.js works it out: every fixed phrase the page says (in its notice and its folder-gone paragraphs and
 * questions) is said word for word by the app, so the two never drift apart.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const PAGE = read("public/app/server-notice.js");
const APP = read("android/core/src/main/kotlin/com/musicd/server/client/ServerNotices.kt");

// The page's words: its string literals in sayMissing and checkNow (the notices), long enough to be prose.
const slice = (from, to) => PAGE.slice(PAGE.indexOf(from), PAGE.indexOf(to, PAGE.indexOf(from)));
const prose = text => [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]).filter(s => s.length >= 20 && /\s/.test(s) && !/^[a-z-]+( [a-z-]+)*$/.test(s));   // prose, not a class list

test("the app says each of the page's notice phrases", () => {
  const phrases = [...prose(slice("function sayMissing", "  // Offline:")), ...prose(slice("async function checkNow", "  check();"))];
  assert.ok(phrases.length >= 20, "the page's phrases found: " + phrases.length);
  const missing = phrases.filter(p => !APP.includes(p.trim()));
  assert.deepStrictEqual(missing, []);
});
