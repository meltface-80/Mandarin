"use strict";
/*
 * playback.js — turning library tracks into things a player's queue will take.
 *
 * Every queued item is a URL on this server — /stream/t<id>.<ext> — plus the
 * DIDL-Lite that makes Sonos accept it. The extension and the MIME type are
 * decided here, by the same plan the stream endpoint will follow when the
 * speaker comes to fetch it, so what Sonos is told and what it receives
 * always agree.
 *
 * A UPnP renderer has its own ceiling (its target), and its URLs say what
 * they carry: /stream/t<id>.orig.<ext> is the file as stored, and
 * /stream/t<id>.<rate>-<bits>.flac a conversion to exactly that. Sonos URLs
 * carry neither and go on meaning what they always have.
 *
 * ReplayGain (v0.6.0-RC5, lib/loudness.js): a track with a gain to apply
 * goes to Sonos and renderers as a conversion with the gain in it, its URL
 * saying how much (?g=-6.2); the phone is handed the gain with the track
 * and applies it itself.
 */
const DIDL = require("../sonos/didl");
const STREAM = require("../stream");
const SV = require("../services");

const URI_RE = /\/stream\/t(\d+)(?:\.(?:orig|\d+-\d+))?\.[a-z0-9]+(?:\?|$)/i;

function trackIdFromUri(uri) {
  const m = URI_RE.exec(String(uri || ""));
  return m ? Number(m[1]) : null;
}

function planFor(t, target, gain) {
  // A streamed track's audio is FLAC (lib/services): planned as a .flac would be.
  const svc = SV.ofPath(t.path);
  const info = { path: svc ? t.path + ".flac" : t.path, codec: t.codec, sampleRate: t.sample_rate, bitsPerSample: t.bits, channels: t.channels };
  let p = STREAM.plan(info, target || null);
  // A streamed track (Qobuz v0.6.23, Tidal v0.6.24) always goes through the
  // transcode cache — fetched from the service as it is where a file would be
  // sent as it is — so the device is fed from here and the next track is
  // ready behind it.
  if (svc && !p.transcode) {
    p = { transcode: true, mime: "audio/flac", ext: "flac", rate: Number(t.sample_rate) || 44100, bits: Number(t.bits) || 16, reason: "from " + SV.SERVICES[svc].name + ", as it comes", streamed: true };
  }
  return gain ? STREAM.withGain(p, info, target || null, gain) : p;
}

class Playback {
  constructor(ctx) {
    this.ctx = ctx;   // { library, zones, transcoder, baseUrl() }
  }

  // Signed: speakers can't sign in, so their addresses carry the proof.
  streamUrl(t, p, target) {
    const seg = !target ? "" : p.transcode ? `.${p.rate}-${p.bits}` : ".orig";
    // A conversion with DSP names its output (?o=), so the stream endpoint
    // runs that zone's setting as it stands when the device fetches.
    const qs = [];
    if (p.dsp && target && target.id) qs.push("o=" + encodeURIComponent(target.id));
    // DSD as it is, in the device's own word for it (audio/dsf…): the stream
    // says the same as the DIDL (v0.6.0-RC3).
    if (p.dsd && target && p.mime !== STREAM.mimeForExt(p.ext)) qs.push("m=" + encodeURIComponent(p.mime));
    if (p.gain) qs.push("g=" + p.gain);
    const q = qs.length ? "?" + qs.join("&") : "";
    return this.ctx.auth.signUrl(`${this.ctx.baseUrl()}/stream/t${t.id}${seg}.${p.ext}${q}`);
  }

  artUrl(al) {
    return this.ctx.auth.signUrl(`${this.ctx.baseUrl()}/api/image/${encodeURIComponent(al.image_key)}?size=600`);
  }

