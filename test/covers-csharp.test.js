"use strict";
/*
 * The covers the Node server drew with sharp, drawn by the C# server
 * (v0.8.34, stage 1f; server/Mandarin.Server/CoversDrawn.cs), with ffmpeg:
 *
 *   - an album with no cover of its own: its placeholder — a colour of its
 *     own from its title and artist (lib/library/artwork.js's rule, kept),
 *     a gradient to a darker one, the words where ffmpeg can draw text (no
 *     drawtext: CI's static build, some Homebrew builds — then without them,
 *     v0.8.50);
 *   - a picture from elsewhere ("u-" and its address): fetched and drawn;
 *     one that can't be had is a 404, as the Node server answered it;
 *   - a speaker asking by its own address (v0.8.48, stage 5 part 5): let
 *     through and sent; anyone else unsigned turned away at the gate.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { spawnSync } = require("child_process");
const { makeLibrary, haveFfmpeg, haveDrawtext } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

/* artwork.js's placeholder colours: the title and artist's MD5, its first byte as a hue; hsl(h, 38%, 30%) to hsl(h + 40, 45%, 14%). */
function placeholderColours(title, artist) {
  const hue = Math.round(require("crypto").createHash("md5").update(title + "|" + artist).digest()[0] / 255 * 360);
  const rgb = (h, s, l) => [0, 8, 4].map(n => { const k = (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255); });
  return { top: rgb(hue, 0.38, 0.30), bottom: rgb((hue + 40) % 360, 0.45, 0.14) };
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
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(() => srv.stop());
  const H = { headers: { Authorization: "Bearer " + await signIn(B) } };
  for (let i = 0; i < 100; i++) { const st = await (await fetch(B + "/api/status", H)).json(); if (st.index_count >= 3) break; await new Promise(r => setTimeout(r, 100)); }
  const albums = (await (await fetch(B + "/api/library/albums?sort=album", H)).json()).albums;
  // Album One has a cover.jpg (fixtures.js); Hi Res has none.
  const one = albums.find(a => a.title === "Hi Res");
  assert.ok(one && one.image_key, "an album without a cover");

  const drawtext = haveDrawtext();
  await t.test("an album with no cover: its placeholder, drawn here — its own colours, the words where ffmpeg draws text", async () => {
    const want = placeholderColours("Hi Res", "Artist B");
    for (const size of [120, 800]) {
      const r = await fetch(`${B}/api/image/${one.image_key}?size=${size}`, H);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("x-mandarin-answered"), "C#");
      assert.equal(r.headers.get("content-type"), "image/jpeg");
      const mine = Buffer.from(await r.arrayBuffer());
      assert.equal(dims(mine), `${size},${size}`);
      // The gradient's colours: the title and artist's own at the top left, the darker one at the bottom right.
      const near = (got, want, what) => { for (let i = 0; i < 3; i++) assert.ok(Math.abs(got[i] - want[i]) <= 12, `${size}px ${what}: ${got} against ${want}`); };
      near(rgbAt(mine, 0, 0, 8, 120), want.top, "top left");
      near(rgbAt(mine, 112, 112, 8, 120), want.bottom, "bottom right");
      // The title, in white, where CoversDrawn.cs puts it (x 40, its baseline 470 of 600: "Hi" at 50–90 × 434–470),
      // makes that square lighter than the plain gradient there (its colour at the square's middle, (X+Y)/1198 along).
      const title = rgbAt(mine, 10, 86, 8, 120);
      const plain = want.top.map((v, i) => Math.round(v + (want.bottom[i] - v) * (70 + 450) / 1198));
      if (drawtext) assert.ok(title.every((v, i) => v > plain[i] + 20), `${size}px: the title drawn in white over the gradient: ${title} against ${plain}`);
      else assert.ok(title.every((v, i) => Math.abs(v - plain[i]) <= 12), `${size}px: no drawtext, the gradient alone: ${title} against ${plain}`);
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
    // A key of no album and no picture: absent, an empty 404 as api-library.js answered it (not the not-found page).
    for (const key of ["al-999999-0", "zz-nothing"]) {
      const r = await fetch(`${B}/api/image/${key}?size=300`, H);
      assert.deepEqual([r.status, r.headers.get("x-mandarin-answered"), await r.text()], [404, "C#", ""], key);
    }
  });

  await t.test("a speaker asking by its own address: let through and sent here; anyone else unsigned turned away at the gate", async () => {
    // The rooms found, their addresses the hub's.
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
    // No token, no signature: from a speaker's address, sent; from any other, the gate's refusal (auth.js gate, Auth.Media.cs).
    const speaker = await ask(ports.host(0));
    assert.deepEqual([speaker.status, speaker.by, speaker.type], [200, "C#", "image/jpeg"]);
    assert.equal(dims(speaker.body), "300,300");
    const stranger = await ask("127.0.0.1");
    assert.deepEqual([stranger.status, stranger.by, JSON.parse(stranger.body.toString()).sign_in_required], [401, "C#", true], "not a speaker: turned away");
  });
});
