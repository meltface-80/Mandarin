"use strict";
/*
 * The covers the Node server drew with sharp, drawn by the C# server
 * (v0.8.34, stage 1f; server/Mandarin.Server/CoversDrawn.cs), with ffmpeg:
 *
 *   - an album with no cover of its own: its placeholder, held to the Node
 *     server's own drawing of it (lib/library/artwork.js) — the same colours
 *     and layout, near enough pixel for pixel (fonts are drawn by two
 *     different libraries, so not to the byte). Where ffmpeg can't draw text
 *     (no drawtext: CI's static build, Homebrew's), the Node server's, as
 *     before;
 *   - a picture from elsewhere ("u-" and its address): fetched and drawn;
 *     one that can't be had is a 404, as the Node server answers it;
 *   - a speaker asking by its own address (v0.8.48, stage 5 part 5): let
 *     through and sent by the C# server, as the Node server's gate lets a
 *     speaker through — their addresses come with its state.
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
const { makeLibrary, haveFfmpeg, haveDrawtext } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
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

  // A household: its speakers fetch covers by their own addresses.
  const house = new FakeHousehold();
  await house.start();
  t.after(() => house.stop());
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const H = { headers: { Authorization: "Bearer " + await signIn(B) } };
  for (let i = 0; i < 100; i++) { const st = await (await fetch(B + "/api/status", H)).json(); if (st.index_count >= 3) break; await new Promise(r => setTimeout(r, 100)); }
  const albums = (await (await fetch(B + "/api/library/albums?sort=album", H)).json()).albums;
  // Album One has a cover.jpg (fixtures.js); Hi Res has none.
  const one = albums.find(a => a.title === "Hi Res");
  assert.ok(one && one.image_key, "an album without a cover");

  const drawtext = haveDrawtext();
  await t.test("an album with no cover: its placeholder, drawn here, as the Node server draws it (by the Node server where ffmpeg can't draw text)", async () => {
    for (const size of [120, 800]) {
      const r = await fetch(`${B}/api/image/${one.image_key}?size=${size}`, H);
      assert.equal(r.status, 200);
      if (!drawtext) {
        // Passed on: the Node server's own drawing, kept where the C# server finds it next time.
        assert.equal(r.headers.get("x-mandarin-answered"), null, "this ffmpeg has no drawtext: the Node server's");
        assert.equal(dims(Buffer.from(await r.arrayBuffer())), `${size},${size}`);
        assert.ok(fs.existsSync(path.join(lib.data, "art", `${one.image_key}@${size}.jpg`)));
        continue;
      }
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
    // Within a few levels: ffmpeg's versions convert colours a level or two apart (9.0's on a Mac lower).
    const got = rgbAt(jpg, 50, 30, 20, 120);
    [0x33, 0x66, 0xcc].forEach((v, i) => assert.ok(Math.abs(got[i] - v) <= 8, `its colour: ${got} against 51,102,204`));
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

  await t.test("a speaker asking by its own address: let through and sent here, as the Node server's gate lets it through", async () => {
    // The rooms found, their addresses with the Node server's state.
    for (let i = 0; i < 300; i++) { if ((await (await fetch(B + "/api/zones", H)).json()).zones.length >= 2) break; await new Promise(r => setTimeout(r, 100)); }
    const withCover = albums.find(a => a.title === "Album One");
    const ask = (localAddress, base) => new Promise((resolve, reject) => {
      const u = new URL(`${base || B}/api/image/${withCover.image_key}?size=300`);
      http.get({ host: u.hostname, port: u.port, path: u.pathname + u.search, localAddress }, (res) => {
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, by: res.headers["x-mandarin-answered"] || null, type: res.headers["content-type"], body: Buffer.concat(chunks) }));
      }).on("error", reject);
    });
    // No token, no signature: from a speaker's address, sent by the C# server; from any other, the Node server's gate turns it away.
    const speaker = await ask(ports.host(0));
    assert.deepEqual([speaker.status, speaker.by, speaker.type], [200, "C#", "image/jpeg"]);
    assert.equal(dims(speaker.body), "300,300");
    const stranger = await ask("127.0.0.1");
    assert.deepEqual([stranger.status, stranger.by], [401, null], "not a speaker: the Node server's refusal");
    // The Node server's own gate says the same of each.
    assert.equal((await ask(ports.host(0), "http://127.0.0.1:" + ctx.listeningOn)).status, 200);
    assert.equal((await ask("127.0.0.1", "http://127.0.0.1:" + ctx.listeningOn)).status, 401);
  });
});
