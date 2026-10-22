/* ------------------------------------------------------------------ */
/*  Artist albums view                                                 */
/* ------------------------------------------------------------------ */
(() => {
  const grid         = document.getElementById("album-grid");
  const countBar     = document.getElementById("content-count");
  const homeView     = document.getElementById("home-view");
  const homeSections = document.getElementById("home-sections");
  const topbarBack    = document.getElementById("topbar-back");
  const topbarRefresh = document.getElementById("topbar-refresh");
  const topbarSearch  = document.getElementById("topbar-search");
  // The artist's name and album count sit in the top bar beside ‹ (v0.6.5),
  // where every other screen has its title; they were a line above the grid.
  const titleEl       = document.getElementById("album-count");
  function setTitle(text) {
    if (!titleEl) return;
    titleEl.textContent = text || "";
    titleEl.classList.toggle("hidden", !text);
  }

  let artistViewActive = false;
  let saved            = null;   // snapshot of the screen we came from

  // opts.restore === false: the caller is building its OWN screen (Home, a
  // fresh wall) and has already reset the view flags — putting the captured
  // screen and its flags back would fight that, e.g. re-arming the library
  // wall's paging over a Home screen. Drop the snapshot instead.
  function exitArtistView(opts) {
    if (!artistViewActive) return;
    artistViewActive = false;
    bioSeq++;   // any in-flight bio must not prepend into the restored screen
    if (saved && opts && opts.restore === false) {
      saved = null;
      grid.innerHTML = "";
      // The artist view owns this bar; without clearing it, its "← Back"
      // button survives onto the screen the caller is about to show.
      if (countBar) { countBar.innerHTML = ""; countBar.classList.add("hidden"); }
      return;
    }
    // Restore exactly the screen the artist view was opened from (the Home
    // landing, or an album wall) so Back doesn't dump the user somewhere else.
    if (saved) {
      // Put the ORIGINAL NODES back — never re-parse an HTML string. Album
      // tiles carry their behaviour on the node itself (click + long-press
      // listeners, and a closure holding the album's offset/title used to open
      // and play it); serializing to markup and re-parsing drops all of that,
      // so the wall came back looking perfect with every tile dead. Moving live
      // nodes through a DocumentFragment keeps them intact — the same technique
      // the Qobuz/Tidal browser uses (see snapshotListInto/restoreSnapshot).
      grid.innerHTML = "";
      grid.appendChild(saved.gridNodes);
      grid.classList.toggle("hidden", saved.gridHidden);
      if (homeView)     homeView.classList.toggle("hidden", saved.homeViewHidden);
      if (homeSections) homeSections.classList.toggle("hidden", saved.homeSectionsHidden);
      if (countBar) {
        countBar.innerHTML = "";
        countBar.appendChild(saved.countNodes);
        countBar.classList.toggle("hidden", saved.countHidden);
      }
      if (topbarBack)    topbarBack.classList.toggle("hidden", saved.topbarBackHidden);
      if (topbarRefresh) topbarRefresh.classList.toggle("hidden", saved.topbarRefreshHidden);
      if (topbarSearch)  topbarSearch.classList.toggle("hidden", saved.topbarSearchHidden);
      if (titleEl) { titleEl.textContent = saved.titleText; titleEl.classList.toggle("hidden", saved.titleHidden); }
      // Re-arm the screens whose behaviour lives OUTSIDE the restored nodes:
      // the library wall's infinite scroll (parked on the way in, else it never
      // pages again) and the labels browser's chrome/mode.
      // Only re-arm the wall if nothing else entered it meanwhile (a fresh
      // entry bumps the sequence and owns the paging state now).
      const libSeqNow = window.__libraryWallSeq ? window.__libraryWallSeq() : 0;
      if (window.__restoreLibraryWall && saved.libraryWallSeq === libSeqNow) {
        window.__restoreLibraryWall(saved.libraryWallWasActive);
      }
      if (window.__unparkLabels) window.__unparkLabels(saved.labels);
      if (window.__unparkArtists) window.__unparkArtists(saved.artists);
      // The Music on device wall's Focus / Sort row, if that is what came back (v0.7.4).
      if (window.__restoreLocalControls) window.__restoreLocalControls();
      // Land back where the user was, not at the top of the wall.
      const mainEl = document.querySelector("main");
      if (mainEl && typeof saved.scrollTop === "number") mainEl.scrollTop = saved.scrollTop;
    }
    const back = saved && saved.fromAlbum;
    saved = null;
    // Opened from an album: back to that album, over the screen it was on.
    if (back && !(opts && opts.reopen === false) && window.__openAlbum) window.__openAlbum(back.album, back.opts);
  }
  // The brass Back beside the menu: while the artist view is up it steps back
  // out of it (to the album it came from), ahead of its usual "go Home".
  if (topbarBack) topbarBack.addEventListener("click", (e) => {
    if (!artistViewActive) return;
    e.stopImmediatePropagation();
    exitArtistView();
  }, true);

  async function showArtistAlbums(artistName, how) {
    const fromAlbum = (how && how.fromAlbum) || null;
    if (window.__leavePlaylistScreens) window.__leavePlaylistScreens();
    if (!artistName) return;
    if (typeof nativeArtistOpened === "function" && nativeArtistOpened(artistName)) return;   // the Android app's own page (item 52)
    // Drop any active/pending search (incl. the delayed external-sources fetch)
    // — reachable from the album-modal artist link with a search still live,
    // which would otherwise append external rows under this view's grid. The
    // search artist-chip stops the search itself; this covers every other path.
    if (window.__clearSearchIfActive) window.__clearSearchIfActive();
    // Artist → album → artist chaining: put the FIRST screen back before
    // capturing, so what we snapshot below is the real originating screen (and
    // its live view flags), not a half-torn-down artist view.
    if (artistViewActive) exitArtistView({ reopen: false });
    // The artist view takes over the shared grid (and snapshot-restores it on
    // Back) — park the library wall's infinite scroll so it can't append into
    // this view, remembering whether it was live so Back can re-arm it.
    const libraryWallWasActive = window.__leaveLibraryWall ? !!window.__leaveLibraryWall() : false;
    const libraryWallSeq = window.__libraryWallSeq ? window.__libraryWallSeq() : 0;
    // Same for the labels browser: park its chrome (bar, sheets, select modes)
    // but keep the mode/label it was showing so Back restores it whole.
    const labels = window.__parkLabels ? window.__parkLabels() : null;
    // And the Artists wall (item 130): it stops paging into this view, and comes back as it was.
    const artists = window.__parkArtists ? window.__parkArtists() : null;
    // A multi-select started on the previous wall must not leak in here — its
    // action bar would stay on screen and this view's tiles would select
    // instead of open. Runs BEFORE the capture so the restored screen comes
    // back with its selection cleared in both the DOM and the state.
    if (window.__exitAlbumSelectMode) window.__exitAlbumSelectMode();
    // Invalidate any in-flight bio fetch NOW — bumping only inside
    // renderArtistBioHead left a window where artist A's late bio could
    // prepend into artist B's freshly-rendered grid.
    bioSeq++;
    // Snapshot the screen we're leaving (Home landing or an album wall) so the
    // "← Back" button restores it exactly.
    // Move the live nodes out into fragments rather than copying markup — see
    // exitArtistView for why (tile listeners + album identity live on the nodes).
    // Read the scroll position BEFORE the grid is drained. Moving every tile
    // out collapses <main> to a couple of hundred pixels, and a scroller that
    // no longer has the range CLAMPS its scrollTop to 0 there and then — so
    // reading it after the drain stored 0 every time, and the restore below
    // faithfully put 0 back. The comment at the bottom of exitArtistView has
    // always said "land back where the user was"; it never could.
    const mainEl = document.querySelector("main");
    const savedScrollTop = mainEl ? mainEl.scrollTop : 0;
    const gridNodes = document.createDocumentFragment();
    while (grid.firstChild) gridNodes.appendChild(grid.firstChild);
    const countNodes = document.createDocumentFragment();
    if (countBar) while (countBar.firstChild) countNodes.appendChild(countBar.firstChild);
    saved = {
      gridNodes,
      countNodes,
      libraryWallWasActive,
      libraryWallSeq,
      labels,
      artists,
      scrollTop:          savedScrollTop,
      gridHidden:         grid.classList.contains("hidden"),
      homeViewHidden:     homeView     ? homeView.classList.contains("hidden")     : true,
      homeSectionsHidden: homeSections ? homeSections.classList.contains("hidden") : true,
      countHidden:        countBar ? countBar.classList.contains("hidden") : true,
      topbarBackHidden:    topbarBack    ? topbarBack.classList.contains("hidden")    : true,
      topbarRefreshHidden: topbarRefresh ? topbarRefresh.classList.contains("hidden") : true,
      topbarSearchHidden:  topbarSearch  ? topbarSearch.classList.contains("hidden")  : true,
      titleText:           titleEl ? titleEl.textContent : "",
      titleHidden:         titleEl ? titleEl.classList.contains("hidden") : true,
      fromAlbum,
    };
    artistViewActive = true;
    // Reveal the shared album grid and leave the Home landing / search results.
    // The search artist-chip calls stopSearch() first, which hides the grid and
    // re-shows the Home sections; without this the artist albums would render
    // into a hidden grid behind the Home rows (the reported bug).
    if (homeView)     homeView.classList.add("hidden");
    if (homeSections) homeSections.classList.add("hidden");
    grid.classList.remove("hidden");
    // The shared Back — the brass < beside the menu, as on every other screen
    // (v0.6.0-RC11; it was a "← Back" button of its own) — takes this view
    // back (see the listener below); Refresh and Search don't belong here.
    if (topbarBack)    topbarBack.classList.remove("hidden");
    if (topbarRefresh) topbarRefresh.classList.add("hidden");
    if (topbarSearch)  topbarSearch.classList.add("hidden");

    // The name at once; the count when the albums come.
    setTitle(artistName);
    if (countBar) { countBar.innerHTML = ""; countBar.classList.add("hidden"); }
    grid.innerHTML = "";

    // Everything of theirs in your library (v0.7.4): the server's albums —
    // your files and the Qobuz and Tidal ones — and the music on this phone,
    // which the server never sees, under its own heading. The phone's part
    // stands even when the server can't be asked.
    const mine = window.__phoneAlbumsByArtist ? window.__phoneAlbumsByArtist(artistName) : [];
    let j = { primary: [], featured: [] }, failed = null;
    try {
      const r = await fetch("/api/artist-albums?artist=" + encodeURIComponent(artistName));
      if (!r.ok) throw new Error("HTTP " + r.status);
      j = await r.json();
      j.primary = j.primary || []; j.featured = j.featured || [];
    } catch (e) { failed = e; }
    if (!artistViewActive) return;
    try {
      const total = j.primary.length + j.featured.length + mine.length;

      setTitle(total + " album" + (total !== 1 ? "s" : "") + " · " + artistName);

      if (!total) {
        if (failed) throw failed;
        grid.innerHTML = `<div class="artist-view-empty" data-parity="artist.empty">No albums found for "${artistName}"</div>`;
        // Who they are all the same: a band's member opened from its page may have nothing of their own here.
        renderHead(artistName, "", new Set());
        return;
      }

      const frag = document.createDocumentFragment();
      const header = (text) => {
        const hdr = document.createElement("div");
        hdr.className = "artist-section-header"; hdr.dataset.parity = "artist.section";
        hdr.textContent = text;
        frag.appendChild(hdr);
      };

      if (j.primary.length) {
        if (j.featured.length || mine.length) header("Albums");
        for (const a of j.primary) {
          frag.appendChild(window.__keyArtistTile(window.__buildAlbumTile(a)));
        }
      }

      if (mine.length) {
        if (j.primary.length || j.featured.length) header("On this phone");
        for (const a of mine) frag.appendChild(window.__keyArtistTile(window.__buildAlbumTile(a)));
      }

      if (j.featured.length) {
        const hdr = document.createElement("div");
        hdr.className = "artist-section-header"; hdr.dataset.parity = "artist.section";
        hdr.textContent = "Also appears on";
        frag.appendChild(hdr);
        for (const a of j.featured) {
          frag.appendChild(window.__keyArtistTile(window.__buildAlbumTile(a)));
        }
      }

      grid.appendChild(frag);

      // Artist header (avatar + validated bio) loads after the albums so the
      // grid is never blocked on external services. One of the artist's own
      // album titles pins their identity for the lookup (see /api/artist-bio).
      const bioAlbum = (j.primary[0] && j.primary[0].title) ||
                       (j.featured[0] && j.featured[0].title) || (mine[0] && mine[0].title) || "";
      renderHead(artistName, bioAlbum, new Set(j.primary.concat(j.featured).map(a => a.offset)));
      if (failed) throw failed;   // the phone's albums are up; the server's absence is still said
    } catch (e) {
      if (countBar) {
        countBar.classList.remove("hidden");
        countBar.innerHTML = `
            <span class="count-text" style="color:var(--danger)" data-parity="artist.error">Error: ${e.message}</span>`;
        }
    }
  }

  // Who they are, at the head of the page (artist-about.js, bug list item 131):
  // after the albums, so the grid is never held up by other services; a
  // view or artist switched before the answers come draws nothing.
  let bioSeq = 0;
  function renderHead(artistName, pin, shown) {
    const seq = bioSeq;   // generation is bumped by showArtistAlbums/exitArtistView, not here
    if (window.__renderArtistHead) window.__renderArtistHead(artistName, pin, grid, () => seq === bioSeq && artistViewActive, shown);
  }

  window.__showArtistAlbums = showArtistAlbums;
  window.__exitArtistView   = exitArtistView;
  window.__artistViewActive = () => artistViewActive;
})();
