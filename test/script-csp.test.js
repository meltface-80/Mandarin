"use strict";
/*
 * The pages run only the server's own script files (item 366, the security audit's thirteenth finding): each sends
 * Content-Security-Policy script-src 'self' (no plugins, no other base for its addresses), so a title or a tag that ever
 * slipped past the page's escaping as markup couldn't run as script. The one inline script there was (the sign-in page's
 * light/dark choice) is a file of its own. Each page, opened in a browser, loads with nothing refused, and an inline
 * script put in it doesn't run.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = !findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)";
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
// Recorded before any of the page's own script runs: whatever the policy refuses as the page loads.
const INIT = `window.__refused = []; document.addEventListener("securitypolicyviolation", e => window.__refused.push(e.violatedDirective + " " + (e.blockedURI || e.sourceFile || "")));`;

test("every page: script only from the server's own files, nothing of its own refused", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(() => srv.stop());

  // The sign-in page, before there is an account: its policy, and its light/dark choice read from a file of its own.
  const login = await fetch(B + "/login");
  assert.match(login.headers.get("content-security-policy") || "", /script-src 'self'/);
  assert.match(login.headers.get("content-security-policy") || "", /object-src 'none'/);
  assert.match(login.headers.get("content-security-policy") || "", /frame-ancestors 'self'/, "still never framed by another site");
  assert.doesNotMatch(await login.text(), /<script>(?!<\/script>)/, "no inline script left");
  const theme = await fetch(B + "/login-theme.js");
  assert.equal(theme.status, 200, "its script served before any sign-in");

  const token = await signIn(B);
  const cookies = [{ name: "musicd_session", value: token, url: B }];
  const b = await Browser.launch({ width: 1200, height: 800 });
  try {
    // The sign-in page as one not signed in sees it (signed in, it goes on to the page).
    for (const p of ["/login", "/", "/shelf", "/display"]) {
      const page = await b.page(B + p, { cookies: p === "/login" ? [] : cookies, init: INIT });
      await page.eval(`new Promise(r => setTimeout(r, 1500))`);
      const r = await page.eval(`(async () => {
        // An inline script put in the page: refused, never run (the policy's report comes a moment after).
        const s = document.createElement("script"); s.textContent = "window.__ran = true"; document.head.appendChild(s);
        await new Promise(res => setTimeout(res, 300));
        return { refused: window.__refused, ran: !!window.__ran };
      })()`);
      assert.equal(r.ran, false, p + ": an inline script doesn't run");
      assert.ok(r.refused.some(x => /^script-src/.test(x)), p + ": and is refused by the policy: " + JSON.stringify(r.refused));
      assert.deepEqual(r.refused.filter(x => !/inline/.test(x)), [], p + ": nothing of the page's own refused");
      assert.equal(r.refused.filter(x => /inline/.test(x)).length, 1, p + ": only the one put in");
      assert.deepEqual(page.errors, [], p + ": no errors");
    }
  } finally { await b.close(); }
});
