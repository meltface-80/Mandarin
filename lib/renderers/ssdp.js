"use strict";
/*
 * ssdp.js — one M-SEARCH, every answer.
 *
 * The Sonos search in lib/sonos/topology.js keeps only Sonos answers, as it
 * should. This one keeps them all: a media renderer can be anything — a WiiM,
 * a Chord Poly, an AVR, a TV — and each is told apart from its description
 * afterwards. Sonos players answer this search too (they are renderers); they
 * are recognised by their RINCON_ ids and left to the Sonos code.
 */
const dgram = require("dgram");
const { parseHeaders, searchAddresses } = require("../sonos/topology");

const SSDP_ADDR = "239.255.255.250";
const SSDP_PORT = 1900;
const MEDIA_RENDERER = "urn:schemas-upnp-org:device:MediaRenderer:1";

/*
 * Every device that answers: [{ location, usn, st, server, address }] — from
 * every LAN address the machine has, or the pinned one (see searchAddresses
 * in lib/sonos/topology.js, v0.7.9).
 */
async function search(bindIp, opts = {}) {
  const lists = await Promise.all(searchAddresses(bindIp).map(a => searchFrom(a, opts)));
  const out = new Map();
  for (const a of lists.flat()) { const key = a.usn || a.location; if (!out.has(key)) out.set(key, a); }
  return [...out.values()];
}

function searchFrom(bindAddr, { st = MEDIA_RENDERER, mx = 2, attempts = 3 } = {}) {
  return new Promise((resolve) => {
    const found = new Map();   // usn (or location) -> answer
    let sock;
    try { sock = dgram.createSocket({ type: "udp4", reuseAddr: true }); } catch (e) { return resolve([]); }
    const msg = Buffer.from(
      "M-SEARCH * HTTP/1.1\r\n" +
      `HOST: ${SSDP_ADDR}:${SSDP_PORT}\r\n` +
      'MAN: "ssdp:discover"\r\n' +
      `MX: ${mx}\r\n` +
      `ST: ${st}\r\n\r\n`, "ascii");
    const finish = () => { try { sock.close(); } catch (e) { /* already closed */ } resolve([...found.values()]); };
    sock.on("message", (data, rinfo) => {
      const h = parseHeaders(data);
      if (!/^HTTP\/1\.1 200/i.test(h[""]) || !h.location) return;
      const key = h.usn || h.location;
      if (found.has(key)) return;
      found.set(key, { location: h.location, usn: h.usn || "", st: h.st || "", server: h.server || "", address: rinfo.address });
    });
    sock.on("error", finish);
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
      setTimeout(finish, (mx + 1) * 1000);
    });
  });
}

function isSonos(answer) {
  return /RINCON_/i.test(answer.usn || "") || /sonos/i.test(answer.server || "");
}

module.exports = { search, isSonos, MEDIA_RENDERER };
