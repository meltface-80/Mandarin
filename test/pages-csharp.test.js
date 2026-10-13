"use strict";
/*
 * The pages, the deep links and /api/health, answered by the C# server
 * (v0.8.48, stage 5 part 7; server/Mandarin.Server/Pages.cs, HealthRoutes.cs),
 * held since v0.8.50 to what the Node server answered, on the program alone:
 *
 *   - /login (open) and /display, /display/: the files as they are, with a tag,
 *     a time and sendFile's caching; signed out, the wall display sent to sign in;
 *   - a deep link (any address the page opens: /library, an album's, a file
 *     that isn't there): the page, the Android app's form of it too, HEAD as GET;
 *   - a folder of public/ without its slash: sent there (301), as express.static;
 *   - /api/health; an /api/ address that isn't one, as Express said it; a
 *     renderer's event.
 *
 * On its own (v0.8.50) the deep links were 404 "Cannot GET" at first: the
 * not-found route claimed every address without a file extension before the
 * page could. It stands where the Node server's catch-all stood now.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");

const skip = built();

test("the pages, the deep links and /api/health: by the C# server, as the Node server answered them", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
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
    // Answered here, an HTML page; sendFile's caching, its tag and its time (express.static's for a folder's redirect).
    const page = async (p, init, what = p) => {
      const c = await ask(B, p, init);
      assert.equal(c.by, "C#", what + ": answered by C#");
      assert.equal(c.status, 200, what);
      assert.match(String(c.type), /^text\/html; charset=utf-8$/i, what + ": its type");
      assert.match(c.body, /<title>/, what);
      return c;
    };

    // The sign-in page, open, and the wall display's: the files, as sendFile sends them.
    for (const [p, init] of [["/login", {}], ["/login", { headers: H }], ["/display", { headers: H }], ["/display/", { headers: H }]]) {
      const c = await page(p, init);
      assert.ok(c.tag && c.modified, `${p}: a tag and a time`);
      assert.deepEqual([c.cache, c.ranges], ["public, max-age=0", "bytes"], p);
      assert.match(c.body, /<html/i);
    }
    const tag = (await ask(B, "/display", { headers: H })).tag;
    assert.equal((await ask(B, "/display", { headers: Object.assign({ "If-None-Match": tag }, H) })).status, 304, "a copy still current");
    // Signed out, the wall display is sent to sign in, and back.
    const out = await ask(B, "/display");
    assert.deepEqual([out.status, out.by, out.location], [302, "C#", "/login?next=%2Fdisplay"]);

    // Deep links: the page for any address it opens, as app.get("*") sent it, its form chosen by who asks.
    const index = (await ask(B, "/", { headers: H })).body;
    for (const p of ["/library", "/album/12?from=home", "/settings/audio-devices", "/no-such-file.html", "/icons/", "/stream", "/.hidden"]) {
      const c = await page(p, { headers: H });
      assert.equal(c.body, index, p + ": the page itself");
      assert.equal(c.vary, "User-Agent, Accept-Encoding", p + ": vary");
      assert.equal(c.cache, "public, max-age=0", p);
    }
    // The Android app's: its own form of the page, never kept stale.
    {
      const c = await page("/library", { headers: APP }, "the app's deep link");
      assert.deepEqual([c.cache, c.vary], ["no-cache", "User-Agent, Accept-Encoding"]);
      const viewport = b => (b.match(/<meta name="viewport" content="([^"]*)">/) || [])[1];
      assert.deepEqual([viewport(index), viewport(c.body)], ["width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover",
        "width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"], "the app's page leaves the room around it to the app");
      assert.notEqual(c.body, index);
    }
    // HEAD as GET, without the body.
    {
      const c = await ask(B, "/library", { method: "HEAD", headers: H });
      assert.deepEqual([c.status, c.by, c.body], [200, "C#", ""]);
      assert.match(String(c.type), /^text\/html/i);
    }
    // Signed out, a deep link is sent to sign in, and back to it.
    const deep = await ask(B, "/album/12?from=home");
    assert.deepEqual([deep.status, deep.by, deep.location], [302, "C#", "/login?next=%2Falbum%2F12%3Ffrom%3Dhome"]);
    // A folder of public/ without its slash: sent there, as express.static sends it.
    for (const [p, to] of [["/icons", "/icons/"], ["/fonts?a=1&b=<x>", "/fonts/?a=1&b=%3Cx%3E"]]) {
      const c = await ask(B, p, { headers: H });
      assert.deepEqual([c.status, c.by, c.location, c.csp, c.nosniff], [301, "C#", to, "default-src 'none'", "nosniff"], p);
      assert.match(c.body, /Redirecting to/);
    }

    // /api/health, open.
    const hc = await fetch(B + "/api/health");
    assert.equal(hc.headers.get("x-mandarin-answered"), "C#");
    const jc = await hc.json();
    assert.deepEqual([jc.ok, jc.version, jc.albums, jc.rooms, typeof jc.ffmpeg], [true, require("../package.json").version, 3, 0, "boolean"]);
    assert.deepEqual(Object.keys(jc.transcode_cache).sort(), ["bytes", "files", "queued", "running"]);
    assert.equal(jc.csharp, undefined, "no Node server to bring to its version");

    // An /api/ address that isn't one, as Express said it. A renderer's event is the hub's (v0.8.49).
    const none = await ask(B, "/api/no-such-thing", { headers: H });
    assert.deepEqual([none.status, none.by, JSON.parse(none.body)], [404, "C#", { error: "No such endpoint: GET /no-such-thing" }]);
    const ev = await ask(B, "/upnp/event/uuid:nobody", { method: "NOTIFY", headers: { "Content-Type": "text/xml", NT: "upnp:event", NTS: "upnp:propchange", SID: "uuid:x" }, body: "<e:propertyset xmlns:e=\"urn:schemas-upnp-org:event-1-0\"/>" });
    assert.deepEqual([ev.status, ev.by], [200, "C#"]);
  } finally { await srv.stop(); }
});
