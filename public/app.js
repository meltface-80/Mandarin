/*
 * Random Albums — frontend
 *
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 */

/*
 * The page's startup (v1.0.5, docs/specs/page-modules.md): what closed the
 * core when it was one file, still where it ran, after the core's parts and
 * before the blocks that follow it. The page is the parts public/app/parts.txt
 * lists, this among them, joined by the server into one script, /app.js.
 */

async function bootstrap() {
  // Instant open: paint the last Home from cache before we've reconnected, so
  // reopening the PWA shows content immediately instead of reloading the whole
  // screen. Skipped when a filtered wall is being restored (activeFilter), and
  // when there's nothing cached (first-ever launch) we fall back to the banner.
  // The layout is server-persisted, so it is the same on every device. Read
  // it before the first paint; on failure the table's own default order
  // stands, which is a working Home rather than a blank one.
  await loadHomeLayout();
  applyFeatureMenuFromServer();
  const painted = !activeFilter && hydrateHomeFromCache();
  if (!painted) setBanner("Connecting to Mandarin…");
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch("/api/status");
      const j = await r.json();
      if (j.paired) {
        setBanner(null);
        await loadZones();

        // Home is the landing view; the album wall loads lazily when the
        // user enters it (menu → Random albums / a genre / filter / labels).
        // Exception: a genre/tag filter that survived a reload (restored from
        // localStorage above) means the user was mid-browse a filtered wall —
        // land back on it instead of silently discarding the filter, which is
        // what showHome() would otherwise do on its way to an unfiltered Home.
        if (activeFilter) showWall({ loadIfEmpty: true });
        else showHome();

        // Restore the album modal if it was open
        try {
          const m = sessionStorage.getItem("rra-modal");
          if (m) {
            const parsed = JSON.parse(m);
            // Offline, a server album left open isn't reopened (it isn't on the phone); nor over one opened since the page loaded (v0.9.5).
            if (parsed && parsed.album && !window.__musicdOffline && !currentAlbum) {
              openAlbum(parsed.album, { source: parsed.source, zoneId: parsed.zoneId,
                                       filter: parsed.filter });
            }
          }
        } catch (e) { /* corrupt sessionStorage modal state — skip restore, open normally */ }

        // Every 15 s while on screen (v0.8.36: not while hidden), and at once on coming back.
        setInterval(() => { if (!document.hidden) loadZones(); }, 15000);
        // (Just after: an ask left waiting from before is let go first — not joined.)
        document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(loadZones, 0); });
        return;
      }
    } catch (e) { /* /api/status fetch failed — server not ready yet, fall through to "Waiting" banner */ }
    setBanner("Waiting for Mandarin to start…");
    await new Promise(r => setTimeout(r, 2000));
  }
  setBanner("Mandarin isn't answering. Check the container is running.", true);
}
bootstrap();