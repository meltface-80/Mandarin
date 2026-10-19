/* The page's core (app.js until v1.0.5), 8 of 33: playlists' mosaics, a playlist opened, and the Library wall's pages. */
// Roon gives a playlist no cover of its own, so a mosaic has to come from the
// tracks inside — one browse walk per playlist. Far too slow to block the grid
// on, so the tiles appear immediately and fill in behind, TWO AT A TIME: an
// unthrottled sweep would fire a browse walk per playlist at the Core all at
// once. The server caches each result, so this only really runs the first time.
async function fillPlaylistMosaics(list, tiles, mySeq) {
  const pending = list.filter(p => !(Array.isArray(p.art_keys) && p.art_keys.length));
  let i = 0;
  const worker = async () => {
    while (i < pending.length) {
      const p = pending[i++];
      if (!playlistsActive || mySeq !== playlistSeq) return;   // left the screen
      try {
        const r = await fetch(`/api/playlist/art?offset=${encodeURIComponent(p.offset)}` +
                              `&title=${encodeURIComponent(p.title || "")}`, { cache: "no-store" });
        if (!r.ok) continue;
        const j = await r.json();
        if (!playlistsActive || mySeq !== playlistSeq) return;
        const keys = (j && j.art_keys) || [];
        if (!keys.length) continue;
        const tile = tiles.get(p.title);
        if (!tile || !tile.isConnected) continue;
        repaintTileArt(tile, keys);
      } catch (e) { /* one missing mosaic is cosmetic — keep going */ }
    }
  };
  await Promise.all([worker(), worker()]);
}

// Swap a placeholder tile's artwork for a mosaic in place, without rebuilding
// the tile — it carries the click handler that opens the playlist.
function repaintTileArt(tile, keys) {
  const wrap = tile.querySelector(".album-art-wrap");
  if (!wrap) return;
  for (const img of Array.from(wrap.querySelectorAll("img"))) img.remove();
  wrap.classList.remove("no-image");
  const use = keys.filter(Boolean).slice(0, 4);
  if (use.length >= 2) {
    wrap.classList.add("album-art-mosaic");
    wrap.dataset.mosaic = String(use.length);
  }
  wrap.dataset.artKeys = use.join(",");
  for (const k of use) loadArt(wrap, k, tileImgSize(use.length >= 4));
  if (!use.length) wrap.classList.add("no-image");
}

