"use strict";
/*
 * api-identify.js — Settings → Setup → Identify albums: the scan's switches
 * and times, how far it has got, what it proposes, what it applied (and
 * undo), what it couldn't place.
 */
module.exports = function mount(app, ctx) {
  const ident = () => ctx.identifier;

  function page() {
    const id = ident();
    const st = id.state();
    return {
      settings: st.settings, reason: st.reason, active: st.active, current: st.current,
      progress: id.progress(),
      proposed: id.list("proposed"),
      unidentified: id.list("unidentified"),
      applied: id.list("applied", 100),
      rejected: id.list("rejected", 100)
    };
  }

  app.get("/api/identify", (req, res) => res.json(page()));

  app.post("/api/identify/settings", (req, res) => {
    const b = req.body || {};
    for (const k of ["start", "end"]) {
      if (b[k] !== undefined && !/^\d{1,2}:\d{2}$/.test(String(b[k]))) return res.status(400).json({ error: `${k} must be a time like 01:00` });
    }
    ident().setSettings(b);
    res.json(page());
  });

  /* { offset } names the album; the scan's verdict is by its key. */
  const act = what => (req, res) => {
    const al = ctx.library.album((req.body || {}).offset);
    if (!al) return res.status(404).json({ error: "No such album" });
    const r = ident()[what](al.key);
    if (r === null) return res.status(409).json({ error: "Nothing to " + what + " for this album" });
    res.json(page());
  };
  app.post("/api/identify/accept", act("accept"));
  app.post("/api/identify/reject", act("reject"));
  app.post("/api/identify/undo", act("undo"));
  app.post("/api/identify/recheck", act("recheck"));
  app.post("/api/identify/recheck-all", (req, res) => { ident().recheckAll(); res.json(page()); });
};
