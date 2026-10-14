"use strict";
/*
 * The in-app update, end to end: the C# server runs from its own file in an
 * install of its own, as it does in the Docker image; a stand-in for GitHub
 * offers a newer release (its bundle, and the program of that version, built
 * here as 9.9.9); and one Update must bring the server back up as that
 * version — the whole library there at once, an album's edit kept, no scan
 * from scratch, the data directory left alone. Through the page where a
 * browser is at hand: one Update for the server and the Android app, the
 * server first and the app once the server is back.
 *
 * Since v0.9.0 (stage 7 part 6) on the C# server alone (Admin/Updater.cs:
 * the program put in place and started again in the same process,
 * Front.StartAgain); before, the Node server under launcher.js. The refusals
 * are test/Mandarin.Tests/UpdateAloneTests.cs's. The new version's program is built here
 * with the .NET SDK (a minute), or named by MANDARIN_SERVER_BIN_NEXT (a build
 * that says 9.9.9).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const zlib = require("zlib");
const crypto = require("crypto");
const { execFileSync, spawnSync } = require("child_process");
const { haveFfmpeg, makeLibrary, stopServer } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { start, built, BIN } = require("./server");

const ROOT = path.join(__dirname, "..");
const NEXT = "9.9.9";
// The program's build for this machine, as Admin/Updater.cs names it (release.yml's assets).
const sys = process.platform === "linux" ? "linux" : null;
const build = sys && ["x64", "arm64"].includes(process.arch) ? `${sys}-${process.arch}` : null;
const haveDotnet = () => spawnSync("dotnet", ["--version"], { encoding: "utf8" }).status === 0;
const skip = built() || (!build && "no C# server is built for this machine") || (!haveFfmpeg() && "ffmpeg is not installed")
  || (!process.env.MANDARIN_SERVER_BIN_NEXT && !haveDotnet() && "the .NET SDK isn't here to build the next version (or name one: MANDARIN_SERVER_BIN_NEXT)");
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* not up yet */ }
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(200);
  }
}

/* The program of the next version: named, or built apart from this checkout's (its own obj and bin), as server/build.sh builds one. */
function nextProgram(tmp) {
  if (process.env.MANDARIN_SERVER_BIN_NEXT) return process.env.MANDARIN_SERVER_BIN_NEXT;
  const out = path.join(tmp, "next");
  const r = spawnSync("dotnet", ["publish", path.join(ROOT, "server", "Mandarin.Server", "Mandarin.Server.csproj"), "-c", "Release", "-r", build,
    "-p:Version=" + NEXT, "-p:SelfContained=true", "-p:PublishSingleFile=true", "-p:EnableCompressionInSingleFile=true",
    "--artifacts-path", path.join(tmp, "artifacts"), "-o", out, "--nologo", "-v", "quiet"], { encoding: "utf8", timeout: 600000 });
  assert.equal(r.status, 0, "the next version built: " + r.stdout + r.stderr);
  return path.join(out, "mandarin-server");
}

/* An install apart from this checkout: the pages, package.json, and a copy of the program, which the server runs from. */
function install(tmp) {
  const app = path.join(tmp, "app");
  fs.mkdirSync(app);
  fs.copyFileSync(path.join(ROOT, "package.json"), path.join(app, "package.json"));
  fs.cpSync(path.join(ROOT, "public"), path.join(app, "public"), { recursive: true });
  const bin = path.join(app, "server", "bin", "mandarin-server");
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.copyFileSync(BIN, bin);
  fs.chmodSync(bin, 0o755);
  return { app, bin };
}

