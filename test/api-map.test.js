"use strict";
/*
 * api-map.test.js — docs/specs/api.md (v0.9.4, the audit's D2,
 * tools/api-map.js): each way the server writes a route is read, and every
 * GET the map lists is a route the server answers, not its "No such
 * endpoint". `npm run gates` checks the map is current with the sources.
 */
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg } = require("./fixtures");
const { built } = require("./server");
const { started } = require("./helpers");
const { routesIn, render } = require("../tools/api-map");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");

test("each way a route is written is read: its method, its address, its line", () => {
  const cs = [
    "private static readonly Dictionary<string, Handler> Gets = new()",
    "{",
    "    [\"/api/one\"] = One,",
    "};",
    "private static readonly HashSet<string> Posts = [\"/api/two\", \"/api/three\"];",
    "app.MapMethods(\"/api/four\", Http.GetOrHead, (HttpContext ctx) => Four(ctx));",
    "app.MapPost(\"/api/five\", async (HttpContext ctx) => await Five(ctx));",
    "case \"POST\" when p == \"/api/six\": return await Six(ctx);",
    "return get && p == \"/api/seven\" ? await Seven(ctx) : post && p is \"/api/eight\" or \"/api/nine\" && await Eight(ctx);",
    "[GeneratedRegex(@\"^/api/(a|b)/ten$\")]",
    "if (!p.StartsWith(\"/api/eleven/\", StringComparison.Ordinal)) return false;",
    "private static bool IsOpen(string p) => p.StartsWith(\"/api/auth/\", StringComparison.Ordinal);",
    "if (p == \"/api\" || p.StartsWith(\"/api/\")) return;"
  ].join("\n");
  const got = routesIn(path.join(__dirname, "..", "server", "Mandarin.Server", "X.cs"), cs).map(r => [r.method, r.path, r.line]);
  assert.deepEqual(got, [
    ["GET", "/api/one", 3], ["POST", "/api/two", 5], ["POST", "/api/three", 5], ["GET", "/api/four", 6], ["POST", "/api/five", 7],
    ["POST", "/api/six", 8], ["GET", "/api/seven", 9], ["POST", "/api/eight", 9], ["POST", "/api/nine", 9],
    ["", "/api/(a|b)/ten", 10], ["", "/api/eleven/…", 11]
  ]);
});

test("the map in the repository is the one the sources make", () => {
  assert.equal(fs.readFileSync(path.join(__dirname, "..", "docs", "specs", "api.md"), "utf8"), render(), "run `node tools/api-map.js write`");
});

test("every GET the map lists is answered by its route, not by \"No such endpoint\"", { skip, timeout: 180000 }, async (t) => {
  const { base, H } = await started(t);
  const map = fs.readFileSync(path.join(__dirname, "..", "docs", "specs", "api.md"), "utf8");
  // An address in full (no pattern, no "…"), not the server's private ones.
  const gets = [...map.matchAll(/^\| GET \| `([^`]+)` \|/gm)].map(m => m[1]).filter(p => !/[(…\\]/.test(p) && !p.startsWith("/internal/"));
  assert.ok(gets.length > 80, gets.length + " GET routes");
  const missing = [];
  for (const p of gets) {
    let r;
    // A route that waits (a long poll) is a route too.
    try { r = await fetch(base + p, { headers: H, redirect: "manual", signal: AbortSignal.timeout(5000) }); } catch (e) { continue; }
    const text = await r.text();
    if (r.status === 404 && /No such endpoint|<pre>Cannot GET/.test(text)) missing.push(p);
  }
  assert.deepEqual(missing, [], "listed, but not there");
});
