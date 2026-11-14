"use strict";
/*
 * MQA, end to end (item 418): tracks whose samples carry MQA's signalling (test/mqa-signals.js) are found by the
 * background pass and said: on the album's tracks and its versions, in the lists, in the Focus's MQA facet, in Now
 * playing; a near miss and a plain album are not. A room whose Output has This DAC decodes MQA on is sent an MQA track
 * as the file itself (.orig, ?mqa=1, no gain, no DSP, no upsampling) although it is set to upsample with DSP, and Now
 * playing says "MQA: sent untouched to the DAC"; the same room plays any other track with its processing, and with
 * the setting off plays the MQA track processed too. On the page at a phone's size (412×800): the badges, the Versions
 * tab's rate line, Now playing's lines and the Audio Devices switch. A file changed is looked at again. MQA_SHOTS=dir
 * writes the page's screenshots there.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { haveFfmpeg } = require("./fixtures");
const { FakeRenderer, idFor } = require("./fake-renderer");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { mqaFlac } = require("./mqa-signals");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const noBrowser = !findBrowser() && !process.env.CI;
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? ": " + what : ""));
    await sleep(150);
  }
}

const STUDIO = { studio: true, original_rate: 352800, bits: 24 };
const LABEL = "MQA Studio · 24/352.8 original";

test("MQA: found in the samples, shown, filtered, played untouched to an MQA DAC, looked at again when changed", { skip, timeout: 300000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-mqa-"));
  const music = path.join(root, "music");
  const tags = (artist, album, i) => ({ title: `${album} ${i}`, artist, album_artist: artist, album, track: i, date: "1959" });
  const kob = i => path.join(music, "Quartet", "Kind of Blue", `0${i}.flac`);
  for (const i of [1, 2]) mqaFlac(kob(i), { studio: true, original: 352800, seed: i, tags: Object.assign(tags("Quartet", "Kind of Blue", i), i === 1 ? { MQAENCODER: "MQAEncode v1.1" } : {}) });
  for (const i of [1, 2]) mqaFlac(path.join(music, "Quartet", "Kind of Blue (2015 Remaster)", `0${i}.flac`), { bits: 16, kind: "plain", seed: 10 + i, tags: tags("Quartet", "Kind of Blue (2015 Remaster)", i) });
  for (const i of [1, 2]) mqaFlac(path.join(music, "Trio", "Near Miss", `0${i}.flac`), { kind: "near", seed: 20 + i, tags: tags("Trio", "Near Miss", i) });
  const wiim = new FakeRenderer({ name: "MQA Streamer", manufacturer: "Acme", model: "MQA Streamer" });
  await wiim.start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: music, dataDir: path.join(root, "data"), serverIp: "127.0.0.1", sonosHosts: [],
    upnpHosts: [wiim.location], upnpMulticast: false, identify: false, mqa: true, mqaTickMs: 200 });
  await srv.start();
  t.after(async () => { await srv.stop(); await wiim.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  const wall = async () => (await api("library/albums?sort=album&count=100")).albums;

  // Found by the pass after the scan: Kind of Blue MQA Studio, its remaster and the near miss not.
  const albums = await until(async () => { const w = await wall(); return w.length === 2 && w.find(a => a.title === "Kind of Blue" && a.mqa) && w; }, 60000, "MQA found");
  const kb = albums.find(a => a.title === "Kind of Blue");
  assert.deepEqual(kb.mqa, STUDIO);
  assert.equal(albums.find(a => a.title === "Near Miss").mqa, undefined, "a sync word a bit wrong is no MQA");
  const page = await api("album?offset=" + kb.offset);
  assert.deepEqual(page.tracks.map(x => x.mqa), [STUDIO, STUDIO]);
  assert.deepEqual(page.versions.map(v => [v.title, v.mqa || null]), [["Kind of Blue", STUDIO], ["Kind of Blue (2015 Remaster)", null]]);
  const near = await api("album?offset=" + albums.find(a => a.title === "Near Miss").offset);
  assert.deepEqual(near.tracks.map(x => x.mqa || null), [null, null]);
  // The Focus's MQA, and the wall filtered by it.
  const facet = (await api("library/facets")).facets.find(f => f.id === "mqa");
  assert.deepEqual(facet.values.map(v => [v.value, v.count]), [["MQA", 1], ["MQA Studio", 1]]);
  assert.deepEqual((await api("library/albums?mqa=MQA")).albums.map(a => a.title), ["Kind of Blue"]);
  assert.deepEqual((await api("library/albums?mqa=!MQA")).albums.map(a => a.title), ["Near Miss"]);

  // The renderer, set to upsample ×2 with DSP: This DAC decodes MQA on.
  const W = idFor(wiim.udn);
  await until(async () => (await api("audio-devices")).devices.some(x => x.id === W), 20000, "the renderer");
  const dsp = { enabled: true, peq: { bands: [{ type: "peak", freq: 1000, gain: 6, q: 1.41 }] }, headroom: "auto" };
  const caps = { user: { rates: [44100, 48000, 88200, 96000, 176400, 192000], bits: [16, 24], dsd: [] } };
  const set = async (output) => { const r = await call("PATCH", "audio-devices/" + W, { enabled: true, output, dsp, caps }); assert.equal(r.status, 200, JSON.stringify(r)); return r; };
  assert.equal((await call("PATCH", "audio-devices/" + W, { output: { mqa_dac: "yes" } })).status, 400, "on or off only");
  assert.equal((await set({ mode: "x2", bits: 24, mqa_dac: true })).output.mqa_dac, true);
  await until(async () => (await api("zones")).zones.some(x => x.zone_id === W), 20000, "its zone");
  const play = async (album, want, what) => {
    const from = wiim.fetches.length;
    await api("control", { zone_or_output_id: W, command: "stop" });
    assert.equal((await api("play", { offset: album.offset, zone_or_output_id: W, kind: "play_now" })).status, 200);
    const f = await until(() => wiim.fetches.slice(from).filter(x => x.done && x.body && x.body.length > 1000 && want.test(x.uri)).pop(), 60000, what);
    const np = await until(async () => { const z = (await api("zone-state?zone=" + W)).zone; const n = z && z.now_playing; return n && n.signal && n.line3 === album.title && n; }, 20000, what + ": Now playing");
    return { uri: f.uri, body: f.body, np };
  };
  let p = await play(kb, /\/stream\/t\d+\.orig\.flac/, "the MQA track as it is");
  assert.match(p.uri, /[?&]mqa=1(&|$)/);
  assert.doesNotMatch(p.uri, /[?&](g|o|f|dn|rb)=/, "no gain, DSP, filter or dither asked of it: " + p.uri);
  assert.ok(p.body.equals(fs.readFileSync(kob(1))), "the file itself, byte for byte");
  assert.deepEqual(p.np.mqa, Object.assign({ untouched: true }, STUDIO));
  assert.match(p.np.signal.lines[0], / · as it is$/, "the file as it is: " + p.np.signal.lines.join(" | "));
  assert.ok(p.np.signal.steps.some(s => s.kind === "mqa" && s.quality === "lossless"));
  // Any other track to the same room: its processing, as ever.
  p = await play(albums.find(a => a.title === "Near Miss"), /\.88200-24\.flac/, "the near miss upsampled");
  assert.match(p.uri, /[?&]o=/, "with its DSP");
  assert.equal(p.np.mqa, undefined);

  // On the page at a phone's size: the album's badges and its versions' rate line, Now playing's lines, the switch.
  if (!noBrowser) {
    await play(kb, /\.orig\.flac/, "the MQA track again");
    const b = await Browser.launch({ width: 412, height: 800 });
    try {
      const tab = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      const shot = async (name) => { if (process.env.MQA_SHOTS) await tab.screenshot(path.join(process.env.MQA_SHOTS, name)); };
      const seen = await tab.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const until = async (f, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(50); } };
        await until(() => window.__openAlbum && document.querySelector("#home-view .album"));
        window.__openAlbum(${JSON.stringify(kb)}, { source: "home" });
        await until(() => document.querySelectorAll("#modal-tracks .mqa-badge").length === 2);
        const badges = [...document.querySelectorAll("#modal-tracks .mqa-badge")].map(e => [e.textContent, e.dataset.parity, e.getClientRects().length > 0]);
        document.querySelector('#album-tabs [data-album-tab="versions"]').click();
        await until(() => document.querySelectorAll("#album-versions-pane .album-version-row").length === 2);
        const rates = [...document.querySelectorAll("#album-versions-pane .album-version-format")].map(e => e.textContent);
        return { badges, rates };
      })()`);
      assert.deepEqual(tab.errors, []);
      assert.deepEqual(seen.badges, [[LABEL, "album.track-mqa", true], [LABEL, "album.track-mqa", true]]);
      assert.deepEqual(seen.rates, ["24-bit / 44.1 kHz · " + LABEL, "16-bit / 44.1 kHz"]);
      await tab.eval(`document.querySelector("#album-versions-pane .album-version-row").scrollIntoView({ block: "center" })`);
      await shot("album-versions.png");
      await tab.eval(`document.querySelector('#album-tabs [data-album-tab="tracks"]').click()`);
      await shot("album-page.png");
      const np = await tab.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const until = async (f, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(50); } };
        if (window.__closeModal) window.__closeModal();
        const sel = document.getElementById("zone-select");
        const o = await until(() => [...sel.options].find(x => x.value === ${JSON.stringify(W)}));
        sel.value = o.value; sel.dispatchEvent(new Event("change"));
        const cur = await until(() => window.__getCurrentNp && window.__getCurrentNp() && window.__getCurrentNp().mqa && window.__getCurrentNp());
        window.__openAlbum({ title: cur.line3, subtitle: cur.line2, image_key: cur.image_key }, { source: "now-playing" });
        await until(() => !document.getElementById("np-mqa").classList.contains("hidden"));
        const el = id => document.getElementById(id);
        return { badge: el("np-mqa").textContent, note: el("np-mqa-untouched").textContent, shown: el("np-mqa-untouched").getClientRects().length > 0 };
      })()`);
      assert.deepEqual(np, { badge: LABEL, note: "MQA: sent untouched to the DAC", shown: true });
      await shot("now-playing.png");
      const dev = await tab.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        if (window.__closeModal) window.__closeModal();
        for (let i = 0; i < 200 && typeof openDevice !== "function"; i++) await sleep(50);
        document.getElementById("settings-overlay").classList.remove("hidden");
        await openDevice(${JSON.stringify(W)});
        for (let i = 0; i < 100 && !document.querySelector("[data-dev-mqa]"); i++) await sleep(50);
        const sw = document.querySelector("[data-dev-mqa]");
        const group = sw.closest(".cap-group");
        group.scrollIntoView({ block: "center" });
        return { on: sw.checked, label: sw.getAttribute("aria-label"), note: group.querySelector(".settings-note").textContent, key: sw.closest("label").dataset.parity };
      })()`);
      assert.deepEqual([dev.on, dev.label, dev.key], [true, "This DAC decodes MQA", "settings-device.mqa-dac"]);
      assert.match(dev.note, /^An MQA track goes to this DAC untouched/);
      await sleep(300);
      await shot("audio-devices.png");
    } finally { await b.close(); }
  }

  // The setting off: the MQA track to that room is upsampled with its DSP like any other, undecoded.
  await set({ mode: "x2", bits: 24, mqa_dac: false });
  p = await play(kb, /\.88200-24\.flac/, "the MQA track processed");
  assert.match(p.uri, /[?&]o=/);
  assert.deepEqual(p.np.mqa, STUDIO, "still MQA, not sent untouched");
  await api("control", { zone_or_output_id: W, command: "stop" });

  // A file changed is looked at again: its first track plain now, it and its album are no longer MQA (as soon as the
  // scan has it, the row kept for the file as it was no longer its own)...
  const rescan = async () => assert.equal((await fetch(B + "/api/library/rescan", { method: "POST", headers: { Authorization: "Bearer " + token } })).status, 200);
  await sleep(1100);   // a modification time of its own
  mqaFlac(kob(1), { kind: "plain", seed: 99, tags: tags("Quartet", "Kind of Blue", 1) });
  await rescan();
  const plain = await until(async () => { const a = await api("album?offset=" + kb.offset); return a.tracks && !a.tracks[0].mqa && a.tracks[1].mqa && a; }, 60000, "the changed file");
  assert.equal(plain.album.mqa, undefined, "the album, no longer every track MQA");
  assert.equal((await api("library/facets")).facets.find(f => f.id === "mqa"), undefined);
  // ...and MQA of another kind (plain MQA, 96 kHz original) once looked at again: only the pass can say that.
  await sleep(1100);
  mqaFlac(kob(1), { studio: false, original: 96000, seed: 5, tags: tags("Quartet", "Kind of Blue", 1) });
  await rescan();
  const looked = await until(async () => { const a = await api("album?offset=" + kb.offset); return a.tracks && a.tracks[0].mqa && a.tracks[0].mqa.original_rate === 96000 && a; }, 60000, "the changed file looked at again");
  assert.deepEqual(looked.tracks.map(x => x.mqa), [{ studio: false, original_rate: 96000, bits: 24 }, STUDIO]);
  assert.deepEqual(looked.album.mqa, { studio: false, original_rate: 352800, bits: 24 }, "MQA, not Studio: not every track is");
  const facetAfter = (await api("library/facets")).facets.find(f => f.id === "mqa");
  assert.deepEqual(facetAfter.values.map(v => [v.value, v.count]), [["MQA", 1]]);
});
