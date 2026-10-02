"use strict";
/*
 * api-phone.js — the Android app as a player (see lib/sonos/phones.js).
 *
 *   POST /api/phone/hello     the app's player has started (empty) → its zone id,
 *                             and where to find this server away from home
 *   GET  /api/phone/commands  ?after=<seq>: what to do next, held open ~25 s
 *   POST /api/phone/state     what the player is actually doing
 *
 * Only a signed-in Android app can be a phone zone, and only as itself: the
 * zone id comes from the device's sign-in, never from the request.
 */
const { awayAddress } = require("./tailscale");

module.exports = function mountPhone(app, ctx) {
  const { zones, auth } = ctx;
  const phones = zones.phones;

  const wrap = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (e) { res.status(e.status || 500).json({ error: e.message || String(e) }); }
  };
  function phoneDevice(req) {
    const dev = auth.deviceOf(req);
    if (!dev || dev.kind !== "android") {
      const e = new Error("Only the Mandarin Android app can play as a phone");
      e.status = 403;
      throw e;
    }
    return dev;
  }

  app.post("/api/phone/hello", wrap(async (req, res) => {
    const dev = phoneDevice(req);
    const hello = phones.hello(dev.id, (req.body || {}).name || dev.name);
    phones.setAway(hello.zone_id, auth.isAway(req));
    // A DSP setting changed on the phone while it couldn't reach the server
    // (offline, v0.5.55): the phone's is the newer, so it is kept here.
    const sent = (req.body || {}).dsp;
    if (sent && typeof sent === "object" && !Array.isArray(sent) && ctx.devices && ctx.devices.phoneDsp) {
      try { ctx.devices.phoneDsp(hello.zone_id, (req.body || {}).name || dev.name, sent); }
      catch (e) { /* not a setting the server takes: its own copy stands */ }
    }
    // The phone's DSP setting (Audio Devices → this phone), for the app's
    // engine; the register's copy, or the default until the phone is in it.
    const dsp = ctx.devices && ctx.devices.dspFor ? ctx.devices.dspFor(hello.zone_id) : null;
    res.json(Object.assign(hello, {
      away: auth.isAway(req),
      away_address: awayAddress(ctx.config.port, process.env, undefined, ctx.tailscale),
      dsp: dsp || { enabled: false, headphone: null, peq: null, headroom: "auto" }
    }));
  }));

  app.get("/api/phone/commands", wrap(async (req, res) => {
    const dev = phoneDevice(req);
    const after = Math.max(0, parseInt(req.query.after, 10) || 0);
    const wait = Math.max(0, Math.min(25000, parseInt(req.query.wait, 10) || 0));
    const uid = phones.constructor.uidFor(dev.id);
    phones.setAway(uid, auth.isAway(req));
    res.json(await phones.commands(uid, after, wait));
  }));

  app.post("/api/phone/state", wrap(async (req, res) => {
    const dev = phoneDevice(req);
    const uid = phones.constructor.uidFor(dev.id);
    phones.setAway(uid, auth.isAway(req));
    phones.report(uid, req.body || {});
    res.json({ ok: true });
  }));
};
