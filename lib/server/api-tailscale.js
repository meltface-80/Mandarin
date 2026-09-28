"use strict";
/*
 * api-tailscale.js — Settings → Away from home: Tailscale built into the
 * server (lib/server/tsnode.js).
 *
 *   GET  /api/tailscale          how it is: state, sign-in link, address
 *   POST /api/tailscale/login    a sign-in link (open it, sign in, done)
 *   POST /api/tailscale/logout   this server leaves the tailnet
 *   POST /api/tailscale/enable   {on}: built-in Tailscale on or off
 *
 * Signed in only, like the rest of /api — and from home only: away, the way
 * you're reaching the server is the thing these would change.
 */
module.exports = function mountTailscale(app, ctx) {
  const ts = ctx.tailscale;
  const wrap = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (e) { res.status(e.status || 500).json({ error: e.message || String(e) }); }
  };
  const homeOnly = (req) => {
    if (ctx.auth && ctx.auth.isAway(req)) {
      const e = new Error("Change this from home — away, it's how you're connected");
      e.status = 403;
      throw e;
    }
  };
  app.get("/api/tailscale", (req, res) => res.json(ts.status()));
  app.post("/api/tailscale/login", wrap(async (req, res) => { homeOnly(req); res.json(await ts.login()); }));
  app.post("/api/tailscale/logout", wrap(async (req, res) => { homeOnly(req); res.json(await ts.logout()); }));
  app.post("/api/tailscale/enable", wrap(async (req, res) => {
    homeOnly(req);
    res.json(await ts.setEnabled(!!(req.body && req.body.on)));
  }));
};
