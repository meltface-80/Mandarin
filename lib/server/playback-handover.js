// @ts-check
"use strict";
/*
 * playback-handover.js — playback's side of the hand-over to the C# server
 * (v0.8.49, stage 6 of docs/specs/csharp-migration.md). The hub here (the
 * kept queues put back, then the Sonos loops and the device scans) never
 * starts where the C# server holds the job "playback" (MANDARIN_FRONT_RUNS
 * names it): the C# server answers every playback request from its first.
 * It starts after all at a hand-over that leaves playback out (an older C#
 * server) or when none comes (index.js ownWork); each step once, whichever
 * asks first. The hand-over's answer carries what the hub here was set up
 * with, so the C# server's own is set up the same; and a Qobuz or Tidal album
 * an older C# server wrote the rows of is still played here at its ask
 * (/internal/playback/play, v0.8.47), unasked by one that holds playback.
 */
// api-service.js hangs play off its mount function (module.exports.play), which the checker doesn't read.
const SERVICE = /** @type {{ play: (ctx: any, zone: any, offset: any, kind: any, track: any) => Promise<any> }} */ (/** @type {unknown} */ (require("./api-service")));

/** The hub here, started once — or not at all, where the C# server holds playback. */
function starter({ zones, devices, log, env = process.env }) {
  let restored = false, started = false;
  const here = !String(env.MANDARIN_FRONT_RUNS || "").split(",").map(x => x.trim()).includes("playback");
  // What was queued on the phones and the renderers when the server last
  // ran: back before anything asks, so an update's restart loses nothing.
  const restore = () => {
    if (restored) return;
    restored = true;
    const kept = zones.restoreQueues();
    if (kept) log(`[musicd] put back the queue of ${kept} player(s) from before the restart`);
  };
  const start = () => {
    if (started) return;
    started = true;
    restore();
    zones.start();
    devices.start();
  };
  return { here, restore, start };
}

/** What the hub here was set up with (index.js config), for the C# server's own: the hand-over's answer. */
function handOverConfig(config, knownHosts, env = process.env) {
  return {
    sonos_hosts: config.sonosHosts.concat(knownHosts), server_ip: config.serverIp || null,
    sonos_include: config.include, sonos_exclude: config.exclude,
    upnp_hosts: config.upnpHosts, upnp_multicast: config.upnpMulticast !== false, upnp_offline_ms: config.upnpOfflineMs || null,
    local_audio: config.localAudio !== false && env.LOCAL_AUDIO !== "0"
  };
}

/**
 * POST /internal/playback/play: a Qobuz or Tidal album the C# server wrote the
 * rows of, played here (v0.8.47, ServiceRoutes.cs) — what api-service.js's
 * play does once the album is in the library, answered as that route answers.
 */
function internalPlay(ctx, fromFront) {
  return async (req, res) => {
    if (!fromFront(req)) return res.status(403).end();
    const b = req.body || {};
    try { res.json(await SERVICE.play(ctx, b.zone_or_output_id, b.offset, b.kind, b.track)); }
    catch (e) {
      const status = e.status || 500, out = { error: e.message || String(e) };
      if (status === 401) out.connected = false;
      res.status(status).json(out);
    }
  };
}

module.exports = { starter, handOverConfig, internalPlay };
