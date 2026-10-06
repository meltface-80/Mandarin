"use strict";
/*
 * api-devices.js — Settings → Audio Devices: the list, one device, its name
 * and what you say it can take.
 *
 * Home only, like the rooms themselves — with one exception since v0.5.21:
 * away from home, the Mandarin app sees the phone it is on (it is the one
 * player there is away, and its own settings live here). Nothing else is
 * listed away, and the network can't be searched from there.
 */
const { RATES, BITS, DSD } = require("../renderers/profiles");

module.exports = function mount(app, ctx) {
  const away = req => !!(ctx.auth && ctx.auth.isAway(req));
  // Away, the one device the asker may see: the phone the app is on, by the
  // device it signed in as. A browser away has none.
  const uidFor = ctx.zones.phones.constructor.uidFor;
  function ownPhone(req) {
    const dev = ctx.auth && ctx.auth.deviceOf(req);
    if (!dev || dev.kind !== "android") return null;
    // The register learns of a phone within ten seconds of its hello; asked
    // sooner than that, it is brought up to date now. A phone that hasn't
    // said hello is not a device yet.
    const id = uidFor(dev.id);
    if (!devices().get(id)) devices().syncKnown();
    return devices().get(id) ? id : null;
  }
  const mayTouch = (req, id) => !away(req) || (ownPhone(req) !== null && ownPhone(req) === id);
  const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => res.status(e.status || 500).json({ error: e.message }));
  const devices = () => ctx.devices;
  // The zone a device plays in: a Sonos room's group, otherwise itself.
  const zoneIdOf = id => { const z = ctx.zones.zone(id); return z ? z.zone_id : id; };
  // Random album radio is per zone (features.js); shown on the device's page.
  const withRadio = d => d ? Object.assign(d, { zone_id: zoneIdOf(d.id), radio: ctx.features.radioEnabled(zoneIdOf(d.id)) }) : d;

  app.get("/api/audio-devices", (req, res) => {
    if (away(req)) {
      const mine = ownPhone(req);
      return res.json({ away: true, devices: mine ? devices().list().filter(d => d.id === mine) : [] });
    }
    res.json({ away: false, devices: devices().list(), scanning: !!devices().scanning, last_scan: devices().lastScan || null, local: devices().local });
  });

  app.get("/api/audio-devices/:id", (req, res) => {
    if (!mayTouch(req, req.params.id)) return res.status(403).json({ error: "Away from home, only this phone is shown", away: true });
    const d = devices().get(req.params.id);
    if (!d) return res.status(404).json({ error: "No such device" });
    res.json(withRadio(d));
  });

  /* { name } renames ("" returns to the network name); { caps: { user } } is
   * the "you set it" layer: { rates: [...] | null, bits: [...] | null }. */
  app.patch("/api/audio-devices/:id", wrap(async (req, res) => {
    if (!mayTouch(req, req.params.id)) return res.status(403).json({ error: "Away from home, only this phone can be changed", away: true });
    const b = req.body || {};
    let d = devices().get(req.params.id);
    if (!d) return res.status(404).json({ error: "No such device" });
    if (b.name !== undefined) {
      if (typeof b.name !== "string") return res.status(400).json({ error: "name must be text" });
      d = devices().rename(req.params.id, b.name);
    }
    if (b.enabled !== undefined) d = await devices().setEnabled(req.params.id, !!b.enabled);
    if (b.hidden !== undefined) d = await devices().setHidden(req.params.id, !!b.hidden);
    if (b.shared !== undefined) d = devices().setShared(req.params.id, !!b.shared);
    if (b.output && typeof b.output === "object") d = devices().setOutput(req.params.id, b.output);
    if (b.dsp !== undefined) d = devices().setDsp(req.params.id, b.dsp);
    if (b.levelling !== undefined) d = devices().setLevelling(req.params.id, b.levelling);
    if (b.radio !== undefined) {
      const zone = zoneIdOf(req.params.id);
      ctx.features.setRadio(zone, !!b.radio);
      // Switched on in a silent zone: it starts.
      const z = ctx.zones.zone(zone);
      if (b.radio && z && z._state && z._state.state !== "playing") ctx.features.radioTopUp(zone, true).catch(() => {});
    }
    if (b.caps && b.caps.user !== undefined) {
      const u = b.caps.user;
      if (u !== null && (typeof u !== "object" || Array.isArray(u))) return res.status(400).json({ error: "caps.user must be an object or null" });
      const clean = {};
      if (u) {
        for (const [k, all] of [["rates", RATES], ["bits", BITS], ["dsd", DSD]]) {
          if (u[k] === undefined) continue;
          if (u[k] === null) { clean[k] = null; continue; }
          if (!Array.isArray(u[k]) || u[k].some(v => !all.includes(Number(v)))) return res.status(400).json({ error: `caps.user.${k} lists something unknown` });
          clean[k] = u[k].map(Number);
        }
      }
      d = devices().setUserCaps(req.params.id, u ? clean : null);
    }
    res.json(withRadio(devices().get(req.params.id)));
  }));

  app.post("/api/audio-devices/rescan", wrap(async (req, res) => {
    if (away(req)) return res.status(403).json({ error: "Away from home, the network can't be searched", away: true });
    await devices().scan();
    res.json({ ok: true, devices: devices().list(), last_scan: devices().lastScan || null, local: devices().local });
  }));

  app.post("/api/audio-devices/:id/forget", wrap((req, res) => {
    if (away(req)) return res.status(403).json({ error: "Away from home, devices can't be changed", away: true });
    if (!devices().forget(req.params.id)) return res.status(404).json({ error: "No such device" });
    res.json({ ok: true, devices: devices().list() });
  }));
};
