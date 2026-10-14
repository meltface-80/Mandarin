"use strict";
/*
 * The playing track's disc on an album page (v1.0.1, public/nowdisc.js),
 * against a fake Sonos room, phone-sized and desktop: on the playing track
 * alone, between its number and its name and centred in the room between
 * them, inside the row's lines, the names where they were; turning while the
 * room plays, still when it pauses; on the next track once it moves on.
 * Skipped where no Chromium or Chrome is found (test/browser-harness.js).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { createServer, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(100);
  }
}

// In the page: the album open, and what its disc is, where, and doing what.
const LOOK = (album, want) => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, what, ms = 30000) => { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error("not there in time: " + what); await sleep(50); } };
  if (!window.__currentAlbum) {
    await until(() => document.querySelector("#home-random .album, #home-today .album"), "Home's albums");
    window.__openAlbum(${JSON.stringify(album)}, { source: "home", filter: null });
  }
  await until(() => document.getElementById("modal-total").textContent && document.querySelectorAll("#modal-tracks li.t-row").length === 3, "the album's tracks");
  const rows = [...document.querySelectorAll("#modal-tracks li.t-row")];
  await until(() => { const d = document.querySelectorAll("#modal-tracks .now-disc"); return d.length === 1 && rows[${want.track}].contains(d[0]) && d[0].classList.contains("is-paused") === ${!!want.paused}; }, "the disc on track ${want.track + 1}");
  await new Promise(r => requestAnimationFrame(r));
  const li = rows[${want.track}], svg = li.querySelector(".now-disc svg"), title = li.querySelector(".t-title");
  const box = r => { const b = r.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
  // The number's last figure: its ::before measured as it is drawn.
  const cs = getComputedStyle(li, "::before"), pen = document.createElement("canvas").getContext("2d");
  pen.font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
  const numberEnd = li.getBoundingClientRect().left + parseFloat(getComputedStyle(li).paddingLeft) + pen.measureText(String(${want.track + 1})).width;
  const a = svg.getAnimations()[0];
  // The disc's own size, and its centre (a turning square's box grows and shrinks; its centre doesn't).
  const sb = box(svg), sz = parseFloat(getComputedStyle(svg).width);
  const disc = { w: sz, h: parseFloat(getComputedStyle(svg).height), l: (sb.l + sb.r) / 2 - sz / 2, r: (sb.l + sb.r) / 2 + sz / 2, t: (sb.t + sb.b) / 2 - sz / 2, b: (sb.t + sb.b) / 2 + sz / 2 };
  return { discs: document.querySelectorAll("#modal-tracks .now-disc").length, svg: disc, row: box(li), title: box(title), numberEnd,
    titles: rows.map(r => Math.round(r.querySelector(".t-title").getBoundingClientRect().left)),
    turning: !!a && a.playState === "running", animation: getComputedStyle(svg).animationName };
})()`;

test("an album page's playing track: a small turning disc between its number and its name", { skip, timeout: 180000 }, async () => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    const api = async (p, body) => (await fetch(B + "/api/" + p, body ? { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify(body) } : { headers: H })).json();
    await until(async () => (await api("status")).index_count === 3);
    const kitchen = await until(async () => (await api("zones")).zones.find(z => z.display_name === "Kitchen"));
    const cd = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");
    await api("play", { offset: cd.offset, zone_or_output_id: kitchen.zone_id, kind: "play_now" });
    const room = house.room("Kitchen");
    await until(() => room.queue.length === 3 && room.state === "PLAYING");

    for (const size of [{ width: 390, height: 844 }, { width: 1440, height: 900, mouse: true }]) {
      const b = await Browser.launch(size);
      try {
        const page0 = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
        await page0.eval(`localStorage.setItem("rra-zone", ${JSON.stringify(kitchen.zone_id)}); true`);
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
        await api("control", { zone_or_output_id: kitchen.zone_id, command: "play" });
        let r = await page.eval(LOOK(cd, { track: 0 }));
        const where = JSON.stringify({ size, r });
        assert.equal(r.discs, 1, "one disc, on the playing track: " + where);
        assert.equal(r.animation, "now-disc-turn");
        assert.ok(r.turning, "turning while the room plays: " + where);
        // Between the number and the name, in the middle of the room between them.
        assert.ok(r.svg.l > r.numberEnd && r.svg.r < r.title.l, "between the number and the name: " + where);
        assert.ok(Math.abs((r.svg.l - r.numberEnd) - (r.title.l - r.svg.r)) <= 1.5, "centred between them: " + where);
        // Small, and inside the row's lines.
        assert.ok(r.svg.w <= 16 && r.svg.h <= 16, "not too big: " + where);
        assert.ok(r.svg.t > r.row.t && r.svg.b < r.row.b, "inside the row's lines: " + where);
        assert.equal(new Set(r.titles).size, 1, "the names where they were, the playing one too: " + where);

        // Paused: the disc stays, still. Played again: it turns.
        await api("control", { zone_or_output_id: kitchen.zone_id, command: "pause" });
        r = await page.eval(LOOK(cd, { track: 0, paused: true }));
        assert.equal(r.turning, false, "still when paused");
        await api("control", { zone_or_output_id: kitchen.zone_id, command: "play" });
        r = await page.eval(LOOK(cd, { track: 0 }));
        assert.ok(r.turning, "turning again");

        // Next: the disc moves to Song 2.
        await api("control", { zone_or_output_id: kitchen.zone_id, command: "next" });
        r = await page.eval(LOOK(cd, { track: 1 }));
        assert.equal(r.discs, 1);
        assert.ok(Math.abs((r.svg.l - r.numberEnd) - (r.title.l - r.svg.r)) <= 1.5, "centred on its row too");
        await api("control", { zone_or_output_id: kitchen.zone_id, command: "previous" });
        assert.deepEqual(page.errors, []);
      } finally { await b.close(); }
    }
  } finally { await srv.stop(); await house.stop(); }
});
