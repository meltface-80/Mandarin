"use strict";
/*
 * Mandarin without an account, made safe (bug list item 172; the sign-in off
 * is item 161, test/auth-open.test.js). With the sign-in off, a request from
 * the home network or the tailnet is let in on its address alone; that much
 * is the point, but not:
 *
 *   - a web page in a home browser posting to the server across sites, or
 *     reaching it under its own name (DNS rebinding): what is let in without
 *     a device must be asked for under a name used at home, and anything
 *     that changes something from the server's own page or an app;
 *   - a device made without a password used from the internet;
 *   - a browser that keeps no cookies made a device on every page load;
 *   - a proxy on the same machine that says where a request came from without
 *     X-Forwarded-For making the internet look like home.
 *
 * (A database restore keeping today's choice is in test/backup.test.js.)
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { signIn } = require("./auth-helper");
const { built } = require("./server");

const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;
const HERE = "127.0.0.1:" + PORT;
const skip = built();

async function startServer(dataDir) {
  const music = path.join(dataDir, "..", "music");
  fs.mkdirSync(music, { recursive: true });
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: music, dataDir, serverIp: "127.0.0.1", sonosHosts: [] });
  await srv.start();
  return srv;
}

const HOME = "192.168.1.20", TAILNET = "100.101.102.103", INTERNET = "8.8.8.8";
const BROWSER = { Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "User-Agent": "Mozilla/5.0 (X11; Linux) Chrome/130.0" };

/* A request with exactly these headers (Host and Origin included, which fetch won't let a test set). */
function ask(method, p, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const h = Object.assign({ Host: HERE }, headers);
    if (body != null) h["Content-Length"] = Buffer.byteLength(body);
    const req = http.request({ host: "127.0.0.1", port: PORT, method, path: p, headers: h, agent: false }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (d) => { text += d; });
      res.on("end", () => {
        let json = {};
        try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
        const set = res.headers["set-cookie"];
        resolve({ status: res.statusCode, cookie: set ? set[0].split(";")[0] : null, location: res.headers.location || null, json });
      });
    });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}
const from = (ip, extra) => Object.assign({ "X-Forwarded-For": ip }, extra);
// What a page on another site can send without asking first: a form's or fetch's text/plain POST.
const crossSite = (ip, extra) => from(ip, Object.assign({ "Content-Type": "text/plain", Origin: "http://evil.example", "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors" }, extra));
const json = (ip, extra) => from(ip, Object.assign({ "Content-Type": "application/json" }, extra));

async function devices(cookieOrBearer) {
  const h = cookieOrBearer.startsWith("musicd_session=") ? { Cookie: cookieOrBearer } : { Authorization: "Bearer " + cookieOrBearer };
  return (await ask("GET", "/api/auth/devices", from(HOME, h))).json.devices;
}

