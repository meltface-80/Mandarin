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
 *
 * v0.8.29: a Mac's build on a Mac, signed to run there; and prepare(), which
 * an update from Settings calls before it stages anything, so the C# server of
 * the new version is in place first, or the update stops with nothing changed.
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

/* A release of 9.9.9 whose program for `build`, asked, says `says`; its sum right unless `badSum`. */
function release({ says = "9.9.9", badSum = false, withProgram = true, build = "linux-x64" } = {}) {
  const prog = Buffer.from(`#!/bin/sh\nif [ "$1" = "--version" ]; then echo ${says}; exit 0; fi\nexit 3\n`);
  const gz = zlib.gzipSync(prog);
  const sum = crypto.createHash("sha256").update(badSum ? Buffer.from("other") : gz).digest("hex");
  const name = `mandarin-server-${build}.gz`;
  fake.files = { ["/dl/" + name]: gz, "/dl/mandarin-server.sha256": `${sum}  ${name}\n${"0".repeat(64)}  mandarin-server-linux-arm64.gz\n` };
  fake.release = {
    tag_name: "v9.9.9",
    assets: (withProgram ? [name, "mandarin-server.sha256"] : ["musicd-server-9.9.9.tar.gz"])
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

  await t.test("not asked to: the Node server alone, a system or a processor with no build, or switched off", async () => {
    fake.asked = [];
    const cases = [
      [{ env: {} }, "none"],
      [{ platform: "win32" }, "unsupported"],
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

  await t.test("on a Mac (v0.8.29): this Mac's build, signed to run there, put in place", async () => {
    fake.front = "9.9.8";
    fake.asked = [];
    const prog = release({ build: "osx-arm64" });
    const signed = [];
    const i = install({ platform: "darwin", arch: "arm64", codesign: f => { signed.push(path.basename(f)); return true; } });
    const st = await i.u.run();
    assert.equal(st.phase, "restarting");
    assert.ok(fake.asked.includes("/dl/mandarin-server-osx-arm64.gz"), "the Mac's build: " + fake.asked.join(", "));
    assert.deepEqual(signed, ["mandarin-server.new"], "checked for a signature (signed if it has none) before it is run");
    assert.deepEqual(fs.readFileSync(i.bin), prog);
    assert.deepEqual(i.exits, [76]);
    // One that can't be signed is never put in place.
    release({ build: "osx-x64" });
    const j = install({ platform: "darwin", arch: "x64", codesign: () => false });
    assert.equal((await j.u.run()).phase, "error");
    assert.match(j.u.status().error, /couldn't be signed/);
    assert.equal(fs.readFileSync(j.bin, "utf8"), "the old program");
    assert.deepEqual(j.left(), ["mandarin-server"], "nothing left beside it");
  });

  await t.test("before an update (v0.8.29): the new version's C# server in place first; then only the start again is left", async () => {
    fake.front = "9.9.8";
    const prog = release();
    // The Node server of 9.9.8, updating to 9.9.9 from Settings.
    const i = install({ version: "9.9.8" });
    fake.asked = [];
    assert.equal(await i.u.prepare("9.9.9"), "9.9.9");
    assert.deepEqual(fs.readFileSync(i.bin), prog, "the new program in place, the running one carrying on from the old file");
    assert.equal(fs.readFileSync(i.bin + ".version", "utf8"), "9.9.9\n");
    assert.deepEqual(i.left(), ["mandarin-server", "mandarin-server.version"]);
    assert.deepEqual([i.exits, i.stops()], [[], 0], "nothing stopped: the update stages the rest and restarts");
    assert.ok(!fake.asked.includes("/server-info"), "the C# server in front isn't asked");
    // The update's new Node server, of 9.9.9, starts behind the C# server of 9.9.8.
    const next = install({ version: "9.9.9", env: { MANDARIN_FRONT: "csharp", MANDARIN_FRONT_URL: B, MANDARIN_SERVER_BIN: i.bin }, dataDir: i.data });
    fake.asked = [];
    const st = await next.u.run();
    assert.equal(st.phase, "restarting");
    assert.deepEqual(fake.asked, ["/server-info"], "nothing fetched again");
    assert.deepEqual(next.exits, [76], "only the start again");
  });

  await t.test("before an update: if it can't be had, the update stops and nothing has changed", async () => {
    fake.front = "9.9.8";
    for (const [why, rel] of [["no program in the release", { withProgram: false }], ["a wrong sum", { badSum: true }], ["the wrong version", { says: "9.9.7" }]]) {
      release(rel);
      const i = install({ version: "9.9.8" });
      await assert.rejects(i.u.prepare("9.9.9"), /the C# server 9\.9\.9 couldn't be fetched .*; nothing was changed/, why);
      assert.equal(fs.readFileSync(i.bin, "utf8"), "the old program", why + ": the old program as it was");
      assert.deepEqual(i.left(), ["mandarin-server"], why + ": nothing left beside it");
    }
    release();
    const win = install({ version: "9.9.8", platform: "win32" });
    await assert.rejects(win.u.prepare("9.9.9"), /no C# server is built for this machine/, "a machine with no build would be left behind");
  });

  await t.test("before an update: nothing to do with no C# server in front, or its updates switched off", async () => {
    release();
    fake.asked = [];
    for (const env of [{}, { MANDARIN_FRONT: "csharp", MANDARIN_FRONT_URL: B, MANDARIN_SERVER_UPDATE: "0" }]) {
      const i = install({ version: "9.9.8", env });
      assert.equal(await i.u.prepare("9.9.9"), null);
      assert.equal(fs.readFileSync(i.bin, "utf8"), "the old program");
    }
    assert.deepEqual(fake.asked, [], "nothing asked of anyone");
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
      // The cores it was told the machine has (lib/cpu.js), and a split of
      // them as the Node server sends it: the last kept for playback, the C#
      // server kept to the rest (Cpu.cs Follow).
      // Gone with the C# server that started it (a failed test kills that one):
      // left running, it would hold this test file open to its timeout.
      const parent = process.ppid;
      setInterval(() => { if (process.ppid !== parent) process.exit(0); }, 300);
      const told = process.env.MANDARIN_CPUS || "";
      fs.writeFileSync(path.join(__dirname, "cpus-" + run), told);
      const cores = told.split(",").filter(Boolean).flatMap(p => { const [a, b] = p.split("-").map(Number); return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i); });
      const cpu = cores.length >= 2 ? { split: true, cores, playback: cores.slice(-1), background: cores.slice(0, -1) } : undefined;
      const allowed = (pid) => { try { return /Cpus_allowed_list:\\s*(\\S+)/.exec(fs.readFileSync("/proc/" + pid + "/status", "utf8"))[1]; } catch (e) { return ""; } };
      http.createServer((req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/internal/library") return res.end(JSON.stringify({ boot: "b" + run, version: 1, marks: 0, app_version: "0.0.1", cpu }));
        if (req.url === "/internal/front/runs") { res.statusCode = 409; return res.end("{}"); }
        res.end(JSON.stringify({ run }));
      }).listen(Number(process.env.INTERNAL_PORT), "127.0.0.1");
      // The first time, stopped with 76 once the C# server has kept to the
      // rest (or at most 15 s on: the test then says it never did).
      if (run === 1) {
        const want = cpu ? cpu.background.join(",") : null, t0 = Date.now();
        const narrowed = () => want && allowed(process.ppid).split(",").flatMap(p => { const [a, b] = p.split("-").map(Number); return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i); }).join(",") === want;
        const check = () => {
          if (narrowed() || !cpu || Date.now() - t0 > 15000) { fs.writeFileSync(path.join(__dirname, "narrowed"), String(!!narrowed())); setTimeout(() => process.exit(76), 300); }
          else setTimeout(check, 100);
        };
        setTimeout(check, 1500);
      }
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
    // Kept to the cores playback doesn't keep, and then started again in this
    // same process (execv keeps a process's cores): the server started again
    // still counts every core the machine gave it, and tells the Node server
    // so (v0.8.31: it counted the rest, one fewer after every update).
    // (Linux, two cores or more: elsewhere nothing is split, nor told.)
    const first = fs.readFileSync(path.join(app, "cpus-1"), "utf8");
    const count = (list) => list.split(",").filter(Boolean).reduce((n, p) => { const [a, b] = p.split("-").map(Number); return n + (b ?? a) - a + 1; }, 0);
    if (count(first) >= 2) {
      assert.equal(fs.readFileSync(path.join(app, "narrowed"), "utf8"), "true", "the C# server kept to the rest before it started again: " + c.out());
      assert.equal(fs.readFileSync(path.join(app, "cpus-2"), "utf8"), first, "the same cores after starting again");
    }
    c.p.kill("SIGTERM");
    await new Promise(r => c.p.once("exit", r));
  });
});
