"use strict";
/*
 * The Shelf's album frame is light (audit W-M2): the frame (/?embed=album) is the page, but only its album view —
 * not Home, not the rooms read every 15 s, not the zone-state and library long-polls, not the update, notice or
 * settings checks. The frame is made once and only hidden, so all of it went on behind the shelf: 24 asks in 25 s.
 * Every ask the frame makes is written down as it is made; for 15 s after it is ready (its album opened, its room
 * changed by the Shelf, Play, then closed) none is for those, and the rooms are read at most once. Skipped where no
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

// After the kit's stand-in: every ask written down the moment it is made (not when answered: a long-poll is answered
// late), with when; and when the page said it was ready.
const ASKS = `(() => {
  window.__asks = [];
  const inner = window.fetch;
  window.fetch = function (input, init) {
    window.__asks.push({ at: Date.now(), path: new URL(typeof input === "string" ? input : input.url, location.href).pathname });
    return inner.apply(this, arguments);
  };
  window.addEventListener("musicd-ready", () => { window.__readyAt = Date.now(); });
})();`;

const BARRED = [/^\/api\/home/, /^\/api\/smart-picks/, /^\/api\/random-albums/, /^\/api\/library\//, /^\/api\/update\//, /^\/api\/zone-state/, /^\/api\/settings\//];

test("the Shelf's album frame asks only what its album needs", { skip: (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)"), timeout: 120000 }, async () => {
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
    await fetch(B + "/api/settings/shelf", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify({ enabled: true }) });
    for (let i = 0; i < 150; i++) {
      const st = await (await fetch(B + "/api/status", { headers: H })).json();
      if (st.index_count >= 10 && !st.scan.running && st.zone_count >= 2) break;
      await sleep(100);
    }
    const zones = (await (await fetch(B + "/api/zones", { headers: H })).json()).zones.map(z => z.zone_id);
    const page = await b.page(B + "/shelf", { cookies: [{ name: "musicd_session", value: token, url: B }], init: INIT + ASKS });
    const r = await page.eval(`(async () => { ${HELPERS} ${DRIVE}
      await until(() => window.__shelfState && window.__shelfState().N === 10 && document.getElementById("mt-zone").textContent === "Kitchen", 15000);
      await rest(); await turnOver();
      const out = { shelfZone: S().zone };
      const fw = fwin();
      out.ready = !!fw.__readyAt;
      // The Shelf's room changed with the album open: the frame's too, and Play plays there.
      const other = ${JSON.stringify(zones)}.find(z => z !== S().zone);
      fw.postMessage({ type: "musicd-zone", zone: other }, location.origin);
      out.zoneMoved = await until(() => $f("#zone-select").value === other, 4000);
      $f('[data-parity="album.play-now"]').click();
      await until(() => fposts("/api/play").length, 6000);
      out.played = (fposts("/api/play")[0] || {}).zone_or_output_id === other;
      // Closed: the frame kept, hidden, behind the shelf.
      $f("#modal-close-btn").click();
      await until(() => !viewOpen(), 4000);
      await until(() => Date.now() > fw.__readyAt + 15000, 20000);
      const seen = fw.__asks.filter(a => a.at <= fw.__readyAt + 15000).map(a => a.path);
      out.barred = seen.filter(p => ${"[" + BARRED.map(String).join(",") + "]"}.some(re => re.test(p)));
      out.zones = seen.filter(p => p === "/api/zones").length;
      out.seen = seen;
      out.errors = fw.__errors || [];
      return out; })()`);
    assert.equal(r.ready, true, "the frame said it was ready");
    assert.equal(r.zoneMoved, true, "the Shelf's room, sent after the album opened, is the frame's");
    assert.equal(r.played, true, "Play plays in the room the Shelf sent: " + JSON.stringify(r.seen));
    assert.deepEqual(r.barred, [], "nothing the album view doesn't need, in 15 s: " + JSON.stringify(r.seen));
    assert.ok(r.zones <= 1, "the rooms read at most once: " + r.zones);
    assert.deepEqual(page.errors, []);
  } finally {
    await b.close();
    await srv.stop();
    await house.stop();
  }
});
