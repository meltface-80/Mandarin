"use strict";
/*
 * http-body.test.js — one way in and one way out for every route (v0.9.2, the
 * audit's Q1, docs/specs/audit-b4-main.md; server/Mandarin.Server/Http.cs).
 * The route files ported from the Node server each read a JSON body their own
 * way, and the copies had drifted. One reader now, so a body is turned down
 * alike wherever it is sent: not JSON, or not an object or an array, a 400; a
 * charset that isn't a UTF one a 415; past 2 MB a 413, with a length or
 * without. And one writer: a JSON answer as res.json sent it, with its weak
 * tag, "not modified" for a copy still current, and no body to a HEAD.
 */
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg } = require("./fixtures");
const { built } = require("./server");
const { started } = require("./helpers");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");

test("a body turned down alike by every route that reads one", { skip, timeout: 180000 }, async (t) => {
  const { base, token } = await started(t);
  const big = "[" + "1,".repeat(1100000) + "1]";
  const inChunks = () => new ReadableStream({ start(c) { c.enqueue(Buffer.from(big)); c.close(); } });
  const bodies = [
    ["{not json", "application/json", 400, "Bad JSON"],
    ['"a string"', "application/json; charset=utf-8", 400, "Bad JSON"],
    ["{}", "application/json; charset=latin1", 415, 'unsupported charset "LATIN1"'],
    [big, "application/json", 413, "request entity too large"],
    [inChunks, "application/json", 413, "request entity too large"]
  ];
  // Each way a route read one: the settings' and playback's (Auth.Body), the library's (JsBody), the
  // services' and a device's (put back for a route after them), and no route's (Pages.NotThere).
  const routes = [["POST", "/api/settings/display"], ["POST", "/api/control"], ["POST", "/api/share/encode"],
    ["POST", "/api/library/cleanup"], ["PATCH", "/api/audio-devices/nobody"], ["POST", "/api/nothing"]];
  for (const [method, p] of routes) {
    for (const [body, type, status, error] of bodies) {
      const init = typeof body === "function" ? { body: body(), duplex: "half" } : { body };
      const r = await fetch(base + p, Object.assign({ method, headers: { Authorization: "Bearer " + token, "Content-Type": type } }, init));
      const what = typeof body === "function" ? "2 MB in chunks" : body.slice(0, 12);
      assert.deepEqual([method, p, what, r.status, r.headers.get("x-mandarin-answered"), await r.json()], [method, p, what, status, "C#", { error }]);
    }
  }
});

test("every JSON answer as res.json sent it: its tag, not modified while current, no body to a HEAD", { skip, timeout: 120000 }, async (t) => {
  const { base, H } = await started(t);
  // Sign-in's, playback's, the library's, a download's and no route's, each once with its own writer.
  for (const [p, status] of [["/api/auth/devices", 200], ["/api/zones", 200], ["/api/settings/display", 200], ["/api/download/t987654", 404], ["/api/nothing", 404]]) {
    const r = await fetch(base + p, { headers: H });
    const text = await r.text();
    assert.equal(r.status, status, p + " " + text);
    assert.match(r.headers.get("content-type"), /^application\/json; charset=utf-8$/, p);
    const tag = r.headers.get("etag");
    assert.match(String(tag), /^W\/"[0-9a-f]+-[A-Za-z0-9+/]{27}"$/, p + ": the etag package's weak tag");
    const again = await fetch(base + p, { headers: Object.assign({ "If-None-Match": tag }, H) });
    assert.equal(again.status, status === 200 ? 304 : status, p + ": a copy still current");
    if (status !== 200) continue;
    const head = await fetch(base + p, { method: "HEAD", headers: H });
    assert.deepEqual([head.status, head.headers.get("etag"), await head.text()], [200, tag, ""], p + ": HEAD");
  }
});
