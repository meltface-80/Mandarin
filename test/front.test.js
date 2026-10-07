"use strict";
/*
 * Mandarin's server in C# (v0.8.1 on, server/): which server answers what.
 * Runs when the suite goes through the C# server (MANDARIN_FRONT=1, as CI
 * does on Node 22). Each part moved to C# is pinned here, so a part can't
 * quietly fall back to the Node server behind it.
 *   - v0.8.1: everything is passed on, through C#;
 *   - v0.8.2: sign-in, devices and the gate are answered by C#; a streamer's
 *     NOTIFY still reaches the Node server unsigned; /internal/ stops at the door.
 */
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");

const skip = process.env.MANDARIN_FRONT !== "1" && "the suite isn't going through the C# server (MANDARIN_FRONT=1)";

test("which server answers: sign-in and the gate in C#, the library passed on", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const PORT = 3695, B = "http://127.0.0.1:" + PORT;
  const srv = require("../index.js").createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1",
    sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
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
    assert.deepEqual([x.status, x.by], [200, "Node"], "the library: passed on, signed in by C#'s token " + JSON.stringify([x.status, x.by]));
    x = await by("/api/library/albums", { headers: { Authorization: "Bearer not-a-token" } });
    assert.deepEqual([x.status, x.by], [401, "C#"], "a bad token stops at C#");
    // A streamer's NOTIFY (it can't sign in): passed on, as the Node server takes it before its gate.
    x = await by("/upnp/event/uuid:nobody", { method: "NOTIFY", headers: { "Content-Type": "text/xml", NT: "upnp:event", NTS: "upnp:propchange", SID: "uuid:x" }, body: "<e:propertyset xmlns:e=\"urn:schemas-upnp-org:event-1-0\"/>" });
    assert.deepEqual([x.status, x.by], [200, "Node"], "a renderer's event, not stopped at the gate");
    // The Node server's loopback-only routes: never through the front door.
    x = await by("/internal/dash/nope", { redirect: "manual" });
    assert.deepEqual([x.status, x.by], [404, "C#"], "/internal/ answered 404 at the door");
    x = await by("/api/health");
    assert.deepEqual([x.status, x.by], [200, "Node"], "health, open, passed on");
  } finally { await srv.stop(); }
});
