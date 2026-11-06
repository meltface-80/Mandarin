"use strict";
/*
 * A renderer's Player, on the page (item 306, app/device-player.js): where its own player (MPD) was found beside it,
 * UPnP or its own player, the one in use marked, the note saying where MPD was found when it is played through; the
 * Gapless group dimmed then, MPD playing one track into the next itself. The app's words are DevicePage.kt's
 * (DevicePlayerTest). Skipped where no Chromium or Chrome is found (test/browser-harness.js).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { createServer, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

test("a renderer's Player: UPnP or its own player, its note, Gapless dimmed through its own player", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const b = await Browser.launch({ width: 390, height: 844 });
    let r;
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      r = await page.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < 160 && typeof playerGroup !== "function"; i++) await sleep(50);
        const d = { mpd: "192.168.0.33:6600" };
        const look = (o) => {
          body.innerHTML = playerGroup(d, o) + gaplessGroup(o);
          return {
            buttons: [...body.querySelectorAll('[data-seg="player"] .seg-btn')].map(e => [e.textContent, e.getAttribute("data-seg-v"), e.classList.contains("is-on")]),
            note: body.querySelector(".settings-note").textContent,
            dim: body.querySelectorAll(".cap-group")[1].classList.contains("is-dim")
          };
        };
        return { upnp: look({ mode: "x2" }), own: look({ mode: "x2", player: "mpd" }) };
      })()`);
    } finally { await b.close(); }
    assert.deepEqual(r.upnp.buttons, [["UPnP", "upnp", true], ["Its own player", "mpd", false]]);
    assert.match(r.upnp.note, /^Each track is handed over by UPnP/);
    assert.equal(r.upnp.dim, false, "Gapless as it was through UPnP");
    assert.deepEqual(r.own.buttons.map(x => x[2]), [false, true]);
    assert.match(r.own.note, /MPD, found at 192\.168\.0\.33:6600/);
    assert.equal(r.own.dim, true, "Gapless dimmed: MPD plays one track into the next itself");
  } finally { await srv.stop(); }
});
