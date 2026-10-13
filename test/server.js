"use strict";
/*
 * server.js — the C# server alone, as the image will run it (v0.8.50, stage 7
 * of docs/specs/csharp-migration.md): started on a port of this file's own
 * (test/ports.js) with a test's environment, waited for, stopped. No Node
 * server anywhere (none since v0.9.0). The environment the suite gives every
 * server (test/setup.js: nothing off this machine, no identification scan, no
 * sound devices, no update checks) is given here too; a test adds its own
 * (the fakes' addresses, MANDARIN_CONFIG).
 *
 *   const { start } = require("./server");
 *   const srv = await start({ port, musicDir, dataDir, env: { QOBUZ_URL: fake.base } });
 *   … fetch(srv.base + "/api/…") …
 *   await srv.stop();
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BIN = process.env.MANDARIN_SERVER_BIN || path.join(ROOT, "server", "bin", "mandarin-server");

/** Whether the program is built: a test skips with this reason when it isn't. */
const built = () => fs.existsSync(BIN) ? false : "the C# server isn't built (server/build.sh): " + BIN;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/*
 * The servers this process started, by port: a test that times out never
 * reaches its finally, and its server would hold the port for the next one
 * (and answer it in its place). The next start on that port ends it first,
 * and none outlives the test's process.
 */
const live = new Map();
process.on("exit", () => { for (const p of live.values()) { try { p.kill("SIGKILL"); } catch (e) { /* gone */ } } });

/* Whether anything answers /server-info on the port. */
async function answers(base) {
  try { await fetch(base + "/server-info", { signal: AbortSignal.timeout(1000) }); return true; } catch (e) { return false; }
}

/**
 * The server started and answering on [port]; [env] over the suite's. [bin]: a copy of the program to run
 * instead (an update's test: the copy is what the update replaces). exited(): how it ended, once it has.
 * logs: every line the program has printed, kept as well as printed (what a test reads of its log).
 * @returns {Promise<{ base: string, key: string, proc: import("child_process").ChildProcess, stop: () => Promise<void>, exited: () => ({ code: number | null, signal: string | null } | null), logs: string[] }>}
 */
async function start({ port, musicDir, dataDir, env = {}, bin = BIN, timeoutMs = 60000 }) {
  const key = crypto.randomBytes(24).toString("hex");
  const e = Object.assign({}, process.env, {
    PORT: String(port), MUSIC_DIR: musicDir, DATA_DIR: dataDir, SERVER_IP: "127.0.0.1", MANDARIN_APP_DIR: ROOT,
    MANDARIN_FRONT_KEY: key, IDENTIFY: "0", LOCAL_AUDIO: "0", UPDATE_CHECK: "false", UPNP_DISCOVERY: "0", ITUNES_URL: "http://127.0.0.1:9"
  }, process.env.ALLOW_NETWORK ? {} : { MANDARIN_LOOPBACK_ONLY: "1" }, env);
  // The program is its own file (Updater.cs BinPath): never the suite's, told by the environment.
  delete e.MANDARIN_SERVER_BIN;
  fs.mkdirSync(dataDir, { recursive: true });
  const base = "http://127.0.0.1:" + port;
  const left = live.get(port);
  if (left && left.exitCode === null && left.signalCode === null) {
    const gone = new Promise(r => left.once("exit", r));
    left.kill("SIGKILL");
    await Promise.race([gone, sleep(5000)]);
  }
  // Whatever answers on the port must be the server started here.
  if (await answers(base)) throw new Error("port " + port + " is taken: another server answers there");
  const proc = spawn(bin, [], { env: e, stdio: ["ignore", "pipe", "pipe"] });
  live.set(port, proc);
  proc.on("exit", () => { if (live.get(port) === proc) live.delete(port); });
  const logs = [];
  for (const [from, to] of [[proc.stdout, process.stdout], [proc.stderr, process.stderr]]) {
    let rest = "";
    from.on("data", (c) => {
      to.write(c);
      const lines = (rest + c).split("\n");
      rest = lines.pop() || "";
      logs.push(...lines);
    });
  }
  let exited = null;
  proc.on("exit", (code, signal) => { exited = { code, signal }; });
  const t0 = Date.now();
  for (;;) {
    if (exited) throw new Error(`the C# server exited before it listened (code ${exited.code}, signal ${exited.signal})`);
    try {
      const r = await fetch(base + "/server-info", { signal: AbortSignal.timeout(2000) });
      if (r.status === 200 && (await r.json()).server === "C#") break;
    } catch (err) { /* not yet */ }
    if (Date.now() - t0 > timeoutMs) { proc.kill("SIGKILL"); throw new Error("the C# server didn't answer on " + port + " within " + timeoutMs + " ms"); }
    await sleep(100);
  }
  const stop = async () => {
    if (exited) return;
    const gone = new Promise(r => proc.once("exit", r));
    proc.kill("SIGTERM");
    await Promise.race([gone, sleep(8000)]);
    if (!exited) { proc.kill("SIGKILL"); await gone; }
  };
  return { base, key, proc, stop, exited: () => exited, logs };
}

