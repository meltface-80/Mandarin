"use strict";
const { planMoves } = require("../sonos/queue-moves");
/*
 * players.js — a UPnP/DLNA renderer (a WiiM, a Chord Poly, any streamer) as
 * one more zone.
 *
 * Like a phone (lib/sonos/phones.js), a plain renderer has no queue of its
 * own, so the server keeps it. Each track is handed over with
 * SetAVTransportURI + Play, and the one after it with SetNextAVTransportURI
 * as soon as its file is complete, which is what makes the join gapless on a
 * device that honours it. One that does not is noticed — it stops at the end
 * of a track with a next one waiting — and is started on the next by hand.
 *
 * State is polled the way Sonos rooms are: GetTransportInfo +
 * GetPositionInfo, every second while someone is looking or it is playing,
 * every few seconds otherwise, through the same applyState, so history and
 * Random album radio see a renderer as they see a room. Which track is
 * playing is read from the URI the renderer reports (our stream URLs carry
 * the track id), never from its metadata, so the page shows Mandarin's own
 * titles and covers whatever the device makes of the DIDL it was given.
 *
 * A sound device on this computer (a USB DAC, v0.6.18) is one of these too:
 * its record's kind is "local", and lib/local/output.js plays to it with the
 * same transport and volume calls a renderer answers.
 */
const DIDL = require("../sonos/didl");
const FF = require("../ffmpeg");
const { Renderer } = require("./renderer");
const { effective } = require("./profiles");
const LinkPlay = require("./linkplay");
const GENA = require("./gena");
const { LocalOutput } = require("../local/output");
const ENGINE = require("../local/engine");
// A sound device on this computer, played either way (v0.8.0).
const isLocal = (r) => r instanceof LocalOutput || r instanceof ENGINE.EngineOutput;
const LocalDevices = require("../local/devices");

const STATE = {
  PLAYING: "playing", TRANSITIONING: "loading", PAUSED_PLAYBACK: "paused",
  STOPPED: "stopped", NO_MEDIA_PRESENT: "stopped"
};
const QUEUE_MAX = 1000;
const HOT_MS = 15000;
// UPnP faults that mean "not that action": the renderer has no SetNext.
const NOT_SUPPORTED = new Set([401, 402, 501, 602]);

class UpnpPlayers {
  constructor(zm, devices, { transcoder = null, log = () => {} } = {}) {
    this.zm = zm;
    this.devices = devices;
    this.transcoder = transcoder;
    this.log = log;
    this.map = new Map();   // id -> player
    // GENA subscriptions: id -> { url, sid, expires }. callbackBase() is the
    // server's own address, set by index.js; without it there are no events
    // and the renderer is simply polled.
    this.subs = new Map();
    this.callbackBase = null;
    this.stopped = false;
  }

  stop() {
    this.stopped = true;
    for (const [id, s] of this.subs) { this.subs.delete(id); GENA.unsubscribe(s.url, s.sid); }
    for (const p of this.map.values()) if (isLocal(p.renderer)) p.renderer.halt();
  }

  // ------------------------------------------------------------ kept across a restart

  /* What the store keeps of this renderer's queue (lib/sonos/queue-store.js); null when empty. */
  saved(id) {
    const p = this.map.get(String(id || ""));
    if (!p || !p.queue.length) return null;
    return { kind: "upnp", ids: p.queue.map(it => it.trackId) };
  }

  /*
   * A queue kept from before a restart, back — with the device most likely
   * still playing the track it was given: its address is the same as before
   * (signed the same way), so the first read of the device finds it in the
   * queue and carries on from there, next track and all.
   */
  restore(snap, items) {
    const p = this.player(snap.id);
    p.queue = items.slice(0, QUEUE_MAX).map(it => this.toItem(it));
    p.index = Math.max(0, Math.min(p.queue.length - 1, Number(snap.index) || 0));
    p.next = null;
    p.shuffle = !!snap.shuffle;
    p.loop = ["disabled", "loop", "loop_one"].includes(snap.loop) ? snap.loop : "disabled";
    p.played = new Set(p.shuffle ? [p.index] : []);
    if (snap.volume) p.volume = { value: snap.volume.value == null ? null : snap.volume.value, muted: !!snap.volume.muted };
    const it = p.queue[p.index];
    // A sound device on this computer stopped with the server: it waits for play.
    const local = (this.record(p.id) || {}).kind === "local";
    this.zm.state.set(p.id, Object.assign(blankState(p.volume), {
      state: local ? "stopped" : ["playing", "paused", "stopped"].includes(snap.state) ? snap.state : "stopped",
      trackUri: it.uri, trackId: it.trackId, trackNumber: p.index + 1, queueLength: p.queue.length, onQueue: true,
      position: Math.max(0, Number(snap.seconds) || 0), duration: it.duration || 0,
      title: it.title, artist: it.artist, album: it.album, artUri: it.artUri, sent: it.sent,
      shuffle: p.shuffle, loop: p.loop, at: Date.now()
    }));
  }

