"use strict";
/*
 * A device's Modulator, on the page (item 303, app/device-modulators.js): with PCM as DSD on, one row saying the
 * modulator in use at that DSD rate, opening the list of the three (7th order, 7th order wide, 9th order), the one in
 * use ticked; one not made at that rate greyed out and not to be picked, and a device set to it said as the 7th order,
 * which is what the server makes there. A pick is a PATCH of dsd_mod and the list closes, the tap going no further
 * than the device's page. The app's words are DeviceModulators.kt's (AudioDevicesTest).
 * Skipped where no Chromium or Chrome is found (test/browser-harness.js).
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

test("a device's Modulator: one row with PCM as DSD on, its list greying out what isn't made at that rate, a pick a PATCH", { skip, timeout: 120000 }, async () => {
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
        for (let i = 0; i < 160 && typeof modulatorGroup !== "function"; i++) await sleep(50);
        const sent = [];
        patch = (b) => { sent.push(b); return Promise.resolve(); };
        const value = (o) => { body.innerHTML = modulatorGroup(o); return body.querySelector(".filter-row-value").textContent; };
        const out = {
          values: DEVICE_MODS.map(m => m[0]),
          at64: value({ dsd_out: 64 }), wideAt64: value({ dsd_out: 64, dsd_mod: "7w" }), ninthAt256: value({ dsd_out: 256, dsd_mod: "9" }),
          wideAt256: value({ dsd_out: 256, dsd_mod: "7w" }), unknown: value({ dsd_out: 128, dsd_mod: "x" })
        };
        current = { id: "test", output: { mode: "max", dsd_out: 256, dsd_mod: "7w" } };
        body.innerHTML = modulatorGroup(current.output);
        out.sub = body.querySelector(".filter-row-sub").textContent;
        let reached = 0;
        const up = () => { reached++; };
        document.addEventListener("click", up);
        body.querySelector("[data-mod-row]").click();
        const sheet = document.getElementById("filter-sheet");
        out.title = sheet && sheet.querySelector(".filter-sheet-title").textContent;
        out.names = sheet ? [...sheet.querySelectorAll(".filter-choice-name")].map(e => e.textContent) : null;
        out.on = sheet ? [...sheet.querySelectorAll(".filter-choice.is-on")].map(e => e.getAttribute("data-filter-pick")) : null;
        out.off = sheet ? [...sheet.querySelectorAll(".filter-choice")].map(e => e.disabled) : null;
        sheet.querySelectorAll(".filter-choice")[2].click();   // the ninth, not at DSD256: nothing
        out.afterOff = !!document.getElementById("filter-sheet");
        sheet.querySelector('[data-filter-pick="7"]').click();
        out.afterPick = !!document.getElementById("filter-sheet");
        document.removeEventListener("click", up);
        out.reached = reached;
        out.sent = sent;
        return out;
      })()`);
    } finally { await b.close(); }
    assert.deepEqual(r.values, ["7", "7w", "9"]);
    assert.equal(r.at64, "7th order", "none set: the 7th order");
    assert.equal(r.wideAt64, "7th order", "the wide one isn't made at DSD64: the 7th order said");
    assert.equal(r.ninthAt256, "7th order", "the ninth isn't made at DSD256: the 7th order said");
    assert.equal(r.wideAt256, "7th order wide");
    assert.equal(r.unknown, "7th order");
    assert.equal(r.sub, "PCM made DSD256");
    assert.equal(r.title, "Modulator for DSD256");
    assert.deepEqual(r.names, ["7th order", "7th order wide", "9th order — not at DSD256"]);
    assert.deepEqual(r.on, ["7w"]);
    assert.deepEqual(r.off, [false, false, true]);
    assert.equal(r.afterOff, true, "one not made at the rate can't be picked");
    assert.equal(r.afterPick, false, "a pick closes the list");
    assert.equal(r.reached, 0, "no tap of the Modulator's goes past the device's page");
    assert.deepEqual(r.sent, [{ output: { dsd_mod: "7" } }], "the pick, and only the pick, sent");
  } finally { await srv.stop(); }
});
