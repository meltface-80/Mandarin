"use strict";
/*
 * api-dsp.js — headphone profiles for a zone's DSP (lib/autoeq.js).
 *
 *   GET  /api/dsp/headphones?q=hd+650   AutoEq's index searched
 *   GET  /api/dsp/headphones/profile?id= one profile, fetched and kept
 *   POST /api/dsp/headphones/parse      { text } → a pasted/uploaded profile
 *
 * The chosen profile is saved with the device (PATCH /api/audio-devices/:id
 * { dsp: { headphone } }), where the phone and the renderer read it.
 */
const { parseProfile } = require("../autoeq");

module.exports = function mount(app, ctx) {
  const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => res.status(e.status || 502).json({ error: e.message }));

  app.get("/api/dsp/headphones", wrap(async (req, res) => {
    const q = String(req.query.q || "").trim();
    const results = q ? await ctx.autoeq.search(q) : [];
    res.json({ results, indexed_at: ctx.autoeq.indexedAt() });
  }));

  app.get("/api/dsp/headphones/profile", wrap(async (req, res) => {
    res.json({ profile: await ctx.autoeq.profile(String(req.query.id || "")) });
  }));

  app.post("/api/dsp/headphones/parse", wrap(async (req, res) => {
    const b = req.body || {};
    const text = String(b.text || "");
    if (text.length > 20000) return res.status(400).json({ error: "That's too long for a profile" });
    const p = parseProfile(text);
    const name = String(b.name || "").trim().slice(0, 120) || "Pasted profile";
    res.json({ profile: { source: "custom", id: "", name, preamp: p.preamp, bands: p.bands } });
  }));
};
