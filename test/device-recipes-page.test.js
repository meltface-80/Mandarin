"use strict";
/*
 * A device's recipes, on the page (item 320, app/device-recipes.js): from a device's answer, offered by what it takes
 * (upsampled ones only above 48 kHz, a DSD one only where DSD is on, at its highest multiple), each in words for that
 * device; the one its settings are marked, Custom where they are none of them; a recipe's settings PATCHed through the
 * server set only what they name (the bit depth stays) and make it the one in use. As cards under Sound, the one in use
 * with its words, the others their name alone; a tap on one not in use a PATCH of its settings and nothing else, the
 * one in use nothing. Custom opens Advanced; Advanced is open while Custom is in use, and stays as a tap left it
 * across the page's redraws. The app's are DeviceRecipes.kt's (DeviceRecipesTest).
 * Skipped where no Chromium or Chrome is found (test/browser-harness.js).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { createServer, built } = require("./server");
const { FakeRenderer, idFor } = require("./fake-renderer");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

test("a device's recipes: cards, the one in use with its words, a pick its settings, Custom opening Advanced", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const dac = new FakeRenderer({ name: "SU-1", manufacturer: "Singxer", model: "SU-1", sink: "http-get:*:audio/flac:*,http-get:*:audio/x-dsf:*" });
  await dac.start();
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpHosts: [dac.location], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const call = async (method, p, body) => {
      const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
      return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
    };
    const D = idFor(dac.udn);
    for (let i = 0; i < 200 && !(await call("GET", "audio-devices")).devices.some(x => x.id === D); i++) await new Promise(r => setTimeout(r, 100));
    const set = async (body) => { const r = await call("PATCH", "audio-devices/" + D, body); assert.equal(r.status, 200, JSON.stringify(r)); return call("GET", "audio-devices/" + D); };
    // The device's answers, as the page is given them.
    const cdOnly = await set({ enabled: true, caps: { user: { rates: [44100, 48000], bits: [16, 24], dsd: [] } } });
    const hires = await set({ caps: { user: { rates: [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000], bits: [16, 24], dsd: [64, 128, 256] } } });
    const held = await set({ output: { max_rate: 384000, real_bits: 20 } });
    const b = await Browser.launch({ width: 390, height: 844 });
    let r;
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      r = await page.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < 160 && typeof recipesGroup !== "function"; i++) await sleep(50);
        const sent = [];
        patch = (b) => { sent.push(b); return Promise.resolve(); };
        // The device drawn with [output] over its own: a CD's rates only, so three cards; Custom where none matches.
        const dev = (id, output) => ({ id, name: "Kitchen DAC", rates: [{ hz: 44100, on: true }, { hz: 88200, on: true }], dsd: [], output });
        const gauss = { mode: "max", filter: "gaussian", filter_hires: "gaussian-hires" };
        const draw = (d) => { current = d; body.innerHTML = '<div class="settings-block">' + recipesGroup(d) + advancedFold(d, '<div id="rows">rows</div>') + "</div>"; };
        const fold = () => body.querySelector("[data-dev-advanced]");
        const out = {};
        const ids = d => recipesFor(d).map(r => r.id), on = d => recipesFor(d).filter(r => r.on).map(r => r.id);
        const cdOnly = ${JSON.stringify(cdOnly)}, hires = ${JSON.stringify(hires)}, held = ${JSON.stringify(held)};
        out.cdOnly = [ids(cdOnly), on(cdOnly)];
        out.hires = ids(hires);
        out.words = recipesFor(hires).map(r => r.words);
        out.dsdName = recipesFor(hires).find(r => r.id === "dsd").name;
        out.held = recipesFor(held).map(r => r.words);
        window.__picks = Object.fromEntries(recipesFor(hires).map(r => [r.id, r.output]));
        draw(dev("a", gauss));
        out.names = [...body.querySelectorAll(".recipe-card-name")].map(e => e.textContent);
        out.marked = [...body.querySelectorAll(".recipe-card.is-on")].map(e => e.getAttribute("data-recipe-pick"));
        out.cardWords = [...body.querySelectorAll(".recipe-card-words")].map(e => e.textContent);
        out.shut = fold().open;
        out.sub = fold().querySelector(".recipe-advanced-sub").textContent;
        body.querySelector('[data-recipe-pick="bitperfect"]').click();
        body.querySelector('[data-recipe-pick="gaussian"]').click();
        out.sent = sent.slice();
        body.querySelector('[data-recipe-pick="custom"]').click();
        out.customOpens = fold().open;
        out.afterCustom = sent.length;
        draw(dev("a", gauss));
        out.keptOpen = fold().open;
        fold().querySelector("summary").click();
        draw(dev("a", gauss));
        out.keptShut = fold().open;
        draw(dev("b", { mode: "x2" }));
        out.openForCustom = fold().open;
        return out;
      })()`);
      // Each pick sent through the server, and what the page makes of the answer.
      const onNow = async (body) => { const d = await set(body); return { d, on: await page.eval(`recipesFor(${JSON.stringify(d)}).filter(r => r.on).map(r => r.id)`) }; };
      const picks = await page.eval("window.__picks");
      await set({ output: { bits: 24 } });
      r.gaussMin = await onNow({ output: picks["gaussian-min"] });
      r.long = await onNow({ output: { filter: "long" } });
      r.dsd = await onNow({ output: picks.dsd });
      r.bitperfect = await onNow({ output: picks.bitperfect });
    } finally { await b.close(); }
    assert.deepEqual(r.cdOnly, [["bitperfect", "custom"], ["bitperfect"]], "a CD's rates only: nothing upsampled, no DSD; the file as it is in use");
    assert.deepEqual(r.hires, ["bitperfect", "standard", "gaussian", "gaussian-min", "very-long", "dsd", "custom"]);
    assert.match(r.words[1], /highest rate SU-1 takes \(705\.6 kHz for a CD\), 24-bit, in SoX’s steep filter/);
    assert.equal(r.dsdName, "DSD256, 7th order");
    assert.match(r.words[5], /11\.2896 MHz.*−207 dB/);
    assert.match(r.held[1], /\(352\.8 kHz for a CD\)/, "its owner's highest rate (item 240) holds a CD to 352.8 kHz");
    assert.match(r.held[4], /dithered at SU-1’s 20 real bits/);
    const o = r.gaussMin.d.output;
    assert.deepEqual([o.mode, o.filter, o.filter_hires, o.phase, o.bits, o.max_rate], ["max", "gaussian", "gaussian-hires", "minimum", 24, 384000], "a pick sets what it names; the rest as it was");
    assert.deepEqual(r.gaussMin.on, ["gaussian-min"]);
    assert.deepEqual(r.long.on, ["custom"], "a row changed under Advanced: none of them");
    assert.deepEqual([r.dsd.on, r.dsd.d.output.dsd_out], [["dsd"], 256]);
    assert.deepEqual(r.bitperfect.on, ["bitperfect"]);
    assert.ok(!r.bitperfect.d.output.dsd_out, "the file as it is: nothing made DSD");
    assert.deepEqual(r.names, ["Bit-perfect", "Upsampled, Standard filter", "Upsampled, Gaussian", "Upsampled, Gaussian, minimum phase", "Upsampled, Very long, shaped dither", "Custom"]);
    assert.deepEqual(r.marked, ["gaussian"]);
    assert.equal(r.cardWords.length, 1, "the words of the one in use alone");
    assert.match(r.cardWords[0], /^To 88\.2 kHz in the Gaussian filters/);
    assert.equal(r.shut, false, "Advanced folded while a recipe is in use");
    assert.equal(r.sub, "Set by the one above");
    assert.deepEqual(r.sent, [{ output: { mode: "original", dsd_out: "off" } }], "a pick its settings; the one in use nothing");
    assert.equal(r.customOpens, true, "Custom opens Advanced");
    assert.equal(r.afterCustom, 1, "Custom sends nothing");
    assert.equal(r.keptOpen, true, "opened, it stays open across a redraw");
    assert.equal(r.keptShut, false, "closed by its head, it stays closed");
    assert.equal(r.openForCustom, true, "open while Custom is in use");
  } finally { await srv.stop(); await dac.stop(); }
});
