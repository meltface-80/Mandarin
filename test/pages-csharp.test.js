"use strict";
/*
 * The Node server's own pages, the deep links and /api/health, answered by the
 * C# server (v0.8.48, stage 5 part 7; server/Mandarin.Server/Pages.cs,
 * HealthRoutes.cs), each held to what the Node server answers for the same
 * request, asked of it directly:
 *
 *   - /login (open) and /display, /display/: the files as they are, with the
 *     same tag, time and caching; signed out, the wall display sent to sign in;
 *   - a deep link (any address the page opens: /library, an album's, a file
 *     that isn't there): the page, the Android app's form of it too, HEAD as GET;
 *   - a folder of public/ without its slash: sent there (301), as express.static;
 *   - /api/health, field for field;
 *   - what stays the Node server's: an /api/ address it doesn't know, a
 *     renderer's event.
 *
 * Through the C# server only (MANDARIN_FRONT=1): both ways, the pages' own
 * tests (test/ui-*.test.js, test/browser.test.js) open them.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");

const skip = process.env.MANDARIN_FRONT !== "1" && "the C# server's: MANDARIN_FRONT=1";

test("the pages, the deep links and /api/health: by the C# server, as the Node server answers them", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = require("../index.js").createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1",
    sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  try {
    const NODE = "http://127.0.0.1:" + ctx.listeningOn;
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    const APP = Object.assign({ "User-Agent": "Mozilla/5.0 (Linux; Android 15; wv) MusicDAndroid/0.8.48" }, H);
    for (let i = 0; i < 150; i++) { if ((await (await fetch(B + "/api/status", { headers: H })).json()).index_count >= 3) break; await new Promise(r => setTimeout(r, 100)); }

    const ask = async (base, p, init = {}) => {
      const r = await fetch(base + p, Object.assign({ redirect: "manual" }, init));
      const h = k => r.headers.get(k);
      return { status: r.status, by: h("x-mandarin-answered") || "Node", type: h("content-type"), tag: h("etag"), modified: h("last-modified"),
        cache: h("cache-control"), vary: h("vary"), location: h("location"), ranges: h("accept-ranges"), csp: h("content-security-policy"),
        nosniff: h("x-content-type-options"), body: await r.text() };
    };
    // The same request of both: the C# server's answer is its own, and as the Node server's.
    const same = async (p, init, what = p) => {
      const c = await ask(B, p, init), n = await ask(NODE, p, init);
      assert.equal(c.by, "C#", what + ": answered by C#");
      for (const k of ["status", "body", "location", "csp", "nosniff"]) assert.deepEqual(c[k], n[k], `${what}: ${k}`);
      assert.equal(String(c.type).toLowerCase(), String(n.type).toLowerCase(), what + ": its type");
      return [c, n];
    };

    // The sign-in page, open, and the wall display's: the files, as sendFile sends them.
    for (const [p, init] of [["/login", {}], ["/login", { headers: H }], ["/display", { headers: H }], ["/display/", { headers: H }]]) {
      const [c, n] = await same(p, init);
      assert.equal(c.status, 200);
      for (const k of ["tag", "modified", "cache", "ranges"]) assert.equal(c[k], n[k], `${p}: ${k} | C#: ${c[k]} | Node: ${n[k]}`);
      assert.match(c.body, /<html/i);
    }
    const tag = (await ask(B, "/display", { headers: H })).tag;
    assert.equal((await ask(B, "/display", { headers: Object.assign({ "If-None-Match": tag }, H) })).status, 304, "a copy still current");
    // Signed out, the wall display is sent to sign in, and back.
    const out = await ask(B, "/display");
    assert.deepEqual([out.status, out.by, out.location], [302, "C#", "/login?next=%2Fdisplay"]);

    // Deep links: the page for any address it opens, as app.get("*") sent it.
    for (const p of ["/library", "/album/12?from=home", "/settings/audio-devices", "/no-such-file.html", "/icons/", "/stream", "/.hidden"]) {
      const [c, n] = await same(p, { headers: H });
      assert.equal(c.status, 200, p);
      assert.equal(c.vary, n.vary, p + ": vary");
      assert.match(c.body, /<title>/, p);
    }
    // The Android app's: its own form of the page, never kept stale.
    {
      const [c, n] = await same("/library", { headers: APP }, "the app's deep link");
      assert.deepEqual([c.cache, c.vary], [n.cache, n.vary]);
      assert.equal(c.cache, "no-cache");
    }
    // HEAD as GET, without the body.
    {
      const c = await ask(B, "/library", { method: "HEAD", headers: H }), n = await ask(NODE, "/library", { method: "HEAD", headers: H });
      assert.deepEqual([c.status, c.by, c.body], [200, "C#", ""]);
      assert.equal(String(c.type).toLowerCase(), String(n.type).toLowerCase());
    }
    // Signed out, a deep link is sent to sign in, and back to it.
    const deep = await ask(B, "/album/12?from=home");
    assert.deepEqual([deep.status, deep.by, deep.location], [302, "C#", "/login?next=%2Falbum%2F12%3Ffrom%3Dhome"]);
    // A folder of public/ without its slash: sent there, as express.static sends it.
    for (const p of ["/icons", "/fonts?a=1&b=<x>"]) {
      const [c] = await same(p, { headers: H });
      assert.equal(c.status, 301, p);
    }

    // /api/health, open: field for field.
    const hc = await fetch(B + "/api/health"), hn = await fetch(NODE + "/api/health");
    assert.equal(hc.headers.get("x-mandarin-answered"), "C#");
    const jc = await hc.json(), jn = await hn.json();
    assert.deepEqual(jc, jn);
    assert.deepEqual([jc.ok, jc.version, jc.albums], [true, require("../package.json").version, 3]);

    // Still the Node server's: an /api/ address it doesn't know. A renderer's event is the hub's (v0.8.49), as the Node server answered it.
    const none = await ask(B, "/api/no-such-thing", { headers: H });
    assert.deepEqual([none.status, none.by, JSON.parse(none.body)], [404, "Node", { error: "No such endpoint: GET /no-such-thing" }]);
    const ev = await ask(B, "/upnp/event/uuid:nobody", { method: "NOTIFY", headers: { "Content-Type": "text/xml", NT: "upnp:event", NTS: "upnp:propchange", SID: "uuid:x" }, body: "<e:propertyset xmlns:e=\"urn:schemas-upnp-org:event-1-0\"/>" });
    assert.deepEqual([ev.status, ev.by], [200, "C#"]);
  } finally { await srv.stop(); }
});
