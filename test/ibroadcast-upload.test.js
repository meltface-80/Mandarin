"use strict";
/*
 * Upload to iBroadcast (item 446), against a stand-in on loopback (test/fake-ibroadcast.js), with iBroadcast's limit
 * on a file made 2 MB (ibroadcast_upload_limit) so the library's own files can pass it:
 *   - Upload now sends every file of the library's as it is (the same bytes, its path here), but one iBroadcast has
 *     already (its MD5 among iBroadcast's); a DSF as FLAC at 24-bit/176.4 kHz; a WAV over the limit as FLAC, its tags
 *     kept; one of noise, still over as FLAC, as FLAC at half its rate; an MP3 over the limit not sent (not lossless);
 *     an AIFF, a format iBroadcast doesn't take, left out. A busy answer waited out. Said in the summary, every local
 *     file untouched, and iBroadcast's library read again;
 *   - again, nothing is sent: what was sent is kept;
 *   - while music plays (a phone playing), it waits, and goes on when it stops;
 *   - Stop upload stops it; Upload now goes on where it was;
 *   - the page says what the last one did and what it left.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { makeLibrary, haveFfmpeg, gen, probe, writeDsf } = require("./fixtures");
const { FakeIBroadcast } = require("./fake-ibroadcast");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");
const { Browser, findBrowser } = require("./browser-harness");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await sleep(100);
  }
}
const md5 = b => crypto.createHash("md5").update(b).digest("hex");
const LIMIT = 2000000;

/* Every file under [dir]: its path → its MD5 and time. */
function files(dir) {
  const out = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const f = path.join(e.parentPath || e.path, e.name);
    out[f] = md5(fs.readFileSync(f)) + " " + fs.statSync(f).mtimeMs;
  }
  return out;
}

