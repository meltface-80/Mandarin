"use strict";
/*
 * discovery.js — finding UPnP/DLNA renderers and reading what they are.
 *
 * One round: an M-SEARCH for MediaRenderer devices (plus any UPNP_HOSTS
 * seeds, for networks where multicast is unreliable), then for each answer
 * its description, its ConnectionManager Sink list, and — when it looks like
 * LinkPlay firmware — the WiiM-style HTTP API for the name its own app uses.
 * Descriptions are cached by location, so a device that has already been read
 * costs nothing on later rounds unless its address changed.
 *
 * Sonos players answer the search too; they are the Sonos code's and skipped.
 */
const SSDP = require("./ssdp");
const { fetchDescription } = require("./description");
const { fetchSink } = require("./protocolinfo");
const LinkPlay = require("./linkplay");

const RECHECK_MS = 10 * 60 * 1000;   // re-read a description / sink after this long

function idFor(udn) {
  return "UPNP_" + String(udn || "").replace(/^uuid:/i, "").trim();
}

class RendererDiscovery {
  constructor({ bindIp, seedHosts = [], multicast = true, log = () => {} } = {}) {
    this.bindIp = bindIp;
    this.seeds = seedHosts.map(seedLocation).filter(Boolean);
    this.multicast = multicast;
    this.log = log;
    this.cache = new Map();   // location -> { at, device | null, error }
    this.lastError = "";
  }

  /* One round → [{ id, kind, family, network_name, …, caps, playable, services }]. */
  async scan() {
    const answers = this.multicast ? await SSDP.search(this.bindIp) : [];
    const locations = new Map();
    for (const a of answers) {
      if (SSDP.isSonos(a)) continue;
      if (a.location && !locations.has(a.location)) locations.set(a.location, a);
    }
    for (const loc of this.seeds) if (!locations.has(loc)) locations.set(loc, { location: loc, usn: "", address: "" });
    const out = [];
    await Promise.all([...locations.values()].map(async (a) => {
      const rec = await this.describe(a);
      if (rec) out.push(rec);
    }));
    return out;
  }

  /*
   * A device that answered the search is alive and, once read, known; a seed
   * has answered nothing, so its description is fetched every round — that
   * fetch is what says it is still there — while its sink list and probe are
   * reused until the next re-check.
   */
  async describe(answer) {
    const loc = answer.location;
    const hit = this.cache.get(loc);
    const fresh = !!(hit && hit.record && Date.now() - hit.at < RECHECK_MS);
    if (fresh && answer.usn) return hit.record;
    try {
      const d = await fetchDescription(loc);
      if (!d.renderer && !d.services.AVTransport) throw new Error("not a media renderer");
      if (/^uuid:RINCON_/i.test(d.udn) || /sonos/i.test(d.manufacturer)) { this.cache.set(loc, { at: Date.now(), record: null }); return null; }
      if (fresh && hit.record.id === idFor(d.udn)) {
        if (!hit.record.linkplay && d.friendlyName) hit.record.network_name = d.friendlyName;
        return hit.record;
      }
      let host = "";
      try { host = new URL(loc).hostname; } catch (e) { /* keep empty */ }
      const rec = {
        id: idFor(d.udn), kind: "upnp", family: d.openhome ? "openhome" : "generic",
        network_name: d.friendlyName || d.modelName || host,
        manufacturer: d.manufacturer, model: d.modelName, model_number: d.modelNumber,
        firmware: "", ip: host, location: loc,
        playable: !!d.services.AVTransport, openhome: d.openhome,
        services: Object.fromEntries(Object.entries(d.services).map(([k, v]) => [k, v.controlUrl])),
        caps: { advertised: { mimes: [], containers: [], rates: [] } }
      };
      if (d.services.ConnectionManager) {
        try { rec.caps.advertised = await fetchSink(d.services.ConnectionManager); }
        catch (e) { rec.caps.advertised.error = e.message; }
      }
      if (d.linkplayHint || /linkplay|wiim/i.test(d.manufacturer + " " + d.modelName)) {
        let base = "";
        try { const u = new URL(loc); base = `${u.protocol}//${u.host}`; } catch (e) { /* no extra base */ }
        const lp = await LinkPlay.probe(host, { extraBases: base ? [base] : [] });
        if (lp) {
          rec.family = "wiim";
          rec.firmware = lp.firmware;
          rec.linkplay = { base: lp.base, project: lp.project, hardware: lp.hardware, uuid: lp.uuid, deviceName: lp.deviceName };
          if (lp.deviceName) rec.network_name = lp.deviceName;
        }
      }
      this.cache.set(loc, { at: Date.now(), record: rec });
      return rec;
    } catch (e) {
      this.cache.set(loc, { at: Date.now(), record: null, error: e.message });
      this.lastError = `${loc}: ${e.message}`;
      this.log(`[renderers] ${loc}: ${e.message}`);
      return null;
    }
  }
}

// UPNP_HOSTS: an IP (tried at the ports renderers usually use) or a full
// description URL.
function seedLocation(s) {
  const v = String(s || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `http://${v}:49152/description.xml`;
}

module.exports = { RendererDiscovery, idFor, seedLocation };
