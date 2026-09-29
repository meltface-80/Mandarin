"use strict";
/*
 * api-devices.js — Settings → Audio Devices: the list, one device, its name
 * and what you say it can take.
 *
 * Home only, like the rooms themselves: away from home the list is empty and
 * nothing can be changed, since none of these can be reached from there.
 */
const { RATES, BITS } = require("../renderers/profiles");

module.exports = function mount(app, ctx) {
  const away = req => !!(ctx.auth && ctx.auth.isAway(req));
  const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => res.status(e.status || 500).json({ error: e.message }));
  const devices = () => ctx.devices;

  app.get("/api/audio-devices", (req, res) => {
    if (away(req)) return res.json({ away: true, devices: [] });
    res.json({ away: false, devices: devices().list(), scanning: !!devices().scanning, last_scan: devices().lastScan || null });
  });

  app.get("/api/audio-devices/:id", (req, res) => {
    if (away(req)) return res.status(403).json({ error: "Audio devices are only shown at home", away: true });
    const d = devices().get(req.params.id);
    if (!d) return res.status(404).json({ error: "No such device" });
    res.json(d);
  });

  /* { name } renames ("" returns to the network name); { caps: { user } } is
   * the "you set it" layer: { rates: [...] | null, bits: [...] | null }. */
  app.patch("/api/audio-devices/:id", wrap(async (req, res) => {
    if (away(req)) return res.status(403).json({ error: "Away from home, devices can't be changed", away: true });
    const b = req.body || {};
    let d = devices().get(req.params.id);
    if (!d) return res.status(404).json({ error: "No such device" });
    if (b.name !== undefined) {
      if (typeof b.name !== "string") return res.status(400).json({ error: "name must be text" });
      d = devices().rename(req.params.id, b.name);
    }
    if (b.enabled !== undefined) d = await devices().setEnabled(req.params.id, !!b.enabled);
    if (b.caps && b.caps.user !== undefined) {
      const u = b.caps.user;
      if (u !== null && (typeof u !== "object" || Array.isArray(u))) return res.status(400).json({ error: "caps.user must be an object or null" });
      const clean = {};
      if (u) {
        for (const [k, all] of [["rates", RATES], ["bits", BITS]]) {
          if (u[k] === undefined) continue;
          if (u[k] === null) { clean[k] = null; continue; }
          if (!Array.isArray(u[k]) || u[k].some(v => !all.includes(Number(v)))) return res.status(400).json({ error: `caps.user.${k} lists something unknown` });
          clean[k] = u[k].map(Number);
        }
      }
      d = devices().setUserCaps(req.params.id, u ? clean : null);
    }
    res.json(d);
  }));

  app.post("/api/audio-devices/rescan", wrap(async (req, res) => {
    if (away(req)) return res.status(403).json({ error: "Away from home, the network can't be searched", away: true });
    await devices().scan();
    res.json({ ok: true, devices: devices().list(), last_scan: devices().lastScan || null });
  }));

  app.post("/api/audio-devices/:id/forget", wrap((req, res) => {
    if (away(req)) return res.status(403).json({ error: "Away from home, devices can't be changed", away: true });
    if (!devices().forget(req.params.id)) return res.status(404).json({ error: "No such device" });
    res.json({ ok: true, devices: devices().list() });
  }));
};
