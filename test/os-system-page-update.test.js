"use strict";
/*
 * Mandarin OS's own update on its system page (item 401, 0.1.4), against the stand-in box (test/os-standin.js), whose
 * systemctl leaves what os-update's units would: a check finds 0.1.5, Update and restart begins its download.
 *   - /api/state says the version running, a newer one out, the update under way and how far, and what the last one
 *     came to (/data/MandarinOS/update-last.json, os-started's), and the shared folder's user's number;
 *   - POST /api/os-update asks the share's password, as every change: check runs the check's unit and says what it
 *     found; apply starts the update's own unit (never in the page's process) only when a newer one is out, and never
 *     a second while one is under way;
 *   - the page, in a browser: the Settings tab's Mandarin OS row with Update and restart and Check for updates, the
 *     password asked first, the progress while it updates, and, after a new version that didn't start, that the box
 *     went back to the version before by itself.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { standIn, noPython, PASSWORD } = require("./os-standin");
const { Browser, findBrowser } = require("./browser-harness");

const put = (box, p, j) => { fs.mkdirSync(path.dirname(path.join(box.root, p)), { recursive: true }); fs.writeFileSync(path.join(box.root, p), JSON.stringify(j)); };

test("the system page's Mandarin OS update: its state, its password, check, then apply in a unit of its own", { skip: noPython, timeout: 60000 }, async () => {
  const box = await standIn();
  const B = box.base;
  try {
    const post = body => fetch(B + "/api/os-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const update = async () => (await (await fetch(B + "/api/state")).json()).os.update;
    let u = await update();
    assert.deepEqual([u.version, u.available, u.state, u.last], ["0.1.0", null, "idle", null], box.stderr());
    assert.match((await (await fetch(B + "/api/state")).json()).share.uid, /^\d+$/, "the shared folder's user's number, as the system has it");

    assert.equal((await post({ password: "wrong", action: "check" })).status, 401);
    assert.equal((await post({ password: PASSWORD, action: "apply" })).status, 409, "nothing newer known: nothing to apply");
    assert.equal((await post({ password: PASSWORD, action: "nope" })).status, 400);
    let r = await post({ password: PASSWORD, action: "check" });
    assert.equal(r.status, 200);
    assert.match((await r.json()).said, /Mandarin OS 0\.1\.5 is out/);
    assert.equal((await update()).available, "0.1.5");

    r = await post({ password: PASSWORD, action: "apply" });
    assert.equal(r.status, 200);
    assert.match((await r.json()).said, /0\.1\.5 is being downloaded and written beside this one/);
    assert.match(box.calls(), /^systemctl start --no-block mandarin-os-update@apply\.service$/m, "its own unit, not the page's process");
    u = await update();
    assert.deepEqual([u.state, u.progress], ["downloading", 20]);
    assert.equal((await post({ password: PASSWORD, action: "apply" })).status, 409, "one at a time");
    assert.equal(box.calls().match(/mandarin-os-update@apply/g).length, 1);

    put(box, "/data/MandarinOS/update-last.json", { result: "failed", from: "0.1.0", to: "0.1.5", at: "2026-11-13 03:10 UTC" });
    assert.deepEqual((await update()).last, { result: "failed", from: "0.1.0", to: "0.1.5", at: "2026-11-13 03:10 UTC" });
  } finally { await box.stop(); }
});

const skipBrowser = noPython || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

test("the system page's Mandarin OS update in a browser: offered, asked for with the password, its progress, a fallback said", { skip: skipBrowser, timeout: 120000 }, async () => {
  const box = await standIn();
  const b = await Browser.launch({ width: 412, height: 900 });
  try {
    put(box, "/run/mandarin-os/os-update.json", { state: "idle", available: "0.1.5", checked: "2026-11-13 09:00 UTC", error: "" });
    const page = await b.page(box.base + "/");
    const wait = (js) => page.eval(`(async () => { for (let i = 0; i < 200; i++) { const v = (${js}); if (v) return v; await new Promise(r => setTimeout(r, 50)); } return null; })()`);
    const text = () => page.eval(`document.getElementById("os-update").innerText`);
    await page.eval(`document.querySelector('nav button[data-tab="settings"]').click()`);
    assert.ok(await wait(`document.querySelector('#os-update button[data-os="apply"]')`), "Update and restart, a newer one being out");
    assert.match(await text(), /Mandarin OS 0\.1\.0[\s\S]*Mandarin OS 0\.1\.5 is out[\s\S]*goes back to 0\.1\.0 by itself/);
    assert.ok(await page.eval(`!!document.querySelector('#os-update button[data-os="check"]')`), "and Check for updates");
    assert.match(await page.eval(`document.getElementById("status-rows").innerText`), /Update available/, "the Overview says so");

    await page.eval(`document.querySelector('#os-update button[data-os="apply"]').click()`);
    assert.match(await page.eval(`document.getElementById("ask").open && document.getElementById("ask-title").textContent`), /Update and restart/, "the password asked first");
    await page.eval(`(() => { document.getElementById("ask-pass").value = ${JSON.stringify(PASSWORD)}; document.getElementById("ask-go").click(); })()`);
    assert.ok(await wait(`/Downloading Mandarin OS 0\\.1\\.5/.test(document.getElementById("os-update").innerText) && document.querySelector("#os-update .bar")`), "its progress, read again while it works");
    assert.ok(await page.eval(`!document.querySelector('#os-update button')`), "no buttons while it updates");
    assert.match(box.calls(), /mandarin-os-update@apply\.service/);

    // Back on 0.1.0 by itself: 0.1.5 didn't start in its three tries.
    put(box, "/run/mandarin-os/os-update.json", { state: "idle", available: "0.1.5", checked: "2026-11-13 09:00 UTC", error: "" });
    put(box, "/data/MandarinOS/update-last.json", { result: "failed", from: "0.1.0", to: "0.1.5", at: "2026-11-13 03:10 UTC" });
    await page.eval(`document.dispatchEvent(new Event("visibilitychange"))`);
    assert.ok(await wait(`/didn't start: the box went back to 0\\.1\\.0 by itself/.test(document.getElementById("os-update").innerText)`), await text());
    assert.ok(await page.eval(`document.documentElement.scrollWidth <= window.innerWidth`), "no page wider than the phone");
  } finally { await b.close(); await box.stop(); }
});
