"use strict";
/*
 * The Offline dialog's words, the app's (android/core Offline.kt) held to the page's (server-notice.js OFFLINE_WHY and
 * openOffline's titles; bug list item 105), so the native dialog never says other than the page's.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const PAGE = read("public/app/server-notice.js");
const CORE = read("android/core/src/main/kotlin/com/musicd/server/client/Offline.kt");

// The strings of a JS array or a Kotlin listOf, in order.
const strings = text => [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]);
const block = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));

test("what the dialog says when Offline mode is on, and when the server can't be reached, are the page's", () => {
  assert.deepStrictEqual(strings(block(CORE, "private val MODE", "private val APP")), strings(block(PAGE, "mode: [", "app: [")));
  assert.deepStrictEqual(strings(block(CORE, "private val APP", "\n}")), strings(block(PAGE, "app: [", "unreachable: [")));
});

test("the headings are the page's", () => {
  const page = PAGE.match(/title\.textContent = offState\.kind === "mode" \? "([^"]+)" : "([^"]+)"/);
  assert.ok(page, "the page's titles found");
  const core = CORE.match(/fun title\(kind: OfflineKind\): String = if \(kind == OfflineKind\.MODE\) "([^"]+)" else "([^"]+)"/);
  assert.ok(core, "the app's titles found");
  assert.deepStrictEqual([core[1], core[2]], [page[1], page[2]]);
});
