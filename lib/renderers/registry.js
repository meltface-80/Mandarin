"use strict";
/*
 * registry.js — the audio_devices table: every player Mandarin has met.
 *
 * A row per device — Sonos room, phone running the app, UPnP renderer — with
 * the name its own network gives it, the name you gave it here, what it is,
 * what it can take (caps, in layers: see profiles.js) and its settings. The
 * table is on the database's KEEP list, so a rebuilt library keeps your names.
 *
 * Nothing leaves by itself: a device that has been off for a month is still
 * here, dimmed, until you choose Forget.
 */
const { RATES, BITS } = require("./profiles");

const NAME_MAX = 60;

function cleanName(v) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, "").trim().slice(0, NAME_MAX);
}
function parseJson(s, fallback) {
  try { const v = JSON.parse(s); return v && typeof v === "object" ? v : fallback; } catch (e) { return fallback; }
}

class Registry {
  constructor(db) {
    this.db = db.raw;
    const d = this.db;
    this.q = {
      all: d.prepare("SELECT * FROM audio_devices ORDER BY network_name COLLATE NOCASE"),
      get: d.prepare("SELECT * FROM audio_devices WHERE id = ?"),
      insert: d.prepare(`INSERT INTO audio_devices(id, kind, family, network_name, manufacturer, model, model_number, firmware, ip, location, caps, settings, first_seen, last_seen)
                         VALUES(@id, @kind, @family, @network_name, @manufacturer, @model, @model_number, @firmware, @ip, @location, @caps, @settings, @now, @now)`),
      seen: d.prepare(`UPDATE audio_devices SET kind = @kind, family = @family, network_name = @network_name,
                         manufacturer = @manufacturer, model = @model, model_number = @model_number, firmware = @firmware,
                         ip = @ip, location = @location, caps = @caps, last_seen = @now WHERE id = @id`),
      touch: d.prepare("UPDATE audio_devices SET last_seen = ?, network_name = ? WHERE id = ?"),
      name: d.prepare("UPDATE audio_devices SET name = ? WHERE id = ?"),
      caps: d.prepare("UPDATE audio_devices SET caps = ? WHERE id = ?"),
      settings: d.prepare("UPDATE audio_devices SET settings = ? WHERE id = ?"),
      del: d.prepare("DELETE FROM audio_devices WHERE id = ?")
    };
    // The name overlay is asked for on every /api/zones: kept in memory.
    this.names = new Map();
    for (const r of this.q.all.all()) if (r.name) this.names.set(r.id, r.name);
  }

  row(r) {
    if (!r) return null;
    return Object.assign({}, r, { caps: parseJson(r.caps, {}), settings: parseJson(r.settings, {}) });
  }

  all() { return this.q.all.all().map(r => this.row(r)); }
  get(id) { return this.row(this.q.get.get(String(id || ""))); }
  nameOf(id) { return this.names.get(id) || null; }

  /*
   * A device is on the network (again). Identity fields are only overwritten
   * with something — a probe that failed this time must not blank last time's
   * model — and the caps written here are the advertised layer; yours and the
   * verified ones are kept.
   */
  seen(info) {
    const now = Date.now();
    const cur = this.get(info.id);
    const keep = (k) => (info[k] != null && String(info[k]).trim() !== "") ? String(info[k]).trim() : (cur ? (cur[k] || "") : "");
    const caps = Object.assign({}, cur ? cur.caps : {}, info.caps && info.caps.advertised ? { advertised: info.caps.advertised } : {});
    if (info.playable != null) caps.playable = !!info.playable;
    if (info.services) caps.services = info.services;
    if (info.openhome != null) caps.openhome = !!info.openhome;
    if (info.linkplay) caps.linkplay = info.linkplay;
    const params = {
      id: String(info.id), kind: String(info.kind || (cur && cur.kind) || "upnp"),
      family: keep("family"), network_name: cleanName(info.network_name) || (cur && cur.network_name) || "Unnamed device",
      manufacturer: keep("manufacturer"), model: keep("model"), model_number: keep("model_number"), firmware: keep("firmware"),
      ip: keep("ip"), location: keep("location"),
      caps: JSON.stringify(caps), settings: JSON.stringify(cur ? cur.settings : {}), now
    };
    if (cur) this.q.seen.run(params); else this.q.insert.run(params);
    return this.get(info.id);
  }

  /* Still here (a Sonos room read from the household, a phone polling). */
  touch(id, networkName) {
    const cur = this.get(id);
    if (!cur) return null;
    this.q.touch.run(Date.now(), cleanName(networkName) || cur.network_name, String(id));
    return cur;
  }

  rename(id, name) {
    const n = cleanName(name) || null;
    if (!this.get(id)) return null;
    this.q.name.run(n, String(id));
    if (n) this.names.set(String(id), n); else this.names.delete(String(id));
    return this.get(id);
  }

  /* The "you set it" layer: arrays of the rates/depths that are on, or null to clear. */
  setUserCaps(id, user) {
    const cur = this.get(id);
    if (!cur) return null;
    const caps = Object.assign({}, cur.caps);
    if (!user) delete caps.user;
    else {
      const u = Object.assign({}, caps.user || {});
      if (user.rates !== undefined) {
        if (user.rates === null) delete u.rates;
        else u.rates = RATES.filter(r => (user.rates || []).map(Number).includes(r));
      }
      if (user.bits !== undefined) {
        if (user.bits === null) delete u.bits;
        else u.bits = BITS.filter(b => (user.bits || []).map(Number).includes(b));
      }
      if (Object.keys(u).length) caps.user = u; else delete caps.user;
    }
    this.q.caps.run(JSON.stringify(caps), String(id));
    return this.get(id);
  }

  /* Something the device itself confirmed: { rate?, bits? } at now. */
  markVerified(id, { rate, bits } = {}) {
    const cur = this.get(id);
    if (!cur) return null;
    const caps = Object.assign({}, cur.caps);
    const v = Object.assign({ rates: {}, bits: {} }, caps.verified || {});
    const when = new Date().toISOString();
    if (rate) v.rates = Object.assign({}, v.rates, { [String(rate)]: when });
    if (bits) v.bits = Object.assign({}, v.bits, { [String(bits)]: when });
    caps.verified = v;
    this.q.caps.run(JSON.stringify(caps), String(id));
    return this.get(id);
  }

  setSettings(id, patch) {
    const cur = this.get(id);
    if (!cur) return null;
    const next = Object.assign({}, cur.settings, patch || {});
    for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
    this.q.settings.run(JSON.stringify(next), String(id));
    return this.get(id);
  }

  /* Gone for good — until it is seen again, when it starts fresh. */
  forget(id) {
    this.q.del.run(String(id));
    this.names.delete(String(id));
  }
}

module.exports = { Registry, cleanName, NAME_MAX };
