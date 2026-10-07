"use strict";
/*
 * topology.js — finding Sonos players and reading who is grouped with whom.
 *
 * Ported from the bridges' discovery.py. One reachable player can describe the
 * whole household through ZoneGroupTopology, so SSDP only has to find one;
 * the topology supplies the rest, including rooms whose announcements were
 * missed. SONOS_HOSTS seeds it for networks where multicast is unreliable.
 */
const dgram = require("dgram");
const os = require("os");
const XML = require("../xml");
const SOAP = require("./soap");
const { SonosDevice, SONOS_PORT } = require("./device");

const SSDP_ADDR = "239.255.255.250";
const SSDP_PORT = 1900;
const ZONE_PLAYER_ST = "urn:schemas-upnp-org:device:ZonePlayer:1";
// A player on the LAN answers in well under a second; one that hasn't in
// four is not there (a fault on a busy one is retried at the next refresh).
const PROBE_MS = 4000;

function parseChannelMap(v) {
  const out = {};
  for (const entry of String(v || "").split(";")) {
    const [uid, chans] = entry.split(":");
    if (!uid || !chans) continue;
    out[uid.trim()] = new Set(chans.split(",").map(s => s.trim().toUpperCase()).filter(Boolean));
  }
  return out;
}

function parseZoneGroupState(xmlText) {
  const doc = XML.parse(String(xmlText || "").trim());
  if (!doc) return [];
  let groupsParent = doc.ZoneGroupState ? doc.ZoneGroupState.ZoneGroups : doc.ZoneGroups;
  if (!groupsParent) return [];
  const zones = [];
  for (const group of XML.list(groupsParent.ZoneGroup)) {
    const coordinator = group["@Coordinator"] || "";
    const groupId = group["@ID"] || "";
    for (const m of XML.list(group.ZoneGroupMember)) {
      const uid = m["@UUID"];
      if (!uid) continue;
      let ip = "";
      try { ip = new URL(m["@Location"] || "").hostname; } catch (e) { /* no location: not addressable */ }
      const channelMap = m["@ChannelMapSet"] || m["@HTSatChanMapSet"] || "";
      const cm = Object.values(parseChannelMap(m["@ChannelMapSet"] || ""));
      zones.push({
        uid,
        name: m["@ZoneName"] || uid,
        ip,
        coordinatorUid: coordinator,
        groupId,
        invisible: m["@Invisible"] === "1",
        isBridge: m["@IsZoneBridge"] === "1",
        softwareVersion: m["@SoftwareVersion"] || "",
        channelMap,
        stereoPair: cm.some(c => c.size === 1 && c.has("LF")) && cm.some(c => c.size === 1 && c.has("RF"))
      });
    }
  }
  return zones;
}

