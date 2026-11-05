"use strict";
/*
 * SQ-tool inside Mandarin (item 288, SqTool.cs): opened at /sq-tool/ behind Mandarin's sign-in, its own page as it is
 * standalone (sq-tool/sqtool/web), its API answered by its own server, started by Mandarin on a port of this computer
 * only, with Mandarin's music folder: the bare address sent to /sq-tool/, the page and its script, its state (the
 * music folder Mandarin's), a test of a song made through Mandarin and read back, a request without sign-in refused.
 * With no Python to run it, its page says it can't start, and why. (Its recording of a zone: sq-tool-record.test.js.)
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

// A second of a 440 Hz tone as a 16-bit stereo WAV: a song for SQ-tool to read.
function wav() {
  const rate = 44100, n = rate, data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const v = Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / rate));
    data.writeInt16LE(v, i * 4); data.writeInt16LE(v, i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const skip = !python && !process.env.CI && "python3 with numpy is not installed";

test("SQ-tool at /sq-tool/: its page, its API, behind the sign-in", { skip, timeout: 90000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-sqtool-"));
  const music = path.join(root, "music"), data = path.join(root, "data");
  fs.mkdirSync(music, { recursive: true });
  fs.writeFileSync(path.join(music, "Tone.wav"), wav());
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: music, dataDir: data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)] });
  await srv.start();
  try {
    // Without a sign-in: nothing of SQ-tool's.
    const bare = await fetch(B + "/sq-tool/api/state");
    assert.ok(!(bare.status === 200 && /"version"/.test(await bare.text())), "SQ-tool's API is behind the sign-in");
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
    assert.doesNotMatch(js.replace('"/api/sq-tool/"', ""), /"\/api\//, "no API address from the server's root but Mandarin's own");
    // Its state, from its own server: Mandarin's music folder its own.
    const st = await (await fetch(B + "/sq-tool/api/state", { headers: auth })).json();
    assert.ok(st.version && st.music, JSON.stringify(st));
    assert.equal(fs.realpathSync(st.music.root), fs.realpathSync(music));
    // A test of a song made through Mandarin and read back: the request's body handed on whole.
    const made = await fetch(B + "/sq-tool/api/tests", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify({ path: "Tone.wav" }) });
    assert.equal(made.status, 200);
    const { id } = await made.json();
    const t = await (await fetch(B + "/sq-tool/api/tests/" + id, { headers: auth })).json();
    assert.deepEqual([t.source.music_path, t.players], ["Tone.wav", { a: "" }]);
    // Its data kept with Mandarin's.
    assert.ok(fs.existsSync(path.join(data, "sq-tool", "tests", id, "test.json")));
  } finally {
    await srv.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Mandarin with SQ-tool run by [python] (a path): its /sq-tool/ page, asked signed in.
async function pageWith(python) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-sqtool-"));
  const music = path.join(root, "music"), data = path.join(root, "data");
  fs.mkdirSync(music, { recursive: true });
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: music, dataDir: data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)], sqtoolPython: python(root) });
  await srv.start();
  try {
    const auth = { Authorization: "Bearer " + await signIn(B) };
    const r = await fetch(B + "/sq-tool/", { headers: auth });
    return { status: r.status, html: await r.text() };
  } finally {
    await srv.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("SQ-tool with no Python to run it: its page says it can't start, and why", { timeout: 60000 }, async () => {
  const { status, html } = await pageWith(root => path.join(root, "no-python"));
  assert.equal(status, 503);
  assert.match(html, /SQ-tool can't start/);
  assert.match(html, /Python 3 isn(&#39;|')t installed here/);
  assert.match(html, /python3-numpy/);
});

test("SQ-tool with a Python that has no numpy: its page says so", { timeout: 60000 }, async () => {
  // A Python that says what SQ-tool says without numpy (sqtool/__main__.py), and stops.
  const { status, html } = await pageWith(root => {
    const py = path.join(root, "python-without-numpy");
    fs.writeFileSync(py, "#!/bin/sh\necho 'sq-tool needs numpy. Install it with:  sudo apt install python3-numpy' >&2\nexit 1\n", { mode: 0o755 });
    return py;
  });
  assert.equal(status, 503);
  assert.match(html, /Python 3 has no numpy/);
});
