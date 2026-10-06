"use strict";
/*
 * devices.js — every player as one list: the Audio Devices page's model.
 *
 * Sonos rooms come from the household the Sonos code already reads, phones
 * from the app's hello, UPnP renderers from discovery.js. Each lands in the
 * register (registry.js) so it has a durable identity, a network name, the
 * name you gave it, and its capabilities in layers (profiles.js). The one
 * thing the rest of the server asks this for on every request is nameOf(): a
 * room you renamed is renamed in the zone picker, the mini transport and Now
 * playing alike — an overlay, never a write to the speaker.
 */
const LOUD = require("../loudness");
const { Registry } = require("./registry");
const Biquad = require("../../public/biquad");
const { RendererDiscovery } = require("./discovery");
const { effective } = require("./profiles");
const LocalDevices = require("../local/devices");

const SCAN_MS = 60000;
const SYNC_MS = 10000;
const LOCAL_MS = 30000;

class AudioDevices {
  constructor({ db, zones, bindIp, seedHosts = [], multicast = true, offlineMs = 150000, log = () => {}, local = null }) {
    this.zones = zones;
    this.log = log;
    this.offlineMs = offlineMs;
    this.registry = new Registry(db);
    this.discovery = new RendererDiscovery({ bindIp, seedHosts, multicast, log });
    // This computer's sound devices (v0.6.18): lib/local/devices.js, or a test's.
    this.localList = (local && local.list) || (() => LocalDevices.list());
    this.local = { platform: process.platform, hidden: 0, count: 0, docker: !!process.env.DOCKER };
    this.timers = [];
    this.stopped = false;
    this.scanning = null;     // the promise of the round under way
    this.lastScan = 0;
    this.started = 0;
  }

  start() {
    this.started = Date.now();
    const loop = (every, fn, first) => {
      const run = async () => {
        if (this.stopped) return;
        try { await fn(); } catch (e) { this.log(`[renderers] ${e.message}`); }
        if (!this.stopped) { const t = setTimeout(run, every); t.unref(); this.timers.push(t); }
      };
      const t = setTimeout(run, first); t.unref(); this.timers.push(t);
    };
    loop(SCAN_MS, () => this.scan(), 2000);
    loop(SYNC_MS, () => this.syncKnown(), 3000);
    loop(LOCAL_MS, () => this.scanLocal(), 500);
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
  }

  /* One discovery round now (the page's "Look again" waits for it). */
  scan() {
    if (this.scanning) return this.scanning;
    this.scanning = (async () => {
      try {
        await this.scanLocal().catch(e => this.log(`[local] ${e.message}`));
        const found = await this.discovery.scan();
        for (const rec of found) this.registry.seen(rec);
        this.lastScan = Date.now();
        if (found.length) this.zones.bump();
      } finally { this.scanning = null; }
    })();
    return this.scanning;
  }

  /*
   * This computer's sound devices into the register: seen now, so a DAC
   * unplugged goes offline as a renderer that left the network does.
   */
  async scanLocal() {
    if (this.scanningLocal) return this.scanningLocal;
    this.scanningLocal = (async () => {
      try {
        const r = await this.localList();
        for (const rec of r.devices || []) this.registry.seen(rec);
        const before = this.local.count;
        this.local = Object.assign({}, this.local, { platform: r.platform || this.local.platform, hidden: r.hidden || 0, count: (r.devices || []).length, off: !!r.off });
        if ((r.devices || []).length || before) this.zones.bump();
      } finally { this.scanningLocal = null; }
    })();
    return this.scanningLocal;
  }

  /* Sonos rooms and phones into the register, so a name is a name everywhere. */
  syncKnown() {
    const top = this.zones.topology;
    for (const m of top.rooms()) {
      this.registry.seen({ id: m.uid, kind: "sonos", network_name: m.name, model: top.models.get(m.uid) || "", ip: m.ip, manufacturer: "Sonos" });
    }
    for (const p of this.zones.phones.map.values()) {
      if (!this.zones.phones.present(p)) continue;
      this.registry.seen({ id: p.uid, kind: "phone", network_name: p.name, model: "Phone" });
    }
  }

  nameOf(id) { return this.registry.nameOf(id); }

