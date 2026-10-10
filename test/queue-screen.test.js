"use strict";
/*
 * The Queue screen, quick (v0.8.35):
 *   - a Sonos room's queue is kept by the server: opened again, the speaker
 *     is asked for one track (whose answer says whether the queue changed)
 *     instead of the whole queue; a change made elsewhere (the Sonos app) is
 *     read; one made here is read again in the background, so the screen
 *     opens on it at once;
 *   - Play from here answers once the room has moved, so the queue asked for
 *     straight after has the track as "Now playing";
 *   - in a browser: tapping a track further down moves "Now playing" to it at
 *     once, before the speaker has answered, and the list is never emptied
 *     while the queue is asked for again.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(100);
  }
}

test("the Queue screen: the Sonos queue kept, Play from here at once", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpMulticast: false, identify: false });
  await srv.start();
  t.after(async () => { await srv.stop(); await house.stop(); });
  const token = await signIn(B);
  const api = async (p, body) => {
    const r = await fetch(B + "/api/" + p, { method: body ? "POST" : "GET", headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  await until(async () => (await api("status")).index_count === 3);
  const kitchen = (await until(async () => (await api("zones")).zones.find(z => z.display_name === "Kitchen"))).zone_id;
  const albums = (await api("library/albums?sort=album")).albums;
  const one = albums.find(a => a.title === "Album One"), hi = albums.find(a => a.title === "Hi Res");
  const room = house.room("Kitchen");
  const queue = () => api("queue?zone=" + encodeURIComponent(kitchen));
  const titles = (q) => q.items.map(i => i.title);
  // Album One, then Hi Res after it: five tracks, the first playing.
  const setUp = async () => {
    assert.equal((await api("play", { offset: one.offset, zone_or_output_id: kitchen, kind: "play_now" })).status, 200);
    assert.equal((await api("play", { offset: hi.offset, zone_or_output_id: kitchen, kind: "queue" })).status, 200);
    await until(() => room.queue.length === 5 && room.state === "PLAYING" && room.track === 1);
    await until(async () => (await queue()).items.length === 5);
  };
  await setUp();

  await t.test("opened again: the speaker asked for one track, not the whole queue", async () => {
    const first = await queue();
    // The room's readings since the queue was filled settled first.
    await sleep(1500);
    room.browses = 0; room.browsed = 0;
    const again = await queue();
    assert.deepEqual(titles(again), titles(first));
    assert.deepEqual(titles(again), ["Song 1", "Song 2", "Song 3", "Hi 1", "Hi 2"]);
    assert.deepEqual([room.browses, room.browsed], [1, 1], "one small question, one track in its answer");
  });

  await t.test("changed from the Sonos app: read again", async () => {
    room.queue.splice(4, 1);
    assert.deepEqual(titles(await queue()), ["Song 1", "Song 2", "Song 3", "Hi 1"]);
  });

  await t.test("added to here: read again in the background, so it opens on it at once", async () => {
    room.browses = 0; room.browsed = 0;
    assert.equal((await api("play", { offset: hi.offset, zone_or_output_id: kitchen, kind: "queue" })).status, 200);
    await until(() => room.queue.length === 6);
    // The room's next reading (once a second) sees the queue grow, and the server reads it then.
    await until(() => room.browsed >= 6, 5000);
    room.browses = 0; room.browsed = 0;
    const q = await queue();
    assert.deepEqual(titles(q), ["Song 1", "Song 2", "Song 3", "Hi 1", "Hi 1", "Hi 2"]);
    assert.deepEqual([room.browses, room.browsed], [1, 1], "already read: only asked whether it changed");
  });

  await t.test("Play from here: answered once the room has moved", async () => {
    assert.equal((await api("play-from-here", { zone_or_output_id: kitchen, queue_item_id: 3 })).status, 200);
    const q = await queue();
    assert.equal(q.items[0].queue_item_id, 3, "the track played from is Now playing straight away");
    assert.equal(q.items[0].title, "Song 3");
    assert.deepEqual(q.history.map(h => h.track), ["Song 2", "Song 1"]);
  });

  await t.test("in a browser: Now playing moves at once, and the list is never emptied", { skip: !findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)" }, async () => {
    await setUp();
    const b = await Browser.launch({ width: 390, height: 844 });
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true });
      const now = () => page.eval(`(document.querySelector("#queue-list li.is-now .q-title") || {}).textContent || null`);
      const opened = await page.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const until = async (f, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(30); } };
        await until(() => document.querySelector("#home-view .album"));
        const sel = document.getElementById("zone-select");
        await until(() => [...sel.options].some(o => o.value === ${JSON.stringify(kitchen)}));
        sel.value = ${JSON.stringify(kitchen)};
        sel.dispatchEvent(new Event("change"));
        const al = (await (await fetch("/api/library/albums?sort=album")).json()).albums.find(a => a.title === "Album One");
        window.__openAlbum(al, {});
        await until(() => document.querySelector('.modal-tab[data-tab="queue"]'));
        document.querySelector('.modal-tab[data-tab="queue"]').click();
        const rows = await until(() => document.querySelectorAll("#queue-list li.is-tappable").length >= 4);
        // From here on: was the list ever empty, or "Loading queue…" said?
        window.__blank = 0;
        const list = document.getElementById("queue-list"), summary = document.getElementById("queue-summary");
        new MutationObserver(() => {
          if (!list.querySelector("li.is-now") || /Loading/.test(summary.textContent)) window.__blank++;
        }).observe(document.getElementById("tab-queue"), { childList: true, subtree: true, characterData: true });
        return { rows: !!rows, now: (document.querySelector("#queue-list li.is-now .q-title") || {}).textContent };
      })()`);
      assert.deepEqual(opened, { rows: true, now: "Song 1" });
      // The speakers answer nothing until let go: whatever moves now, the page moved itself.
      house.hold();
      const tapped = await page.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const row = [...document.querySelectorAll("#queue-list li.is-tappable")].find(li => li.querySelector(".q-title").textContent === "Song 3");
        row.click();
        await sleep(100);
        document.getElementById("confirm-yes").click();
        await sleep(150);
        return (document.querySelector("#queue-list li.is-now .q-title") || {}).textContent;
      })()`);
      assert.equal(tapped, "Song 3", "Now playing moved before the speaker answered");
      house.release();
      await until(() => room.track === 3 && room.state === "PLAYING");
      await sleep(1500);
      assert.equal(await now(), "Song 3", "and stays, once the room's own queue has come back");
      assert.equal(await page.eval(`window.__blank`), 0, "the list was never emptied to wait");
      assert.deepEqual(page.errors, []);
    } finally { house.release(); await b.close(); }
  });
});
