"use strict";
/*
 * A dictionary several threads use is never sorted or listed straight off (bug list item 486). On the owner's server an
 * album's cover wasn't drawn once: "[art] …: ArgumentNullException: Value cannot be null. (Parameter 'key'); not drawn",
 * and the app was answered 404 for it. Covers kept the last few pictures read in a ConcurrentDictionary and found the
 * oldest with OrderBy over the dictionary itself. LINQ sorts (and ToList lists) a copy it makes in two steps, how many
 * and then all of them; another thread taking an entry out in between leaves the copy one short, an empty entry with no
 * key at its end (adding one in between throws at once instead). Run on its own from six threads, that sort threw the
 * same ArgumentNullException 43 times in six million turns, and the dictionary's own ToArray, made whole under its
 * locks, never.
 *
 * It can't be made to happen on demand through the server, so the rule is kept here for every such dictionary: copy it
 * with its own ToArray (or read its Keys or Values, each a copy made whole) before anything that needs all of it at once.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SERVER = path.join(__dirname, "..", "server", "Mandarin.Server");

function sources(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "bin" || e.name === "obj") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (e.name.endsWith(".cs")) out.push(p);
  }
  return out;
}

// What makes its own copy of all of it first: the sorts, a list, the whole reversed.
const WHOLE = ["OrderBy", "OrderByDescending", "Order", "OrderDescending", "ToList", "Reverse"];

/** Each place in [files] ({name, text}) that sorts or lists one of the shared dictionaries declared in them, straight off. */
function straightOff(files) {
  const names = new Set();
  for (const f of files) for (const m of f.text.matchAll(/ConcurrentDictionary<[^;=]*?>\s+(\w+)\s*(?:=|;|\{)/g)) names.add(m[1]);
  if (!names.size) return { names, found: [] };
  const use = new RegExp("\\b(" + [...names].join("|") + ")\\s*\\.\\s*(" + WHOLE.join("|") + ")\\s*[(<]");
  const found = [];
  for (const f of files) f.text.split("\n").forEach((line, i) => { const m = use.exec(line); if (m) found.push(`${f.name}:${i + 1}: ${m[1]}.${m[2]}`); });
  return { names, found };
}

test("no shared dictionary is sorted or listed straight off", () => {
  const files = sources(SERVER).map(p => ({ name: path.relative(SERVER, p), text: fs.readFileSync(p, "utf8") }));
  const { names, found } = straightOff(files);
  assert.ok(names.size >= 20 && names.has("Sources"), "the server's shared dictionaries were found (" + names.size + ")");
  assert.deepStrictEqual(found, [], "copy it whole first (its own ToArray()), then sort or list the copy");
});

test("the covers' pictures kept are trimmed from a copy made whole", () => {
  const src = fs.readFileSync(path.join(SERVER, "Covers.Sources.cs"), "utf8");
  assert.match(src, /if \(Sources\.Count > SourcesMost\)\s+\{\s+var all = Sources\.ToArray\(\);\s+foreach \(var \(k, _\) in all\.OrderBy\(x => x\.Value\.At\)\.Take\(all\.Length - SourcesMost\)\) if \(k != key\) Sources\.TryRemove\(k, out _\);/);
});

test("the rule finds what it is for, and leaves a copy alone", () => {
  const decl = "private static readonly ConcurrentDictionary<string, (long At, int N)> Kept = new();\n";
  const bad = straightOff([{ name: "a.cs", text: decl + "foreach (var (k, _) in Kept.OrderBy(x => x.Value.At).Take(2)) Kept.TryRemove(k, out _);\nvar l = Kept.ToList();\n" }]);
  assert.deepStrictEqual(bad.found, ["a.cs:2: Kept.OrderBy", "a.cs:3: Kept.ToList"]);
  // Declared in one file of a class and used in another.
  assert.deepStrictEqual(straightOff([{ name: "a.cs", text: decl }, { name: "b.cs", text: "var o = Kept.OrderByDescending(x => x.Key);" }]).found, ["b.cs:1: Kept.OrderByDescending"]);
  const good = straightOff([{ name: "a.cs", text: decl + "var all = Kept.ToArray();\nforeach (var (k, _) in all.OrderBy(x => x.Value.At)) Kept.TryRemove(k, out _);\nvar n = Kept.Values.ToList(); var c = Kept.Count(x => x.Value.N > 0);\nforeach (var k in Kept.Keys.OrderBy(k => k)) { }\n" }]);
  assert.deepStrictEqual(good.found, []);
});
