"use strict";
/*
 * Now playing's signal path on the page (item 247), in a browser: the server's lines drawn under the album, centred,
 * the first the brighter; a tap opens the sheet of every step, each with its dot; a tap outside closes it; a phone's,
 * a Sonos room's or an older server's badge is drawn as it was, in the lines' place, with nothing to open. The lines and steps themselves are the server's
 * (test/renderer-playback.test.js holds them to what was sent).
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

test("Now playing's signal path: the lines centred, a tap for every step, an older server's badge as it was", { skip, timeout: 120000 }, async () => {
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
        const $ = id => document.getElementById(id);
        const until = async (f, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(50); } };
        await until(() => typeof paintNpFormat === "function" && $("np-format"));
        const out = {};
        paintNpFormat({ signal: {
          lines: ["WAV 24/705.6 kHz ↑×16", "Standard filter", "DSD256 being made"],
          steps: [
            { kind: "source", title: "File", detail: "FLAC 16/44.1 kHz", quality: "lossless" },
            { kind: "upsample", title: "Upsampling", detail: "×16 to 705.6 kHz · Standard filter", quality: "enhanced" },
            { kind: "pending", title: "Being made", detail: "DSD256 for this track’s next play: being made", quality: "pending" }
          ] } });
        const f = $("np-signal-lines"), badge = $("np-format");
        out.lines = [...f.querySelectorAll(".np-signal-line")].map(x => x.textContent);
        out.badgeHidden = badge.classList.contains("hidden");
        out.first = f.querySelector(".np-signal-line").classList.contains("is-out");
        out.label = f.getAttribute("aria-label");
        out.closed = $("np-signal").classList.contains("hidden");
        f.click();
        out.open = !$("np-signal").classList.contains("hidden");
        out.expanded = f.getAttribute("aria-expanded");
        out.steps = [...document.querySelectorAll("#np-signal-steps .np-signal-step")].map(x => [x.className, x.querySelector(".np-signal-title").textContent, x.querySelector(".np-signal-detail").textContent]);
        out.title = document.querySelector('[data-parity="now-playing.signal-title"]').textContent;
        document.body.click();
        out.closedAgain = $("np-signal").classList.contains("hidden");
        // A phone, a Sonos room, an older server: its badge, in the lines' place, nothing to open.
        paintNpFormat({ format: { kind: "lossless", text: "Lossless" } });
        out.badge = badge.classList.contains("hidden") ? null : badge.textContent;
        out.linesGone = f.classList.contains("hidden");
        badge.click();
        out.badgeOpens = !$("np-signal").classList.contains("hidden");
        return out;
      })()`);
    } finally { await b.close(); }
    assert.deepEqual(r.lines, ["WAV 24/705.6 kHz ↑×16", "Standard filter", "DSD256 being made"]);
    assert.equal(r.first, true, "the first line, what goes out, the brighter");
    assert.equal(r.badgeHidden, true, "the lines in the badge's place");
    assert.equal(r.label, "Signal path");
    assert.equal(r.closed, true);
    assert.equal(r.open, true, "a tap opens the signal path");
    assert.equal(r.expanded, "true");
    assert.deepEqual(r.steps, [
      ["np-signal-step is-lossless", "File", "FLAC 16/44.1 kHz"],
      ["np-signal-step is-enhanced", "Upsampling", "×16 to 705.6 kHz · Standard filter"],
      ["np-signal-step is-pending", "Being made", "DSD256 for this track’s next play: being made"]
    ]);
    assert.equal(r.title, "Signal path");
    assert.equal(r.closedAgain, true, "a tap outside closes it");
    assert.deepEqual([r.badge, r.linesGone, r.badgeOpens], ["Lossless", true, false]);
  } finally {
    await srv.stop();
  }
});
