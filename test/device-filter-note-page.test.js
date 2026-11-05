"use strict";
/*
 * A device's Filter, on the page (items 254, 259, 298): two rows, CD-rate sources and hi-res sources, each opening the
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

test("a device's Filter: two rows, each opening the list, a pick a PATCH of its row; the notes said once", { skip, timeout: 120000 }, async () => {
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
        for (let i = 0; i < 160 && typeof filterGroup !== "function"; i++) await sleep(50);
        const making = "Made as it plays: this server made the last at 1.4× real time, fast enough to keep up.";
        const out = {
          sr11: filterNotes({ mode: "max", filter: "gaussian", filter_hires: "gaussian-hires", dsd_out: 256, making }),
          pcm: filterNotes({ mode: "max", filter: "gaussian", making }),
          hiresOnly: filterNotes({ mode: "max", filter: "standard", filter_hires: "minphase", making })[1],
          sox: filterNotes({ mode: "max", filter: "standard", filter_hires: "standard", making })[1],
          values: DEVICE_FILTERS.map(f => f[0]),
          left: filterName("whole")
        };
        // The rows of a device on Gaussian for CD rates, none set for hi-res, and their list, over the device's page.
        const sent = [];
        patch = (b) => { sent.push(b); return Promise.resolve(); };
        current = { id: "test", output: { mode: "max", filter: "gaussian" } };
        body.innerHTML = filterGroup(current.output);
        // A tap of the Filter's stops at the device's page: its list gone from the page by then, a listener further up
        // (Search's, closing the results behind Settings) would take it for a tap outside Settings.
        let reached = 0;
        const up = () => { reached++; };
        document.addEventListener("click", up);
        out.rows = [...body.querySelectorAll(".filter-row")].map(e => [e.getAttribute("aria-label"), e.querySelector(".filter-row-value").textContent]);
        body.querySelector('[data-filter-row="filter_hires"]').click();
        const sheet = document.getElementById("filter-sheet");
        out.title = sheet && sheet.querySelector(".filter-sheet-title").textContent;
        out.choices = sheet ? [...sheet.querySelectorAll(".filter-choice")].map(e => e.getAttribute("aria-label")) : null;
        out.on = sheet ? [...sheet.querySelectorAll(".filter-choice.is-on")].map(e => e.getAttribute("data-filter-pick")) : null;
        sheet.querySelector('[data-filter-pick="gaussian-hires"]').click();
        out.afterPick = !!document.getElementById("filter-sheet");
        body.querySelector('[data-filter-row="filter"]').click();
        out.cdOn = [...document.querySelectorAll("#filter-sheet .filter-choice.is-on")].map(e => e.getAttribute("data-filter-pick"));
        out.cdCount = document.querySelectorAll("#filter-sheet .filter-choice").length;
        document.querySelector("#filter-sheet [data-filter-close]").click();
        out.afterClose = !!document.getElementById("filter-sheet");
        document.removeEventListener("click", up);
        out.reached = reached;
        out.sent = sent;
        return out;
      })()`);
    } finally { await b.close(); }
    assert.deepEqual(r.sr11, ["With PCM as DSD256 on, these are the filters each track is upsampled with on its way to DSD256: by its own rate, the first or the second.", null]);
    assert.deepEqual(r.pcm, ["Each track is upsampled in the filter for its own rate: 44.1 and 48 kHz in the first, 88.2 kHz and up in the second.",
      "Made as it plays: this server made the last at 1.4× real time, fast enough to keep up."]);
    assert.ok(r.hiresOnly, "a filter of Mandarin's own for hi-res sources: how fast it is made said");
    assert.equal(r.sox, null, "SoX's filter for both: nothing of Mandarin's own made");
    assert.deepEqual(r.values, ["standard", "minphase", "gentle", "gaussian", "gaussian-steep", "gaussian-hires"]);
    assert.equal(r.left, "Standard", "a device left at a filter gone is said as the standard one");
    assert.deepEqual(r.rows, [["CD-rate sources", "Gaussian"], ["Hi-res sources", "Same as CD-rate"]]);
    assert.equal(r.title, "Filter for hi-res sources");
    assert.deepEqual(r.choices, ["Same as CD-rate sources", "Standard", "Minimum phase", "Gentle", "Gaussian", "Gaussian steep", "Gaussian hi-res"]);
    assert.deepEqual(r.on, ["same"]);
    assert.equal(r.afterPick, false, "a pick closes the list");
    assert.deepEqual(r.cdOn, ["gaussian"]);
    assert.equal(r.cdCount, 6, "the CD-rate list has no Same");
    assert.equal(r.afterClose, false, "a tap beside the list closes it");
    assert.equal(r.reached, 0, "no tap of the Filter's goes past the device's page");
    assert.deepEqual(r.sent, [{ output: { filter_hires: "gaussian-hires" } }], "the pick, and only the pick, sent");
  } finally { await srv.stop(); }
});