  // ------------------------------------------------------------ events

  eventsOf(id) { const s = this.subs.get(String(id || "")); return s && s.expires > Date.now() ? "live" : null; }

  /* Subscribed to the renderer's AVTransport events, renewed in time. */
  async ensureSubscribed(p, rec) {
    if (!this.callbackBase || this.stopped) return;
    const url = rec.caps && rec.caps.events && rec.caps.events.AVTransport;
    if (!url) return;
    const s = this.subs.get(p.id);
    if (s && s.url === url && s.expires - Date.now() > 5 * 60 * 1000) return;
    if (p.subscribing) return;
    p.subscribing = true;
    try {
      const cb = `${this.callbackBase()}/upnp/event/${encodeURIComponent(p.id)}`;
      let next;
      if (s && s.url === url && s.expires > Date.now()) {
        try { next = await GENA.renew(url, s.sid); } catch (e) { next = await GENA.subscribe(url, cb); }
      } else next = await GENA.subscribe(url, cb);
      this.subs.set(p.id, { url, sid: next.sid, expires: next.expires });
      if (!s) this.log(`[renderers] ${rec.name || rec.network_name}: events on (${next.sid})`);
    } catch (e) {
      // No events from this one: it is polled, and asked again in a while.
      this.subs.set(p.id, { url, sid: "", expires: 0, failedAt: Date.now() });
    } finally { p.subscribing = false; }
  }

  /* A NOTIFY from the renderer: something changed — read it now. */
  onNotify(id, vars) {
    const p = this.map.get(String(id || ""));
    if (!p) return;
    p.lastEvent = { at: Date.now(), vars };
    if (p.notifyTimer) return;
    p.notifyTimer = setTimeout(() => { p.notifyTimer = null; this.poll(p, false).catch(() => {}); }, 150);
  }

  isUpnpId(id) { const s = String(id || ""); return s.startsWith("UPNP_") || s.startsWith(LocalDevices.PREFIX); }
  isStreamer(r) { return !!r && (r.kind === "upnp" || r.kind === "local"); }
  record(id) { return this.devices.registry.get(String(id || "")); }
  takesFlac(r) {
    const c = (r.caps && r.caps.advertised && r.caps.advertised.containers) || [];
    return !c.length || c.includes("flac");
  }
  // A renderer that can be played to right now.
  usable(r) { return !!(this.isStreamer(r) && r.caps && r.caps.playable && this.devices.enabled(r) && this.devices.online(r) && this.takesFlac(r)); }
  has(id) { return this.isUpnpId(id) && this.usable(this.record(id)); }

  player(id) {
    let p = this.map.get(id);
    if (!p) {
      p = { id, queue: [], index: -1, next: null, played: new Set(), shuffle: false, loop: "disabled",
        volume: { value: null, muted: false }, expectStop: false, noSetNext: false, strikes: 0,
        lastError: null, renderer: null, location: "" };
      // A sound device on this computer: its volume is Mandarin's own, kept in the register.
      const r = this.record(id);
      if (r && r.kind === "local") p.volume = { value: this.localVolume(r), muted: false };
      this.map.set(id, p);
    }
    return p;
  }

  get(id) {
    const r = this.record(id);
    if (!this.isStreamer(r)) { const e = new Error("No such device"); e.status = 404; throw e; }
    const name = r.name || r.network_name;
    if (!this.devices.enabled(r)) { const e = new Error(`${name} is switched off in Settings → Audio Devices`); e.status = 409; throw e; }
    if (!this.devices.online(r)) { const e = new Error(r.kind === "local" ? `${name} isn't connected to this computer` : `${name} isn't on the network`); e.status = 409; throw e; }
    if (!(r.caps && r.caps.playable)) { const e = new Error(`${name} can't be played to — it has no AVTransport service`); e.status = 409; throw e; }
    if (!this.takesFlac(r)) { const e = new Error(`${name} doesn't take FLAC, which is how Mandarin sends audio for now`); e.status = 409; throw e; }
    return this.player(id);
  }

