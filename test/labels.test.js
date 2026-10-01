"use strict";
/*
 * Record labels (Stage 8, part 1): from the files' LABEL tags, off until
 * switched on; the Labels wall, a label's albums, search, the Focus facet,
 * the album page, Label of the week, and the folder-depth rule.
 */
const test = require("node:test");
const assert = require("node:assert");
const { canonicalLabelName, labelKey, isLikelyNotALabel, labelFromFolder } = require("../lib/labels");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = 3613;
const B = "http://127.0.0.1:" + PORT;

test("a label's names fold together", () => {
  assert.equal(canonicalLabelName("Blue Note Records (UK)"), "Blue Note");
  assert.equal(canonicalLabelName("Blue Note Records, "), "Blue Note");
  assert.equal(canonicalLabelName("Universal Music Canada"), "Universal");
  assert.equal(canonicalLabelName("[PIAS] America"), "[PIAS]");
  assert.equal(canonicalLabelName("[PIAS]"), "[PIAS]");
  assert.equal(canonicalLabelName("Deutsche Grammophon (DG)"), "Deutsche Grammophon");
  assert.equal(labelKey("BLUE NOTE"), labelKey("Blue Note Records"));
  assert.equal(labelKey("Café Records"), "cafe");
  assert.notEqual(labelKey("Blue Note"), labelKey("Blue Thumb"));
  assert.ok(isLikelyNotALabel("Big Deal Management"));
  assert.ok(isLikelyNotALabel("Unknown"));
  assert.ok(isLikelyNotALabel("2019"));
  assert.ok(isLikelyNotALabel("self-released"));
  assert.ok(!isLikelyNotALabel("Parlophone"));
  // A library filed by label: /music/Jazz/Blue Note/Album is depth 2.
  const roots = ["/music", "/mnt/more"];
  assert.equal(labelFromFolder("/music/Jazz/Blue Note/Album", roots, 2), "Blue Note");
  assert.equal(labelFromFolder("/music/Jazz/Blue Note/Album", roots, 1), "Jazz");
  assert.equal(labelFromFolder("/music/Jazz/Blue Note/Album", roots, 3), null, "the album's own folder is never the label");
  assert.equal(labelFromFolder("/mnt/more/ECM/Album", roots, 1), "ECM");
  assert.equal(labelFromFolder("/elsewhere/ECM/Album", roots, 1), null);
  assert.equal(labelFromFolder("/music/Album", roots, 0), null);
});

