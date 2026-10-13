"use strict";
/*
 * Loaded before every test file (package.json's test script): the album
 * identification scan stays off unless a test turns it on, so the suite never
 * asks the real MusicBrainz about the fixture library.
 */
if (!process.env.IDENTIFY) process.env.IDENTIFY = "0";
// Nor this machine's own sound devices (v0.6.18): a test brings its own.
if (!process.env.LOCAL_AUDIO) process.env.LOCAL_AUDIO = "0";
// Nor the tag readers' check (v0.8.13): a child process reading every file; its own test turns it on.
if (!process.env.TAGCHECK) process.env.TAGCHECK = "0";
// Nor Apple's iTunes: a closed port on loopback unless a test brings a fake.
if (!process.env.ITUNES_URL) process.env.ITUNES_URL = "http://127.0.0.1:9";

// Nor anything else off this machine (v0.6.2): GitHub's runners reach the
// internet and this suite must not. Opening a page or an album makes the
// server look things up (an album's write-up, related artists); unanswered
// here they fail at once, as they do offline, instead of running on after
// a test has ended. Loopback — the fakes, the server under test — is
// untouched. ALLOW_NETWORK=1 lifts it.
//
// And no request waits for ever (v0.8.49): a server that never answers (a
// deadlock, a request held behind a stuck one) used to hold a test file open
// to its five-minute timeout, with nothing in the log to say which request.
// Now the request fails after a minute and a half, naming its address. The
// longest a test's request legitimately takes is the phone's long poll (25 s).
if (typeof globalThis.fetch === "function") {
  const real = globalThis.fetch;
  const LOCAL = /^(127\.|localhost$|\[?::1\]?$)/;
  const PATIENCE_MS = 90000;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    let host = "";
    try { host = new URL(url).hostname; } catch (e) { /* not a URL: let fetch say so */ }
    if (host && !LOCAL.test(host) && !process.env.ALLOW_NETWORK) throw new TypeError(`fetch failed: ${host} is off limits to the tests (test/setup.js)`);
    if (init && init.signal) return real(input, init);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error(`${(init && init.method) || "GET"} ${url} gave no answer in ${PATIENCE_MS / 1000} s (test/setup.js)`)), PATIENCE_MS);
    try { return await real(input, Object.assign({}, init, { signal: ac.signal })); }
    finally { clearTimeout(timer); }
  };
}

/*
 * MANDARIN_FRONT=1 (v0.8.1): every server a test starts sits behind
 * Mandarin's C# server (server/), as it does in the image. The Node server
 * runs here as before (so a test can still look inside it) on a free port on
 * 127.0.0.1, and the C# server takes the port the test asked for, passing on
 * what it doesn't answer itself. Every request the suite makes then goes
 * through C# first. MANDARIN_SERVER_BIN names the program; else server/bin.
 */
if (process.env.MANDARIN_FRONT === "1") {
  const path = require("path");
  const fs = require("fs");
  const net = require("net");
  const { spawn } = require("child_process");
  const bin = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
  if (!fs.existsSync(bin)) throw new Error("MANDARIN_FRONT=1 needs the C# server built (server/build.sh): " + bin);
  // As in the image once the tag check has passed (v0.8.18): the library
  // scans are made by the C# server — a scanner a test makes itself too.
  process.env.MANDARIN_SERVER_BIN = bin;
  process.env.MANDARIN_SERVER_SCAN = "1";
  // And the database made by it (v0.8.48), as the C# server has the Node server make it.
  process.env.MANDARIN_SERVER_DB = "1";
  // Nor anything off this machine from the C# server (v0.8.19): its lookups
  // (MusicBrainz, iTunes, the pack) are kept to loopback as fetch is above.
  if (!process.env.ALLOW_NETWORK) process.env.MANDARIN_LOOPBACK_ONLY = "1";
  if (!process.env.TAG_READER) process.env.TAG_READER = "csharp";
  // As the C# server starts the Node server in the image (Front.cs, v0.8.22
  // here): the work it takes over isn't started by the Node server first —
  // Tailscale's engine among it, which would otherwise start twice.
  if (!process.env.MANDARIN_FRONT_RUNS) process.env.MANDARIN_FRONT_RUNS = "identify,mbpack,loudness,labels,days,taste,tailscale,scan,prune,import,services,update,cpu,playback";
  require("../lib/library/scanner").Scanner.program = bin;
  const listening = (port, ms) => new Promise((resolve, reject) => {
    const until = Date.now() + ms;
    const tryOnce = () => {
      const s = net.connect(port, "127.0.0.1", () => { s.destroy(); resolve(); });
      s.on("error", () => { s.destroy(); if (Date.now() > until) reject(new Error("the C# server didn't start on " + port)); else setTimeout(tryOnce, 50); });
    };
    tryOnce();
  });
  // Exited, or killed (a signal leaves exitCode null): not to be waited for again.
  const gone = (p) => p.exitCode != null || p.signalCode != null;
  // Every load of index.js, a test's fresh one too (delete require.cache…),
  // is put behind the C# server (v0.8.19: before, a test that loaded it
  // again ran on the Node server alone).
  const putBehind = (index) => {
    if (!index || typeof index.createServer !== "function" || index.createServer.behindCsharp) return index;
    const real = index.createServer;
    index.createServer = (overrides = {}) => {
      const port = overrides.port != null ? overrides.port : index.config.port;
      const s = real(Object.assign({}, overrides, { listenPort: 0 }));
      const start = s.start, stop = s.stop;
      let front = null;
      s.start = async () => {
        const ctx = await start();
        // The cores the machine gave this process, as the C# server would find them
        // starting first (v0.8.48: it decides the split): not the rest this one has
        // already kept itself to.
        const cpus = require("../lib/cpu").plan().cores;
        front = spawn(bin, [], {
          env: Object.assign({}, process.env, { PORT: String(port), MANDARIN_UPSTREAM: "http://127.0.0.1:" + ctx.listeningOn, MANDARIN_FRONT_KEY: ctx.frontKey, DATA_DIR: ctx.config.dataDir },
            cpus.length ? { MANDARIN_CPUS: cpus.join(",") } : {}),
          stdio: ["ignore", "inherit", "inherit"]
        });
        front.on("exit", (code) => { if (code && front) console.log(`# the C# server exited (${code})`); });
        // The Node server stopping stops the C# server too, as in the image
        // (Restart, Shut down): the port goes quiet, not "bad gateway".
        const mine = front;
        ctx.httpServer.once("close", () => { if (!gone(mine)) mine.kill("SIGKILL"); });
        await listening(port, 30000);
        // As in the image: the conversions of the music folders' own files are made by C#.
        ctx.useFront("http://127.0.0.1:" + port);
        return ctx;
      };
      s.stop = async () => {
        const f = front; front = null;
        if (f && !gone(f)) {
          const gone = new Promise(r => f.once("exit", r));
          f.kill("SIGTERM");
          await Promise.race([gone, new Promise(r => setTimeout(r, 5000))]);
          if (f.exitCode == null) f.kill("SIGKILL");
        }
        return stop();
      };
      return s;
    };
    index.createServer.behindCsharp = true;
    return index;
  };
  const Module = require("module");
  const indexFile = require.resolve("../index.js");
  const load = Module._load;
  Module._load = function (request, parent, isMain) {
    const out = load.apply(this, arguments);
    if (out && typeof out.createServer === "function" && !out.createServer.behindCsharp) {
      let file = null;
      try { file = Module._resolveFilename(request, parent, isMain); } catch (e) { /* not a file */ }
      if (file === indexFile) putBehind(out);
    }
    return out;
  };
  putBehind(require("../index.js"));
}
