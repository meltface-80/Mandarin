"use strict";
/*
 * phones.js — an Android phone running the MusicD app, as one more zone.
 *
 * The phone plays through its own speaker or headphones (Media3/ExoPlayer in
 * the app), and to everything else — the web interface, the zone picker, the
 * queue tab, history, Random Album Radio — it is simply another room. That is
 * why it lives here beside the Sonos zones rather than anywhere new: every
 * screen that works for a Sonos room works for the phone unchanged, from the
 * phone itself or from any other device.
 *
 * The server keeps the phone's queue and sends it COMMANDS (load, insert,
 * play, pause, seek…) that the app collects with a long poll; the app reports
 * back what it is actually doing (which track, where, playing or not). That
 * report becomes the zone's state, the same shape a Sonos poll produces, and
 * goes through the same hooks: "played" for history, "queue-low" for radio.
 *
 * A phone is a zone only while its app is connected: it disappears ~45 s after
 * the app stops asking for commands (closed, off the network).
 */
const DIDL = require("./didl");

const PRESENT_MS = 45000;
const KEEP_COMMANDS = 200;
// What the app's player (Media3) reads as it is; the rest comes as FLAC.
const PHONE_CONTAINERS = ["flac", "mp3", "aac", "alac", "wav", "aiff", "ogg", "opus"];

class PhonePlayers {
  constructor(zm) {
    this.zm = zm;
    this.map = new Map();   // uid -> { uid, deviceId, name, queue, commands, lastSeen, waiters }
    this.seq = 0;
    this.sweeper = setInterval(() => this.sweep(), 10000);
    this.sweeper.unref();
  }

  static uidFor(deviceId) { return "PHONE_" + deviceId; }

  isPhoneId(id) { return String(id || "").startsWith("PHONE_"); }

  /* Where the phone is, as its own requests show (v0.5.51): a phone away
   * from home is a player for itself only, whatever its setting says. */
  setAway(uid, away) {
    const p = this.map.get(String(uid || ""));
    if (!p || p.away === !!away) return;
    p.away = !!away;
    this.zm.bump();
  }
  isAway(uid) { const p = this.map.get(String(uid || "")); return !p || p.away !== false; }
  present(p) { return !!p && Date.now() - p.lastSeen < PRESENT_MS; }
  has(id) { return this.present(this.map.get(String(id || ""))); }
  get(id) {
    const p = this.map.get(String(id || ""));
    if (!this.present(p)) { const e = new Error("That phone isn't connected — open the Mandarin app on it"); e.status = 409; throw e; }
    return p;
  }

  sweep() {
    let changed = false;
    for (const p of this.map.values()) {
      if (!this.present(p) && !p.gone) { p.gone = true; changed = true; }
    }
    if (changed) this.zm.bump();
  }

  // ------------------------------------------------------------ the app

