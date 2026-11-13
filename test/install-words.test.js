"use strict";
/*
 * What the page says to do is for how the server is installed (item 389): on Mandarin OS, which has no shell and no
 * container, the login's forgotten password says to type passwordreset at the box's screen (not a docker command),
 * and an empty library says to copy music into its share or plug in a USB drive (not a -v mount).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { haveFfmpeg, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

test("on Mandarin OS the page says what to do there: passwordreset at its screen, its share for music", { skip, timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-install-words-"));
  const music = path.join(dir, "Storage"), data = path.join(dir, "data");
  fs.mkdirSync(music); fs.mkdirSync(data);
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: music, dataDir: data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, mandarinOs: "0.1.0" });
  await srv.start();
  const b = await Browser.launch({ width: 1280, height: 900 });
  try {
    // Before anyone is signed in: the login's foot.
    const login = await b.page(B + "/login");
    const forgot = await login.eval(`(async () => { for (let i = 0; i < 200; i++) { const t = document.getElementById("forgot").textContent; if (/passwordreset/.test(t)) return t; await new Promise(r => setTimeout(r, 50)); } return document.getElementById("forgot").textContent; })()`);
    assert.match(forgot, /At the Mandarin OS box's own screen .* type passwordreset, then create the account again/);
    assert.doesNotMatch(forgot, /docker/);
    // Signed in, an empty library: its share and a USB drive, not a container's mount.
    const token = await signIn(B);
    for (let i = 0; i < 100; i++) { const st = await (await fetch(B + "/api/status", { headers: { Authorization: "Bearer " + token } })).json(); if (st.scan && st.scan.last && st.scan.last.status) break; await new Promise(r => setTimeout(r, 100)); }
    const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
    const said = await page.eval(`(async () => { for (let i = 0; i < 300; i++) { const t = document.body.innerText; if (/No music yet|No audio files/.test(t)) return t; await new Promise(r => setTimeout(r, 50)); } return document.body.innerText; })()`);
    assert.match(said, /No music yet\. Copy it into Storage in smb:\/\/mandarin\/data, or plug in a USB drive/, said.slice(0, 400));
    assert.doesNotMatch(said, /-v …/);
    // A USB drive with music on it, then unplugged: its tracks kept, and the way back is to plug it in again (not a
    // container's -v line, not a mount).
    const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    const album = path.join(music, "USB", "Artist", "Album");
    fs.mkdirSync(album, { recursive: true });
    gen(path.join(album, "01.flac"), { seconds: 1, tags: { artist: "Artist", album: "Album", title: "One", track: "1" } });
    let r = await (await fetch(B + "/api/library/rescan", { method: "POST", headers: H, body: "{}" })).json();
    fs.renameSync(path.join(music, "USB"), path.join(dir, "unplugged"));
    r = await (await fetch(B + "/api/library/rescan", { method: "POST", headers: H, body: "{}" })).json();
    const gone = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
    const kept = await gone.eval(`(async () => { for (let i = 0; i < 300; i++) { const t = document.body.innerText; if (/tracks are kept, not removed/.test(t)) return t; await new Promise(r => setTimeout(r, 50)); } return document.body.innerText; })()`);
    assert.match(kept, /The music folder “Storage” is empty — its 1 tracks are kept, not removed\. Plug the drive in again and they're back as they were\./, JSON.stringify(r) + kept.slice(0, 400));
    assert.doesNotMatch(kept, /container/);
  } finally { await b.close(); await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
