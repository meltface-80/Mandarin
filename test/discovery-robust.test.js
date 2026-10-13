"use strict";
/*
 * Device discovery, made sturdier in the v0.7.9 review:
 *   - the machine's LAN addresses, best first: a VPN, container or VM
 *     interface is never chosen, a private LAN address beats anything else,
 *     and a search goes out from every LAN address (or the pinned one);
 *   - the Sonos household is read quickly when the first address asked is
 *     stale: a player that hangs is given up after a short probe and the
 *     others are asked at once, not one by one with ten seconds each;
 *   - a renderer seen lately that misses a search round is checked directly,
 *     and stays listed; one that has really gone is quietly not found;
 *   - (the loop runners' one timer per loop was lib/sonos/zones.js's, and went
 *     with it in v0.8.50).
 *
 * The C# server's (Playback/Topology.cs, SonosTopology.cs, Renderers/; lib/sonos/
 * and lib/renderers/ until v0.8.50): its rules asked through `mandarin-server
 * score`, the rest through the server running.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const net = require("net");
const { FakeHousehold } = require("./fake-sonos");
const { FakeRenderer } = require("./fake-renderer");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");
const { score } = require("./score");

const skip = built();
const IFS = {
  lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
  tailscale0: [{ family: "IPv4", address: "100.101.102.103", internal: false }],
  docker0: [{ family: "IPv4", address: "172.17.0.1", internal: false }],
  "br-3f2a": [{ family: "IPv4", address: "172.18.0.1", internal: false }],
  wg0: [{ family: "IPv4", address: "10.200.0.2", internal: false }],
  eth0: [{ family: "IPv4", address: "192.168.1.20", internal: false }, { family: "IPv6", address: "fe80::1", internal: false }],
  wlan0: [{ family: "IPv4", address: "10.0.0.7", internal: false }],
  br0: [{ family: "IPv4", address: "192.168.2.2", internal: false }],
  eth1: [{ family: "IPv4", address: "169.254.3.4", internal: false }]
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(100);
  }
}

test("the LAN addresses, best first; a search from each, or the pinned one", { skip }, () => {
  const lo = { lo: IFS.lo }, vpn = { lo: IFS.lo, tailscale0: IFS.tailscale0 };
  const r = score({ fn: "topology", lans: [IFS], locals: [[null, IFS], ["10.9.9.9", IFS], [null, lo]],
    searches: [[null, IFS], ["192.168.1.20", IFS], ["127.0.0.1", IFS], [null, vpn]] });
  const a = r.lans[0];
  assert.deepEqual(a.filter(x => x.lan).map(x => x.address), ["192.168.1.20", "10.0.0.7", "192.168.2.2"], "the real LAN interfaces, private first, in the system's order (br0 kept: VMs bridge the LAN there)");
  assert.ok(!a.some(x => x.lan && /^(100\.|172\.1[78]\.|10\.200\.)/.test(x.address)), "Tailscale, Docker and WireGuard are never the LAN");
  assert.equal(r.locals[0], "192.168.1.20", "the server's own address: the wired LAN, not the VPN listed first");
  assert.equal(r.locals[1], "10.9.9.9", "SERVER_IP wins");
  assert.equal(r.locals[2], "127.0.0.1");
  assert.deepEqual(r.searches[0], ["192.168.1.20", "10.0.0.7", "192.168.2.2"], "a search from every LAN address");
  assert.deepEqual(r.searches[1], ["192.168.1.20"], "pinned: that one");
  // The default route: undefined there, null as JSON carries it.
  assert.deepEqual(r.searches[2], [null], "loopback (the tests): the default route");
  assert.deepEqual(r.searches[3], [null], "no LAN at all: the default route, not the VPN");
});

test("the household is read quickly past a player that hangs", { skip, timeout: 60000 }, async (t) => {
  const house = new FakeHousehold();
  await house.start();
  // A "player" at an old address that takes the connection and never answers.
  const silent = net.createServer(() => { /* say nothing */ });
  await new Promise(r => silent.listen(1400, ports.host(2), r));
  t.after(async () => { silent.close(); await house.stop(); });
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(2), ports.host(0)], upnpMulticast: false });
  const t0 = Date.now();
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const H = { Authorization: "Bearer " + await signIn(B) };
  await until(async () => (await (await fetch(B + "/api/zones", { headers: H })).json()).zones.some(z => z.display_name === "Kitchen"), 30000, "the household's rooms");
  const ms = Date.now() - t0;
  assert.ok(ms < 8000, `read in ${ms} ms from the start: a short probe of the silent one, then the rest at once (was ten seconds per stale address)`);
  // The players that answered are kept, to be asked first next time; the silent address isn't among them.
  const known = await until(() => ctx.db.setting("sonosKnownHosts", null), 10000, "the players kept");
  assert.ok(known.length > 0 && !known.includes(ports.host(2)), JSON.stringify(known));
});

test("a renderer seen lately that misses a search round is checked directly; one that has gone, quietly not found", { skip, timeout: 60000 }, async (t) => {
  const r = new FakeRenderer({ name: "Kitchen Streamer" });
  await r.start();
  t.after(() => r.stop());
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  // No search answers here (multicast off) and no seeds: only the register's renderers seen within the hour.
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, upnpOfflineMs: 1500 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const H = { Authorization: "Bearer " + await signIn(B) };
  const id = "UPNP_" + r.udn.replace(/^uuid:/i, "");
  const now = Date.now();
  ctx.db.raw.prepare("INSERT INTO audio_devices(id, kind, network_name, location, caps, settings, first_seen, last_seen) VALUES(?, 'upnp', 'Old name', ?, '{}', '{}', ?, ?)").run(id, r.location, now, now);
  const rescan = async () => (await (await fetch(B + "/api/audio-devices/rescan", { method: "POST", headers: H })).json()).devices;
  const found = (await rescan()).find(d => d.id === id);
  assert.ok(found && found.online, "no search answer, but it was seen lately: checked, and there");
  assert.equal(found.network_name, "Kitchen Streamer");
  const said = ctx.logs.length;
  await r.stop();
  await sleep(1700);
  const again = (await rescan()).find(d => d.id === id);
  assert.equal(again.online, false, "gone: not found");
  assert.deepEqual(ctx.logs.slice(said).filter(l => /upnp|renderer|Kitchen Streamer/i.test(l)), [], "and nothing logged for a device that simply isn't there");
});
