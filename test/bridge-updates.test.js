"use strict";
/*
 * Mandarin Bridges on Settings → Updates (item 291, Admin/BridgeUpdates.cs, bridge/linux Update.cs), end to end with
 * Mandarin Bridge for Linux itself and a GitHub of the test's own:
 *   - the Bridge listed with its build, the build published for its machine (the release's sidecar), and an update;
 *   - on the page, Check for update as the server's row: Up to date, then a newer build found at once (item 293);
 *   - Update: the Bridge fetches the release itself, checks the tarball against the sidecar's checksum, unpacks it
 *     and stops; started again (as systemd does), the program installed hands over to the update;
 *   - an update that fails as it starts let go, the program installed running on;
 *   - refused: a tag that isn't a Bridge release's, a download whose checksum isn't the release's.
 */
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const ports = require("./ports");
const { haveFfmpeg, makeLibrary, FFMPEG } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const ROOT = path.join(__dirname, "..");
const BRIDGE = path.join(ROOT, "bridge", "linux", "bin", "mandarin-bridge");
const ENGINE = path.join(ROOT, "engine", "bin", "mandarin-audio");
const built = fs.existsSync(BRIDGE) && fs.existsSync(ENGINE);
const skip = !haveFfmpeg() ? "ffmpeg is not installed" : !built && !process.env.CI && "bridge/linux/build.sh and engine/build.sh not run";
const PORT = ports.port(), BRIDGE_PORT = ports.port(), SLIM = ports.port();
// Its SlimProto id: six bytes from its UDN, locally administered (bridge/linux/Mandarin.Bridge/Slim.cs).
const slimId = udn => { const h = crypto.createHash("sha256").update(udn).digest().subarray(0, 6); h[0] = (h[0] & 0xfc) | 0x02; return "SLIM_" + h.toString("hex").toUpperCase(); };
const B = "http://127.0.0.1:" + PORT, BR = "http://127.0.0.1:" + BRIDGE_PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(150);
  }
}
const ARCH = "linux-" + (process.arch === "arm64" ? "arm64" : "x64");

// A computer with a Chord Mojo on its USB port, as the kernel lists it.
function asound(root) {
  const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); };
  w("cards", " 1 [Mojo           ]: USB-Audio - Chord Mojo\n                      Chord Electronics Ltd Chord Mojo at usb-0000:00:14.0-2, high speed\n");
  w("card1/usbid", "20b1:301f\n");
  w("card1/pcm0p/info", "name: USB Audio\n");
  w("card1/stream0", ["Chord Electronics Ltd Chord Mojo at usb-0000:00:14.0-2, high speed : USB Audio", "", "Playback:", "  Status: Stop",
    "  Interface 1", "    Altset 1", "    Format: S32_LE", "    Channels: 2", "    Endpoint: 0x01 (1 OUT) (ASYNC)", "    Rates: 44100, 96000", "    Bits: 32", ""].join("\n"));
}

// A Bridge build as a release carries it: mandarin-bridge/ (the program, its engine) as a tarball. [program] is the
// update's program: a script that says it is "fffffff" and, run, leaves [marker] and runs the Bridge built here.
function tarball(dir, program) {
  const pkg = path.join(dir, "pkg", "mandarin-bridge");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "mandarin-bridge"), program, { mode: 0o755 });
  fs.copyFileSync(ENGINE, path.join(pkg, "mandarin-audio"));
  fs.chmodSync(path.join(pkg, "mandarin-audio"), 0o755);
  const out = path.join(dir, `mandarin-bridge-${ARCH}.tar.gz`);
  assert.equal(spawnSync("tar", ["-C", path.join(dir, "pkg"), "-czf", out, "mandarin-bridge"]).status, 0);
  return fs.readFileSync(out);
}