  renderer(p) {
    const r = this.record(p.id) || {};
    if (!p.renderer || p.location !== (r.location || "")) {
      if (isLocal(p.renderer)) p.renderer.halt();
      p.renderer = r.kind === "local" ? this.localOutput(p, r)
        : new Renderer({ id: p.id, name: r.name || r.network_name || p.id, services: (r.caps && r.caps.services) || {} });
      p.location = r.location || "";
    }
    return p.renderer;
  }

  // A sound device on this computer; its volume is kept in the register.
  localOutput(p, r) {
    const common = {
      id: p.id, name: r.name || r.network_name || p.id, log: this.log,
      volume: this.localVolume(r),
      fixed: () => this.fixedVolume(this.record(p.id)),
      // The stream is this server's own: fetched over loopback, whatever address it was given out at.
      source: (u) => this.localBase ? String(u).replace(/^https?:\/\/[^/]+/, this.localBase()) : u
    };
    // Mandarin's audio engine where it is here and plays this device (v0.8.0);
    // otherwise as before. A test's own device opener keeps the old path.
    const eng = !this.sinkArgsFor && ENGINE.plays(r.location) ? ENGINE.engine({ dataDir: this.dataDir }) : null;
    const o = eng
      ? new ENGINE.EngineOutput(Object.assign({ location: r.location, bin: eng.bin }, common))
      : new LocalOutput(Object.assign({ sinkArgs: this.sinkArgsFor ? this.sinkArgsFor(r.location) : LocalDevices.sinkArgsFor(r.location) }, common));
    p.volume = { value: o.volume, muted: false };
    return o;
  }
  localVolume(r) { const v = r.settings && r.settings.local_volume; return Number.isFinite(v) ? v : 50; }

  fixedVolume(r) {
    if (!r) return false;
    if (r.kind === "local") return !!(r.settings && r.settings.volume === "fixed");
    if (r.settings && r.settings.volume) return r.settings.volume === "fixed";
    return effective(r).profile.volume === "fixed";
  }

  /* The ceiling the stream plan works to: what the device's page shows as on. */
  targetFor(id) {
    const r = this.record(id);
    if (!this.isStreamer(r)) return null;
    const caps = effective(Object.assign({ playable: !!(r.caps && r.caps.playable) }, r));
    const rates = caps.rates.filter(x => x.on).map(x => x.hz);
    const bits = caps.bits.filter(x => x.on).map(x => x.n);
    const s = r.settings || {};
    // 32-bit output only where this ffmpeg writes 32-bit FLAC (lib/ffmpeg.js).
    const most = bits.length ? Math.max(...bits) : 24;
    const maxBits = Math.min(most, FF.info().flac32 ? 32 : 24);
    // DSD (v0.6.0-RC3): the multiples on its page, and the DSD types it names
    // itself, so the file is announced to it in its own words.
    const dsd = caps.dsd.filter(x => x.on).map(x => x.n);
    const mimes = (r.caps && r.caps.advertised && r.caps.advertised.mimes) || [];
    const dsdMimes = {
      dsf: mimes.find(m => /^audio\/(x-)?dsf$/.test(m)) || mimes.find(m => /^audio\/(x-)?dsd$/.test(m)) || null,
      dff: mimes.find(m => /^audio\/(x-)?dff$/.test(m)) || mimes.find(m => /^audio\/(x-)?dsd$/.test(m)) || null
    };
    return {
      name: r.name || r.network_name, rates, maxBits, containers: caps.containers, dsd, dsdMimes,
      mode: ["original", "x2", "x4", "max"].includes(s.mode) ? s.mode : "original",
      bits: s.bits === 24 || s.bits === 32 ? s.bits : "auto",
      // The zone's DSP (lib/dsp.js), for the conversion; null when off.
      dsp: this.devices.dspFor ? this.devices.dspFor(id) : null,
      id: r.id
    };
  }

  /*
   * The settings changed (output, DSP): what follows in the queue is planned
   * again — new addresses, the device told its next track afresh. The track
   * playing carries on as it was given; the change is heard from the next.
   */
  replan(id) {
    const p = this.map.get(String(id || ""));
    if (!p || !p.queue.length || !this.zm.rebuildItems) return false;
    const ids = p.queue.map(it => it.trackId);
    const items = this.zm.rebuildItems(ids.filter(x => x != null), id);
    if (items.length !== p.queue.length) return false;
    p.queue = items.map(it => this.toItem(it));
    p.next = null;
    return true;
  }

