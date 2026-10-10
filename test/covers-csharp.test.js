"use strict";
/*
 * The covers the Node server drew with sharp, drawn by the C# server
 * (v0.8.34, stage 1f; server/Mandarin.Server/CoversDrawn.cs), with ffmpeg:
 *
 *   - an album with no cover of its own: its placeholder, held to the Node
 *     server's own drawing of it (lib/library/artwork.js) — the same colours
 *     and layout, near enough pixel for pixel (fonts are drawn by two
 *     different libraries, so not to the byte);
 *   - a picture from elsewhere ("u-" and its address): fetched and drawn;
 *     one that can't be had is a 404, as the Node server answers it.
 *
 * Through the C# server only (MANDARIN_FRONT=1): the Node server's own
 * drawing is test/artwork's, and unchanged.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { signIn } = require("./auth-helper");

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const skip = (process.env.MANDARIN_FRONT !== "1" && "the C# server's: MANDARIN_FRONT=1") || (!haveFfmpeg() && "ffmpeg is not installed");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

/* A JPEG as w × h grey levels (0–255), to compare two drawings. */
function grey(jpg, w = 120, h = 120) {
  const r = spawnSync(FFMPEG, ["-v", "error", "-i", "pipe:0", "-vf", `scale=${w}:${h},format=gray`, "-f", "rawvideo", "pipe:1"], { input: jpg, maxBuffer: 1 << 24 });
  assert.equal(r.status, 0, String(r.stderr));
  return r.stdout;
}
/* A JPEG's average red, green and blue in a square of it. */
function rgbAt(jpg, x, y, n, size) {
  const r = spawnSync(FFMPEG, ["-v", "error", "-i", "pipe:0", "-vf", `scale=${size}:${size},crop=${n}:${n}:${x}:${y},scale=1:1:flags=area,format=rgb24`, "-f", "rawvideo", "pipe:1"], { input: jpg, maxBuffer: 1 << 20 });
  assert.equal(r.status, 0, String(r.stderr));
  return [...r.stdout.subarray(0, 3)];
}
const dims = (jpg) => {
  const r = spawnSync(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", "-i", "pipe:0"], { input: jpg });
  return String(r.stdout).trim();
};

test("the covers sharp drew, drawn by the C# server", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  // A picture from elsewhere, served on loopback: a 900 × 600 PNG.
  const png = spawnSync(FFMPEG, ["-v", "error", "-f", "lavfi", "-i", "color=c=0x3366cc:s=900x600:d=1", "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"]).stdout;
  let asked = 0;
  const site = http.createServer((req, res) => {
    asked++;
    if (req.url === "/station.png") { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(png); }
    if (req.url === "/moved") { res.writeHead(302, { Location: "/station.png" }); return res.end(); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => site.listen(0, "127.0.0.1", r));
  t.after(() => site.close());
  const at = (p) => `http://127.0.0.1:${site.address().port}${p}`;
  const keyOf = (url) => "u-" + Buffer.from(url).toString("base64url");

  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const H = { headers: { Authorization: "Bearer " + await signIn(B) } };
  for (let i = 0; i < 100; i++) { const st = await (await fetch(B + "/api/status", H)).json(); if (st.index_count >= 3) break; await new Promise(r => setTimeout(r, 100)); }
  const albums = (await (await fetch(B + "/api/library/albums?sort=album", H)).json()).albums;
  // Album One has a cover.jpg (fixtures.js); Hi Res has none.
  const one = albums.find(a => a.title === "Hi Res");
  assert.ok(one && one.image_key, "an album without a cover");

  await t.test("an album with no cover: its placeholder, drawn here, as the Node server draws it", async () => {
    for (const size of [120, 800]) {
      const r = await fetch(`${B}/api/image/${one.image_key}?size=${size}`, H);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("x-mandarin-answered"), "C#");
      assert.equal(r.headers.get("content-type"), "image/jpeg");
      const mine = Buffer.from(await r.arrayBuffer());
      assert.equal(dims(mine), `${size},${size}`);
      // The Node server's own drawing of it, at the same size, for comparison.
      const kept = path.join(lib.data, "art", `${one.image_key}@${size}.jpg`);
      fs.rmSync(kept);
      const theirs = fs.readFileSync((await ctx.artwork.get(one.image_key, size)).file);
      // The same colours: the gradient's corners and middle.
      for (const [x, y] of [[0, 0], [100, 20], [50, 50], [100, 100]]) {
        const a = rgbAt(mine, x, y, 16, 120), b = rgbAt(theirs, x, y, 16, 120);
        for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) <= 10, `${size}px at ${x},${y}: ${a} against the Node server's ${b}`);
      }
      // The same picture, near enough: text drawn by two font libraries.
      const ga = grey(mine), gb = grey(theirs);
      let sum = 0;
      for (let i = 0; i < ga.length; i++) sum += Math.abs(ga[i] - gb[i]);
      const mean = sum / ga.length;
      assert.ok(mean < 8, `${size}px: on average ${mean.toFixed(1)} apart (of 255)`);
    }
  });

  await t.test("a picture from elsewhere: fetched, a redirect followed, drawn here and kept", async () => {
    const r = await fetch(`${B}/api/image/${keyOf(at("/moved"))}?size=300`, H);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-mandarin-answered"), "C#");
    const jpg = Buffer.from(await r.arrayBuffer());
    assert.equal(dims(jpg), "300,200", "fitted inside the size, its shape kept");
    assert.deepEqual(rgbAt(jpg, 50, 30, 20, 120).map(v => Math.round(v / 16)), [0x33, 0x66, 0xcc].map(v => Math.round(v / 16)), "its colour");
    const n = asked;
    assert.equal((await fetch(`${B}/api/image/${keyOf(at("/moved"))}?size=300`, H)).status, 200);
    assert.equal(asked, n, "kept: not fetched again");
  });

  await t.test("one that can't be had, or isn't an address: a 404, as the Node server answers", async () => {
    for (const key of [keyOf(at("/gone.png")), keyOf("ftp://example.com/x.png"), keyOf("not an address")]) {
      const r = await fetch(`${B}/api/image/${key}?size=300`, H);
      assert.equal(r.status, 404, key);
    }
    assert.equal((await fetch(`${B}/api/image/${keyOf(at("/station.png"))}?size=300`)).status, 401, "signed in only");
  });
});
