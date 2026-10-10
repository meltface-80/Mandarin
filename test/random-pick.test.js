"use strict";
/*
 * Random Album chooses, then offers (from Rouen, MusicD Remote v1.9.3): the
 * disc turns, an album is chosen (GET /api/pick-unheard) and a popup offers
 * Play now, Play next and Queue (with its end-of-queue symbol). Nothing plays
 * until one is tapped; closing it plays nothing; one Escape closes only the
 * popup; on a phone held sideways the whole box is on screen.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert/strict");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KITCHEN = "RINCON_KITCHEN01400";

const INIT = `(() => {
  window.__log = [];
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (init && init.method === "POST") window.__log.push({ path: url.pathname, body: init.body ? JSON.parse(init.body) : null });
    return real(input, init);
  };
})();`;

const HELPERS = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const $ = s => document.querySelector(s);
  const ov = () => $("#random-pick-overlay");
  const open = () => !ov().classList.contains("hidden");
  const plays = () => window.__log.filter(x => x.path === "/api/play" || x.path === "/api/play-unheard");
  await until(() => document.querySelector("#home-unheard-tile") && [...document.querySelectorAll("#zone-select option")].some(o => o.value === "${KITCHEN}"));
  { const zs = $("#zone-select"); zs.value = "${KITCHEN}"; zs.dispatchEvent(new Event("change", { bubbles: true })); }
  const choose = async () => { $("#home-unheard-tile").click(); return until(open, 6000); };
`;

test("Random Album: chosen, then offered", { skip: (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)"), timeout: 150000 }, async (t) => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    for (let i = 0; i < 150; i++) {
      const st = await (await fetch(B + "/api/status", { headers: H })).json();
      if (st.index_count >= 3 && !st.scan.running && st.zone_count >= 2) break;
      await sleep(100);
    }
    const ids = (await (await fetch(B + "/api/library/albums?count=50", { headers: H })).json()).albums.map(a => a.offset);

    await t.test("the server chooses without playing", async () => {
      const j = await (await fetch(B + "/api/pick-unheard", { headers: H })).json();
      assert.ok(ids.includes(j.album.offset));
      assert.ok(j.album.title && j.album.image_key);
      assert.equal(house.room("Kitchen").state, "STOPPED");
    });

    const run = async (size, driver) => {
      const b = await Browser.launch(size);
      try {
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], init: INIT });
        const r = await page.eval(`(async () => { ${HELPERS} ${driver} })()`);
        r.errors = page.errors;
        return r;
      } finally { await b.close(); }
    };

    await t.test("nothing plays until a choice; Queue sends the album, says so and closes", async () => {
      const r = await run({ width: 1440, height: 900, mouse: true }, `
        const out = {};
        out.opened = await choose();
        out.playedBefore = plays().length;
        out.title = $("#random-pick-title").textContent; out.artist = $("#random-pick-artist").textContent;
        out.buttons = [...ov().querySelectorAll("[data-kind]")].map(b => [b.dataset.kind, b.textContent.trim()]);
        out.queueIcon = [...ov().querySelectorAll('[data-kind="queue"] svg path')].map(p => p.getAttribute("d"));
        out.focus = document.activeElement && document.activeElement.dataset.kind;
        ov().querySelector('[data-kind="queue"]').click();
        out.disabled = [...ov().querySelectorAll("[data-kind]")].every(b => b.disabled);
        await until(() => !open());
        out.play = plays();
        out.toast = $("#toast").textContent;
        // Closed by the ×, then by the backdrop: nothing more played.
        await choose(); $("#random-pick-close").click(); out.closedX = !open();
        await choose(); $("#random-pick-overlay .confirm-backdrop").click(); out.closedBackdrop = !open();
        await sleep(300);
        out.playsAfter = plays().length;
        return out;`);
      assert.equal(r.opened, true);
      assert.equal(r.playedBefore, 0, "nothing played before a choice");
      assert.ok(r.title);
      assert.deepEqual(r.buttons, [["play_now", "Play now"], ["play_next", "Play next"], ["queue", "Queue"]]);
      assert.deepEqual(r.queueIcon, ["M3 5h11M3 10h11M3 15h7", "M18 5v12", "M14.5 13.5L18 17l3.5-3.5", "M3 20h18"], "the end-of-queue symbol");
      assert.equal(r.focus, "play_now");
      assert.equal(r.disabled, true, "no second send while the first is out");
      assert.equal(r.play.length, 1);
      assert.equal(r.play[0].path, "/api/play");
      assert.equal(r.play[0].body.kind, "queue");
      assert.equal(r.play[0].body.zone_or_output_id, KITCHEN);
      assert.ok(ids.includes(r.play[0].body.offset));
      assert.equal(r.toast, "Queued: " + r.title);
      assert.equal(r.closedX, true);
      assert.equal(r.closedBackdrop, true);
      assert.equal(r.playsAfter, 1, "closing plays nothing");
      assert.deepEqual(r.errors, []);
    });

    await t.test("one Escape closes the popup and nothing under it", async () => {
      const r = await run({ width: 1440, height: 900, mouse: true }, `
        const albums = (await (await fetch("/api/library/albums?count=5")).json()).albums;
        window.__openAlbum(albums[0], {});
        await until(() => !$("#album-modal").classList.contains("hidden"));
        window.__playUnheard();
        await until(open, 6000);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(200);
        return { popup: open(), album: !$("#album-modal").classList.contains("hidden"), plays: plays().length };`);
      assert.equal(r.popup, false);
      assert.equal(r.album, true, "the album view under it stays open");
      assert.equal(r.plays, 0);
    });

    await t.test("Play now plays it in the zone", async () => {
      const r = await run({ width: 1440, height: 900, mouse: true }, `
        await choose();
        ov().querySelector('[data-kind="play_now"]').click();
        await until(() => !open());
        return { play: plays(), toast: $("#toast").textContent, title: $("#random-pick-title").textContent };`);
      assert.deepEqual(r.play.map(p => p.body.kind), ["play_now"]);
      assert.match(r.toast, /^Playing: /);
      for (let i = 0; i < 50 && house.room("Kitchen").state !== "PLAYING"; i++) await sleep(100);
      assert.equal(house.room("Kitchen").state, "PLAYING");
    });

    await t.test("a phone held sideways: the whole box on screen, the choices in a row", async () => {
      const r = await run({ width: 844, height: 390 }, `
        await choose();
        await sleep(300);
        const b = $(".random-pick-box").getBoundingClientRect();
        const btns = [...ov().querySelectorAll("[data-kind]")].map(x => x.getBoundingClientRect());
        return { top: b.top, bottom: b.bottom, h: innerHeight, row: btns.every(x => Math.abs(x.top - btns[0].top) < 1) };`);
      assert.ok(r.top >= 0 && r.bottom <= r.h, "the box runs off the screen: " + JSON.stringify(r));
      assert.equal(r.row, true);
    });
  } finally {
    await srv.stop();
    await house.stop();
  }
});