  // ------------------------------------------------------------ zones

  zones() {
    const out = [];
    for (const r of this.devices.registry.all()) {
      if (!this.usable(r)) continue;
      const p = this.player(r.id);
      const st = this.zm.state.get(r.id) || blankState(p.volume);
      out.push({
        zone_id: r.id,
        display_name: r.network_name,
        state: st.state || "stopped",
        settings: { shuffle: !!st.shuffle, loop: st.loop || "disabled", auto_radio: false },
        outputs: [this.outputJson(r, p, st)],
        is_upnp: true,
        is_local: r.kind === "local",
        _state: st,
        _group: null
      });
    }
    return out;
  }

  outputJson(r, p, st) {
    const v = st.volume || p.volume || {};
    return {
      output_id: r.id,
      zone_id: r.id,
      display_name: r.network_name,
      model: r.model || "",
      stereo_pair: false,
      is_muted: !!v.muted,
      // Fixed on the device (a Poly feeds a Mojo, whose knob is the volume):
      // no slider, the shape Roon uses for such an output.
      volume: this.fixedVolume(r) ? null : {
        type: "number", min: 0, max: 100, step: 1, value: v.value == null ? null : v.value, soft_limit: 100, is_muted: !!v.muted
      },
      can_group_with_output_ids: [r.id],
      source_controls: []
    };
  }

  queue(id) {
    const p = this.get(id);
    return {
      items: p.queue.map((it, i) => ({
        position: i + 1, uri: it.uri, trackId: it.trackId, title: it.title, artist: it.artist,
        album: it.album, artUri: it.artUri, duration: it.duration
      })),
      total: p.queue.length,
      current: p.index + 1
    };
  }

  trackIds(id) { return this.get(id).queue.map(it => it.trackId).filter(Boolean); }
  errorOf(id) { const p = this.map.get(String(id || "")); return p ? p.lastError : null; }
  drop(id) {
    const p = this.map.get(id);
    if (p && isLocal(p.renderer)) p.renderer.halt();
    this.map.delete(id); this.zm.state.delete(id);
    const s = this.subs.get(id);
    if (s) { this.subs.delete(id); if (s.sid) GENA.unsubscribe(s.url, s.sid); }
  }

  // ------------------------------------------------------------ polling

  async pollAll(tick, hot) {
    await Promise.all([...this.map.values()].map(async (p) => {
      const r = this.record(p.id);
      if (!r || !this.devices.online(r)) return;
      const st = this.zm.state.get(p.id);
      const watched = Date.now() - ((hot && hot.get(p.id)) || 0) < HOT_MS;
      const playing = !!st && (st.state === "playing" || st.state === "loading");
      const sub = this.subs.get(p.id);
      const evented = !!(sub && sub.expires > Date.now());
      if (!(sub && sub.failedAt && Date.now() - sub.failedAt < 10 * 60 * 1000)) this.ensureSubscribed(p, r).catch(() => {});
      // Evented and unwatched: the device says when things change, so a
      // playing one is only read every few seconds, for its position.
      if (!watched && (!playing || evented) && tick % 5 !== 0) return;
      await this.poll(p, watched || tick % 5 === 0).catch(e => this.log(`[renderers] ${p.id}: ${e.message}`));
    }));
  }