  /*
   * The switch on each device. A renderer found on the network is OFF until
   * you turn it on — nothing new is offered as a zone by itself; a Sonos room
   * is on unless you turn it off. Phones have no switch. The state lives in
   * the register (settings.enabled), so it survives restarts.
   */
  enabled(r) {
    if (!r) return true;
    if (r.kind === "phone") return true;
    const v = r.settings && r.settings.enabled;
    return r.kind === "upnp" || r.kind === "local" ? v === true : v !== false;
  }
  isEnabled(id) { return this.enabled(this.registry.get(id)); }

  /*
   * A phone others at home may see and play to (v0.5.51): on unless switched
   * off on its page in Audio Devices. Before, a phone was only ever a player
   * for itself.
   */
  shared(id) {
    const r = this.registry.get(id);
    return !r || r.kind !== "phone" || !(r.settings && r.settings.shared === false);
  }
  setShared(id, on) {
    const r = this.registry.get(id);
    if (!r) return null;
    if (r.kind !== "phone") { const e = new Error("Only a phone has this switch"); e.status = 400; throw e; }
    this.registry.setSettings(id, { shared: !!on });
    this.zones.bump();
    return this.get(id);
  }
  /* A zone is offered while any of its outputs is switched on. */
  zoneShown(z) {
    if (!z || z.is_phone) return true;
    return (z.outputs || []).some(o => this.isEnabled(o.output_id));
  }

  /* Output for a renderer: { mode, bits }. */
  setOutput(id, { mode, bits, volume }) {
    const r = this.registry.get(id);
    if (!r) return null;
    if (r.kind !== "upnp" && r.kind !== "local") { const e = new Error("Only a renderer or a sound device on this computer has output settings"); e.status = 400; throw e; }
    const patch = {};
    if (mode !== undefined) {
      if (!["original", "x2", "x4", "max"].includes(mode)) { const e = new Error("mode must be original, x2, x4 or max"); e.status = 400; throw e; }
      patch.mode = mode;
    }
    if (bits !== undefined) {
      if (!(bits === "auto" || bits === 24 || bits === 32)) { const e = new Error("bits must be auto, 24 or 32"); e.status = 400; throw e; }
      patch.bits = bits === "auto" ? null : bits;
    }
    if (volume !== undefined) {
      if (!(volume === "fixed" || volume === "upnp")) { const e = new Error("volume must be fixed or upnp"); e.status = 400; throw e; }
      patch.volume = volume;
    }
    this.registry.setSettings(id, patch);
    this.zones.bump();
    return this.get(id);
  }

  /*
   * DSP (v0.5.23): per output, in the register — the switch, the bands, the
   * headroom (public/biquad.js says what a setting is). A UPnP renderer's
   * runs on the server, in its conversion; a phone's is handed to the app.
   * Never a Sonos room, which has Trueplay.
   */
  dspFor(id) {
    const r = this.registry.get(id);
    if (!r || r.kind === "sonos") return null;
    try { return Biquad.normalise((r.settings || {}).dsp); } catch (e) { return null; }
  }

