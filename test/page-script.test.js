"use strict";
/*
 * The page's script made from its parts (v1.0.5, docs/specs/page-modules.md):
 * /app.js is the parts public/app/parts.txt names, in its order, each headed
 * by its name and parted by a lone ";" (server/Mandarin.Server/
 * Pages.Script.cs), and the Android app's own copy is joined the same way
 * (android/app/build.gradle.kts). Held here:
 *   - the server sends exactly that join, and says it has it still;
 *   - every part named is there, once, a plain file of the page;
 *   - every script in public/app/ is named: one left out would never run;
 *   - each part compiles alone, and so does the join;
 *   - the app's join is the server's (its separator, its heading, its list).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { started } = require("./helpers");
const { built } = require("./server");

const ROOT = path.join(__dirname, "..");
const PUB = path.join(ROOT, "public");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

/** The parts, as the server reads the list. */
function parts() {
  return read("public/app/parts.txt").split("\n").map(l => l.trim())
    .filter(l => l && !l.startsWith("#") && l.endsWith(".js") && !l.startsWith("/") && !l.includes("\\") && l.split("/").every(s => s && s !== "." && s !== ".."));
}
const join = (list) => list.map(p => "// " + p + "\n" + fs.readFileSync(path.join(PUB, p), "utf8")).join("\n;\n");

test("every part named is there once, and every script in public/app/ is named", () => {
  const list = parts();
  assert.ok(list.length > 0, "the list names the parts");
  assert.equal(new Set(list).size, list.length, "no part twice: " + list.join(", "));
  for (const p of list) {
    assert.ok(fs.statSync(path.join(PUB, p)).isFile(), p + " is there");
    assert.notEqual(fs.readFileSync(path.join(PUB, p))[0], 0xEF, p + " has no byte-order mark (the app's join would keep it)");
  }
  const scripts = fs.readdirSync(path.join(PUB, "app")).filter(f => f.endsWith(".js")).map(f => "app/" + f);
  for (const s of scripts) assert.ok(list.includes(s), s + " is named in public/app/parts.txt, or it never runs");
});

// One script, as the browser reads it: a part cut mid-statement, or two parts declaring
// one name (let, const, class), stops the whole page before any of it runs.
test("the parts joined are one script that compiles, as each part alone does", () => {
  const list = parts();
  for (const p of list) assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(PUB, p), "utf8"), { filename: p }), p + " compiles alone");
  assert.doesNotThrow(() => new vm.Script(join(list), { filename: "app.js" }), "the join compiles");
});

test("the Android app's copy is joined as the server joins it", () => {
  const cs = read("server/Mandarin.Server/Pages.Script.cs");
  const gradle = read("android/app/build.gradle.kts");
  assert.match(cs, /PartsJoin = "\\n;\\n";/);
  assert.match(cs, /PartsList = "app\/parts\.txt";/);
  assert.match(cs, /"\/\/ " \+ p \+ "\\n" \+/, "each part headed by its name");
  assert.match(gradle, /joinToString\("\\n;\\n"\) \{ "\/\/ \$it\\n" \+ File\(pageDir, it\)\.readText\(\) \}/, "the same join in build.gradle.kts");
  assert.match(gradle, /File\(pageDir, "app\/parts\.txt"\)/, "from the same list");
});

test("/app.js is the parts joined, kept while they stand", { skip: built(), timeout: 120000 }, async (t) => {
  const { base, H } = await started(t);
  const r = await fetch(base + "/app.js", { headers: H });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /^text\/javascript; charset=utf-8$/);
  assert.equal(r.headers.get("cache-control"), "no-cache", "asked after each time, so an update is seen at once");
  assert.equal(await r.text(), join(parts()), "exactly the parts, joined");
  const again = await fetch(base + "/app.js", { headers: Object.assign({ "If-None-Match": r.headers.get("etag") }, H) });
  assert.equal(again.status, 304, "a copy still current: not modified");
  assert.equal((await fetch(base + "/app.js")).status, 401, "behind the gate, as every file of the page");
});