  async poll(p, withVolume) {
    const r = this.renderer(p);
    const rec = this.record(p.id);
    const prev = this.zm.state.get(p.id) || blankState(p.volume);
    let ti, pi;
    try {
      [ti, pi] = await Promise.all([r.getTransportInfo(), r.getPositionInfo()]);
    } catch (e) {
      if (!prev.unreachable) { prev.unreachable = true; this.zm.state.set(p.id, prev); this.zm.bump(); }
      return;
    }
    // A sound device on this computer says what went wrong itself.
    const failed = r.takeError ? r.takeError() : null;
    if (failed) { this.fail(p, failed); return; }
    if (withVolume && !this.fixedVolume(rec)) {
      try {
        const [value, muted] = await Promise.all([r.getVolume(), r.getMute()]);
        p.volume = { value, muted };
      } catch (e) { /* the last reading stands */ }
    }
    // Answering is being on the network: the register's last_seen follows,
    // so a playing device never reads "offline" because a multicast search
    // went unanswered.
    // (A sound device on this computer always answers, being in this
    // process; whether it is still plugged in, the device scan says.)
    if (rec && rec.kind !== "local" && Date.now() - (p.touchedAt || 0) > 30000) { p.touchedAt = Date.now(); this.devices.registry.touch(p.id); }
    const tstate = STATE[ti.CurrentTransportState] || "stopped";
    const uri = pi.TrackURI || "";
    const idx = uri ? this.indexOfUri(p, uri) : -1;
    // The renderer moved on by itself: SetNextAVTransportURI honoured.
    if (idx >= 0 && idx !== p.index) { p.index = idx; p.next = null; p.strikes = 0; if (p.shuffle) p.played.add(idx); }
    const item = p.index >= 0 ? p.queue[p.index] : null;

    // Stopped at the end of a track with more to play: the renderer does not
    // take a next URI (or was never given one in time) — start it by hand.
    // A device still starting a track may say STOPPED for a moment while it
    // buffers; that is given eight seconds. One that stops before ever
    // playing three times running is not taking what it is sent; that is
    // reported rather than looped.
    if (tstate === "stopped" && !p.expectStop && item && (prev.state === "playing" || prev.state === "loading")) {
      if (prev.state === "loading" && Date.now() - (p.loadingSince || 0) < 8000) return;
      p.strikes = prev.state === "loading" ? p.strikes + 1 : 0;
      const n = this.nextIndex(p);
      if (p.strikes >= 3) {
        this.fail(p, new Error(`${r.name} stops as soon as each track starts — it may not take what it is sent`));
      } else if (n >= 0) {
        if (p.next && p.next.sent && !p.noSetNext) { p.noSetNext = true; this.log(`[renderers] ${r.name}: ignored SetNextAVTransportURI; tracks are started by hand`); }
        this.jump(p, n).catch(e => this.fail(p, e));
        return;
      }
    }
    if (tstate === "stopped") p.expectStop = false;
    if (tstate === "playing") { p.strikes = 0; p.lastError = null; }

    const next = Object.assign(blankState(p.volume), {
      state: tstate,
      trackUri: item ? item.uri : uri,
      trackId: item ? item.trackId : this.zm.trackIdFromUri(uri),
      trackNumber: item ? p.index + 1 : 0,
      queueLength: p.queue.length,
      onQueue: p.queue.length > 0,
      position: DIDL.toSeconds(pi.RelTime),
      duration: DIDL.toSeconds(pi.TrackDuration) || (item ? item.duration : 0) || 0,
      title: item ? item.title : "",
      artist: item ? item.artist : "",
      album: item ? item.album : "",
      artUri: item ? item.artUri : "",
      shuffle: p.shuffle, loop: p.loop,
      mediaUri: uri,
      sent: item ? item.sent : null,
      at: Date.now(),
      unreachable: false
    });
    this.zm.applyState(p.id, prev, next);
    if (tstate === "playing" && item && !p.noSetNext) this.armNext(p).catch(() => {});
    if (tstate === "playing" && item) this.verify(p, item).catch(() => {});
  }

  /*
   * What the device says it is really playing. A WiiM's own API reports the
   * rate and depth its decoder is running; when they match what was sent,
   * that rate and depth are marked verified on its page, and the Now playing
   * badge gets its tick. Asked once per track, a few seconds in.
   */
  async verify(p, item) {
    const rec = this.record(p.id);
    if (rec && rec.kind === "local") return this.verifyLocal(p, rec, item);
    const lp = rec && rec.caps && rec.caps.linkplay;
    if (!lp || !lp.base || !item.sent || !item.sent.rate || item.sent.dsd) return;
    const key = p.index + ":" + item.uri;
    if (p.verifying === key) return;
    const st = this.zm.state.get(p.id) || {};
    if ((st.position || 0) < 2) return;
    p.verifying = key;
    let meta = null;
    try { meta = await LinkPlay.command(lp.base, "getMetaInfo"); } catch (e) { meta = null; }
    const m = meta && meta.metaData;
    if (!m) return;
    const rate = Number(m.sampleRate) || 0, bits = Number(m.bitDepth) || 0;
    const ok = rate === item.sent.rate && (!bits || !item.sent.bits || bits === item.sent.bits);
    const now = this.zm.state.get(p.id);
    if (now && now.trackUri === item.uri) { now.verified = ok ? "yes" : "no"; this.zm.bump(); }
    if (ok) this.devices.registry.markVerified(p.id, { rate, bits: bits || item.sent.bits });
    else {
      p.lastError = { at: Date.now(), message: `Sent ${item.sent.bits}-bit/${item.sent.rate / 1000} kHz, the device reports ${bits || "?"}-bit/${rate / 1000} kHz` };
      this.log(`[renderers] ${rec.name || rec.network_name}: ${p.lastError.message}`);
    }
  }

