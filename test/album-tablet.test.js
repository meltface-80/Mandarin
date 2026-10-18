"use strict";
/*
 * The album view on a tablet (v0.7.8) and a phone, in a browser at iPad sizes
 * and a phone's, as the sleeve has it (bug list item 24): the cover a 160px
 * sleeve with the title and the artist line beside it, the buttons and the
 * tracks under both, the cover's glow behind the top:
 *   - every item of the ⋯ menu is on screen and can be tapped. The button row
 *     is near the top now, so the menu opens downwards, over the tracks (it
 *     opened upwards, and from 720px up it rose past the panel's top edge,
 *     where the panel clips it: reported from an iPad);
 *   - scrolled so the row is near the top, it still opens downwards;
 *   - from 720px up About this album sits beside the tracks;
 *   - on a phone one column, the review after the tracks.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const until = async (f, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(30); } };
  await until(() => document.querySelector("#home-view .album"));
  const al = (await (await fetch("/api/library/albums?sort=album")).json()).albums.find(a => a.title === "Album One");
  window.__openAlbum(al, {});
  // The album's details in (the button row is drawn again with them, then its tracks and total time), then a frame.
  await until(() => document.querySelector("#modal-actions .overflow-wrap .overflow-btn") && $("modal-tracks").querySelectorAll("li").length === 3 && $("modal-total").textContent);
  await new Promise(r => requestAnimationFrame(r));
  // Eleven tracks and a review, as the album in the report has (the fixture
  // has three tracks, and no review without the network).
  const ol = $("modal-tracks"), row = ol.querySelector("li");
  for (let i = 0; i < 8; i++) ol.appendChild(row.cloneNode(true));
  $("album-bio-section").classList.remove("hidden");
  // Expanded (Show more): long, and it must grow downwards from under the cover.
  $("album-bio-text").textContent = "Late Developers is the twelfth studio album by the Scottish indie pop band Belle and Sebastian. ".repeat(12);
  $("album-bio-text").dataset.clipped = "false";
  // Laid out, any transition of the section's done.
  await until(() => document.getAnimations().every(a => a.playState === "finished" || a.effect.getTiming().iterations === Infinity));
  await new Promise(r => requestAnimationFrame(r));
  const body = document.querySelector("#album-modal .modal-body");
  const box = el => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  const open = async () => {
    const btn = document.querySelector("#modal-actions .overflow-wrap .overflow-btn");
    btn.click();
    // The menu open and done moving, then a frame: each item is measured where it rests.
    const menu = await until(() => { const m = document.querySelector("#modal-actions .overflow-wrap .overflow-menu"); return m && m.getBoundingClientRect().height > 0 && m.getAnimations({ subtree: true }).every(a => a.playState === "finished") && m; });
    await new Promise(r => requestAnimationFrame(r));
    const items = [...menu.querySelectorAll(".sel-menu-item")];
    // Each item really the thing at its own centre: on screen, not clipped, not covered.
    const hit = items.map(b => { const x = b.getBoundingClientRect(); const e = document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2); return !!e && (e === b || b.contains(e)); });
    const r = { items: items.map(b => b.textContent), hit, menu: box(menu), down: menu.getBoundingClientRect().top >= btn.getBoundingClientRect().bottom };
    btn.click(); await sleep(60);
    return r;
  };
  const out = {};
  body.scrollTop = 0; await new Promise(r => requestAnimationFrame(r));
  out.rest = await open();
  out.panel = box(document.querySelector("#album-modal .modal-panel"));
  out.share = box($("modal-share-btn"));
  out.art = box(document.querySelector("#album-modal .modal-art"));
  out.bio = box($("album-bio-section"));
  out.title = box($("modal-title"));
  out.tracks = box(document.querySelector(".track-list-wrap"));
  const glow = $("modal-ambient");
  out.glow = { shown: getComputedStyle(glow).display !== "none" && glow.getBoundingClientRect().height > 0, src: glow.getAttribute("src") || "" };
  out.hscroll = body.scrollWidth > body.clientWidth;
  out.viewport = [innerWidth, innerHeight];
  // The album's total time: on the Tracks line, centred under Play Now and Queue.
  const tot = $("modal-total"), btns = [...document.querySelectorAll("#modal-actions .action-btn")];
  const tb = tot.getBoundingClientRect();
  out.total = tot.textContent;
  out.totalMid = Math.round((tb.left + tb.right) / 2);
  out.buttonsMid = Math.round((btns[0].getBoundingClientRect().left + btns[btns.length - 1].getBoundingClientRect().right) / 2);
  out.totalOnTracksLine = Math.abs(tb.top - document.querySelector(".tracks-head").getBoundingClientRect().top) < 4;
  // Scrolled so the button row is near the top of the panel.
  const rowTop = $("modal-actions").getBoundingClientRect().top - body.getBoundingClientRect().top;
  body.scrollTop = Math.max(0, rowTop - 60); await new Promise(r => requestAnimationFrame(r));
  out.scrolledBy = body.scrollTop;
  out.scrolled = await open();
  return out;
})()`;

test("the album view on a tablet and a phone: a 160px sleeve, the title beside it, the whole ⋯ menu on screen", { skip, timeout: 180000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    for (let i = 0; i < 100; i++) { const st = await (await fetch(B + "/api/status", { headers: { Authorization: "Bearer " + token } })).json(); if (st.index_count === 3) break; await new Promise(r => setTimeout(r, 100)); }
    for (const [w, h, tablet] of [[1180, 820, true], [820, 1180, true], [390, 844, false]]) {
      const size = `${w}x${h}`;
      const b = await Browser.launch({ width: w, height: h });
      let r;
      try {
        // A touch screen, as a tablet or a phone is.
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true });
        r = await page.eval(DRIVER);
        assert.deepEqual(page.errors, [], size);
      } finally { await b.close(); }
      assert.ok(r.rest.items.length >= 4, size + ": the menu has its items: " + r.rest.items.join(", "));
      // Add to playlist (v0.8.34): straight after Listen later.
      assert.equal(r.rest.items[r.rest.items.indexOf("Listen later") + 1], "Add to playlist", size + ": Add to playlist under Listen later: " + r.rest.items.join(", "));
      assert.ok(r.rest.hit.every(Boolean), `${size}: every item can be tapped (${r.rest.items.map((t, i) => (r.rest.hit[i] ? "✓ " : "✗ ") + t).join(", ")})`);
      assert.ok(r.rest.menu.t >= r.panel.t, `${size}: the menu's top (${r.rest.menu.t}) is inside the panel (${r.panel.t})`);
      assert.equal(r.rest.down, true, size + ": at rest it opens downwards, the row near the top");
      assert.ok(r.rest.menu.t >= r.share.b, `${size}: the menu (${r.rest.menu.t}) stays clear of Share (${r.share.b})`);
      // The sleeve: 160px, the title and the artist line beside it, the tracks under it.
      assert.ok(Math.abs(r.art.r - r.art.l - 160) < 1, `${size}: the cover a 160px sleeve (${r.art.r - r.art.l})`);
      assert.ok(r.title.l > r.art.r && r.title.t < r.art.b, `${size}: the title beside the sleeve (title ${JSON.stringify(r.title)}, art ${JSON.stringify(r.art)})`);
      assert.ok(r.tracks.t > r.art.b, `${size}: the tracks under the sleeve (${r.tracks.t}, sleeve ends ${r.art.b})`);
      assert.ok(r.glow.shown && /size=96/.test(r.glow.src), `${size}: the cover's glow behind the top (${JSON.stringify(r.glow)})`);
      assert.equal(r.hscroll, false, size + ": no sideways scroll");
      assert.match(r.total, /^\d+:\d\d$/, size + ": the album's total time is shown: " + r.total);
      assert.ok(Math.abs(r.totalMid - r.buttonsMid) <= 1, `${size}: centred under Play Now and Queue (${r.totalMid} vs ${r.buttonsMid})`);
      assert.ok(r.totalOnTracksLine, size + ": on the Tracks line");
      assert.ok(r.panel.l <= 0 && r.panel.t <= 0 && r.panel.r >= r.viewport[0] && r.panel.b >= r.viewport[1], `${size}: the album view fills the screen, not a card (${JSON.stringify(r.panel)})`);
      if (tablet) {
        assert.ok(r.bio.l >= r.tracks.r && r.bio.t < r.tracks.b, `${size}: About this album beside the tracks (tracks ${JSON.stringify(r.tracks)}, review ${JSON.stringify(r.bio)})`);
        // Landscape is too short for eleven tracks, so it scrolls; portrait holds them all.
        if (w > h) assert.ok(r.scrolledBy > 0, size + ": the page scrolls (eleven tracks)");
        if (r.scrolledBy > 0) {
          assert.ok(r.scrolled.hit.every(Boolean), `${size}: scrolled, every item can still be tapped (${r.scrolled.hit.join(",")})`);
          assert.equal(r.scrolled.down, true, size + ": scrolled with no room above, it opens downwards");
        }
      } else {
        assert.ok(r.bio.t > r.tracks.b, "a phone: the review after the tracks, as before");
      }
    }
  } finally { await srv.stop(); }
});

test("the album's ⋯ → Add to playlist: the whole album into a playlist you choose", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    const api = (p, body) => fetch(B + "/api/" + p, body ? { method: "POST", headers: H, body: JSON.stringify(body) } : { headers: H }).then(r => r.json());
    for (let i = 0; i < 100; i++) { if ((await api("status")).index_count === 3) break; await new Promise(r => setTimeout(r, 100)); }
    const albums = (await api("library/albums?sort=album")).albums;
    const hi = albums.find(a => a.title === "Hi Res");
    // A playlist to add to: Mix, one track to begin with.
    await api("user-playlists/add-albums", { name: "Mix", albums: [{ offset: hi.offset }] });
    const before = (await api("user-playlists")).playlists.find(p => p.name === "Mix").track_total;
    const b = await Browser.launch({ width: 1180, height: 820 });
    let r;
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true });
      r = await page.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const until = async (f, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(30); } };
        await until(() => document.querySelector("#home-view .album"));
        const al = (await (await fetch("/api/library/albums?sort=album")).json()).albums.find(a => a.title === "Album One");
        window.__openAlbum(al, {});
        // The album's details in: the button row is drawn again with them.
        await until(() => document.querySelector("#modal-actions .overflow-wrap .overflow-btn") && document.getElementById("modal-total").textContent);
        document.querySelector("#modal-actions .overflow-wrap .overflow-btn").click();
        const item = await until(() => [...document.querySelectorAll("#modal-actions .overflow-menu .sel-menu-item")].find(x => x.textContent === "Add to playlist"), 5000);
        if (!item) return { item: false };
        item.click();
        const row = await until(() => [...document.querySelectorAll(".sheet-row")].find(x => x.textContent.startsWith("Mix ·")));
        if (row) row.click();
        return { item: true, row: !!row };
      })()`);
      // Added once the page's request is answered (the page kept open until then).
      for (let i = 0; i < 100 && (await api("user-playlists")).playlists.find(p => p.name === "Mix").track_total === before; i++) await new Promise(res => setTimeout(res, 100));
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
    assert.equal(r.item, true, "Add to playlist in the menu");
    assert.equal(r.row, true, "the sheet lists your playlists");
    const after = (await api("user-playlists")).playlists.find(p => p.name === "Mix").track_total;
    assert.equal(after, before + 3, "Album One's three tracks added to Mix");
  } finally { await srv.stop(); }
});
