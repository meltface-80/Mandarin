"use strict";
/*
 * The Shelf's album view and its slimmer bar (item 206, Rouen v1.9.67-t5 to v1.9.68), in a real browser against the
 * real server and a fake Sonos household: the bar one row with the count, the order and Spin; the case in front
 * turned over opens the album view over the screen above the bar — since item 218 (the owner: the same screen as
 * the library's) the library's own album view, the page in a frame: three columns on a desktop and a tablet held
 * sideways, one on a tablet upright and a phone, every track with its time, its heart and ⋯, Play now in the
 * Shelf's room; its Back turns the case back; an artist it asks for opens as the whole page. Skipped where no
 * Chromium or Chrome is found.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { library, INIT, HELPERS, DRIVE } = require("./shelf-kit");

const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

test("Shelf's album view in a browser", { skip: (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)"), timeout: 180000 }, async (t) => {
  const lib = library();
  const house = new FakeHousehold();
  await house.start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)], upnpMulticast: false, identify: false });
  await srv.start();
  const b = await Browser.launch({ width: 1440, height: 900, mouse: true });
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    await fetch(B + "/api/settings/shelf", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify({ enabled: true }) });   // a new install: Shelf off until switched on (v1.0.2)
    for (let i = 0; i < 150; i++) {
      const st = await (await fetch(B + "/api/status", { headers: H })).json();
      if (st.index_count >= 10 && !st.scan.running && st.zone_count >= 2) break;
      await sleep(100);
    }
    const open = (url = "/shelf") => b.page(B + url, { cookies: [{ name: "musicd_session", value: token, url: B }], init: INIT });
    const ready = `await until(() => window.__shelfState && window.__shelfState().N === 10 && document.getElementById("mt-zone").textContent === "Kitchen", 15000);`;

    await t.test("the bar, slimmer (item 206, Rouen v1.9.68): one row, the count, the order and Spin in it; no album buttons in it", async () => {
      const page = await open();
      const r = await page.eval(`(async () => { ${HELPERS} ${ready}
        const box = (s) => $(s).getBoundingClientRect();
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
        const mid = (s) => (box(s).top + box(s).bottom) / 2;
        return {
          height: box("#mt").height / rem,
          inBar: ["#shelf-pos", "#shelf-order", "#spin-btn"].map(s => $("#mt").contains($(s))),
          oneRow: ["#mt-prev", "#mt-pp", "#mt-info", "#spin-btn", "#mt-zone-btn", "#mt-vol-btn"].every(s => Math.abs(mid(s) - mid("#mt-pp")) < box("#mt-pp").height / 2),
          order: box("#mt-info").right <= box("#spin-btn").left + 1 && box("#spin-btn").right <= box("#mt-zone-btn").left + 1,
          pos: $("#shelf-pos").textContent, orderName: $("#shelf-order").textContent,
          albumActs: $("#mt").contains($("#actions")), head: !!document.querySelector(".shelf-head, #looks"),
          look: window.__shelfState().look, spines: $("#stage").classList.contains("look-spines")
        }; })()`);
      assert.ok(r.height < 5, "under 5rem tall: " + r.height);
      assert.deepEqual(r.inBar, [true, true, true], "the count, the order and Spin are the bar's");
      assert.equal(r.oneRow, true, "one row on a wide screen");
      assert.equal(r.order, true, "what's playing, then the shelf's own, then the zone and volume");
      assert.match(r.pos, /^\d+ of 10$/);
      assert.equal(r.orderName, "A → Z by artist");
      assert.equal(r.albumActs, false, "the album's Play now and Queue are under its cover, in the album view");
      assert.equal(r.head, false, "no row over the shelf, no looks to choose");
      assert.deepEqual([r.look, r.spines], ["spines", true], "one look: the spines");
      assert.deepEqual(page.errors, []);
    });

    await t.test("the album view is the library's (item 218): over the screen above the bar, three columns, every track's time, its heart and ⋯; Play now plays in the Shelf's room; its Back turns the case back", async () => {
      const list = (await (await fetch(B + "/api/shelf/albums", { headers: H })).json()).albums;
      const kob = list.find(a => a.t === "Kind of Blue");
      const page = await open();
      const r = await page.eval(`(async () => { ${HELPERS} ${ready} ${DRIVE}
        const out = {};
        $('.tab[data-tab="genre"]').click(); tile("genre", "Jazz").click();
        out.jazz = await until(() => S().N === 3 && S().mode === "idle", 20000); await rest();
        // Stepped toward it by the shelf's own order (item 229): three albums don't wrap, and the shelf can come to rest
        // past it; stepping right only, the loop never ended and the browser was given up on after 90 s.
        for (let i = 0; i < 2 * S().N + 2 && S().title !== "Kind of Blue"; i++) {
          const order = window.__shelfOrder();
          const key = order.indexOf("Kind of Blue") < order.indexOf(S().title) ? "ArrowLeft" : "ArrowRight";
          stage.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); await rest();
        }
        out.at = S().title;
        out.before = viewOpen();
        await turnOver();
        const box = (el) => el.getBoundingClientRect(), o = box(ov), bar = box($("#mt")), f = box(ov.querySelector("iframe"));
        out.over = { top: Math.round(o.top), bottom: Math.round(o.bottom - bar.top), width: Math.round(o.width - innerWidth), frame: Math.round(f.width - o.width) + Math.round(f.height - o.height) };
        const m = $f("#album-modal");
        out.wide = m.classList.contains("album-wide");
        out.cols = [...fdoc().querySelectorAll(".aw-col")].map(c => c.className.replace("aw-col ", ""));
        out.title = $f("#modal-title").textContent;
        out.tracks = rows();
        out.buttons = ["album.favourite", "album.play-now", "album.queue", "album.more"].map(k => !!$f('[data-parity="' + k + '"]'));
        out.chrome = ["#mini-transport", "#touch-nav"].map(s => { const e = $f(s); return !!e && e.getClientRects().length > 0; }).concat(!!$f(".app") && $f(".app").getClientRects().length > 0);
        out.zone = S().zone;
        $f('[data-parity="album.play-now"]').click();
        await until(() => fposts("/api/play").length, 6000);
        out.play = fposts("/api/play")[0];
        // Its Back: the album closes, and the case with it.
        $f("#modal-close-btn").click();
        out.closed = await until(() => !viewOpen() && S().flipped === null, 4000);
        // Opened again: at once, the frame kept.
        const frameWas = ov.querySelector("iframe");
        await turnOver();
        out.again = ov.querySelector("iframe") === frameWas && $f("#modal-title").textContent === "Kind of Blue";
        // The choices changing close it.
        tile("genre", "Jazz").click();
        out.closedByChoice = await until(() => !viewOpen(), 3000);
        out.errors = fwin().__errors || [];
        return out; })()`);
      assert.equal(r.jazz, true, "the Jazz genre's three albums on the shelf");
      assert.equal(r.at, "Kind of Blue", "stepped to it");
      assert.equal(r.before, false, "closed until the case is turned over");
      assert.deepEqual(r.over, { top: 0, bottom: 0, width: 0, frame: 0 }, "the whole screen above the bar, the frame filling it");
      assert.equal(r.wide, true, "three columns on a desktop");
      assert.deepEqual(r.cols, ["aw-left", "aw-mid", "aw-right"]);
      assert.equal(r.title, "Kind of Blue");
      assert.equal(r.tracks.length, 1);
      assert.match(r.tracks[0], /^Kind of Blue one \d+:\d\d$/, "the track with its time: " + r.tracks[0]);
      assert.deepEqual(r.buttons, [true, true, true, true], "the heart, Play now, Queue and ⋯");
      assert.deepEqual(r.chrome, [false, false, false], "the page's mini player, its row and the rest of it out of sight");
      assert.equal(r.play.offset, kob.o, "the album in the view");
      assert.equal(r.play.zone_or_output_id, r.zone, "played in the Shelf's room");
      assert.equal(r.closed, true, "its Back turns the case back");
      assert.equal(r.again, true, "opened again in the same frame");
      assert.equal(r.closedByChoice, true, "the choices changing close it");
      assert.deepEqual(page.errors, []);
    });

    await t.test("an artist the album view asks for opens as the whole page, at that artist (item 218)", async () => {
      const page = await open();
      await page.eval(`(async () => { ${HELPERS} ${ready} ${DRIVE}
        await rest(); await turnOver();
        fwin().__showArtistAlbums("Miles Davis");
        return true; })()`);
      // The Shelf leaves for the page: what it evaluates next is the page's, once it has come.
      for (let i = 0; i < 100; i++) { await sleep(150); try { if (await page.eval("location.pathname === '/' && document.readyState === 'complete'")) break; } catch (e) { /* on its way */ } }
      const r = await page.eval(`(async () => { ${HELPERS}
        await until(() => location.pathname === "/" && window.__artistViewActive && window.__artistViewActive(), 15000);
        return { path: location.pathname + location.search, artist: window.__artistViewActive() }; })()`);
      assert.deepEqual(r, { path: "/", artist: true }, "the page, at the artist, its address put back");
      assert.deepEqual(page.errors, []);
    });

    await t.test("three columns on a tablet held sideways; one on a tablet upright and a phone, each track with its time (item 218)", async () => {
      for (const [w, h, wide] of [[1180, 820, true], [820, 1180, false], [412, 915, false]]) {
        const tb = await Browser.launch({ width: w, height: h, mouse: false });
        try {
          const page = await tb.page(B + "/shelf", { cookies: [{ name: "musicd_session", value: token, url: B }], init: INIT, touch: true });
          const r = await page.eval(`(async () => { ${HELPERS} ${ready} ${DRIVE}
            await rest(); await turnOver();
            return { wide: $f("#album-modal").classList.contains("album-wide"), cols: fdoc().querySelectorAll(".aw-col").length,
              timed: rows().every(t => / \\d+:\\d\\d$/.test(t)), n: rows().length }; })()`);
          assert.equal(r.wide, wide, `${w}x${h}: ${wide ? "three columns" : "one column"}`);
          assert.equal(r.cols, wide ? 3 : 0);
          assert.ok(r.n > 0 && r.timed, `${w}x${h}: every track with its time`);
          assert.deepEqual(page.errors, [], `${w}x${h}`);
        } finally { await tb.close(); }
      }
    });

  } finally {
    await b.close();
    await srv.stop();
    await house.stop();
  }
});
