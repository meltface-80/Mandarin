"use strict";
/*
 * The address speakers and phones are handed (v0.8.49 fix). With no SERVER_IP
 * set, as in the Docker install, it is this machine's LAN address, as the Node
 * server's localIp() picks it; never 127.0.0.1, which no speaker or phone can
 * reach. Every other test pins SERVER_IP to 127.0.0.1, so none of them saw the
 * C# hub hand out loopback addresses: Sonos rooms took the queue and played
 * nothing, and the phone showed the album with no sound.
 *
 * Held on the C# server alone (test/server.js), as the image runs it.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");
const { start, built } = require("./server");
const { score } = require("./score");

// This machine's addresses as the C# server ranks them (Playback/Topology.cs; lib/sonos/topology.js until v0.8.50).
const ranked = built() ? null : score({ fn: "topology", lans: [require("os").networkInterfaces()], locals: [[null, require("os").networkInterfaces()]] });
const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed") || (!ranked.lans[0].length && "this machine has no LAN address") ||
  (process.env.SERVER_IP && "SERVER_IP is set in this environment");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(100);
  }
}

test("no SERVER_IP: speakers and phones are handed this machine's LAN address, and the audio reaches them", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  // SERVER_IP left unset (the harness pins it to 127.0.0.1 for every other test).
  const srv = await start({ port: PORT, musicDir: lib.music, dataDir: lib.data, env: { SERVER_IP: "", SONOS_HOSTS: ports.host(0) } });
  t.after(async () => { await srv.stop(); await house.stop(); });
  const token = await signIn(B);
  const api = async (p, body) => {
    const r = await fetch(B + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const lan = ranked.locals[0];
  assert.notEqual(lan, "127.0.0.1");
  await until(async () => (await api("status")).index_count === 3);
  const album = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");

  await t.test("a Sonos room: its queue on this machine's LAN address, and the speaker fetches the track from it", async () => {
    const kitchen = (await until(async () => (await api("zones")).zones.find(z => z.display_name === "Kitchen"))).zone_id;
    assert.equal((await api("play", { offset: album.offset, zone_or_output_id: kitchen, kind: "play_now" })).status, 200);
    const room = house.room("Kitchen");
    await until(() => room.queue.length === 3 && room.fetches.some(f => f.done));
    assert.deepEqual(room.queue.map(q => new URL(q.uri).hostname), [lan, lan, lan], "the stream addresses: " + room.queue.map(q => q.uri).join(" "));
    const got = room.fetches.find(f => f.done);
    assert.deepEqual([got.error || null, got.status], [null, 200], "the speaker reached the server at " + got.uri);
    assert.ok(got.bytes > 0, "and had the audio");
  });

  await t.test("the phone: the album handed to it on the same address, and the audio there", async () => {
    const h = await api("phone/hello", { name: "Pixel 8" });
    assert.equal(h.status, 200, JSON.stringify(h));
    assert.equal((await api("play", { offset: album.offset, zone_or_output_id: h.zone_id, kind: "play_now" })).status, 200);
    const load = (await until(async () => (await api(`phone/commands?after=${h.seq}`)).commands.find(c => c.op === "load")));
    assert.equal(new URL(load.items[0].url).hostname, lan, "the phone's track: " + load.items[0].url);
    assert.equal(new URL(load.items[0].art_url).hostname, lan, "and its cover: " + load.items[0].art_url);
    // Fetched there as the phone fetches it. This machine's own address: http.get, as the fake speaker
    // fetches (test/setup.js keeps the tests' fetch() to loopback by name, to keep them off the internet).
    const audio = await new Promise((resolve, reject) => {
      require("http").get(load.items[0].url, { headers: { Authorization: "Bearer " + token } }, (res) => {
        let bytes = 0;
        res.on("data", c => { bytes += c.length; });
        res.on("end", () => resolve({ status: res.statusCode, bytes }));
      }).on("error", reject);
    });
    assert.deepEqual([audio.status, audio.bytes > 0], [200, true], "the phone reached the server at " + load.items[0].url);
  });
});
