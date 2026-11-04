"use strict";
/*
 * SQ-tool inside Mandarin (item 288, SqTool.cs): opened at /sq-tool/ behind Mandarin's sign-in, its own page as it is
 * standalone (sq-tool/sqtool/web), its API answered by its own server, started by Mandarin on a port of this computer
 * only, with Mandarin's music folder: the bare address sent to /sq-tool/, the page and its script, its state (the
 * music folder Mandarin's), a setting saved and read back, a request without sign-in refused. With no Python to run
 * it, its page says it can't start, and why.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { signIn } = require("./auth-helper");

const python = spawnSync("python3", ["-c", "import numpy"]).status === 0;
const skip = !python && !process.env.CI && "python3 with numpy is not installed";

test("SQ-tool at /sq-tool/: its page, its API, behind the sign-in", { skip, timeout: 90000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-sqtool-"));
  const music = path.join(root, "music"), data = path.join(root, "data");
  fs.mkdirSync(music, { recursive: true });
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: music, dataDir: data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)] });
  await srv.start();
  try {
    // Without a sign-in: nothing of SQ-tool's.
    const bare = await fetch(B + "/sq-tool/api/state");
    assert.ok(!(bare.status === 200 && /"capture"/.test(await bare.text())), "SQ-tool's API is behind the sign-in");
    const auth = { Authorization: "Bearer " + await signIn(B) };
    // The bare address is sent to /sq-tool/, where its page reads its files and API relative to it.
    const r0 = await fetch(B + "/sq-tool", { headers: auth, redirect: "manual" });
    assert.equal(r0.status, 302);
    assert.equal(r0.headers.get("location"), "/sq-tool/");
    // Its own page and script, as standalone, the API addressed from where the page is.
    const page = await fetch(B + "/sq-tool/", { headers: auth });
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") || "", /text\/html/);
    assert.match(await page.text(), /<script src="app\.js">/);
    const js = await (await fetch(B + "/sq-tool/app.js", { headers: auth })).text();
    assert.match(js, /api\("api\/tests"\)/);
    assert.doesNotMatch(js, /"\/api\//, "no API address from the server's root");
    // Its state, from its own server: Mandarin's music folder its own.
    const st = await (await fetch(B + "/sq-tool/api/state", { headers: auth })).json();
    assert.ok(st.version && st.capture && st.settings, JSON.stringify(st));
    assert.equal(fs.realpathSync(st.music.root), fs.realpathSync(music));
    // A setting saved through Mandarin and read back: the request's body handed on whole.
    const saved = await fetch(B + "/sq-tool/api/settings", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify({ players: { a: "Server DAC", b: "FiiO R7" } }) });
    assert.equal(saved.status, 200);
    const set = await (await fetch(B + "/sq-tool/api/settings", { headers: auth })).json();
    assert.deepEqual([set.players.a, set.players.b], ["Server DAC", "FiiO R7"]);
    // Its data kept with Mandarin's.
    assert.ok(fs.existsSync(path.join(data, "sq-tool", "settings.json")));
  } finally {
    await srv.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("SQ-tool with no Python to run it: its page says it can't start, and why", { timeout: 60000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-sqtool-"));
  const music = path.join(root, "music"), data = path.join(root, "data");
  fs.mkdirSync(music, { recursive: true });
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: music, dataDir: data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)], sqtoolPython: path.join(root, "no-python") });
  await srv.start();
  try {
    const auth = { Authorization: "Bearer " + await signIn(B) };
    const r = await fetch(B + "/sq-tool/", { headers: auth });
    assert.equal(r.status, 503);
    const html = await r.text();
    assert.match(html, /SQ-tool can't start/);
    assert.match(html, /Python 3 isn(&#39;|')t installed here/);
    assert.match(html, /python3-numpy/);
  } finally {
    await srv.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
