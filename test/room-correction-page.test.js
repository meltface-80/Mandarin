"use strict";
/*
 * Settings → Audio Devices, Room correction on the page (bug list item 258, public/app/audio-devices-page.js):
 * the responses loaded, one a rate, a row each with its own Remove (the rate it takes off), the note on how a track's
 * is chosen, and Load another…; one kept as item 252 kept it (a single response) a set of one; none, the page's
 * words for none. The headroom's note takes the loudest of the set. The app says the same (AudioDevicesTest.kt).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "public", "app", "audio-devices-page.js"), "utf8");
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDb = v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + " dB";
const allBands = dr => (dr.headphone && dr.headphone.bands ? dr.headphone.bands : []).concat(dr.bands);
const page = vm.runInNewContext(SRC + "\n;({ renderConvolution, headroomNote, IR_SET_NOTE })", { window: {}, esc, fmtDb, allBands });

// The rows drawn: [name, facts, the rate its Remove takes off].
const rows = (html) => [...html.matchAll(/settings-device\.ir-name">([^<]*)<\/div><div class="hp-meta" data-parity="settings-device\.ir-meta">([^<]*)<\/div><button[^>]*data-ir-rate="(\d+)"/g)]
  .map(m => [m[1], m[2], Number(m[3])]);
const load = (html) => /data-ir-load>([^<]*)</.exec(html)[1];

const A = { file: "a.wav", name: "room-44.wav", rate: 44100, channels: 2, seconds: 0.5, peak_db: -6 };
const B = { rate: 48000, channels: 1, seconds: 2, peak_db: 3.25 };

test("room correction lists what is loaded, one a rate, each taken off on its own", () => {
  const set = page.renderConvolution([A, B]);
  assert.deepStrictEqual(rows(set), [
    ["room-44.wav", "44.1 kHz · 2 channels · 0.5 s · lifts at most −6.0 dB", 44100],
    ["Impulse response", "48 kHz · 1 channel · 2 s · lifts at most +3.3 dB", 48000]]);
  assert.ok(set.includes(page.IR_SET_NOTE), "how a track's response is chosen");
  assert.strictEqual(load(set), "Load another…");
  assert.match(set, /<input type="file"[^>]* multiple /, "several at once");
  assert.match(set, /accept="[^"]*\.zip/, "or a zip of them");

  // One kept as item 252 kept it: a set of one.
  assert.deepStrictEqual(rows(page.renderConvolution(A)), [["room-44.wav", "44.1 kHz · 2 channels · 0.5 s · lifts at most −6.0 dB", 44100]]);

  const none = page.renderConvolution(null);
  assert.deepStrictEqual(rows(none), []);
  assert.strictEqual(load(none), "Load a response…");
  assert.ok(!none.includes(page.IR_SET_NOTE));
});

test("the headroom's note covers the loudest response of the set", () => {
  const note = page.headroomNote({ bands: [], convolution: [A, B] }, 1, -4.25);
  assert.strictEqual(note, "Auto: −4.3 dB before the correction and the bands — together they lift at most +4.3 dB, and half a dB is kept under it so nothing clips.");
});