async function openPlaylist(p) {
  enterFullWall("");   // the Roon playlist prints its own full-width heading
  playlistDetailActive = true;
  const mySeq = ++playlistSeq;
  let j = null;
  try {
    // The zone travels with the read: Roon needs one to resolve a SMART
    // playlist's contents, and without it the list comes back empty.
    const zsel = document.getElementById("zone-select");
    const zid = (zsel && zsel.value) || selectedZoneId || "";
    const r = await fetch(`/api/playlist?offset=${encodeURIComponent(p.offset)}` +
                          `&title=${encodeURIComponent(p.title || "")}` +
                          (zid ? `&zone=${encodeURIComponent(zid)}` : ""),
                          { cache: "no-store" });
    if (!playlistDetailActive || mySeq !== playlistSeq) return;
    j = await r.json().catch(() => ({}));
    if (!playlistDetailActive || mySeq !== playlistSeq) return;
    if (!r.ok) {
      grid.innerHTML = "";
      setBanner(j.error || "Couldn't open that playlist.", true);
      return;
    }
  } catch (e) {
    if (!playlistDetailActive || mySeq !== playlistSeq) return;
    grid.innerHTML = "";
    setBanner("Couldn't open that playlist.", true);
    return;
  }

  setBanner(null);
  grid.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "playlist-detail";

  // Its own Back, because the topbar's Back goes to Home and drilling two
  // levels deep should not throw the user all the way out.
  const back = document.createElement("button");
  back.type = "button"; back.className = "action-btn playlist-back";
  back.textContent = "← Playlists";
  back.addEventListener("click", () => { playlistDetailActive = false; showPlaylists(); });
  wrap.appendChild(back);

  const head = document.createElement("div");
  head.className = "playlist-head";
  const h = document.createElement("h2");
  h.className = "playlist-title";
  h.textContent = j.title || p.title || "Playlist";
  head.appendChild(h);
  if (j.subtitle) {
    const sub = document.createElement("div");
    sub.className = "playlist-sub";
    sub.textContent = j.subtitle;
    head.appendChild(sub);
  }
  wrap.appendChild(head);

  const zoneOf = () => {
    const sel = document.getElementById("zone-select");
    return (sel && sel.value) || selectedZoneId || null;
  };
  const act = async (url, body, btn) => {
    const zone = zoneOf();
    if (!zone) { showToast("Choose a zone first", "error"); return; }
    btn.disabled = true;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ zone_or_output_id: zone }, body))
      });
      const jr = await r.json().catch(() => ({}));
      if (!r.ok) showToast(jr.error || "Sonos refused that", "error");
      else showToast(jr.invoked ? jr.invoked : "Sent to Sonos");
    } catch (e) {
      showToast("Couldn't reach the extension", "error");
    } finally {
      btn.disabled = false;
    }
  };

  const tracks = (j && j.tracks) || [];

  if (j.can_play || tracks.length) {
    const actions = document.createElement("div");
    actions.className = "playlist-actions";
    if (j.can_play) {
      for (const [label, kind, cls] of [
        ["Play now", "play_now", "action-btn primary"],
        ["Queue",    "queue",    "action-btn"],
      ]) {
        const b = document.createElement("button");
        b.type = "button"; b.className = cls;
        b.textContent = label;
        b.addEventListener("click", () => act("/api/playlist/play",
          { offset: p.offset, title: p.title || "", kind }, b));
        actions.appendChild(b);
      }
    }
    if (tracks.length) {
      actions.appendChild(buildOverflowMenu([
        { label: "Share", onClick: (b) => shareTracks(p.title || "Playlist",
          // A Roon playlist row carries the track and its artist, but no
          // album — Roon does not put one on the row. The `album` slot is
          // left empty rather than guessed at, so an importer knows it was
          // never told.
          tracks.map(t => ({
            title: t.title, artist: t.subtitle, track_no: t.track_no
          })), b,
          // /api/playlist reads at most PLAYLIST_ITEMS rows, so a longer
          // playlist arrives already cut short. The screen says so; the share
          // sheet has to as well, or the file claims to be the whole thing.
          { sourceTruncated: !!j.truncated }) },
      ], { title: p.title || "Playlist" }));
    }
    wrap.appendChild(actions);
  }

  if (!tracks.length) {
    const note = document.createElement("div");
    note.className = "playlist-empty";
    note.textContent = "No tracks were found for this playlist.";
    wrap.appendChild(note);
  } else {
    const ol = document.createElement("ol");
    ol.className = "track-list playlist-tracks";
    for (const t of tracks) {
      const li = document.createElement("li");
      li.className = "track-row track-row-art";
      li.dataset.index = String(t.index);
      // Roon gives each playlist track its own image_key; fall back to the
      // playlist's own art so a row is never a bare gap.
      const art = document.createElement("span");
      art.className = "track-art";
      const key = t.image_key || j.image_key;
      if (key) art.dataset.artKey = key;
      if (key) {
        const img = document.createElement("img");
        img.loading = "lazy"; img.alt = "";
        img.src = `/api/image/${encodeURIComponent(key)}?size=80`;
        img.onerror = () => { art.classList.add("no-image"); img.remove(); };
        art.appendChild(img);
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
      if (t.subtitle) {
        const ts = document.createElement("div");
        ts.className = "track-artist";
        ts.textContent = t.subtitle;
        text.appendChild(ts);
      }
      li.appendChild(text);
      li.addEventListener("click", () => act("/api/playlist/play-track", {
        offset: p.offset, title: p.title || "",
        track_index: t.index, track_title: t.title || "", kind: "play_now"
      }, li));
      ol.appendChild(li);
    }
    wrap.appendChild(ol);
    if (j.truncated) {
      const note = document.createElement("div");
      note.className = "playlist-empty";
      note.textContent = `Showing the first ${tracks.length} of ${j.total} tracks.`;
      wrap.appendChild(note);
    }
  }
  grid.appendChild(wrap);
}

// Any screen that takes over the shared grid must orphan in-flight playlist and
// smart-playlist work. Two things go wrong otherwise: a late response paints
// its tiles over whatever screen is now showing, and fillPlaylistMosaics keeps
// firing a browse walk per playlist at the Core long after the user has left.
// Centralised so a future screen can call one thing instead of remembering
// four flags.
function leavePlaylistScreens() {
  playlistsActive = false;
  playlistDetailActive = false;
  smartWallActive = false;
  smartDetailActive = false;
  userPlDetailActive = false;
  // Smart Picks joins the same ritual: every screen entry point must orphan
  // an in-flight picks fetch, or its response paints into whatever opened
  // next. enterFullWall and showHome both call this, so adding it here covers
  // every route out of the screen at once.
  smartPicksActive = false;
  // The Playlists screen's Import button goes with the screen. Looked for
  // rather than asked of playlistsActive, which is already false here: the
  // button was left on Home whenever the way out didn't clear the bar itself.
  { const pc = document.getElementById("content-count");
    if (pc && pc.querySelector(".playlists-import")) { pc.innerHTML = ""; pc.classList.add("hidden"); } }
  playlistSeq++;
  smartSeq++;
  userPlSeq++;
  smartPicksSeq++;
}
window.__leavePlaylistScreens = leavePlaylistScreens;

