"use strict";
/*
 * nothing-behind.test.js — what the C# server used to hand to the Node server
 * behind it, answered here (v0.9.0, stage 7 part 7). Since part 6 there is
 * nothing behind it, and what it handed on fell through to "No such endpoint":
 *
 *  - the album editor's cover from an address: a picture ffmpeg can't read,
 *    an address a browser would read (a space in it), one past the 64 MB this
 *    reads, and redirects, followed here as the Node server's fetch did;
 *  - a JSON body sent without a length (chunked), read to the 2 MB limit;
 *  - a library write that fails (the database held by another writer): 500
 *    and why, as the Node server's routes answered a thrown error;
 *  - a label merge let go by a key of any shape: "Not a merged label".
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");

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
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  await until(async () => { const s = await (await fetch(B + "/api/status", { headers: H })).json(); return s.index_count > 0 && !s.scan?.running; });
  const albums = (await (await fetch(B + "/api/library/albums?sort=album", { headers: H })).json()).albums;
  return { lib, B, H, ctx, srv, albums };
}

const answer = async (r) => [r.status, await r.json().catch(() => null)];

test("the album editor's cover from an address: redirects followed, a browser's address read, a picture that can't be read refused (v0.9.0)", { skip, timeout: 120000 }, async (t) => {
  const { lib, B, H, srv, albums } = await started();
  t.after(() => srv.stop());
  const one = albums.find(a => a.title === "Album One");
  const cover = fs.readFileSync(path.join(lib.music, "Artist A", "Album One", "cover.jpg"));
  // A web server with a cover, the ways to it, and pictures that aren't.
  const web = http.createServer((req, res) => {
    const u = req.url;
    if (u === "/cover.jpg" || u === "/a%20cover.jpg") { res.writeHead(200, { "Content-Type": "image/jpeg" }); res.end(cover); return; }
    if (u === "/moved") { res.writeHead(301, { Location: "/moved-again" }); res.end(); return; }
    if (u === "/moved-again") { res.writeHead(302, { Location: "http://127.0.0.1:" + web.address().port + "/cover.jpg" }); res.end(); return; }
    if (u === "/round") { res.writeHead(302, { Location: "/round" }); res.end(); return; }
    // A JPEG's first bytes, then nothing a reader can make a picture of.
    if (u === "/broken.jpg") { res.writeHead(200, { "Content-Type": "image/jpeg" }); res.end(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7)])); return; }
    // 65 MB, sent without a length.
    if (u === "/huge.jpg") {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      const chunk = Buffer.alloc(1 << 20, 0);
      let left = 65;
      const more = () => { while (left > 0) { left--; if (!res.write(chunk)) { res.once("drain", more); return; } } res.end(); };
      more();
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(r => web.listen(0, "127.0.0.1", r));
  t.after(() => { web.closeAllConnections(); web.close(); });
  const W = "http://127.0.0.1:" + web.address().port;
  const edit = async (art_url) => answer(await fetch(B + "/api/album/edit", { method: "POST", headers: H, body: JSON.stringify({ offset: one.offset, art_url }) }));

  // Moved twice, then the cover: kept.
  let [status, body] = await edit(W + "/moved");
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual([body.art.found, body.art.source], [true, W + "/moved"]);
  // Moved for ever: as the Node server's fetch gave up.
  [status, body] = await edit(W + "/round");
  assert.deepEqual([status, body], [502, { error: "Couldn't download that image (fetch failed)" }]);
  // A space in the address, as a browser reads it.
  [status, body] = await edit(W + "/a cover.jpg");
  assert.equal(status, 200, JSON.stringify(body));
  // A picture that can't be read, and one too big to read.
  assert.deepEqual(await edit(W + "/broken.jpg"), [422, { error: "Couldn't read that image" }]);
  assert.deepEqual(await edit(W + "/huge.jpg"), [502, { error: "Couldn't download that image (too large)" }]);
});

test("a JSON body sent without a length is read, to the 2 MB limit (v0.9.0)", { skip, timeout: 120000 }, async (t) => {
  const { B, H, srv, albums } = await started();
  t.after(() => srv.stop());
  const one = albums.find(a => a.title === "Album One");
  const chunked = (p, body) => new Promise((res, rej) => {
    const req = http.request(B + p, { method: "POST", headers: { ...H, "Transfer-Encoding": "chunked" } }, r => {
      let s = ""; r.on("data", d => s += d); r.on("end", () => res([r.statusCode, JSON.parse(s)]));
    });
    req.on("error", rej);
    for (const part of body) req.write(part);
    req.end();
  });
  const [status, body] = await chunked("/api/album/edit", [JSON.stringify({ offset: one.offset, year: 2001 })]);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.year, 2001);
  const big = JSON.stringify({ offset: one.offset, title: "x".repeat(3 << 20) });
  assert.deepEqual(await chunked("/api/album/edit", [big.slice(0, 1 << 20), big.slice(1 << 20)]), [413, { error: "request entity too large" }]);
});

test("a library write that fails says why; a merged label let go by a key of any shape (v0.9.0)", { skip, timeout: 120000 }, async (t) => {
  const { B, H, ctx, srv } = await started();
  t.after(() => srv.stop());
  assert.deepEqual(await answer(await fetch(B + "/api/labels/merge/not-a-key", { method: "DELETE", headers: H })), [404, { error: "Not a merged label" }]);
  // The database held by another writer, past the server's wait for it.
  const raw = ctx.db.raw;
  raw.prepare("BEGIN IMMEDIATE").run();
  let held = true;
  t.after(() => { if (held) raw.prepare("ROLLBACK").run(); });
  const locked = /database is locked/;
  let [status, body] = await answer(await fetch(B + "/api/labels/merge/abc", { method: "DELETE", headers: H }));
  assert.equal(status, 500, JSON.stringify(body));
  assert.match(body.error, locked);
  [status, body] = await answer(await fetch(B + "/api/settings/labels", { method: "POST", headers: H, body: JSON.stringify({ enabled: true }) }));
  assert.equal(status, 500, JSON.stringify(body));
  assert.match(body.error, locked);
  raw.prepare("ROLLBACK").run();
  held = false;
  assert.deepEqual(await answer(await fetch(B + "/api/settings/labels", { method: "POST", headers: H, body: JSON.stringify({ enabled: true }) })), [200, { ok: true, enabled: true }]);
});