test("a Mandarin Bridge offered its update on Settings → Updates, and updated from there", { skip, timeout: 180000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-bridge-update-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  asound(path.join(tmp, "asound"));
  const marker = path.join(tmp, "ran-the-update");
  const good = tarball(path.join(tmp, "good"), `#!/bin/sh\nif [ "$1" = --version ]; then echo "mandarin-bridge 9.9.9 (fffffff)"; exit 0; fi\necho ran > "${marker}"\nexec "${BRIDGE}" "$@"\n`);
  const broken = tarball(path.join(tmp, "broken"), `#!/bin/sh\nif [ "$1" = --version ]; then echo "mandarin-bridge 9.9.9 (eeeeeee)"; exit 0; fi\nexit 3\n`);

  // GitHub, as Mandarin and the Bridge ask it: a numbered release of the Bridge's, its tarball and the tarball's sidecar.
  let tar = good, sha = crypto.createHash("sha256").update(good).digest("hex");
  let published = { commit: "fffffff", version: "9.9.9" };   // the build the release says it holds
  const asks = [];
  let away = false;   // GitHub refusing every ask, as it does at its limit
  const gh = http.createServer((req, res) => {
    asks.push(req.url);
    // As GitHub: a request that doesn't say what it is (no User-Agent) refused (item 327).
    if (!req.headers["user-agent"]) { res.writeHead(403, { "Content-Type": "text/plain" }); return res.end("Request forbidden by administrative rules. Please make sure your request has a User-Agent header"); }
    if (away && req.headers["user-agent"].startsWith("mandarin-bridge")) { res.writeHead(503); return res.end(); }
    const json = o => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    const at = n => `http://127.0.0.1:${gh.address().port}/download/${n}`;
    if (req.url.startsWith("/repos/meltface-80/Mandarin/releases?")) return json([{ tag_name: "v1.1.14" }, { tag_name: "mandarin-bridge-v9.0.0" }]);
    if (req.url === "/repos/meltface-80/Mandarin/releases/tags/mandarin-bridge-v9.0.0") {
      return json({ tag_name: "mandarin-bridge-v9.0.0", assets: [`mandarin-bridge-${ARCH}.tar.gz`, `mandarin-bridge-${ARCH}.tar.gz.json`].map(n => ({ name: n, browser_download_url: at(n) })) });
    }
    if (req.url === `/download/mandarin-bridge-${ARCH}.tar.gz.json`) return json({ commit: published.commit, version: published.version, sha256: sha });
    if (req.url === `/download/mandarin-bridge-${ARCH}.tar.gz`) { res.writeHead(200); return res.end(tar); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => gh.listen(0, "127.0.0.1", r));
  t.after(() => gh.close());
  const API = `http://127.0.0.1:${gh.address().port}`;

  // The Bridge, as systemd runs it: started again whenever it stops.
  const data = path.join(tmp, "data");
  let said = "";
  const run = () => {
    const p = spawn(BRIDGE, ["--port", String(BRIDGE_PORT), "--data", data, "--asound", path.join(tmp, "asound"), "--device", "file:" + path.join(tmp, "dac.raw"),
      "--address", "127.0.0.1", "--engine", ENGINE, "--ffmpeg", FFMPEG, "--update-api", API, "--server", "127.0.0.1:" + SLIM], { stdio: ["ignore", "ignore", "pipe"] });
    p.stderr.on("data", d => { said += d; });
    p.exited = new Promise(r => p.on("exit", code => r(code)));
    return p;
  };
  let bridge = run();
  t.after(() => bridge.kill());
  const dac = await until(async () => (await fetch(BR + "/dac.json")).json(), 15000);
  const commit = spawnSync(BRIDGE, ["--version"]).stdout.toString().match(/\(([^)]+)\)/)[1];
  assert.deepEqual([dac.platform, dac.arch, dac.commit, dac.updates, dac.update.state], ["linux", ARCH, commit, true, "idle"], JSON.stringify(dac));
  // One version for every Bridge: the Android app's versionName, not the server's (item 293).
  const bridgeVersion = /versionName = "([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, "bridge", "android", "app", "build.gradle.kts"), "utf8"))[1];
  assert.equal(dac.version, bridgeVersion, "the Linux Bridge says the Bridge's version");

  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  t.after(() => house.stop());
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpMulticast: false, updateApi: API, slimprotoPort: SLIM });
  await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  const auth = { Authorization: "Bearer " + token };
  const api = async (p, body) => {
    const r = await fetch(B + "/api/" + p, body ? { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify(body) } : { headers: auth });
    return { status: r.status, ...await r.json().catch(() => ({})) };
  };
  const ID = slimId(dac.udn);

  // Listed, with its build and the one published, the same: whether or not it is a zone yet, nothing to install.
  published = { commit, version: dac.version };
  const row = (await until(async () => (await api("update/bridges")).bridges.find(b => b.id === ID), 20000));
  const list = await api("update/bridges");
  assert.equal(list.tag, "mandarin-bridge-v9.0.0", "a numbered Mandarin follows the numbered Bridge releases");
  assert.deepEqual([row.platform, row.commit, row.reachable, row.updates, row.available, row.why], ["linux", commit, true, true, false, null], JSON.stringify(row));
  assert.deepEqual(row.latest, published);

  // A newer build published: GitHub's answer is kept a minute, so the list says nothing yet; asked afresh (Check for
  // update, item 293), it is there, and the Bridge has an update.
  const newer = () => { published = { commit: "fffffff", version: "9.9.9" }; };
  if (findBrowser()) {
    // On the page's Settings → Updates: its row under the server's, its name and version, Check for update, as the
    // server's row; a tap says Up to date, then, a newer build published, Update available.
    const b = await Browser.launch({ width: 412, height: 915 });
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      const seen = () => page.eval(`[...document.querySelectorAll("#update-bridges .settings-row")].map(x =>
        [x.querySelector('[data-parity="settings-system.name"]').textContent, x.querySelector('[data-parity="settings-system.bridge-update"]').textContent])`);
      const tap = () => page.eval(`document.querySelector('#update-bridges [data-parity="settings-system.bridge-update"]').click()`);
      await page.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < 100 && !document.querySelector("#settings-toggle"); i++) await sleep(100);
        document.querySelector("#settings-toggle").click(); await sleep(300);
        document.querySelector('.settings-nav-item[data-pane="system"]').click();
      })()`);
      const name = row.name + " · Bridge v" + dac.version;
      assert.deepEqual(await until(async () => { const r = await seen(); return r.length && r; }), [[name, "Check for update"]]);
      await tap();
      assert.deepEqual(await until(async () => { const r = await seen(); return r[0][1] === "Up to date" && r; }, 10000), [[name, "Up to date"]]);
      assert.deepEqual(await until(async () => { const r = await seen(); return r[0][1] === "Check for update" && r; }, 10000), [[name, "Check for update"]]);
      newer();
      assert.equal((await api("update/bridges")).bridges.find(b => b.id === ID).available, false, "GitHub's answer kept");
      await tap();
      assert.deepEqual(await until(async () => { const r = await seen(); return r[0][1] === "Update available" && r; }, 10000), [[name, "Update available"]]);
    } finally { await b.close(); }
  } else {
    newer();
    assert.equal((await api("update/bridges")).bridges.find(b => b.id === ID).available, false, "GitHub's answer kept");
  }
  const fresh = (await api("update/bridges?fresh=1")).bridges.find(b => b.id === ID);
  assert.deepEqual([fresh.available, fresh.latest], [true, { commit: "fffffff", version: "9.9.9" }], JSON.stringify(fresh));

  // GitHub refusing the Bridge: it says so, in words.
  away = true;
  assert.equal((await api("update/bridges/apply", { id: ID })).status, 200);
  const refused = await until(async () => { const d = await (await fetch(BR + "/dac.json")).json(); return d.update.state === "failed" && d.update; });
  assert.equal(refused.says, "The update couldn't be installed: GitHub answered 503 (ServiceUnavailable)");
  if (findBrowser()) {
    // On the page: Try the update again, and under the row what the Bridge said. A Bridge's long name, as on a phone
    // (412 wide), wraps beside the button, the button's words left on one line (item 327: they were a letter a line).
    const b = await Browser.launch({ width: 412, height: 915 });
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      await page.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < 100 && !document.querySelector("#settings-toggle"); i++) await sleep(100);
        document.querySelector("#settings-toggle").click(); await sleep(300);
        document.querySelector('.settings-nav-item[data-pane="system"]').click();
      })()`);
      const seen = await until(async () => { const r = await page.eval(`(() => {
        const btn = document.querySelector('#update-bridges [data-parity="settings-system.bridge-update"]');
        const why = document.querySelector('#update-bridges [data-parity="settings-system.bridge-why"]');
        if (!btn || !why) return null;
        document.querySelector('#update-bridges [data-parity="settings-system.name"]').textContent = "Mandarin Bridge (DietPi) · Bridge v0.3.0";
        const text = document.createRange(); text.selectNodeContents(btn);
        return { words: btn.textContent, why: why.textContent, lines: text.getClientRects().length };
      })()`); return r; }, 10000);
      assert.deepEqual([seen.words, seen.why], ["Try the update again", refused.says]);
      assert.equal(seen.lines, 1, "the button's words on one line beside a long name");
    } finally { await b.close(); }
  }
  away = false;

  // A download that isn't the release's build: refused, nothing put in place.
  sha = "0".repeat(64);
  assert.equal((await api("update/bridges/apply", { id: ID })).status, 200);
  const failed = await until(async () => { const d = await (await fetch(BR + "/dac.json")).json(); return d.update.state === "failed" && d.update; });
  assert.match(failed.says, /checksum differs/);
  assert.ok(!fs.existsSync(path.join(data, "app")), "nothing put in place");
  sha = crypto.createHash("sha256").update(good).digest("hex");

  // Update: fetched, checked, unpacked; the Bridge stops, and started again runs the update.
  const r = await api("update/bridges/apply", { id: ID });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(await Promise.race([bridge.exited, sleep(30000).then(() => "still running")]), 0, said);
  assert.ok(fs.existsSync(path.join(data, "app", "mandarin-bridge")) && fs.existsSync(path.join(data, "app", "mandarin-audio")));
  assert.ok(asks.some(u => u === `/download/mandarin-bridge-${ARCH}.tar.gz`), "the Bridge fetched the release itself");
  bridge = run();
  await until(async () => (await fetch(BR + "/dac.json")).ok, 15000);
  assert.ok(fs.existsSync(marker), "started again, it ran the update: " + said);
  assert.match(said, /update: running .*app\/mandarin-bridge/);

  // Stopped, as systemd stops it: the update it runs stops with it.
  bridge.kill();
  await bridge.exited;
  await until(async () => !(await fetch(BR + "/dac.json").then(() => true, () => false)), 10000);

  // An update that fails as it starts: let go, and the program installed runs on.
  fs.rmSync(path.join(data, "app"), { recursive: true, force: true });
  assert.equal(spawnSync("tar", ["-xzf", "-", "-C", data], { input: broken }).status, 0);
  fs.renameSync(path.join(data, "mandarin-bridge"), path.join(data, "app"));
  bridge = run();
  await until(async () => (await fetch(BR + "/dac.json")).ok, 30000);
  await until(() => /stopped as it started \(exit 3\); let go/.test(said), 5000);
  assert.ok(!fs.existsSync(path.join(data, "app")), "the update that failed is gone");

  // Refused: a tag that isn't a Bridge release's (never an address); a release older than this one (item 352); and
  // anything but JSON, as a web page's plain form would send it.
  const upd = (tag, type = "application/json") => fetch(BR + "/update", { method: "POST", headers: { "Content-Type": type }, body: JSON.stringify({ tag }) });
  const bad = await upd("http://example.com/evil.tar.gz");
  assert.equal(bad.status, 409);
  assert.match((await bad.json()).error, /not a release of Mandarin Bridge's/);
  const older = await upd("mandarin-bridge-v0.0.1");
  assert.equal(older.status, 409);
  assert.match((await older.json()).error, /^mandarin-bridge-v0\.0\.1 is older than this Bridge \(\d+\.\d+\.\d+\)$/);
  assert.equal((await upd("test-bridge", "text/plain")).status, 403, "a plain form's POST refused");
});