test("the sign-in off: what another site or another name can't do", { skip, timeout: 60000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-open-hard-"));
  const srv = await startServer(path.join(tmp, "data"));
  try {
    const token = await signIn(B);
    const bearer = { Authorization: "Bearer " + token };
    assert.equal((await ask("POST", "/api/auth/open", json(HOME, bearer), JSON.stringify({ open: true }))).status, 200);

    await t.test("a page on another site posts to the server from a home browser: refused, nothing changed", async () => {
      // An empty body asks for the sign-in back: a stranger's page mustn't.
      const r = await ask("POST", "/api/auth/open", crossSite(HOME), "open=false");
      assert.equal(r.status, 403);
      assert.equal(r.json.error.length > 0, true);
      assert.equal((await ask("GET", "/api/auth/status", from(HOME))).json.open, true, "still open");
      // Nor made a device of its own, nor anything behind the gate.
      assert.equal((await ask("POST", "/api/auth/join", crossSite(HOME), "")).status, 403);
      assert.equal((await ask("POST", "/api/smart-playlists/delete", crossSite(TAILNET), "{}")).status, 403);
      assert.equal((await ask("POST", "/api/smart-playlists/delete", crossSite(HOME, { "Sec-Fetch-Site": "same-site" }), "{}")).status, 403);
      // An older browser that says nothing of where the page was, but names its origin.
      const old = from(HOME, { "Content-Type": "text/plain", Origin: "http://evil.example" });
      assert.equal((await ask("POST", "/api/smart-playlists/delete", old, "{}")).status, 403);
      assert.equal((await ask("POST", "/api/smart-playlists/delete", from(HOME, { Origin: "null" }), "{}")).status, 403);
    });

    await t.test("the server's own page, an address typed in, and the app: let in as before", async () => {
      const page = { "Sec-Fetch-Site": "same-origin", Origin: "http://" + HERE };
      for (const h of [json(HOME, page), json(HOME, { "Sec-Fetch-Site": "none" }), json(TAILNET), json(HOME, { Origin: "http://" + HERE })]) {
        const r = await ask("POST", "/api/smart-playlists/delete", h, JSON.stringify({ id: "none" }));
        assert.ok(r.status !== 401 && r.status !== 403, JSON.stringify(h) + " → " + r.status);
      }
      // The Android app joins with no Origin and no Sec-Fetch-Site.
      const j = await ask("POST", "/api/auth/join", json(TAILNET, { "User-Agent": "okhttp/4.12.0" }), JSON.stringify({ want_token: true, kind: "android" }));
      assert.equal(j.status, 200);
      assert.ok(j.json.token);
      // A signed-in device is let in whatever it is asked under: its cookie is never another site's.
      assert.equal((await ask("GET", "/api/status", from(INTERNET, Object.assign({ Host: "music.example.com" }, bearer)))).status, 200);
    });

    await t.test("asked for under another site's name (DNS rebinding): refused", async () => {
      const evil = { Host: "evil.example" };
      assert.equal((await ask("GET", "/api/status", from(HOME, evil))).status, 403);
      assert.equal((await ask("GET", "/api/auth/status", from(HOME, evil))).json.open_here, false);
      const j = await ask("POST", "/api/auth/join", json(HOME, { Host: "evil.example:" + PORT, Origin: "http://evil.example:" + PORT, "Sec-Fetch-Site": "same-origin" }), JSON.stringify({ want_token: true }));
      assert.equal(j.status, 403);
      assert.equal(j.json.token, undefined);
      const p = await ask("GET", "/", from(HOME, Object.assign({}, BROWSER, evil)));
      assert.equal(p.status, 302);
      assert.equal(p.cookie, null, "no device made");
      assert.equal((await ask("GET", "/api/image/al-1-0", from(HOME, evil))).status, 403);
    });

    await t.test("the names a home uses: an address, localhost, a bare name, .local, .lan, .home.arpa, the tailnet's", async () => {
      const names = ["127.0.0.1", HERE, "192.168.1.5:3500", "[fd7a:115c:a1e0::1]:3500", "[::1]", "localhost:3500", "mandarin", "nas:3500",
        "mandarin.local", "Mandarin.LOCAL.", "music.lan:3500", "box.home.arpa", "mandarin.tail1234.ts.net", "mandarin.tail1234.ts.net:443"];
      for (const Host of names) assert.equal((await ask("GET", "/api/status", from(HOME, { Host }))).status, 200, Host);
      for (const Host of ["evil.example", "music.example.com", "ts.net.evil.example", "local.evil.example", "1.2.3.4.nip.io"])
        assert.equal((await ask("GET", "/api/status", from(HOME, { Host }))).status, 403, Host);
    });
  } finally {
    await srv.stop();
  }
});

test("a device made without a password works at home and over the tailnet, not from the internet", { skip, timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-open-joined-"));
  const srv = await startServer(path.join(tmp, "data"));
  try {
    assert.equal((await ask("POST", "/api/auth/open", json(HOME), JSON.stringify({ open: true }))).status, 200);
    const j = await ask("POST", "/api/auth/join", json(HOME), JSON.stringify({ want_token: true, kind: "android" }));
    const app = { Authorization: "Bearer " + j.json.token };
    assert.equal((await ask("GET", "/api/status", from(HOME, app))).status, 200);
    assert.equal((await ask("GET", "/api/status", from(TAILNET, app))).status, 200);
    assert.equal((await ask("GET", "/api/status", from(INTERNET, app))).status, 401);
    assert.equal((await ask("GET", "/api/auth/status", from(INTERNET, app))).json.signed_in, false);
    const page = await ask("GET", "/", from(HOME, BROWSER));
    assert.ok(page.cookie);
    assert.equal((await ask("GET", "/", from(INTERNET, Object.assign({ Cookie: page.cookie }, BROWSER)))).status, 302);
    // A device made by signing in is good everywhere.
    const token = await signIn(B);
    assert.equal((await ask("GET", "/api/status", from(INTERNET, { Authorization: "Bearer " + token }))).status, 200);
    // And the device made without a password stays good at home with the sign-in back on.
    assert.equal((await ask("GET", "/api/status", from(HOME, app))).status, 200);
    assert.equal((await ask("GET", "/api/status", from(INTERNET, app))).status, 401);
  } finally {
    await srv.stop();
  }
});

test("an install without an account, from before devices were marked: every device taken as made without a password", { skip, timeout: 60000 }, async () => {
  const Database = require("better-sqlite3");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-open-upgrade-"));
  const data = path.join(tmp, "data");
  let srv = await startServer(data);
  let j;
  try {
    assert.equal((await ask("POST", "/api/auth/open", json(HOME), JSON.stringify({ open: true }))).status, 200);
    j = await ask("POST", "/api/auth/join", json(HOME), JSON.stringify({ want_token: true, kind: "android" }));
  } finally {
    await srv.stop();
  }
  // As v1.1.8 left it: no devices.joined.
  const raw = new Database(path.join(data, "musicd.db"));
  raw.exec("ALTER TABLE devices DROP COLUMN joined");
  raw.close();
  srv = await startServer(data);
  try {
    const app = { Authorization: "Bearer " + j.json.token };
    assert.equal((await ask("GET", "/api/status", from(HOME, app))).status, 200);
    assert.equal((await ask("GET", "/api/status", from(INTERNET, app))).status, 401);
  } finally {
    await srv.stop();
  }
});

