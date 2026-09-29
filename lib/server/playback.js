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
 */
const DIDL = require("../sonos/didl");
const STREAM = require("../stream");

const URI_RE = /\/stream\/t(\d+)(?:\.(?:orig|\d+-\d+))?\.[a-z0-9]+(?:\?|$)/i;

function trackIdFromUri(uri) {
  const m = URI_RE.exec(String(uri || ""));
  return m ? Number(m[1]) : null;
}

function planFor(t, target) {
  return STREAM.plan({
    path: t.path, codec: t.codec, sampleRate: t.sample_rate,
    bitsPerSample: t.bits, channels: t.channels
  }, target || null);
}

class Playback {
  constructor(ctx) {
    this.ctx = ctx;   // { library, zones, transcoder, baseUrl() }
  }

  // Signed: speakers can't sign in, so their addresses carry the proof.
  streamUrl(t, p, target) {
    const seg = !target ? "" : p.transcode ? `.${p.rate}-${p.bits}` : ".orig";
    return this.ctx.auth.signUrl(`${this.ctx.baseUrl()}/stream/t${t.id}${seg}.${p.ext}`);
  }

  artUrl(al) {
    return this.ctx.auth.signUrl(`${this.ctx.baseUrl()}/api/image/${encodeURIComponent(al.image_key)}?size=600`);
  }

  item(t, target) {
    const al = this.ctx.library.album(t.album_id);
    const p = planFor(t, target);
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
    return { uri, meta: DIDL.build(uri, meta), track: t, plan: p };
  }

  /* Warm the transcode cache for what is about to play, in play order. */
  prefetch(items) {
    const work = items.filter(i => i.plan.transcode).map(i => ({
      track: Object.assign({}, i.track), plan: i.plan
    }));
    if (work.length) this.ctx.transcoder.prefetch(work.slice(0, 40));
  }

  /* The items a zone is handed: planned for that zone's player. */
  itemsFor(zoneId, tracks) {
    const target = this.ctx.zones.targetFor ? this.ctx.zones.targetFor(zoneId) : null;
    return tracks.map(t => this.item(t, target));
  }

  async playTracks(zoneId, tracks, how, opts = {}) {
    if (!tracks.length) throw new Error("Nothing to play");
    const items = this.itemsFor(zoneId, tracks);
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