  /*
   * A sound device on Linux: ALSA says the rate the device is open at
   * (/proc/asound/…/hw_params) — the same as sent, and it is confirmed.
   */
  async verifyLocal(p, rec, item) {
    const o = this.renderer(p);
    if (!item.sent || !item.sent.rate || !o.sink) return;
    const key = p.index + ":" + item.uri;
    if (p.verifying === key) return;
    const st = this.zm.state.get(p.id) || {};
    if ((st.position || 0) < 2) return;
    p.verifying = key;
    const hw = this.hwParams ? this.hwParams(rec.location) : LocalDevices.hwParams(rec.location);
    if (!hw || !hw.rate) return;
    const ok = hw.rate === o.sink.rate && o.sink.rate === item.sent.rate;
    const now = this.zm.state.get(p.id);
    if (now && now.trackUri === item.uri) { now.verified = ok ? "yes" : "no"; this.zm.bump(); }
    if (ok) this.devices.registry.markVerified(p.id, { rate: hw.rate });
  }

  indexOfUri(p, uri) {
    const from = Math.max(0, p.index);
    const scan = (test) => {
      for (let i = from; i < p.queue.length; i++) if (test(p.queue[i])) return i;
      for (let i = 0; i < from; i++) if (test(p.queue[i])) return i;
      return -1;
    };
    const exact = scan(it => it.uri === uri);
    if (exact >= 0) return exact;
    // Re-encoded by the device: the track id still says which.
    const id = this.zm.trackIdFromUri(uri);
    return id ? scan(it => it.trackId === id) : -1;
  }

  nextIndex(p) {
    if (!p.queue.length) return -1;
    if (p.loop === "loop_one") return p.index;
    if (p.shuffle) {
      let cands = p.queue.map((_, i) => i).filter(i => i !== p.index && !p.played.has(i));
      if (!cands.length && p.loop === "loop" && p.queue.length > 1) { p.played = new Set([p.index]); cands = p.queue.map((_, i) => i).filter(i => i !== p.index); }
      return cands.length ? cands[Math.floor(Math.random() * cands.length)] : -1;
    }
    const n = p.index + 1;
    if (n < p.queue.length) return n;
    return p.loop === "loop" ? 0 : -1;
  }

  // The next file must be complete before the renderer is told about it, so
  // it always sees a length and byte ranges for it.
  ready(it) {
    if (!it.plan || !it.plan.transcode || !it.track || !this.transcoder) return true;
    const s = this.transcoder.status(it.track, it.plan);
    if (s === "none") this.transcoder.prefetch([{ track: Object.assign({}, it.track), plan: it.plan }]);
    return s === "ready";
  }

  // p.next is what the device holds as its next URI (null once it is used,
  // or after SetAVTransportURI). Whenever what SHOULD follow differs — the
  // queue was edited, the mode changed — the device is told again.
  async armNext(p) {
    const n = this.nextIndex(p);
    if (n < 0) {
      // Nothing follows any more (the queue shrank): withdraw what was set.
      if (p.next && p.next.sent) { p.next = null; await this.renderer(p).setNextUri("", "").catch(() => {}); }
      return;
    }
    const it = p.queue[n];
    if (p.next && p.next.sent && p.next.uri === it.uri) return;
    if (!this.ready(it)) return;
    try {
      await this.renderer(p).setNextUri(it.uri, it.meta);
      p.next = { index: n, uri: it.uri, sent: true };
    } catch (e) {
      p.next = null;
      if (NOT_SUPPORTED.has(Number(e.code))) {
        p.noSetNext = true;
        this.log(`[renderers] ${this.renderer(p).name}: no SetNextAVTransportURI (${e.message}); tracks are started by hand`);
      }
    }
  }

  async jump(p, index, seconds = 0) {
    const it = p.queue[index];
    if (!it) throw new Error("Nothing to play");
    const r = this.renderer(p);
    p.expectStop = false;
    p.next = null;              // SetAVTransportURI clears a renderer's next
    p.index = index;
    p.loadingSince = Date.now();
    if (p.shuffle) p.played.add(index);
    this.optimistic(p.id, {
      state: "loading", trackNumber: index + 1, queueLength: p.queue.length, onQueue: true,
      trackUri: it.uri, trackId: it.trackId, title: it.title, artist: it.artist, album: it.album, artUri: it.artUri,
      duration: it.duration, position: seconds, sent: it.sent, unreachable: false
    });
    await r.setUri(it.uri, it.meta);
    await r.play();
    if (seconds > 0) await r.seekTime(seconds).catch(() => {});
  }

