"use strict";
/*
 * csharp-update.js — Mandarin's C# server in front kept at this server's
 * version (v0.8.25; docs/specs/csharp-migration.md, stage 0).
 *
 * An update from Settings (lib/updater.js) brings this server's files only.
 * The C# server (server/bin/mandarin-server) came only with the Docker image,
 * so an update left the image's older C# server answering in front of newer
 * Node code, and making the background work it took over the old way. Now
 * each release carries the C# server too, built for the image's two platforms
 * (.github/workflows/release.yml), and this server, started by a C# server of
 * another version, puts the one of its own version in its place:
 *
 *   1. the C# server's version, from its /server-info (it answers once this
 *      server is up and its background work settled);
 *   2. the same as this one's: nothing to do;
 *   3. otherwise the release's program for this machine, checked against the
 *      release's SHA-256 sums, unpacked beside the one running, asked its
 *      version (`--version`), and renamed over it: the running one carries on
 *      from the old file until it stops;
 *   4. then this server stops with code 76. The launcher stops with it, and
 *      the C# server, seeing that code, starts itself again from the new file
 *      (Program.cs, Front.StartAgain); an older one simply stops, and Docker's
 *      restart policy starts the container again.
 *
 * Twice at most for a version (csharp-update.json in the data folder), so a
 * program that won't come up can't keep the server restarting. Until the two
 * match, the C# server's share of the background work stays here (index.js,
 * /internal/front/runs), and a C# server that knows to passes everything on
 * (Front.cs). On Linux, and on a Mac from v0.8.29 (the installer puts the C#
 * server in front there too); off with MANDARIN_SERVER_UPDATE=0.
 *
 * From v0.8.29 an update from Settings brings the two together: prepare()
 * fetches and checks the C# server of the version being installed, and puts
 * it in place, before the updater stages this server's files. If it can't be
 * had, the update stops there and nothing changes, rather than this server
 * running for hours (or for good) behind a C# server that passes it
 * everything, parts this server no longer has among them. Once the new files
 * start, run() finds the program already in place, and only the start again
 * is left.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { pipeline } = require("stream/promises");
const Updater = require("../updater");

const START_AGAIN = 76;
const TRIES = 2;
// The release's builds, by platform and processor (the Mac's from v0.8.29).
const ARCHES = { linux: { x64: "linux-x64", arm64: "linux-arm64" }, darwin: { x64: "osx-x64", arm64: "osx-arm64" } };
const SUMS = "mandarin-server.sha256";

function createCsharpUpdate(o) {
  const env = o.env || process.env;
  const platform = o.platform || process.platform;
  const arch = o.arch || process.arch;
  const log = o.log || (() => {});
  const version = o.version;
  const markerFile = path.join(o.dataDir, "csharp-update.json");
  const sleep = o.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const exit = o.exit || (c => process.exit(c));
  const stop = o.stop || (() => Promise.resolve());
  const waitMs = o.waitMs == null ? 180000 : o.waitMs;
  // Not to be had just now (GitHub not answering, a release still being put up): asked again later.
  const retryMs = o.retryMs == null ? 30 * 60000 : o.retryMs;
  let retries = 6, retryTimer = null;
  // What the page and /api/health show: the C# server's version, and how bringing it up to this one's went.
  const state = { version: null, matched: null, phase: "idle", error: null };
  let stopped = false;

  const build = (ARCHES[platform] || {})[arch];
  const mac = platform === "darwin";
  const front = env.MANDARIN_FRONT === "csharp" && env.MANDARIN_FRONT_URL;
  if (!front) state.phase = "none";
  else if (env.MANDARIN_SERVER_UPDATE === "0") state.phase = "off";
  else if (!build) state.phase = "unsupported";
  // Where the C# server in front comes from: the image, or the Mac's installer.
  const getAgain = mac ? "run the install line again (README, Install on a Mac)" : "pull the image again (docker pull)";
  const binPath = () => env.MANDARIN_SERVER_BIN || path.join(o.appDir || path.join(__dirname, "..", ".."), "server", "bin", "mandarin-server");

  const status = () => Object.assign({}, state);
  const fail = (phase, error) => {
    state.phase = phase;
    state.error = error || null;
    log(`[update] the C# server stays at ${state.version || "its version"}: ${error || phase}`);
    if (["unavailable", "error", "unknown"].includes(phase) && retryMs > 0 && retries > 0 && !stopped) {
      retries--;
      retryTimer = setTimeout(() => { state.phase = "idle"; run().catch(e => log(`[update] the C# server: ${e.message}`)); }, retryMs);
      if (retryTimer.unref) retryTimer.unref();
    }
    return status();
  };
  const readMarker = () => { try { return JSON.parse(fs.readFileSync(markerFile, "utf8")); } catch (e) { return null; } };
  const writeMarker = (m) => { try { fs.writeFileSync(markerFile, JSON.stringify(m)); } catch (e) { /* the data folder: tried again next time */ } };

  /* The C# server's version, once it answers: null if it never does. */
  async function frontVersion() {
    const until = Date.now() + waitMs;
    for (;;) {
      if (stopped) return null;
      try {
        const r = await fetch(String(env.MANDARIN_FRONT_URL).replace(/\/+$/, "") + "/server-info", { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
          const j = await r.json();
          if (j && j.server === "C#" && typeof j.version === "string") return j.version;
        }
      } catch (e) { /* not listening yet */ }
      if (Date.now() >= until) return null;
      await sleep(2000);
    }
  }

  /* The program for this machine from release v<v>, checked, put beside `bin` as `<bin>.new`. */
  async function fetchProgram(bin, v = version) {
    const name = `mandarin-server-${build}.gz`;
    const r = await Updater.ghGetJson(`/repos/${o.owner}/${o.repo}/releases/tags/v${v}`, o.token || null);
    if (r.status !== 200 || !r.json) throw Object.assign(new Error(`release v${v} not found (HTTP ${r.status})`), { phase: "unavailable" });
    const assets = r.json.assets || [];
    const gz = assets.find(a => a.name === name), sums = assets.find(a => a.name === SUMS);
    if (!gz || !sums) throw Object.assign(new Error(`release v${v} carries no ${name}`), { phase: "unavailable" });
    const dl = bin + ".download", sumsFile = bin + ".sha256", next = bin + ".new";
    try {
      await Updater.downloadFile(sums.browser_download_url, sumsFile, o.token || null);
      const line = fs.readFileSync(sumsFile, "utf8").split("\n").map(l => l.trim().split(/\s+\*?/)).find(([, n]) => n === name);
      if (!line || !/^[0-9a-f]{64}$/i.test(line[0])) throw new Error(`no sum for ${name}`);
      state.phase = "downloading";
      await Updater.downloadFile(gz.browser_download_url, dl, o.token || null);
      const got = crypto.createHash("sha256").update(fs.readFileSync(dl)).digest("hex");
      if (got.toLowerCase() !== line[0].toLowerCase()) throw new Error(`${name} doesn't match its sum`);
      await pipeline(fs.createReadStream(dl), zlib.createGunzip(), fs.createWriteStream(next, { mode: 0o755 }));
      fs.chmodSync(next, 0o755);
      // A Mac runs nothing unsigned: the release's is signed (ad hoc) where it
      // is built; signed here again if that didn't come through.
      if (mac && (o.codesign || defaultCodesign)(next) === false) throw new Error(`the new program couldn't be signed to run on this Mac`);
      // It runs here, and is the version it should be.
      const said = spawnSync(next, ["--version"], { encoding: "utf8", timeout: 30000, env: Object.assign({}, env, { DOTNET_CLI_TELEMETRY_OPTOUT: "1" }) });
      const got2 = String(said.stdout || "").trim();
      if (said.status !== 0 || got2 !== v) throw new Error(`the new program says ${got2 || (said.error ? said.error.message : "nothing")}, not ${v}`);
      return next;
    } catch (e) {
      try { fs.rmSync(next, { force: true }); } catch (e2) { /* gone */ }
      throw e;
    } finally {
      for (const f of [dl, sumsFile]) { try { fs.rmSync(f, { force: true }); } catch (e) { /* gone */ } }
    }
  }

  async function run() {
    if (state.phase !== "idle") return status();
    state.phase = "asking";
    const v = await frontVersion();
    if (stopped) return status();
    if (!v) return fail("unknown", "it didn't say its version");
    state.version = v;
    state.matched = v === version;
    if (state.matched) {
      state.phase = "matched";
      try { fs.rmSync(markerFile, { force: true }); } catch (e) { /* none */ }
      return status();
    }
    log(`[update] the C# server in front is ${v}, this server ${version}: bringing it up to ${version}`);
    const m = readMarker();
    const tries = m && m.version === version ? Number(m.tries) || 0 : 0;
    if (tries >= TRIES) return fail("gave-up", `still ${v} after ${tries} tries; ${getAgain} to bring it up to date`);
    const bin = binPath();
    if (!fs.existsSync(bin)) return fail("error", `no C# server at ${bin}`);
    try { fs.accessSync(path.dirname(bin), fs.constants.W_OK); } catch (e) { return fail("error", `${path.dirname(bin)} can't be written to`); }
    // Put in place already (a start again that didn't happen): only the start again is left.
    let ready = false;
    try { ready = fs.readFileSync(bin + ".version", "utf8").trim() === version; } catch (e) { /* not ours */ }
    if (!ready) {
      state.phase = "fetching";
      try {
        const next = await fetchProgram(bin);
        if (stopped) { try { fs.rmSync(next, { force: true }); } catch (e) { /* gone */ } return status(); }
        fs.renameSync(next, bin);
        fs.writeFileSync(bin + ".version", version + "\n");
        log(`[update] the C# server ${version} is in place`);
      } catch (e) {
        return fail(e.phase || "error", e.message);
      }
    }
    writeMarker({ version, tries: tries + 1, at: Date.now() });
    state.phase = "restarting";
    // One from before v0.8.25 can't start itself again: it stops, and Docker's restart policy starts the container again.
    const own = Updater.cmpVer(state.version, "0.8.25") >= 0;
    log(`[update] starting again with the C# server ${version}` + (own ? "" : " (by the container's restart policy: this C# server is older than v0.8.25)"));
    await Promise.resolve().then(() => stop()).catch(e => log(`[update] stopping: ${e.message}`));
    exit(START_AGAIN);
    return status();
  }

  /*
   * Before an update from Settings stages this server's files (lib/updater.js):
   * the C# server of the version it brings, fetched, checked and put in place.
   * Throws, and nothing has changed, when it can't be had. Nothing to do with
   * no C# server in front, or with its updates switched off.
   */
  async function prepare(target) {
    if (!front || state.phase === "off") return null;
    if (state.phase === "unsupported") throw new Error(`no C# server is built for this machine (${platform} ${arch}); the update would leave it behind`);
    const bin = binPath();
    if (!fs.existsSync(bin)) throw new Error(`no C# server at ${bin}`);
    try { fs.accessSync(path.dirname(bin), fs.constants.W_OK); } catch (e) { throw new Error(`${path.dirname(bin)} can't be written to; ${getAgain} instead`); }
    log(`[update] fetching the C# server ${target} before the update`);
    let next;
    try { next = await fetchProgram(bin, target); }
    catch (e) { throw new Error(`the C# server ${target} couldn't be fetched (${e.message}); nothing was changed`); }
    fs.renameSync(next, bin);
    fs.writeFileSync(bin + ".version", target + "\n");
    log(`[update] the C# server ${target} is in place; it starts with the update`);
    return target;
  }

  return { run, prepare, status, stop: () => { stopped = true; clearTimeout(retryTimer); } };
}

/* An ad hoc signature, where the program's own doesn't hold: false if it can't be had. */
function defaultCodesign(file) {
  if (spawnSync("codesign", ["--verify", file], { timeout: 30000 }).status === 0) return true;
  return spawnSync("codesign", ["--force", "--sign", "-", file], { timeout: 60000 }).status === 0;
}

module.exports = { createCsharpUpdate, START_AGAIN, ARCHES, SUMS };
