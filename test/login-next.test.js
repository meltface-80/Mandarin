"use strict";
/*
 * Where the sign-in page goes once signed in (item 174; public/login.js's
 * nextUrl): the ?next= it was sent with, only ever a path on this server.
 * "/\evil.com" began with one slash and so passed, but a browser reads a
 * backslash as a slash, and a tab or a newline inside an address not at all:
 * "//evil.com", another site, straight after the password. The page is run
 * here as it is, already signed in, and where it goes is read off
 * location.replace.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "public", "login.js"), "utf8");
const ORIGIN = "http://192.168.1.20:3500";

/** The page opened at /login?next=<next>, already signed in: where it sends the browser. */
async function wentTo(next) {
  const el = () => ({ classList: { toggle() {} }, addEventListener() {}, focus() {}, querySelector: () => ({}) });
  const at = new URL(ORIGIN + "/login?next=" + encodeURIComponent(next));
  /** @type {string|null} */
  let to = null;
  const location = { href: at.href, origin: at.origin, protocol: at.protocol, host: at.host, pathname: at.pathname, search: at.search,
    replace: (/** @type {string} */ u) => { to = u; } };
  const fetch = async () => ({ json: async () => ({ signed_in: true }) });
  vm.runInNewContext(SRC, { document: { getElementById: el }, location, fetch, URL, URLSearchParams, setTimeout, MusicdSrp: {} });
  for (let i = 0; i < 100 && to === null; i++) await new Promise(r => setImmediate(r));
  return to;
}

test("a path on this server is gone to as it was asked for", async () => {
  for (const next of ["/", "/album/12?from=home", "/shelf", "/library#top", "/display"])
    assert.equal(await wentTo(next), next, next);
});

test("anywhere else, the sign-in page itself, or something that isn't an address: the home page", async () => {
  for (const next of ["/\\evil.com", "/\\/evil.com", "\\\\evil.com", "\\/evil.com", "/\t/evil.com", "/\n/evil.com", "/\r/evil.com",
    "//evil.com", "///evil.com", "https://evil.com/", "http:evil.com", "javascript:alert(1)", " //evil.com", "/login", "/login.html",
    "/login?next=//evil.com", "album/12", "http://[::1"]) {
    const to = await wentTo(next);
    assert.ok(to !== null, JSON.stringify(next) + ": went nowhere");
    // As the browser reads where it is sent, from this page.
    const u = new URL(/** @type {string} */ (to), ORIGIN + "/login");
    assert.equal(u.origin, ORIGIN, JSON.stringify(next) + " → " + to + ": another site");
    assert.equal(to, "/", JSON.stringify(next) + " → " + to);
  }
});
