/* The page's core (app.js until v1.0.5), 15 of 33: a smart playlist opened, played and edited. */
async function openSmartPlaylist(sp) {
  enterFullWall("");   // the dynamic playlist prints its own full-width heading
  smartDetailActive = true;
  const mySeq = ++smartSeq;

  setBanner(null);
  grid.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "playlist-detail";

  const back = document.createElement("button");
  back.type = "button"; back.className = "action-btn playlist-back";
  back.textContent = "← Dynamic Playlists";
  back.addEventListener("click", () => { smartDetailActive = false; showSmartPlaylists(); });
  wrap.appendChild(back);

  const head = document.createElement("div");
  head.className = "playlist-head";
  const h = document.createElement("h2");
  h.className = "playlist-title";
  h.textContent = sp.name || "Dynamic Playlist";
  head.appendChild(h);
  const sub = document.createElement("div");
  sub.className = "playlist-sub";
  // What it is made of and what order it is in, alongside the query — both
  // are properties of the playlist that the query description can't carry,
  // and "why are these shuffled?" is otherwise only answerable from Edit.
  sub.textContent = [
    (sp.mode || SMART_MODE_DEFAULT) === "tracks" ? "Tracks" : "Albums",
    (sp.order || SMART_ORDER_DEFAULT) === "random" ? "random" : "album order",
    describeLibView(sp.view)
  ].filter(Boolean).join(" · ");
  head.appendChild(sub);
  wrap.appendChild(head);

  const actions = document.createElement("div");
  actions.className = "playlist-actions";
  const mkBtn = (label, cls, fn) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = cls; b.textContent = label;
    b.addEventListener("click", () => fn(b));
    actions.appendChild(b);
    return b;
  };
  // Two actions on the row; the rest behind the overflow menu. Six pills
  // shrank together (.action-btn is flex: 1 1 0) rather than wrapping, which
  // is how "Send to Roon" came out as "end to Roo".
  mkBtn("Play now", "action-btn primary", (b) => playSmartPlaylist(sp, "play_now", b));
  mkBtn("Queue",    "action-btn",         (b) => playSmartPlaylist(sp, "queue", b));
  actions.appendChild(buildOverflowMenu([
    { label: "Share",        onClick: (b) => shareThis(b) },
    { label: "Edit",         onClick: () => editSmartPlaylist(sp) },
    { label: "Delete",       onClick: () => deleteSmartPlaylist(sp), danger: true },
  ], { title: sp.name || "Dynamic Playlist" }));
  wrap.appendChild(actions);

  const ol = document.createElement("ol");
  ol.className = "track-list playlist-tracks";
  wrap.appendChild(ol);

  const status = document.createElement("div");
  status.className = "playlist-empty";
  status.textContent = "Reading tracks…";
  wrap.appendChild(status);

  const more = document.createElement("button");
  more.type = "button"; more.className = "action-btn playlist-more hidden";
  more.textContent = "Load more";
  wrap.appendChild(more);
  grid.appendChild(wrap);

  // Does the track list own this screen? In "tracks" mode it IS the screen and
  // reports its own progress. In "albums" mode the screen shows albums, and
  // the track paging still exists — Share has to expand albums into tracks
  // whichever mode we are in — but it must not narrate over the album count
  // that is already there.
  const trackMode = (sp.mode || SMART_MODE_DEFAULT) === "tracks";
  if (!trackMode) { ol.remove(); more.remove(); status.textContent = "Reading albums…"; }

  // Tracks are paged by ALBUM: each one has to be opened on the Core, so the
  // screen fills a batch at a time rather than stalling on a long playlist.
  let albumOffset = 0, loading = false, done = false, shown = 0;
  // `done` means "stop paging" — it is set both when the playlist ENDS and
  // when a page fails. Share has to tell those apart, so failure is recorded
  // separately rather than inferred from a flag that means two things.
  let failed = false;
  // The tracks as data, alongside the rows on screen. Share needs the values,
  // not the rendered text, and re-reading them out of the DOM would mean
  // parsing back a string this code already had.
  const loaded = [];
  const loadPageOnce = async () => {
    if (loading || done) return;
    loading = true;
    more.disabled = true;
    try {
      const zsel = document.getElementById("zone-select");
      const zid = (zsel && zsel.value) || selectedZoneId || "";
      const r = await fetch(`/api/smart-playlist?id=${encodeURIComponent(sp.id)}` +
                            `&offset=${albumOffset}` + (zid ? `&zone=${encodeURIComponent(zid)}` : ""),
                            { cache: "no-store" });
      if (!smartDetailActive || mySeq !== smartSeq) return;
      const j = await r.json().catch(() => ({}));
      if (!smartDetailActive || mySeq !== smartSeq) return;
      if (!r.ok) {
        status.textContent = j.error || "Couldn't read this playlist.";
        done = true;
        failed = true;
        more.classList.add("hidden");   // it would no-op; don't offer it
        return;
      }
      // A playlist whose query needs a feature that is switched off. The
      // server refuses to half-apply it: with Labels off, libraryView simply
      // skips a saved Record-label filter, so the playlist would open, play,
      // and return a completely different set of albums with nothing saying
      // why. Named here instead.
      if (j.unavailable) {
        status.className = "playlist-empty is-unavailable";
        status.textContent = j.unavailable;
        done = true;
        failed = true;
        more.classList.add("hidden");
        return;
      }

      for (const t of (j.tracks || [])) { if (trackMode) ol.appendChild(smartTrackRow(t)); loaded.push(t); }
      shown += (j.tracks || []).length;
      albumOffset += (j.albums_expanded || 0);
      done = !!j.done || !(j.albums_expanded > 0);
      if (trackMode) {
        status.textContent = done
          ? (shown ? `${shown} track${shown === 1 ? "" : "s"} from ${j.album_total} album${j.album_total === 1 ? "" : "s"}`
                   : "Nothing in your library matches this Dynamic Playlist right now.")
          : `${shown} tracks so far — ${j.album_total - albumOffset} album(s) left`;
        more.classList.toggle("hidden", done);
      }
    } catch (e) {
      if (!smartDetailActive || mySeq !== smartSeq) return;
      status.textContent = "Couldn't read this playlist.";
      done = true;
      failed = true;
    } finally {
      loading = false;
      more.disabled = false;
    }
  };

  // Awaiting a load that is ALREADY running has to mean "wait for it", not
  // "do nothing" — otherwise Share, tapped while the first page is still in
  // flight, sees `loading`, returns instantly and finds an empty list.
  let inflight = null;
  const loadPage = () => {
    if (loading) return inflight || Promise.resolve();
    inflight = loadPageOnce();
    return inflight;
  };
  // Share has to expand the albums it hasn't read yet — a smart playlist is a
  // query, and until an album is opened on the Core we don't know its tracks.
  // That is the same paging the "Load more" button drives, run to completion
  // with the progress visible, because a share that silently covered the
  // first 40 albums of 300 would be indistinguishable from a complete one.
  async function shareThis(btn) {
    btn.disabled = true;
    try {
      let stalled = false;
      while (!done && albumOffset < SHARE_ALBUM_MAX) {
        const before = albumOffset;
        // A PROGRESS message, so it must not linger: TOAST_REPORT_MS exists
        // for reports that land at the END of a long job, and using it here
        // pinned "Reading album 1…" over the finished share sheet for 9s.
        showToast(`Reading album ${albumOffset + 1}…`);
        await loadPage();
        // Leaving the screen orphans the page; stop rather than keep hammering
        // the Core for a view the user is no longer looking at.
        if (!smartDetailActive || mySeq !== smartSeq) return;
        // No forward progress: looping again would never terminate. It also
        // means we do NOT know we reached the end.
        if (albumOffset === before) { stalled = true; break; }
      }
      if (!loaded.length) { showToast("Nothing in this playlist to share", "error"); return; }
      // `failed` is set by loadPageOnce on an error. Without it a timeout on
      // page 4 of 40 was indistinguishable from finishing: `done` went true
      // either way, the loop exited, and the sheet announced a complete
      // share of 10% of the playlist.
      await shareTracks(sp.name || "Dynamic Playlist", loaded.map(t => ({
        title: t.title, artist: t.subtitle,
        album: t.album_title, track_no: t.track_no
      })), null, {
        incomplete:   failed || stalled,
        albumsCapped: !done && albumOffset >= SHARE_ALBUM_MAX,
      });
    } finally {
      btn.disabled = false;
    }
  }

  if (trackMode) {
    more.addEventListener("click", loadPage);
    loadPage();
    return;
  }

  // Albums mode: one request, straight out of the snapshot. No Roon calls at
  // all to LOOK at the playlist — expanding tracks is what costs, and that
  // only happens now if the user shares it.
  const albumGrid = document.createElement("div");
  // album-grid, not "grid": that is the class that actually carries the
  // responsive column layout, and it is the same one the Library wall uses,
  // so a playlist's albums size exactly like every other wall of tiles.
  albumGrid.className = "album-grid playlist-albums";
  wrap.insertBefore(albumGrid, status);
  try {
    const r = await fetch("/api/smart-playlist/albums?id=" + encodeURIComponent(sp.id),
                          { cache: "no-store" });
    if (!smartDetailActive || mySeq !== smartSeq) return;
    const j = await r.json().catch(() => ({}));
    if (!smartDetailActive || mySeq !== smartSeq) return;
    if (!r.ok) { status.textContent = j.error || "Couldn't read this playlist."; return; }
    const albums = j.albums || [];
    const frag = document.createDocumentFragment();
    for (const a of albums) frag.appendChild(buildAlbumTile(a));
    albumGrid.appendChild(frag);
    // Says what it PLAYS and, when the query matched more, what it left out —
    // the same honesty the tile subtitle carries.
    status.textContent = albums.length
      ? (Number.isFinite(j.matched) && j.matched > albums.length
          ? `${albums.length} of ${j.matched} albums that match`
          : `${albums.length} album${albums.length === 1 ? "" : "s"}`)
      : "Nothing in your library matches this Dynamic Playlist right now.";
  } catch (e) {
    if (!smartDetailActive || mySeq !== smartSeq) return;
    status.textContent = "Couldn't read this playlist.";
  }
}
window.__openSmartPlaylist = openSmartPlaylist;

