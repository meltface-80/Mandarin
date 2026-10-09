"use strict";
/*
 * The C# server kept at the Node server's version (v0.8.25; stage 0 of
 * docs/specs/csharp-migration.md). An update from Settings brings the Node
 * server's files; the Node server, started by a C# server of another version,
 * fetches the release's C# server for this machine, checks it (its SHA-256
 * sum, then `--version`), puts it in place and stops with code 76, on which
 * the C# server starts itself again from the new file (lib/server/
 * csharp-update.js, Program.cs). Until the two match, the C# server passes
 * everything on and its background work stays with the Node server. GitHub and
 * the C# server in front are stood in for here; the C# server's own part is
 * run for real where it is built.
 */
const PORT = 3676, FAKE = 3677, NODE = 3678;
process.env.UPDATE_API = "http://127.0.0.1:" + FAKE;

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const zlib = require("zlib");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const { createCsharpUpdate } = require("../lib/server/csharp-update");
const pkg = require("../package.json");

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const noBin = !fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const B = "http://127.0.0.1:" + FAKE;

// GitHub and the C# server in front, stood in for: a release, its files, /server-info.
const fake = { front: "9.9.8", release: null, files: {}, asked: [] };
const server = http.createServer((req, res) => {
  fake.asked.push(req.url);
  const send = (code, body, type) => { res.writeHead(code, { "Content-Type": type || "application/json" }); res.end(body); };
  if (req.url === "/server-info") return fake.front ? send(200, JSON.stringify({ server: "C#", version: fake.front })) : send(404, "{}");
  if (req.url === "/repos/meltface-80/Mandarin/releases/tags/v9.9.9") return fake.release ? send(200, JSON.stringify(fake.release)) : send(404, "{}");
  if (fake.files[req.url]) return send(200, fake.files[req.url], "application/octet-stream");
  send(404, "{}");
});

/* A release of 9.9.9 whose program, asked, says `says`; its sum right unless `badSum`. */
function release({ says = "9.9.9", badSum = false, withProgram = true } = {}) {
  const prog = Buffer.from(`#!/bin/sh\nif [ "$1" = "--version" ]; then echo ${says}; exit 0; fi\nexit 3\n`);
  const gz = zlib.gzipSync(prog);
  const sum = crypto.createHash("sha256").update(badSum ? Buffer.from("other") : gz).digest("hex");
  fake.files = { "/dl/mandarin-server-linux-x64.gz": gz, "/dl/mandarin-server.sha256": `${sum}  mandarin-server-linux-x64.gz\n${"0".repeat(64)}  mandarin-server-linux-arm64.gz\n` };
  fake.release = {
    tag_name: "v9.9.9",
    assets: (withProgram ? ["mandarin-server-linux-x64.gz", "mandarin-server.sha256"] : ["musicd-server-9.9.9.tar.gz"])
      .map(name => ({ name, browser_download_url: B + "/dl/" + name }))
  };
  return prog;
}

/* An install: the running C# server's file, a data folder, and the updater over them. */
function install(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "csharp-update-"));
  const bin = path.join(dir, "app", "server", "bin", "mandarin-server");
  const data = path.join(dir, "data");
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.mkdirSync(data);
  fs.writeFileSync(bin, "the old program", { mode: 0o755 });
  const exits = [], logs = [];
  let stops = 0;
  const u = createCsharpUpdate(Object.assign({
    version: "9.9.9", dataDir: data, owner: "meltface-80", repo: "Mandarin",
    env: { MANDARIN_FRONT: "csharp", MANDARIN_FRONT_URL: B, MANDARIN_SERVER_BIN: bin },
    platform: "linux", arch: "x64", waitMs: 1500, retryMs: 0, sleep: () => sleep(20),
    exit: c => exits.push(c), stop: async () => { stops++; }, log: s => logs.push(s)
  }, opts));
  return { u, bin, data, exits, logs, stops: () => stops, left: () => fs.readdirSync(path.dirname(bin)).sort() };
}