test("labels from the tags, once switched on", { skip, timeout: 60000 }, async (t) => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
  // A fake MusicBrainz that knows nothing: the lookup pass for the untagged
  // album (part 3) must not reach the real one from a test.
  const mb = await new (require("./fake-musicbrainz").FakeMusicBrainz)([]).start();
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, mbBaseUrl: mb.baseUrl, logoPauseMs: 0 });
  const ctx = await srv.start();
  const token = await signIn(B);
  const api = async (p, body) => {
    const r = await fetch(B + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    const text = await r.text();
    let j = {}; try { j = JSON.parse(text); } catch (e) { j = { text }; }
    return Object.assign({ status: r.status }, j);
  };
  try {
    for (let i = 0; i < 100 && (await api("status")).index_count !== 3; i++) await new Promise(r => setTimeout(r, 100));
    const albums = (await api("library/albums?sort=album")).albums;
    const one = albums.find(a => a.title === "Album One"), hi = albums.find(a => a.title === "Hi Res");

    await t.test("off by default: nothing shows, but the count is known", async () => {
      const s = await api("settings/labels");
      assert.equal(s.enabled, false);
      assert.deepEqual([s.tagged, s.untagged, s.total], [2, 1, 3], "Album One and Hi Res carry LABEL; Best Of doesn't");
      assert.deepEqual((await api("filters/labels")).labels, []);
      assert.deepEqual((await api("search?q=parlophone")).labels, []);
      assert.equal((await api("home/label-of-the-week")).label, null);
      assert.equal((await api("album?offset=" + one.offset)).album.label, undefined);
      assert.ok(!(await api("library/facets")).facets.some(f => f.id === "label"));
      const row = (await api("settings/home-rows")).rows.find(r => r.id === "lotw");
      assert.ok(row && row.unavailable, "the Home row is there, unavailable");
    });

    await t.test("on: the wall, a label's albums, search, the facet, the album page", async () => {
      assert.equal((await api("settings/labels", { enabled: true })).enabled, true);
      const f = await api("filters/labels");
      for (let i = 0; i < 100 && (await api("labels-scan-status")).scanning; i++) await new Promise(r => setTimeout(r, 50));
      assert.equal((await api("labels-scan-status")).scanning, false);
      assert.deepEqual(f.labels.map(l => [l.title, l.albumCount]), [["Blue Note", 1], ["Parlophone", 1]], "alphabetical, the company words dropped");
      assert.equal(f.labels[0].key, "bluenote");
      assert.equal(f.labels[0].image_key, hi.image_key);
      // By any of its spellings.
      for (const name of ["Blue Note", "blue note records", "Blue Note Records (UK)"]) {
        const r = await api("label-albums?label=" + encodeURIComponent(name));
        assert.deepEqual(r.albums.map(a => a.title), ["Hi Res"], name);
        assert.equal(r.label, "Blue Note");
      }
      assert.deepEqual((await api("label-albums?label=Nobody")).albums, []);
      assert.equal((await api("label-albums")).status, 400);
      assert.deepEqual((await api("search?q=parlo")).labels, [{ display: "Parlophone", albumCount: 1, logo_url: null }]);
      assert.deepEqual((await api("search?q=note")).labels.map(l => l.display), ["Blue Note"]);
      const facet = (await api("library/facets")).facets.find(x => x.id === "label");
      assert.deepEqual(facet.values.map(v => v.value), ["Blue Note", "Parlophone"]);
      assert.deepEqual((await api("library/albums?sort=album&label=Parlophone")).albums.map(a => a.title), ["Album One"]);
      assert.equal((await api("album?offset=" + one.offset)).album.label, "Parlophone");
      const ex = await api("album/extras?fast=1&title=Album%20One&artist=Artist%20A");
      assert.equal(ex.album.label, "Parlophone", "on the album page and the share card");
      assert.equal((await api("settings/labels")).count, 2);
      assert.ok(!(await api("settings/home-rows")).rows.find(r => r.id === "lotw").unavailable);
      assert.match((await api("labels-scan-log")).text, /2 labels; 2 albums carry a label tag, 0 have one looked up, 1 have none/);
      assert.equal((await api("labels/merge", { items: [] })).status, 400, "two labels are needed to merge");
    });

    await t.test("Label of the week needs three albums; survives a reload", async () => {
      assert.equal((await api("home/label-of-the-week")).label, null, "no label has three albums");
      ctx.library.reload();
      assert.equal((await api("filters/labels")).labels.length, 2);
      assert.equal((await api("settings/labels")).enabled, true, "the switch is kept");
    });

    await t.test("a library filed by label: the folder at the set depth", async () => {
      // Artist A/Album One: depth 1 is "Artist A"; Comp/CD1 is the disc folder,
      // so Best Of's album folder is "Comp" and depth 1 names nothing for it.
      const r = await api("settings/label-folder-depth", { depth: 1 });
      assert.equal(r.ok, true);
      assert.equal((await api("settings/label-folder-depth")).depth, 1);
      assert.deepEqual((await api("filters/labels")).labels.map(l => l.title), ["Artist A", "Artist B"]);
      assert.equal((await api("settings/label-folder-depth", { depth: 9 })).status, 400);
      await api("settings/label-folder-depth", { depth: 0 });
      assert.deepEqual((await api("filters/labels")).labels.map(l => l.title), ["Blue Note", "Parlophone"]);
    });

    await t.test("off again", async () => {
      assert.equal((await api("settings/labels", { enabled: false })).enabled, false);
      assert.deepEqual((await api("filters/labels")).labels, []);
      assert.equal((await api("album?offset=" + one.offset)).album.label, undefined);
      assert.ok(!(await api("album/extras?fast=1&title=Album%20One&artist=Artist%20A")).album);
    });
  } finally {
    await srv.stop(); await mb.stop();
  }
});
