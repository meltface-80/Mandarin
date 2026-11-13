"use strict";
/*
 * The server's log always on (item 389, Diagnostics.cs; before, item 334 made it on by default but it could be switched
 * off, which deleted it): kept from the start in <data>/Logs, asked to switch off it stays on and keeps what it had,
 * and across a restart (an update) it goes on in the same file.
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

test("the server's log kept from the start, can't be switched off, and goes on across a restart", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  let token = await signIn(B);
  const H = () => ({ Authorization: "Bearer " + token, "Content-Type": "application/json" });
  const state = async () => (await fetch(B + "/api/diagnostics", { headers: H() })).json();
  const kept = async () => (await fetch(B + "/api/diagnostics/log", { headers: H() })).text();
  const file = path.join(lib.data, "Logs", "MandarinServer_log.txt");
  // Never switched: on, and what the server said kept (the sign-in, here), in the file a person would open.
  assert.equal((await state()).on, true);
  assert.match(await kept(), /\[auth\]/);
  assert.match(fs.readFileSync(file, "utf8"), /^# Mandarin Server /);
  // Asked to switch off: still on, nothing deleted, no flag left to keep it off.
  assert.equal((await (await fetch(B + "/api/diagnostics", { method: "POST", headers: H(), body: JSON.stringify({ on: false }) })).json()).on, true);
  assert.ok((await state()).bytes > 0, "what was kept, kept");
  assert.ok(!fs.existsSync(path.join(lib.data, "diagnostics-off")));
  assert.match(await kept(), /\[auth\][\s\S]*asked to switch the log off: it stays on/);
  // Restarted: on, the same file going on.
  await ctx.restart(token);
  token = await signIn(B).catch(() => token);
  assert.equal((await state()).on, true, "on across a restart");
  assert.match(fs.readFileSync(file, "utf8"), /asked to switch the log off: it stays on[\s\S]*\[server\] Mandarin's server/);
});
