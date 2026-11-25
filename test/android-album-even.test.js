"use strict";
/*
 * The app's album page, even (item 539; the page's half in album-heart-row.test.js, the + or heart's rule in core's
 * AlbumHeartTest): the heart (or a streamed album's +) first on the row, then Play Now, Queue and ⋯; the title and the
 * artists centred; a tablet held sideways the phone's centred head in its left column.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const read = f => fs.readFileSync(path.join(DIR, f), "utf8");

test("the row: the heart or +, Play Now, Queue, ⋯", () => {
  const s = read("AlbumScreen.kt");
  const at = k => s.indexOf(k, s.indexOf("fun LazyListScope.actionItem"));
  const order = ["AlbumHeartButton(", '"album.play-now"', '"album.queue"', "MoreMenu("].map(at);
  assert.ok(order.every(i => i > 0), "each on the row: " + order);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in that order");
  assert.match(s, /onAdd = \{ setService\(a, true\) \}/, "the + adds the album to the service's favourites");
});

test("the title and the artists centred; a tablet's head the phone's", () => {
  const phone = read("AlbumPhone.kt"), screen = read("AlbumScreen.kt");
  assert.match(phone, /Modifier\.parity\("album\.title"\)\.fillMaxWidth\(\)[^\n]*\n[^\n]*textAlign = TextAlign\.Center/);
  assert.match(phone, /else Row\(Modifier\.fillMaxWidth\(\)\.padding\(top = 6\.dp\), horizontalArrangement = Arrangement\.Center\)/);
  assert.match(screen, /fun LazyListScope\.sleeveItems[\s\S]{0,400}PhoneHead\(/, "the tablet's left column: the centred head");
});
