"use strict";
/*
 * The system page says which builds Mandarin follows (item 405, system-page/channel.py), read only: on dev's, Overview's
 * Mandarin row says "development builds" beside its version; on the releases, nothing more than before; and where
 * the share's Installer asks for the other (a file whose name starts with "dev", in any case, or none), that the next
 * Reinstall Mandarin moves it, and Reinstall says what it puts back. Against a stand-in box (test/os-standin.js), in a
 * browser where one is at hand for the row itself.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { standIn, noPython } = require("./os-standin");
const { Browser, findBrowser } = require("./browser-harness");

test("the system page's state: what Mandarin follows, and what the share's Installer asks for", { skip: noPython, timeout: 60000 }, async () => {
  const box = await standIn();
  try {
    const put = (p, text) => { fs.mkdirSync(path.dirname(path.join(box.root, p)), { recursive: true }); fs.writeFileSync(path.join(box.root, p), text); };
    const channel = async () => (await (await fetch(box.base + "/api/state")).json()).mandarin.channel;
    assert.deepEqual(await channel(), { now: "latest", wanted: "latest" }, box.stderr());
    put("data/Installer/README.txt", "Used by Mandarin's reinstaller. Leave it as it is.\n");
    put("data/Installer/._dev.bin", "a Mac's own file beside a copy");
    assert.deepEqual(await channel(), { now: "latest", wanted: "latest" });
    put("data/Installer/Dev.bin", "");
    assert.deepEqual(await channel(), { now: "latest", wanted: "dev" });
    put("data/MachineSettings/mandarin-channel.env", "MANDARIN_CHANNEL=dev\n");
    assert.deepEqual(await channel(), { now: "dev", wanted: "dev" });
    // Reinstall says what it puts back (and does it).
    const r = await fetch(box.base + "/api/mandarin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: box.password, action: "reinstall" }) });
    assert.match((await r.json()).said, /put back from the development builds/);
  } finally { await box.stop(); }
});

const skipPage = noPython || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

test("Overview's Mandarin row: development builds beside the version, and the change the next Reinstall makes", { skip: skipPage, timeout: 120000 }, async () => {
  const box = await standIn();
  const b = await Browser.launch({ width: 412, height: 900 });
  try {
    const put = (p, text) => { fs.mkdirSync(path.dirname(path.join(box.root, p)), { recursive: true }); fs.writeFileSync(path.join(box.root, p), text); };
    const row = async () => {
      const page = await b.page(box.base + "/");
      return page.eval(`(async () => { for (let i = 0; i < 200; i++) { const r = [...document.querySelectorAll("#status-rows .row")].find(r => r.querySelector("b").textContent === "Mandarin");
        if (r && /Version/.test(r.textContent)) return r.querySelector("small").textContent; await new Promise(r => setTimeout(r, 50)); } return null; })()`);
    };
    assert.equal(await row(), "Version 1.3.1-t1 · 1,234 albums · 3 rooms", "the releases: as before");
    put("data/Installer/dev.bin", "");
    assert.equal(await row(), "Version 1.3.1-t1 · development builds at the next Reinstall · 1,234 albums · 3 rooms");
    put("data/MachineSettings/mandarin-channel.env", "MANDARIN_CHANNEL=dev\n");
    assert.equal(await row(), "Version 1.3.1-t1 · development builds · 1,234 albums · 3 rooms");
    fs.rmSync(path.join(box.root, "data/Installer/dev.bin"));
    assert.equal(await row(), "Version 1.3.1-t1 · development builds · the latest release at the next Reinstall · 1,234 albums · 3 rooms");
  } finally { await b.close(); await box.stop(); }
});
