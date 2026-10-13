"use strict";
/*
 * security.test.js — the audit's security hardening (v0.9.0,
 * docs/specs/audit-b4-main.md, module 3), each finding held here:
 *
 *  - S2: every page that acts may be framed only by its own origin
 *    (frame-ancestors 'self', X-Frame-Options), its type taken as named
 *    (nosniff) and no referrer sent elsewhere; the wall display, which only
 *    shows, may be framed.
 *  - S5: a cover from an address typed into the album editor is never fetched
 *    from this machine or its link (loopback, link-local, 0.0.0.0), on any
 *    redirect hop, by its name or what DNS answers; LAN addresses are. The
 *    tests' own world is loopback, so the route is held to the rest of it and
 *    the rules (server/Mandarin.Server/Addresses.cs) are asked directly.
 *  - S6: a LinkPlay player's self-signed certificate is taken from a private
 *    network's address, and only there.
 * S1, a backup sealed with a passphrase: test/backup-sealed.test.js and
 * test/backup-page.test.js.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawnSync } = require("child_process");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");
const { scoreAsync } = require("./score");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");

async function until(fn, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise(r => setTimeout(r, 100));
  }
}

async function started() {
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  const token = await signIn(B);
  return { lib, B, ctx, srv, token, H: { Authorization: "Bearer " + token } };
}

/* A web server on loopback: `routes` by path, else 404. Its address. */
async function serve(t, routes) {
  const web = http.createServer((req, res) => {
    const f = routes[new URL(req.url, "http://x").pathname];
    if (f) f(req, res); else { res.writeHead(404); res.end(); }
  });
  await new Promise(r => web.listen(0, "127.0.0.1", r));
  t.after(() => { web.closeAllConnections(); web.close(); });
  return web.address().port;
}

const answer = async (r) => [r.status, await r.json().catch(() => null)];

test("S2: the page's files carry their guards; the wall display may be framed", { skip, timeout: 60000 }, async (t) => {
  const { B, H, srv } = await started();
  t.after(() => srv.stop());
  const APP = Object.assign({ "User-Agent": "Mozilla/5.0 (Linux; Android 15; wv) MusicDAndroid/0.9.0" }, H);
  const guards = async (p, headers) => {
    const r = await fetch(B + p, { headers, redirect: "manual" });
    await r.arrayBuffer();
    const h = k => r.headers.get(k);
    return [r.status, h("content-security-policy"), h("x-frame-options"), h("x-content-type-options"), h("referrer-policy")];
  };
  const framedHere = [200, "frame-ancestors 'self'", "SAMEORIGIN", "nosniff", "same-origin"];
  // The page and the pages that act: at their routes, as files, as a deep link, and the app's own form.
  for (const [p, h] of [["/", H], ["/index.html", H], ["/library", H], ["/album/12", H], ["/library", APP], ["/login", {}], ["/login.html", {}], ["/shelf", H], ["/shelf.html", H]])
    assert.deepEqual(await guards(p, h), framedHere, p + (h === APP ? " (the app's)" : ""));
  // The wall display: shown, never acted on, so it may be framed.
  for (const p of ["/display", "/display.html"])
    assert.deepEqual(await guards(p, H), [200, null, null, "nosniff", "same-origin"], p);
  // The page's script and style: their type as named.
  for (const p of ["/app.js", "/style.css"])
    assert.deepEqual((await guards(p, H)).slice(3), ["nosniff", "same-origin"], p);
});

test("S5: the album editor never fetches a cover from this machine's link or 0.0.0.0, on any hop", { skip, timeout: 120000 }, async (t) => {
  const { lib, B, H, srv } = await started();
  t.after(() => srv.stop());
  const J = Object.assign({ "Content-Type": "application/json" }, H);
  await until(async () => { const s = await (await fetch(B + "/api/status", { headers: H })).json(); return s.index_count > 0 && !s.scan?.running; });
  const albums = (await (await fetch(B + "/api/library/albums?sort=album", { headers: H })).json()).albums;
  const one = albums.find(a => a.title === "Album One");
  const cover = fs.readFileSync(path.join(lib.music, "Artist A", "Album One", "cover.jpg"));
  const to = where => (req, res) => { res.writeHead(302, { Location: where }); res.end(); };
  const port = await serve(t, {
    "/cover.jpg": (req, res) => { res.writeHead(200, { "Content-Type": "image/jpeg" }); res.end(cover); },
    "/to-metadata": to("http://169.254.169.254/latest/meta-data/"),
    "/to-zero": (req, res) => to(`http://0.0.0.0:${port}/cover.jpg`)(req, res),
    "/to-link6": to("http://[fe80::1]/cover.jpg")
  });
  const W = "http://127.0.0.1:" + port;
  const edit = async (art_url) => answer(await fetch(B + "/api/album/edit", { method: "POST", headers: J, body: JSON.stringify({ offset: one.offset, art_url }) }));
  const refused = host => [502, { error: `Couldn't download that image (${host} is this server's own address or its link's)` }];

  // Named outright: a cloud's metadata service, IPv6's link, IPv4's inside IPv6, and 0.0.0.0, which reaches this machine.
  assert.deepEqual(await edit("http://169.254.169.254/latest/meta-data/"), refused("169.254.169.254"));
  assert.deepEqual(await edit("http://[fe80::1]/cover.jpg"), refused("[fe80::1]"));
  assert.deepEqual(await edit("http://[::ffff:169.254.169.254]/"), refused("[::ffff:169.254.169.254]"));
  assert.deepEqual(await edit(`http://0.0.0.0:${port}/cover.jpg`), refused("0.0.0.0"));
  // Reached by a redirect from an address that is taken.
  assert.deepEqual(await edit(W + "/to-metadata"), refused("169.254.169.254"));
  assert.deepEqual(await edit(W + "/to-zero"), refused("0.0.0.0"));
  assert.deepEqual(await edit(W + "/to-link6"), refused("[fe80::1]"));
  // The tests' own loopback is taken (production refuses it: the rules below), and the cover is kept.
  const [status, body] = await edit(W + "/cover.jpg");
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.art.found, true);
});