// The wall's Focus / Sort / search live in the TOP BAR since v0.6.5, so a
// view that borrows the grid (the artist page) must take them with it, and
// hand them back with the wall.
// Every way off the wall goes through here: the controls leave the bar, an
// open filter closes, and the title the open field had hidden comes back —
// otherwise the NEXT screen's title stays hidden under .lib-filtering.
function hideLibraryControls() {
  const c = document.getElementById("library-controls");
  if (c) c.classList.add("hidden");
  hideLocalControls();   // the Music on device wall's row goes the same way (v0.7.4)
  const f = document.getElementById("library-filter");
  if (f) f.classList.add("hidden");
  if (libFilterOpen || libView.prefix) {
    if (libView.prefix) libPrefixDropped = true;
    libFilterOpen = false;
    libView.prefix = "";
  }
  const tb = document.querySelector(".topbar");
  if (tb) tb.classList.remove("lib-filtering", "lib-wall");
}
function leaveLibraryWall() {
  const was = libraryWallActive;
  libraryWallActive = false;
  hideLibraryControls();
  return was;
}
window.__leaveLibraryWall = leaveLibraryWall;
window.__restoreLibraryWall = (was) => {
  libraryWallActive = !!was;
  // The tiles that come back are the ones on screen when the wall was left.
  // If a filter was dropped on the way out they are FILTERED tiles under a
  // closed field — so read the wall again, unfiltered, rather than show them.
  const dropped = libPrefixDropped;
  libPrefixDropped = false;
  if (was) { if (dropped) applyLibView(); else renderLibraryControls(); }
};
window.__libraryWallSeq = () => libWall.seq;

async function fetchLibraryPage(mySeq, firstPage) {
  if (libWall.loading) return;   // a page is already in flight for this view
  libWall.loading = true;
  try {
    const r = await fetch(`/api/library/albums?offset=${libWall.offset}&count=${LIB_PAGE}&${libViewQuery()}`);
    // Left the wall (or re-entered, bumping seq) while the fetch was in
    // flight — this response belongs to a dead view; drop it silently.
    if (!libraryWallActive || mySeq !== libWall.seq) return;
    if (r.status === 503) {
      const j = await r.json().catch(() => ({}));
      if (!libraryWallActive || mySeq !== libWall.seq) return;
      if (firstPage) { grid.innerHTML = ""; setBanner(j.error || "Reading your music library…", true); }
      libWall.done = true;   // don't hammer while the index builds; re-enter to retry
      return;
    }
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    // Re-check after EVERY await: the body read is a second suspension point,
    // and a view change during it would otherwise get tiles appended into it.
    if (!libraryWallActive || mySeq !== libWall.seq) return;
    const albums = (j && j.albums) || [];
    if (firstPage) { grid.innerHTML = ""; setBanner(null); libWall.ext = null; }
    const frag = document.createDocumentFragment();
    for (const a of albums) frag.appendChild(keyLibraryTile(homeTile(a)));   // filter:null → offsets resolve; keyed as the contract's
    grid.appendChild(frag);
    // The letters typed asked of Qobuz and Tidal too (v0.6.24): their
    // artists and albums under the library's rows, kept at the end as
    // more pages come, gone with the filter.
    if (libWall.ext) grid.appendChild(libWall.ext);
    else if (firstPage && libView.prefix && window.__serviceSearchSections) {
      const q = libView.prefix;
      window.__serviceSearchSections(q).then(w => {
        if (!w || !libraryWallActive || mySeq !== libWall.seq || libView.prefix !== q) return;
        libWall.ext = w;
        grid.appendChild(w);
        if (!libWall.offset) setBanner(null);   // the library had nothing; the services have
      }).catch(() => {});
    }
    libWall.offset += albums.length;
    // End of library = a short (or empty) page; no separate total bookkeeping.
    libWall.done = albums.length < LIB_PAGE;
    libWall.total = (j && typeof j.total === "number") ? j.total : libWall.offset;
    if (firstPage) {
      setCountText("Library · " + libWall.total.toLocaleString() +
                   (libFocusCount() ? " matching" : "") + (libWall.total === 1 ? " album" : " albums"));
      if (!albums.length) setBanner("Nothing matches this focus — try clearing a filter.", false);
    }
  } catch (e) {
    if (!libraryWallActive || mySeq !== libWall.seq) return;
    if (firstPage) { grid.innerHTML = ""; setBanner("Couldn’t load: " + e.message, true); }
    // Mid-scroll page failure: leave what's loaded; the scroll handler will
    // retry the same offset on the next nudge.
  } finally {
    if (mySeq === libWall.seq) libWall.loading = false;
  }
}

let libFacets = null;   // cached /api/library/facets payload

function libSortOption(id) {
  return LIB_SORT_OPTIONS.find(x => x.id === (id || libView.sort)) || LIB_SORT_OPTIONS[0];
}
function libSortLabel() { return libSortOption().label; }
// What the arrow currently means, in words — used for the button's tooltip
// and screen-reader name only. The visible control is the arrow alone.
function libDirLabel() {
  const o = libSortOption();
  return libView.dir === "desc" ? o.desc : o.asc;
}

// Re-run the wall from page 1 with the current view options.
function applyLibView() {
  saveLibView();
  renderLibraryControls();
  libWall.seq++;
  const mySeq = libWall.seq;
  libWall.offset = 0; libWall.loading = false; libWall.done = false;
  const m = document.querySelector("main");
  if (m) m.scrollTop = 0;
  renderSkeletons(computeAlbumCount());
  fetchLibraryPage(mySeq, true);
}