  /* gain: dB to apply in the stream; phoneGain: dB for the phone to apply. */
  item(t, target, { gain = null, phoneGain = null } = {}) {
    const al = this.ctx.library.album(t.album_id);
    const p = planFor(t, target, gain);
    const uri = this.streamUrl(t, p, target);
    const meta = {
      itemId: `musicd-t${t.id}`,
      title: t.title,
      artist: t.artist || (al && al.artist) || "",
      albumArtist: (al && al.artist) || t.album_artist || "",
      album: (al && al.title) || t.album || "",
      artUri: al ? this.artUrl(al) : "",
      trackNumber: t.track_no || "",
      duration: t.duration,
      mime: p.mime
    };
    // A DLNA renderer likes to be told what the stream carries; Sonos is
    // told nothing new, so its DIDL stays exactly as it was.
    if (target) {
      meta.sampleFrequency = p.transcode ? p.rate : (t.sample_rate || 0);
      meta.bitsPerSample = p.transcode ? p.bits : (t.bits || 0);
      meta.nrAudioChannels = p.transcode ? 2 : (t.channels || 2);
    }
    const it = { uri, meta: DIDL.build(uri, meta), track: t, plan: p };
    if (phoneGain != null) it.gain = phoneGain;
    return it;
  }

  /* Warm the transcode cache for what is about to play, in play order. */
  prefetch(items) {
    const work = items.filter(i => i.plan.transcode).map(i => ({
      track: Object.assign({}, i.track, this.ctx.services && this.ctx.services.of(i.track.path) ? { mtime: this.ctx.services.of(i.track.path).tier() } : {}), plan: i.plan
    }));
    if (work.length) this.ctx.transcoder.prefetch(work.slice(0, 40));
  }

  /* The items a zone is handed: planned for that zone's player, each with
   * its ReplayGain — in the stream, or for the phone to apply. */
  itemsFor(zoneId, tracks, { shuffled } = {}) {
    const zones = this.ctx.zones;
    const target = zones.targetFor ? zones.targetFor(zoneId) : null;
    const phone = !!(zones.phones && zones.phones.isPhoneId && zones.phones.isPhoneId(zoneId));
    if (shuffled === undefined) {
      const st = zones.state && zones.state.get ? zones.state.get(zoneId) : null;
      shuffled = !!(st && st.shuffle);
    }
    // Volume Levelling is the device's own (v0.6.0-RC7).
    const levelling = this.ctx.devices && this.ctx.devices.levellingFor ? this.ctx.devices.levellingFor(zoneId) : null;
    const gains = this.ctx.loudness ? this.ctx.loudness.gainsFor(tracks, { shuffled, levelling }) : tracks.map(() => null);
    return tracks.map((t, i) => this.item(t, target, phone ? { phoneGain: gains[i] } : { gain: gains[i] }));
  }

  async playTracks(zoneId, tracks, how, opts = {}) {
    if (!tracks.length) throw new Error("Nothing to play");
    const items = this.itemsFor(zoneId, tracks, { shuffled: opts.shuffled });
    // The track that starts first is prepared first.
    const start = Math.max(0, opts.startAt || 0);
    this.prefetch(items.slice(start).concat(items.slice(0, start)));
    return this.ctx.zones.enqueue(zoneId, items, how, opts);
  }

  async playAlbum(zoneId, albumId, how, opts = {}) {
    const al = this.ctx.library.album(albumId);
    if (!al) { const e = new Error("That album is no longer in the library"); e.status = 404; throw e; }
    let tracks = this.ctx.library.tracks(al.id);
    if (how === "shuffle") {
      opts = Object.assign({}, opts, { shuffled: true });
      tracks = tracks.slice();
      for (let i = tracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
      }
      how = "play_now";
    }
    await this.playTracks(zoneId, tracks, normaliseKind(how), opts);
    return al;
  }
}

// The interface's words for where things go, mapped onto the three the zone
// manager understands.
function normaliseKind(kind) {
  if (kind === "queue" || kind === "add_to_queue") return "queue";
  if (kind === "play_next" || kind === "add_next" || kind === "next") return "add_next";
  return "play_now";
}

module.exports = { Playback, trackIdFromUri, planFor, normaliseKind, URI_RE };
