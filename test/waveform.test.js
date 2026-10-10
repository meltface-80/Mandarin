"use strict";
/*
 * The waveform behind the progress bar (lib/waveform.js; behind the C#
 * server, server/Mandarin.Server/Waveforms.cs, v0.8.19): off until it's
 * switched on; a track named by its id or by its title, album and artist;
 * 4,000 buckets, decoded once and kept; what isn't a file of ours says so.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { decodeWaveform } = require("../lib/waveform-decode");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;

async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await new Promise(r => setTimeout(r, 100)); }
}

test("waveforms: off until switched on, by id or by name, decoded once and kept", { skip, timeout: 90000 }, async () => {
  const lib = makeLibrary();
  delete require.cache[require.resolve("../index.js")];
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false });
  const ctx = await srv.start();
  const token = await signIn(B);
  const get = async p => { const r = await fetch(B + "/api/" + p, { headers: { Authorization: "Bearer " + token } }); return { status: r.status, answered: r.headers.get("x-mandarin-answered"), cache: r.headers.get("cache-control"), ...(await r.json()) }; };
  const post = async (p, body) => { const r = await fetch(B + "/api/" + p, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
  try {
    await until(async () => (await get("status")).index_count === 3);
    const al = ctx.library.albums.find(a => a.title === "Album One");
    const t = ctx.library.tracks(al.id)[1];

    let r = await get("settings/waveform");
    assert.equal(r.enabled, false);
    assert.equal(typeof r.decoder, "boolean");
    r = await get("waveform?track_id=" + t.id);
    assert.deepEqual([r.peaks, r.reason], [null, "off"]);
    if (process.env.MANDARIN_FRONT === "1") assert.equal(r.answered, "C#", "waveforms are the C# server's");

    assert.equal((await post("settings/waveform", {})).status, 400);
    r = await post("settings/waveform", { enabled: true });
    assert.deepEqual([r.ok, r.enabled], [true, true]);
    assert.equal((await get("settings/waveform")).enabled, true);

    // By id: decoded now, kept; asked again, from what was kept.
    r = await get("waveform?track_id=" + t.id);
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.deepEqual([r.n, r.cached], [4000, false]);
    assert.match(String(r.cache), /immutable/);
    const want = Buffer.from(await decodeWaveform(t.path, { expectSeconds: t.duration })).toString("base64");
    assert.equal(r.peaks, want, "the same buckets as the decoder here");
    r = await get("waveform?track_id=" + t.id);
    assert.deepEqual([r.peaks, r.n, r.cached], [want, 4000, true]);

    // By its title, album and artist (as a speaker names what it plays).
    r = await get("waveform?" + new URLSearchParams({ track: "Song 2", album: "Album One", artist: "Artist A" }));
    assert.deepEqual([r.peaks, r.cached], [want, true]);
    r = await get("waveform?" + new URLSearchParams({ track: "song 2", album: "album one" }));
    assert.equal(r.peaks, want, "names folded; no artist needed");

    // What isn't ours, or isn't said.
    assert.equal((await get("waveform")).status, 400);
    r = await get("waveform?" + new URLSearchParams({ track: "Nothing", album: "Nowhere" }));
    assert.deepEqual([r.peaks, r.reason], [null, "no-local-file"]);
    r = await get("waveform?track_id=999999");
    assert.deepEqual([r.peaks, r.reason], [null, "no-local-file"]);

    // Off again: nothing.
    await post("settings/waveform", { enabled: false });
    assert.equal((await get("waveform?track_id=" + t.id)).reason, "off");
  } finally {
    await srv.stop();
  }
});
