"use strict";
/*
 * api-service.js — a streaming service's routes (Qobuz, v0.6.23; Tidal,
 * v0.6.24): Settings → Services, the service's browser, and playing from
 * it. Mounted once per service; see lib/services/streaming.js.
 *
 *   GET  /api/settings/<s>           the account's state and settings
 *   POST /api/settings/<s>/signin    Qobuz: { username, password } → signed in (the password is not kept)
 *                                    Tidal: → { pending: { url, code } }, the sign-in happening on tidal.com;
 *                                    GET /api/settings/tidal says when it is done
 *   POST /api/settings/<s>/signin/cancel   Tidal: the link and code let go
 *   POST /api/settings/<s>/signout
 *   POST /api/settings/<s>           { quality?, import? }
 *   POST /api/settings/<s>/import    favourites (and purchases) into the library, now
 *
 *   GET  /api/<s>/lists              the lists the service features (Tidal), for the browser's tabs
 *   GET  /api/<s>/new-releases?days  GET /api/<s>/featured?type=…
 *   GET  /api/<s>/search?q&offset    GET /api/<s>/artist-albums?artist_id&offset
 *   GET  /api/<s>/album?id           the album and its tracks
 *   GET  /api/<s>/state?album_id     whether it is in the account's favourites
 *   POST /api/<s>/favorite { album_id } · /unfavorite — on the service, and kept in (or let go from) the library
 *   POST /api/<s>/open { album_id } → { offset }: the album's page here
 *   POST /api/<s>/play { album_id, zone_or_output_id, kind, track? }
 *
 * From home and away alike: the server does the fetching.
 */
module.exports = function mount(app, ctx, id) {
  const svc = () => ctx.services[id];
  const S = "/api/settings/" + id, A = "/api/" + id;
  const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
    const status = e.status || 500;
    const out = { error: e.message || String(e) };
    if (status === 401) out.connected = false;
    res.status(status).json(out);
  });
  const signedIn = (res) => { if (svc().connected()) return true; res.status(401).json({ error: "Not signed in to " + svc().name, connected: false }); return false; };
  const importNow = () => svc().importLibrary().catch(e => ctx.log(`[${id}] import: ${e.message}`));

  app.get(S, (req, res) => res.json(svc().status()));
  app.post(S + "/signin", wrap(async (req, res) => {
    const s = svc(), b = req.body || {};
    if (typeof s.signIn === "function") {
      res.json(await s.signIn(b.username, b.password));
      if (s.settings().import) importNow();
    } else {
      // The device flow: the link and code now; the import once the sign-in lands.
      const before = s.connected();
      res.json(await s.beginSignIn());
      if (!before) {
        const p = s.pending;
        const watch = setInterval(() => {
          if (s.pending !== p || s.connected()) { clearInterval(watch); if (s.connected() && s.settings().import) importNow(); }
        }, 1000);
        watch.unref();
      }
    }
  }));
  app.post(S + "/signin/cancel", (req, res) => { if (svc().cancelSignIn) svc().cancelSignIn(); res.json(svc().status()); });
  for (const p of [S + "/signout", S + "/disconnect"]) app.post(p, wrap(async (req, res) => res.json(await svc().signOut())));
  app.post(S, wrap(async (req, res) => {
    const before = svc().settings();
    const s = svc().setSettings(req.body || {});
    if (s.import && !before.import && svc().connected()) importNow();
    // Off: what the import brought in leaves the library (v0.7.10).
    if (!s.import && before.import) svc().releaseImported();
    res.json(svc().status());
  }));
  app.post(S + "/import", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    res.json({ ok: true, result: await svc().importLibrary() });
  }));

  app.get(A + "/lists", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    if (typeof svc().lists !== "function") return res.status(404).json({ error: svc().name + " has no lists" });
    res.json({ connected: true, lists: await svc().lists() });
  }));
  app.get(A + "/new-releases", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 30));
    res.json({ connected: true, days, albums: await svc().newReleases(days) });
  }));
  app.get(A + "/featured", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    res.json({ connected: true, albums: await svc().featured(String(req.query.type || "")) });
  }));
  app.get(A + "/search", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    const query = String(req.query.q || "").trim();
    if (!query) return res.json({ connected: true, albums: [], artists: [], total: 0, has_more: false });
    res.json(Object.assign({ connected: true }, await svc().search(query, Math.max(0, Number(req.query.offset) || 0))));
  }));
  app.get(A + "/artist-albums", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    if (!req.query.artist_id) return res.status(400).json({ error: "artist_id required" });
    res.json(Object.assign({ connected: true }, await svc().artistAlbums(String(req.query.artist_id), Math.max(0, Number(req.query.offset) || 0))));
  }));
  app.get(A + "/album", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    if (!req.query.id) return res.status(400).json({ error: "id required" });
    const d = await svc().albumDetail(String(req.query.id));
    const row = svc().q.albumByKey.get(svc().KEY + d.album.id);
    res.json(Object.assign({ connected: true, offset: row ? row.id : null }, d));
  }));
  // Is this album in the account's favourites on the service (as distinct from Mandarin's heart)?
  app.get(A + "/state", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    if (!req.query.album_id) return res.status(400).json({ error: "album_id required" });
    res.json({ connected: true, favourite: await svc().isFavourite(String(req.query.album_id)) });
  }));
  for (const [p, on] of [[A + "/favorite", true], [A + "/unfavorite", false]]) {
    app.post(p, wrap(async (req, res) => {
      if (!signedIn(res)) return;
      const albumId = (req.body || {}).album_id;
      if (!albumId) return res.status(400).json({ error: "album_id required" });
      await svc().setFavourite(String(albumId), on);
      res.json({ ok: true, album_id: String(albumId), favourite: on });
    }));
  }
  // The album as library rows (transient until favourited), so its page here
  // opens. One already known is answered as it is: no asking the service
  // again, no library reload, for every tap in the browser.
  app.post(A + "/open", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    const albumId = (req.body || {}).album_id;
    if (!albumId) return res.status(400).json({ error: "album_id required" });
    const known = svc().q.albumByKey.get(svc().KEY + String(albumId));
    if (known && ctx.library.album(known.id)) return res.json({ ok: true, offset: known.id, album: ctx.library.json(ctx.library.album(known.id)) });
    const t0 = Date.now();
    const offset = await svc().ensureAlbum(String(albumId));
    const t1 = Date.now();
    ctx.library.reload();
    const t2 = Date.now();
    // Where the time went, for a slow open to be read off the log.
    ctx.log(`[${id}] open ${albumId}: asked and written in ${t1 - t0} ms, library read in ${t2 - t1} ms`);
    // The album as the page's tiles carry it, so the page opens without another ask.
    res.json({ ok: true, offset, album: ctx.library.json(ctx.library.album(offset)) });
  }));
  app.post(A + "/play", wrap(async (req, res) => {
    if (!signedIn(res)) return;
    const b = req.body || {};
    if (!b.album_id) return res.status(400).json({ error: "album_id required" });
    if (!b.zone_or_output_id) return res.status(400).json({ error: "zone_or_output_id required" });
    const kind = ["play_now", "play_next", "queue", "shuffle"].includes(b.kind) ? b.kind : "play_now";
    const offset = await svc().ensureAlbum(String(b.album_id));
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
