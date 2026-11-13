"use strict";
/*
 * MusicBrainz turning lookups away (item 396): its 503 is "too many requests". Every lookup then rests (a minute, then
 * twice as long after each one more), said once in the log, and a lookup asked for meanwhile fails at once without asking
 * it. Before, each act a page asked about was asked for, turned away and logged: on the OptiPlex, "[credits] <act>: HTTP
 * 503" every few seconds for two hours. Here a MusicBrainz of the test's own turns every request away, and pages ask about
 * four acts in turn: it is asked once (for limit=5, not limit=[object Object] as before), and the log says so once.
 */
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const ports = require("./ports");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

test("MusicBrainz's 503 rests every lookup, asked and logged once, not once an act", { skip, timeout: 120000 }, async () => {
  const asked = [];
  const mb = http.createServer((req, res) => { asked.push(req.url); res.writeHead(503, { "Content-Type": "text/plain" }); res.end("rate limited"); });
  await new Promise(r => mb.listen(0, "127.0.0.1", r));
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    mbBaseUrl: `http://127.0.0.1:${mb.address().port}/ws/2`, deezerBaseUrl: "http://127.0.0.1:9", wikipediaBaseUrl: "http://127.0.0.1:9", fanartBaseUrl: "http://127.0.0.1:9" });
  const { logs } = await srv.start();
  try {
    const H = { Authorization: "Bearer " + await signIn(B) };
    for (const name of ["Artist A", "Artist B", "X", "Y"]) {
      assert.equal((await fetch(B + "/api/artist?name=" + encodeURIComponent(name), { headers: H })).status, 200);
      await sleep(1500);   // each lookup its time
    }
    const rests = logs.filter(l => l.includes("[musicbrainz] MusicBrainz turned a lookup away (HTTP 503: too many requests); every lookup rests 1 min"));
    assert.equal(asked.length, 1, "asked once, then rested: " + asked.join(" "));
    // A whole number asked as one: it was "limit=[object Object]".
    assert.match(asked[0], /[?&]limit=5(&|$)/, asked[0]);
    assert.equal(rests.length, 1, logs.filter(l => /musicbrainz|credits/.test(l)).join("\n"));
    assert.deepEqual(logs.filter(l => /\[credits\] .*HTTP 503/.test(l)), [], "no line an act");
  } finally { await srv.stop(); mb.close(); }
});