test("item 446: Upload now sends the library to iBroadcast, as it is but for DSD and what is over the limit; never again; held while music plays; stopped and gone on", { skip, timeout: 300000 }, async (t) => {
  const lib = makeLibrary();
  const m = lib.music;
  writeDsf(path.join(m, "DSD", "Dsd Album", "01 Dsd.dsf"), 1);
  gen(path.join(m, "Wav", "Big", "01 Tone.wav"), { seconds: 20, tags: { title: "Tone", artist: "Wave", album: "Big", track: 1 } });
  gen(path.join(m, "Wav", "Big", "02 Noise.wav"), { seconds: 30, expr: "random(0)*2-1|random(1)*2-1", tags: { title: "Noise", artist: "Wave", album: "Big", track: 2 } });
  gen(path.join(m, "Lossy", "Long", "01 Long.mp3"), { seconds: 60, fmt: null, codecArgs: ["-b:a", "320k"], tags: { title: "Long", artist: "Lossy", album: "Long", track: 1 } });
  gen(path.join(m, "Aiff", "A", "01 A.aif"), { tags: { title: "A", artist: "Aiff", album: "A", track: 1 } });
  const at = (...p) => path.join(m, ...p);
  for (const [f, over] of [[at("Wav", "Big", "01 Tone.wav"), true], [at("Wav", "Big", "02 Noise.wav"), true], [at("Lossy", "Long", "01 Long.mp3"), true],
    [at("Artist B", "Hi Res", "01 Hi 1.flac"), false], [at("Artist A", "Album One", "02 Song 2.flac"), false]]) assert.equal(fs.statSync(f).size > LIMIT, over, f);

  const ib = await new FakeIBroadcast().start();
  ib.slowOnce = false;
  ib.md5s.push(md5(fs.readFileSync(at("Artist A", "Album One", "01 Song 1.flac"))));   // in iBroadcast already
  ib.busy = 1;                                                                            // the first file sent is answered "busy"
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: m, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    ibroadcastBaseUrl: ib.base, ibroadcastUploadLimit: LIMIT });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const call = async (method, p, body) => {
    const r = await fetch(base + "/api/" + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const state = () => call("GET", "settings/ibroadcast");
  const post = (p, body = {}) => call("POST", "settings/ibroadcast" + p, body);
  const db = ctx.db.raw;
  const tracks = () => db.prepare("SELECT COUNT(*) AS n FROM tracks WHERE path NOT LIKE '%://%'").get().n;
  await until(async () => tracks() >= 12 && !(await call("GET", "status")).scanning, 60000, "the library");
  await post("/signin");
  ib.approve();
  await until(async () => (await state()).connected, 15000, "signed in");
  const finished = async (since = 0) => until(async () => { const s = await state(); return s.upload && !s.upload.running && s.upload.finished > since && s.upload; }, 120000, "the upload done");
  const before = files(m);

  await t.test("Upload now: each file as it is, DSD and what is over the limit as FLAC, the rest left with why", async () => {
    const reads = ib.libraryReads;
    // Nothing chosen to upload from (item 451): refused until one is.
    const none = await post("/upload");
    assert.equal(none.status, 409);
    assert.equal(none.error, "Choose what to upload from first: All drives or the drives to send");
    assert.equal((await post("/upload/settings", { from: "all" })).status, 200);
    const r = await post("/upload");
    assert.equal(r.status, 200);
    assert.equal(r.upload.running, true, JSON.stringify(r.upload));
    const u = await finished();
    assert.deepEqual([u.uploaded, u.already, u.converted, u.skipped, u.failed, u.stopped, u.error], [9, 1, 3, 1, 1, false, null], JSON.stringify(u));
    assert.deepEqual([u.files_total, u.files_done], [12, 12]);
    assert.equal(ib.busy, 0, "the busy answer met, and the file sent again");
    assert.equal(ib.md5Asks, 1);
    const by = Object.fromEntries(ib.uploads.map(x => [x.file_path, x]));
    assert.equal(ib.uploads.length, 9, ib.uploads.map(x => x.file_path).join(", "));
    assert.ok(ib.uploads.every(x => x.method === "mandarin" && x.name === path.basename(x.file_path)), "each sent as iBroadcast's uploader sends one");
    for (const f of [at("Artist A", "Album One", "02 Song 2.flac"), at("Artist A", "Album One", "03 Song 3.flac"), at("Artist B", "Hi Res", "01 Hi 1.flac"),
      at("Artist B", "Hi Res", "02 Hi 2.flac"), at("Comp", "CD1", "01.mp3"), at("Comp", "CD2", "01.mp3")]) {
      assert.ok(by[f], "sent: " + f);
      assert.equal(by[f].md5, md5(fs.readFileSync(f)), "as it is: " + f);
    }
    assert.ok(!by[at("Artist A", "Album One", "01 Song 1.flac")], "one iBroadcast has, not sent again");
    const dsd = by[at("DSD", "Dsd Album", "01 Dsd.flac")];
    assert.ok(dsd, "the DSF sent as FLAC");
    assert.deepEqual(probe(dsd.data), { rate: 176400, channels: 2, bits: 24 });
    const tone = by[at("Wav", "Big", "01 Tone.flac")];
    assert.deepEqual(probe(tone.data), { rate: 44100, channels: 2, bits: 16 });
    assert.ok(tone.size <= LIMIT && /title=Tone/i.test(tone.data.toString("latin1")), "made FLAC under the limit, its tags kept");
    const noise = by[at("Wav", "Big", "02 Noise.flac")];
    assert.deepEqual(probe(noise.data), { rate: 22050, channels: 2, bits: 16 }, "noise over the limit as FLAC: at half its rate");
    assert.ok(noise.size <= LIMIT);
    const why = Object.fromEntries(u.problems.map(p => [path.basename(p.file), p.why]));
    assert.deepEqual(why, { "01 A.aif": "iBroadcast doesn't take .aif files", "01 Long.mp3": "Over iBroadcast's limit of 2 MB, and not lossless, so not made smaller" });
    assert.deepEqual(files(m), before, "every file here untouched");
    assert.deepEqual(fs.readdirSync(path.join(lib.data, "ibroadcast-upload")), [], "the FLACs made, gone");
    await until(() => ib.libraryReads > reads, 15000, "the iBroadcast library read again");
  });

  await t.test("again: nothing sent, what was sent kept", async () => {
    const last = (await state()).upload.finished;
    await post("/upload");
    const u = await finished(last);
    assert.deepEqual([u.uploaded, u.already, u.files_total, u.skipped, u.failed], [0, 10, 2, 1, 1], JSON.stringify(u));
    assert.equal(ib.uploads.length, 9);
  });

  if (findBrowser()) await t.test("the page says what the last one did, and what it left", async () => {
    const b = await Browser.launch({ width: 412, height: 915 });
    try {
      const page = await b.page(base + "/", { cookies: [{ name: "musicd_session", value: token, url: base }] });
      await page.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < 100 && !document.querySelector("#settings-toggle"); i++) await sleep(100);
        document.querySelector("#settings-toggle").click(); await sleep(300);
        document.querySelector('.settings-nav-item[data-pane="streaming"]').click(); await sleep(200);
        document.querySelector('[data-parity="settings-services.ibroadcast"]').click();
      })()`);
      const seen = await until(() => page.eval(`(() => { const s = document.getElementById("ib-upload-status"); return s && s.offsetParent && s.textContent && [s.textContent,
        document.getElementById("ib-upload-progress").textContent, document.getElementById("ib-upload-problems").textContent,
        !document.getElementById("ib-upload-now").classList.contains("hidden"), document.getElementById("ib-upload-stop").classList.contains("hidden")]; })()`), 15000, "the upload on the page");
      assert.match(seen[0], /^Done · \S/);
      assert.deepEqual(seen.slice(1), ["0 uploaded · 10 already in iBroadcast · 1 left out · 1 not sent",
        "01 A.aif: iBroadcast doesn't take .aif files\n01 Long.mp3: Over iBroadcast's limit of 2 MB, and not lossless, so not made smaller", true, true]);
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
  });

  await t.test("while music plays it waits, and goes on when it stops", async () => {
    gen(at("New", "One", "01 New.flac"), { freq: 333, tags: { title: "New", artist: "New", album: "One", track: 1 } });
    await call("POST", "library/rescan");
    await until(async () => tracks() >= 13 && !(await call("GET", "status")).scanning, 60000, "the new file in the library");
    const h = await call("POST", "phone/hello", { name: "Pixel 8" });
    const album = (await call("GET", "library/albums?sort=album")).albums.find(a => a.title === "Album One");
    assert.equal((await call("POST", "play", { offset: album.offset, zone_or_output_id: h.zone_id, kind: "play_now" })).status, 200);
    let playing = true;
    const report = (async () => { while (playing) { await call("POST", "phone/state", { index: 0, position: 5, duration: 60, state: "playing", volume: 40 }); await sleep(400); } })();
    try {
      const last = (await state()).upload.finished;
      await post("/upload");
      const held = await until(async () => { const u = (await state()).upload; return u.running && u.held && u; }, 15000, "held");
      assert.equal(held.files_total, 3, JSON.stringify(held));
      await sleep(1500);
      assert.equal(ib.uploads.length, 9, "nothing sent while music plays");
      playing = false;
      await report;
      await call("POST", "phone/state", { index: 0, position: 6, duration: 60, state: "paused", volume: 40 });
      const u = await finished(last);
      assert.equal(u.uploaded, 1, JSON.stringify(u));
      assert.equal(ib.uploads.at(-1).file_path, at("New", "One", "01 New.flac"));
    } finally {
      playing = false;
      await report;
      await call("POST", "phone/state", { index: 0, position: 6, duration: 60, state: "paused", volume: 40 });
    }
  });

  await t.test("Stop upload stops it; Upload now goes on where it was", async () => {
    gen(at("New", "Two", "01 Two.flac"), { freq: 555, tags: { title: "Two", artist: "New", album: "Two", track: 1 } });
    gen(at("New", "Two", "02 Three.flac"), { freq: 777, tags: { title: "Three", artist: "New", album: "Two", track: 2 } });
    await call("POST", "library/rescan");
    await until(async () => tracks() >= 15 && !(await call("GET", "status")).scanning, 60000, "two more files");
    ib.uploadDelayMs = 4000;
    const last = (await state()).upload.finished;
    await post("/upload");
    await until(async () => { const u = (await state()).upload; return u.running && u.album && u; }, 15000, "sending");
    const r = await post("/upload/stop");
    assert.equal(r.status, 200);
    const u = await finished(last);
    assert.equal(u.stopped, true, JSON.stringify(u));
    assert.match((await state()).upload.album || "", /^$/);
    ib.uploadDelayMs = 0;
    await post("/upload");
    const again = await finished(u.finished);
    assert.equal(again.stopped, false);
    for (const f of [at("New", "Two", "01 Two.flac"), at("New", "Two", "02 Three.flac")]) assert.ok(ib.md5s.includes(md5(fs.readFileSync(f))), "sent in the end: " + f);
  });
});
