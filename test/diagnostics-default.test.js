"use strict";
/*
 * Mandarin's one log (item 425, Diagnostics.cs) kept from the start in <data>/Logs/Mandarin_log.txt, with no switch and
 * no route to read, clear or zip it (it is read where it is kept), and across a restart (an update) going on in the
 * same file.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

test("the one log kept from the start, with no switch, and going on across a restart", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  let token = await signIn(B);
  const H = () => ({ Authorization: "Bearer " + token, "Content-Type": "application/json" });
  const file = path.join(lib.data, "Logs", "Mandarin_log.txt");
  // What the server said kept (its start, the sign-in), in the file a person would open.
  assert.match(fs.readFileSync(file, "utf8"), /\[server\] \[start\] Mandarin Server [\s\S]*\[server\] \[auth\] signed in/);
  // No switch, nothing to read it through, clear or zip it.
  for (const p of ["/api/diagnostics", "/api/diagnostics/log", "/api/diagnostics/clear", "/api/diagnostics/zip"])
    assert.equal((await fetch(B + p, { method: p.endsWith("clear") ? "POST" : "GET", headers: H(), body: p.endsWith("clear") ? "{}" : undefined })).status, 404, p);
  // Restarted: the same file going on, the first start's lines kept.
  await ctx.restart(token);
  token = await signIn(B).catch(() => token);
  assert.equal((fs.readFileSync(file, "utf8").match(/\[server\] \[start\] Mandarin Server .* starting/g) || []).length, 2, fs.readFileSync(file, "utf8"));
  assert.match(fs.readFileSync(file, "utf8"), /\[server\] \[auth\] signed in[\s\S]*\[server\] \[start\] Mandarin Server/);
  assert.deepEqual(fs.readdirSync(path.join(lib.data, "Logs")), ["Mandarin_log.txt"]);
});
