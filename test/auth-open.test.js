"use strict";
/*
 * Mandarin without an account (bug list item 161): a TV showing the shelf or
 * the wall shouldn't need a username and a password typed. A new install can
 * be used without an account; an install with one keeps asking for a sign-in
 * until it is switched off in Settings → Account. With it off, the home
 * network and the tailnet are let in, each browser and app still a device of
 * its own; anywhere else still needs a sign-in.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { signIn } = require("./auth-helper");

const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;

async function startServer(dataDir) {
  const music = path.join(dataDir, "..", "music");
  fs.mkdirSync(music, { recursive: true });
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: music, dataDir, serverIp: "127.0.0.1", sonosHosts: [] });
  await srv.start();
  return srv;
}

// A request as if from an address (the server reads X-Forwarded-For from loopback, Server.cs Caller).
const HOME = "192.168.1.20", TAILNET = "100.101.102.103", INTERNET = "8.8.8.8";
function from(ip, extra = {}) { return Object.assign({ "X-Forwarded-For": ip }, extra); }
const get = (p, ip, extra) => fetch(B + p, { redirect: "manual", headers: from(ip, extra) });
const status = async (ip, extra) => (await get("/api/auth/status", ip, extra)).json();
async function postFrom(ip, p, body, extra) {
  const r = await fetch(B + p, { method: "POST", headers: from(ip, Object.assign({ "Content-Type": "application/json" }, extra)), body: JSON.stringify(body) });
  return Object.assign({ status: r.status, cookie: r.headers.get("set-cookie") }, await r.json().catch(() => ({})));
}
const BROWSER = { Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "User-Agent": "Mozilla/5.0 (X11; Linux) Chrome/130.0" };

test("a new install used without an account", { timeout: 60000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-open-"));
  const srv = await startServer(path.join(tmp, "data"));
  try {
    await t.test("from away, a new install can't be opened up", async () => {
      assert.equal((await postFrom(TAILNET, "/api/auth/open", { open: true })).status, 403);
      assert.equal((await postFrom(INTERNET, "/api/auth/open", { open: true })).status, 403);
      assert.equal((await status(HOME)).open, false);
    });

    let tv;
    await t.test("Use without an account, from the home network: the browser is in, a device of its own", async () => {
      const r = await postFrom(HOME, "/api/auth/open", { open: true }, BROWSER);
      assert.equal(r.status, 200);
      assert.equal(r.open, true);
      assert.ok(r.device && r.device.id, "the browser that chose it is made a device");
      assert.match(r.cookie, /musicd_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=31536000/);
      tv = r.cookie.split(";")[0];
      const st = await status(HOME, { Cookie: tv });
      assert.deepEqual([st.setup_required, st.open, st.open_here, st.signed_in], [true, true, true, true]);
      assert.equal((await get("/api/status", HOME, { Cookie: tv })).status, 200);
    });

    await t.test("another browser at home opens a page and is let in, given its own device there and then", async () => {
      const page = await get("/", HOME, BROWSER);
      assert.equal(page.status, 200);
      const cookie = page.headers.get("set-cookie");
      assert.match(cookie || "", /musicd_session=/);
      const list = await (await get("/api/auth/devices", HOME, { Cookie: cookie.split(";")[0] })).json();
      assert.equal(list.devices.length, 2);
      assert.equal(list.devices.filter(d => d.current).length, 1);
      // A script asking for the library, with no cookie: let in, no device made for it.
      assert.equal((await get("/api/status", HOME)).status, 200);
      assert.equal((await get("/api/auth/devices", HOME, { Cookie: tv }).then(r => r.json())).devices.length, 2);
    });

    await t.test("the app joins over the tailnet and gets a token", async () => {
      const j = await postFrom(TAILNET, "/api/auth/join", { want_token: true, kind: "android", device_name: "Living room TV" });
      assert.equal(j.status, 200);
      assert.ok(j.token);
      assert.equal(j.device.kind, "android");
      assert.equal(j.cookie, null, "the app is handed its token, no cookie");
      const st = await status(TAILNET, { Authorization: "Bearer " + j.token });
      assert.equal(st.signed_in, true);
      assert.equal(st.away, true, "over the tailnet is still away");
    });

    await t.test("from the internet, nothing: no page, no library, no joining", async () => {
      const page = await get("/", INTERNET, BROWSER);
      assert.equal(page.status, 302);
      assert.equal(page.headers.get("set-cookie"), null);
      assert.equal((await get("/api/status", INTERNET)).status, 401);
      assert.equal((await get("/api/image/al-1-0", INTERNET)).status, 401);
      assert.equal((await postFrom(INTERNET, "/api/auth/join", { want_token: true })).status, 403);
      assert.equal((await postFrom(INTERNET, "/api/auth/open", { open: true })).status, 403);
      assert.equal((await status(INTERNET)).open_here, false);
    });

    await t.test("a sign-in can't be asked for until there is an account", async () => {
      assert.equal((await postFrom(HOME, "/api/auth/open", { open: false }, { Cookie: tv })).status, 409);
    });

    await t.test("making the account asks for a sign-in again; the devices already in stay in", async () => {
      const token = await signIn(B);
      const st = await status(HOME);
      assert.deepEqual([st.open, st.setup_required], [false, false]);
      assert.equal((await get("/api/status", HOME)).status, 401);
      assert.equal((await get("/api/status", HOME, { Cookie: tv })).status, 200);
      assert.equal((await get("/api/status", INTERNET, { Authorization: "Bearer " + token })).status, 200);
    });
  } finally {
    await srv.stop();
  }
});

test("an install with an account: the sign-in stays on until it is switched off", { timeout: 60000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-open-acct-"));
  const srv = await startServer(path.join(tmp, "data"));
  try {
    const token = await signIn(B);
    const bearer = { Authorization: "Bearer " + token };

    await t.test("as it was: nothing without signing in, and the sign-in can't be switched off without it", async () => {
      assert.equal((await status(HOME)).open, false);
      assert.equal((await get("/api/status", HOME)).status, 401);
      assert.equal((await get("/", HOME, BROWSER)).status, 302);
      assert.equal((await postFrom(HOME, "/api/auth/open", { open: true })).status, 401);
      assert.equal((await postFrom(HOME, "/api/auth/join", { want_token: true })).status, 403);
    });

    await t.test("switched off by a signed-in device: home and tailnet in, the internet still signs in", async () => {
      const r = await postFrom(HOME, "/api/auth/open", { open: true }, bearer);
      assert.equal(r.status, 200);
      assert.equal(r.device, undefined, "a device already signed in isn't made again");
      assert.equal((await get("/api/status", HOME)).status, 200);
      assert.equal((await get("/api/status", TAILNET)).status, 200);
      assert.equal((await get("/api/status", INTERNET)).status, 401);
      const st = await status(HOME);
      assert.deepEqual([st.open, st.open_here, st.setup_required], [true, true, false]);
      // The account still signs in from anywhere.
      assert.equal((await get("/api/status", INTERNET, bearer)).status, 200);
    });

    await t.test("switched on again from a device that came in without a password", async () => {
      const j = await postFrom(HOME, "/api/auth/join", { want_token: true, kind: "android", device_name: "TV" });
      assert.ok(j.token);
      const r = await postFrom(HOME, "/api/auth/open", { open: false }, { Authorization: "Bearer " + j.token });
      assert.equal(r.status, 200);
      assert.equal((await get("/api/status", HOME)).status, 401);
      assert.equal((await status(HOME)).open, false);
    });
  } finally {
    await srv.stop();
  }
});

test("Tailscale's addresses, and the rest", { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-open-ips-"));
  const srv = await startServer(path.join(tmp, "data"));
  try {
    assert.equal((await postFrom(HOME, "/api/auth/open", { open: true })).status, 200);
    const tailnet = ["100.64.0.1", "100.127.255.254", "::ffff:100.100.1.2", "fd7a:115c:a1e0::1234", "FD7A:115C:A1E0:ab12::1"];
    const internet = ["100.63.255.255", "100.128.0.1", "101.64.0.1", "8.8.8.8", "2a00:1450::1", "100.64.0.1000"];
    for (const ip of tailnet) assert.equal((await get("/api/status", ip)).status, 200, ip);
    for (const ip of internet) assert.equal((await get("/api/status", ip)).status, 401, ip);
  } finally {
    await srv.stop();
  }
});
