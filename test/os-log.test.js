"use strict";
/*
 * Mandarin's one log on Mandarin OS (item 425): os/…/mandarin-log, the one writer, run against a journal of the test's
 * own (journalctl's JSON entries, on standard input or from a stand-in journalctl on PATH), its paths under a root of
 * the test's own:
 *   - each of Mandarin's lines a line of /data/Logs/Mandarin_log.txt, in the order they came, saying where it came from:
 *     the server's ([server], and the app's, the page's and other Bridges' it passes on as it says them), Mandarin OS's
 *     ([os]: its scripts through logger, its units, systemd's word on them, the kernel's on Mandarin), the box's Bridge's
 *     ([bridge <its name>]); a line of a server from before 425 given [server]; a Bridge from before 425's left to the
 *     server, which fetches it; nothing that isn't Mandarin's;
 *   - scrubbed as the server scrubs its own (no keys, emails, internet addresses);
 *   - at its size the file rolls into .01 and on, ten files in all, whole lines only, none lost but the oldest let go;
 *   - followed, where the journal was read to is kept and followed from next time; stopped, it reads the journal to its
 *     end first; the logs from before (MandarinOS/Logs, MandarinServer/Logs) let go once it runs.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const WRITER = path.join(__dirname, "..", "os", "mkosi.extra", "usr", "lib", "mandarin-os", "mandarin-log");
const skip = spawnSync("python3", ["--version"]).status !== 0 && "python3 is not installed";
const LINE = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} UTC {2}(INFO |WARN |ERROR|DEBUG) {2}\[[^\]]+\] /;

/** A journal entry as journalctl -o json gives it: [us] its time in microseconds since 1970. */
function entry({ unit, ident, msg, us, pid = "4242", prio = 6, transport = "stdout", about, cursor }) {
  const e = { __REALTIME_TIMESTAMP: String(us), MESSAGE: msg, PRIORITY: String(prio), _PID: pid, _TRANSPORT: transport, __CURSOR: cursor || "c" + us };
  if (unit) e._SYSTEMD_UNIT = unit;
  if (ident) e.SYSLOG_IDENTIFIER = ident;
  if (about) e.UNIT = about;
  return JSON.stringify(e);
}
const US = Date.UTC(2026, 10, 15, 9, 43, 0) * 1000;   // 2026-11-15 09:43:00.000 UTC

function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-os-log-"));
  return { dir, logs: path.join(dir, "data", "Logs"), read: () => files(path.join(dir, "data", "Logs")).map(f => fs.readFileSync(f, "utf8")).join("") };
}
/** The log's files, oldest first. */
function files(dir) {
  if (!fs.existsSync(dir)) return [];
  const n = f => (f === "Mandarin_log.txt" ? 0 : Number(f.slice(13, 15)));
  return fs.readdirSync(dir).filter(f => /^Mandarin_log(\.\d\d)?\.txt$/.test(f)).sort((a, b) => n(b) - n(a)).map(f => path.join(dir, f));
}

