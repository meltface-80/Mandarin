"use strict";
/*
 * A device's DAC's real bits and Dither, on the page (item 301, app/device-dither.js): where Mandarin makes the PCM,
 * the real bits (as sent, 23 to 20) and one row saying the dither in use and at which bit, opening the list of the
 * three (Flat, Shaped 3rd order, Shaped 5th order), the one in use ticked, each with what it measured. A pick is a
 * PATCH of dither and the list closes, the tap going no further than the device's page. The app's words are
 * DeviceDither.kt's (DeviceDitherTest). And Headroom when upsampling (item 348): Auto, or Off, each saying what it
 * does; and Now playing's line the server names in red (its upsampling clipped).
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

test("a device's Dither: the real bits and one row where Mandarin makes the PCM, its list of three, a pick a PATCH", { skip, timeout: 120000 }, async () => {
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
        for (let i = 0; i < 160 && typeof ditherGroups !== "function"; i++) await sleep(50);
        const sent = [];
        patch = (b) => { sent.push(b); return Promise.resolve(); };
        const seg = (name, opts, cur) => '<div class="seg" data-seg="' + name + '">' + opts.map(x => '<button class="seg-btn' + (String(x.v) === String(cur) ? " is-on" : "") + '" data-seg-v="' + x.v + '">' + x.label + "</button>").join("") + "</div>";
        const row = (o) => { body.innerHTML = ditherGroups(o, seg); return [body.querySelector(".filter-row-sub").textContent, body.querySelector(".filter-row-value").textContent, body.querySelector('.seg[data-seg="real_bits"] .is-on').textContent]; };
        const out = {
          values: DEVICE_DITHERS.map(d => d[0]),
          none: row({ mode: "max" }), shaped: row({ mode: "x2", dither: "ns5", real_bits: 20 }), unknown: row({ mode: "max", dither: "x" }),
          bits: [...body.querySelectorAll('.seg[data-seg="real_bits"] .seg-btn')].map(e => e.textContent)
        };
        current = { id: "test", output: { mode: "max", dither: "ns3", real_bits: 21 } };
        body.innerHTML = ditherGroups(current.output, seg);
        let reached = 0;
        const up = () => { reached++; };
        document.addEventListener("click", up);
        body.querySelector("[data-dither-row]").click();
        const sheet = document.getElementById("filter-sheet");
        out.title = sheet && sheet.querySelector(".filter-sheet-title").textContent;
        out.names = sheet ? [...sheet.querySelectorAll(".filter-choice-name")].map(e => e.textContent) : null;
        out.notes = sheet ? [...sheet.querySelectorAll(".filter-choice-note")].map(e => e.textContent) : null;
        out.on = sheet ? [...sheet.querySelectorAll(".filter-choice.is-on")].map(e => e.getAttribute("data-filter-pick")) : null;
        sheet.querySelector('[data-filter-pick="ns5"]').click();
        out.afterPick = !!document.getElementById("filter-sheet");
        document.removeEventListener("click", up);
        out.reached = reached;
        out.sent = sent;
        const hr = (o) => { body.innerHTML = headroomGroup(o, seg); return [body.querySelector('.seg[data-seg="headroom"] .is-on').textContent, body.querySelector(".settings-note").textContent]; };
        out.headroom = { auto: hr({ mode: "x2" }), off: hr({ mode: "x2", headroom: "off" }), choices: [...body.querySelectorAll('.seg[data-seg="headroom"] .seg-btn')].map(e => e.textContent) };
        paintNpSignal({ signal: { lines: ["FLAC 24/88.2 kHz ↑×2", "Gaussian ×2 · 24/88.2 kHz"], steps: [], alert: 1 } });
        out.red = [...document.querySelectorAll("#np-signal-lines .np-signal-line")].map(e => e.classList.contains("is-alert"));
        return out;
      })()`);
    } finally { await b.close(); }
    assert.deepEqual(r.values, ["flat", "ns3", "ns5"]);
    assert.deepEqual(r.none, ["At the word’s depth", "Flat", "As sent"], "none set: flat, at the word's depth");
    assert.deepEqual(r.shaped, ["At 20 bits", "Shaped, 5th order", "20"]);
    assert.deepEqual(r.unknown, ["At the word’s depth", "Flat", "As sent"]);
    assert.deepEqual(r.bits, ["As sent", "23", "22", "21", "20"]);
    assert.equal(r.title, "Dither");
    assert.deepEqual(r.names, ["Flat", "Shaped, 3rd order", "Shaped, 5th order"]);
    assert.match(r.notes[0], /−130 dB in the audio band/);
    assert.match(r.notes[2], /−233 dB in the band/);
    assert.deepEqual(r.on, ["ns3"]);
    assert.equal(r.afterPick, false, "a pick closes the list");
    assert.equal(r.reached, 0, "no tap of the Dither's goes past the device's page");
    assert.deepEqual(r.sent, [{ output: { dither: "ns5" } }], "the pick, and only the pick, sent");
    assert.deepEqual(r.headroom.choices, ["Auto", "Off"]);
    assert.equal(r.headroom.auto[0], "Auto", "Auto by its absence");
    assert.match(r.headroom.auto[1], /^A track whose peaks between its samples would go over full scale/);
    assert.equal(r.headroom.off[0], "Off");
    assert.match(r.headroom.off[1], /^Nothing is turned down/);
    assert.deepEqual(r.red, [false, true], "the upsampling's line in red, the server naming it");
  } finally { await srv.stop(); }
});