function parseHeaders(buf) {
  const lines = buf.toString("utf8").split(/\r?\n/);
  const h = { "": (lines[0] || "").trim() };
  for (const line of lines.slice(1)) {
    const i = line.indexOf(":");
    if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return h;
}

/*
 * THE MACHINE'S LAN ADDRESSES, BEST FIRST (v0.7.9). Worked out at each
 * search, not once at start: a server that starts before its network is up,
 * or whose DHCP lease changes, used to bind every later search to an
 * address it no longer had, and find nothing until restarted.
 *
 * Interfaces that are never where the speakers are — containers, VMs,
 * VPNs (Tailscale on the host, WireGuard, ZeroTier) — are left out, and a
 * private LAN address (10/8, 172.16/12, 192.168/16) comes before anything
 * else: the old rule took the first interface that wasn't Docker's, which
 * on a machine with a VPN up could be the VPN.
 */
// Never where the speakers are. (br0 is NOT here: on a Linux host with VMs
// the LAN is often on br0. Docker's own bridges are br-<id>.)
const VIRTUAL_IF = /^(docker|br-|veth|virbr|vmnet|vboxnet|lxcbr|lxdbr|cni|flannel|cali|kube|tailscale|wg|zt|tun|tap|utun|ppp|ipsec|bridge\d+$)/i;
function ipv4Int(ip) { const p = String(ip).split(".").map(Number); return p.length === 4 && p.every(n => n >= 0 && n <= 255) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null; }
function inRange(ip, base, bits) { const a = ipv4Int(ip), b = ipv4Int(base); if (a == null || b == null) return false; const m = bits ? (~0 << (32 - bits)) >>> 0 : 0; return ((a & m) >>> 0) === ((b & m) >>> 0); }
function isPrivate(ip) { return inRange(ip, "10.0.0.0", 8) || inRange(ip, "172.16.0.0", 12) || inRange(ip, "192.168.0.0", 16); }
function isLinkLocal(ip) { return inRange(ip, "169.254.0.0", 16); }
function isCgnat(ip) { return inRange(ip, "100.64.0.0", 10); }   // Tailscale's addresses, carrier NAT

/* Every non-internal IPv4 of this machine, best first: [{ name, address, lan }]. */
function lanAddresses(ifs = os.networkInterfaces()) {
  const out = [];
  for (const [name, addrs] of Object.entries(ifs || {})) {
    for (const a of addrs || []) {
      if (!a || (a.family !== "IPv4" && a.family !== 4) || a.internal) continue;
      const virtual = VIRTUAL_IF.test(name);
      const rank = virtual ? 3 : isPrivate(a.address) ? 0 : (isLinkLocal(a.address) || isCgnat(a.address)) ? 2 : 1;
      out.push({ name, address: a.address, rank, lan: rank < 2 });
    }
  }
  // Stable within a rank: the order the system lists its interfaces in.
  return out.map((x, i) => Object.assign(x, { i })).sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(({ name, address, lan }) => ({ name, address, lan }));
}

// The address this server is reached at on the LAN: SERVER_IP when pinned,
// else the best of lanAddresses().
function localIp(preferred, ifs) {
  if (preferred) return preferred;
  const best = lanAddresses(ifs)[0];
  return best ? best.address : "127.0.0.1";
}

/*
 * Where to search from: the pinned address alone; or every LAN address the
 * machine has (up to four), so a speaker on the wired LAN and one on the
 * Wi-Fi are both found on a machine on both; or, with none, the system's
 * default route.
 */
function searchAddresses(bindIp, ifs) {
  if (bindIp === "127.0.0.1") return [undefined];
  if (bindIp) return [bindIp];
  const lan = lanAddresses(ifs).filter(a => a.lan).map(a => a.address);
  return lan.length ? [...new Set(lan)].slice(0, 4) : [undefined];
}

async function msearch(bindIp, opts = {}) {
  const lists = await Promise.all(searchAddresses(bindIp).map(a => msearchFrom(a, opts)));
  return [...new Set(lists.flat())];
}

function msearchFrom(bindAddr, { mx = 2, attempts = 3, st = ZONE_PLAYER_ST } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    let sock;
    try { sock = dgram.createSocket({ type: "udp4", reuseAddr: true }); } catch (e) { return resolve([]); }
    const msg = Buffer.from(
      "M-SEARCH * HTTP/1.1\r\n" +
      `HOST: ${SSDP_ADDR}:${SSDP_PORT}\r\n` +
      'MAN: "ssdp:discover"\r\n' +
      `MX: ${mx}\r\n` +
      `ST: ${st}\r\n\r\n`, "ascii");
    sock.on("message", (data, rinfo) => {
      const h = parseHeaders(data);
      if (!/^HTTP\/1\.1 200/i.test(h[""])) return;
      let host = rinfo.address;
      try { host = new URL(h.location).hostname || host; } catch (e) { /* keep the sender's address */ }
      if (/sonos/i.test(h.server || "") || /ZonePlayer/i.test(h.st || "")) found.set(host, h);
    });
    sock.on("error", () => { try { sock.close(); } catch (e) { /* already closed */ } resolve([...found.keys()]); });
    sock.bind(0, bindAddr, () => {
      try {
        sock.setMulticastTTL(4);
        if (bindAddr) sock.setMulticastInterface(bindAddr);
      } catch (e) { /* interface selection is best-effort; the default route still works */ }
      let n = 0;
      const send = () => {
        sock.send(msg, SSDP_PORT, SSDP_ADDR, () => {});
        if (++n < attempts) setTimeout(send, 250);
      };
      send();
      setTimeout(() => { try { sock.close(); } catch (e) { /* already closed */ } resolve([...found.keys()]); }, (mx + 1) * 1000);
    });
  });
}

async function fetchModel(ip) {
  try {
    const xml = await SOAP.httpGet(`http://${ip}:${SONOS_PORT}/xml/device_description.xml`, 5000);
    const doc = XML.parse(xml);
    const d = doc && doc.root && doc.root.device;
    if (!d) return "";
    return XML.text(d.modelName) || XML.text(d.displayName) || "";
  } catch (e) {
    return "";
  }
}

class Topology {
  constructor({ seedHosts = [], bindIp, include = [], exclude = [], log = () => {} } = {}) {
    this.seedHosts = [...seedHosts];
    this.bindIp = bindIp;
    this.include = include.map(s => s.toLowerCase());
    this.exclude = exclude.map(s => s.toLowerCase());
    this.log = log;
    this.all = new Map();     // uid -> member
    this.models = new Map();  // uid -> model name
    this.lastRefresh = 0;
    this.lastError = "";
  }