test("the one log: each of Mandarin's lines saying where it came from, in the order they came, scrubbed", { skip }, () => {
  const r = root();
  try {
    const journal = [
      entry({ unit: "mandarin.service", us: US, msg: "2026-11-15 09:43:00.001 UTC  INFO   [server] [scan] 12 albums added" }),
      entry({ ident: "mandarin-os", unit: "mandarin-usb@sdb1.service", us: US + 1000, msg: "INFO [usb] mounted /data/Storage/USB/Music SSD (exfat)" }),
      entry({ unit: "mandarin.service", us: US + 2000, msg: "2026-11-15 09:42:58.500 UTC  WARN   [app Pixel 8] [NET] server GET /api/zones → HTTP 500, token=abcdef0123456789 for owner@example.com" }),
      entry({ unit: "NetworkManager.service", us: US + 3000, msg: "<info>  device (eth0): state change: activated" }),
      entry({ unit: "mandarin-bridge.service", us: US + 4000, msg: "2026-11-15 09:43:00.004 UTC  INFO   [bridge Mandarin Bridge (mandarin)] [http] listening on 49494" }),
      // A Bridge from before 425 (no word of where its line came from): the server fetches its lines itself.
      entry({ unit: "mandarin-bridge.service", us: US + 5000, msg: "2026-11-15 09:43:00.005 UTC  INFO   [http] listening on 49494" }),
      // A server from before 425: its line given [server].
      entry({ unit: "mandarin.service", us: US + 6000, msg: "2026-11-15 09:43:00.006 UTC  INFO   [auth] wrong password from 81.2.69.160" }),
      entry({ unit: "mandarin.service", us: US + 7000, prio: 3, msg: "Unhandled exception. System.IO.IOException: No space left on device" }),
      entry({ unit: "mandarin-os-page.service", us: US + 8000, prio: 3, msg: "Traceback (most recent call last):" }),
      entry({ unit: "init.scope", pid: "1", about: "mandarin.service", us: US + 9000, transport: "journal", msg: "mandarin.service: Main process exited, code=killed, status=9/KILL" }),
      entry({ unit: "init.scope", pid: "1", about: "systemd-logind.service", us: US + 9500, transport: "journal", msg: "Started systemd-logind.service" }),
      entry({ transport: "kernel", pid: "0", prio: 3, us: US + 10000, msg: "Out of memory: Killed process 4242 (mandarin-server)" }),
      entry({ transport: "kernel", pid: "0", prio: 6, us: US + 10500, msg: "usb 1-2: new high-speed USB device number 3" }),
      entry({ ident: "mandarin-os", us: US + 11000, msg: "WARN [update] Mandarin OS 0.1.10 couldn't be fetched\n  from https://user:hunter2@example.com/x" }),
      JSON.stringify({ __REALTIME_TIMESTAMP: String(US + 12000), _SYSTEMD_UNIT: "smbd.service", PRIORITY: "6", MESSAGE: [115, 109, 98, 100, 32, 0xff, 32, 115, 116, 97, 114, 116, 101, 100] }),
      "not json"
    ];
    const p = spawnSync("python3", [WRITER, "--stdin"], { input: journal.join("\n") + "\n", env: Object.assign({}, process.env, { MANDARIN_OS_ROOT: r.dir }), encoding: "utf8" });
    assert.equal(p.status, 0, p.stderr);
    assert.deepEqual(r.read().split("\n").filter(Boolean), [
      "2026-11-15 09:43:00.001 UTC  INFO   [server] [scan] 12 albums added",
      "2026-11-15 09:43:00.001 UTC  INFO   [os] [usb] mounted /data/Storage/USB/Music SSD (exfat)",
      "2026-11-15 09:42:58.500 UTC  WARN   [app Pixel 8] [NET] server GET /api/zones → HTTP 500, token=[…] for [email]",
      "2026-11-15 09:43:00.004 UTC  INFO   [bridge Mandarin Bridge (mandarin)] [http] listening on 49494",
      "2026-11-15 09:43:00.006 UTC  INFO   [server] [auth] wrong password from [wan]",
      "2026-11-15 09:43:00.007 UTC  ERROR  [server] Unhandled exception. System.IO.IOException: No space left on device",
      "2026-11-15 09:43:00.008 UTC  ERROR  [os] [page] Traceback (most recent call last):",
      "2026-11-15 09:43:00.009 UTC  INFO   [os] [systemd] mandarin.service: Main process exited, code=killed, status=9/KILL",
      "2026-11-15 09:43:00.010 UTC  ERROR  [os] [kernel] Out of memory: Killed process 4242 (mandarin-server)",
      "2026-11-15 09:43:00.011 UTC  WARN   [os] [update] Mandarin OS 0.1.10 couldn't be fetched",
      "2026-11-15 09:43:00.011 UTC  INFO   [os]   from https://[…]@example.com/x",
      "2026-11-15 09:43:00.012 UTC  INFO   [os] [samba] smbd \ufffd started"
    ]);
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

test("the one log rolls at its size into ten files of whole lines, none lost, the oldest let go", { skip }, () => {
  const r = root();
  const env = Object.assign({}, process.env, { MANDARIN_OS_ROOT: r.dir, MANDARIN_LOG_BYTES: "2000" });
  const said = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => entry({ ident: "mandarin-os", us: US + (from + i) * 1000, msg: `INFO [test] line #${String(from + i).padStart(5, "0")} of the test` })).join("\n") + "\n";
  const numbers = () => [...r.read().matchAll(/line #(\d{5}) of/g)].map(m => Number(m[1]));
  try {
    // Rolled a few times: every line there once, in order; each file whole lines, no bigger than it may be.
    assert.equal(spawnSync("python3", [WRITER, "--stdin"], { input: said(1, 60), env }).status, 0);
    assert.ok(fs.existsSync(path.join(r.logs, "Mandarin_log.02.txt")), "rolled more than once");
    assert.deepEqual(numbers(), Array.from({ length: 60 }, (_, i) => i + 1));
    for (const f of files(r.logs)) {
      const t = fs.readFileSync(f, "utf8");
      assert.ok(fs.statSync(f).size <= 2000, f);
      assert.ok(t.endsWith("\n"), f);
      for (const l of t.split("\n").filter(Boolean)) assert.match(l, LINE);
    }
    // Past ten files (a second run, as after a restart, adding to them): Mandarin_log.txt and .01 to .09, no more.
    assert.equal(spawnSync("python3", [WRITER, "--stdin"], { input: said(61, 400), env }).status, 0);
    assert.deepEqual(fs.readdirSync(r.logs).sort(), ["Mandarin_log.01.txt", "Mandarin_log.02.txt", "Mandarin_log.03.txt", "Mandarin_log.04.txt",
      "Mandarin_log.05.txt", "Mandarin_log.06.txt", "Mandarin_log.07.txt", "Mandarin_log.08.txt", "Mandarin_log.09.txt", "Mandarin_log.txt"]);
    const kept = numbers();
    assert.ok(kept[0] > 1, "the oldest let go");
    assert.deepEqual(kept, Array.from({ length: 400 - kept[0] + 1 }, (_, i) => kept[0] + i));
    assert.match(fs.readFileSync(path.join(r.logs, "Mandarin_log.txt"), "utf8"), /line #00400 of the test\n$/);
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

test("followed: where the journal was read to kept, read to its end when stopped, the logs from before let go", { skip, timeout: 30000 }, async () => {
  const r = root();
  const bin = path.join(r.dir, "bin"), calls = path.join(r.dir, "calls");
  fs.mkdirSync(bin);
  for (const d of ["data/MandarinOS/Logs", "data/MandarinServer/Logs/Bridges", "usr/lib/mandarin-os"]) fs.mkdirSync(path.join(r.dir, d), { recursive: true });
  fs.writeFileSync(path.join(r.dir, "data/MandarinOS/Logs/MandarinOS_log.txt"), "old\n");
  fs.writeFileSync(path.join(r.dir, "data/MandarinServer/Logs/MandarinServer_log.txt"), "old\n");
  fs.writeFileSync(path.join(r.dir, "data/MandarinServer/musicd.db"), "the database");
  fs.writeFileSync(path.join(r.dir, "usr/lib/mandarin-os/VERSION"), "0.1.9\n");
  // A journal: followed, what it holds then waits; read to its end, what came after.
  const os1 = (n, at) => entry({ ident: "mandarin-os", us: US + at, msg: `INFO [test] ${n}`, cursor: "s=1;i=" + n });
  fs.writeFileSync(path.join(r.dir, "follow.json"), [os1("one", 1000), os1("two", 2000)].join("\n") + "\n");
  fs.writeFileSync(path.join(r.dir, "after.json"), os1("three: said as the box stopped", 3000) + "\n");
  fs.writeFileSync(path.join(bin, "journalctl"), `#!/bin/sh\necho "$*" >> "${calls}"\ncase "$*" in\n  *--follow*) cat "${r.dir}/follow.json"; exec sleep 600 ;;\n  *) cat "${r.dir}/after.json" ;;\nesac\n`, { mode: 0o755 });
  const env = Object.assign({}, process.env, { MANDARIN_OS_ROOT: r.dir, PATH: bin + ":" + process.env.PATH });
  const run = async () => {
    const w = spawn("python3", [WRITER], { env, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    w.stderr.on("data", d => { err += d; });
    const t0 = Date.now(), twos = () => r.read().split("[test] two").length, before = twos();
    while (twos() === before) {
      if (Date.now() - t0 > 10000) { w.kill("SIGKILL"); throw new Error("nothing written: " + err); }
      await new Promise(res => setTimeout(res, 50));
    }
    w.kill("SIGTERM");
    const code = await new Promise(res => w.on("exit", res));
    assert.equal(code, 0, err);
  };
  try {
    await run();
    const log = r.read();
    assert.match(log, /^\d{4}-.* UTC {2}INFO {3}\[os\] \[log\] Mandarin OS 0\.1\.9: the one log written from here$/m);
    assert.match(log, /\[os\] \[log\] the logs from before let go: MandarinOS\/Logs, MandarinServer\/Logs$/m);
    assert.ok(!fs.existsSync(path.join(r.dir, "data/MandarinOS/Logs")) && !fs.existsSync(path.join(r.dir, "data/MandarinServer/Logs")), "the old folders gone");
    assert.equal(fs.readFileSync(path.join(r.dir, "data/MandarinServer/musicd.db"), "utf8"), "the database", "nothing else touched");
    assert.deepEqual(log.split("\n").filter(l => l.includes("[test]")).map(l => l.slice(36)), ["[os] [test] one", "[os] [test] two", "[os] [test] three: said as the box stopped"]);
    // The first time this boot's journal from its start; stopped, the rest after the last line read; that kept.
    assert.deepEqual(fs.readFileSync(calls, "utf8").trim().split("\n"), [
      "--follow --output=json --no-pager --all --boot",
      "--output=json --no-pager --all --after-cursor s=1;i=two"]);
    assert.equal(fs.readFileSync(path.join(r.dir, "data/MandarinOS/log-cursor"), "utf8"), "s=1;i=three: said as the box stopped\n");
    // Started again: followed from where it was read to.
    fs.writeFileSync(calls, "");
    fs.writeFileSync(path.join(r.dir, "follow.json"), os1("two", 4000) + "\n");
    fs.writeFileSync(path.join(r.dir, "after.json"), "");
    await run();
    assert.match(fs.readFileSync(calls, "utf8"), /^--follow --output=json --no-pager --all --after-cursor s=1;i=three: said as the box stopped$/m);
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});
