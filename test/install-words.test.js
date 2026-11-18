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
const { until } = require("./helpers");

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
    // What status says once a scan has ended and been read ([ok] of its answer). A scan's end comes late with the
    // machine busy (item 475: it runs at the lowest priority), two of them where the watcher's follows one asked for
    // here: 45 s. The first scan was given 10 s and the test went on whether it had ended or not, to a page still
    // saying "Scanning your music folder…" (item 476, found running this under load).
    const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    const status = async () => (await fetch(B + "/api/status", { headers: H })).json();
    const scanned = (ok, what) => until(async () => { const s = await status(); return ok(s) && s; }, 45000, what);
    await scanned(s => s.scan && !s.scan.running && s.scan.last && s.scan.last.status, "the first scan");
    const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
    const said = await page.eval(`(async () => { for (let i = 0; i < 300; i++) { const t = document.body.innerText; if (/No music yet|No audio files/.test(t)) return t; await new Promise(r => setTimeout(r, 50)); } return document.body.innerText; })()`);
    assert.match(said, /No music yet\. Copy it into Storage in smb:\/\/mandarin\/data, or plug in a USB drive/, said.slice(0, 400));
    assert.doesNotMatch(said, /-v …/);
    // A USB drive with music on it, then unplugged: its tracks kept, and the way back is to plug it in again (not a
    // container's -v line, not a mount).
    const album = path.join(music, "USB", "Artist", "Album");
    fs.mkdirSync(album, { recursive: true });
    gen(path.join(album, "01.flac"), { seconds: 1, tags: { artist: "Artist", album: "Album", title: "One", track: "1" } });
    // A rescan answers after 8 s at most, and "busy" while another scan runs (the watcher's, on what was just written),
    // so its answer alone doesn't say the library is as the test left it: what status says is waited for.
    let r = await (await fetch(B + "/api/library/rescan", { method: "POST", headers: H, body: "{}" })).json();
    await scanned(s => s.index_count === 1, "the drive's album in the library");
    fs.renameSync(path.join(music, "USB"), path.join(dir, "unplugged"));
    r = await (await fetch(B + "/api/library/rescan", { method: "POST", headers: H, body: "{}" })).json();
    // The page opened once the server knows the drive is gone, its track kept. Opened before (item 476), it drew an
    // empty library where the first of these scans hadn't ended, and reloaded itself as that scan did (server-notice.js:
    // the first scan finished after the page drew an empty Home), under the reading below.
    await scanned(s => s.index_count === 1 && ((s.scan && s.scan.last && s.scan.last.offline_dirs) || []).some(d => d.name === "Storage" && d.tracks === 1), "the drive known gone, its track kept");
    const gone = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
    const kept = await gone.eval(`(async () => { for (let i = 0; i < 300; i++) { const t = document.body.innerText; if (/tracks are kept, not removed/.test(t)) return t; await new Promise(r => setTimeout(r, 50)); } return document.body.innerText; })()`);
    assert.match(kept, /The music folder “Storage” is empty — its 1 tracks are kept, not removed\. Plug the drive in again and they're back as they were\./, JSON.stringify(r) + kept.slice(0, 400));
    assert.doesNotMatch(kept, /container/);
  } finally { await b.close(); await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
