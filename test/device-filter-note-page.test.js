"use strict";
/*
 * A device's Filter, on the page (items 254, 259): with PCM as DSD on, its note says the filter is the one each track is
 * upsampled with on its way to DSD, and how fast the server made the last track is said once, under PCM as DSD, not
 * under the Filter too; with PCM as PCM, the filter's own note (made as it plays, no Whole track) and its speed under
 * it. The app's words are DevicePage.kt's (AudioDevicesTest). Skipped where no Chromium or Chrome is found
 * (test/browser-harness.js).
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

test("with PCM as DSD on, the Filter's note is the DSD's and how fast it is made is said once", { skip, timeout: 120000 }, async () => {
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
        const making = "Made as it plays: this server made the last at 1.4× real time, fast enough to keep up.";
        return {
          sr11: filterNotes({ mode: "max", filter: "minphase", dsd_out: 256, making }),
          linear: filterNotes({ mode: "original", filter: "standard", dsd_out: 64 })[0],
          pcm: filterNotes({ mode: "max", filter: "minphase", making }),
          left: filterNotes({ mode: "max", filter: "whole" })[0],
          buttons: typeof FILTER_NOTE === "object" ? Object.keys(FILTER_NOTE) : null
        };
      })()`);
    } finally { await b.close(); }
    assert.deepEqual(r.sr11, ["With PCM as DSD256 on, this is the filter each track is upsampled with on its way to DSD256: minimum phase, all its ringing after a sound starts.", null]);
    assert.match(r.linear, /on its way to DSD64: standard, linear phase\.$/);
    // PCM as PCM: the filter's own note, made as it plays, and its speed under it.
    assert.equal(r.pcm[0], "Minimum phase: all its ringing after a sound starts, none before. Mandarin’s own filter, made as it plays; tracks from the library, ×2 to ×16.");
    assert.equal(r.pcm[1], "Made as it plays: this server made the last at 1.4× real time, fast enough to keep up.");
    // Whole track is gone: three filters, and a device left at it said as the standard one.
    assert.deepEqual(r.buttons, ["standard", "minphase", "gentle"]);
    assert.equal(r.left, "SoX’s filter, made as it plays.");
  } finally { await srv.stop(); }
});
