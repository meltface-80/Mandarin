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
 *   - the loop runners keep one timer per loop, not one per run.
 */
const test = require("node:test");
const assert = require("node:assert");
const net = require("net");
const T = require("../lib/sonos/topology");
const { RendererDiscovery } = require("../lib/renderers/discovery");
const { FakeHousehold } = require("./fake-sonos");
const { FakeRenderer } = require("./fake-renderer");

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

test("the LAN addresses, best first; a search from each, or the pinned one", () => {
  const a = T.lanAddresses(IFS);
  assert.deepEqual(a.filter(x => x.lan).map(x => x.address), ["192.168.1.20", "10.0.0.7", "192.168.2.2"], "the real LAN interfaces, private first, in the system's order (br0 kept: VMs bridge the LAN there)");
  assert.ok(!a.some(x => x.lan && /^(100\.|172\.1[78]\.|10\.200\.)/.test(x.address)), "Tailscale, Docker and WireGuard are never the LAN");
  assert.equal(T.localIp(null, IFS), "192.168.1.20", "the server's own address: the wired LAN, not the VPN listed first");
  assert.equal(T.localIp("10.9.9.9", IFS), "10.9.9.9", "SERVER_IP wins");
  assert.deepEqual(T.searchAddresses(null, IFS), ["192.168.1.20", "10.0.0.7", "192.168.2.2"], "a search from every LAN address");
  assert.deepEqual(T.searchAddresses("192.168.1.20", IFS), ["192.168.1.20"], "pinned: that one");
  assert.deepEqual(T.searchAddresses("127.0.0.1", IFS), [undefined], "loopback (the tests): the default route");
  assert.deepEqual(T.searchAddresses(null, { lo: IFS.lo, tailscale0: IFS.tailscale0 }), [undefined], "no LAN at all: the default route, not the VPN");
  assert.equal(T.localIp(null, { lo: IFS.lo }), "127.0.0.1");
});

test("the household is read quickly past a player that hangs", { timeout: 30000 }, async () => {
  const house = new FakeHousehold();
  await house.start();
  // A "player" at an old address that takes the connection and never answers.
  const silent = net.createServer(() => { /* say nothing */ });
  await new Promise(r => silent.listen(1400, "127.0.0.97", r));
  try {
    const top = new T.Topology({ seedHosts: ["127.0.0.97", "127.0.0.11"] });
    const t0 = Date.now();
    assert.equal(await top.refresh(), true, "the household was read");
    const ms = Date.now() - t0;
    assert.ok(top.rooms().some(r => r.name === "Kitchen"), "its rooms are known");
    assert.ok(ms < 8000, `read in ${ms} ms: a short probe of the silent one, then the rest at once (was ten seconds per stale address)`);
    // Found by a search just now: asked first next time.
    top.all.clear(); top.recent = ["127.0.0.11"];
    assert.equal(top.hosts[0], "127.0.0.11");
  } finally { silent.close(); await house.stop(); }
});

test("a renderer seen lately that misses a search round is checked directly; one that has gone, quietly not found", { timeout: 30000 }, async () => {
  const r = new FakeRenderer({ name: "Kitchen Streamer" });
  await r.start();
  const logs = [];
  const loc = r.location;
  const d = new RendererDiscovery({ multicast: false, log: (l) => logs.push(l), known: () => [loc] });
  const found = await d.scan();
  assert.equal(found.length, 1, "no multicast answer, but it was seen lately: checked, and there");
  assert.equal(found[0].network_name, "Kitchen Streamer");
  await r.stop();
  const again = await d.scan();
  assert.deepEqual(again, [], "gone: not found");
  assert.deepEqual(logs, [], "and nothing logged for a device that simply isn't there");
});

test("the loop runners keep one timer per loop", { timeout: 30000 }, async () => {
  const { ZoneManager } = require("../lib/sonos/zones");
  const zm = new ZoneManager({ seedHosts: [], bindIp: "127.0.0.1", log: () => {} });
  let n = 0;
  zm.loop("fast", 5, () => { n++; }, 0);
  await new Promise(r => setTimeout(r, 300));
  assert.ok(n > 10, "it ran: " + n);
  assert.equal(zm.timers.size, 1, "one timer for the one loop, after " + n + " runs");
  zm.stop();
  assert.equal(zm.timers.size, 0);
});
