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

  /* { offset, query }: a barcode, or a MusicBrainz release / release-group
   * link or id. That release is applied to the album. */
  app.post("/api/identify/match", async (req, res) => {
    const b = req.body || {};
    const al = ctx.library.album(b.offset);
    if (!al) return res.status(404).json({ error: "No such album" });
    const q = String(b.query || "").trim();
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    let what;
    let m;
    if ((m = /release-group\/([0-9a-f-]{36})/i.exec(q))) what = { group: m[1] };
    else if ((m = /release\/([0-9a-f-]{36})/i.exec(q))) what = { mbid: m[1] };
    else if (UUID.test(q) && q.length === 36) what = { mbid: q };
    else if (/^[\d\s-]{8,}$/.test(q)) what = { barcode: q };
    else return res.status(400).json({ error: "Enter a barcode (the digits under the bars), or paste a MusicBrainz release link" });
    try {
      await ident().match(al.key, what);
      res.json(page());
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });
};