test("the C# server brought up to the Node server's version", async (t) => {
  await new Promise(r => server.listen(FAKE, "127.0.0.1", r));
  t.after(() => server.close());

  await t.test("in front of another version: the release's program checked, put in place, and everything started again", async () => {
    fake.front = "9.9.8";
    const prog = release();
    const i = install();
    const st = await i.u.run();
    assert.deepEqual([st.phase, st.version, st.matched], ["restarting", "9.9.8", false]);
    assert.deepEqual(fs.readFileSync(i.bin), prog, "the new program in place");
    assert.ok(fs.statSync(i.bin).mode & 0o100, "and runnable");
    assert.equal(fs.readFileSync(i.bin + ".version", "utf8"), "9.9.9\n");
    assert.deepEqual(i.left(), ["mandarin-server", "mandarin-server.version"], "nothing else left beside it");
    assert.equal(i.stops(), 1, "stopped cleanly first");
    assert.deepEqual(i.exits, [76], "then code 76: the C# server starts itself again");
    assert.equal(JSON.parse(fs.readFileSync(path.join(i.data, "csharp-update.json"), "utf8")).tries, 1);
  });

  await t.test("the same version: nothing fetched, nothing restarted", async () => {
    fake.front = "9.9.9";
    release();
    const i = install();
    fs.writeFileSync(path.join(i.data, "csharp-update.json"), JSON.stringify({ version: "9.9.9", tries: 1 }));
    fake.asked = [];
    const st = await i.u.run();
    assert.deepEqual([st.phase, st.version, st.matched], ["matched", "9.9.9", true]);
    assert.deepEqual(fake.asked, ["/server-info"]);
    assert.equal(fs.readFileSync(i.bin, "utf8"), "the old program");
    assert.deepEqual(i.exits, []);
    assert.ok(!fs.existsSync(path.join(i.data, "csharp-update.json")), "the tries forgotten once they match");
  });

  await t.test("a program that doesn't match its sum, or says another version, is never put in place", async () => {
    fake.front = "9.9.8";
    for (const r of [{ badSum: true }, { says: "1.0.0" }]) {
      release(r);
      const i = install();
      const st = await i.u.run();
      assert.equal(st.phase, "error");
      assert.match(st.error, r.badSum ? /doesn't match its sum/ : /says 1\.0\.0, not 9\.9\.9/);
      assert.equal(fs.readFileSync(i.bin, "utf8"), "the old program");
      assert.deepEqual(i.left(), ["mandarin-server"], "nothing left beside it");
      assert.deepEqual(i.exits, []);
    }
  });

  await t.test("a release without the C# server (made before v0.8.25): left as it is", async () => {
    fake.front = "9.9.8";
    release({ withProgram: false });
    const i = install();
    const st = await i.u.run();
    assert.equal(st.phase, "unavailable");
    assert.deepEqual(i.exits, []);
    fake.release = null;
    const j = install();
    assert.equal((await j.u.run()).phase, "unavailable", "nor a release not there at all");
  });

  await t.test("twice at most for a version: a program that won't come up can't keep the server restarting", async () => {
    fake.front = "9.9.8";
    release();
    const i = install();
    fs.writeFileSync(path.join(i.data, "csharp-update.json"), JSON.stringify({ version: "9.9.9", tries: 2 }));
    fake.asked = [];
    const st = await i.u.run();
    assert.equal(st.phase, "gave-up");
    assert.match(st.error, /docker pull/);
    assert.deepEqual(fake.asked, ["/server-info"], "nothing fetched");
    assert.deepEqual(i.exits, []);
    // A newer version is tried afresh.
    const k = install({ version: "9.9.9" });
    fs.writeFileSync(path.join(k.data, "csharp-update.json"), JSON.stringify({ version: "9.9.7", tries: 2 }));
    assert.equal((await k.u.run()).phase, "restarting");
  });

  await t.test("already in place, the start again not made: only that is left to do", async () => {
    fake.front = "9.9.8";
    release();
    const i = install();
    fs.writeFileSync(i.bin + ".version", "9.9.9\n");
    fake.asked = [];
    const st = await i.u.run();
    assert.equal(st.phase, "restarting");
    assert.deepEqual(fake.asked, ["/server-info"], "nothing fetched");
    assert.deepEqual(i.exits, [76]);
  });

  await t.test("not asked to: the Node server alone, not Linux, a machine with no build, or switched off", async () => {
    fake.asked = [];
    const cases = [
      [{ env: {} }, "none"],
      [{ platform: "darwin" }, "unsupported"],
      [{ arch: "ia32" }, "unsupported"],
      [{ env: { MANDARIN_FRONT: "csharp", MANDARIN_FRONT_URL: B, MANDARIN_SERVER_UPDATE: "0" } }, "off"]
    ];
    for (const [opts, phase] of cases) {
      const i = install(opts);
      assert.equal((await i.u.run()).phase, phase);
      assert.deepEqual(i.exits, []);
    }
    assert.deepEqual(fake.asked, [], "nothing asked of anyone");
  });

  await t.test("not to be had just now: asked again later, then put in place", async () => {
    fake.front = "9.9.8";
    fake.release = null;
    const i = install({ retryMs: 50 });
    assert.equal((await i.u.run()).phase, "unavailable");
    release();
    const ok = await (async () => { for (let n = 0; n < 100; n++) { if (i.exits.length) return true; await sleep(50); } return false; })();
    assert.ok(ok, "asked again: " + JSON.stringify(i.u.status()));
    assert.deepEqual(i.exits, [76]);
    i.u.stop();
  });

  await t.test("a C# server that never says its version: left as it is", async () => {
    fake.front = null;
    const i = install();
    const st = await i.u.run();
    assert.equal(st.phase, "unknown");
    assert.deepEqual(i.exits, []);
  });
});

test("the Node server: its version told, and a C# server of another version turned down", { timeout: 60000 }, async () => {
  const { makeLibrary } = require("./fixtures");
  const lib = makeLibrary();
  const front = process.env.MANDARIN_FRONT === "1";
  // Alone, as if started by a C# server that hasn't asked yet.
  if (!front) process.env.MANDARIN_FRONT_RUNS = "loudness,mbpack";
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  if (!front) delete process.env.MANDARIN_FRONT_RUNS;
  try {
    const at = "http://127.0.0.1:" + ctx.listeningOn;
    const H = { "X-Mandarin-Front-Key": ctx.frontKey, "Content-Type": "application/json" };
    const j = await (await fetch(at + "/internal/library", { headers: H })).json();
    assert.equal(j.app_version, pkg.version, "its version, with its state");
    for (const version of ["0.0.1", undefined]) {
      const r = await fetch(at + "/internal/front/runs", { method: "POST", headers: H, body: JSON.stringify({ jobs: ["loudness", "mbpack"], version }) });
      assert.equal(r.status, 409, "another version (or one that doesn't say) is turned down");
      assert.deepEqual(await r.json(), { ok: false, version: pkg.version });
    }
    if (!front) {
      assert.equal(ctx.frontRunsWait, null, "its share made here at once, not after two minutes");
      assert.equal(ctx.madeByFront("loudness"), false);
      assert.equal(ctx.frontRuns, undefined, "nothing handed over");
    }
    assert.equal(ctx.csharpUpdate.status().phase, "none", "not started by a C# server: nothing to bring up to date");
    const h = await (await fetch(at + "/api/health")).json();
    assert.equal(h.csharp.phase, "none");
  } finally {
    await srv.stop();
  }
});

test("Tailscale's engine already running for the data folder (the C# server's) is left to it, not started twice", { skip: process.platform !== "linux" && "Linux only (/proc)" }, async () => {
  const { TailscaleNode } = require("../lib/server/tsnode");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-dir-"));
  const look = (d, ours) => TailscaleNode.prototype.elsewhere.call({ dir: d, ours });
  assert.equal(look(dir), false);
  const other = spawn("sh", ["-c", "sleep 30", "-server", "-dir", dir], { stdio: "ignore" });
  try {
    await sleep(200);
    assert.equal(look(dir), true, "another engine on this folder");
    assert.equal(look(dir + "-other"), false, "not one on another folder");
    assert.equal(look(dir, new Set([other.pid])), false, "nor this server's own");
    // Taking the work back: left to that engine, and started once it has gone.
    const logs = [];
    const started = [];
    const ts = Object.assign(Object.create(TailscaleNode.prototype), { dir, front: null, proc: null, log: s => logs.push(s), start: async () => { started.push(Date.now()); } });
    await ts.startUnlessElsewhere();
    assert.deepEqual(started, [], "not a second engine on the folder");
    assert.match(logs.join("\n"), /already running for this data folder/);
    clearTimeout(ts.otherTimer);
    other.kill("SIGKILL");
    await sleep(200);
    await ts.startUnlessElsewhere();
    assert.equal(started.length, 1, "started once it had gone");
  } finally {
    other.kill("SIGKILL");
  }
});

test("the C# server: its version, everything passed on to a Node server of another, and code 76", { skip: noBin, timeout: 90000 }, async (t) => {
  await t.test("`mandarin-server --version` says its version, and nothing else", () => {
    const r = spawnSync(BIN, ["--version"], { encoding: "utf8", timeout: 30000 });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, pkg.version + "\n");
  });

  /* The C# server, its output kept; stopped at the end. */
  const run = (env) => {
    const out = [];
    const p = spawn(BIN, [], { env: Object.assign({}, process.env, { PORT: String(PORT), MANDARIN_LOOPBACK_ONLY: "1" }, env), stdio: ["ignore", "pipe", "pipe"] });
    p.stdout.on("data", d => out.push(String(d)));
    p.stderr.on("data", d => out.push(String(d)));
    t.after(() => { if (p.exitCode == null && p.signalCode == null) p.kill("SIGKILL"); });
    return { p, out: () => out.join("") };
  };
  const ask = async (p, ms = 30000) => {
    const until = Date.now() + ms;
    for (;;) {
      try {
        const r = await fetch("http://127.0.0.1:" + PORT + p, { signal: AbortSignal.timeout(3000) });
        return { status: r.status, text: await r.text() };
      } catch (e) { if (Date.now() > until) throw e; await sleep(100); }
    }
  };
  const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > ms) return false; await sleep(100); } return true; };

  await t.test("a Node server of another version behind it: everything passed on but /server-info, /internal still closed, no work taken", async () => {
    const node = { version: "0.0.1", claims: [] };
    const fakeNode = http.createServer((req, res) => {
      let body = "";
      req.on("data", d => { body += d; });
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/internal/library") return res.end(JSON.stringify({ boot: "b1", version: 1, marks: 0, app_version: node.version, day: "2026-10-09", week: "2026-W41" }));
        if (req.url === "/internal/front/runs") { node.claims.push(JSON.parse(body || "{}")); res.statusCode = 409; return res.end(JSON.stringify({ ok: false })); }
        res.end(JSON.stringify({ fake: true, path: req.url }));
      });
    });
    await new Promise(r => fakeNode.listen(NODE, "127.0.0.1", r));
    t.after(() => fakeNode.close());
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "csharp-front-"));
    const c = run({ MANDARIN_UPSTREAM: "http://127.0.0.1:" + NODE, MANDARIN_FRONT_KEY: "k", DATA_DIR: data, MANDARIN_APP_DIR: path.join(__dirname, "..") });
    let r = await ask("/api/library/albums");
    assert.deepEqual(JSON.parse(r.text), { fake: true, path: "/api/library/albums" }, "passed on, not gated here");
    r = await ask("/server-info");
    assert.deepEqual(JSON.parse(r.text), { server: "C#", version: pkg.version });
    assert.equal((await ask("/internal/library")).status, 404);
    assert.equal(node.claims.length, 1, "asked once, then not again");
    assert.equal(node.claims[0].version, pkg.version, "saying its version");
    assert.match(c.out(), /the Node server is 0\.0\.1, this one .*: everything passed to it/);
    // The Node server now of this version: answered here again (the gate, here: no account yet).
    node.version = pkg.version;
    assert.ok(await until(async () => !(await ask("/api/library/albums")).text.includes("fake")), "answered here again");
    c.p.kill("SIGTERM");
    await new Promise(r => c.p.once("exit", r));
  });

  await t.test("the Node server stopping with code 76: the C# server starts itself again, in the same process, from its file", async () => {
    // A stand-in for the Node server's launcher: answers, and the first time stops with 76.
    const app = fs.mkdtempSync(path.join(os.tmpdir(), "csharp-app-"));
    fs.mkdirSync(path.join(app, "public"));
    fs.writeFileSync(path.join(app, "public", "index.html"), "<!doctype html>");
    fs.writeFileSync(path.join(app, "index.js"), "");
    fs.writeFileSync(path.join(app, "launcher.js"), `
      const http = require("http"), fs = require("fs"), path = require("path");
      const f = path.join(__dirname, "runs");
      const run = (fs.existsSync(f) ? Number(fs.readFileSync(f, "utf8")) : 0) + 1;
      fs.writeFileSync(f, String(run));
      http.createServer((req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/internal/library") return res.end(JSON.stringify({ boot: "b" + run, version: 1, marks: 0, app_version: "0.0.1" }));
        if (req.url === "/internal/front/runs") { res.statusCode = 409; return res.end("{}"); }
        res.end(JSON.stringify({ run }));
      }).listen(Number(process.env.INTERNAL_PORT), "127.0.0.1");
      if (run === 1) setTimeout(() => process.exit(76), 1500);
    `);
    const c = run({ MANDARIN_APP_DIR: app, NODE_BIN: process.execPath, DATA_DIR: path.join(app, "data") });
    const pid = c.p.pid;
    let r = await ask("/api/zones");
    assert.equal(JSON.parse(r.text).run, 1);
    assert.ok(await until(async () => { try { return JSON.parse((await ask("/api/zones")).text).run === 2; } catch (e) { return false; } }, 30000), "the Node server started again by it: " + c.out());
    assert.equal(c.p.exitCode, null, "the C# server never stopped");
    assert.equal(c.p.pid, pid);
    assert.match(c.out(), /the Node server stopped \(code 76\)/);
    assert.match(c.out(), /starting again from /);
    c.p.kill("SIGTERM");
    await new Promise(r => c.p.once("exit", r));
  });
});
