/* The page's core (app.js until v1.0.5), 8 of 33: Smart Picks left behind, and the Library wall's pages. */
// Any screen that takes over the shared grid must orphan an in-flight Smart
// Picks fetch, or its response paints into whatever opened next. enterFullWall
// and showHome both call this, so it covers every route out of the screen.
function leaveSmartPicks() {
  smartPicksActive = false;
  smartPicksSeq++;
}
window.__leaveSmartPicks = leaveSmartPicks;

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
// Any view that takes over the shared grid without going through showHome/
// showWall (labels browser, label deep-link, artist view) must call this so
// the wall's infinite scroll can't append library tiles into that view.
// Returns whether the wall WAS active, so a view that only borrows the grid
// (the artist view, which restores it on Back) can re-arm paging afterwards.
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
  // Back from an artist's page: the tiles and spacers came back as they were; drawn again
  // in case the screen changed meanwhile (library-window.js).
  if (was) { if (dropped) applyLibView(); else { renderLibraryControls(); libWin.later(); } }
};
window.__libraryWallSeq = () => libWall.seq;

// The wall's tiles, drawn a window at a time from libWall.items (library-window.js).
const libWin = libraryWindow({
  grid,
  scroller: document.querySelector("main"),
  items: () => libWall.items,
  live: () => libraryWallActive && !labelsActive,
  tile: (a) => keyLibraryTile(homeTile(a)),   // filter:null → offsets resolve; keyed as the contract's
  picked: (a) => albumSelected.some(x => x.offset === a.offset),
  opener: (a) => () => openAlbum(a, { source: "home", filter: null }),   // as homeTile opens it
  ext: () => libWall.ext || null,
});

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
    if (firstPage) { grid.innerHTML = ""; setBanner(null); libWall.ext = null; libWall.items = []; libWin.reset(); }
    // The albums kept; the tiles near the view drawn from them (library-window.js).
    for (const a of albums) libWall.items.push(a);
    libWin.draw();
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
