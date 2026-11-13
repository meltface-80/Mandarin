"use strict";
/*
 * Mandarin OS's system page in a browser (item 399, 0.1.3), from the OptiPlex's 0.1.2:
 *   - "The box isn't answering: is it on?" stayed up for good after one read went unanswered (a phone waking the tab),
 *     however many were answered after it. It now says so after two in a row, and goes as soon as one is answered;
 *     what an action said stays.
 *   - a Linux drive whose files are another computer's says so on the Storage tab, with "Make them the shared folder's".
 * The page's reads made to fail in the page itself (its fetch), the box a stand-in (test/os-standin.js).
 */
const test = require("node:test");
const assert = require("node:assert");
const { standIn, noPython } = require("./os-standin");
const { Browser, findBrowser } = require("./browser-harness");

const skip = noPython || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

test("the system page: not answering said after two reads missed, taken away by the next; a Linux drive's button", { skip, timeout: 120000 }, async () => {
  const box = await standIn({ linuxDrives: true });
  const b = await Browser.launch({ width: 412, height: 900 });
  try {
    const page = await b.page(box.base + "/");
    const wait = (js) => page.eval(`(async () => { for (let i = 0; i < 200; i++) { const v = (${js}); if (v) return v; await new Promise(r => setTimeout(r, 50)); } return null; })()`);
    assert.ok(await wait(`document.querySelectorAll("#services .state").length > 5`), "the page read");
    // Reads that go unanswered, while window.miss is set; a read asked for now (as a phone's tab coming back asks it).
    await page.eval(`(() => { const f = window.fetch; window.fetch = (u, o) => window.miss && String(u).includes("/api/state") ? Promise.reject(new TypeError("Failed to fetch")) : f(u, o); })()`);
    const read = () => page.eval(`(async () => { document.dispatchEvent(new Event("visibilitychange")); await new Promise(r => setTimeout(r, 300)); const b = document.getElementById("banner"); return b.classList.contains("hidden") ? "" : b.textContent; })()`);
    await page.eval(`window.miss = true`);
    assert.equal(await read(), "", "one read missed: nothing said");
    assert.equal(await read(), "The box isn't answering: is it on?", "two in a row");
    assert.equal(await read(), "The box isn't answering: is it on?");
    await page.eval(`window.miss = false`);
    assert.equal(await read(), "", "answered: taken away");
    // What an action said stays when the next read is answered.
    await page.eval(`(() => { const b = document.getElementById("banner"); b.textContent = "Old Drive can be unplugged now."; b.classList.remove("hidden"); })()`);
    assert.equal(await read(), "Old Drive can be unplugged now.");

    await page.eval(`document.querySelector('nav button[data-tab="storage"]').click()`);
    assert.ok(await wait(`document.querySelector('#usb button[data-own="Old Drive"]')`), "the button, on the drive's row");
    assert.match(await page.eval(`document.getElementById("usb").innerText`), /Old Drive[\s\S]*another computer's: the shared folder copies from it, but can't move, rename or delete on it/);
    assert.ok(await page.eval(`!document.querySelector('#usb button[data-own="Music SSD"]')`), "none on an exFAT drive");
    await page.eval(`document.querySelector('#usb button[data-own="Old Drive"]').click()`);
    assert.match(await page.eval(`document.getElementById("ask").open && document.getElementById("ask-title").textContent`), /Make Old Drive's files the shared folder's/, "asks for the password first");
    assert.ok(await page.eval(`document.documentElement.scrollWidth <= window.innerWidth`), "no page wider than the phone");
  } finally { await b.close(); await box.stop(); }
});
