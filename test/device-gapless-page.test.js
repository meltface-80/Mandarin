"use strict";
/*
 * A device's Gapless, on the page (item 300): Albums as one stream, its switch a PATCH of output.album_stream, its note
 * saying what it does on and off. The app's words are DevicePage.kt's (AudioDevicesTest). Skipped where no Chromium or
 * Chrome is found (test/browser-harness.js).
 *
 * (Header of the filter test, for its boilerplate:) A device's Filter, on the page (items 254, 259, 298): two rows, CD-rate sources and hi-res sources, each opening the
 * list of filters (the three Gaussian ones after Standard, Minimum phase and Gentle; the hi-res list led by the same as
 * CD-rate), the one in use ticked; a tap is a PATCH of that row's setting and the list closes, as a tap beside it does,
 * the tap going no further than the device's page.
 * With PCM as DSD on, the note says the filters are the DSD's, and how fast the server made the last track is said once,
 * under PCM as DSD; with PCM as PCM, under the rows where a filter of Mandarin's own is set. The app's words are
 * DeviceFilters.kt's (AudioDevicesTest). Skipped where no Chromium or Chrome is found (test/browser-harness.js).
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

test("a device's Gapless: the switch says on or off and sends album_stream", { skip, timeout: 120000 }, async () => {
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
        for (let i = 0; i < 160 && typeof gaplessGroup !== "function"; i++) await sleep(50);
        const sent = [];
        patch = (b) => { sent.push(b); return Promise.resolve(); };
        current = { id: "test", output: { mode: "max" } };
        body.innerHTML = gaplessGroup(current.output);
        const off = { checked: body.querySelector("[data-dev-albumstream]").checked, note: body.querySelector(".settings-note").textContent, label: body.querySelector("[data-dev-albumstream]").getAttribute("aria-label") };
        const box = body.querySelector("[data-dev-albumstream]");
        box.checked = true;
        box.dispatchEvent(new Event("change", { bubbles: true }));
        body.innerHTML = gaplessGroup({ mode: "max", album_stream: true });
        const on = { checked: body.querySelector("[data-dev-albumstream]").checked, note: body.querySelector(".settings-note").textContent };
        return { off, on, sent };
      })()`);
    } finally { await b.close(); }
    assert.equal(r.off.label, "Albums as one stream");
    assert.equal(r.off.checked, false);
    assert.match(r.off.note, /^Each track goes as a file of its own/);
    assert.deepEqual(r.sent, [{ output: { album_stream: true } }], "the switch sends album_stream");
    assert.equal(r.on.checked, true);
    assert.match(r.on.note, /^An album’s tracks go to this device as one stream/);
  } finally { await srv.stop(); }
});
