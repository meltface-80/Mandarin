"use strict";
/*
 * A device's Filter with PCM as DSD on, on the page (item 254): its note says the filter is the one each track is made
 * DSD with and that a track playing before its DSD is made goes as PCM with the standard filter; how the making goes is
 * said once, under PCM as DSD, not under the Filter too. A FiiO SR11 at Max, Min phase and DSD256 on 3 November said
 * "a track not yet made plays with the standard filter" and its makings twice. The app's words are DevicePage.kt's
 * (AudioDevicesTest). Skipped where no Chromium or Chrome is found (test/browser-harness.js).
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

test("with PCM as DSD on, the Filter's note is the DSD's and its makings are said once", { skip, timeout: 120000 }, async () => {
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
        for (let i = 0; i < 160 && typeof filterNotes !== "function"; i++) await sleep(50);
        const whole = { made: 2, making: "03 - Drum Talk (Album Version)", waiting: 0 };
        return {
          sr11: filterNotes({ mode: "max", filter: "minphase", dsd_out: 256, whole }),
          linear: filterNotes({ mode: "original", filter: "standard", dsd_out: 64 })[0],
          pcm: filterNotes({ mode: "max", filter: "minphase", whole })
        };
      })()`);
    } finally { await b.close(); }
    assert.deepEqual(r.sr11, ["With PCM as DSD256 on, this is the filter each track is made DSD256 with: minimum phase, all its ringing after a sound starts. A track that plays before its DSD256 is made goes as PCM, with the standard filter.", null]);
    assert.match(r.linear, /made DSD64 with: one as long as the track, linear phase\./);
    // PCM as PCM: as before, the filter's own note and its makings under it.
    assert.match(r.pcm[0], /^Whole track’s filter made minimum phase/);
    assert.equal(r.pcm[1], "2 tracks made · making “03 - Drum Talk (Album Version)”");
  } finally { await srv.stop(); }
});
