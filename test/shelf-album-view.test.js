"use strict";
/*
 * The Shelf's album view and its slimmer bar (item 206, Rouen v1.9.67-t5 to v1.9.68), in a real browser against the
 * real server and a fake Sonos household: the bar one row with the count, the order and Spin; the case in front
 * turned over opens the album view over the screen above the bar, Play now and Queue under the cover, then the
 * review and More by; a tile of More by turns the shelf to that album. Skipped where no Chromium or Chrome is found.
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

    await t.test("the album view (item 206, Rouen v1.9.67-t5 and v1.9.68): the case in front opens it over the screen above the bar; Play now and Queue under the cover, then the review and More by; a tile opens that album; × closes", async () => {
      const list = (await (await fetch(B + "/api/shelf/albums", { headers: H })).json()).albums;
      const best = list.find(a => a.t === "Best Of"), kob = list.find(a => a.t === "Kind of Blue");   // Best Of: not a Jazz album, so not on the shelf
      const page = await open();
      const r = await page.eval(`(async () => { ${HELPERS} ${ready} ${DRIVE}
        const out = {};
        window.__fake["/api/album/extras"] = { album: { description: "Modal and unhurried.", source: "Wikipedia", url: "https://example.org/kob" } };
        window.__fake["/api/album/more"] = { artist: "Miles Davis", by: [{ offset: ${best.o}, title: "Best Of", subtitle: "Various Artists", image_key: ${JSON.stringify(best.k)} },
          { offset: 999999, title: "Not Here", subtitle: "Miles Davis", image_key: null }] };
        $('.tab[data-tab="genre"]').click(); tile("genre", "Jazz").click();
        await until(() => S().N === 3 && S().mode === "idle"); await rest();
        while (S().title !== "Kind of Blue") { stage.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await rest(); }
        out.before = viewOpen();
        await turnOver();
        await until(() => document.querySelector("#open .ov-review"), 4000);
        const box = (s) => $(s).getBoundingClientRect(), o = box("#open"), bar = box("#mt");
        out.over = { top: Math.round(o.top), bottom: Math.round(o.bottom - bar.top), width: Math.round(o.width - innerWidth) };
        out.head = { title: $("#open .ov-title").textContent, sub: $("#open .ov-sub").textContent, line: $("#open .ov-line") && $("#open .ov-line").textContent };
        out.tracks = rows();
        out.under = $("#actions").closest(".ov-side") !== null && box("#actions").top >= box("#open .ov-art").bottom - 1;
        out.acts = [...document.querySelectorAll("#open [data-act]")].map(b => b.dataset.act);
        out.review = { text: $("#open .ov-text").textContent, link: $("#open .ov-src").textContent, href: $("#open .ov-src").href };
        out.more = { label: $("#open .ov-more .ov-label").textContent, tiles: [...document.querySelectorAll("#open .ov-tile .ov-tile-t")].map(e => e.textContent) };
        out.order = ["#actions", "#open .ov-review", "#open .ov-more"].map(s => Math.round(box(s).top)).every((y, i, a) => i === 0 || y >= a[i - 1]);
        // Play now from under the cover
        $('#open [data-act="play_now"]').click();
        await until(() => posts("/api/play").length);
        out.play = posts("/api/play")[0];
        await until(() => /^Playing /.test($("#toast").textContent), 4000);
        // A tile of one the shelf doesn't hold (the choices leave it off): said, nothing moves
        document.querySelectorAll("#open .ov-tile")[0].click(); await sleep(50);
        out.notHere = $("#toast").textContent; out.still = S().title;
        // The choices changing close it
        tile("genre", "Jazz").click();
        out.closedByChoice = await until(() => !viewOpen(), 3000);
        return out; })()`);
      assert.equal(r.before, false, "closed until the case is turned over");
      assert.deepEqual(r.over, { top: 0, bottom: 0, width: 0 }, "the whole screen above the bar");
      assert.deepEqual(r.head, { title: "Kind of Blue", sub: "Miles Davis", line: "1959" });
      assert.deepEqual(r.tracks, ["1 Kind of Blue one"]);
      assert.equal(r.under, true, "Play now and Queue under the cover");
      assert.deepEqual(r.acts, ["play_now", "queue"]);
      assert.deepEqual(r.review, { text: "Modal and unhurried.", link: "View on Wikipedia", href: "https://example.org/kob" });
      assert.deepEqual(r.more, { label: "More by Miles Davis", tiles: ["Best Of", "Not Here"] });
      assert.equal(r.order, true, "the buttons, then the review, then More by");
      assert.equal(r.play.offset, kob.o, "the album in the view");
      assert.equal(r.play.kind, "play_now");
      assert.equal(r.notHere, "That album isn’t on this shelf — clear the choices to find it");
      assert.equal(r.still, "Kind of Blue");
      assert.equal(r.closedByChoice, true, "the choices changing close it");
      assert.deepEqual(page.errors, []);
    });

    await t.test("More by: a tap on an album the shelf holds turns the shelf to it and opens it", async () => {
      const list = (await (await fetch(B + "/api/shelf/albums", { headers: H })).json()).albums;
      const pastel = list.find(a => a.t === "Pastel Blues");
      const page = await open();
      const r = await page.eval(`(async () => { ${HELPERS} ${ready} ${DRIVE}
        window.__fake["/api/album/more"] = { artist: "Someone", by: [{ offset: ${pastel.o}, title: "Pastel Blues", subtitle: "Nina Simone", image_key: null }] };
        await rest(); await turnOver(); await until(() => document.querySelector("#open .ov-tile"), 4000);
        const was = S().title;
        document.querySelector("#open .ov-tile").click();
        await until(() => S().title === "Pastel Blues" && $("#open .ov-title").textContent === "Pastel Blues", 4000);
        return { was, now: S().title, view: viewOpen(), shown: $("#open .ov-title").textContent, flipped: S().flipped === Math.round(S().p) }; })()`);
      assert.notEqual(r.was, "Pastel Blues");
      assert.deepEqual([r.now, r.view, r.shown, r.flipped], ["Pastel Blues", true, "Pastel Blues", true]);
      assert.deepEqual(page.errors, []);
    });

  } finally {
    await b.close();
    await srv.stop();
    await house.stop();
  }
});
