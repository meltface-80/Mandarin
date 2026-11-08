"use strict";
/*
 * Logging on by default (item 334, Diagnostics.cs): a server never told about it keeps its log from the start, so a
 * fault seen once is in it; switched off it is off for good, across a restart (an update) too; switched on again, on.
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

test("the server's log kept from the start, unless switched off, and off stays off", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  let token = await signIn(B);
  const H = () => ({ Authorization: "Bearer " + token, "Content-Type": "application/json" });
  const state = async () => (await fetch(B + "/api/diagnostics", { headers: H() })).json();
  const kept = async () => (await fetch(B + "/api/diagnostics/log", { headers: H() })).text();
  // Never switched: on, and what the server said kept (the sign-in, here).
  assert.equal((await state()).on, true);
  assert.match(await kept(), /\[auth\]/);
  // Switched off: off, what was kept deleted, and off still after a restart.
  assert.equal((await (await fetch(B + "/api/diagnostics", { method: "POST", headers: H(), body: JSON.stringify({ on: false }) })).json()).on, false);
  assert.equal((await state()).bytes, 0);
  assert.ok(fs.existsSync(path.join(lib.data, "diagnostics-off")));
  await ctx.restart(token);
  token = await signIn(B).catch(() => token);
  assert.equal((await state()).on, false, "off stays off across a restart");
  // On again.
  assert.equal((await (await fetch(B + "/api/diagnostics", { method: "POST", headers: H(), body: JSON.stringify({ on: true }) })).json()).on, true);
  assert.ok(!fs.existsSync(path.join(lib.data, "diagnostics-off")));
});