  fail(p, e) {
    p.lastError = { at: Date.now(), message: e.message };
    this.log(`[renderers] ${p.id}: ${e.message}`);
    this.optimistic(p.id, { state: "stopped" });
  }

  pokeAfter(p) {
    const t = setTimeout(() => this.poll(p, false).catch(() => {}), 300);
    t.unref();
  }

  // Straight away, before the renderer is read back, so the page doesn't lag.
  optimistic(id, patch) {
    const st = this.zm.state.get(id) || blankState();
    Object.assign(st, patch, { at: Date.now() });
    this.zm.state.set(id, st);
    this.zm.bump();
  }

  // ------------------------------------------------------------ commands

  // Items arrive as Playback builds them — { uri, meta, track, plan } — and
  // the player keeps plain fields beside them.
  toItem(it) {
    if (it.upnp) return it.upnp;
    const m = DIDL.parseItems(it.meta || "")[0] || {};
    const t = it.track || null;
    const p = it.plan || null;
    return {
      uri: it.uri, meta: it.meta || "", track: t, plan: p,
      trackId: t ? t.id : this.zm.trackIdFromUri(it.uri),
      title: m.title || (t && t.title) || "",
      artist: m.artist || (t && t.artist) || "",
      album: m.album || (t && t.album) || "",
      artUri: m.artUri || "",
      duration: m.duration || (t && t.duration) || 0,
      // What the stream carries, for the Now playing badge.
      sent: p ? {
        transcode: !!p.transcode,
        rate: p.transcode ? p.rate : Number((t && t.sample_rate) || 0),
        bits: p.transcode ? p.bits : Number((t && t.bits) || 0),
        upsampled: p.upsampled || 0,
        dsp: !!p.dsp,
        dsd: p.dsd || 0,
        ext: p.ext || "", mime: p.mime || ""
      } : null
    };
  }

  async enqueue(id, items, how, { startAt = 0, seconds = 0 } = {}) {
    const p = this.get(id);
    const list = items.slice(0, QUEUE_MAX).map(it => this.toItem(it));
    if (!list.length) throw new Error("Nothing to play");
    const st = this.zm.state.get(id) || {};
    const idle = !p.queue.length || p.index < 0 || st.state === "stopped";
    if (how === "play_now" || (how !== "queue" && !p.queue.length)) {
      p.queue = list;
      p.played = new Set();
      const index = Math.max(0, Math.min(list.length - 1, startAt));
      await this.jump(p, index, seconds);
    } else if (how === "add_next") {
      // p.next still says what the device holds; the next poll replaces it.
      const at = p.index >= 0 ? Math.min(p.queue.length, p.index + 1) : 0;
      p.queue.splice(at, 0, ...list);
      if (idle) await this.jump(p, at);
      else this.optimistic(id, { queueLength: p.queue.length, onQueue: true });
    } else {
      const at = p.queue.length;
      p.queue.push(...list);
      if (idle) await this.jump(p, at);
      else this.optimistic(id, { queueLength: p.queue.length, onQueue: true });
    }
    this.zm.persist(id);
    this.pokeAfter(p);
    return { queued: list.length };
  }

  async control(id, command) {
    const p = this.get(id);
    const r = this.renderer(p);
    const st = this.zm.state.get(id) || {};
    switch (command) {
      case "play":
        if (p.index < 0 && p.queue.length) { await this.jump(p, 0); break; }
        if (st.state === "stopped" && p.queue[p.index]) { await this.jump(p, p.index); break; }
        await r.play();
        this.optimistic(id, { state: "playing", position: this.zm.positionNow(st) });
        break;
      case "pause":
        await r.pause();
        this.optimistic(id, { state: "paused", position: this.zm.positionNow(st) });
        break;
      case "stop":
        p.expectStop = true;
        await r.stop();
        this.optimistic(id, { state: "stopped", position: 0 });
        break;
      case "next": {
        const n = this.nextIndex(p);
        if (n < 0) throw new Error("Nothing after this");
        await this.jump(p, n);
        break;
      }
      case "previous":
        // Back to the start of this track first, as every player does.
        if (this.zm.positionNow(st) > 5 || p.index <= 0) { await r.seekTime(0); this.optimistic(id, { position: 0 }); }
        else await this.jump(p, p.index - 1);
        break;
      case "playpause":
        return this.control(id, st.state === "playing" || st.state === "loading" ? "pause" : "play");
      default: throw new Error("unknown command " + command);
    }
    this.pokeAfter(p);
  }

