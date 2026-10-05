"use strict";
/*
 * api-qobuz.js — Qobuz (v0.6.23): Settings → Services, the Qobuz browser,
 * and playing from it. See lib/qobuz.
 *
 *   GET  /api/settings/qobuz           the account's state and settings
 *   POST /api/settings/qobuz/signin    { username, password } → signed in (the password is not kept)
 *   POST /api/settings/qobuz/signout
 *   POST /api/settings/qobuz           { quality?, import? }
 *   POST /api/settings/qobuz/import    favourites and purchases into the library, now
 *
 *   GET  /api/qobuz/new-releases?days  GET /api/qobuz/featured?type=…
 *   GET  /api/qobuz/search?q&offset    GET /api/qobuz/artist-albums?artist_id&offset
 *   GET  /api/qobuz/album?id           the album and its tracks
 *   POST /api/qobuz/favorite { album_id } · /unfavorite — on Qobuz, and kept in (or let go from) the library
 *   POST /api/qobuz/play { album_id, zone_or_output_id, kind, track? }
 *   POST /api/qobuz/open { album_id } → { offset }: the album's page here
 *
 * From home and away alike: the server does the fetching.
 */
module.exports = function mount(app, ctx) {
  const q = () => ctx.qobuz;
  const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
    const status = e.status || 500;
    const out = { error: e.message || String(e) };
    if (status === 401) out.connected = false;
    res.status(status).json(out);
  });
  const signedIn = (res) => { if (q().connected()) return true; res.status(401).json({ error: "Not signed in to Qobuz", connected: false }); return false; };

  app.get("/api/settings/qobuz", (req, res) => res.json(q().status()));
  app.post("/api/settings/qobuz/signin", wrap(async (req, res) => {
    const b = req.body || {};
    res.json(await q().signIn(b.username, b.password));
    if (q().settings().import) q().importLibrary().catch(e => ctx.log(`[qobuz] import: ${e.message}`));
  }));
  for (const p of ["/api/settings/qobuz/signout", "/api/settings/qobuz/disconnect"]) app.post(p, wrap(async (req, res) => res.json(await q().signOut())));
  app.post("/api/settings/qobuz", wrap(async (req, res) => {
    const before = q().settings();
    const s = q().setSettings(req.body || {});
    if (s.import && !before.import && q().connected()) q().importLibrary().catch(e => ctx.log(`[qobuz] import: ${e.message}`));
    res.json(q().status());
  }));
  app.post("/api/settings/qobuz/import", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    res.json({ ok: true, result: await q().importLibrary() });
  }));

  app.get("/api/qobuz/new-releases", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 30));
    res.json({ connected: true, days, albums: await q().newReleases(days) });
  }));
  app.get("/api/qobuz/featured", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    res.json({ connected: true, albums: await q().featured(String(req.query.type || "best-sellers")) });
  }));
  app.get("/api/qobuz/search", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    const query = String(req.query.q || "").trim();
    if (!query) return res.json({ connected: true, albums: [], artists: [], total: 0, has_more: false });
    res.json(Object.assign({ connected: true }, await q().search(query, Math.max(0, Number(req.query.offset) || 0))));
  }));
  app.get("/api/qobuz/artist-albums", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    if (!req.query.artist_id) return res.status(400).json({ error: "artist_id required" });
    res.json(Object.assign({ connected: true }, await q().artistAlbums(String(req.query.artist_id), Math.max(0, Number(req.query.offset) || 0))));
  }));
  app.get("/api/qobuz/album", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    if (!req.query.id) return res.status(400).json({ error: "id required" });
    const d = await q().albumDetail(String(req.query.id));
    const row = q().q.albumByKey.get("qobuz:" + d.album.id);
    res.json(Object.assign({ connected: true, offset: row ? row.id : null }, d));
  }));
  // Is this album in the account's Qobuz favourites (as distinct from Mandarin's heart)?
  app.get("/api/qobuz/state", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    if (!req.query.album_id) return res.status(400).json({ error: "album_id required" });
    res.json({ connected: true, favourite: await q().isFavourite(String(req.query.album_id)) });
  }));
  for (const [p, on] of [["/api/qobuz/favorite", true], ["/api/qobuz/unfavorite", false]]) {
    app.post(p, wrap(async (req, res) => {
      if (!signedIn(res)) return;
      const id = (req.body || {}).album_id;
      if (!id) return res.status(400).json({ error: "album_id required" });
      await q().setFavourite(String(id), on);
      res.json({ ok: true, album_id: String(id), favourite: on });
    }));
  }
  // The album as library rows (transient until favourited), so its page here
  // opens. One already known is answered as it is: no asking Qobuz again, no
  // library reload, for every tap in the browser.
  app.post("/api/qobuz/open", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    const id = (req.body || {}).album_id;
    if (!id) return res.status(400).json({ error: "album_id required" });
    const known = q().q.albumByKey.get("qobuz:" + String(id));
    if (known && ctx.library.album(known.id)) return res.json({ ok: true, offset: known.id });
    const offset = await q().ensureAlbum(String(id));
    ctx.library.reload();
    res.json({ ok: true, offset });
  }));
  app.post("/api/qobuz/play", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    const b = req.body || {};
    if (!b.album_id) return res.status(400).json({ error: "album_id required" });
    if (!b.zone_or_output_id) return res.status(400).json({ error: "zone_or_output_id required" });
    const kind = ["play_now", "play_next", "queue", "shuffle"].includes(b.kind) ? b.kind : "play_now";
    const offset = await q().ensureAlbum(String(b.album_id));
    ctx.library.reload();
    if (b.track !== undefined && b.track !== null) {
      const tracks = ctx.library.tracks(offset);
      const i = Number(b.track);
      if (!tracks[i]) return res.status(409).json({ error: "That track isn't on the album" });
      if (kind === "play_now") await ctx.playback.playTracks(b.zone_or_output_id, tracks, "play_now", { startAt: i });
      else await ctx.playback.playTracks(b.zone_or_output_id, [tracks[i]], kind === "queue" ? "queue" : "add_next");
    } else await ctx.playback.playAlbum(b.zone_or_output_id, offset, kind);
    res.json({ ok: true, offset, action: kind });
  }));
};
