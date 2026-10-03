"use strict";
/*
 * api-loudness.js — Settings → Loudness (v0.6.0-RC5): ReplayGain's mode and
 * pre-amp, the switch for measuring files without ReplayGain tags, and how
 * far the measuring has got. lib/loudness.js does the work.
 */
module.exports = function mount(app, ctx) {
  app.get("/api/loudness", (req, res) => res.json(ctx.loudness.status()));

  app.post("/api/loudness", (req, res) => {
    try {
      ctx.loudness.set(req.body || {});
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.message });
    }
    res.json(ctx.loudness.status());
  });
};