test("Check for updates installs the newer release and restarts into it, library and edits intact", { skip, timeout: 900000 }, async (t) => {
  const lib = makeLibrary();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-upd-"));
  const next = nextProgram(tmp);
  assert.equal(spawnSync(next, ["--version"], { encoding: "utf8" }).stdout.trim(), NEXT, "the next version's program says " + NEXT);
  const i = install(tmp);
  const data = lib.data;
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, "keep.txt"), "mine");

  // The release, as release.yml makes one: the bundle (musicd-server/ at the top), and the program for each machine with its sums.
  const top = path.join(tmp, "bundle", "musicd-server");
  fs.mkdirSync(top, { recursive: true });
  fs.cpSync(path.join(ROOT, "public"), path.join(top, "public"), { recursive: true });
  const cur = require("../package.json").version;
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  fs.writeFileSync(path.join(top, "package.json"), JSON.stringify(Object.assign(pkg, { version: NEXT }), null, 2));
  const tarball = path.join(tmp, `musicd-server-${NEXT}.tar.gz`);
  execFileSync("tar", ["-C", path.join(tmp, "bundle"), "-czf", tarball, "musicd-server"]);
  const name = `mandarin-server-${build}.gz`;
  const gz = zlib.gzipSync(fs.readFileSync(next));
  const files = {
    "/dl/bundle": fs.readFileSync(tarball),
    ["/dl/" + name]: gz,
    "/dl/mandarin-server.sha256": `${crypto.createHash("sha256").update(gz).digest("hex")}  ${name}\n`
  };
  const gh = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${gh.address().port}`;
    const json = o => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
    if (req.url === "/repos/me/musicd/releases/latest") {
      return json({ tag_name: "v" + NEXT, html_url: base + "/r", body: "Notes for " + NEXT,
        assets: [{ name: `musicd-server-${NEXT}.tar.gz`, browser_download_url: base + "/dl/bundle" }] });
    }
    if (req.url === `/repos/me/musicd/releases/tags/v${NEXT}`) {
      return json({ tag_name: "v" + NEXT, assets: [name, "mandarin-server.sha256"].map(n => ({ name: n, browser_download_url: base + "/dl/" + n })) });
    }
    if (files[req.url]) { res.setHeader("Content-Type", "application/octet-stream"); return res.end(files[req.url]); }
    res.statusCode = 404; res.end("{}");
  });
  await new Promise(r => gh.listen(0, "127.0.0.1", r));
  t.after(() => stopServer(gh));

  const port = ports.port();
  const srv = await start({ port, musicDir: lib.music, dataDir: data, bin: i.bin,
    env: { MANDARIN_APP_DIR: i.app, SONOS_HOSTS: ports.host(4), UPDATE_REPO: "me/musicd", UPDATE_API: `http://127.0.0.1:${gh.address().port}` } });
  t.after(() => srv.stop());
  let auth = {};
  const api = async (p, post) => {
    const r = await fetch(`${srv.base}/api/${p}`, post ? { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: "{}" } : { headers: auth });
    return r.json();
  };
  assert.equal((await until(() => api("health"))).version, cur);
  auth = { Authorization: "Bearer " + await signIn(srv.base) };
  await until(async () => { const x = await api("status"); return x.index_count === 3 && !x.scan.running; }, 60000);
  const albums = (await api("library/albums?sort=album")).albums;
  const one = albums.find(a => a.title === "Album One");
  const edit = await fetch(`${srv.base}/api/album/edit`, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth),
    body: JSON.stringify({ offset: one.offset, title: "Album One (fixed)", year: "1999" }) });
  assert.equal(edit.status, 200);
  const st = await api("update/check", true);
  assert.deepEqual([st.available, st.latest, st.viaLauncher, st.notes], [true, NEXT, false, "Notes for " + NEXT]);
  // What the page reads when Settings opens (v0.9.1, the audit's T1): what the check found, kept.
  assert.deepEqual(await api("update/status"), st);

  // Through the page where a browser is at hand (v0.7.3): one Update for
  // the server and the Android app, the server first and the app once the
  // server is back — a stand-in for the app's bridge records when its
  // install was asked for, and what the server answered to at that moment.
  if (findBrowser() || process.env.CI) {
    const b = await Browser.launch({ width: 390, height: 844 });
    try {
      const init = `window.MusicdApp = {
        version: () => "0.0.1", pageHandlesUpdates() {}, tailscaleTest() {},
        appUpdateStatus: () => JSON.stringify({ current: "0.0.1", latest: "${NEXT}", available: true, installing: false }),
        lookForAppUpdate(force) { localStorage.setItem("fake-looks", (localStorage.getItem("fake-looks") || "") + (force ? "F" : "c")); setTimeout(() => window.__musicdAppUpdateChanged && window.__musicdAppUpdateChanged(), 10); },
        installAppUpdate() { const x = new XMLHttpRequest(); x.open("GET", "/api/health", false); x.send(); localStorage.setItem("fake-install-version", JSON.parse(x.responseText).version); },
        checkUpdate() {}
      };`;
      const page = await b.page(`${srv.base}/`, { cookies: [{ name: "musicd_session", value: auth.Authorization.slice(7), url: srv.base }], init });
      const r = await page.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const until = async (f, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(50); } };
        const out = {};
        out.offered = await until(() => document.getElementById("update-toast").classList.contains("open") && document.getElementById("update-text").textContent);
        out.looks = localStorage.getItem("fake-looks");
        document.getElementById("update-now").click();
        // A window: the app's install must not be asked for in it (the server first).
        await sleep(300);
        out.installed_early = localStorage.getItem("fake-install-version");
        return out;
      })()`);
      assert.equal(r.offered, `v${NEXT} available for the server and this app (you have v${cur})`);
      assert.equal(r.looks, "F", "the app asked afresh, not from its hour's cache, with the server on offer");
      assert.equal(r.installed_early, null, "the app's install waits for the server");
      const h = await until(async () => { const x = await api("health"); return x.version === NEXT && x; }, 60000);
      assert.equal(h.ok, true);
      const got = await until(() => page.eval(`localStorage.getItem("fake-install-version")`), 30000);
      assert.equal(got, NEXT, "the app's install asked for once the server was back on the new version");
      const looks = await until(() => page.eval(`(localStorage.getItem("fake-looks") || "").length > 1 && localStorage.getItem("fake-looks")`), 30000);
      assert.equal(looks, "FF", "and asked afresh again after the restart: " + looks);
    } finally { await b.close(); }
  } else {
    const applied = await api("update/apply", true);
    assert.equal(applied.ok, true);
  }
  const h = await until(async () => { const x = await api("health"); return x.version === NEXT && x; }, 60000);
  assert.equal(h.ok, true);
  assert.equal(srv.exited(), null, "started again in the same process");
  // Straight back with the whole library — no scan from scratch, nothing
  // unplayable while it runs — and the edit where it was.
  assert.equal(h.albums, 3, "albums are there the moment the server is back");
  const again = await api("album?offset=" + one.offset);
  assert.equal(again.album.title, "Album One (fixed)");
  assert.equal(again.album.year, 1999);
  const st2 = await until(async () => { const x = await api("status"); return !x.scan.running && x.scan.last && x; }, 60000);
  assert.equal(st2.scan.last.added, 0);
  assert.equal(st2.scan.last.changed, 0);
  assert.equal(st2.scan.last.status, "unchanged");
  assert.equal(JSON.parse(fs.readFileSync(path.join(i.app, "package.json"), "utf8")).version, NEXT);
  assert.ok(fs.readFileSync(i.bin).equals(fs.readFileSync(next)), "the new program in place");
  assert.equal(fs.readFileSync(path.join(data, "keep.txt"), "utf8"), "mine");
  assert.ok(!fs.existsSync(path.join(i.app, ".update")), "staging directory cleaned up");
  assert.equal((await api("update/check", true)).available, false);
});
