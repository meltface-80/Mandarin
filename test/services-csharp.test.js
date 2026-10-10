"use strict";
/*
 * Qobuz's and Tidal's catalogue answered by the C# server (v0.8.39, stage 4.1;
 * server/Mandarin.Server/ServiceRoutes.cs and Services/), against the fakes on
 * loopback (test/fake-qobuz.js, test/fake-tidal.js):
 *
 *   - every catalogue route, signed out and signed in, held to the Node
 *     server's own answer to the same request (asked of it directly), its
 *     refusals word for word;
 *   - a favourite changed on the Node server (still its own) seen at once;
 *   - Tidal's token refreshed by the Node server alone: a request it must be
 *     refreshed for is the Node server's to answer, and the next is C#'s again.
 *
 * Through the C# server only (MANDARIN_FRONT=1): test/qobuz.test.js and
 * test/tidal.test.js are the services' own, both ways.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { FakeQobuz } = require("./fake-qobuz");
const { FakeTidal } = require("./fake-tidal");
const { signIn } = require("./auth-helper");

const skip = (process.env.MANDARIN_FRONT !== "1" && "the C# server's: MANDARIN_FRONT=1") || (!haveFfmpeg() && "ffmpeg is not installed");

async function until(fn, ms = 20000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting " + what);
    await new Promise(r => setTimeout(r, 100));
  }
}

test("Qobuz's and Tidal's catalogue, answered by the C# server as the Node server answers it", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  // The fixture library's files (the Tidal fake makes MPEG-DASH of a hi-res album's).
  const file = path.join(lib.music, "Artist A", "Album One", "01 Song 1.flac");
  const track = (id, title) => ({ id, title, file, duration: 3 });
  const qobuz = new FakeQobuz({ albums: [
    { id: "q100", title: "Q Album", artist: "Q Artist", rate: 44100, bits: 16, year: 2021, tracks: [track(5001, "Q One"), track(5002, "Q Two")] },
    { id: "q200", title: "Q Hi-Res", artist: "Q Artist", rate: 96000, bits: 24, year: 2023, tracks: [track(5101, "Q Hi")] }
  ] });
  const tidal = new FakeTidal({ albums: [
    { id: 2001, title: "T Album", artist: "T Artist", year: 2021, hires: false, tracks: [track(8001, "T One"), track(8002, "T Two")] },
    { id: 2002, title: "T Hi-Res", artist: "T Artist", year: 2022, hires: true, tracks: [track(9001, "T Hi")] }
  ] });
  t.after(() => Promise.all([qobuz.stop(), tidal.stop()]));
  await qobuz.start();
  await tidal.start();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    qobuzBaseUrl: qobuz.base, tidalBaseUrl: tidal.base, tidalAuthUrl: tidal.authBase, tidalImagesUrl: tidal.authBase + "/images/", qobuzSyncDelayMs: 100000 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const NODE = "http://127.0.0.1:" + ctx.listeningOn;
  const call = async (base, p, body) => {
    const r = await fetch(base + "/api/" + p, body ? { method: "POST", headers: H, body: JSON.stringify(body) } : { headers: H });
    return { status: r.status, by: r.headers.get("x-mandarin-answered"), j: await r.json().catch(() => null) };
  };
  const get = (p) => call(B, p);
  const post = (p, body) => call(B, p, body || {});
  // The same request of the C# server and of the Node server itself: the same answer, the first from C#.
  const same = async (p) => {
    const c = await call(B, p), n = await call(NODE, p);
    assert.equal(c.by, "C#", p + ": answered by the C# server");
    assert.equal(n.by, null, p + ": the Node server's own");
    assert.equal(c.status, n.status, p + ": " + JSON.stringify(c.j) + " against " + JSON.stringify(n.j));
    assert.deepEqual(c.j, n.j, p);
    return c;
  };
  await until(() => ctx.frontRuns, 30000, "the work handed over");

  const routes = (s, album, artist) => [`${s}/lists`, `${s}/new-releases`, `${s}/new-releases?days=7`, `${s}/new-releases?days=abc`, `${s}/featured`,
    `${s}/search?q=`, `${s}/search?q=a`, `${s}/search?q=a&offset=1`, `${s}/artist-albums`, `${s}/artist-albums?artist_id=${artist}`,
    `${s}/album`, `${s}/album?id=${album}`, `${s}/state`, `${s}/state?album_id=${album}`];

  await t.test("signed out: refused as the Node server refuses", async () => {
    for (const p of routes("qobuz", "q100", 1).concat(routes("tidal", 2001, 11))) {
      const r = await same(p);
      assert.equal(r.status, 401, p);
      assert.equal(r.j.connected, false, p);
    }
  });

  // Signed in on the Node server, as from Settings → Services.
  assert.equal((await post("settings/qobuz/signin", { username: "tester@example.com", password: "pw" })).status, 200);
  assert.equal((await post("settings/tidal/signin", {})).status, 200);
  tidal.approve();
  await until(async () => (await get("settings/tidal")).j.connected, 20000, "Tidal signed in");

  await t.test("signed in: every route, the same answer", async () => {
    for (const p of routes("qobuz", "q100", 1).concat(routes("tidal", 2001, 11), [
      "qobuz/featured?type=best-sellers", "qobuz/featured?type=most-streamed", "qobuz/album?id=q200", "qobuz/album?id=nope",
      "tidal/featured?type=recommended", "tidal/featured?type=Top", "tidal/featured?type=nope", "tidal/album?id=2002", "tidal/album?id=999",
      "tidal/search?q=hi-res", "tidal/artist-albums?artist_id=11&offset=1"
    ])) await same(p);
    // The refusals, word for word (and a lists-less Qobuz).
    assert.deepEqual((await get("qobuz/lists")).j, { error: "Qobuz has no lists" });
    assert.deepEqual((await get("qobuz/album")).j, { error: "id required" });
    assert.deepEqual((await get("tidal/featured?type=nope")).j, { error: "Tidal doesn't feature that list" });
    assert.deepEqual(await get("qobuz/album?id=nope").then(r => [r.status, r.j]), [502, { error: "No such album" }]);
    assert.deepEqual(await get("tidal/album?id=999").then(r => [r.status, r.j]), [404, { error: "No such album" }]);
    // What a list says of an album.
    const q = (await get("qobuz/album?id=q200")).j;
    assert.equal(q.album.quality, "24/96");
    assert.equal(q.album.hires, true);
    assert.equal(q.offset, null, "not in the library yet");
    assert.deepEqual(q.tracks.map(x => x.title), ["Q Hi"]);
    const tl = (await get("tidal/lists")).j;
    assert.deepEqual(tl.lists.map(l => l.id), ["recommended", "top", "rising"]);
  });

  await t.test("an album opened, and a favourite changed, on the Node server: seen at once", async () => {
    const open = await post("qobuz/open", { album_id: "q100" });
    assert.equal(open.by, null, "opening is the Node server's");
    const a = await same("qobuz/album?id=q100");
    assert.equal(a.j.offset, open.j.offset, "its place in the library");
    assert.equal(a.j.album.in_library, true);
    for (const [s, id] of [["qobuz", "q200"], ["tidal", "2002"]]) {
      assert.equal((await get(`${s}/state?album_id=${id}`)).j.favourite, false);
      const fav = await post(`${s}/favorite`, { album_id: id });
      assert.deepEqual([fav.status, fav.by], [200, null], JSON.stringify(fav.j));
      const st = await same(`${s}/state?album_id=${id}`);
      assert.equal(st.j.favourite, true, s + ": the favourite seen straight after, not a minute later");
      const listed = (await same(`${s}/search?q=hi-res`)).j.albums.find(x => x.id === id);
      assert.equal(listed.favourited, true, s + ": and in the lists");
      await post(`${s}/unfavorite`, { album_id: id });
      assert.equal((await same(`${s}/state?album_id=${id}`)).j.favourite, false, s + ": and taken away");
    }
  });

  await t.test("Tidal's token: refreshed by the Node server alone", async () => {
    const before = tidal.refreshes;
    // Refused by Tidal: the Node server refreshes it and answers.
    tidal.expireAccess();
    const r = await get("tidal/search?q=t");
    assert.deepEqual([r.status, r.by], [200, null], JSON.stringify(r.j));
    assert.equal(tidal.refreshes, before + 1, "refreshed once");
    assert.equal((await get("tidal/search?q=t&offset=1")).by, "C#", "then C#'s again, with the new token");
    // About to expire: the same, without asking Tidal first (an answer kept from before needs no token: not asked).
    const acc = ctx.tidal.account();
    acc.token.expires = Date.now() + 1000;
    ctx.tidal.db.setSetting("tidal", acc);
    const s = await get("tidal/search?q=album");
    assert.deepEqual([s.status, s.by], [200, null], JSON.stringify(s.j));
    assert.equal(tidal.refreshes, before + 2);
    assert.equal((await get("tidal/search?q=album&offset=1")).by, "C#");
  });
});
