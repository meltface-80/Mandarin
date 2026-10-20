"use strict";
/*
 * The app's vector drawables, held to the path syntax every icon that has always drawn uses (bug list item 79): an
 * arc's seven numbers each set apart by a comma or a space, its two flags above all. The native Settings' icons were
 * the page's SVG paths copied as they were, flags run into the next number ("a2 2 0 0 1-2.83 0"), and the app froze
 * opening Settings.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "android/app/src/main/res/drawable");

/* What is wrong with one path: an arc whose seven numbers are not each set apart (a flag run into what follows it). */
function problems(d) {
  const out = [];
  for (const seg of d.match(/[Aa][^A-Za-z]*/g) || []) {
    const nums = seg.slice(1).split(/[\s,]+/).filter(Boolean);
    if (nums.length % 7 !== 0 || nums.some(n => !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(n))) out.push(seg.trim() + ": an arc's numbers not each set apart");
  }
  return out;
}

test("every vector drawable's paths are written out plainly", () => {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith(".xml"));
  const wrong = [];
  for (const f of files) {
    const xml = fs.readFileSync(path.join(DIR, f), "utf8");
    for (const m of xml.matchAll(/pathData="([^"]*)"/g)) for (const p of problems(m[1])) wrong.push(f + ": " + p);
  }
  assert.ok(files.length > 20, "the drawables read");
  assert.deepEqual(wrong, []);
});
