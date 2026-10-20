"use strict";
/*
 * The app's name box and its playlist share sheet, each drawn by one composable (bug list item 104). The page has one
 * of each (#prompt-overlay; playlist-share.js's openShareSheet); the app had grown three name boxes (NamePrompt.kt,
 * SmartSheets.kt's own and PromptDialog.kt) and two share sheets (PlaylistShareSheet.kt and ShareTracksSheet.kt), each
 * drawn a little differently. Now a new playlist, a Dynamic Playlist's Save as… and an imported playlist's name are
 * asked in NamePrompt.kt, and a playlist's Share and a Dynamic Playlist's open PlaylistShareSheet.kt.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const APP = "android/app/src/main/java/com/musicd/server/android";
const sources = fs.readdirSync(path.join(ROOT, APP)).filter(f => f.endsWith(".kt"))
  .map(f => ({ f, text: fs.readFileSync(path.join(ROOT, APP, f), "utf8") }));
const screens = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/specs/screens.json"), "utf8"));
const all = screens.screens || screens;

const drawing = key => sources.filter(s => s.text.includes(`parity("${key}.`)).map(s => s.f).sort();

test("one name box: every prompt key is NamePrompt.kt's", () => {
  assert.deepStrictEqual(drawing("prompt"), ["NamePrompt.kt"]);
  assert.deepStrictEqual(all.prompt.native, [APP + "/NamePrompt.kt"]);
  const defs = sources.flatMap(s => (s.text.match(/fun (NamePrompt|PromptDialog)\(/g) || []).map(() => s.f));
  assert.deepStrictEqual(defs, ["NamePrompt.kt"]);
});

test("one share sheet: a playlist's and a Dynamic Playlist's Share both open PlaylistShareSheet.kt", () => {
  assert.deepStrictEqual(drawing("playlist-share"), ["PlaylistShareSheet.kt"]);
  assert.deepStrictEqual(drawing("share-tracks"), []);
  assert.strictEqual(all["share-tracks"], undefined);
  const smart = sources.find(s => s.f === "SmartSheets.kt").text;
  assert.match(smart, /PlaylistShareSheet\(s\.name, s\.file, s\.caveats\)/);
});
