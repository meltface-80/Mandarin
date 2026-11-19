"use strict";
/*
 * iBroadcast given time, and a file left tried again (item 488). On 19 November iBroadcast went on taking uploads from
 * about noon but stopped processing them (its upload servers were then down for the afternoon). The server restarted
 * at 12:55 and the upload began again: the files sent since noon weren't among what iBroadcast listed, so 2,129 were
 * sent a second time; and at the next upload 962 had been "taken 2 times and not kept" and were left "unless the file
 * changes", for good, with nothing wrong with them.
 *
 *   - a file sent a short while ago that iBroadcast hasn't listed is waited for: not sent again, nor counted, and said
 *     in one figure ("2 waiting on iBroadcast");
 *   - once that while has passed it is sent again, as before, and left when taken twice;
 *   - a file left is tried again when its day has passed, and the day doubles each time;
 *   - one iBroadcast lists after all is there already, whatever was said of it;
 *   - an upload that is still going when a file's time comes looks at it again then (a first upload runs for days).
 *
 * The whiles are the server's settings here (30 minutes and a day, as it runs): long, so nothing depends on how fast
 * the test goes; and "time passing" is the server started again with them short.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { makeLibrary, haveFfmpeg, gen } = require("./fixtures");
const { FakeIBroadcast } = require("./fake-ibroadcast");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");
const { Browser, findBrowser } = require("./browser-harness");
const { until } = require("./helpers");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const MINUTES = 60 * 1000, DAY = 24 * 3600 * 1000;

test("item 488: a file iBroadcast hasn't listed yet is waited for; one left is tried again after a day, then two", { skip, timeout: 400000 }, async (t) => {
  const lib = makeLibrary();
  const ib = await new FakeIBroadcast().start();
  ib.slowOnce = false;
  ib.notKept = p => /Hi Res/.test(p);   // Artist B — Hi Res: its two files taken, not listed
  t.after(() => ib.stop());
  let srv = null, ctx = null, base = "", token = "";
  /** The server started (again) on the same library and data, iBroadcast given [waitMs] and a file left [againMs]. */
  const start = async (waitMs, againMs) => {
    if (srv) await srv.stop();
    const port = ports.port();
    base = "http://127.0.0.1:" + port;
    srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
      ibroadcastBaseUrl: ib.base, ibroadcastUploadLimit: 50000000, ibroadcastUploadWaitMs: waitMs, ibroadcastUploadAgainMs: againMs });
    ctx = await srv.start();
    token = await signIn(base);
    await until(async () => (await state()).connected !== undefined, 30000, "the server's iBroadcast settings");
  };
  t.after(() => srv && srv.stop());
  const call = async (method, p, body) => {
    const r = await fetch(base + "/api/" + p, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const state = () => call("GET", "settings/ibroadcast");
  const hiRes = () => ib.uploads.filter(u => /Hi Res/.test(u.file_path)).length;
  const upload = async () => {
    await until(async () => (await state()).connected, 30000, "signed in to iBroadcast");
    const was = (await state()).upload?.finished || 0;
    assert.equal((await call("POST", "settings/ibroadcast/upload")).status, 200);
    const u = await until(async () => { const x = (await state()).upload; return x && !x.running && x.finished && x.finished !== was && x; }, 60000, "the upload done");
    assert.equal(u.error, null, JSON.stringify(u));
    return u;
  };
  const figures = u => ({ uploaded: u.uploaded, already: u.already, waiting: u.waiting, left: u.skipped, sent: hiRes() });

  await start(30 * MINUTES, DAY);
  await until(async () => (await call("GET", "status")).index_count >= 3, 60000, "the library");
  await call("POST", "settings/ibroadcast/signin");
  ib.approve();
  await until(async () => (await state()).connected, 15000, "signed in");
  assert.equal((await call("POST", "settings/ibroadcast/upload/settings", { from: "all", at_once: 1 })).status, 200);

  await t.test("sent a moment ago and not listed: waited for, not sent again, not counted against it", async () => {
    assert.deepEqual(figures(await upload()), { uploaded: 7, already: 0, waiting: 0, left: 0, sent: 2 });
    const u = await upload();
    assert.deepEqual(figures(u), { uploaded: 0, already: 5, waiting: 2, left: 0, sent: 2 });
    assert.deepEqual([u.files_total, u.problems.length], [0, 0], "nothing to send, nothing to say of each");
    assert.ok(ctx.logs.some(l => /0 of 7 files to look at, 5 there already as sent before, 2 sent a short while ago and waited for \(iBroadcast hasn't listed them yet\)/.test(l)),
      JSON.stringify(ctx.logs.filter(l => /ibroadcast\] upload/.test(l)).slice(-4)));
    // And again, however many times: still waited for.
    assert.deepEqual(figures(await upload()), { uploaded: 0, already: 5, waiting: 2, left: 0, sent: 2 });
  });

  if (findBrowser()) await t.test("the page says how many are waited for, in the one line", async () => {
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
      const seen = await until(() => page.eval(`(() => { const s = document.getElementById("ib-upload-status"); return s && s.offsetParent && s.textContent && /^Done/.test(s.textContent) &&
        [document.getElementById("ib-upload-progress").textContent, document.getElementById("ib-upload-problems").textContent]; })()`), 15000, "the upload on the page");
      assert.deepEqual(seen, ["0 uploaded · 5 already in iBroadcast · 2 waiting on iBroadcast", ""]);
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
  });

  await t.test("the half hour gone by: sent once more, then left, with when it is tried again", async () => {
    await start(0, DAY);
    assert.deepEqual(figures(await upload()), { uploaded: 2, already: 5, waiting: 0, left: 0, sent: 4 });
    assert.ok(ctx.logs.some(l => /Hi 1\.flac was taken before but iBroadcast hasn't it \(it said: "Track already in library"\); sent again/.test(l)), "said with iBroadcast's words");
    const u = await upload();
    assert.deepEqual(figures(u), { uploaded: 0, already: 5, waiting: 0, left: 2, sent: 4 });
    assert.equal(u.problems.length, 2);
    for (const p of u.problems) assert.equal(p.why, 'iBroadcast took it 2 times but didn\'t keep it (it said: "Track already in library"); tried again after about 24 hours');
    assert.ok(ctx.logs.some(l => /2 left for now as iBroadcast took them but didn't keep them \(from Hi Res\)/.test(l)));
  });

  await t.test("sent twice a moment ago: waited for before it is called left", async () => {
    await start(30 * MINUTES, DAY);
    assert.deepEqual(figures(await upload()), { uploaded: 0, already: 5, waiting: 2, left: 0, sent: 4 });
  });

  await t.test("its day gone by: tried again; not kept still, left for two days", async () => {
    await start(0, 1);
    assert.deepEqual(figures(await upload()), { uploaded: 2, already: 5, waiting: 0, left: 0, sent: 6 });
    await start(0, DAY);
    const u = await upload();
    assert.deepEqual(figures(u), { uploaded: 0, already: 5, waiting: 0, left: 2, sent: 6 });
    for (const p of u.problems) assert.equal(p.why, 'iBroadcast took it 3 times but didn\'t keep it (it said: "Track already in library"); tried again after about 2 days');
  });

  await t.test("listed by iBroadcast after all: there already, whatever was said of it", async () => {
    const one = ib.uploads.filter(x => /Hi 1\.flac$/.test(x.file_path)).pop();
    ib.md5s.push(one.md5);
    const u = await upload();
    assert.deepEqual(figures(u), { uploaded: 0, already: 6, waiting: 0, left: 1, sent: 6 });
    assert.match(u.problems[0].file, /Hi 2\.flac$/);
  });

  await t.test("an upload still going when a waited-for file's time comes sends it then, not at the next upload", async () => {
    // iBroadcast has the last of Hi Res now; a new album it takes and doesn't list, sent first, then eight more files, three seconds each.
    ib.md5s.push(ib.uploads.filter(x => /Hi 2\.flac$/.test(x.file_path)).pop().md5);
    ib.notKept = p => /Late/.test(p);
    for (const i of [1, 2]) gen(path.join(lib.music, "Late", "Two", `0${i} Late.flac`), { freq: 500 + 20 * i, tags: { title: "Late " + i, artist: "Late", album: "Two", track: i } });
    for (const i of [1, 2, 3, 4, 5, 6, 7, 8]) gen(path.join(lib.music, "More", "Eight", `0${i} More.flac`), { freq: 600 + 20 * i, tags: { title: "More " + i, artist: "More", album: "Eight", track: i } });
    await start(15000, DAY);
    await call("POST", "library/rescan");
    await until(async () => ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM tracks").get().n >= 17 && !(await call("GET", "status")).scanning, 90000, "the new albums");
    const late = () => ib.uploads.filter(x => /Late/.test(x.file_path)).length, more = () => ib.uploads.filter(x => /More/.test(x.file_path)).length;
    // An upload begun and stopped once the two are sent and the first of the rest is: sent a moment ago, and more to go.
    ib.uploadDelayMs = 3000;
    assert.equal((await call("POST", "settings/ibroadcast/upload")).status, 200);
    await until(() => more() >= 1, 60000, "the two sent, and one of the rest");
    assert.equal(late(), 2, "the two went first");
    await call("POST", "settings/ibroadcast/upload/stop");
    const stopped = await until(async () => { const x = (await state()).upload; return x && !x.running && x; }, 30000, "stopped");
    await until(() => ib.sending === 0, 10000, "the fake done with what it held");
    // (The file under way as it stopped may have reached iBroadcast: it is there already, or sent again.)
    assert.ok(more() <= 3, "most of the rest still to go: " + more() + " sent");
    // Begun again at once: the two are waited for, the rest go; their time comes while it runs.
    assert.equal((await call("POST", "settings/ibroadcast/upload")).status, 200);
    const going = await until(async () => { const x = (await state()).upload; return x && x.running && x.files_total > 0 && x; }, 30000, "the upload under way");
    assert.equal(going.waiting, 2, JSON.stringify(going));
    assert.ok(going.files_total >= 5 && going.files_total <= 7, "the rest to send, the two not among them: " + going.files_total);
    assert.equal(late(), 2, "not sent again as it began");
    const u = await until(async () => { const x = (await state()).upload; return x && !x.running && x.finished !== stopped.finished && x; }, 120000, "the upload done");
    ib.uploadDelayMs = 0;
    assert.equal(u.error, null, JSON.stringify(u));
    assert.equal(late(), 4, "the two waited for, sent again by the same upload once their time came");
    assert.deepEqual([u.waiting, u.files_total - going.files_total, u.files_done], [0, 2, u.files_total], JSON.stringify(u));
    assert.equal(new Set(ib.uploads.filter(x => /More/.test(x.file_path)).map(x => x.file_path)).size, 8, "and every one of the rest");
    // Each as its own time came (they were sent three seconds apart): said, and neither already there.
    const again = ctx.logs.map(l => /(\d+) put off earlier looked at again: iBroadcast has 0 now, (\d+) sent again/.exec(l)).filter(Boolean);
    assert.equal(again.reduce((n, m) => n + Number(m[2]), 0), 2, JSON.stringify(ctx.logs.filter(l => /ibroadcast\] upload/.test(l)).slice(-6)));
  });
});
