"use strict";
/*
 * Mandarin's server in C# (v0.8.1 on, server/): which server answers what.
 * Runs when the suite goes through the C# server (MANDARIN_FRONT=1, as CI
 * does on Node 22). Each part moved to C# is pinned here, so a part can't
 * quietly fall back to the Node server behind it.
 *   - v0.8.1: everything is passed on, through C#;
 *   - v0.8.2: sign-in, devices and the gate are answered by C#; a streamer's
 *     NOTIFY still reaches the Node server unsigned; /internal/ stops at the door;
 *   - v0.8.3: the page and its files (public/) are served by C#;
 *   - v0.8.4: the library's screens are read by C# (test/library-front.test.js
 *     checks they say what the Node server says);
 *   - v0.8.5: covers already drawn, and label logos, are sent by C# (the same test);
 *   - v0.8.6: Home's rows are read by C# (the same test);
 *   - v0.8.7: settings only kept and read, and dynamic playlists, by C# (the same test);
 *   - v0.8.8: your own playlists, made and changed by C# (the same test);
 *   - v0.8.9: music files sent as they are, by C# (the same test);
 *   - v0.8.10: conversions already made, sent by C# from the cache (the same test);
 *   - v0.8.11: conversions made by C#, as the Node server made them (the same test);
 *   - v0.8.12: the phone's downloads and its Opus away, made and sent by C# (the same test);
 *   - v0.8.13: tags read by C# as the scanner reads them (test/tags-front.test.js), and the
 *     processor's split kept to by C# (test/cpu.test.js);
 *   - v0.8.14: the scan's tags read by C#, the library the same (test/tags-front.test.js,
 *     test/tag-reader-switch.test.js);
 *   - v0.8.15: nothing new answered by C# (the tag check keeps its results across updates);
 *   - v0.8.16: hearts, Listen later, label merges and the label settings made by C#, the Node
 *     server told (test/library-front.test.js);
 *   - v0.8.17: nothing new answered by C# (the Library Scanner page drawn at once).
 */
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");

const skip = process.env.MANDARIN_FRONT !== "1" && "the suite isn't going through the C# server (MANDARIN_FRONT=1)";