test("a browser that keeps no cookies is one device, not one a page load", { skip, timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-open-once-"));
  const srv = await startServer(path.join(tmp, "data"));
  try {
    const first = await ask("POST", "/api/auth/open", json(HOME, BROWSER), JSON.stringify({ open: true }));
    const mine = first.cookie;
    // The TV's first visit: its cookie there and then.
    const tv = { "User-Agent": "Mozilla/5.0 (Linux; Android 12; BRAVIA 4K) Chrome/120.0", Accept: BROWSER.Accept };
    const a = await ask("GET", "/", from("192.168.1.30", Object.assign({ "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" }, tv)));
    assert.equal(a.status, 200);
    assert.ok(a.cookie, "the TV is given its cookie");
    assert.equal((await devices(mine)).length, 2);
    // It forgot it: the same device again, not another.
    for (let i = 0; i < 3; i++) {
      const again = await ask("GET", "/shelf", from("192.168.1.30", tv));
      assert.equal(again.status, 200);
      assert.equal(again.cookie, a.cookie, "the same device's cookie");
    }
    assert.equal((await devices(mine)).length, 2);
    // A page's own request for HTML (not a page opened): let in, no device.
    const sub = await ask("GET", "/", from("192.168.1.31", Object.assign({ "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty" }, BROWSER)));
    assert.equal(sub.status, 200);
    assert.equal(sub.cookie, null);
    assert.equal((await ask("GET", "/", from("192.168.1.31", Object.assign({ "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image" }, BROWSER)))).cookie, null);
    // Another browser at the same address, and the same browser elsewhere: devices of their own.
    const other = await ask("GET", "/", from("192.168.1.30", BROWSER));
    assert.ok(other.cookie && other.cookie !== a.cookie);
    const elsewhere = await ask("GET", "/", from("192.168.1.32", tv));
    assert.ok(elsewhere.cookie && elsewhere.cookie !== a.cookie);
    assert.equal((await devices(mine)).length, 4);
    // Signed out, the device is gone: a new one next time, not its dead cookie handed back.
    const tvDev = (await devices(a.cookie)).find(d => d.current);
    await ask("POST", "/api/auth/devices/revoke", json(HOME, { Cookie: mine }), JSON.stringify({ id: tvDev.id }));
    const back = await ask("GET", "/", from("192.168.1.30", tv));
    assert.ok(back.cookie && back.cookie !== a.cookie);
    assert.equal((await ask("GET", "/api/auth/status", from("192.168.1.30", { Cookie: back.cookie }))).json.signed_in, true);
  } finally {
    await srv.stop();
  }
});

test("a proxy on this machine that says who asked without X-Forwarded-For: believed, never taken as home", { skip, timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-open-proxy-"));
  const srv = await startServer(path.join(tmp, "data"));
  try {
    // No account yet: only a device at home may make one.
    const away = [{ "X-Real-IP": INTERNET }, { Forwarded: "for=8.8.8.8;proto=https" }, { Forwarded: 'for="[2a00:1450::1]:4711"' },
      { Forwarded: "for=192.168.1.9, for=8.8.4.4" }, { "X-Forwarded-Host": "music.example.com", "X-Forwarded-Proto": "https" }];
    for (const h of away) assert.equal((await ask("GET", "/api/auth/status", h)).json.can_setup, false, JSON.stringify(h));
    assert.equal((await ask("GET", "/api/auth/status", { "X-Real-IP": HOME })).json.can_setup, true);
    assert.equal((await ask("GET", "/api/auth/status", {})).json.can_setup, true, "this machine itself, no proxy");
    // Used without an account: the internet behind the proxy is not let in.
    assert.equal((await ask("POST", "/api/auth/open", json(HOME), JSON.stringify({ open: true }))).status, 200);
    for (const h of away) assert.equal((await ask("GET", "/api/status", h)).status, 401, JSON.stringify(h));
    assert.equal((await ask("GET", "/api/status", { "X-Real-IP": HOME })).status, 200);
    assert.equal((await ask("GET", "/api/status", { Forwarded: "for=" + TAILNET })).status, 200);
    // X-Forwarded-For, as the built-in Tailscale sends it with X-Forwarded-Host, is believed as before.
    assert.equal((await ask("GET", "/api/status", from(TAILNET, { "X-Forwarded-Host": "mandarin.tail1234.ts.net", Host: "mandarin.tail1234.ts.net" }))).status, 200);
  } finally {
    await srv.stop();
  }
});
