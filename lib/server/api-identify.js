"use strict";
/*
 * api-identify.js — Settings → Identify albums: the scan's switches
 * and times, how far it has got, what it proposes, what it applied (and
 * undo), what it couldn't place.
 */
module.exports = function mount(app, ctx) {
  const ident = () => ctx.identifier;

  /*
   * The page's state; with the lists of albums only when asked (?lists=<how
   * many of each>, v0.8.17): the page asks for them when it opens and when
   * their counts move, not every few seconds. Each list's full length is in
   * counts.
   */
  function page(lists = 500) {
    const id = ident();
    const st = id.state();
    const out = { settings: st.settings, reason: st.reason, active: st.active, current: st.current, progress: id.progress() };
    if (lists > 0) {
      const all = id.lists({ proposed: lists, unidentified: lists, applied: Math.min(lists, 100), rejected: Math.min(lists, 100) });
      for (const k of ["proposed", "unidentified", "applied", "rejected"]) out[k] = all[k].items;
      out.counts = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.count]));
    }
    return out;
  }

  // ?lists: absent, every list as before (500 of each; 100 applied and declined); 0 none.
  app.get("/api/identify", (req, res) => {
    const n = req.query.lists == null ? 500 : Math.max(0, Math.min(500, parseInt(req.query.lists, 10) || 0));
    res.json(page(n));
  });

  /* The MusicBrainz pack (v0.6.4): what's here, what's published, and the
   * download's progress. ?check=1 asks GitHub what's published — in the
   * background (v0.8.17): answered at once, "checking" until it has. */
  app.get("/api/identify/pack", (req, res) => {
    if (req.query.check) ctx.mbpack.checkSoon();
    res.json(Object.assign(ctx.mbpack.status(), { check_error: ctx.mbpack.describeError || null }));
  });
  app.post("/api/identify/pack/download", async (req, res) => res.json(await ctx.mbpack.download()));
  app.post("/api/identify/pack/remove", (req, res) => {
    try { res.json(ctx.mbpack.remove()); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  /* { dir }: keep the pack in that folder (null: the data folder); one already here is moved. */
  app.post("/api/identify/pack/folder", async (req, res) => {
    try { res.json(await ctx.mbpack.setDir((req.body || {}).dir || null)); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

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

  /* The releases this album could be, scored, best first (the album
   * editor's Find match). Nothing is written. */
  app.get("/api/identify/candidates", async (req, res) => {
    const al = ctx.library.album(req.query.offset);
    if (!al) return res.status(404).json({ error: "No such album" });
    try {
      res.json(await ident().suggest(al.key));
    } catch (e) {
      res.status(e.status || 502).json({ error: "MusicBrainz didn't answer (" + e.message + ")" });
    }
  });

  /* { offset, query }: a barcode, or a MusicBrainz release / release-group
   * link or id. That release is applied to the album. `how` says where the
   * choice came from ("pick": one of the suggestions). */
  app.post("/api/identify/match", async (req, res) => {
    const b = req.body || {};
    const al = ctx.library.album(b.offset);
    if (!al) return res.status(404).json({ error: "No such album" });
    const q = String(b.query || "").trim();
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    let what;
    let m;
    if (b.how === "pick" && q) what = { mbid: q };                       // one of our own suggestions, by its id
    else if ((m = /release-group\/([0-9a-f-]{36})/i.exec(q))) what = { group: m[1] };
    else if ((m = /release\/([0-9a-f-]{36})/i.exec(q))) what = { mbid: m[1] };
    else if (UUID.test(q) && q.length === 36) what = { mbid: q };
    else if (/^[\d\s-]{8,}$/.test(q)) what = { barcode: q };
    else return res.status(400).json({ error: "Enter a barcode (the digits under the bars), or paste a MusicBrainz release link" });
    if (b.how === "pick") what.how = "pick";
    try {
      await ident().match(al.key, what);
      res.json(page());
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });
};
