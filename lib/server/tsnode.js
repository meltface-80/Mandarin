"use strict";
/*
 * tsnode.js — Tailscale built into the server.
 *
 * The image carries MusicD's own Tailscale engine (android/musicdnet, the
 * same program the Android app runs, started here with -server). Signed in
 * once, from Settings → Away from home or with TS_AUTHKEY, it makes this
 * server a machine on your tailnet by itself — no Tailscale on the host, no
 * VPN, nothing else to install. It takes the tailnet's port (the server's
 * own port) and passes each request to the server on 127.0.0.1, naming the
 * caller's tailnet address in X-Forwarded-For — which the server believes
 * only from 127.0.0.1, and treats as away from home.
 *
 * The engine is driven over HTTP on 127.0.0.1 with a secret only the two
 * know (MUSICDNET_SECRET); it stops when the server does (its stdin closes).
 * Its state (the tailnet's key for this machine) lives in the data volume,
 * so a new container is the same machine. TAILSCALE=off leaves it out.
 *
 * An install updated in place (Settings → Check for updates brings the
 * server's files, not a new image) may have no engine in its image: then it's
 * downloaded — from the "engine" pre-release on GitHub, checked against its
 * SHA256SUMS — into the data volume, and again whenever the server itself is
 * updated. So the one download (the image, once) plus in-app updates is all.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const zlib = require("zlib");

const ENGINE_URL = "https://github.com/meltface-80/Mandarin/releases/download/engine";
const ARCH = { x64: "amd64", arm64: "arm64" }[process.arch] || null;

const POLL_MS = 5000;

class TailscaleNode {
  constructor({ bin, dir, port, db, log = () => {}, env = process.env, version = "", fetchImpl = fetch, watchdog = {} }) {
    // A node that says Running but isn't online on the tailnet (a tunnel gone
    // stale after the host slept, a network change it never noticed): rebound
    // after this long, started afresh after that (v0.7.2).
    this.watchdog = { rebindMs: watchdog.rebindMs || 60000, restartMs: watchdog.restartMs || 240000 };
    this.badSince = null;
    this.rebound = null;    // when the rebind was asked for
    this.imageBin = bin;
    this.version = version;
    this.fetch = fetchImpl;
    this.downloading = null;
    this.dir = dir;
    this.port = port;
    this.db = db;
    this.log = log;
    this.env = env;
    this.proc = null;
    this.ctl = null;          // control port
    this.secret = null;
    this.last = null;         // the engine's last /status
    this.error = null;
    this.stopping = false;
    this.timer = null;
    this.restarts = 0;
  }

  /* The engine the image carries, else the one downloaded into the data volume. */
  get bin() { return executable(this.imageBin) ? this.imageBin : this.downloadedBin; }
  get downloadedBin() { return path.join(path.dirname(this.dir), "bin", "musicdnet"); }

  /*
   * It can run here: in the image, or — in the Docker image (DOCKER=1), or with
   * TS_ENGINE_URL set — downloadable for this platform (Linux, x64 or arm64).
   */
  get available() {
    if (String(this.env.TAILSCALE || "").toLowerCase() === "off") return false;
    if (executable(this.imageBin)) return true;
    const may = this.env.DOCKER === "1" || !!this.env.TS_ENGINE_URL;
    return may && process.platform === "linux" && !!ARCH;
  }

  /*
   * No engine in the image: the downloaded one, fetched if it isn't there yet
   * or was fetched for an older version of the server. Checked against the
   * release's SHA256SUMS before it's used. Resolves true when there's one to run.
   */
  async ensureEngine() {
    if (executable(this.imageBin)) return true;
    const bin = this.downloadedBin;
    const marker = bin + ".version";
    let have = null;
    try { have = fs.readFileSync(marker, "utf8").trim(); } catch (e) { /* none yet */ }
    if (executable(bin) && have === this.version) return true;
    if (!this.downloading) {
      this.downloading = this.download(bin, marker).finally(() => { this.downloading = null; });
    }
    try { await this.downloading; this.downloadError = null; } catch (e) {
      this.downloadError = "Couldn't download Tailscale: " + e.message;
      this.log(`[tailscale] ${this.downloadError}`);
      return executable(bin);   // an older one still runs
    }
    return true;
  }

  async download(bin, marker) {
    const base = String(this.env.TS_ENGINE_URL || ENGINE_URL).replace(/\/+$/, "");
    const name = `musicdnet-linux-${ARCH}.gz`;
    this.log(`[tailscale] downloading the Tailscale engine (${name})…`);
    const get = async (u) => {
      const r = await this.fetch(u, { redirect: "follow" });
      if (!r.ok) throw new Error(`${u.split("/").pop()}: HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    };
    const sums = (await get(`${base}/SHA256SUMS`)).toString("utf8");
    const want = (sums.split("\n").map(l => l.trim().split(/\s+/)).find(p => p[1] === name) || [])[0];
    if (!want) throw new Error(`no checksum for ${name}`);
    const gz = await get(`${base}/${name}`);
    const got = crypto.createHash("sha256").update(gz).digest("hex");
    if (got !== want) throw new Error("the download was damaged (checksum mismatch)");
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    const tmp = bin + ".tmp";
    fs.writeFileSync(tmp, zlib.gunzipSync(gz), { mode: 0o755 });
    fs.renameSync(tmp, bin);
    fs.writeFileSync(marker, String(this.version));
    this.log(`[tailscale] engine ready (${Math.round(gz.length / 1048576)} MB download)`);
  }

  get enabled() {
    const s = this.db.setting("tailscale", {});
    return !s || s.enabled !== false;
  }

  /* For the page: what it's doing, and the sign-in link while one is needed. */
  status() {
    const st = this.last || {};
    const ips = Array.isArray(st.ips) ? st.ips : [];
    return {
      available: this.available,
      enabled: this.enabled,
      running: !!this.proc,
      state: this.proc ? (st.state || "Starting") : (this.downloading ? "Downloading" : "Stopped"),
      auth_url: st.auth_url || null,
      ips,
      dns_name: st.dns_name ? String(st.dns_name).replace(/\.$/, "") : null,
      serving: !!st.serving,
      online: st.online === undefined ? null : !!st.online,
      health: Array.isArray(st.health) ? st.health : [],
      address: this.address(),
      error: this.error || st.error || this.downloadError || null,
      version: st.version || null,
      hostname: this.hostname()
    };
  }

  hostname() { return String(this.env.TS_HOSTNAME || "musicd").trim() || "musicd"; }

  /* "http://100.x.y.z:3500" once it's joined and serving, else null. */
  address() {
    const st = this.last;
    if (!this.proc || !st || st.state !== "Running" || !st.serving) return null;
    const ip = (st.ips || []).find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a));
    return ip ? `http://${ip}:${this.port}` : null;
  }

  async start() {
    if (this.proc || !this.available || !this.enabled) return;
    this.stopping = false;
    if (!(await this.ensureEngine())) return;
    if (this.proc || this.stopping) return;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.secret = crypto.randomBytes(24).toString("hex");
    const env = Object.assign({}, this.env, { MUSICDNET_SECRET: this.secret, HOME: this.dir });
    delete env.TS_AUTHKEY;    // given to the engine through its API, not inherited
    const p = spawn(this.bin, ["-server", "-dir", this.dir], { env, stdio: ["pipe", "pipe", "pipe"] });
    this.proc = p;
    p.stdout.on("data", () => {});   // kept flowing: a full pipe would stall it
    const tail = [];
    p.stderr.on("data", d => { tail.push(String(d)); if (tail.length > 20) tail.shift(); });
    p.on("error", e => { this.error = e.message; });
    p.on("exit", (code) => {
      if (this.proc === p) { this.proc = null; this.ctl = null; }
      clearTimeout(this.timer);
      if (this.stopping) return;
      this.error = `stopped (${code})${tail.length ? ": " + tail.join("").trim().slice(-300) : ""}`;
      this.log(`[tailscale] ${this.error}`);
      // Started again, more slowly each time it fails.
      const wait = Math.min(60000, 2000 * 2 ** Math.min(this.restarts++, 5));
      this.timer = setTimeout(() => this.start().catch(() => {}), wait);
      if (this.timer.unref) this.timer.unref();
    });
    try {
      this.ctl = await firstLine(p.stdout, 10000).then(l => {
        const m = /^CONTROL (\d+)/.exec(l);
        if (!m) throw new Error("unexpected first line: " + l);
        return Number(m[1]);
      });
      this.error = null;
      await this.call("POST", "/start", { Hostname: this.hostname(), AuthKey: this.env.TS_AUTHKEY || "", ControlURL: this.env.TS_CONTROL_URL || "" }, 30000);
      this.log(`[tailscale] built-in Tailscale started as "${this.hostname()}"`);
    } catch (e) {
      this.error = e.message;
      this.log(`[tailscale] couldn't start: ${e.message}`);
    }
    this.poll();
  }

  /* Every few seconds: how it is, and once joined, serving the server's port. */
  async poll() {
    clearTimeout(this.timer);
    if (!this.proc || this.stopping) return;
    try {
      const st = await this.call("GET", "/status", null, 4000);
      const was = this.last && this.last.state;
      this.last = st;
      if (st.state === "Running" && !st.serving) {
        await this.call("POST", `/serve?port=${this.port}&upstream=${encodeURIComponent("http://127.0.0.1:" + this.port)}`, null, 10000);
        this.last = await this.call("GET", "/status", null, 4000);
        this.restarts = 0;
        this.log(`[tailscale] on your tailnet: ${this.address() || "(no address yet)"}${this.last.dns_name ? " — " + String(this.last.dns_name).replace(/\.$/, "") : ""}`);
      } else if (st.state !== was && st.state === "NeedsLogin") {
        this.log("[tailscale] waiting to be signed in: Settings → Setup → Away from home");
      }
      if (await this.watch(st)) return;
    } catch (e) { /* asked again shortly */ }
    this.timer = setTimeout(() => this.poll(), POLL_MS);
    if (this.timer.unref) this.timer.unref();
  }

  /* A sign-in link (asks for a new one: after signing out, or an expired key). */
  /* The watchdog (v0.7.2): true when the engine was started afresh (the poll
   * is start()'s then). An older engine that doesn't say whether it is
   * online is left alone. */
  async watch(st) {
    const bad = st.state === "Running" && (st.online === false || (Array.isArray(st.health) && st.health.length > 0));
    if (!bad) { this.badSince = null; this.rebound = null; return false; }
    if (!this.badSince) { this.badSince = Date.now(); return false; }
    const since = Date.now() - this.badSince;
    const why = st.online === false ? "not online on the tailnet" : "Tailscale warns: " + st.health.join("; ");
    // A rebind first; the fresh start only once that has had its time.
    if (this.rebound && Date.now() - this.rebound >= this.watchdog.restartMs) {
      this.log(`[tailscale] ${why} for ${Math.round(since / 1000)} s after a rebind: starting the engine afresh`);
      this.badSince = null; this.rebound = false;
      await this.restart();
      return true;
    }
    if (!this.rebound && since >= this.watchdog.rebindMs) {
      this.rebound = Date.now();
      this.log(`[tailscale] ${why} for ${Math.round(since / 1000)} s: asking Tailscale to rebind`);
      await this.call("POST", "/rebind", null, 12000).catch(e => this.log(`[tailscale] rebind: ${e.message}`));
    }
    return false;
  }

  async login() {
    if (!this.proc) await this.start();
    if (!this.proc) throw new Error(this.available ? "Tailscale is switched off" : "Tailscale isn't in this install");
    const st = await this.call("POST", "/login", null, 20000);
    this.last = Object.assign({}, this.last, st);
    return this.status();
  }

  async logout() {
    if (!this.proc) return this.status();
    await this.call("POST", "/logout", null, 15000);
    // The port it served goes with it: started afresh, it asks to be signed in again.
    await this.restart();
    return this.status();
  }

  async setEnabled(on) {
    this.db.setSetting("tailscale", { enabled: !!on });
    if (on) await this.start(); else this.stop();
    return this.status();
  }

  async restart() {
    this.stop();
    await new Promise(r => setTimeout(r, 300));
    await this.start();
  }

  stop() {
    this.stopping = true;
    clearTimeout(this.timer);
    const p = this.proc;
    this.proc = null; this.ctl = null; this.last = null;
    if (p) { try { p.stdin.end(); } catch (e) {} setTimeout(() => { try { p.kill(); } catch (e) {} }, 1500).unref(); }
  }

  async call(method, pathQ, body, timeoutMs = 8000) {
    if (!this.ctl) throw new Error("not running");
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(`http://127.0.0.1:${this.ctl}${pathQ}`, {
        method, signal: ctl.signal,
        headers: Object.assign({ "X-Secret": this.secret }, body ? { "Content-Type": "application/json" } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return j;
    } finally { clearTimeout(t); }
  }
}

function executable(p) {
  try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch (e) { return false; }
}

function firstLine(stream, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => { cleanup(); reject(new Error("the engine didn't start")); }, timeoutMs);
    const onData = d => {
      buf += String(d);
      const i = buf.indexOf("\n");
      if (i >= 0) { cleanup(); resolve(buf.slice(0, i).trim()); }
    };
    const onEnd = () => { cleanup(); reject(new Error("the engine didn't start")); };
    function cleanup() { clearTimeout(t); stream.off("data", onData); stream.off("end", onEnd); }
    stream.on("data", onData);
    stream.on("end", onEnd);
  });
}

module.exports = { TailscaleNode };
