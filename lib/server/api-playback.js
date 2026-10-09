"use strict";
/*
 * api-playback.js — rooms, transport, volume, the queue, and putting albums
 * and tracks on a speaker. Shapes follow MusicD Remote's /api, which was
 * written against Roon's zone model; zones.js maps Sonos onto it.
 */
const { normaliseKind } = require("./playback");
const { Artwork } = require("../library/artwork");
const N = require("../library/normalize");
const { formatName } = require("../library/index");

module.exports = function mountPlayback(app, ctx) {
  const { zones, library, playback, features } = ctx;

  const need = (v, msg) => { if (v === undefined || v === null || v === "") { const e = new Error(msg); e.status = 400; throw e; } return v; };
  const wrap = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (e) { res.status(e.status || 500).json({ error: e.message || String(e) }); }
  };

  /*
   * The format badge on Now playing: what the zone is actually hearing, kept
   * simple. A phone playing the server's Opus says so (Opus 256 kbps — or just
   * Opus for a file that was Opus already, sent as it is); a lossless file is
   * "Lossless" whatever its rate — also on Sonos, where hi-res goes out as
   * 24-bit/48 kHz, still lossless; a lossy file names its codec ("MP3").
   */
  function formatOf(z, st, t) {
    const f = formatOfInner(z, st, t);
    // The phone's USB driver feeding the DAC itself (Stage 9.2): the depth and
    // rate the DAC is given, and the tick — bit-perfect when the DSP is off.
    if (z.is_phone && st.usb && f) {
      const usb = String(st.usb);
      // Native DSD ("dsd64") or DSD over PCM ("dop64"), Stage 9.3: never through the DSP.
      const m = /^(dsd|dop)(\d+)$/.exec(usb);
      if (m) return { kind: f.kind, text: f.text + (m[1] === "dop" ? ` · USB DoP DSD${m[2]} ✓` : ` · USB DSD${m[2]} ✓`) };
      const [hz, bits] = usb.split("/");
      return { kind: f.kind, text: f.text + ` · USB ${bits}/${Number(hz) / 1000}` + (st.dsp ? "" : " ✓") };
    }
    return f;
  }
  function formatOfInner(z, st, t) {
    const dspTag = z.is_phone && st.dsp ? " · DSP" : "";
    // The phone's own file: what its extension says.
    if (z.is_phone && st.local) {
      const ext = String(st.localExt || "").toLowerCase();
      if (!ext) return st.dsp ? { kind: "lossless", text: "DSP" } : null;
      const lossless = ["flac", "wav", "aif", "aiff", "alac", "wv", "ape"].includes(ext);
      return lossless ? { kind: "lossless", text: "Lossless" + dspTag } : { kind: "lossy", text: ext.toUpperCase() + dspTag };
    }
    if (!t) return null;
    // The server's Opus 256, decoded on the phone to float ("opus24", the
    // app's libopus) or by Android's own decoder to 16-bit ("opus").
    if (z.is_phone && (st.format === "opus" || st.format === "opus24")) {
      return { kind: "opus", text: (/\.opus$/i.test(t.path || "") ? "" : st.format === "opus24" ? "256 · 24/48" : "256kbps") + dspTag };
    }
    if (z.is_phone && dspTag) {
      const name = formatName(t.container, false) || String(t.codec || "").toUpperCase();
      return t.lossless ? { kind: "lossless", text: "Lossless" + dspTag } : (name ? { kind: "lossy", text: name + dspTag } : null);
    }
    // A renderer is told exactly what it gets: the file's own container,
    // depth and rate, or the FLAC it was converted to.
    if (z.is_upnp && st.sent) {
      const s = st.sent;
      const khz = hz => (hz ? String(hz / 1000) : "");
      const tick = st.verified === "yes" ? " ✓" : "";
      // DSD as it is (v0.6.0-RC3): the file itself, at its multiple.
      if (!s.transcode && s.dsd) return { kind: "lossless", text: `DSD${s.dsd}` };
      if (s.transcode) return { kind: "lossless", text: `FLAC ${s.bits}/${khz(s.rate)}${s.upsampled ? ` ↑×${s.upsampled}` : ""}${s.dsp ? " · DSP" : ""}${tick}` };
      const name = formatName(t.container, false) || String(t.codec || "").toUpperCase();
      if (t.lossless) return { kind: "lossless", text: [name || "Lossless", s.bits && s.rate ? `${s.bits}/${khz(s.rate)}` : ""].filter(Boolean).join(" ") + tick };
      return name ? { kind: "lossy", text: name } : null;
    }
    if (t.lossless) return { kind: "lossless", text: "Lossless" };
    const name = formatName(t.container, false) || String(t.codec || "").toUpperCase();
    return name ? { kind: "lossy", text: name } : null;
  }

  // What the page draws for a zone's current track.
  function nowPlaying(z) {
    const st = z._state || {};
    if (!st.trackUri && !st.title) return null;
    const t = st.trackId ? library.track(st.trackId) : null;
    const al = t ? library.album(t.album_id) : null;
    const line1 = (t && t.title) || st.title || st.streamContent || "";
    const line2 = (t && t.artist) || st.artist || "";
    const line3 = (al && al.title) || st.album || "";
    // The phone's own music (st.local): its cover and album are the phone's,
    // named so the app answers them itself ("phone-…", "phone:…").
    const image_key = st.imageKey || (al ? al.image_key : (st.artUri ? Artwork.foreignKey(st.artUri) : null));
    return {
      line1, line2, line3,
      artists: N.splitArtists(line2).map(name => ({ name, linkable: library.artistKeys.has(N.fold(name)) })),
      image_key,
      length: st.duration || (t && Math.round(t.duration)) || null,
      seek_position: Math.round(zones.positionNow(st)),
      // Not in Roon's shape: what the speaker is actually being sent, for the
      // format line on Now playing.
      track_id: t ? t.id : null,
      album_offset: st.albumOffset || (al ? al.id : null),
      format: formatOf(z, st, t)
    };
  }

  /*
   * A phone zone is the Android app's player. The phone always sees itself
   * ("This phone"). Since v0.5.51 every other device at home — another
   * phone, a browser, the iPhone home-screen app — sees it too, under its
   * own name, and can play to it: while the app is running there, the phone
   * is at home, and its "Other devices can play here" switch is on.
   * Before, a phone was only ever a player for itself.
   *
   * Away from home (any request not from the home network — Tailscale
   * included) the Sonos rooms don't exist either: the app away is a player
   * for the phone it's on, nothing more, and nothing away can reach a room.
   */
  const myDevice = req => (ctx.auth && ctx.auth.deviceOf(req)) || null;
  const away = req => !!(ctx.auth && ctx.auth.isAway(req));
  const ownPhone = req => { const d = myDevice(req); return d ? zones.phones.constructor.uidFor(d.id) : null; };
  // Yours to see: a phone only by itself; a room or renderer at home, and
  // only while it is switched on in Settings → Audio Devices.
  const shown = z => !ctx.devices || ctx.devices.zoneShown(z);
  // Another device's phone: at home both, and shared by its owner.
  const reachable = (id, req) => !away(req) && !zones.phones.isAway(id) && (!ctx.devices || ctx.devices.shared(id));
  const own = (z, req) => (myDevice(req) || {}).id === z.device_id;
  const mine = (z, req) => z.is_phone ? (own(z, req) || reachable(z.zone_id, req)) : !away(req) && shown(z);
  const PHONE_FIELDS = ["zone", "zone_or_output_id", "output_id", "zone_id", "from", "to", "from_zone", "to_zone"];
  const HOME_ONLY = ["/pause-all", "/mute-all", "/group-outputs", "/ungroup-outputs", "/transfer-zone"];
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/phone/") || req.path.startsWith("/auth/")) return next();
    const own = ownPhone(req);
    const b = req.body || {};
    const ids = PHONE_FIELDS.flatMap(k => [req.query[k], b[k]]).concat(Array.isArray(b.output_ids) ? b.output_ids : [])
      .filter(id => id !== undefined && id !== null && id !== "").map(String);
    if (ids.some(id => zones.phones.isPhoneId(id) && id !== own && !reachable(id, req))) {
      return res.status(403).json({ error: "That phone isn't playing for other devices right now" });
    }
    if (away(req) && (HOME_ONLY.includes(req.path) || ids.some(id => id !== own))) {
      return res.status(403).json({ error: "Away from home, only this phone plays", away: true });
    }
    next();
  });

  /*
   * Names as the page shows them. A phone is only ever seen by itself, as
   * "This phone". A room you renamed in Settings → Audio Devices wears that
   * name here — an overlay over the speaker's own, which is never written to —
   * and a group is named from its rooms the way the Sonos code names it: the
   * coordinator first, "A + B", or "A + 2".
   */
  const customName = id => (ctx.devices && ctx.devices.nameOf(id)) || null;
  const renamed = z => !z.is_phone && (z.outputs || []).some(o => customName(o.output_id));
  function zoneName(z) {
    if (!renamed(z)) return z.display_name;
    const coord = z._group ? z._group.coordinator.uid : z.zone_id;
    const names = z.outputs.map(o => ({ id: o.output_id, name: customName(o.output_id) || o.display_name }))
      .sort((a, b) => (a.id === coord ? -1 : b.id === coord ? 1 : a.name.localeCompare(b.name)))
      .map(x => x.name);
    return names.length <= 2 ? names.join(" + ") : `${names[0]} + ${names.length - 1}`;
  }
  function nameFor(z, req) {
    return z.is_phone ? (own(z, req) ? "This phone" : z.display_name) : zoneName(z);
  }
  function named(z, req) {
    if (z.is_phone && !own(z, req)) return z;      // another phone: its own name
    if (!z.is_phone && !renamed(z)) return z;
    const name = nameFor(z, req);
    return Object.assign({}, z, {
      display_name: name,
      outputs: z.outputs.map(o => Object.assign({}, o, { display_name: z.is_phone ? name : (customName(o.output_id) || o.display_name) }))
    });
  }
  function namedOutput(o) {
    const z = zones.zone(o.output_id);
    return Object.assign({}, o, {
      display_name: customName(o.output_id) || o.display_name,
      zone_name: z ? zoneName(z) : o.zone_name
    });
  }

  function zoneJson(z) {
    const st = z._state || {};
    const onQueue = !!st.onQueue;
    return {
      zone_id: z.zone_id,
      display_name: z.display_name,
      state: st.state || "stopped",
      is_play_allowed: st.state !== "playing",
      is_pause_allowed: st.state === "playing" || st.state === "loading",
      is_next_allowed: onQueue ? (st.trackNumber < st.queueLength || st.loop !== "disabled" || st.shuffle) : false,
      is_previous_allowed: onQueue || !!st.trackUri,
      is_seek_allowed: !!st.duration,
      settings: z.settings,
      outputs: z.outputs.map(o => ({
        output_id: o.output_id, display_name: o.display_name, is_muted: o.is_muted, volume: o.volume
      })),
      now_playing: nowPlaying(z)
    };
  }

  app.get("/api/zones", (req, res) => {
    res.json({
      away: away(req),
      zones: zones.zones().filter(z => mine(z, req)).map(z => named(z, req)).map(z => ({
        zone_id: z.zone_id, display_name: z.display_name, state: z.state,
        settings: z.settings, outputs: z.outputs, is_phone: !!z.is_phone
      }))
    });
  });

  app.get("/api/outputs", (req, res) => res.json({
    outputs: away(req) ? [] : zones.outputs().filter(o => !ctx.devices || ctx.devices.isEnabled(o.output_id)).map(namedOutput)
  }));
  app.get("/api/shortcut/zones", (req, res) => {
    const last = ctx.db.setting("lastZone", null);
    const list = zones.zones().filter(z => mine(z, req));
    res.json({
      zones: list.map(z => ({ zone_id: z.zone_id, display_name: nameFor(z, req), state: z.state, is_phone: !!z.is_phone })),
      last_zone: last && list.some(z => z.zone_id === last) ? last : ((list.find(z => z.state === "playing") || list[0] || {}).zone_id || null)
    });
  });

  /*
   * Zone state, optionally waited for: with ?wait_for=<revision> it answers the
   * moment something changes (or after ~20s), so a page can hold one request
   * open instead of polling.
   */
  app.get("/api/zone-state", wrap(async (req, res) => {
    const zoneId = String(req.query.zone || "");
    zones.watch(zones.groupOf(zoneId) ? zones.groupOf(zoneId).coordinator.uid : zoneId);
    if (req.query.wait_for !== undefined) {
      const timeout = Math.max(0, Math.min(25000, Number(req.query.timeout) || 20000));
      await zones.waitForChange(Number(req.query.wait_for), timeout);
    }
    const revision = zones.revision;
    const z = zoneId ? zones.zone(zoneId) : null;
    if (!z) return res.json({ zone: null, revision });
    // Remember the room people are looking at: the Android app's lock screen,
    // widget and tile have no page to ask, and mean this one.
    if (ctx.db.setting("lastZone", null) !== z.zone_id) ctx.db.setSetting("lastZone", z.zone_id);
    res.json({ revision, zone: zoneJson(named(z, req)) });
  }));

  app.get("/api/queue", wrap(async (req, res) => {
    const zoneId = need(req.query.zone, "zone required");
    const q = await zones.queue(zoneId);
    const row = (it) => {
      const t = it.trackId ? library.track(it.trackId) : null;
      const al = t ? library.album(t.album_id) : null;
      if (it.imageKey) it.artUri = "";
      return {
        queue_item_id: it.position,
        title: (t && t.title) || it.title || "",
        subtitle: (t && t.artist) || it.artist || "",
        album: (al && al.title) || it.album || "",
        image_key: it.imageKey || (al ? al.image_key : (it.artUri ? Artwork.foreignKey(it.artUri) : null)),
        length: Math.round((t && t.duration) || it.duration || 0) || null
      };
    };
    // Sonos keeps played tracks in its queue; they ARE the history. Upcoming
    // starts at the current track, as Roon's queue does.
    const cur = q.current || 1;
    const items = q.current ? q.items.slice(cur - 1).map(row) : q.items.map(row);
    const history = q.current ? q.items.slice(0, cur - 1).reverse().map(it => {
      const r = row(it);
      return {
        track: r.title, artist: r.subtitle, album: r.album, image_key: r.image_key,
        duration: r.length || 0, elapsed: r.length || 0, played: true, queue_item_id: it.position
      };
    }) : [];
    res.json({ items, history });
  }));

  app.post("/api/control", wrap(async (req, res) => {
    const { zone_or_output_id, command } = req.body || {};
    need(zone_or_output_id, "zone_or_output_id required");
    const allowed = ["play", "pause", "playpause", "stop", "previous", "next"];
    if (!allowed.includes(command)) return res.status(400).json({ error: "invalid command, allowed: " + allowed.join(", ") });
    // Play on an idle room with an empty queue: something to play is better
    // than nothing happening, and Random Album Radio is what that means here.
    const z = zones.zone(zone_or_output_id);
    const st = z && z._state;
    if ((command === "play" || command === "playpause") && st && !st.trackUri && !(st.queueLength > 0)) {
      await features.radioTopUp(z.zone_id, true);
      return res.json({ ok: true, started: "random-album" });
    }
    await zones.control(zone_or_output_id, command);
    res.json({ ok: true });
  }));

  app.post("/api/seek", wrap(async (req, res) => {
    const { zone_or_output_id, how, seconds } = req.body || {};
    need(zone_or_output_id, "zone_or_output_id required");
    if (!Number.isFinite(Number(seconds))) return res.status(400).json({ error: "seconds required" });
    await zones.seek(zone_or_output_id, how === "relative" ? "relative" : "absolute", Number(seconds));
    res.json({ ok: true });
  }));

  app.post("/api/volume", wrap(async (req, res) => {
    const b = req.body || {};
    let targets = [];
    if (b.output_id) targets = [b.output_id];
    else {
      const z = zones.zone(need(b.zone_or_output_id, "output_id or zone_or_output_id required"));
      if (!z) return res.status(404).json({ error: "That room isn't available" });
      targets = z.outputs.map(o => o.output_id);
    }
    if (b.mute !== undefined) {
      for (const id of targets) await zones.setMute(id, !!b.mute);
      return res.json({ ok: true });
    }
    const value = Number(b.value);
    if (!Number.isFinite(value)) return res.status(400).json({ error: "value is required" });
    for (const id of targets) await zones.setVolume(id, b.how || "absolute", value);
    res.json({ ok: true });
  }));

  app.post("/api/zone-settings", wrap(async (req, res) => {
    const b = req.body || {};
    need(b.zone_or_output_id, "zone_or_output_id required");
    const patch = {};
    if (b.shuffle !== undefined) patch.shuffle = !!b.shuffle;
    if (b.loop !== undefined) {
      if (!["disabled", "loop", "loop_one"].includes(b.loop)) return res.status(400).json({ error: "loop must be disabled, loop or loop_one" });
      patch.loop = b.loop;
    }
    if (!Object.keys(patch).length && b.auto_radio === undefined) return res.status(400).json({ error: "nothing to change" });
    if (Object.keys(patch).length) await zones.setSettings(b.zone_or_output_id, patch);
    res.json({ ok: true, random_album_radio_stands_down: false });
  }));

  app.post("/api/pause-all", wrap(async (req, res) => { await zones.pauseAll(); res.json({ ok: true }); }));

  app.post("/api/mute-all", wrap(async (req, res) => {
    const how = (req.body && req.body.how) || req.query.how || "mute";
    let n = 0;
    for (const o of zones.outputs()) {
      try { await zones.setMute(o.output_id, how !== "unmute"); n++; } catch (e) { /* unreachable room: skip it */ }
    }
    res.json({ ok: true, outputs: n });
  }));

  app.post("/api/group-outputs", wrap(async (req, res) => {
    const ids = ((req.body || {}).output_ids || []).filter(Boolean);
    if (ids.length < 2) return res.status(400).json({ error: "grouping needs at least two outputs" });
    await zones.group(ids);
    res.json({ ok: true });
  }));

  app.post("/api/ungroup-outputs", wrap(async (req, res) => {
    const ids = ((req.body || {}).output_ids || []).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: "no outputs given" });
    await zones.ungroup(ids);
    res.json({ ok: true });
  }));

  app.post("/api/transfer-zone", wrap(async (req, res) => {
    // The page names them from_zone / to_zone; both spellings are taken
    // (v0.6.0-RC6: the page's were never read, so a move did nothing).
    const b = req.body || {};
    const from = b.from || b.from_zone, to = b.to || b.to_zone;
    need(from, "from is required"); need(to, "to is required");
    await zones.transfer(from, to);
    res.json({ ok: true });
  }));

  app.post("/api/play-from-here", wrap(async (req, res) => {
    const { zone_or_output_id, queue_item_id } = req.body || {};
    need(zone_or_output_id, "zone_or_output_id required");
    const n = Number(queue_item_id);
    if (!Number.isInteger(n) || n < 1) return res.status(400).json({ error: "queue_item_id is required" });
    await zones.playFromHere(zone_or_output_id, n);
    res.json({ ok: true });
  }));

  // The queue's own actions (v0.6.24): picks removed, the queue cleared, picks
  // moved to after the track playing (Play next) and played from the first
  // of them (Play now). Positions are the queue's queue_item_ids.
  const positionsOf = (b) => (Array.isArray(b.queue_item_ids) ? b.queue_item_ids : [b.queue_item_id])
    .map(Number).filter(n => Number.isInteger(n) && n >= 1);
  app.post("/api/queue/remove", wrap(async (req, res) => {
    const b = req.body || {};
    need(b.zone_or_output_id, "zone_or_output_id required");
    const ids = positionsOf(b);
    if (!ids.length) return res.status(400).json({ error: "queue_item_ids required" });
    // From the bottom up, so each removal leaves the positions above it as they were.
    for (const n of [...new Set(ids)].sort((a, c) => c - a)) await zones.removeFromQueue(b.zone_or_output_id, n);
    res.json({ ok: true, removed: new Set(ids).size });
  }));
  app.post("/api/queue/clear", wrap(async (req, res) => {
    const b = req.body || {};
    need(b.zone_or_output_id, "zone_or_output_id required");
    await zones.clearQueue(b.zone_or_output_id);
    res.json({ ok: true });
  }));
  app.post("/api/queue/move", wrap(async (req, res) => {
    const b = req.body || {};
    need(b.zone_or_output_id, "zone_or_output_id required");
    const ids = positionsOf(b);
    if (!ids.length) return res.status(400).json({ error: "queue_item_ids required" });
    const kind = b.kind === "play_now" ? "play_now" : "play_next";
    const plan = await zones.moveAfterCurrent(b.zone_or_output_id, ids);
    if (kind === "play_now") await zones.playFromHere(b.zone_or_output_id, plan.first);
    res.json({ ok: true, kind, moved: plan.moved, first: plan.first });
  }));

  // Sonos has no standby a controller may use, and no source switching.
  app.post("/api/output/standby", (req, res) => res.status(501).json({ error: "Sonos rooms have no standby control" }));
  app.post("/api/output/convenience-switch", (req, res) => res.status(501).json({ error: "Sonos rooms have no source switch" }));

  // ------------------------------------------------------------ playing

  app.post("/api/play", wrap(async (req, res) => {
    const { offset, zone_or_output_id, kind } = req.body || {};
    if (!Number.isFinite(Number(offset))) return res.status(400).json({ error: "offset required" });
    need(zone_or_output_id, "zone_or_output_id required");
    need(kind, "kind required");
    if (kind === "radio") {
      await playback.playAlbum(zone_or_output_id, Number(offset), "play_now");
      features.setRadio(zones.zone(zone_or_output_id) ? zones.zone(zone_or_output_id).zone_id : zone_or_output_id, true);
      return res.json({ ok: true, action: "radio", offset: Number(offset) });
    }
    await playback.playAlbum(zone_or_output_id, Number(offset), kind);
    res.json({ ok: true, action: kind, offset: Number(offset) });
  }));

  app.post("/api/play-track", wrap(async (req, res) => {
    const b = req.body || {};
    const offset = Number(b.offset);
    const index = Number(b.track !== undefined ? b.track : b.track_index);
    if (!Number.isFinite(offset)) return res.status(400).json({ error: "offset required" });
    if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: "track index required" });
    need(b.zone_or_output_id, "zone_or_output_id required");
    const kind = b.kind || "play_now";
    const tracks = library.tracks(offset);
    if (!tracks.length) return res.status(404).json({ error: "That album is no longer in the library" });
    const t = tracks[index];
    if (!t) return res.status(409).json({ error: "That track is no longer on the album" });
    if (normaliseKind(kind) === "play_now") {
      // Play from this track, with the rest of the album after it — what
      // tapping a track on an album page means everywhere.
      await playback.playTracks(b.zone_or_output_id, tracks, "play_now", { startAt: index });
    } else {
      await playback.playTracks(b.zone_or_output_id, [t], normaliseKind(kind));
    }
    res.json({ ok: true, action: kind, invoked: kind, track: t.title });
  }));

  const filling = new Set();
  app.post("/api/play-multi", wrap(async (req, res) => {
    const b = req.body || {};
    const list = Array.isArray(b.items) && b.items.length ? b.items.map(i => Number(i.offset))
      : (Array.isArray(b.offsets) ? b.offsets.map(Number) : []);
    const ids = list.filter(Number.isFinite);
    if (!ids.length) return res.status(400).json({ error: "offsets required" });
    need(b.zone_or_output_id, "zone_or_output_id required");
    need(b.kind, "kind required");
    if (ids.length > 400) return res.status(400).json({ error: "at most 400 albums at a time" });
    const z = b.zone_or_output_id;
    if (filling.has(z)) return res.status(409).json({ error: "Still filling this zone's queue — let that finish before starting another" });
    filling.add(z);
    try {
      const tracks = [];
      let failed = 0;
      for (const id of ids) {
        const t = library.tracks(id);
        if (t.length) tracks.push(...t); else failed++;
      }
      await playback.playTracks(z, tracks.slice(0, 1000), normaliseKind(b.kind));
      res.json({ ok: true, queued: ids.length - failed, failed, total: ids.length, first_error: failed ? "Some albums are no longer in the library" : null });
    } finally {
      filling.delete(z);
    }
  }));

  // Random Album: one not heard in 12 months; until Mandarin has 12 months
  // of history, any album.
  function pickUnheard() {
    const { albums } = features.unplayed(1, 12);
    const al = albums[0] || library.random(1).albums[0];
    if (!al) { const e = new Error("The library is empty"); e.status = 503; throw e; }
    return al;
  }
  async function playUnheard(zoneId) {
    const al = pickUnheard();
    await playback.playAlbum(zoneId, al.id, "play_now");
    return al;
  }

  // Chosen, not played (from Rouen v1.9.3): the page offers it — Play now,
  // Play next or Queue — and plays it through /api/play. POST
  // /api/play-unheard (a page from before) and the Shortcut still play at once.
  app.get("/api/pick-unheard", wrap(async (req, res) => {
    res.json({ album: library.json(pickUnheard()) });
  }));

  app.post("/api/play-unheard", wrap(async (req, res) => {
    // "zone": what the page sent until v0.6.0-RC2 (Home's "Play something
    // unheard" failed with "zone_or_output_id required") — still taken.
    const b = req.body || {};
    const zone = need(b.zone_or_output_id || b.zone, "zone_or_output_id required");
    const al = await playUnheard(zone);
    res.json({ ok: true, album: library.json(al) });
  }));

  const pickZone = (id, req) => {
    const list = zones.zones().filter(z => mine(z, req));
    const asked = id ? zones.zone(id) : null;
    if (asked && list.some(z => z.zone_id === asked.zone_id)) return asked.zone_id;
    const last = ctx.db.setting("lastZone", null);
    if (last && list.some(z => z.zone_id === last)) return last;
    return (list.find(z => z.state === "playing") || list[0] || {}).zone_id;
  };

  app.get("/api/shortcut/play-random", wrap(async (req, res) => {
    const zone = pickZone(req.query.zone, req);
    if (!zone) return res.status(503).json({ error: away(req) ? "Away from home, only this phone plays" : "No Sonos rooms found" });
    const al = library.random(1).albums[0];
    if (!al) return res.status(503).json({ error: "The library is empty" });
    await playback.playAlbum(zone, al.id, "play_now");
    res.json({ ok: true, album: library.json(al) });
  }));
  app.get("/api/shortcut/play-unheard", wrap(async (req, res) => {
    const zone = pickZone(req.query.zone, req);
    if (!zone) return res.status(503).json({ error: away(req) ? "Away from home, only this phone plays" : "No Sonos rooms found" });
    const al = await playUnheard(zone);
    res.json({ ok: true, album: library.json(al) });
  }));

  // A played track, back in the queue: found in the library by its names.
  function resolveTrack(h) {
    const al = library.relocate(h.album, h.artist) || library.relocate(h.album, null);
    const want = N.fold(h.track);
    if (al) {
      const t = library.tracks(al.id).find(x => N.fold(x.title) === want);
      if (t) return t;
    }
    const row = ctx.db.raw.prepare("SELECT * FROM tracks WHERE lower(title) = lower(?) LIMIT 5").all(h.track || "");
    return row.find(r => !h.artist || N.fold(r.artist) === N.fold(h.artist)) || row[0] || null;
  }

  app.post("/api/queue/play-history-next", wrap(async (req, res) => {
    const b = req.body || {};
    need(b.zone_or_output_id, "zone_or_output_id required");
    const t = resolveTrack(b);
    if (!t) return res.status(404).json({ error: "Not in your library", unresolved: true });
    await playback.playTracks(b.zone_or_output_id, [t], "add_next");
    res.json({ ok: true, track: t.title });
  }));

  app.post("/api/queue/history-multi", wrap(async (req, res) => {
    const b = req.body || {};
    need(b.zone_or_output_id, "zone_or_output_id required");
    const found = [], unresolved = [];
    for (const h of (b.tracks || []).slice(0, 200)) {
      const t = resolveTrack(h);
      if (t) found.push(t); else unresolved.push(h.track || "?");
    }
    if (found.length) await playback.playTracks(b.zone_or_output_id, found, b.kind === "queue" ? "queue" : "add_next");
    res.json({ ok: true, queued: found.length, unresolved, failed: [] });
  }));

  app.get("/api/radio", (req, res) => {
    const zone = req.query.zone ? (zones.zone(req.query.zone) || {}).zone_id || req.query.zone : null;
    const on = [...features.radioZones()].filter(id => !away(req) || id === ownPhone(req));
    res.json({ enabled: zone ? features.radioEnabled(zone) : false, zones: on });
  });
  app.post("/api/radio", wrap(async (req, res) => {
    const zoneRaw = (req.body || {}).zone;
    need(zoneRaw, "zone required");
    const zone = (zones.zone(zoneRaw) || {}).zone_id || zoneRaw;
    const enabled = !!req.body.enabled;
    features.setRadio(zone, enabled);
    res.json({ ok: true, enabled, radios: { own: enabled, roon: false } });
    // Switching it on in a silent room starts it.
    const st = (zones.zone(zone) || {})._state;
    if (enabled && st && st.state !== "playing") features.radioTopUp(zone, true).catch(() => {});
  }));

  app.get("/api/album/now-playing", wrap(async (req, res) => {
    const z = zones.zone(need(req.query.zone, "zone required"));
    const st = z && z._state;
    if (!st) return res.json({ album: null });
    const t = st.trackId ? library.track(st.trackId) : null;
    const al = t ? library.album(t.album_id) : library.relocate(st.album, st.artist);
    res.json({ album: al ? library.json(al) : null });
  }));
};
