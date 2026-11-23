"use strict";
/*
 * Item 527: iBroadcast's albums deleted at iBroadcast from the selection menu, against a fake iBroadcast
 * (test/fake-ibroadcast.js):
 *   - the server: an album not iBroadcast's refused, nothing asked of iBroadcast; two of iBroadcast's three deleted:
 *     their tracks moved to iBroadcast's trash, then the trash emptied of them, and the library read again without them,
 *     the third kept; the trash not emptied (iBroadcast refusing) said, the album gone all the same;
 *   - the page (where a browser is found): Delete from iBroadcast offered only where every album picked is iBroadcast's;
 *     No to the first question, or Yes then No to "Are you sure?": nothing deleted, the selection let go (the library as
 *     it was); Yes to both: deleted, said, gone from the wall.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { FakeIBroadcast } = require("./fake-ibroadcast");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");
const { Browser, findBrowser } = require("./browser-harness");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await sleep(100);
  }
}
const T = (id, title, track) => ({ id, title, track, type: "audio/flac" });

/* The page: [pick] albums picked on Home's Library row, Delete from iBroadcast tapped, [answers] given to the questions. */
const PAGE = (pick, answers) => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(50); } };
  const tile = o => document.querySelector('#home-library .album[data-offset="' + o + '"]');
  if (!await until(() => ${JSON.stringify(pick)}.every(o => tile(o)))) return { error: "no tiles" };
  const toast = document.getElementById("toast");
  toast.textContent = "";
  window.__enterAlbumSelectMode();
  for (const o of ${JSON.stringify(pick)}) tile(o).click();
  document.getElementById("select-menu-btn").click();
  const items = [...document.querySelectorAll("#select-menu [data-sel-act]")].map(e => e.dataset.selAct);
  const del = document.querySelector('#select-menu [data-sel-act="ibdelete"]');
  if (!del) return { items };
  del.click();
  const asked = [];
  for (const yes of ${JSON.stringify(answers)}) {
    const ov = document.getElementById("confirm-overlay");
    if (!await until(() => !ov.classList.contains("hidden"))) return { items, asked, error: "no question" };
    asked.push(document.getElementById("confirm-msg").textContent);
    document.getElementById(yes ? "confirm-yes" : "confirm-no").click();
    await until(() => ov.classList.contains("hidden"));
    await sleep(100);
  }
  const said = ${JSON.stringify(answers)}.every(Boolean) ? await until(() => toast.textContent) : "";
  await sleep(300);
  return { items, asked, said, selecting: !!document.querySelector(".album.is-selected") };
})()`;

test("item 527: iBroadcast's albums deleted at iBroadcast from the selection menu, asked twice", { skip, timeout: 240000 }, async (t) => {
  const lib = makeLibrary();
  const albums = () => [
    { id: 901, name: "First Gone", artist: { id: 90, name: "Deleter" }, year: 2001, tracks: [T(9011, "One", 1), T(9012, "Two", 2)] },
    { id: 902, name: "Second Gone", artist: { id: 90, name: "Deleter" }, year: 2002, tracks: [T(9021, "Three", 1)] },
    { id: 903, name: "Kept", artist: { id: 90, name: "Deleter" }, year: 2003, tracks: [T(9031, "Four", 1)] },
    { id: 904, name: "Page Gone", artist: { id: 91, name: "Paged" }, year: 2004, tracks: [T(9041, "Five", 1)] },
    { id: 905, name: "Trash Kept", artist: { id: 91, name: "Paged" }, year: 2005, tracks: [T(9051, "Six", 1)] }];
  const ib = await new FakeIBroadcast({ albums: albums() }).start();
  ib.slowOnce = false;
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    ibroadcastBaseUrl: ib.base, ibroadcastWatchMs: 100000000 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const call = async (method, p, body) => {
    const r = await fetch(base + "/api/" + p, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ http: r.status }, await r.json().catch(() => ({})));
  };
  await until(async () => (await call("GET", "status")).index_count >= 3, 60000, "the library");
  await call("POST", "settings/ibroadcast/signin");
  ib.approve();
  const db = ctx.db.raw;
  const offsetOf = id => (db.prepare("SELECT id FROM albums WHERE key = ?").get("ibroadcast:" + id) || {}).id;
  await until(() => [901, 902, 903, 904, 905].every(offsetOf), 30000, "iBroadcast's albums");
  const local = (await call("GET", "library/albums?count=200")).albums.find(a => a.title === "Album One").offset;
  const listed = async () => (await call("GET", "library/albums?count=200")).albums.map(a => a.title);

  await t.test("the server: one not iBroadcast's refused; two deleted at iBroadcast, the third kept", async () => {
    const r0 = await call("POST", "ibroadcast/delete-albums", { offsets: [offsetOf(903), local] });
    assert.equal(r0.http, 400, JSON.stringify(r0));
    assert.deepEqual(ib.deletes, [], "nothing asked of iBroadcast");

    const r = await call("POST", "ibroadcast/delete-albums", { offsets: [offsetOf(901), offsetOf(902)] });
    assert.equal(r.http, 200, JSON.stringify(r));
    assert.deepEqual([r.albums, r.tracks, r.emptied], [2, 3, true]);
    assert.deepEqual(ib.deletes, [{ mode: "trash", tracks: ["9011", "9012", "9021"] }, { mode: "empty_trash", tracks: ["9011", "9012", "9021"] }]);
    const titles = await until(async () => { const l = await listed(); return !l.includes("First Gone") && l; }, 20000, "the library without them");
    assert.ok(!titles.includes("Second Gone") && titles.includes("Kept"), JSON.stringify(titles));

    // iBroadcast keeping them in its trash: said, and gone from the library all the same (its trash isn't its library).
    ib.keepTrash = true;
    const kept = await call("POST", "ibroadcast/delete-albums", { offsets: [offsetOf(905)] });
    assert.equal(kept.emptied, false);
    assert.match(kept.note || "", /iBroadcast's trash/);
    await until(async () => !(await listed()).includes("Trash Kept"), 20000, "Trash Kept gone");
    ib.keepTrash = false;
  });

  await t.test("the page: No, or Yes then No, lets go of the selection and deletes nothing; Yes twice deletes", { skip: !findBrowser() && "no browser" }, async () => {
    const b = await Browser.launch({ width: 390, height: 844 });
    try {
      const tab = await b.page(base + "/", { cookies: [{ name: "musicd_session", value: token, url: base }] });
      const kept = offsetOf(903), gone = offsetOf(904);
      const mixed = await tab.eval(PAGE([kept, local], []));
      assert.ok(!mixed.items.includes("ibdelete"), "not offered with an album of your own files picked: " + JSON.stringify(mixed.items));
      await tab.eval("window.__exitAlbumSelectMode ? window.__exitAlbumSelectMode() : document.querySelector('#select-menu [data-sel-act=\"clear\"]')?.click()");
      const before = ib.deletes.length;

      const no = await tab.eval(PAGE([kept, gone], [false]));
      assert.ok(no.items.includes("ibdelete"), JSON.stringify(no));
      assert.match(no.asked[0], /^Delete these 2 albums from iBroadcast\?/);
      assert.equal(no.selecting, false, "No: the selection let go");
      const yesNo = await tab.eval(PAGE([gone], [true, false]));
      assert.deepEqual(yesNo.asked.map(q => q.split("?")[0]), ["Delete this album from iBroadcast", "Are you sure"]);
      assert.equal(yesNo.selecting, false, "Yes then No: the selection let go");
      assert.equal(ib.deletes.length, before, "nothing deleted");

      const yes = await tab.eval(PAGE([gone], [true, true]));
      assert.match(yes.said, /Deleted 1 album from iBroadcast/);
      assert.equal(yes.selecting, false);
      assert.deepEqual(ib.deletes.slice(before).map(d => d.mode), ["trash", "empty_trash"]);
      await until(async () => !(await listed()).includes("Page Gone"), 20000, "Page Gone gone");
      assert.deepEqual(tab.errors, []);
    } finally { await b.close(); }
  });
});