  setDsp(id, patch) {
    const r = this.registry.get(id);
    if (!r) return null;
    if (r.kind === "sonos") { const e = new Error("Sonos rooms are tuned with Trueplay in the Sonos app"); e.status = 400; throw e; }
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) { const e = new Error("dsp must be an object"); e.status = 400; throw e; }
    const cur = this.dspFor(id) || Biquad.normalise(null);
    const merged = Object.assign({}, cur);
    for (const k of ["enabled", "headphone", "peq", "headroom"]) if (patch[k] !== undefined) merged[k] = patch[k];
    if (merged.headroom === "auto" || merged.headroom === null) merged.headroom = "auto";
    let next;
    try { next = Biquad.normalise(merged); }
    catch (e) { e.status = 400; throw e; }
    this.registry.setSettings(id, { dsp: next });
    // What the zone plays next is planned again with the new setting.
    if ((r.kind === "upnp" || r.kind === "local") && this.zones.upnp && this.zones.upnp.replan) this.zones.upnp.replan(id);
    if (r.kind === "phone" && this.zones.phones && this.zones.phones.dspChanged) this.zones.phones.dspChanged(id, next);
    this.zones.bump();
    return this.get(id);
  }

  /*
   * Volume Levelling (v0.6.0-RC7): ReplayGain per device — Off, Track,
   * Album or Auto, the target level in LUFS, and the adjustment for a track
   * whose loudness isn't known (lib/loudness.js says what each means). Every
   * kind has it: a Sonos room and a renderer get it in the stream, a phone
   * applies it itself.
   */
  levellingFor(id) {
    const r = this.registry.get(id);
    return LOUD.levelling(r && r.settings ? r.settings.levelling : null);
  }

  setLevelling(id, patch) {
    const r = this.registry.get(id);
    if (!r) return null;
    const next = LOUD.levellingPatch((r.settings || {}).levelling, patch);
    this.registry.setSettings(id, { levelling: next });
    // What the zone plays next is planned again with the new setting.
    if ((r.kind === "upnp" || r.kind === "local") && this.zones.upnp && this.zones.upnp.replan) this.zones.upnp.replan(id);
    if (r.kind === "phone" && this.zones.phones && this.zones.phones.levellingChanged) this.zones.phones.levellingChanged(id, next);
    // A Sonos room's queue too (v0.6.0-RC9): heard from where it is, not only on the next thing played.
    if (r.kind === "sonos" && this.zones.replanSonos) this.zones.replanSonos(id).catch(e => this.log && this.log("[levelling] " + e.message));
    this.zones.bump();
    return this.get(id);
  }

  /** A phone's DSP set on the phone itself (offline): into the register, even before the phone is in it. */
  phoneDsp(uid, name, dsp) {
    if (!this.registry.get(uid)) this.registry.seen({ id: uid, kind: "phone", network_name: name, model: "Phone" });
    return this.setDsp(uid, dsp);
  }

  /* Hidden from the Audio Devices list (v0.7.2): a device you can't forget
   * (the computer's own HDMI outputs, say) kept out of the way. Hiding also
   * switches off one that can be, so it leaves the zone picker; a Sonos
   * room or a phone just leaves the list. */
  hidden(r) { return !!(r && r.settings && r.settings.hidden === true); }
  async setHidden(id, on) {
    const r = this.registry.get(id);
    if (!r) return null;
    if (on && r.kind !== "phone" && this.enabled(r)) await this.setEnabled(id, false);
    this.registry.setSettings(id, { hidden: !!on });
    return this.get(id);
  }

  async setEnabled(id, on) {
    const r = this.registry.get(id);
    if (!r) return null;
    if (r.kind === "phone") { const e = new Error("A phone is always its own player"); e.status = 400; throw e; }
    if (!on && (r.kind === "upnp" || r.kind === "local") && this.zones.upnp) {
      // Switched off while playing: stopped, and its queue let go.
      await this.zones.upnp.clearQueue(id).catch(() => {});
      this.zones.upnp.drop(id);
    }
    this.registry.setSettings(id, { enabled: !!on });
    this.zones.bump();
    return this.get(id);
  }

  online(r) {
    if (r.kind === "sonos") { const m = this.zones.topology.member(r.id); return !!(m && !m.invisible && m.ip); }
    if (r.kind === "phone") return this.zones.phones.has(r.id);
    return Date.now() - (r.last_seen || 0) < this.offlineMs;
  }

  stateOf(r) {
    let st = null;
    if (r.kind === "sonos") {
      const g = this.zones.groupOf(r.id);
      st = g ? this.zones.state.get(g.coordinator.uid) : null;
    } else st = this.zones.state.get(r.id) || null;
    return st && st.state ? st.state : "stopped";
  }

  json(r, full) {
    const online = this.online(r);
    const caps = effective(Object.assign({ playable: !!(r.caps && r.caps.playable) }, r));
    const out = {
      id: r.id, kind: r.kind, family: r.family || "",
      name: r.name || r.network_name, network_name: r.network_name, renamed: !!r.name,
      manufacturer: r.manufacturer || "", model: r.model || "", model_number: r.model_number || "", firmware: r.firmware || "",
      ip: r.ip || "",
      online, state: online ? this.stateOf(r) : "offline",
      enabled: this.enabled(r), can_toggle: r.kind !== "phone", hidden: this.hidden(r),
      shared: r.kind === "phone" ? this.shared(r.id) : undefined,
      output: r.kind === "upnp" || r.kind === "local" ? {
        mode: ["original", "x2", "x4", "max"].includes((r.settings || {}).mode) ? r.settings.mode : "original",
        bits: (r.settings || {}).bits === 24 || (r.settings || {}).bits === 32 ? r.settings.bits : "auto",
        flac32: !!require("../ffmpeg").info().flac32
      } : null,
      first_seen: r.first_seen, last_seen: r.last_seen,
      profile: caps.profile,
      editable: caps.editable,
      playable: r.kind !== "upnp" ? true : !!caps.playable,
      location: r.kind === "local" ? (r.location || "").replace(/^(alsa|coreaudio|file):/, "") : undefined,
      rates: caps.rates, bits: caps.bits, dsd: caps.dsd, containers: caps.containers,
      levelling: this.levellingFor(r.id)
    };
    if (r.kind !== "sonos") {
      const dsp = this.dspFor(r.id) || Biquad.normalise(null);
      const rate = 48000;
      out.dsp = dsp;
      out.dsp_info = {
        active: Biquad.active(dsp),
        bands: Biquad.bandsOf(dsp).length,
        headroom: Biquad.headroom(dsp, rate),
        peak: Math.round(Biquad.peakDb(Biquad.bandsOf(dsp), rate) * 10) / 10
      };
    }
    if (full) {
      if (r.kind !== "local") out.location = r.location || "";
      out.caps = r.caps;
      out.settings = r.settings;
      out.found_by = r.kind === "sonos" ? "The Sonos household" : r.kind === "phone" ? "The Mandarin app"
        : r.kind === "local" ? (/^coreaudio:/.test(r.location || "") ? "This Mac (Core Audio)" : "This computer (ALSA)") : "UPnP discovery";
      out.last_error = ((r.kind === "upnp" || r.kind === "local") && this.zones.upnp) ? this.zones.upnp.errorOf(r.id) : null;
      out.openhome = !!(r.caps && r.caps.openhome);
      out.events = (r.kind === "upnp" && this.zones.upnp) ? this.zones.upnp.eventsOf(r.id) : null;
      // Volume: set on the device itself (a Poly feeds a Mojo; a WiiM on fixed
      // line out), or Mandarin's slider. Renderers only; never a Sonos room.
      out.volume_fixed = (r.kind === "upnp" || r.kind === "local") && this.zones.upnp ? this.zones.upnp.fixedVolume(r) : false;
      out.can_fix_volume = (r.kind === "upnp" || r.kind === "local") && !!(r.caps && r.caps.playable);
      out.takes_flac = r.kind !== "upnp" || !this.zones.upnp || this.zones.upnp.takesFlac(r);
    }
    return out;
  }

  list() {
    const rank = d => (d.state === "playing" || d.state === "loading") ? 0 : d.online ? 1 : 2;
    return this.registry.all().map(r => this.json(r, false))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }

  get(id) {
    const r = this.registry.get(id);
    return r ? this.json(r, true) : null;
  }

  rename(id, name) {
    const r = this.registry.get(id);
    if (!r) return null;
    if (r.kind === "phone") { const e = new Error("A phone is named in the app on the phone"); e.status = 400; throw e; }
    this.registry.rename(id, name);
    this.zones.bump();
    return this.get(id);
  }

  setUserCaps(id, user) {
    const r = this.registry.get(id);
    if (!r) return null;
    if (r.kind !== "upnp" && r.kind !== "local") { const e = new Error("What a Sonos room or a phone plays is fixed"); e.status = 400; throw e; }
    this.registry.setUserCaps(id, user);
    return this.get(id);
  }

  forget(id) {
    const r = this.registry.get(id);
    if (!r) return false;
    if (this.online(r)) { const e = new Error("It is on the network — Forget is for a device that has gone"); e.status = 409; throw e; }
    this.registry.forget(id);
    for (const [loc, hit] of this.discovery.cache) if (hit.record && hit.record.id === id) this.discovery.cache.delete(loc);
    if (this.zones.upnp) this.zones.upnp.drop(id);
    this.zones.bump();
    return true;
  }
}

module.exports = { AudioDevices };
