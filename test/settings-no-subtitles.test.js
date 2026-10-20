"use strict";
/*
 * Settings' pages with nothing under their heading (bug list item 101, as the owner asked): no line saying what the page
 * holds, who is signed in or what a device is, on the page or in the Android app, and none in the screens contract.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

test("no Settings page has a line under its heading, on the page, in the app or in the contract", () => {
  const screens = JSON.parse(read("docs/specs/screens.json")).screens;
  const keyed = Object.entries(screens).filter(([k]) => k.startsWith("settings")).filter(([, v]) => v.items.desc || v.items.who).map(([k]) => k);
  assert.deepEqual(keyed, [], "the contract's Settings screens");
  const page = [read("public/index.html"), ...fs.readdirSync(path.join(ROOT, "public/app")).filter(f => f.endsWith(".js")).map(f => read("public/app/" + f))];
  assert.equal(page.filter(s => /settings-pane-desc|device-pane-desc|acct-who/.test(s)).length, 0, "the page");
  const app = fs.readdirSync(path.join(ROOT, "android/app/src/main/java/com/musicd/server/android")).filter(f => f.endsWith(".kt"))
    .filter(f => /SettingsDesc\(/.test(read("android/app/src/main/java/com/musicd/server/android/" + f)));
  assert.deepEqual(app, [], "the app");
});