// index.js's createServer options, as the environment the program reads them from (Config.cs).
const ENV = {
  port: "PORT", musicDir: "MUSIC_DIR", dataDir: "DATA_DIR", serverIp: "SERVER_IP", sonosHosts: "SONOS_HOSTS", upnpHosts: "UPNP_HOSTS",
  include: "INCLUDE_ZONES", exclude: "EXCLUDE_ZONES", scanHours: "SCAN_INTERVAL_HOURS", tailscaleBin: "MUSICDNET_BIN",
  mbBaseUrl: "MUSICBRAINZ_URL", itunesBaseUrl: "ITUNES_URL", mbpackUrl: "MBPACK_URL", mbpackDir: "MBPACK_DIR", autoeqBaseUrl: "AUTOEQ_URL",
  discogsBaseUrl: "DISCOGS_URL", fanartBaseUrl: "FANART_URL", deezerBaseUrl: "DEEZER_URL", wikipediaBaseUrl: "WIKIPEDIA_URL",
  pitchforkBaseUrl: "PITCHFORK_URL", qobuzWebUrl: "QOBUZ_WEB_URL", lastfmBaseUrl: "LASTFM_URL", lastfmKey: "LASTFM_KEY",
  identifyTickMs: "IDENTIFY_TICK_MS", loudnessTickMs: "LOUDNESS_TICK_MS", qobuzBaseUrl: "QOBUZ_URL", tidalBaseUrl: "TIDAL_URL",
  tidalAuthUrl: "TIDAL_AUTH_URL", tidalImagesUrl: "TIDAL_IMAGES_URL",
  // The folder public/ is served from (v0.9.3): a test's own copy, to change a file of.
  appDir: "MANDARIN_APP_DIR"
};
// On or off, as index.js read them ("0" is off).
const FLAGS = { upnpMulticast: "UPNP_DISCOVERY", identify: "IDENTIFY", localAudio: "LOCAL_AUDIO" };
// The rest laid over the configuration (MANDARIN_CONFIG), by the names the hand-over carried them under.
const CONFIG = {
  qobuzSyncDelayMs: "service_sync_delay_ms", serviceWatchMs: "service_watch_ms", logoPauseMs: "logo_pause_ms", upnpOfflineMs: "upnp_offline_ms",
  localDevices: "local_devices", massRemoval: "mass_removal", tailscaleWatchdog: "tailscale_watchdog"
};
// What the C# server makes (Jobs.Names): every job, with no Node server to leave any to.
const JOBS = ["identify", "mbpack", "loudness", "labels", "days", "taste", "tailscale", "scan", "prune", "import", "services", "update", "cpu", "playback"];

/**
 * index.js's createServer, for the tests that started the Node server with it (stage 7 part 4): the
 * same options, given to the program as its environment, and a ctx with what the tests reached into
 * the Node server for, had over HTTP and from the database file instead:
 *   ctx.listeningOn        the port: the server answers everything itself
 *   ctx.frontKey           the key its private addresses are asked with (/internal/library/changed)
 *   ctx.frontRuns          every job's name (a Set): the C# server holds them all
 *   ctx.db.raw             better-sqlite3 on <dataDir>/musicd.db; setting/setSetting as lib/library/db.js had them
 *   ctx.library.reload()   the copy read again (POST /internal/library/changed { edits: true })
 *   ctx.auth.signUrl(url)  a speaker's address signed under the install's secret (Playback/Signing.cs)
 *   ctx.config             the options as given
 *   ctx.logs               every line the program has printed (start's logs)
 *   ctx.internal(p, body)  one of the program's private addresses asked (POST, the front key): { status, ...its JSON }
 *   ctx.restart(token)     Settings → Restart, and the program's next run waited for (a new boot id on /server-info, its first scan done)
 * An option the program has no reading of is refused, so a test says what it does without it.
 * @param {Record<string, any>} overrides
 */