test("which server answers: sign-in, the gate, the page and the library in C#", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const PORT = 3695, B = "http://127.0.0.1:" + PORT;
  const srv = require("../index.js").createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1",
    sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  try {
    const by = async (p, init) => { const r = await fetch(B + p, init); return { status: r.status, by: r.headers.get("x-mandarin-answered") || "Node", via: r.headers.get("x-mandarin-server") || "", r }; };
    const info = await (await fetch(B + "/server-info")).json();
    assert.equal(info.server, "C#");
    assert.equal(info.version, require("../package.json").version);

    let x = await by("/api/auth/status");
    assert.deepEqual([x.status, x.by], [200, "C#"], "the sign-in state");
    assert.equal((await x.r.json()).setup_required, true);
    assert.match(x.via, /^C# /, "every response comes through C#");
    x = await by("/api/library/albums");
    assert.deepEqual([x.status, x.by], [401, "C#"], "the gate, before an account");
    assert.equal((await x.r.json()).setup_required, true);
    x = await by("/", { redirect: "manual" });
    assert.deepEqual([x.status, x.by], [302, "C#"], "a page, to the sign-in page");

    const token = await signIn(B);   // setup and SRP, against C#
    const H = { Authorization: "Bearer " + token };
    x = await by("/api/auth/devices", { headers: H });
    assert.deepEqual([x.status, x.by], [200, "C#"], "the devices");
    assert.equal((await x.r.json()).devices.length, 1);
    // The library read on first start (a 503 until then, from the Node server).
    for (let i = 0; i < 150; i++) { if ((await (await fetch(B + "/api/status", { headers: H })).json()).index_count >= 3) break; await new Promise(r => setTimeout(r, 100)); }
    x = await by("/api/library/albums", { headers: H });
    assert.deepEqual([x.status, x.by], [200, "C#"], "the library: read by C# " + JSON.stringify([x.status, x.by]));
    assert.equal((await x.r.json()).total, 3);
    x = await by("/api/status", { headers: H });
    assert.deepEqual([x.status, x.by], [200, "Node"], "the server's state: passed on, signed in by C#'s token");
    // The Node server's private address for the C# server: not from outside, and not without its key.
    x = await by("/internal/library", { headers: H });
    assert.deepEqual([x.status, x.by], [404, "C#"], "/internal/library answered 404 at the door");
    assert.equal((await fetch("http://127.0.0.1:" + ctx.listeningOn + "/internal/library", { headers: H })).status, 403, "the key, or nothing");
    x = await by("/api/library/albums", { headers: { Authorization: "Bearer not-a-token" } });
    assert.deepEqual([x.status, x.by], [401, "C#"], "a bad token stops at C#");
    // A streamer's NOTIFY (it can't sign in): passed on, as the Node server takes it before its gate.
    x = await by("/upnp/event/uuid:nobody", { method: "NOTIFY", headers: { "Content-Type": "text/xml", NT: "upnp:event", NTS: "upnp:propchange", SID: "uuid:x" }, body: "<e:propertyset xmlns:e=\"urn:schemas-upnp-org:event-1-0\"/>" });
    assert.deepEqual([x.status, x.by], [200, "Node"], "a renderer's event, not stopped at the gate");
    // The Node server's loopback-only routes: never through the front door.
    x = await by("/internal/dash/nope", { redirect: "manual" });
    assert.deepEqual([x.status, x.by], [404, "C#"], "/internal/ answered 404 at the door");
    // The page and its files (v0.8.3): C#, behind the gate; everything outside public/ passed on.
    for (const p of ["/", "/index.html", "/app.js", "/style.css", "/srp.js", "/manifest.json"]) {
      x = await by(p, { headers: H });
      assert.deepEqual([x.status, x.by], [200, "C#"], "the page's file " + p);
    }
    const page = await by("/", { headers: H });
    const again = await by("/", { headers: Object.assign({ "If-None-Match": page.r.headers.get("etag") }, H) });
    assert.equal(again.status, 304, "a copy still current: not modified");
    const app = { "User-Agent": "Mozilla/5.0 (Linux; Android 15; wv) MusicDAndroid/0.8.3", Authorization: H.Authorization };
    x = await by("/style.css", { headers: app });
    assert.deepEqual([x.status, x.by], [200, "C#"], "the app's stylesheet");
    const tag = x.r.headers.get("etag");
    assert.equal((await by("/style.css", { headers: Object.assign({ "If-None-Match": tag }, app) })).status, 304, "the app's offline copy, still current");
    x = await by("/app.js");
    assert.equal(x.status, 401, "the page's files still behind the gate");
    for (const p of ["/login", "/display", "/library"]) {
      x = await by(p, { headers: H, redirect: "manual" });
      assert.equal(x.by, "Node", p + ": a Node route or the page for a deep link, passed on");
    }
    // v0.8.16: hearts, Listen later and label changes made by C# (an album that isn't there, said by C#).
    const J = Object.assign({ "Content-Type": "application/json" }, H);
    for (const p of ["/api/favourites", "/api/listen-later"]) {
      x = await by(p, { method: "POST", headers: J, body: JSON.stringify({ offset: -1, on: true }) });
      assert.deepEqual([x.status, x.by], [404, "C#"], p + ": made by C#");
    }
    x = await by("/api/labels/merge", { method: "POST", headers: J, body: JSON.stringify({ items: [] }) });
    assert.deepEqual([x.status, x.by], [400, "C#"], "a label merge, by C#");
    x = await by("/api/labels/merge/nothing", { method: "DELETE", headers: H });
    assert.deepEqual([x.status, x.by], [404, "C#"], "a merge let go, by C#");
    x = await by("/api/settings/label-folder-depth", { method: "POST", headers: J, body: JSON.stringify({ depth: -1 }) });
    assert.deepEqual([x.status, x.by], [400, "C#"], "the label folder depth, by C#");
    x = await by("/api/health");
    assert.deepEqual([x.status, x.by], [200, "Node"], "health, open, passed on");
  } finally { await srv.stop(); }
});
