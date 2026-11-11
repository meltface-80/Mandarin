"use strict";
/*
 * Mandarin's logs as one timeline (item 389, tools/logs-timeline.js): every file of a zip from Download all logs, or
 * of a folder, merged in time order, each line with the file it came from; a stack trace stays under its line;
 * Android's lines (logcat's, in UTC) among them; narrowed by level, by what a line holds and by its source.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ports = require("./ports");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { readZip, entries, narrow, render } = require("../tools/logs-timeline");

const TOOL = path.join(__dirname, "..", "tools", "logs-timeline.js");

test("a folder of logs as one timeline, narrowed as asked", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-timeline-"));
  try {
    fs.mkdirSync(path.join(dir, "Bridges"));
    fs.writeFileSync(path.join(dir, "MandarinServer_log.01.txt"), "# Mandarin Server 1.3.0 log\n2026-11-11 21:00:00.000 UTC  INFO   [server] started\n");
    fs.writeFileSync(path.join(dir, "MandarinServer_log.txt"), [
      "# Mandarin Server 1.3.0 log",
      "2026-11-11 21:00:02.000 UTC  ERROR  [aspnet] Server.Kestrel: An unhandled exception was thrown by the application.",
      "System.InvalidOperationException: boom",
      "   at Mandarin.Server.Library.UpdateRoute(HttpContext ctx)",
      "2026-11-11 21:00:04.000 UTC  WARN   [stream] room=Lounge play=7f3a transcode failed",
    ].join("\n") + "\n");
    fs.writeFileSync(path.join(dir, "Bridges", "FiiO R7.txt"), "# — Mandarin Bridge: FiiO R7 (android 0.3.9) —\n2026-11-11 21:00:03.000  4242  4250 W UsbDriver: underrun play=7f3a\n");
    const all = entries(require("../tools/logs-timeline").readFolder(dir));
    assert.deepEqual(all.map(e => [e.at.slice(11), e.level, e.source]), [
      ["21:00:00.000", "INFO", "MandarinServer"],
      ["21:00:02.000", "ERROR", "MandarinServer"],
      ["21:00:03.000", "WARN", "Bridges/FiiO R7"],
      ["21:00:04.000", "WARN", "MandarinServer"],
    ]);
    // The stack under its line, never a line of its own.
    assert.deepEqual(all[1].more, ["System.InvalidOperationException: boom", "   at Mandarin.Server.Library.UpdateRoute(HttpContext ctx)"]);
    // Narrowed: by level, by what a line holds (its stack too), by source, by time.
    assert.equal(narrow(all, { level: "ERROR" }).length, 1);
    assert.deepEqual(narrow(all, { grep: "play=7f3a" }).map(e => e.source), ["Bridges/FiiO R7", "MandarinServer"]);
    assert.equal(narrow(all, { grep: "invalidoperation" }).length, 1);
    assert.equal(narrow(all, { source: "bridges" }).length, 1);
    assert.equal(narrow(all, { since: "2026-11-11 21:00:03", until: "2026-11-11 21:00:03.999" }).length, 1);
    // As printed, by the command.
    const out = spawnSync(process.execPath, [TOOL, dir, "--level", "WARN"], { encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /^2026-11-11 21:00:02\.000 {2}ERROR {2}MandarinServer +\[aspnet\].*\n {2,}System\.InvalidOperationException: boom\n/m);
    assert.equal(out.stdout.split("\n").filter(l => /^2026/.test(l)).length, 3);
    assert.equal(render([]), "");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

test("the zip Download all logs gives, read as a timeline", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const H = { Authorization: "Bearer " + await signIn(B), "Content-Type": "application/json" };
    await fetch(B + "/api/diagnostics/page", { method: "POST", headers: H, body: JSON.stringify({ lines: [{ level: "ERROR", text: "[page] TypeError: the page's own" }] }) });
    const zip = Buffer.from(await (await fetch(B + "/api/diagnostics/zip", { headers: H })).arrayBuffer());
    const files = readZip(zip);
    assert.ok(files.has("about.txt") && files.has("MandarinServer_log.txt") && files.has("Web/MandarinWeb_log.txt"), [...files.keys()].join(", "));
    const all = entries(files);
    assert.ok(all.some(e => e.source === "MandarinServer" && /\[auth\] signed in/.test(e.text)));
    const page = all.find(e => e.source === "Web/MandarinWeb");
    assert.ok(page && /TypeError: the page's own/.test(page.text) && page.level === "ERROR");
    for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].at <= all[i].at, "in time order");
    const f = path.join(lib.data, "logs.zip");
    fs.writeFileSync(f, zip);
    const out = spawnSync(process.execPath, [TOOL, f, "--source", "Web"], { encoding: "utf8" });
    assert.match(out.stdout, /ERROR {2}Web\/MandarinWeb {2}\[.*\] \[page\] TypeError: the page's own/);
  } finally { await srv.stop(); }
});
