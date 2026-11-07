"use strict";
/*
 * A renderer's own player (item 306, Renderers/Mpd.cs): a Chord Poly answers UPnP and, at port 6600 of the same
 * address, MPD. Found beside it, its device page says so; with its Player set to its own player, Mandarin plays
 * through MPD — the track set is MPD's queue cleared and that track added, the next added after it, which MPD plays
 * into by itself, gapless; the room follows MPD's own word on what plays and how far in. Nothing goes by UPnP.
 * A jump starts MPD's queue again at that track, a seek is MPD's seekcur; set back to UPnP, UPnP plays again.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { FakeRenderer, idFor } = require("./fake-renderer");
const { FakeMpd } = require("./fake-mpd");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? ": " + what : ""));
    await sleep(100);
  }
}

test("a renderer's own player (MPD): found beside it, played through, one track into the next by itself", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  for (const i of [1, 2, 3])
    gen(path.join(lib.music, "Artist M", "Own Player", `0${i} Own ${i}.flac`), { seconds: 4, freq: 300 * i, tags: { title: `Own ${i}`, artist: "Artist M", album: "Own Player", track: i } });
  const poly = new FakeRenderer({ name: "Poly", manufacturer: "Chord Electronics", model: "Poly" });
  const mpd = new FakeMpd({ seconds: 4 });
  await poly.start(); await mpd.start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [],
    upnpHosts: [poly.location], upnpMulticast: false, identify: false, mpdPort: mpd.port });
  await srv.start();
  t.after(async () => { await srv.stop(); await poly.stop(); await mpd.stop(); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  const ID = idFor(poly.udn);
  const line1 = async () => { const z = (await api("zone-state?zone=" + ID)).zone; return z && z.now_playing && z.now_playing.line1; };
  await until(async () => (await api("status")).index_count === 4, 30000, "the library");
  await until(async () => (await api("audio-devices")).devices.some(d => d.id === ID), 20000, "the Poly");

  // Found beside it, and said on its page; set to it.
  const dev = await api("audio-devices/" + ID);
  assert.equal(dev.mpd, "127.0.0.1:" + mpd.port, "MPD found at the renderer's address");
  assert.equal(dev.output.player, undefined, "UPnP by its absence");
  assert.equal((await call("PATCH", "audio-devices/" + ID, { enabled: true, output: { mode: "x2", player: "mpd" } })).status, 200);
  assert.equal((await api("audio-devices/" + ID)).output.player, "mpd");
  assert.equal((await call("PATCH", "audio-devices/" + ID, { output: { player: "not-a-player" } })).status, 400, "upnp or mpd only");
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === ID), 20000, "the room");
  const album = (await api("library/albums?sort=album")).albums.find(a => a.title === "Own Player");
  const ids = (await api("album?offset=" + album.offset)).tracks.map(x => x.track_id);
  const sets = () => poly.log.filter(a => a === "SetAVTransportURI").length;

  // Played through MPD: its queue cleared, track 1 added, played; nothing by UPnP.
  assert.equal((await api("play", { offset: album.offset, zone_or_output_id: ID, kind: "play_now" })).status, 200);
  await until(() => mpd.state === "play", 15000, "MPD playing");
  assert.ok(mpd.log.includes("clear"), "the queue cleared");
  assert.match(mpd.queue[0].file, new RegExp(`/stream/t${ids[0]}\\.`), "track 1 added");
  await until(async () => (await line1()) === "Own 1", 15000, "track 1 shown");
  // The next added after it, which MPD plays into by itself.
  await until(() => mpd.queue.length === 2, 15000, "track 2 armed in MPD's queue");
  assert.match(mpd.queue[1].file, new RegExp(`/stream/t${ids[1]}\\.`));
  await until(async () => (await line1()) === "Own 2", 15000, "track 2 shown after MPD went on into it");
  assert.ok(mpd.log.includes("auto-next"), "MPD went on by itself");
  assert.equal(mpd.log.filter(c => c === "clear").length, 1, "gapless: MPD's queue never cleared between the tracks");
  assert.equal(sets(), 0, "nothing by UPnP");

  // Next: MPD's queue begun again at track 3; a seek, MPD's seekcur.
  await api("control", { zone_or_output_id: ID, command: "next" });
  await until(async () => (await line1()) === "Own 3", 15000, "Next to track 3");
  assert.match(mpd.current().file, new RegExp(`/stream/t${ids[2]}\\.`));
  await api("seek", { zone_or_output_id: ID, how: "absolute", seconds: 1.5 });
  await until(() => mpd.log.some(c => /^seekcur 1\.5$/.test(c)), 15000, "the seek");

  // Back to UPnP: the renderer told again.
  assert.equal((await call("PATCH", "audio-devices/" + ID, { output: { player: "upnp" } })).status, 200);
  assert.equal((await api("audio-devices/" + ID)).output.player, undefined);
  assert.equal((await api("play", { offset: album.offset, zone_or_output_id: ID, kind: "play_now" })).status, 200);
  await until(() => sets() === 1, 15000, "UPnP again");
});
