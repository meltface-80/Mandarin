"use strict";
/*
 * Record labels (Stage 8, part 3): a label looked up for the albums whose
 * files carry none — MusicBrainz then Discogs (fakes on loopback) — kept by
 * the album's identity, misses remembered, the tags always winning.
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeDiscogs } = require("./fake-discogs");
const { FakeMusicBrainz } = require("./fake-musicbrainz");
const { plainName } = require("../lib/labellookup");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = 3615;
const B = "http://127.0.0.1:" + PORT;

test("Discogs' numbered names are plain", () => {
  assert.equal(plainName("Blue Note (2)"), "Blue Note");
  assert.equal(plainName("4AD"), "4AD");
});

test("labels looked up for untagged albums", { skip, timeout: 90000 }, async (t) => {
  const lib = makeLibrary();
  // Untagged: Best Of (the fixture's), Third (MusicBrainz knows it), Fourth (only Discogs), Fifth (nobody).
  gen(path.join(lib.music, "Artist C", "Third", "01 One.flac"), { tags: { title: "One", artist: "Artist C", album: "Third", track: 1 } });
  gen(path.join(lib.music, "Artist D", "Fourth", "01 One.flac"), { tags: { title: "One", artist: "Artist D", album: "Fourth", track: 1 } });
  gen(path.join(lib.music, "Artist E", "Fifth", "01 One.flac"), { tags: { title: "One", artist: "Artist E", album: "Fifth", track: 1 } });
  const mb = new FakeMusicBrainz([
    { id: "r1", title: "Third", artist: "Artist C", date: "2001", label: "ECM Records", tracks: [["One", 3]] },
    { id: "r2", title: "Third", artist: "Somebody Else", date: "1999", label: "Wrong Label", tracks: [["One", 3]] },
    { id: "r3", title: "Best Of", artist: "Various Artists", date: "2005", label: "Rhino", tracks: [["C1", 3], ["C2", 3]] }
  ]);
  const discogs = new FakeDiscogs([], { releases: [{ title: "Fourth", artist: "Artist D", label: "Nonesuch (2)" }] });
  await Promise.all([mb.start(), discogs.start()]);
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    discogsBaseUrl: discogs.base, mbBaseUrl: mb.baseUrl, logoPauseMs: 0, identify: false });
  const ctx = await srv.start();
  const token = await signIn(B);
  const api = async (p, body) => {
    const r = await fetch(B + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    const text = await r.text();
    let j = {}; try { j = JSON.parse(text); } catch (e) { j = { text }; }
    return Object.assign({ status: r.status }, j);
  };
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise(r => setTimeout(r, 100)); } };
  const settled = () => until(async () => !(await api("labels-scan-status")).scanning);
  const names = async () => (await api("filters/labels")).labels.map(l => [l.title, l.albumCount]);
  try {
    await until(async () => (await api("status")).index_count === 6);

    await t.test("switched on: MusicBrainz first, by title and artist; Discogs for the rest with a token", async () => {
      await api("settings/discogs-token", { token: "tok" });
      let s = await api("settings/labels", { enabled: true });
      assert.equal(s.enabled, true);
      await settled();
      assert.deepEqual(await names(), [["Blue Note", 1], ["ECM", 1], ["Nonesuch", 1], ["Parlophone", 1], ["Rhino", 1]]);
      s = await api("settings/labels");
      assert.deepEqual([s.tagged, s.looked_up, s.untagged], [2, 3, 1], "Fifth stays untagged");
      assert.deepEqual(s.lookups, { found: 3, missed: 1 });
      const log = (await api("labels-scan-log")).text;
      assert.match(log, /Artist C — Third: ECM Records \(MusicBrainz\)/, "the release by the right artist, not Somebody Else's");
      assert.match(log, /Artist D — Fourth: Nonesuch \(Discogs\)/);
      assert.match(log, /Artist E — Fifth: no label found/);
      assert.match(log, /lookups: done, 3 of 4 found/);
      const third = (await api("library/albums?sort=album")).albums.find(a => a.title === "Third");
      assert.equal((await api("album?offset=" + third.offset)).album.label, "ECM");
    });

    await t.test("kept by identity through a rebuild; misses not asked again; force asks everything", async () => {
      const mbHits = mb.requests.length, dHits = discogs.hits.length;
      ctx.library.reload();
      assert.deepEqual((await names()).map(x => x[0]), ["Blue Note", "ECM", "Nonesuch", "Parlophone", "Rhino"]);
      await api("labels/rescan", {});
      await settled();
      assert.equal(mb.requests.length, mbHits, "nothing asked again within the hour");
      const r = await api("labels/rescan-force", {});
      assert.equal(r.started, true);
      await settled();
      assert.ok(mb.requests.length > mbHits && discogs.hits.length > dHits, "everything asked again");
      assert.deepEqual((await api("settings/labels")).lookups, { found: 3, missed: 1 });
    });

    await t.test("the files' own tag wins over a lookup", async () => {
      // Third gains a LABEL tag of its own.
      gen(path.join(lib.music, "Artist C", "Third", "01 One.flac"), { tags: { title: "One", artist: "Artist C", album: "Third", track: 1, label: "Verve" } });
      await api("library/rescan", {});
      await until(async () => (await names()).some(x => x[0] === "Verve"));
      assert.ok(!(await names()).some(x => x[0] === "ECM"));
      assert.deepEqual((await api("settings/labels")).lookups, { found: 3, missed: 1 }, "the lookup row stays, unused");
    });

    await t.test("off: nothing looked up, the wall says nothing", async () => {
      await api("settings/labels", { enabled: false });
      assert.deepEqual((await api("filters/labels")).labels, []);
      assert.equal((await api("labels/rescan-force", {})).started, false);
    });
  } finally {
    await srv.stop(); await Promise.all([mb.stop(), discogs.stop()]);
  }
});
