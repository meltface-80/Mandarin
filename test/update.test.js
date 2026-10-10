"use strict";
/*
 * The in-app update, end to end: the server runs under launcher.js as it does
 * in the Docker image, a stand-in for GitHub offers a newer release, and one
 * POST to /api/update/apply must bring the server back up as that version —
 * with the data directory left alone.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, execFileSync } = require("child_process");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const ROOT = path.join(__dirname, "..");
const APP_FILES = ["index.js", "launcher.js", "package.json", "package-lock.json", "lib", "public"];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function copyApp(dest, version) {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of APP_FILES) fs.cpSync(path.join(ROOT, f), path.join(dest, f), { recursive: true });
  if (version) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    pkg.version = version;
    fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify(pkg, null, 2));
  }
}

async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* not up yet */ }
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(200);
  }
}

test("Check for updates installs the newer release and restarts into it, library and edits intact", {
  timeout: 90000, skip: !haveFfmpeg() && "ffmpeg is not installed"
}, async () => {
  const lib = makeLibrary();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-upd-"));
  const app = path.join(tmp, "app");
  copyApp(app);
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(app, "node_modules"), "dir");
  const data = path.join(tmp, "data");
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, "keep.txt"), "mine");

  // The release bundle, built the way release.yml builds it.
  copyApp(path.join(tmp, "bundle", "musicd-server"), "9.9.9");
  const tarball = path.join(tmp, "musicd-server-9.9.9.tar.gz");
  execFileSync("tar", ["-C", path.join(tmp, "bundle"), "-czf", tarball, "musicd-server"]);

  const gh = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${gh.address().port}`;
    if (req.url === "/repos/me/musicd/releases/latest") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({
        tag_name: "v9.9.9", html_url: base + "/r", body: "Notes for 9.9.9",
        assets: [{ name: "musicd-server-9.9.9.tar.gz", browser_download_url: base + "/dl" }]
      }));
    }
    if (req.url === "/dl") return fs.createReadStream(tarball).pipe(res);
    res.statusCode = 404; res.end("{}");
  });
  await new Promise(r => gh.listen(0, "127.0.0.1", r));

  const port = ports.port();
  const proc = spawn(process.execPath, ["launcher.js"], {
    cwd: app, stdio: "ignore",
    env: Object.assign({}, process.env, {
      PORT: String(port), MUSIC_DIR: lib.music, DATA_DIR: data, SERVER_IP: "127.0.0.1",
      SONOS_HOSTS: ports.host(4), UPDATE_REPO: "me/musicd", UPDATE_API: `http://127.0.0.1:${gh.address().port}`,
      UPDATE_CHECK: "false",
      // On its own, with no C# server in front (test/setup.js sets the list for the
      // servers it puts behind one): its library scans and the rest are its own.
      MANDARIN_FRONT_RUNS: ""
    })
  });
  let auth = {};
  const api = async (p, post) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/${p}`, post ? { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: "{}" } : { headers: auth });
    return r.json();
  };
  try {
    const cur = require("../package.json").version;
    assert.equal((await until(() => api("health"))).version, cur);
    auth = { Authorization: "Bearer " + await signIn(`http://127.0.0.1:${port}`) };
    await until(async () => { const x = await api("status"); return x.index_count === 3 && !x.scan.running; });
    const albums = (await api("library/albums?sort=album")).albums;
    const one = albums.find(a => a.title === "Album One");
    const edit = await fetch(`http://127.0.0.1:${port}/api/album/edit`, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth),
      body: JSON.stringify({ offset: one.offset, title: "Album One (fixed)", year: "1999" }) });
    assert.equal(edit.status, 200);
    const st = await api("update/check", true);
    assert.equal(st.available, true);
    assert.equal(st.latest, "9.9.9");
    assert.equal(st.viaLauncher, true);
    assert.equal(st.notes, "Notes for 9.9.9");

    // Through the page where a browser is at hand (v0.7.3): one Update for
    // the server and the Android app, the server first and the app once the
    // server is back — a stand-in for the app's bridge records when its
    // install was asked for, and what the server answered to at that moment.
    if (findBrowser() || process.env.CI) {
      const b = await Browser.launch({ width: 390, height: 844 });
      try {
        const init = `window.MusicdApp = {
          version: () => "0.0.1", pageHandlesUpdates() {}, tailscaleTest() {},
          appUpdateStatus: () => JSON.stringify({ current: "0.0.1", latest: "9.9.9", available: true, installing: false }),
          lookForAppUpdate(force) { localStorage.setItem("fake-looks", (localStorage.getItem("fake-looks") || "") + (force ? "F" : "c")); setTimeout(() => window.__musicdAppUpdateChanged && window.__musicdAppUpdateChanged(), 10); },
          installAppUpdate() { const x = new XMLHttpRequest(); x.open("GET", "/api/health", false); x.send(); localStorage.setItem("fake-install-version", JSON.parse(x.responseText).version); },
          checkUpdate() {}
        };`;
        const page = await b.page(`http://127.0.0.1:${port}/`, { cookies: [{ name: "musicd_session", value: auth.Authorization.slice(7), url: `http://127.0.0.1:${port}` }], init });
        const r = await page.eval(`(async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (f, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(50); } };
          const out = {};
          out.offered = await until(() => document.getElementById("update-toast").classList.contains("open") && document.getElementById("update-text").textContent);
          out.looks = localStorage.getItem("fake-looks");
          document.getElementById("update-now").click();
          await sleep(300);
          out.installed_early = localStorage.getItem("fake-install-version");
          return out;
        })()`);
        assert.equal(r.offered, "v9.9.9 available for the server and this app (you have v" + cur + ")");
        assert.equal(r.looks, "F", "the app asked afresh, not from its hour's cache, with the server on offer");
        assert.equal(r.installed_early, null, "the app's install waits for the server");
        const h = await until(async () => { const x = await api("health"); return x.version === "9.9.9" && x; });
        assert.equal(h.ok, true);
        const got = await until(() => page.eval(`localStorage.getItem("fake-install-version")`), 30000);
        assert.equal(got, "9.9.9", "the app's install asked for once the server was back on the new version");
        const looks = await until(() => page.eval(`(localStorage.getItem("fake-looks") || "").length > 1 && localStorage.getItem("fake-looks")`), 30000);
        assert.equal(looks, "FF", "and asked afresh again after the restart: " + looks);
      } finally { await b.close(); }
    } else {
      const applied = await api("update/apply", true);
      assert.equal(applied.ok, true);
    }
    const h = await until(async () => { const x = await api("health"); return x.version === "9.9.9" && x; });
    assert.equal(h.ok, true);
    // Straight back with the whole library — no scan from scratch, nothing
    // unplayable while it runs — and the edit where it was.
    assert.equal(h.albums, 3, "albums are there the moment the server is back");
    const again = await api("album?offset=" + one.offset);
    assert.equal(again.album.title, "Album One (fixed)");
    assert.equal(again.album.year, 1999);
    const st2 = await until(async () => { const x = await api("status"); return !x.scan.running && x.scan.last && x; });
    assert.equal(st2.scan.last.added, 0);
    assert.equal(st2.scan.last.changed, 0);
    assert.equal(st2.scan.last.status, "unchanged");
    assert.equal(JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf8")).version, "9.9.9");
    assert.equal(fs.readFileSync(path.join(data, "keep.txt"), "utf8"), "mine");
    assert.ok(!fs.existsSync(path.join(app, ".update")), "staging directory cleaned up");
    assert.equal((await api("update/check", true)).available, false);
  } finally {
    proc.kill("SIGTERM");
    await new Promise(r => gh.close(r));
  }
});