test("S5, S6: the rules of where the server may go, asked directly", { skip: built(), timeout: 60000 }, async (t) => {
  const ips = ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1", "0.0.0.0", "0.1.2.3", "::", "169.254.169.254", "169.254.1.1", "fe80::1",
    "10.0.0.5", "172.15.0.1", "172.16.0.1", "172.31.255.255", "172.32.0.1", "192.168.1.20", "::ffff:192.168.1.1", "100.64.0.1",
    "fc00::1", "fd00::5", "8.8.8.8", "2001:db8::1"];
  const port = await serve(t, { "/cover.jpg": (req, res) => { res.writeHead(200); res.end("x"); } });
  const W = "127.0.0.1:" + port;
  const o = await scoreAsync({
    fn: "addresses", ips,
    hosts: ["localhost", "192.168.1.20", "[fd00::5]", "8.8.8.8", "[2001:db8::1]", ""],
    art: [["http://localhost:9/a.jpg", false], ["http://localhost:9/a.jpg", true], ["http://127.0.0.1/a.jpg", false], ["http://127.0.0.1/a.jpg", true],
      ["http://[::1]/a.jpg", false], ["http://169.254.169.254/", true], ["http://192.168.1.20/a.jpg", false], ["http://[fd00::5]/a.jpg", false], ["http://8.8.8.8/a.jpg", false]],
    connect: [
      { url: `http://${W}/cover.jpg`, loopbackTaken: false },
      { url: `http://localhost:${port}/cover.jpg`, loopbackTaken: false },
      { url: `http://${W}/cover.jpg`, loopbackTaken: true },
      // Through a proxy (here, on loopback): the proxy reached, the address left to it.
      { url: "http://covers.example/cover.jpg", loopbackTaken: false, proxy: "http://" + W }
    ]
  });
  const by = list => Object.fromEntries(ips.map((ip, i) => [ip, list[i]]));
  const inward = ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1", "0.0.0.0", "0.1.2.3", "::", "169.254.169.254", "169.254.1.1", "fe80::1"];
  assert.deepEqual(by(o.inward), Object.fromEntries(ips.map(ip => [ip, inward.includes(ip)])), "this machine or its link");
  const priv = ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1", "169.254.169.254", "169.254.1.1", "fe80::1",
    "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.20", "::ffff:192.168.1.1", "fc00::1", "fd00::5"];
  assert.deepEqual(by(o.private), Object.fromEntries(ips.map(ip => [ip, priv.includes(ip)])), "a private network's");
  assert.deepEqual(o.hosts, [true, true, true, false, false, false], "a host's addresses all private");
  const no = host => `${host} is this server's own address or its link's`;
  assert.deepEqual(o.art, [no("localhost"), null, no("127.0.0.1"), null, no("[::1]"), no("169.254.169.254"), null, null, null], "a cover's address");
  assert.deepEqual(o.connect, [no("127.0.0.1"), no("localhost"), 200, 200], "a cover's connection");
});

test("S6: a LinkPlay player's own certificate taken from a private address", { skip: built() || (spawnSync("openssl", ["version"]).status !== 0 && "openssl is not installed"), timeout: 60000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mandarin-wiim-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const key = path.join(dir, "key.pem"), cert = path.join(dir, "cert.pem");
  // Signed by itself, as a WiiM's is.
  const made = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "2", "-subj", "/CN=WiiM"]);
  assert.equal(made.status, 0, String(made.stderr));
  const wiim = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ uuid: "FF31F09E-0000-0000-0000-000000000001", DeviceName: "Kitchen WiiM", project: "WiiM_Pro" }));
  });
  await new Promise(r => wiim.listen(0, "127.0.0.1", r));
  t.after(() => { wiim.closeAllConnections(); wiim.close(); });
  const o = await scoreAsync({ fn: "addresses", linkplay: ["https://127.0.0.1:" + wiim.address().port] });
  assert.equal(o.linkplay[0]?.DeviceName, "Kitchen WiiM", JSON.stringify(o.linkplay));
});
