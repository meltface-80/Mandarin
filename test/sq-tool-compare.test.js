"use strict";
/*
 * SQ-tool's "Compare two songs" inside Mandarin (item 413): two songs of Mandarin's music folder compared through
 * /sq-tool/ behind Mandarin's sign-in, its API handed on by Mandarin (SqTool.cs) as the rest of SQ-tool's is, and the
 * page at phone width: song A and song B chosen with the page's song picker (search), Compare, and the verdict, the
 * null depth and the difference's download link shown. The songs: one 16-bit song, and the same 3 dB quieter, rounded
 * to 16 bits again: the same master, what is left only the rounding.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const python = spawnSync("python3", ["-c", "import numpy"]).status === 0;
const skip = !python && !process.env.CI && "python3 with numpy is not installed";
const noBrowser = skip || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

// Three seconds of chords as a 16-bit stereo WAV, at [gain] (in dB) of the original, rounded to 16 bits.
function song(gain) {
  const rate = 44100, n = 3 * rate, data = Buffer.alloc(n * 4), g = Math.pow(10, gain / 20);
  const tones = [[110, 0.12], [220, 0.1], [277.18, 0.08], [329.63, 0.08], [1760, 0.03], [5274, 0.01]];
  for (let i = 0; i < n; i++) {
    const t = i / rate, fade = Math.min(1, t / 0.05, (3 - t) / 0.05);
    for (let c = 0; c < 2; c++) {
      let v = 0;
      for (const [f, a] of tones) v += a * Math.sin(2 * Math.PI * f * t + c);
      data.writeInt16LE(Math.round(32767 * v * fade * g), i * 4 + c * 2);
    }
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// Mandarin with a music folder of the two songs; [fn] given its address and a sign-in.
async function withMandarin(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-sqcompare-"));
  const music = path.join(root, "music"), data = path.join(root, "data");
  fs.mkdirSync(path.join(music, "Album"), { recursive: true });
  fs.writeFileSync(path.join(music, "Album", "Chords (original).wav"), song(0));
  fs.writeFileSync(path.join(music, "Album", "Chords (quieter).wav"), song(-3));
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: music, dataDir: data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)] });
  await srv.start();
  try {
    await fn(B, await signIn(B));
  } finally {
    await srv.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("Compare two songs through Mandarin: SQ-tool's comparison API behind the sign-in", { skip, timeout: 120000 }, async () => {
  await withMandarin(async (B, token) => {
    const bare = await fetch(B + "/sq-tool/api/comparisons");
    assert.ok(!(bare.status === 200 && /^\[/.test(await bare.text())), "the comparisons are behind the sign-in");
    const auth = { Authorization: "Bearer " + token };
    const made = await fetch(B + "/sq-tool/api/comparisons", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth),
      body: JSON.stringify({ a: "Album/Chords (original).wav", b: "Album/Chords (quieter).wav" }) });
    assert.equal(made.status, 200);
    const { id } = await made.json();
    let c;
    for (let i = 0; i < 600; i++) {
      c = await (await fetch(B + "/sq-tool/api/comparisons/" + id, { headers: auth })).json();
      if (c.state !== "comparing") break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(c.state, "ready", JSON.stringify(c));
    const r = c.result;
    assert.equal(r.verdict, "SAME MASTER", r.words);
    assert.match(r.words, /^B is 3\.00 dB quieter; the difference is only from rounding and dither at 16 bits \(null depth −\d+ dB\)$/);
    assert.ok(r.null.depth_db < -70 && r.null.depth_db > -100, JSON.stringify(r.null));
    assert.equal(r.offset.samples, 0);
    // The difference, downloaded through Mandarin.
    const wav = await fetch(B + "/sq-tool/api/comparisons/" + id + "/difference.wav", { headers: auth });
    assert.equal(wav.status, 200);
    assert.equal(wav.headers.get("content-type"), "audio/wav");
    assert.match(wav.headers.get("content-disposition"), /filename\*=UTF-8''Chords%20%28original%29%20-%20B%20minus%20A%2C%20difference\.wav$/);
    const body = Buffer.from(await wav.arrayBuffer());
    assert.equal(body.toString("latin1", 0, 4), "RIFF");
    assert.equal(body.length, Number(wav.headers.get("content-length")));
  });
});

test("Compare two songs on SQ-tool's page, at phone width: chosen by search, the verdict, null depth and the difference to download", { skip: noBrowser, timeout: 180000 }, async () => {
  await withMandarin(async (B, token) => {
    const b = await Browser.launch({ width: 390, height: 844 });
    try {
      const page = await b.page(B + "/sq-tool/#/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true });
      const until = async (expr, what, ms = 90000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          if (await page.eval(expr)) return;
          await new Promise(r => setTimeout(r, 150));
        }
        throw new Error("timed out waiting for " + what);
      };
      // The two modes side by side; the second chosen.
      await until("document.querySelectorAll('.modes a').length === 2", "the modes");
      assert.deepEqual(await page.eval("[...document.querySelectorAll('.modes a')].map(a => a.textContent)"),
        ["Does your DAC get exactly the file?", "Compare two songs"]);
      await page.eval("document.querySelector('.modes a[href=\"#/compare\"]').click()");
      await until("!!document.querySelector('[data-cmp-choose=a]')", "the two songs to choose");
      assert.equal(await page.eval("document.getElementById('cmp-go').disabled"), true, "nothing to compare before both are chosen");
      for (const [w, want] of [["a", "original"], ["b", "quieter"]]) {
        await page.eval(`document.querySelector('[data-cmp-choose=${w}]').click()`);
        await page.eval("(() => { const q = document.getElementById('cmp-q'); q.value = 'chords'; q.dispatchEvent(new Event('input')); })()");
        await until(`[...document.querySelectorAll('[data-cmp-song]')].length === 2`, "the search's two songs");
        await page.eval(`[...document.querySelectorAll('[data-cmp-song]')].find(e => e.textContent.includes(${JSON.stringify(want)})).click()`);
        assert.match(await page.eval(`document.getElementById('slot-${w}').textContent`), new RegExp("Chords \\(" + want + "\\)\\.wav"));
      }
      await page.eval("document.getElementById('cmp-go').click()");
      await until("!!document.getElementById('cmp-verdict')", "the verdict");
      const shown = await page.eval(`({
        verdict: document.getElementById('cmp-verdict').textContent,
        words: document.querySelector('.cmp-words').textContent,
        nul: document.querySelector('#cmp-null .value').textContent,
        level: document.querySelector('#cmp-level .value').textContent,
        diff: document.getElementById('cmp-diff').getAttribute('href'),
        loud: document.getElementById('cmp-diff-loud').textContent,
        wide: document.documentElement.scrollWidth
      })`);
      assert.equal(shown.verdict, "The same master");
      assert.match(shown.words, /^B is 3\.00 dB quieter; the difference is only from rounding and dither at 16 bits/);
      assert.match(shown.nul, /^−\d\d\.\d dB$/);
      assert.equal(shown.level, "−3.00 dB");
      assert.match(shown.diff, /^api\/comparisons\/[A-Za-z0-9._-]+\/difference\.wav$/);
      assert.match(shown.loud, /gain-normalised to −1 dBFS peak/);
      assert.ok(shown.wide <= 390, "nothing wider than the phone: " + shown.wide);
      // The link works from the page, through Mandarin.
      const got = await page.eval(`fetch(${JSON.stringify(shown.diff)}).then(r => [r.status, r.headers.get('content-type')])`);
      assert.deepEqual(got, [200, "audio/wav"]);
      assert.deepEqual(page.errors, []);
    } finally {
      await b.close();
    }
  });
});
