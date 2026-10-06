"use strict";
/*
 * Audio Devices → Hide / unhide (v0.7.2), in a browser: the mode's tick
 * circles, Cancel then OK, the notice, the shorter list with its count, and
 * a hidden device brought back from under Hidden.
 * Skipped where no Chromium or Chrome is found (test/browser-harness.js).
 */
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { FakeHousehold } = require("./fake-sonos");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = 3642, B = "http://127.0.0.1:" + PORT;

test("Audio Devices: Hide / unhide ticks, OK, the notice, and bringing one back", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: ["127.0.0.11"], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    for (let i = 0; i < 100; i++) {
      const st = await (await fetch(B + "/api/status", { headers: H })).json();
      const devs = (await (await fetch(B + "/api/audio-devices", { headers: H })).json()).devices || [];
      if (st.index_count === 3 && devs.length >= 2) break;
      await new Promise(r => setTimeout(r, 150));
    }
    const b = await Browser.launch({ width: 390, height: 844 });
    let r;
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      r = await page.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const $ = id => document.getElementById(id);
        const until = async (f, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(50); } };
        const out = {};
        await until(() => document.querySelector("#home-random .album, #home-today .album"));
        $("settings-toggle").click(); await sleep(400);
        document.querySelector('.settings-nav-item[data-pane="playback"]').click();
        await until(() => document.querySelectorAll("#devices-list .dev-row").length >= 2);
        const rows = () => [...document.querySelectorAll("#devices-list .dev-row")];
        const names = () => rows().map(x => x.querySelector(".dev-name").textContent);
        out.before = names();
        out.button0 = $("devices-hide").textContent;
        $("devices-hide").click(); await sleep(150);
        out.selecting = { button: $("devices-hide").textContent, picks: document.querySelectorAll("#devices-list .dev-pick").length, look_again_hidden: $("devices-rescan").classList.contains("hidden"), note: !$("devices-hide-note").classList.contains("hidden") };
        const study = rows().find(x => x.querySelector(".dev-name").textContent === "Study");
        study.querySelector("[data-pick]").click(); await sleep(150);
        out.picked = { button: $("devices-hide").textContent, ticked: document.querySelectorAll("#devices-list .dev-row.is-picked").length, tick_svg: !!document.querySelector("#devices-list .dev-row.is-picked .dev-pick svg") };
        $("devices-hide").click();
        await until(() => !$("confirm-overlay").classList.contains("hidden"));
        out.notice = { text: $("confirm-msg").textContent, no_hidden: $("confirm-no").classList.contains("hidden"), ok: $("confirm-yes").textContent };
        $("confirm-yes").click(); await sleep(300);
        await until(() => document.querySelector("#devices-list .dev-hidden-count"));
        out.after = { names: names(), count: (document.querySelector("#devices-list .dev-hidden-count") || {}).textContent, button: $("devices-hide").textContent };
        // Back: the mode again lists it under Hidden; ticked and OK, it returns.
        $("devices-hide").click(); await sleep(150);
        out.again = { rule: !!document.querySelector("#devices-list .dev-rule"), hidden_rows: rows().filter(x => x.classList.contains("is-hidden")).map(x => x.querySelector(".dev-name").textContent) };
        rows().find(x => x.classList.contains("is-hidden")).querySelector("[data-pick]").click(); await sleep(100);
        $("devices-hide").click();
        await until(() => !$("confirm-overlay").classList.contains("hidden"));
        out.notice2 = $("confirm-msg").textContent;
        $("confirm-yes").click(); await sleep(300);
        await until(() => !document.querySelector("#devices-list .dev-hidden-count") && names().includes("Study"));
        out.restored = names();
        return out;
      })()`);
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
    assert.ok(r.before.includes("Study") && r.before.includes("Kitchen"), r.before.join(", "));
    assert.equal(r.button0, "Hide / unhide");
    assert.deepEqual(r.selecting, { button: "Cancel", picks: r.before.length, look_again_hidden: true, note: true }, "selecting: a tick circle on every row, Cancel until a tick");
    assert.deepEqual(r.picked, { button: "OK", ticked: 1, tick_svg: true }, "one ticked: the button is OK");
    assert.match(r.notice.text, /1 device hidden/);
    assert.match(r.notice.text, /tap Hide \/ unhide again/i, "the notice says how to bring it back");
    assert.equal(r.notice.no_hidden, true); assert.equal(r.notice.ok, "OK");
    assert.ok(!r.after.names.includes("Study") && r.after.names.includes("Kitchen"), "hidden, off the list");
    assert.equal(r.after.count, "1 device hidden");
    assert.equal(r.after.button, "Hide / unhide");
    assert.deepEqual(r.again, { rule: true, hidden_rows: ["Study"] }, "listed again under Hidden");
    assert.match(r.notice2, /1 device shown again/);
    assert.ok(r.restored.includes("Study"), "back on the list");
  } finally { await srv.stop(); await house.stop(); }
});
