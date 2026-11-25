"use strict";
/*
 * An album's page, even (item 539), at a phone's size and in the wide view: the title and the artists centred under the
 * sleeve; the row the heart, Play Now, Queue and ⋯, in that order, the heart and ⋯ the same size at its two ends. A Qobuz
 * album not among your Qobuz favourites has a + in the heart's place: a tap adds it there and the heart takes its place,
 * and ⋯ then says Remove from Qobuz favourites, and the note under the artists that it is a favourite (item 540: it went
 * on saying "Played from Qobuz — not in your favourites"). (Qobuz's side is stood in for in the page: its album page's answer, and
 * its favourite.) Skipped where no Chromium or Chrome is found.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

// "Album One" played as a Qobuz album not among the favourites there; adding it answers as Qobuz would.
const STUB = `(() => { const real = window.fetch.bind(window);
  window.__added = [];
  const ok = (j) => Promise.resolve(new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } }));
  window.fetch = async (u, o) => { const s = String(u);
    if (s.includes("/api/qobuz/favorite")) { window.__added.push(JSON.parse(o.body).album_id); return ok({ ok: true }); }
    const r = await real(u, o);
    if (!window.__asQobuz || !/\\/api\\/album\\?/.test(s)) return r;
    const j = await r.clone().json();
    if (j && j.album) Object.assign(j.album, { source: "qobuz", service_id: "q-1", service_favourite: false, service_why: { name: "Qobuz", kept: false } });
    return new Response(JSON.stringify(j), { status: r.status, headers: { "Content-Type": "application/json" } }); }; })();`;

const DRIVER = (album, qobuz) => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(40); } };
  window.__asQobuz = ${qobuz};
  await until(() => window.__openAlbum && document.querySelector("#home-view .album"));
  window.__openAlbum(${JSON.stringify(album)}, { source: "home" });
  const acts = await until(() => { const a = document.getElementById("modal-actions"); return a && a.querySelector(".action-btn") && a; });
  if (!acts) return { why: "no row" };
  const row = () => [...acts.children].map(e => e.getAttribute("data-parity") || (e.querySelector("[data-parity]") || {}).dataset?.parity || e.className);
  const box = e => e.getBoundingClientRect();
  const mid = e => { const b = box(e); return Math.round(b.left + b.width / 2); };
  const head = document.querySelector("#album-modal .modal-head") || document.querySelector(".modal-head");
  const title = document.getElementById("modal-title"), sub = document.querySelector("#album-modal .modal-subtitle") || document.querySelector(".modal-subtitle");
  const range = el => { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return Math.round(b.left + b.width / 2); };
  const out = { row: row(), headMid: mid(head), titleMid: range(title), subMid: range(sub),
    ends: [box(acts.firstElementChild).width, box(acts.lastElementChild.querySelector("button") || acts.lastElementChild).width].map(Math.round) };
  if (${qobuz}) {
    const add = acts.querySelector('[data-parity="album.service-add"]');
    out.addLabel = add && add.getAttribute("aria-label");
    out.noteBefore = (document.getElementById("modal-why-note") || {}).textContent;
    add.click();
    await until(() => acts.querySelector('[data-parity="album.favourite"]'));
    out.after = row();
    out.added = window.__added.slice();
    out.noteAfter = (document.getElementById("modal-why-note") || {}).textContent;
    acts.querySelector('[data-parity="album.more"]').click();
    const item = await until(() => acts.querySelector('[data-parity="album.service-favourite"]'));
    out.menu = item && item.textContent;
  }
  return out;
})()`;

test("an album's page, even: title and artists centred, the heart first and ⋯ last; a Qobuz album outside your favourites a +", { skip, timeout: 240000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const get = async p => (await fetch(B + p, { headers: { Authorization: "Bearer " + token } })).json();
    let albums = [];
    for (let i = 0; i < 200 && !albums.find(a => a.title === "Album One"); i++) { albums = (await get("/api/library/albums?sort=album&count=100")).albums || []; await new Promise(r => setTimeout(r, 100)); }
    const album = albums.find(a => a.title === "Album One");
    assert.ok(album, "Album One in the library");
    const ORDER = ["album.favourite", "album.play-now", "album.queue", "album.more"];
    for (const [w, h, touch] of [[390, 844, true], [1440, 900, false]]) {
      const b = await Browser.launch({ width: w, height: h, mouse: !touch });
      try {
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch, init: STUB });
        const o = await page.eval(DRIVER(album, false));
        const at = `${w}x${h}`;
        assert.ok(!o.why, at + ": " + o.why);
        assert.deepEqual(o.row, ORDER, at + ": the heart first, ⋯ last");
        assert.ok(Math.abs(o.titleMid - o.headMid) <= 2, `${at}: the title centred (${o.titleMid} in a head centred at ${o.headMid})`);
        assert.ok(Math.abs(o.subMid - o.headMid) <= 2, `${at}: the artists centred (${o.subMid} in a head centred at ${o.headMid})`);
        assert.equal(o.ends[0], o.ends[1], at + ": the heart and ⋯ the same size");
        const q = await (await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch, init: STUB })).eval(DRIVER(album, true));
        assert.deepEqual(q.row, ["album.service-add", ...ORDER.slice(1)], at + ": a Qobuz album outside your favourites, a + first");
        assert.equal(q.addLabel, "Add to Qobuz favourites");
        assert.deepEqual(q.added, ["q-1"], at + ": added to the Qobuz favourites");
        assert.deepEqual(q.after, ORDER, at + ": the heart in the +'s place");
        assert.equal(q.noteBefore, "Played from Qobuz — not in your favourites", at);
        assert.match(q.noteAfter || "", /^In your library as a Qobuz favourite since /, at + ": the note says it is one now");
        assert.equal(q.menu, "Remove from Qobuz favourites", at + ": ⋯ says it is one now");
      } finally { await b.close(); }
    }
  } finally { await srv.stop(); }
});