// A track row carrying the artwork of the album it came from. Tapping it plays
// that track via the album path already used by the album view.
function smartTrackRow(t) {
  const li = document.createElement("li");
  li.className = "track-row track-row-art";
  li.dataset.albumOffset = String(t.album_offset);
  li.dataset.trackIndex  = String(t.track_index);

  const art = document.createElement("span");
  art.className = "track-art";
  // The key stays on the element even if the <img> is removed by onerror, so
  // "which artwork was this row given" is answerable after the fact.
  if (t.image_key) art.dataset.artKey = t.image_key;
  if (t.image_key) {
    loadArt(art, t.image_key, 80,
      (img) => { art.classList.add("no-image"); img.remove(); });
  } else {
    art.classList.add("no-image");
  }
  li.appendChild(art);

  const text = document.createElement("div");
  text.className = "track-text";
  const tt = document.createElement("div");
  tt.className = "track-title";
  tt.textContent = t.title || "";
  text.appendChild(tt);
  const ta = document.createElement("div");
  ta.className = "track-artist";
  ta.textContent = [t.subtitle, t.album_title].filter(Boolean).join(" · ");
  text.appendChild(ta);
  li.appendChild(text);

  li.addEventListener("click", async () => {
    const zsel = document.getElementById("zone-select");
    const zone = (zsel && zsel.value) || selectedZoneId;
    if (!zone) { showToast("Choose a zone first", "error"); return; }
    try {
      const r = await fetch("/api/play-track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // These are /api/play-track's names — `track`/`title`, NOT the
        // playlist route's `track_index`/`track_title`. Sending the wrong
        // pair 400s on every tap.
        body: JSON.stringify({
          offset: t.album_offset, track: t.track_index, title: t.title,
          zone_or_output_id: zone, kind: "play_now"
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) showToast(j.error || "Couldn't play that track", "error");
      else showToast(j.action || "Playing");
    } catch (e) {
      showToast("Couldn't reach the extension", "error");
    }
  });
  return li;
}

// Play or queue the whole thing. The albums come from the snapshot (no Roon
// calls), then /api/play-multi does the work with its existing batching and
// stale-offset defense.
async function playSmartPlaylist(sp, kind, btn) {
  const zsel = document.getElementById("zone-select");
  const zone = (zsel && zsel.value) || selectedZoneId;
  if (!zone) { showToast("Choose a zone first", "error"); return; }
  btn.disabled = true;
  try {
    const r = await fetch(`/api/smart-playlist/albums?id=${encodeURIComponent(sp.id)}&max=${SMART_SEND_MAX}`,
                          { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(j.error || "Couldn't read this playlist", "error"); return; }
    const albums = (j.albums || []);
    if (!albums.length) { showToast("Nothing matches this Dynamic Playlist", "error"); return; }
    const pr = await fetch("/api/play-multi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: albums.map(a => ({ offset: a.offset, title: a.title, subtitle: a.subtitle })),
        zone_or_output_id: zone, kind
      })
    });
    const pj = await pr.json().catch(() => ({}));
    if (!pr.ok) { showToast(pj.error || "Sonos refused that", "error"); return; }
    // Say how many of how many. The cap used to be silent, so a 1,179-album
    // playlist queued 100 and looked like it had queued everything.
    //
    // MATCHED, not total: the endpoint returns exactly `total` albums, so
    // comparing against it makes "capped" permanently false and this whole
    // message dead code. `matched` is what the query found, which is the
    // number the playlist was capped AGAINST.
    showToast(multiOutcome(kind === "queue" ? "Queued" : "Playing",
                           pj, albums.length, smartMatched(j)), null, TOAST_REPORT_MS);
  } catch (e) {
    // The fetch died, but the server keeps going — it has no way to hear
    // that we left. Saying "couldn't reach" would invite a retry that
    // restarts the queue from scratch on top of the run still in progress.
    showToast("Lost contact while filling the queue — check the queue before trying again",
              "error", TOAST_REPORT_MS);
  } finally {
    btn.disabled = false;
  }
}

// Edit reuses the Focus sheet: load the saved view into the live one, then
// open the editor with this playlist as the save target, so "Save as…" writes
// back to the same record instead of creating a duplicate.
// Copy a saved view into the live one. Decades are normalised to STRINGS: the
// server stores them as numbers, while the whole client compares against
// String(decade) — the Focus chips would render off for a decade that IS
// active, and tapping one would push a duplicate rather than toggle it.
function applyViewToLibView(view) {
  // A facet the saved view doesn't mention is OFF, not "leave whatever the
  // Library screen happens to have". Skipping it would let a playlist saved
  // before a facet existed quietly inherit the user's current filters and
  // then show a different set of albums than the one that was saved.
  Object.assign(libView, libEmptyFacets());
  for (const k of SMART_VIEW_KEYS) {
    if (view[k] === undefined) continue;
    libView[k] = Array.isArray(view[k]) ? view[k].map(String) : view[k];
  }
}

// NOT saved here. editSmartPlaylist used to commit the playlist's view to
// localStorage immediately, so opening Edit and closing it again silently and
// permanently re-sorted the user's Library screen. openLibFocusSheet restores
// the previous view if the sheet is abandoned.
function editSmartPlaylist(sp) {
  openLibFocusSheet(sp);
}
