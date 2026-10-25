"use strict";
/*
 * At home, the app's connections go over the Wi-Fi (bug list item 127). On 22 October at 06:48 the Wi-Fi was still up
 * (the waits already open on it went on answering) but Android judged it poor and sent new connections over mobile
 * data, which can't reach the server's home address: every new request failed for half a minute, and an album's page
 * showed "failed to connect to /192.168.0.57 (port 3500) from /192.0.0.4 (port 37086) after 5000ms", with no way to
 * ask again. Which way, and what a screen says, are core's (Route.overWifi, Failure), with their own test.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const read = f => fs.readFileSync(path.join(APP, f), "utf8");

test("the way decided, the app's connections are tied to the Wi-Fi at home and let go away", () => {
  const away = read("Away.kt");
  assert.match(away, /val away = way\.away\s+HomeWifi\.follow\(c, Route\.overWifi\(away, wifi\)\)/);
  // Asked over the Wi-Fi, up to three times before home is left (item 157: homeAnswers), each look over that network.
  // ...and as this phone's own server (item 158: Store.serverId, the id its sign-in was taken by).
  assert.match(away, /homeAnswers\(home, Route\.looksBeforeAway\(wasAway, wifi\), if \(wifi\) HomeWifi\.network\(c\) else null, Store\.serverId\(c\)\)/, "the home address asked over the Wi-Fi");
  assert.match(away, /private fun homeAnswers\(home: ServerAddress, looks: Int, over: Network\?, kept: String\?\): Boolean \{[\s\S]*?answers\(home, 1500, over, kept\)/);
  assert.match(away, /HomeWifi\.watch\(app\) \{ recheck\(app, soon = true\) \}/, "the Wi-Fi itself followed");
  const wifi = read("HomeWifi.kt");
  assert.match(wifi, /cm\.bindProcessToNetwork\(want\)/);
  assert.match(wifi, /override fun onLost\(network: Network\) \{\s+(\/\/[^\n]*\s+)?if \(network == bound\) follow\(c, false\)/, "the Wi-Fi gone, let go at once");
});

test("an album that couldn't be read says so in words, and asks again while the server can't be reached", () => {
  const album = read("AlbumScreen.kt");
  // Not reached, or the server's own trouble, asked again (item 157): at once when it answers again, else in a while (AskAgain).
  assert.match(album, /\.onFailure \{ failed = Failure\.said\(it, "Couldn't load the album"\) \+ if \(Failure\.worthAgain\(it\)\) "\. Trying again…" else "" \}/);
  assert.match(album, /again = album == null && got\.exceptionOrNull\(\)\?\.let\(Failure::worthAgain\) == true/);
  assert.match(album, /AskAgain\(again\) \{ loads\+\+ \}/);
});