  /*
   * The app's player has (re)started with nothing loaded. Its queue here is
   * kept — Android stops an idle player after a while, and what was paused
   * mustn't be lost with it — and handed back as `resume`: the same tracks,
   * the same place, paused, for the app to pick up where it stopped. The
   * zone shows as paused there meanwhile. A phone the server never met, or
   * one whose queue was empty, starts blank as before.
   */
  hello(deviceId, name) {
    const uid = PhonePlayers.uidFor(deviceId);
    const p = this.map.get(uid) || { uid, deviceId, queue: [], commands: [], waiters: new Set() };
    p.name = String(name || "Phone").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60) || "Phone";
    p.commands = [];
    p.lastSeen = Date.now();
    p.gone = false;
    this.map.set(uid, p);
    const prev = this.zm.state.get(uid) || {};
    let resume = null;
    if (p.queue.length) {
      const snap = this.snapshot(p);
      resume = Object.assign({ op: "load" }, snap, { play: false });
      this.zm.state.set(uid, Object.assign({}, prev, {
        state: "paused", position: snap.seconds, at: Date.now(), unreachable: false,
        volume: prev.volume || { value: null, muted: false }
      }));
    } else {
      this.zm.state.set(uid, blankState(prev.volume));
    }
    this.zm.bump();
    this.zm.persist(uid);
    return { zone_id: uid, seq: this.seq, resume };
  }

  // ------------------------------------------------------------ kept across a restart

  /* What the store keeps of this phone's queue (lib/sonos/queue-store.js); null when empty. */
  saved(uid) {
    const p = this.map.get(String(uid || ""));
    if (!p || !p.queue.length) return null;
    return { kind: "phone", deviceId: p.deviceId, name: p.name, ids: p.queue.map(it => it.trackId) };
  }

  /*
   * A queue kept from before a restart, back on the server's side. The app,
   * if it is still running, carries on and reports as before; one that was
   * restarted gets the queue back with its hello (`resume`). Until the app
   * is heard from the phone is not in the zone list; its state is ready.
   */
  restore(snap, items) {
    const uid = PhonePlayers.uidFor(snap.deviceId);
    const list = items.map(it => this.toItem(it));
    const p = this.map.get(uid) || { uid, deviceId: snap.deviceId, commands: [], waiters: new Set() };
    p.name = snap.name || p.name || "Phone";
    p.queue = list;
    p.lastSeen = 0;
    p.gone = true;
    this.map.set(uid, p);
    const index = Math.max(0, Math.min(list.length - 1, Number(snap.index) || 0));
    const it = list[index];
    this.zm.state.set(uid, Object.assign(blankState(snap.volume || undefined), {
      // Playing when the server went: paused until the app says otherwise.
      state: snap.state === "stopped" ? "stopped" : "paused",
      trackUri: it.uri, trackId: it.trackId, trackNumber: index + 1, queueLength: list.length, onQueue: true,
      position: Math.max(0, Number(snap.seconds) || 0), duration: it.duration || 0,
      title: it.title, artist: it.artist, album: it.album, artUri: it.artUri,
      shuffle: !!snap.shuffle, loop: snap.loop || "disabled", at: Date.now()
    }));
  }

  /* Commands after `after`, waiting up to `timeoutMs` for one to arrive. */
  async commands(uid, after, timeoutMs) {
    const p = this.map.get(uid);
    if (!p) { const e = new Error("Say hello first"); e.status = 409; throw e; }
    const wasGone = !this.present(p);
    p.lastSeen = Date.now();
    if (wasGone) { p.gone = false; this.zm.bump(); }
    // The app is ahead of us: this server has restarted (an update) with the
    // phone's queue put back from the store, and counts from nought again.
    // The app takes the sequence it is handed back and carries on.
    if (after > this.seq) after = this.seq;
    const pending = () => p.commands.filter(c => c.seq > after);
    if (!pending().length && timeoutMs > 0) {
      await new Promise((resolve) => {
        const t = setTimeout(done, timeoutMs);
        function done() { clearTimeout(t); p.waiters.delete(done); resolve(); }
        p.waiters.add(done);
      });
      p.lastSeen = Date.now();
    }
    // Missed some (the list was trimmed): start again from a full picture.
    if (after > 0 && p.commands.length && p.commands[0].seq > after + 1) {
      return { seq: this.seq, commands: [Object.assign({ seq: this.seq, op: "sync" }, this.snapshot(p))] };
    }
    return { seq: this.seq, commands: pending() };
  }

  /*
   * The phone's USB DAC as a stream target (Stage 9.3), while the app plays
   * through its own driver: the rates and depths the DAC takes and the DSD
   * it can be given (natively or as DoP), so the plan sends the file as it
   * is — hi-res FLAC untouched, DSF/DFF as DSD — where Sonos' 24/48 rule
   * would have brought it down. Null (the Sonos rule) with no DAC in use.
   */
  targetFor(uid) {
    const p = this.map.get(String(uid || ""));
    const c = p && p.usbCaps;
    if (!c) return null;
    return {
      id: p.uid, name: p.name, rates: c.rates, maxBits: c.bits.length ? Math.max(...c.bits) : 24,
      containers: PHONE_CONTAINERS, mode: "original", bits: "auto", dsd: c.dsd, dsp: null
    };
  }

  /* The app's usb_caps, checked: { rates, bits, dsd } or null. */
  static usbCaps(v) {
    if (!v || typeof v !== "object") return null;
    const ints = (a, ok) => Array.isArray(a) ? [...new Set(a.map(Number).filter(ok))].sort((x, y) => x - y) : [];
    const rates = ints(v.rates, n => Number.isInteger(n) && n >= 8000 && n <= 768000);
    if (!rates.length) return null;
    return { rates, bits: ints(v.bits, n => [16, 24, 32].includes(n)), dsd: ints(v.dsd, n => [64, 128, 256, 512].includes(n)) };
  }

  /* What the app says it is doing. */
  report(uid, r) {
    const p = this.map.get(uid);
    if (!p) return;
    p.lastSeen = Date.now();
    // The player holding a list of its own (the phone's music, Stage 5; a
    // download the server doesn't know): the app sends the list when it
    // changes, and the page shows it as the zone's queue.
    if (r.local && Array.isArray(r.local_items)) {
      p.local = r.local_items.slice(0, 500).map(it => ({
        // A server track added to the phone's own list keeps its id: the page shows its cover and album.
        uri: "", trackId: Number.isInteger(it.track_id) && it.track_id > 0 ? it.track_id : null, title: String(it.title || ""), artist: String(it.artist || ""), album: String(it.album || ""),
        artUri: "", imageKey: it.image_key ? String(it.image_key) : null, albumKey: it.album_key ? String(it.album_key) : null,
        duration: Number(it.duration) || 0, ext: it.ext ? String(it.ext) : ""
      }));
    }
    const local = !!r.local && Array.isArray(p.local) && p.local.length > 0;
    const list = local ? p.local : p.queue;
    const count = list.length;
    const index = Number.isInteger(r.index) && r.index >= 0 && r.index < count ? r.index : -1;
    const item = index >= 0 ? list[index] : null;
    const prev = this.zm.state.get(uid) || blankState();
    const next = Object.assign(blankState(), {
      local,
      // The phone's own cover and album, for the page (api-playback nowPlaying).
      imageKey: local && item ? item.imageKey : null,
      albumOffset: local && item && item.albumKey ? "phone:" + item.albumKey : null,
      localExt: local && item ? item.ext : "",
      state: ["playing", "paused", "loading", "stopped"].includes(r.state) ? r.state : "stopped",
      trackUri: item ? item.uri : "",
      trackId: item ? item.trackId : null,
      trackNumber: item ? index + 1 : 0,
      queueLength: count,
      onQueue: count > 0,
      position: Math.max(0, Number(r.position) || 0),
      duration: Number(r.duration) || (item ? item.duration : 0) || 0,
      title: item ? item.title : "",
      artist: item ? item.artist : "",
      album: item ? item.album : "",
      artUri: item ? item.artUri : "",
      shuffle: !!r.shuffle,
      loop: ["disabled", "loop", "loop_one"].includes(r.loop) ? r.loop : "disabled",
      // What the phone is actually playing the track as: the server's Opus
      // 256 (away, or an Opus download) — decoded to float by the app's own
      // libopus ("opus24") or to 16-bit by Android's ("opus") — or the file
      // as it is.
      format: r.format === "opus24" ? "opus24" : r.format === "opus" ? "opus" : "original",
      // The app's DSP engine at work on what it plays (v0.5.24).
      dsp: !!r.dsp,
      // Through the app's own USB driver (Stage 9.2): "rate/bits" the DAC is
      // fed; "dsd64" native DSD, "dop64" DSD over PCM (9.3).
      usb: typeof r.usb === "string" && /^(\d+\/\d+|dsd\d+|dop\d+)$/.test(r.usb) ? r.usb : null,
      volume: {
        value: Number.isFinite(Number(r.volume)) ? Math.max(0, Math.min(100, Math.round(Number(r.volume)))) : (prev.volume || {}).value,
        muted: !!r.muted
      },
      at: Date.now()
    });
    this.zm.applyState(uid, prev, next);
    // The DAC came, went or changed (Stage 9.3): the queue's addresses are
    // planned for it again (the file as it is, DSD, or FLAC at the best
    // rate) and the app is handed the same queue at the place just reported.
    const caps = PhonePlayers.usbCaps(r.usb_caps);
    if (JSON.stringify(caps) !== JSON.stringify(p.usbCaps || null)) {
      p.usbCaps = caps;
      this.replan(p);
    }
  }

  // ------------------------------------------------------------ zones

  zones() {
    const out = [];
    for (const p of this.map.values()) {
      if (!this.present(p)) continue;
      const st = this.zm.state.get(p.uid) || blankState();
      out.push({
        zone_id: p.uid,
        display_name: p.name,
        state: st.state || "stopped",
        settings: { shuffle: !!st.shuffle, loop: st.loop || "disabled", auto_radio: false },
        outputs: [this.outputJson(p, st)],
        is_phone: true,
        device_id: p.deviceId,
        _state: st,
        _group: null
      });
    }
    return out;
  }

  outputJson(p, st) {
    const v = st.volume || {};
    return {
      output_id: p.uid,
      zone_id: p.uid,
      display_name: p.name,
      model: "Phone",
      stereo_pair: false,
      is_muted: !!v.muted,
      volume: { type: "number", min: 0, max: 100, step: 1, value: v.value == null ? null : v.value, soft_limit: 100, is_muted: !!v.muted },
      can_group_with_output_ids: [p.uid],
      source_controls: []
    };
  }

  queue(uid) {
    const p = this.get(uid);
    const st = this.zm.state.get(uid) || {};
    const list = st.local && Array.isArray(p.local) ? p.local : p.queue;
    return {
      items: list.map((it, i) => ({
        position: i + 1, uri: it.uri, trackId: it.trackId, title: it.title, artist: it.artist,
        album: it.album, artUri: it.artUri, duration: it.duration, imageKey: it.imageKey || null
      })),
      total: list.length,
      current: st.trackNumber || 0
    };
  }

  // ------------------------------------------------------------ commands

  /* The phone's DSP setting was saved (Audio Devices): the app is told, and
   * runs it from the next buffer. The setting is public/biquad.js's shape. */
  dspChanged(uid, dsp) {
    const p = this.map.get(String(uid || ""));
    if (!p) return false;
    this.push(p, { op: "dsp", dsp });
    return true;
  }

  push(p, cmd) {
    cmd.seq = ++this.seq;
    p.commands.push(cmd);
    if (p.commands.length > KEEP_COMMANDS) p.commands.splice(0, p.commands.length - KEEP_COMMANDS);
    for (const w of [...p.waiters]) w();
  }

  /* The queue's items built again for the phone's target as it is now, and handed back in place. */
  replan(p) {
    if (!p.queue.length || typeof this.zm.rebuildItems !== "function") return;
    const ids = p.queue.map(it => it.trackId);
    if (ids.some(id => !id)) return;
    let items;
    try { items = this.zm.rebuildItems(ids, p.uid).map(it => this.toItem(it)); } catch (e) { return; }
    if (items.length !== p.queue.length) return;
    if (items.every((it, i) => it.uri === p.queue[i].uri)) return;
    p.queue = items;
    const st = this.zm.state.get(p.uid) || {};
    const snap = this.snapshot(p);
    this.push(p, Object.assign({ op: "load" }, snap, { play: st.state === "playing" || st.state === "loading" }));
    const index = snap.index;
    if (p.queue[index]) Object.assign(st, { trackUri: p.queue[index].uri });
    this.zm.persist(p.uid);
  }

  // Straight away, before the phone reports back, so the page doesn't lag.
  optimistic(uid, patch) {
    const st = this.zm.state.get(uid);
    if (!st) return;
    Object.assign(st, patch, { at: Date.now() });
    this.zm.bump();
  }

  snapshot(p) {
    const st = this.zm.state.get(p.uid) || {};
    return {
      items: p.queue.map(publicItem),
      index: Math.max(0, (st.trackNumber || 1) - 1),
      seconds: this.zm.positionNow(st),
      play: st.state === "playing"
    };
  }

  // Items arrive as the Sonos code builds them — { uri, meta, track? } — and
  // the phone needs plain fields.
  toItem(it) {
    if (it.phone) return it.phone;
    const m = DIDL.parseItems(it.meta || "")[0] || {};
    const t = it.track;
    return {
      uri: it.uri,
      trackId: t ? t.id : this.zm.trackIdFromUri(it.uri),
      title: m.title || (t && t.title) || "",
      artist: m.artist || (t && t.artist) || "",
      album: m.album || (t && t.album) || "",
      artUri: m.artUri || "",
      duration: m.duration || (t && t.duration) || 0
    };
  }

  enqueue(uid, items, how, { startAt = 0, seconds = 0 } = {}) {
    const p = this.get(uid);
    const list = items.map(it => this.toItem(it));
    if (!list.length) throw new Error("Nothing to play");
    const st = this.zm.state.get(uid) || {};
    // The phone playing a list of its own (downloads, its own music): an
    // album added goes into that list, where the phone is, not into the
    // server's queue it isn't playing (v0.5.50; before, it was dropped).
    if (how !== "play_now" && st.local && Array.isArray(p.local) && p.local.length) {
      const at = how === "add_next" ? Math.min(p.local.length, st.trackNumber || 0) : p.local.length;
      p.local.splice(at, 0, ...list.map(it => Object.assign({ imageKey: null, albumKey: null, ext: "" }, it)));
      this.push(p, { op: "insert", at, local: true, items: list.map(publicItem), play: st.state === "stopped" });
      this.optimistic(uid, { queueLength: p.local.length, onQueue: true });
      return { queued: list.length };
    }
    const idle = !p.queue.length || st.state === "stopped";
    if (how === "play_now" || (how !== "queue" && idle && !p.queue.length)) {
      p.queue = list;
      const index = Math.max(0, Math.min(list.length - 1, startAt));
      this.push(p, { op: "load", items: list.map(publicItem), index, seconds: Number(seconds) || 0, play: true });
      // The server's queue is the one playing now (not a list of the phone's own).
      this.optimistic(uid, { local: false, imageKey: null, albumOffset: null, state: "loading", trackNumber: index + 1, queueLength: list.length, onQueue: true,
        trackUri: list[index].uri, trackId: list[index].trackId, title: list[index].title, artist: list[index].artist,
        album: list[index].album, artUri: list[index].artUri, duration: list[index].duration, position: Number(seconds) || 0 });
    } else if (how === "add_next") {
      const at = Math.min(p.queue.length, st.trackNumber || 0);
      p.queue.splice(at, 0, ...list);
      this.push(p, { op: "insert", at, items: list.map(publicItem), play: idle });
      this.optimistic(uid, { queueLength: p.queue.length, onQueue: true });
    } else {
      const at = p.queue.length;
      p.queue.push(...list);
      this.push(p, { op: "insert", at, items: list.map(publicItem), play: idle });
      this.optimistic(uid, { queueLength: p.queue.length, onQueue: true });
    }
    this.zm.persist(uid);
    return { queued: list.length };
  }

  control(uid, command) {
    const p = this.get(uid);
    const st = this.zm.state.get(uid) || {};
    let cmd = command;
    if (cmd === "playpause") cmd = (st.state === "playing" || st.state === "loading") ? "pause" : "play";
    if (!["play", "pause", "stop", "next", "previous"].includes(cmd)) throw new Error("unknown command " + command);
    this.push(p, { op: cmd });
    if (cmd === "play") this.optimistic(uid, { state: "playing", position: this.zm.positionNow(st) });
    if (cmd === "pause" || cmd === "stop") this.optimistic(uid, { state: cmd === "stop" ? "stopped" : "paused", position: this.zm.positionNow(st) });
  }

  seek(uid, how, seconds) {
    const p = this.get(uid);
    const st = this.zm.state.get(uid) || {};
    const target = Math.max(0, how === "relative" ? this.zm.positionNow(st) + Number(seconds) : Number(seconds));
    this.push(p, { op: "seek", seconds: target });
    this.optimistic(uid, { position: target });
  }

  playFromHere(uid, position) {
    const p = this.get(uid);
    const st = this.zm.state.get(uid) || {};
    // The phone's own list (local) mirrors the player's, so the index holds.
    const list = st.local && Array.isArray(p.local) ? p.local : p.queue;
    const index = Math.max(0, Math.min(list.length - 1, Number(position) - 1));
    this.push(p, { op: "jump", index });
    const it = list[index];
    if (it) this.optimistic(uid, { state: "loading", trackNumber: index + 1, trackUri: it.uri, trackId: it.trackId, title: it.title, position: 0 });
  }

  removeFromQueue(uid, position) {
    const p = this.get(uid);
    const index = Number(position) - 1;
    if (index < 0 || index >= p.queue.length) return;
    p.queue.splice(index, 1);
    this.push(p, { op: "remove", index });
    this.optimistic(uid, { queueLength: p.queue.length });
    this.zm.persist(uid);
  }

  clearQueue(uid) {
    const p = this.get(uid);
    p.queue = [];
    this.push(p, { op: "clear" });
    this.optimistic(uid, blankState((this.zm.state.get(uid) || {}).volume));
    this.zm.persist(uid);
  }

  setSettings(uid, { shuffle, loop }) {
    const p = this.get(uid);
    const st = this.zm.state.get(uid) || {};
    const next = { shuffle: shuffle == null ? !!st.shuffle : !!shuffle, loop: loop == null ? (st.loop || "disabled") : loop };
    this.push(p, { op: "mode", shuffle: next.shuffle, loop: next.loop });
    this.optimistic(uid, next);
  }

  setVolume(uid, how, value) {
    const p = this.get(uid);
    const st = this.zm.state.get(uid) || {};
    const cur = (st.volume && st.volume.value) || 0;
    const target = Math.max(0, Math.min(100, Math.round(how === "relative" || how === "relative_step" ? cur + Number(value) : Number(value))));
    this.push(p, { op: "volume", value: target });
    this.optimistic(uid, { volume: { value: target, muted: !!(st.volume && st.volume.muted) } });
  }

  setMute(uid, muted) {
    const p = this.get(uid);
    const st = this.zm.state.get(uid) || {};
    this.push(p, { op: "mute", muted: !!muted });
    this.optimistic(uid, { volume: { value: st.volume ? st.volume.value : null, muted: !!muted } });
  }

  pauseAll() {
    for (const p of this.map.values()) if (this.present(p)) this.push(p, { op: "pause" });
  }

  /* The queue as Sonos-style items, for moving what's playing elsewhere. */
  itemsFor(uid) {
    const p = this.get(uid);
    return p.queue.map(it => ({
      uri: it.uri, phone: it,
      meta: DIDL.build(it.uri, { title: it.title, artist: it.artist, album: it.album, artUri: it.artUri, duration: it.duration })
    }));
  }
}

function blankState(volume) {
  return {
    state: "stopped", trackUri: "", trackId: null, trackNumber: 0, queueLength: 0, onQueue: false,
    position: 0, duration: 0, title: "", artist: "", album: "", artUri: "", streamContent: "",
    shuffle: false, loop: "disabled", playMode: "NORMAL", mediaUri: "", at: Date.now(), unreachable: false,
    volume: volume || { value: null, muted: false }
  };
}

// What the app is sent for each track.
function publicItem(it) {
  return {
    url: it.uri, track_id: it.trackId, title: it.title, artist: it.artist,
    album: it.album, art_url: it.artUri, duration: it.duration
  };
}

module.exports = { PhonePlayers, PRESENT_MS };