  async seek(id, how, seconds) {
    const p = this.get(id);
    const st = this.zm.state.get(id) || {};
    const target = Math.max(0, how === "relative" ? this.zm.positionNow(st) + Number(seconds) : Number(seconds));
    await this.renderer(p).seekTime(target);
    this.optimistic(id, { position: target });
    this.pokeAfter(p);
  }

  async playFromHere(id, position) {
    const p = this.get(id);
    const i = Number(position) - 1;
    if (!p.queue[i]) throw new Error("No such track in the queue");
    await this.jump(p, i);
    this.pokeAfter(p);
  }

  async removeFromQueue(id, position) {
    const p = this.get(id);
    const i = Number(position) - 1;
    if (i < 0 || i >= p.queue.length) return;
    const wasCurrent = i === p.index;
    p.queue.splice(i, 1);
    if (i < p.index) p.index--;
    if (wasCurrent) {
      if (p.queue[i]) await this.jump(p, i);
      else {
        p.index = p.queue.length - 1;
        p.expectStop = true;
        await this.renderer(p).stop().catch(() => {});
        this.optimistic(id, { state: "stopped", position: 0 });
      }
    }
    this.optimistic(id, { queueLength: p.queue.length, onQueue: p.queue.length > 0, trackNumber: p.index + 1 });
    this.zm.persist(id);
  }

  async moveAfterCurrent(id, positions) {
    const p = this.get(id);
    const plan = planMoves(p.queue.length, p.index + 1, positions);
    if (plan.moves.length) {
      p.queue = plan.order.map(i => p.queue[i - 1]);
      p.index = plan.current - 1;
      p.next = null;   // the device's own next is read again at the next poll
      this.optimistic(id, { queueLength: p.queue.length, trackNumber: p.index + 1 });
      this.zm.persist(id);
    }
    return plan;
  }

  async clearQueue(id) {
    const p = this.get(id);
    p.queue = []; p.index = -1; p.next = null; p.played = new Set();
    p.expectStop = true;
    await this.renderer(p).stop().catch(() => {});
    this.zm.state.set(id, blankState(p.volume));
    this.zm.bump();
    this.zm.persist(id);
  }

  async setSettings(id, { shuffle, loop }) {
    const p = this.get(id);
    if (shuffle != null) { p.shuffle = !!shuffle; p.played = new Set(p.index >= 0 ? [p.index] : []); }
    if (loop != null && ["disabled", "loop", "loop_one"].includes(loop)) p.loop = loop;
    this.optimistic(id, { shuffle: p.shuffle, loop: p.loop });
  }

  async setVolume(id, how, value) {
    const p = this.get(id);
    const rec = this.record(id);
    if (this.fixedVolume(rec)) throw new Error(`${rec.name || rec.network_name}'s volume is set on the device itself`);
    const cur = p.volume.value || 0;
    const target = Math.max(0, Math.min(100, Math.round(how === "relative" || how === "relative_step" ? cur + Number(value) : Number(value))));
    await this.renderer(p).setVolume(target);
    p.volume = { value: target, muted: !!p.volume.muted };
    if (rec.kind === "local") this.devices.registry.setSettings(id, { local_volume: target });
    this.optimistic(id, { volume: p.volume });
  }

  async setMute(id, muted) {
    const p = this.get(id);
    const rec = this.record(id);
    if (this.fixedVolume(rec)) throw new Error(`${rec.name || rec.network_name}'s volume is set on the device itself`);
    await this.renderer(p).setMute(!!muted);
    p.volume = { value: p.volume.value, muted: !!muted };
    this.optimistic(id, { volume: p.volume });
  }

  async pauseAll() {
    for (const p of this.map.values()) {
      const st = this.zm.state.get(p.id);
      if (st && (st.state === "playing" || st.state === "loading")) await this.renderer(p).pause().catch(() => {});
    }
  }
}

function blankState(volume) {
  return {
    state: "stopped", trackUri: "", trackId: null, trackNumber: 0, queueLength: 0, onQueue: false,
    position: 0, duration: 0, title: "", artist: "", album: "", artUri: "", streamContent: "",
    shuffle: false, loop: "disabled", playMode: "NORMAL", mediaUri: "", sent: null, at: Date.now(), unreachable: false,
    volume: volume || { value: null, muted: false }
  };
}

module.exports = { UpnpPlayers, blankState };
