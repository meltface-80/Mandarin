"use strict";
/*
 * Away over MusicD's own Tailscale, the app's requests go to 127.0.0.1:34500 only while its own engine forwards that
 * port (item 226). On 30 Oct another app's Tailscale held it (Rouen's, from the code it came from) and the phone's
 * player said hello to Rouen's server, refused forty times over seven minutes. Every request the app makes goes through
 * Store.client's guard (Away.notBeforeVpn), which asks core's Route.notYet (RouteTest.kt); this reads the app's source,
 * as the other android-*.test.js do.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const read = f => fs.readFileSync(path.join(APP, f), "utf8");

test("every request waits for the app's own engine to forward its port, away over it", () => {
  const away = read("Away.kt");
  const guard = away.slice(away.indexOf("fun notBeforeVpn("), away.indexOf("private fun onVpn("));
  assert.match(guard, /Route\.notYet\(away, engine, engine && TailscaleEngine\.forwarding\(\)/);
  assert.match(guard, /throw java\.io\.IOException\(it\)/);
  assert.match(read("TailscaleEngine.kt"), /fun forwarding\(\) = alive\(\) && readyFor != null/);
  // The guard is the one every client asks before each request.
  assert.match(read("Store.kt"), /\{ Away\.awaitWay\(app\); Away\.notBeforeVpn\(app\) \}/);
});
