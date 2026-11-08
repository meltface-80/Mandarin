"use strict";
/*
 * A signed-in browser's changes only from Mandarin's own page (item 363, the security audit's fifth finding). The
 * browser's cookie is SameSite=Lax, which another site's page never carries; but a page on another port of the same
 * host is the same site, and a form there could post with it: a change that needs no body (Rescan library) would run.
 * Now a change sent with the cookie must say it comes from the server's own page (Sec-Fetch-Site same-origin, or an
 * Origin of the server's own where a browser sends no Sec-Fetch-Site); a read is never asked, and the Android app's
 * Bearer token, which is no browser's, is let be. Mandarin's own page, in a browser, still changes what it changes.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

test("a change sent with the browser's cookie: only from the server's own page", { timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  const cookie = { Cookie: "musicd_session=" + encodeURIComponent(token) };
  const post = async (headers) => (await fetch(B + "/api/library/rescan", { method: "POST", headers: Object.assign({}, cookie, headers) })).status;

  // From another site, or another port of this host: a browser says so, or names where it comes from.
  assert.equal(await post({ "Sec-Fetch-Site": "same-site" }), 403, "a page on another port of this host: turned away");
  assert.equal(await post({ "Sec-Fetch-Site": "cross-site" }), 403);
  assert.equal(await post({ Origin: "http://127.0.0.1:8080" }), 403, "no Sec-Fetch-Site, another origin: turned away");
  // From the server's own page, or as a browser that says nothing (curl, an old browser): let in.
  assert.notEqual(await post({ "Sec-Fetch-Site": "same-origin" }), 403, "the server's own page");
  assert.notEqual(await post({ Origin: B }), 403, "its own origin");
  assert.notEqual(await post({}), 403, "nothing said: not a browser's form");
  // A read, from anywhere: never asked.
  assert.equal((await fetch(B + "/api/status", { headers: Object.assign({ "Sec-Fetch-Site": "cross-site" }, cookie) })).status, 200);
  // The app's Bearer token is no browser's: let be, whatever it carries.
  assert.notEqual((await fetch(B + "/api/library/rescan", { method: "POST", headers: { Authorization: "Bearer " + token, "Sec-Fetch-Site": "cross-site" } })).status, 403);

  // Mandarin's own page, in a browser, with its cookie: its changes still go through.
  if (!findBrowser()) return;
  const b = await Browser.launch({ width: 1200, height: 800 });
  try {
    const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
    const status = await page.eval(`(async () => (await fetch("/api/library/rescan", { method: "POST" })).status)()`);
    assert.notEqual(status, 403, "the page's own body-less POST: " + status);
    assert.deepEqual(page.errors, []);
  } finally { await b.close(); }
});
