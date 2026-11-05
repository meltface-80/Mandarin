"use strict";
/*
 * The favourite heart is a heart (item 296): its two halves the mirror of each other about the middle of its 24-unit
 * box, meeting at one point at the foot. Its right half sat one unit to the left, so the heart was off the middle and
 * its two sides crossed above the point, which a filled heart shows as a stub. The same path is the page's
 * (public/app/home-picks.js, HEART_SVG) and the Android app's, hollow and filled (np_heart.xml, np_heart_on.xml).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

// The points along an SVG path of M, C, S and Z (absolute or relative), every cubic sampled.
function points(d) {
  const tokens = d.match(/[MCSZmcsz]|-?(?:\d+\.?\d*|\.\d+)/g);
  const out = [];
  let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, lc = null;
  const num = () => Number(tokens[i++]);
  const cubic = (x1, y1, x2, y2, ex, ey) => {
    for (let k = 1; k <= 40; k++) {
      const t = k / 40, u = 1 - t;
      out.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey]);
    }
    lc = [x2, y2]; x = ex; y = ey;
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M": x = num() + ox; y = num() + oy; sx = x; sy = y; out.push([x, y]); lc = null; break;
      case "C": { const a = [num() + ox, num() + oy, num() + ox, num() + oy, num() + ox, num() + oy]; cubic(...a); break; }
      case "S": {
        const r = lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y];
        const a = [num() + ox, num() + oy, num() + ox, num() + oy]; cubic(r[0], r[1], ...a); break;
      }
      case "Z":
        for (let k = 1; k <= 20; k++) out.push([x + (sx - x) * k / 20, y + (sy - y) * k / 20]);
        x = sx; y = sy; lc = null; break;
      default: throw new Error("not drawn here: " + cmd);
    }
  }
  return out;
}

function assertHeart(d, where) {
  const pts = points(d);
  const near = (px, py) => Math.min(...pts.map(([qx, qy]) => Math.hypot(px - qx, py - qy)));
  // Every point has its mirror about x = 12 on the outline too.
  const worst = Math.max(...pts.map(([px, py]) => near(24 - px, py)));
  assert.ok(worst < 0.2, `${where}: its halves are the mirror of each other about the middle (out by ${worst.toFixed(2)})`);
  // One point at the foot, in the middle.
  const foot = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
  assert.ok(Math.abs(foot[0] - 12) < 0.05, `${where}: its point at the foot is in the middle (x ${foot[0].toFixed(2)})`);
  const minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0]));
  assert.ok(Math.abs((minX + maxX) / 2 - 12) < 0.05, `${where}: it sits in the middle of its box (${minX.toFixed(2)} to ${maxX.toFixed(2)})`);
}

test("the favourite heart is a heart: both halves the mirror of each other, one point at the foot", () => {
  const page = /const HEART_SVG\s*=[^;]*?\bd="([^"]+)"/s.exec(read("public/app/home-picks.js"));
  assert.ok(page, "the page's heart");
  assertHeart(page[1], "the page's heart");
  for (const f of ["np_heart.xml", "np_heart_on.xml"]) {
    const m = /android:pathData="([^"]+)"/.exec(read("android/app/src/main/res/drawable/" + f));
    assert.ok(m, f);
    assertHeart(m[1], f);
  }
});
