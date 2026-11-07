"use strict";
/*
 * The taste graph (v0.7.6): the acts near what you play, weighted by the
 * days you play each and how lately, built from Deezer's related lists; Home's
 * Picks are drawn by it. The share card's three suggestions it once drew went
 * with item 336, and their route with them. Pure decisions over canned Deezer
 * answers, then the graph built by the server with Deezer stood in for.
 *
 * The C# server's (Extras/Similar.cs; lib/similar.js until v0.8.50): its
 * rules asked through `mandarin-server score` { fn: "similar" }.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { built } = require("./server");
const { score } = require("./score");

const rules = built();
const similar = job => score(Object.assign({ fn: "similar" }, job));

test("the taste graph: acts near what you play, weighted by days played and recency, 0..1", { skip: rules }, () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  const seeds = [
    { name: "Steely Dan", days: 10, last: now - 2 * 86400000 },       // played a lot, lately
    { name: "Kraftwerk", days: 1, last: now - 150 * 86400000 }       // once, months ago
  ];
  const related = {
    "Steely Dan": [{ id: "1", name: "Donald Fagen" }, { id: "2", name: "Prefab Sprout" }],
    "Kraftwerk": [{ id: "3", name: "Neu!" }, { id: "2", name: "Prefab Sprout" }]
  };
  const g = new Map(similar({ tastes: [{ seeds, related, now }] }).tastes[0]);
  assert.equal(g.get("donald fagen").score, 1, "the top act of the most-played seed is the ceiling");
  assert.ok(g.get("prefab sprout").score > g.get("neu").score, "near two seeds beats near one old one");
  assert.deepEqual(g.get("prefab sprout").via, ["Steely Dan", "Kraftwerk"]);
  assert.ok(g.get("neu").score < 0.05, "a seed played once months ago barely counts: " + g.get("neu").score);
});

const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeDeezer } = require("./fake-deezer");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

test("the taste graph built from your plays; the share card's suggestions are gone (item 336)", { skip: !haveFfmpeg() && "ffmpeg is not installed", timeout: 60000 }, async () => {
  // Deezer, stood in for: Artist B (whom you play) and Heavy Act (whom you play most) are each related to New Act;
  // Artist B to Another Act too.
  const deezer = new FakeDeezer({
    "search/artist?limit=10&q=Artist%20B": { data: [{ id: 203, name: "Artist B", nb_fan: 6000 }] },
    "search/artist?limit=10&q=Heavy%20Act": { data: [{ id: 206, name: "Heavy Act", nb_fan: 6000 }] },
    "artist/206/related?limit=25": { data: [{ id: 202, name: "New Act" }] },
    "artist/203/related?limit=25": { data: [{ id: 202, name: "New Act" }, { id: 205, name: "Another Act" }] }
  });
  await deezer.start();
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, deezerBaseUrl: deezer.base });
  const ctx = await srv.start();
  try {
    const token = await signIn(B);
    const ask = p => fetch(B + p, { headers: { Authorization: "Bearer " + token } });
    const get = async p => (await ask(p)).json();
    for (let i = 0; i < 100 && (await get("/api/status")).index_count !== 3; i++) await new Promise(r => setTimeout(r, 100));
    // Artist B, played on three days this month; Heavy Act (a stream, not in
    // the library) on ten — the act you play most needs no introduction.
    const albums = (await get("/api/library/albums?sort=album")).albums;
    const hi = albums.find(a => a.title === "Hi Res");
    const t = (await get("/api/album?offset=" + hi.offset)).tracks[0];
    for (let d = 1; d <= 3; d++) ctx.features.insertPlay.run(hi.offset, t.track_id, t.title, "Artist B", "Hi Res", "z", Date.now() - d * 86400000);
    for (let d = 1; d <= 10; d++) ctx.features.insertPlay.run(null, null, "Song", "Heavy Act", "Big", "z", Date.now() - d * 86400000);
    // The server's graph, built again from the plays now (it is otherwise built once a day).
    const g = await (await fetch(B + "/internal/jobs/taste", { method: "POST", headers: { "X-Mandarin-Front-Key": ctx.frontKey } })).json();
    assert.equal(g.near["new act"], 1, "the taste graph has your acts' neighbours: " + JSON.stringify(g));
    assert.deepEqual(g.heavy, ["heavy act"]);
    assert.ok(g.near["another act"] > 0 && g.near["another act"] < 1, "near one act you play, less than near two: " + JSON.stringify(g.near));

    const res = await ask("/api/similar?artist=Artist%20A");
    assert.equal(res.status, 404, "no suggestions under the share card");
  } finally { await srv.stop(); await deezer.stop(); }
});
