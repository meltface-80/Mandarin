// @ts-check
"use strict";
/*
 * A switch on the Android app's Settings pages moves as it is tapped, the server's answer taking its place after,
 * and back where it was if the server refuses (bug list item 200). Before, each waited for the server's answer, so a
 * tap did nothing for a moment: Account's Ask for a sign-in, a device's page, a device's row in Audio (two round
 * trips), the Scanner's switches, Away from home's, DSP and Downloads. Each site is held to the shape here; what each
 * page shows meanwhile is core SwitchedTest's.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android", "app", "src", "main", "java", "com", "musicd", "server", "android");
const read = (name) => fs.readFileSync(path.join(APP, name), "utf8");

test("Ask for a sign-in moves as it is tapped, and back if refused", () => {
  const src = read("SettingsPanes.kt");
  assert.match(src, /val before = ask\s+ask = before\?\.withOpen\(want\)\s+busy = "ask"/);
  assert.match(src, /\.onFailure \{ ask = before; toast\(/);
});

test("a device's page shows a change at once, the server's answer taking its place; back if refused", () => {
  const src = read("SettingsDevice.kt");
  assert.match(src, /val before = page\s+page = before\?\.with\(body\)\s+val made = ServerWrites\.write \{ c\.patch\(devicePath\(id\), body\) \}/);
  assert.match(src, /onSuccess \{ page = DevicePage\(it\);[\s\S]*?\.onFailure \{ page = before; error = /);
});

test("a device's row in Audio moves as it is tapped, the list read again after; back if refused", () => {
  const src = read("SettingsAudio.kt");
  assert.match(src, /val before = list\s+list = before\?\.withEnabled\(r\.id, on\)\s+val made = ServerWrites\.write \{ c\.patch\(devicePath\(r\.id\), JSONObject\(\)\.put\("enabled", on\)\) \}/);
  assert.match(src, /\.onFailure \{ list = before; error = [\s\S]*?busy = false; load\(\)/);
});

test("the Scanner's switches and Measure ReplayGain move as they are tapped; back if refused", () => {
  const src = read("SettingsScanner.kt");
  assert.match(src, /val before = k\.st\s+if \(path == SCAN_SETTINGS\) k\.st = Scanner\.withSettings\(before, body\)/);
  assert.match(src, /\.onFailure \{ if \(path == SCAN_SETTINGS\) k\.st = before; k\.err = /);
  assert.match(src, /val before = loud\s+k\.loud = Scanner\.withMeasure\(before, !measuring\)/);
  assert.match(src, /\.onFailure \{ k\.loud = before; k\.err = /);
});

test("Built-in Tailscale moves as it is tapped; back if refused", () => {
  const src = read("SettingsShareAway.kt");
  assert.match(src, /val before = st\s+if \(what == "enable"\) st = before\?\.copy\(enabled = body\.optBoolean\("on"\)\)/);
  assert.match(src, /\.onFailure \{ st = before; err = /);
});

test("Downloads' switches and lists show the change at once, then read back from the bridge", () => {
  assert.match(read("SettingsDownloads.kt"), /fun set\(key: String, value: String\) \{ settings = settings\?\.with\(key, value\); bridge\.set\(key, value\); reads\+\+ \}/);
});

test("DSP's switch goes through the device page's patch, so it moves at once too", () => {
  assert.match(read("SettingsDsp.kt"), /fun save\(on: Boolean\) \{ onPatch\(JSONObject\(\)\.put\("dsp", draft\.setting\(on\)\)/);
});