  get hosts() {
    const s = new Set();
    for (const z of this.all.values()) if (z.ip) s.add(z.ip);
    for (const h of this.recent || []) s.add(h);
    for (const h of this.seedHosts) s.add(h);
    return [...s];
  }

  allowed(name) {
    const n = String(name || "").toLowerCase();
    if (this.include.length && !this.include.includes(n)) return false;
    return !this.exclude.includes(n);
  }

  async discover() {
    const hosts = await msearch(this.bindIp);
    // Answered just now: asked first at the next refresh, ahead of addresses
    // kept from before (a household whose addresses all changed was read
    // only after every old one had timed out).
    this.recent = hosts;
    for (const h of hosts) if (!this.seedHosts.includes(h)) this.seedHosts.push(h);
    if (!hosts.length && !this.seedHosts.length) {
      this.lastError = "No Sonos players answered discovery. Use host networking, or set SONOS_HOSTS to a player's IP.";
    }
    return hosts;
  }

  /*
   * The household from any one player. The first known one is asked alone,
   * briefly; if it doesn't answer, the rest at once and the first answer
   * taken (v0.7.9). One at a time with the full timeout each, a household
   * whose addresses had changed took a ten-second wait per old address.
   */
  async refresh() {
    let xml = null;
    const errors = [];
    const ask = async (host, ms) => {
      try {
        const x = await new SonosDevice(host).getZoneGroupState(ms);
        if (x) return x;
        throw new Error("no household in the answer");
      } catch (e) { errors.push(`${host}: ${e.message}`); throw e; }
    };
    const [first, ...rest] = this.hosts;
    if (first) { try { xml = await ask(first, PROBE_MS); } catch (e) { xml = null; } }
    if (!xml && rest.length) { try { xml = await Promise.any(rest.slice(0, 16).map(h => ask(h, PROBE_MS))); } catch (e) { xml = null; } }
    if (!xml) {
      if (errors.length) this.lastError = errors.slice(0, 3).join("; ");
      return false;
    }
    const members = parseZoneGroupState(xml);
    if (!members.length) return false;
    const before = this.signature();
    this.all = new Map(members.map(m => [m.uid, m]));
    for (const m of members) {
      if (!this.models.has(m.uid) && m.ip && !m.invisible) {
        this.models.set(m.uid, "");
        // A player that was busy or rebooting answers next time: not left
        // nameless for good (v0.7.9).
        fetchModel(m.ip).then(model => { if (model) this.models.set(m.uid, model); else this.models.delete(m.uid); });
      }
    }
    this.lastRefresh = Date.now();
    this.lastError = "";
    if (this.onHosts) {
      try { this.onHosts(members.filter(m => m.ip && !m.invisible).map(m => m.ip)); } catch (e) { /* best effort */ }
    }
    return before !== this.signature();
  }

  signature() {
    return [...this.all.values()]
      .map(m => `${m.uid}|${m.name}|${m.coordinatorUid}|${m.ip}|${m.invisible}`)
      .sort().join(";");
  }

  // Rooms a person plays to: not satellites, subs, or BOOST/BRIDGE units.
  rooms() {
    return [...this.all.values()].filter(m => !m.invisible && !m.isBridge && m.ip && this.allowed(m.name));
  }

  member(uid) { return this.all.get(uid) || null; }

  coordinatorOf(uid) {
    const m = this.all.get(uid);
    if (!m) return null;
    if (!m.coordinatorUid || m.coordinatorUid === uid) return m;
    return this.all.get(m.coordinatorUid) || m;
  }

  // Groups keyed by coordinator: { coordinator, members[] } — Roon's "zone".
  groups() {
    const out = new Map();
    for (const room of this.rooms()) {
      const coord = this.coordinatorOf(room.uid) || room;
      if (!out.has(coord.uid)) out.set(coord.uid, { coordinator: coord, members: [] });
      out.get(coord.uid).members.push(room);
    }
    // A coordinator hidden by INCLUDE/EXCLUDE still owns its group's queue, so
    // the group stays; it is simply named after the rooms that are visible.
    return [...out.values()];
  }

  device(uid) {
    const m = this.all.get(uid);
    return m && m.ip ? new SonosDevice(m.ip, m.uid, m.name) : null;
  }
}

module.exports = { Topology, parseZoneGroupState, parseChannelMap, msearch, localIp, lanAddresses, searchAddresses, parseHeaders };
