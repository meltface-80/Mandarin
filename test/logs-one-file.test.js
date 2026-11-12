"use strict";
/*
 * Settings → Logs → Download all logs as one text file (item 392, LogsOne.cs): every log the server keeps (its own,
 * every Bridge's, every app's, the page's) merged in time order, each line with where it came from, a line with no time
 * of its own under the line before it, and at its head what this server is and each log's own header. A zip of many
 * files was hard to read on a phone and to send.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ports = require("./ports");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

test("every log as one text file, in time order, each line with its source", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const logs = path.join(lib.data, "Logs");
  const put = (f, t) => { fs.mkdirSync(path.dirname(path.join(logs, f)), { recursive: true }); fs.writeFileSync(path.join(logs, f), t); };
  // A Bridge's log as the server keeps it (an older Bridge's times: to the second, no UTC), and an app's, with a line
  // of its own under another (a stack trace's), from long before the server started.
  put("Bridges/Mandarin_Bridge_mandarin.txt", "# — Mandarin Bridge: Mandarin Bridge (mandarin) (linux 0.3.8) —\n2001-01-01 07:00:02 [http] listening on 49494\n2001-01-01 07:00:04 update failed: tar couldn't be run\n");
  put("Apps/Nothing_A142.txt", "# The Mandarin app on Nothing A142\n2001-01-01 07:00:03.250 UTC  WARN   [NET] server POST /api/settings/qobuz/import → SocketTimeoutException\n    at java.net.Socket.read\n");
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const H = { Authorization: "Bearer " + await signIn(B), "Content-Type": "application/json" };
    await fetch(B + "/api/diagnostics/page", { method: "POST", headers: H, body: JSON.stringify({ lines: [{ level: "ERROR", text: "[page] TypeError: the page's own" }] }) });
    const r = await fetch(B + "/api/diagnostics/logs.txt", { headers: H });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") || "", /^text\/plain/);
    assert.match(r.headers.get("content-disposition") || "", /attachment; filename="mandarin-logs-\d{8}-\d{4}\.txt"/);
    const text = await r.text();
    assert.match(text, /^# Mandarin — every log, merged in time order \(UTC\); made \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\n/);
    assert.match(text, /^# \[Bridges\/Mandarin_Bridge_mandarin\] — Mandarin Bridge: Mandarin Bridge \(mandarin\) \(linux 0\.3\.8\) —$/m);
    const lines = text.split("\n").filter(l => /^\d{4}-/.test(l) || l.startsWith("    "));
    assert.deepEqual(lines.slice(0, 5).map(l => l.replace(/\s+/g, " ")), [
      "2001-01-01 07:00:02.000 Bridges/Mandarin_Bridge_mandarin INFO [http] listening on 49494",
      "2001-01-01 07:00:03.250 Apps/Nothing_A142 WARN [NET] server POST /api/settings/qobuz/import → SocketTimeoutException",
      " at java.net.Socket.read",
      "2001-01-01 07:00:04.000 Bridges/Mandarin_Bridge_mandarin INFO update failed: tar couldn't be run"].concat([lines[4].replace(/\s+/g, " ")]), text.slice(0, 2000));
    assert.match(text, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} {2}MandarinServer +INFO {3}\[auth\] signed in/m);
    assert.match(text, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} {2}Web\/MandarinWeb +ERROR {2}.*\[page\] TypeError: the page's own/m);
    const times = lines.filter(l => /^\d{4}-/.test(l)).map(l => l.slice(0, 23));
    assert.deepEqual(times, [...times].sort(), "in time order");
    // Download all logs on Settings → Logs is it.
    assert.match(fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8"), /id="logs-download" href="\/api\/diagnostics\/logs\.txt" download>Download all logs</);
  } finally { await srv.stop(); }
});