function createServer(overrides = {}) {
  const env = {};
  const cfg = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) continue;
    if (ENV[k]) env[ENV[k]] = Array.isArray(v) ? v.join(",") : String(v);
    else if (FLAGS[k]) env[FLAGS[k]] = v ? "1" : "0";
    else if (CONFIG[k]) cfg[CONFIG[k]] = v;
    else throw new Error(`createServer: the C# server has no reading of "${k}" (test/server.js)`);
  }
  if (Object.keys(cfg).length) env.MANDARIN_CONFIG = JSON.stringify(cfg);
  const port = overrides.port, musicDir = overrides.musicDir, dataDir = overrides.dataDir;
  if (!port || !musicDir || !dataDir) throw new Error("createServer: port, musicDir and dataDir are needed");
  for (const k of ["PORT", "MUSIC_DIR", "DATA_DIR"]) delete env[k];
  let srv = null, raw = null;
  const db = {
    get raw() { return raw || (raw = new (require("better-sqlite3"))(path.join(dataDir, "musicd.db"), { fileMustExist: true })); },
    setting(key, fallback) {
      const r = db.raw.prepare("SELECT value FROM settings WHERE key = ?").get(key);
      if (!r) return fallback;
      try { return JSON.parse(r.value); } catch (e) { return fallback; }
    },
    setSetting(key, value) { db.raw.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value)); },
    // Let go, to be opened again on the next use: after a restore has put another file in the database's place.
    close() { if (raw) { try { raw.close(); } catch (e) { /* closed */ } raw = null; } }
  };
  const sig = p => crypto.createHmac("sha256", db.setting("authSecret", "")).update(p).digest("base64url").slice(0, 22);
  const ctx = {
    listeningOn: port, frontKey: "", frontRuns: new Set(JOBS), madeByFront: true, config: Object.assign({}, overrides), base: "http://127.0.0.1:" + port, db,
    logs: /** @type {string[]} */ ([]),
    // lib/server/features.js's insertPlay: a play written as the server writes one (album_id, track_id, title, artist, album, zone, ts).
    features: { insertPlay: { run: (...a) => db.raw.prepare("INSERT INTO plays(album_id, track_id, title, artist, album, zone, ts) VALUES(?,?,?,?,?,?,?)").run(...a) } },
    library: {
      async reload() {
        const r = await fetch(ctx.base + "/internal/library/changed", { method: "POST", headers: { "X-Mandarin-Front-Key": ctx.frontKey, "Content-Type": "application/json" }, body: JSON.stringify({ edits: true }) });
        return r.json();
      }
    },
    async internal(p, body = {}) {
      const r = await fetch(ctx.base + p, { method: "POST", headers: { "X-Mandarin-Front-Key": ctx.frontKey, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
    },
    async restart(token) {
      const boot = async () => { try { return (await (await fetch(ctx.base + "/server-info")).json()).boot; } catch (e) { return null; } };
      const before = await boot();
      const r = await fetch(ctx.base + "/api/system/restart", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: "{}" });
      if (r.status !== 200) throw new Error("restart refused: " + r.status + " " + await r.text());
      let now = null;
      for (let i = 0; i < 300 && !now; i++) { const b = await boot(); if (b && b !== before) now = b; else await sleep(100); }
      if (!now) throw new Error("the server didn't start again");
      // Its first scan done, as at any start (a Clean up or a rescan asked meanwhile is refused while it runs): the last one known again.
      const scan = async () => { try { return (await (await fetch(ctx.base + "/api/status", { headers: { Authorization: "Bearer " + token } })).json()).scan; } catch (e) { return null; } };
      for (let i = 0; i < 600; i++) { const s = await scan(); if (s && s.last && !s.running) return now; await sleep(100); }
      throw new Error("the server's first scan after starting again didn't end");
    },
    auth: {
      signUrl(url) {
        const u = String(url);
        const i = u.indexOf("://");
        const from = i >= 0 ? u.indexOf("/", i + 3) : 0;
        return u + (u.includes("?") ? "&" : "?") + "s=" + sig(u.slice(from).split("?")[0]);
      }
    }
  };
  return {
    async start() {
      srv = await start({ port, musicDir, dataDir, env });
      ctx.frontKey = srv.key;
      ctx.logs = srv.logs;
      return ctx;
    },
    async stop() {
      db.close();
      if (srv) await srv.stop();
    },
    exited: () => srv && srv.exited()
  };
}

module.exports = { start, createServer, built, BIN, JOBS };
