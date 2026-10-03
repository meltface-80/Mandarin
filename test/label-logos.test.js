"use strict";
/*
 * Record labels (Stage 8, part 2): merged labels with undo, and logos — found
 * in the background from Discogs then FanArt.tv (fakes on loopback), or
 * chosen by hand; kept under the data folder and served as label-<key> images.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeDiscogs, FakeFanart, PNG } = require("./fake-discogs");
const { FakeMusicBrainz } = require("./fake-musicbrainz");
const { typeOf, LabelLogos } = require("../lib/labellogos");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = 3614;
const B = "http://127.0.0.1:" + PORT;

test("an image's kind is read from its bytes", () => {
  assert.deepEqual(typeOf(PNG), ["image/png", "png"]);
  assert.deepEqual(typeOf(Buffer.from("<svg xmlns='x'/>")), ["image/svg+xml", "svg"]);
  assert.equal(typeOf(Buffer.from("<html>no</html>"), "text/html"), null);
});

test("a bare 403 says nothing about a key; one that names the key refuses it", async () => {
  const http = require("http");
  let body = "Host not in allowlist", code = 403;
  const srv = http.createServer((req, res) => { res.writeHead(code); res.end(body); });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + srv.address().port;
  const settings = { discogsToken: "tok" };
  const db = { raw: { prepare: () => ({}) }, setting: k => settings[k] };
  const logos = new LabelLogos({ db, dataDir: "/tmp", discogsBaseUrl: base });
  try {
    assert.equal(await logos.checkKey("discogs"), "unknown", "a proxy's 403 is not evidence the key is wrong");
    assert.equal(await logos.checkKey("discogs"), "unknown", "remembered");
    body = '{"message": "Invalid consumer token."}';
    assert.equal(await logos.checkKey("discogs", true), "invalid");
    code = 500;
    assert.equal(await logos.checkKey("discogs", true), "unknown");
    code = 200;
    assert.equal(await logos.checkKey("discogs", true), "ok");
    settings.discogsToken = "";
    assert.equal(await logos.checkKey("discogs", true), null);
  } finally { srv.close(); }
});

test("merges and logos", { skip, timeout: 90000 }, async (t) => {
  const lib = makeLibrary();
  // Two more labels: one Discogs knows, one only FanArt.tv does, one nobody does.
  gen(path.join(lib.music, "Artist C", "Third", "01 One.flac"), { tags: { title: "One", artist: "Artist C", album: "Third", track: 1, label: "ECM Records" } });
  gen(path.join(lib.music, "Artist D", "Fourth", "01 One.flac"), { tags: { title: "One", artist: "Artist D", album: "Fourth", track: 1, label: "Nonesuch" } });
  const discogs = new FakeDiscogs([{ id: 11, title: "Blue Note", image: "bluenote.jpg" }, { id: 12, title: "Blue Thumb", image: "bluethumb.png" }, { id: 13, title: "Parlophone" }]);
  const fanart = new FakeFanart({ "mb-ecm": "ecm.png" });
  const mb = new FakeMusicBrainz([], { labels: [{ id: "mb-ecm", name: "ECM" }, { id: "mb-nonesuch", name: "Nonesuch" }] });
  await Promise.all([discogs.start(), fanart.start(), mb.start()]);
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    discogsBaseUrl: discogs.base, fanartBaseUrl: fanart.base, mbBaseUrl: mb.baseUrl, logoPauseMs: 0 });
  await srv.start();
  const token = await signIn(B);
  const api = async (p, body, method) => {
    const r = await fetch(B + "/api/" + p, body || method ? { method: method || "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body || {}) } : { headers: { Authorization: "Bearer " + token } });
    const text = await r.text();
    let j = {}; try { j = JSON.parse(text); } catch (e) { j = { text }; }
    return Object.assign({ status: r.status, headers: r.headers }, j);
  };
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise(r => setTimeout(r, 100)); } };
  try {
    await until(async () => (await api("status")).index_count === 5);
    await api("settings/labels", { enabled: true });
    const names = async () => (await api("filters/labels")).labels.map(l => l.title);
    assert.deepEqual(await names(), ["Blue Note", "ECM", "Nonesuch", "Parlophone"]);

    await t.test("no keys: nothing is looked up, the log says so", async () => {
      await new Promise(r => setTimeout(r, 200));
      assert.equal(discogs.hits.length, 0);
      assert.match((await api("labels-scan-log")).text, /no Discogs token or FanArt.tv key/);
      assert.equal((await api("labels/logo-candidates?label=Blue%20Note")).status, 400, "candidates need the token");
    });

    await t.test("merged into the first, shown on both, undone one at a time", async () => {
      const labels = (await api("filters/labels")).labels;
      const ecm = labels.find(l => l.title === "ECM"), ns = labels.find(l => l.title === "Nonesuch"), bn = labels.find(l => l.title === "Blue Note");
      assert.equal((await api("labels/merge", { items: [{ key: ecm.key, display: "ECM" }] })).status, 400);
      const r = await api("labels/merge", { items: [{ key: ecm.key, display: "ECM" }, { key: ns.key, display: "Nonesuch" }] });
      assert.equal(r.ok, true);
      assert.deepEqual(await names(), ["Blue Note", "ECM", "Parlophone"]);
      const merged = (await api("filters/labels")).labels.find(l => l.title === "ECM");
      assert.equal(merged.albumCount, 2);
      assert.deepEqual(merged.mergedFrom, [{ key: ns.key, display: "Nonesuch" }]);
      assert.deepEqual((await api("label-albums?label=Nonesuch")).albums.map(a => a.title), ["Fourth", "Third"], "the old name still finds the albums, under the new one");
      assert.equal((await api("label-albums?label=Nonesuch")).label, "ECM");
      assert.deepEqual((await api("search?q=nonesuch")).labels.map(l => l.display), ["ECM"]);
      const fourth = (await api("library/albums?sort=album")).albums.find(a => a.title === "Fourth");
      assert.equal((await api("album?offset=" + fourth.offset)).album.label, "ECM", "the album page says the merged name");
      assert.deepEqual((await api("library/facets")).facets.find(f => f.id === "label").values.map(v => v.value), ["ECM", "Blue Note", "Parlophone"], "the facet counts first");
      // Chains: ECM (with Nonesuch inside) into Blue Note carries Nonesuch along.
      await api("labels/merge", { items: [{ key: bn.key, display: "Blue Note" }, { key: ecm.key, display: "ECM" }] });
      const big = (await api("filters/labels")).labels.find(l => l.title === "Blue Note");
      assert.equal(big.albumCount, 3);
      assert.deepEqual(big.mergedFrom.map(x => x.display), ["ECM", "Nonesuch"]);
      // Undo, one source at a time; survives a reload.
      assert.equal((await api("labels/merge/" + ecm.key, null, "DELETE")).ok, true);
      assert.deepEqual(await names(), ["Blue Note", "ECM", "Parlophone"]);
      assert.equal((await api("filters/labels")).labels.find(l => l.title === "Blue Note").mergedFrom.length, 1, "Nonesuch stays with Blue Note");
      assert.equal((await api("labels/merge/" + ns.key, null, "DELETE")).ok, true);
      assert.equal((await api("labels/merge/" + ns.key, null, "DELETE")).status, 404);
      assert.deepEqual(await names(), ["Blue Note", "ECM", "Nonesuch", "Parlophone"]);
    });

    await t.test("with the keys: Discogs first, FanArt.tv for the rest, misses remembered", async () => {
      // Each key says whether the service takes it (v0.6.1).
      const saved = await api("settings/discogs-token", { token: "tok" });
      assert.equal(saved.ok, true);
      assert.equal(saved.check, "ok");
      assert.equal((await api("settings/discogs-token")).masked, "••••tok");
      assert.equal((await api("settings/discogs-token")).check, "ok");
      assert.equal((await api("settings/fanart-key", { key: "fk" })).check, "ok", "a good key gets a 404 for an artist without art");
      assert.equal((await api("settings/fanart-key")).check, "ok");
      const r = await api("labels/rescan-force", {});
      assert.equal(r.started, true);
      await until(async () => !(await api("labels-scan-status")).scanning);
      const labels = (await api("filters/labels")).labels;
      const by = n => labels.find(l => l.title === n);
      assert.match(by("Blue Note").logo_url, /^\/api\/image\/label-bluenote\?v=\d+$/, "from Discogs");
      assert.match(by("ECM").logo_url, /^\/api\/image\/label-ecm\?v=/, "from FanArt.tv, by its MusicBrainz id");
      assert.equal(by("Nonesuch").logo_url, null, "MusicBrainz knows it, FanArt.tv has no logo");
      assert.equal(by("Parlophone").logo_url, null, "Discogs' page has no image");
      assert.ok(discogs.hits.some(h => h.startsWith("/labels/11")), "Discogs' label page was read for the primary image");
      assert.ok(!discogs.hits.some(h => /q=Blue%20Thumb/.test(h)));
      const log = (await api("labels-scan-log")).text;
      assert.match(log, /Blue Note: logo from Discogs/);
      assert.match(log, /ECM: logo from FanArt.tv/);
      assert.match(log, /Nonesuch: no logo found/);
      assert.match(log, /done, 2 of 4 found/);
      // Served as an image, cached hard.
      const img = await fetch(B + by("Blue Note").logo_url, { headers: { Authorization: "Bearer " + token } });
      assert.equal(img.status, 200);
      assert.equal(img.headers.get("content-type"), "image/jpeg");
      assert.ok(fs.existsSync(path.join(lib.data, "labels", "bluenote.jpg")));
      assert.equal((await api("label-albums?label=Blue%20Note")).logo_url, by("Blue Note").logo_url);
      assert.equal((await api("settings/labels")).logos, 2);
      // Opening the wall again doesn't ask again: the misses are remembered.
      const hits = discogs.hits.length + fanart.hits.length;
      await api("filters/labels");
      await new Promise(r => setTimeout(r, 200));
      assert.equal(discogs.hits.length + fanart.hits.length, hits);
      // A key the service refuses says so; the good ones are put back after.
      assert.equal((await api("settings/discogs-token", { token: "wrong" })).check, "invalid");
      assert.equal((await api("settings/fanart-key", { key: "wrong" })).check, "invalid");
      assert.equal((await api("settings/fanart-key")).check, "invalid");
      assert.equal((await api("settings/discogs-token", { token: "tok" })).check, "ok");
      assert.equal((await api("settings/fanart-key", { key: "fk" })).check, "ok");
    });

    await t.test("by hand: Discogs' candidates, or a pasted address; removed again", async () => {
      const c = await api("labels/logo-candidates?label=Blue%20Note");
      assert.equal(c.status, 200);
      assert.equal(c.candidates[0].title, "Blue Note", "the exact name first");
      assert.ok(c.candidates.every(x => /\/img\//.test(x.img)));
      const r = await api("labels/logo", { label: "Parlophone", url: discogs.base + "/img/parlo.png" });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.match(r.storedUrl, /^\/api\/image\/label-parlophone\?v=/);
      const img = await fetch(B + r.storedUrl, { headers: { Authorization: "Bearer " + token } });
      assert.equal(img.headers.get("content-type"), "image/png");
      assert.equal((await api("labels/logo", { label: "Parlophone", url: B + "/api/status" })).status, 500, "not an image");
      assert.equal((await api("labels/logo", { label: "Nobody", url: "http://x/y.png" })).status, 404);
      assert.equal((await api("labels/logo?label=Parlophone", null, "DELETE")).ok, true);
      assert.equal((await api("filters/labels")).labels.find(l => l.title === "Parlophone").logo_url, null);
      assert.equal((await fetch(B + r.storedUrl, { headers: { Authorization: "Bearer " + token } })).status, 404);
    });
  } finally {
    await srv.stop(); await Promise.all([discogs.stop(), fanart.stop(), mb.stop()]);
  }
});
