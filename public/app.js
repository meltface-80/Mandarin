/*
 * Random Albums — frontend
 *
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 */

(() => {
  /*
   * TWO ZOOM HACKS USED TO LIVE HERE. Both are gone (v1.8.42), with the
   * viewport meta's `maximum-scale=1,user-scalable=no`, and the reasons are
   * worth keeping because each of them made a real bug.
   *
   * 1. `gesturestart/gesturechange/gestureend` were preventDefault()ed to
   *    re-impose the pinch-zoom block that iOS Safari refuses to honour from
   *    the viewport meta. IT WORKED, AND THAT WAS THE PROBLEM: pinching is the
   *    only way a person can get a mis-scaled page back, so with this in place
   *    a page that came back from a rotation at the wrong scale could not be
   *    recovered at all. That is exactly the reported symptom — "force closing
   *    is the only way to restore function". The app took away the escape.
   *
   * 2. A `touchend` that preventDefault()ed any tap within 320ms of the last
   *    one, to suppress double-tap zoom. preventDefault on touchend CANCELS
   *    THE CLICK, so this also turned "that tap did nothing" into "nothing
   *    works": somebody whose first tap misses taps again straight away, and
   *    every impatient repeat was cancelled by this. It could only ever make a
   *    dead-feeling screen deader.
   *
   * Neither was buying anything. Double-tap-to-zoom is already off the correct
   * way — `touch-action: manipulation` on html/body in style.css — which
   * suppresses the double-tap gesture WITHOUT disabling pinch. The two hacks
   * were belt-and-braces over a rule that was already doing the job properly,
   * and between them they cost the user every way out of a bad frame.
   *
   * test/static/viewport-scale.test.js keeps them from coming back.
   *
   * MusicD Server DOES block zoom (asked for: no pinch, no double-tap), and
   * does it without either trap above:
   *   - the viewport meta says maximum-scale=1,user-scalable=no, and every
   *     element has touch-action: pan-x pan-y (style.css) — that is all
   *     Android and desktop browsers need, and it stops double-tap on iOS;
   *   - iOS Safari ignores the meta for pinching, so gesturestart is
   *     cancelled — and because that takes away the way out of a page left
   *     at the wrong scale, the page puts ITSELF back to 1:1 whenever it
   *     finds itself scaled (after a rotation, a keyboard, anything), by
   *     re-applying the viewport meta. Nobody ever needs to pinch out.
   *   - touchend is never cancelled, so no tap is ever lost.
   */
  {
    const vpMeta = document.querySelector('meta[name="viewport"]');
    const vpContent = vpMeta ? vpMeta.getAttribute("content") : "";
    const unscale = () => {
      const vv = window.visualViewport;
      if (!vpMeta || !vv || Math.abs(vv.scale - 1) < 0.01) return;
      vpMeta.setAttribute("content", vpContent.replace("initial-scale=1", "initial-scale=1.0001"));
      setTimeout(() => vpMeta.setAttribute("content", vpContent), 60);
    };
    const settle = () => { unscale(); setTimeout(unscale, 350); setTimeout(unscale, 1000); };
    ["gesturestart", "gesturechange"].forEach(t =>
      document.addEventListener(t, (e) => { e.preventDefault(); }, { passive: false }));
    window.addEventListener("orientationchange", settle, { passive: true });
    window.addEventListener("pageshow", settle, { passive: true });
    if (window.visualViewport) window.visualViewport.addEventListener("resize", settle, { passive: true });
    document.addEventListener("focusout", () => setTimeout(unscale, 300), { passive: true });
  }

  /* ------------------------------------------------------------------
   * THE WINDOW MUST NEVER BE SCROLLED. Keep it pinned.
   *
   * This is the iOS home-screen-app freeze, found with the instrument rather
   * than guessed at — v1.8.40 and v1.8.42 each shipped a theory and each was
   * wrong. What the readout actually said, from a phone with dead buttons:
   *
   *     win 440x894   doc 440x894          the layout viewport is NOT stale
   *     vv  440x894 scale=1                the page is NOT scaled
   *     vv off=0,62   page=0,62
   *     scrollXY 0,62                <---- THE WINDOW IS SCROLLED 62px
   *     every tap: top=img#modal-img
   *
   * The buttons were never dead. The window had scrolled down 62 pixels, so
   * hit-testing ran 62px below the paint: a press on the Back button at
   * (35, 31) was tested at (35, 93) and landed on the album artwork, which
   * does nothing. Every control on every screen behaves that way at once,
   * which is why it reads as "nothing works" rather than as a misplaced tap.
   * 62px is this device's top safe-area inset, and the app is only standalone
   * — `viewport-fit=cover` with live insets — in a home-screen app, which is
   * why Safari and Chrome on the same phone were fine.
   *
   * SO THIS IS NOT A WORKAROUND FOR A SCROLL: it enforces an invariant the app
   * already declares. `html, body { overflow: hidden }` and the shell is
   * `position: fixed`; only <main> scrolls, and it scrolls itself. A non-zero
   * window scroll is therefore not a state this app has, at any size, on any
   * screen — so snapping it back cannot discard a position anybody wanted.
   *
   * THE ONE EXCEPTION IS A FOCUSED TEXT FIELD. iOS scrolls the window to lift
   * an input clear of the keyboard, and fighting that would park the field
   * under the keys — trading a bug nobody can see for one everybody can.
   * ------------------------------------------------------------------ */
  const pinWindow = () => {
    if (!window.scrollX && !window.scrollY) return;
    const el = document.activeElement;
    const tag = el && el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (el && el.isContentEditable)) return;
    window.scrollTo(0, 0);
    // All three, because Safari has historically moved one scroller and not
    // another, and a half-reset offset is the same bug at a smaller number.
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  };
  window.addEventListener("scroll", pinWindow, { passive: true });
  window.addEventListener("pageshow", pinWindow, { passive: true });
  /*
   * A rotation is not an instant: iOS fires orientationchange before the web
   * view has finished resizing, and the offset appears as it settles — the
   * instrument had to sample a turn three times for the same reason. One
   * check on the event would run before the thing it is checking for exists.
   */
  const pinAfterSettle = () => { pinWindow(); setTimeout(pinWindow, 300); setTimeout(pinWindow, 1000); };
  window.addEventListener("orientationchange", pinAfterSettle, { passive: true });
  window.addEventListener("resize", pinAfterSettle, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", pinAfterSettle, { passive: true });
    window.visualViewport.addEventListener("scroll", pinWindow, { passive: true });
  }
  window.__pinWindow = pinWindow;

  const grid       = document.getElementById("album-grid");
  const refreshBtn = document.getElementById("refresh-btn");
  const zoneSel    = document.getElementById("zone-select");
  const banner     = document.getElementById("status-banner");
  const toast      = document.getElementById("toast");

  const modal       = document.getElementById("album-modal");
  const modalImg    = document.getElementById("modal-img");
  const modalSource = document.getElementById("modal-source");
  // Same rule as the tiles: badge only on confirmed local files, and clear it
  // on every open so a previous album's badge can't linger.
  function setModalSource(album) {
    if (!modalSource) return;
    const kind = album && (album.source || (album.local ? "local" : null));
    const label = { local: "Local albums", qobuz: "Qobuz", tidal: "Tidal" }[kind];
    modalSource.className = "album-source" + (label ? " " + kind : " hidden");
    if (label) { modalSource.title = label; modalSource.setAttribute("aria-label", label); }
    // Same badge as the tiles, on the album's own artwork. Cleared on every
    // open for the same reason: a previous album's rate lingering on a new
    // cover would be a confident, wrong statement about the file.
    const mq = document.getElementById("modal-quality");
    if (!mq) return;
    const q = album && album.quality;
    mq.className = "album-quality" + (q ? (album.hires ? " is-hires" : "") : " hidden");
    mq.textContent = q || "";
    if (q) {
      const words = /\//.test(q) ? q.split("/")[0] + "-bit, " + q.split("/")[1] + " kHz" : q;
      mq.title = words;
      mq.setAttribute("aria-label", words);
    }
  }

  // ----- Booklets (v0.8.33) ------------------------------------------------
  // The PDFs that came with an album, their pages drawn by the C# server
  // (Booklets.cs): the book on the cover when it has any, and its pages over
  // the album page, one under another (the Node server never had them).
  const bookletBtn = document.getElementById("modal-booklet");
  let booklets = [];
  let bookletViewer = null, bookletBack;
  function resetBooklets() {
    booklets = [];
    if (bookletBtn) bookletBtn.classList.add("hidden");
    closeBooklet();
  }
  async function loadBooklets(album) {
    if (!bookletBtn || currentSource === "now-playing" || typeof album.offset !== "number" || (album.source && album.source !== "local")) return;
    let list = [];
    try {
      const r = await fetch(`/api/album/booklets?offset=${album.offset}`, { cache: "no-store" });
      if (r.ok) list = (await r.json()).booklets || [];
    } catch (e) { /* none to show, then */ }
    // Another album opened while this was asked: not this one's book.
    if (album !== currentAlbum || !list.length) return;
    booklets = list;
    const label = list.length === 1 ? "Booklet" : `${list.length} booklets`;
    bookletBtn.title = label;
    bookletBtn.setAttribute("aria-label", label);
    bookletBtn.classList.remove("hidden");
  }
  if (bookletBtn) bookletBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const album = currentAlbum;
    if (!album || !booklets.length) return;
    if (booklets.length === 1) { openBooklet(album, booklets[0]); return; }
    const list = booklets.slice();
    openLibSheet("Booklets", (body, close) => {
      for (const b of list) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "action-btn sheet-row";
        row.textContent = `${b.name} · ${b.pages} page${b.pages === 1 ? "" : "s"}`;
        row.addEventListener("click", () => { close(); openBooklet(album, b); });
        body.appendChild(row);
      }
    });
  });
  function openBooklet(album, b) {
    if (!bookletViewer) {
      bookletViewer = document.createElement("div");
      bookletViewer.className = "booklet-viewer hidden";
      bookletViewer.id = "booklet-viewer";
      bookletViewer.setAttribute("role", "dialog");
      bookletViewer.innerHTML =
        '<div class="booklet-head">' +
          '<button class="booklet-close icon-btn" type="button" aria-label="Close booklet" title="Close">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button><div class="booklet-title"></div><div class="booklet-count"></div>' +
        '</div><div class="booklet-pages"></div>';
      bookletViewer.querySelector(".booklet-close").addEventListener("click", closeBooklet);
      // Over everything but the sheets and the toasts, the transport bar included:
      // a page is read whole (style.css .booklet-viewer).
      document.body.appendChild(bookletViewer);
    }
    const pages = bookletViewer.querySelector(".booklet-pages");
    const count = bookletViewer.querySelector(".booklet-count");
    bookletViewer.querySelector(".booklet-title").textContent = b.name;
    bookletViewer.setAttribute("aria-label", b.name);
    bookletViewer.classList.remove("hidden");
    pages.innerHTML = "";
    pages.scrollTop = 0;
    // Drawn as wide as it's shown, on this screen's pixels (the server keeps a few widths).
    const w = Math.round(Math.min(pages.clientWidth || window.innerWidth, 1100) * (window.devicePixelRatio || 1));
    // The page counted is the topmost one mostly in view (two short pages can both be).
    const inView = new Set();
    const seen = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const n = Number(en.target.dataset.page);
        if (en.isIntersecting) inView.add(n); else inView.delete(n);
      }
      if (inView.size) count.textContent = `${Math.min(...inView)} / ${b.pages}`;
    }, { root: pages, threshold: 0.5 });
    for (let p = 1; p <= b.pages; p++) {
      const img = document.createElement("img");
      img.className = "booklet-page";
      img.alt = `Page ${p}`;
      img.dataset.page = String(p);
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("load", () => { if (img.naturalWidth) img.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`; }, { once: true });
      img.src = `/api/booklet/page?offset=${album.offset}&id=${encodeURIComponent(b.id)}&page=${p}&w=${w}`;
      pages.appendChild(img);
      seen.observe(img);
    }
    bookletViewer.__seen = seen;
    count.textContent = `1 / ${b.pages}`;
    // The phone's Back closes the booklet first, then the album as before.
    if (bookletBack === undefined) {
      bookletBack = window.__musicdBack || null;
      window.__musicdBack = () => { closeBooklet(); return true; };
    }
  }
  function closeBooklet() {
    if (bookletBack !== undefined) { window.__musicdBack = bookletBack || undefined; bookletBack = undefined; }
    if (!bookletViewer || bookletViewer.classList.contains("hidden")) return;
    if (bookletViewer.__seen) { bookletViewer.__seen.disconnect(); bookletViewer.__seen = null; }
    bookletViewer.classList.add("hidden");
    bookletViewer.querySelector(".booklet-pages").innerHTML = "";
  }
  // Escape closes the booklet before anything under it sees the key.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !bookletViewer || bookletViewer.classList.contains("hidden")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeBooklet();
  }, true);

  const modalTitle  = document.getElementById("modal-title");
  const modalSub    = document.getElementById("modal-subtitle");
  const modalActs   = document.getElementById("modal-actions");
  const modalTracks = document.getElementById("modal-tracks");

  const selMenuWrap          = document.getElementById("select-menu-wrap");
  const selMenuBtn           = document.getElementById("select-menu-btn");
  const selMenu              = document.getElementById("select-menu");
  const selMenuTitle         = document.getElementById("select-menu-title");
  const selCount             = document.getElementById("select-count");
  const albumActionBar       = document.getElementById("album-action-bar");
  const albumActionInfo      = document.getElementById("album-action-info");
  const albumActionCancelBtn = document.getElementById("album-action-cancel-btn");

  let currentAlbum = null;         // {offset,title,subtitle,image_key}
  let zones = [];
  let selectedZoneId = null;

  // How many albums a phone wall asks for.
  //
  // The random wall used to MEASURE the screen and shrink its artwork until
  // exactly four rows fit without scrolling — the app's original "a screenful
  // of random albums". That made it the one wall whose tiles were a different
  // size from every other, which is the difference this replaced: every wall
  // now uses the same natural third-of-width artwork as the Library, and they
  // scroll. Three screens' worth, so there is something to scroll to.
  //
  // Declared BEFORE the computeAlbumCount() call on the next line — a `const`
  // referenced from that call while still in its temporal dead zone throws and
  // aborts the whole app (blank screen).
  const PHONE_WALL_COUNT = 24;
  let albumCount = computeAlbumCount();
  // Whether the Library wall's filter field is open, and whether a filter was
  // dropped by leaving the wall (so the wall re-reads unfiltered when it comes
  // back). Up here because showHome(), showWall() and enterFullWall() reach
  // them through hideLibraryControls(): a `let` read above its declaration is
  // a startup crash.
  let libFilterOpen = false;
  let libPrefixDropped = false;
  let labelsActive = false;        // viewing the record-label browser?
  let unplayedWallActive = false;  // viewing the full "Not played in 6 months" grid?
  let libraryWallActive = false;   // viewing the full A-Z library grid?
  // Declared up here with the other view flags, NOT beside showPlaylists():
  // showHome() and enterFullWall() read them and both can run during boot,
  // which with a `let` further down the file is a ReferenceError, not a
  // harmless undefined (CLAUDE.md: declaration before use).
  let smartWallActive = false;      // viewing the smart-playlist wall?
  let smartDetailActive = false;    // viewing one smart playlist's tracks?
  let smartSeq = 0;                 // orphans in-flight smart-playlist fetches
  let userPlDetailActive = false;   // viewing one stored playlist?
  let userPlSeq = 0;                // orphans in-flight stored-playlist fetches
  let playlistsActive = false;      // viewing the Roon playlist list?
  let playlistDetailActive = false; // viewing one playlist's tracks?
  let playlistSeq = 0;              // orphans in-flight playlist fetches
  let smartPicksActive = false;     // viewing the Smart Picks screen?
  let smartPicksSeq = 0;            // orphans in-flight Smart Picks fetches
  // How long a report about a long-running queue fill stays up (vs showToast's
  // 2.4s default). Declared here rather than beside showToast() for the same
  // reason as the flags above — a `const` further down the file is a TDZ
  // ReferenceError to anything that reads it first.
  const TOAST_REPORT_MS = 9000;
  // Most albums one Play now / Queue / Send to Roon can take. Matches the
  // server's ceiling in /api/smart-playlist/albums — asked for explicitly so
  // the server's 100 default can't silently apply, which is exactly what made
  // a 1,179-album playlist queue 100 and report success (v1.7.17).
  const SMART_SEND_MAX = 400;
  // Most albums a Share will expand before it stops. Each one costs ~5 Roon
  // browse calls to read its tracks, so this is a time budget, not a taste
  // judgement: 100 albums is roughly 500 calls. The sheet always reports what
  // it left out (v1.7.17's lesson — a silent cap reads as success).
  const SHARE_ALBUM_MAX = 100;
  // Set by addLongPress and consumed by the very next click, so a long press
  // doesn't also fire the element's ordinary tap handler.
  let longPressAte = false;
  // Track multi-select inside the album view. Declared with the other view
  // flags rather than beside the album-modal code: closeModal() reads them
  // during boot-time teardown, and a `let` further down the file is a
  // ReferenceError there, not a harmless undefined.
  let trackSelectMode = false;
  let trackSelected = [];          // [{index,title}] within the open album
  let albumSelectMode = false;
  let albumSelected = [];          // [{offset,title,subtitle}] albums chosen in select mode
  // The filter that the currently-open album modal belongs to. Usually the
  // active genre/tag filter, but a per-open override is used for label albums
  // so detail + play resolve offsets against the right list.
  let currentDetailFilter = null;

  // ----- Album filter (genre / tag) -----
  // null, or { type: "genre"|"tag", value: "<title>" }. Offsets in album
  // picks are positions *within the filtered list*, so the same filter must
  // accompany every /api/album and /api/play call.
  let activeFilter = null;
  try {
    const f = JSON.parse(localStorage.getItem("rra-filter") || "null");
    if (f && f.type && f.value) activeFilter = f;
  } catch (e) { /* corrupt localStorage entry — start with no filter */ }
  function filterQSOf(f) {
    if (!f) return "";
    return "&filter_type=" + encodeURIComponent(f.type) +
           "&filter_value=" + encodeURIComponent(f.value) +
           (f.parent ? "&filter_parent=" + encodeURIComponent(f.parent) : "");
  }
  function filterQS() { return filterQSOf(activeFilter); }

  // ----- The look -----
  // One theme since v0.5.19: Mandarin (dark). <html> carries
  // data-theme="dark" data-palette="hifi" from the markup; the earlier
  // picker, its stored choice (rra-theme-v2) and Mandarin Light are gone.
  // The browser chrome colour is the top bar's, which is --bg: read it back
  // off the applied palette rather than keeping a second hex.
  (function applyLook() {
    document.documentElement.dataset.theme   = "dark";
    document.documentElement.dataset.palette = "hifi";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      if (bg) meta.setAttribute("content", bg);
    }
  })();

  // ----- Sizing -----
  // Returns a fixed album count that exactly fills the responsive grid:
  //   Phone portrait   → 3 cols × measured rows (min 3×3 = 9, capped at 96)
  //   Tablet portrait  → 5×4  = 20
  //   Tablet landscape → 7×3  = 21
  //   Desktop          → 9×5  = 45

  // Measure the phone wall: return { rows, art } — the largest square art size
  // that lets `rows` rows fit the visible content box without scrolling. When
  // the wall is width-limited, art is the natural third-of-width (no shrink);
  // when height-limited, art shrinks so the target rows still fit. Falls back
  // to 3 rows if 4 can't fit at a reasonable size.
  function computeAlbumCount() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const isLandscape = w > h;
    const minDim = Math.min(w, h);  // smallest dimension identifies phones vs tablets

    // Phone (narrowest side < 768 px): 3 columns of natural third-of-width
    // artwork, the same as every other wall, and it scrolls.
    if (minDim < 768) return PHONE_WALL_COUNT;

    // Desktop (width ≥ 1200 px), tablet (768–1199 px): a screenful of rows at
    // the column count UI Settings has given the grid (v0.6.5).
    const cols = window.__uiPrefs ? window.__uiPrefs.cols() : (w >= 1200 ? 9 : isLandscape ? 7 : 5);
    if (w >= 1200) return cols * 5;       // 9×5 by default
    return cols * (isLandscape ? 3 : 4);  // 7×3 or 5×4 by default
  }

  // The random wall again, when UI Settings changes its columns: the same
  // guards as a resize, without the phone-only limit (every size has a count).
  window.__refreshWallCount = () => {
    if (labelsActive || unplayedWallActive || libraryWallActive) return;
    if (window.__artistViewActive && window.__artistViewActive()) return;
    if (homeView && !homeView.classList.contains("hidden")) return;
    if (window.__searchActive && window.__searchActive()) return;
    if (grid.classList.contains("hidden")) return;
    if (computeAlbumCount() !== albumCount) loadRandom();
  };

  // A viewport change (Safari chrome collapsing, iPad split view) can change how
  // many albums are worth holding. Debounced, and only for the RANDOM wall — it
  // must not fire while Home, an active search, the labels browser, the artist
  // view or the "Not played" grid are showing, because loadRandom() would
  // silently replace their content with something else entirely.
  let _wallResizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(_wallResizeTimer);
    _wallResizeTimer = setTimeout(() => {
      if (labelsActive || unplayedWallActive || libraryWallActive) return;
      // The artist view owns the grid too — without this, a phone rotation (or
      // Safari collapsing its toolbar mid-scroll) replaced the discography with
      // a random wall while the header still said the artist's name.
      if (window.__artistViewActive && window.__artistViewActive()) return;
      if (homeView && !homeView.classList.contains("hidden")) return;
      if (window.__searchActive && window.__searchActive()) return;
      if (Math.min(window.innerWidth, window.innerHeight) >= 768) return;
      const next = computeAlbumCount();
      // Nothing to rescale any more — the tiles are a plain third of the width
      // at every size. Only a genuinely different count is worth a refetch.
      if (next !== albumCount) loadRandom();
    }, 250);
  });

  // ----- Home landing view -----
  const homeView     = document.getElementById("home-view");
  const homeSections = document.getElementById("home-sections");
  const homeUnplayed = document.getElementById("home-unplayed");
  const homeToday    = document.getElementById("home-today");
  const homeRandom   = document.getElementById("home-random");
  const homeLibrary  = document.getElementById("home-library");
  const homeLotw     = document.getElementById("home-lotw");
  const homePicks    = document.getElementById("home-picks");
  const homeHistory  = document.getElementById("home-history");
  const homeGenres   = document.getElementById("home-genres");
  const topbarBack   = document.getElementById("topbar-back");
  const topbarRefresh = document.getElementById("topbar-refresh");
  const topbarSearch  = document.getElementById("topbar-search");
  let homeSectionsLoaded = false;
  let homeLotwLoaded = false;   // set once the label-of-the-week row populates
  // The ORDER the Library row currently holds, or "" for nothing loaded yet.
  //
  // This was a boolean — "the row has tiles, never load it again", on the
  // reasoning that the library only changes when the library changes. But the
  // row's order is the wall's Sort setting, and that changes whenever the user
  // says so: with a boolean the row stayed "fresh" for the session and a new
  // sort never reached Home. Keyed by the order instead, so choosing a new one
  // makes the row stale exactly like new content would.
  let homeLibraryKey = "";
  // Smart Picks are built once a day on the server. The row is retried on each
  // Home visit until it populates (the first build runs in the background and
  // can take a minute), then left alone — the set does not change again today.
  let homePicksDay = "";
  let homeHistoryLoaded = false;  // set once the recently-played row populates
  let homeFavouritesLoaded = false;
  const homeFavourites = document.getElementById("home-favourites");
  let homeLaterLoaded = false;
  const homeLater = document.getElementById("home-later");
  let homePlaylistsLoaded = false;
  const homePlaylists = document.getElementById("home-playlists");

  // ---------------------------------------------------------------------------
  // The Home rows, as one table.
  //
  // Every row's identity, its title, the node it lives in, how to load it and
  // when it is stale, in one place. The Home screen loops it, the Home Screen
  // settings page renders from it, and the server validates against the same
  // id list — so a row cannot exist in one of those and not the others. Same
  // reasoning as the theme table.
  //
  // `load` is called when the row is enabled and `isFresh()` says otherwise.
  // A DISABLED row is never loaded, which is the whole point: hiding a row has
  // to stop the work behind it, not just the paint.
  // ---------------------------------------------------------------------------
  // Downloaded albums: the Android app's own row — downloads live on the
  // phone, so only the app (which has the bridge) has one. Browsers and the
  // iPhone home-screen app never see it.
  const DL = window.MusicdDownloads || null;
  function downloadedIds() {
    try { return DL ? JSON.parse(DL.ids()) || [] : []; } catch (e) { return []; }
  }
  // Every album on the phone or on its way, with progress (older apps: the
  // finished ones only).
  function downloadList() {
    if (!DL) return [];
    try {
      if (typeof DL.all === "function") return JSON.parse(DL.all()) || [];
    } catch (e) { /* fall through */ }
    return downloadedIds().map(id => ({ id, state: "done" }));
  }
  const downloadAlbums = new Map();   // id → album, as the server listed it
  let homeDownloads = null;
  let homeDownloadsKey = null;
  if (DL && homeSections) {
    const sec = document.createElement("div");
    sec.className = "home-section home-section-downloads hidden";
    sec.dataset.row = "downloads";
    sec.innerHTML = '<h2 class="home-section-title home-section-link" role="button" tabindex="0">Downloaded albums</h2>' +
      '<div class="home-carousel"></div>';
    // The header opens every downloaded album as a wall, like the other rows.
    sec.querySelector("h2").addEventListener("click", () => showDownloadsWall());
    homeSections.prepend(sec);
    homeDownloads = sec.querySelector(".home-carousel");
  }
  const downloadsKey = list => list.map(d => d.id + ":" + d.state + ":" + (d.done || 0)).join(",");
  function downloadBadge(d) {
    if (d.state === "done") return null;
    if (d.state === "away") return "Card out";
    if (d.state === "downloading") return "↓ " + (d.done || 0) + "/" + (d.total || "?");
    if (d.state === "failed") return "Failed";
    if (d.state === "waiting") return "Waiting";
    return "Queued";
  }
  let loadingDownloads = null;
  async function loadHomeDownloads() {
    if (!homeDownloads) return;
    // One at a time; a change arriving meanwhile gets one more pass after.
    if (loadingDownloads) { loadingDownloads.again = true; return; }
    loadingDownloads = { again: false };
    try {
      const list = downloadList();
      const key = downloadsKey(list);
      if (!list.length) {
        homeDownloadsKey = key;
        homeDownloads.innerHTML = '<div class="home-carousel-empty">Nothing downloaded yet — on an album, ⋯ → Download to this phone.</div>';
        return;
      }
      if (!rowHasContent(homeDownloads)) homeDownloads.innerHTML = '<div class="home-carousel-empty">Loading…</div>';
      const frag = await downloadTiles(list);
      homeDownloads.innerHTML = "";
      homeDownloads.appendChild(frag);
      homeDownloadsKey = key;
    } catch (e) {
      if (!rowHasContent(homeDownloads)) homeDownloads.innerHTML = '<div class="home-carousel-empty">Couldn’t load.</div>';
    } finally {
      const again = loadingDownloads.again;
      loadingDownloads = null;
      applyHomeLayout();
      if (again) loadHomeDownloads();
    }
  }
  // Tiles for albums on the phone. The server's own album where it has it;
  // one it doesn't know right now (its folder missing for a while) still shows,
  // from what the phone kept, and plays from the phone.
  async function downloadTiles(list) {
    const missing = list.map(d => d.id).filter(id => !downloadAlbums.has(id));
    if (missing.length) {
      try {
        const r = await fetch("/api/download/albums", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: missing })
        });
        const j = await r.json();
        for (const a of (j && j.albums) || []) if (a.exists && a.album) downloadAlbums.set(a.id, a.album);
      } catch (e) { /* the phone's own details below */ }
    }
    const frag = document.createDocumentFragment();
    for (const d of list) {
      const al = downloadAlbums.get(d.id);
      const tile = d.state === "away" ? buildAlbumTile(
        { title: d.title || "Album", subtitle: d.artist || "", image_key: d.image_key || null },
        () => { if (window.__showToast) window.__showToast("On a card that isn’t in right now", "error"); })
      : al ? homeTile(al) : buildAlbumTile(
        { title: d.title || "Album", subtitle: d.artist || "", image_key: d.image_key || null },
        () => { try { DL.play(d.id); } catch (e) { /* an app without this call (older than the page): nothing to do */ } if (window.__showToast) window.__showToast("Not in the library right now — playing from this phone"); });
      const text = downloadBadge(d);
      const wrap = tile.querySelector(".album-art-wrap");
      if (text && wrap) {
        tile.classList.add("is-downloading");
        const b = document.createElement("span");
        b.className = "dl-badge";
        b.textContent = text;
        wrap.appendChild(b);
      }
      frag.appendChild(tile);
    }
    return frag;
  }
  // Every downloaded album, as a wall (the row's header), in the page like any other.
  async function showDownloadsWall() {
    enterFullWall("Downloaded albums", true);
    unplayedWallActive = true;   // a fixed wall: no paging, no refresh
    const list = downloadList();
    if (!list.length) { grid.innerHTML = ""; setBanner("Nothing downloaded yet — on an album, ⋯ → Download to this phone.", false); return; }
    const frag = await downloadTiles(list);
    if (!unplayedWallActive) return;
    setBanner(null);
    grid.innerHTML = "";
    grid.appendChild(frag);
  }

  // Music files on the phone (Stage 5): the folder chosen in Settings →
  // Downloads, read by the app (LocalMusic) and shown here as its own row.
  // The app answers for these albums itself — their pages and covers
  // ("phone:…", "phone-…") never reach the server — and plays them on the
  // phone through its DSP engine.
  const hasLocal = !!(DL && typeof DL.localAlbums === "function");
  function localList() {
    if (!hasLocal) return [];
    try { return JSON.parse(DL.localAlbums()) || []; } catch (e) { return []; }
  }
  function localInfo() {
    if (!hasLocal) return null;
    try { const v = DL.localFolder(); return v && v !== "null" ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  const isPhoneAlbum = a => !!a && typeof a.offset === "string" && a.offset.startsWith("phone:");
  const phoneKey = a => isPhoneAlbum(a) ? a.offset.slice(6) : null;
  let homeLocal = null, homeLocalKey = null;
  if (hasLocal && homeSections) {
    const sec = document.createElement("div");
    sec.className = "home-section home-section-local hidden";
    sec.dataset.row = "phone";
    sec.innerHTML = '<h2 class="home-section-title home-section-link" role="button" tabindex="0">Music on device</h2>' +
      '<div class="home-carousel"></div>';
    sec.querySelector("h2").addEventListener("click", () => showLocalWall());
    homeSections.prepend(sec);
    homeLocal = sec.querySelector(".home-carousel");
  }
  const localKey = list => list.map(a => a.key).join(",");
  function localTiles(list) {
    const frag = document.createDocumentFragment();
    for (const a of list) frag.appendChild(homeTile(a));
    return frag;
  }
  function loadHomeLocal() {
    if (!homeLocal) return;
    const list = localList();
    homeLocalKey = localKey(list);
    if (!list.length) {
      const info = localInfo();
      homeLocal.innerHTML = '<div class="home-carousel-empty">' + (info
        ? (info.scanning ? "Reading the folder…" : "Nothing in “" + escapeHtml(info.name) + "” yet.")
        : "Choose a folder of music on this phone in Settings → Music Folders.") + "</div>";
    } else {
      homeLocal.innerHTML = "";
      homeLocal.appendChild(localTiles(list));
    }
    applyHomeLayout();
  }
  function showLocalWall() {
    enterFullWall("Music on device", true);
    unplayedWallActive = true;
    renderLocalWall();
  }
  function renderLocalWall() {
    grid.dataset.wall = "local";
    const all = localList();
    if (!all.length) { hideLocalControls(); grid.innerHTML = ""; setBanner("Nothing on this phone yet — choose a folder in Settings → Music Folders.", false); return; }
    // Focus and Sort, as the Library wall has them (v0.7.4), worked out here
    // on the phone: the server never sees these albums.
    const list = localSorted(all.filter(localPasses));
    renderLocalControls();
    setCountText("Music on device · " + list.length.toLocaleString() +
                 (localFocusCount() ? " matching" : "") + (list.length === 1 ? " album" : " albums"));
    grid.innerHTML = "";
    if (!list.length) { setBanner("Nothing matches this focus — try clearing a filter.", false); return; }
    setBanner(null);
    grid.appendChild(localTiles(list));
  }

  // ----- Music on device: Focus and Sort (v0.7.4) --------------------------
  // The Library wall's controls, for the phone's own albums: the same row,
  // the same sheets and chips, with what the phone's index knows — the
  // artist, the year, the files' quality. Kept per device, like the
  // Library's view.
  const LOCAL_VIEW_KEY = "rra-local-view";
  const LOCAL_SORTS = [
    { id: "album",  label: "Album name",   dir: "asc",  asc: "A → Z", desc: "Z → A" },
    { id: "artist", label: "Artist",       dir: "asc",  asc: "A → Z", desc: "Z → A" },
    { id: "year",   label: "Release date", dir: "desc", asc: "Oldest first", desc: "Newest first", note: "from the files' tags" },
    { id: "random", label: "Random",       dir: "asc" }
  ];
  const LOCAL_FACETS = [["artist", "Artist"], ["decade", "Decade"], ["quality", "Quality"]];
  let localView = { sort: "album", dir: "asc", seed: 1, artist: [], decade: [], quality: [] };
  try {
    const s = JSON.parse(localStorage.getItem(LOCAL_VIEW_KEY) || "null");
    if (s && typeof s === "object") {
      localView = Object.assign(localView, s);
      for (const [id] of LOCAL_FACETS) localView[id] = Array.isArray(localView[id]) ? localView[id].map(String) : [];
      if (!LOCAL_SORTS.some(o => o.id === localView.sort)) localView.sort = "album";
      if (localView.dir !== "asc" && localView.dir !== "desc") localView.dir = "asc";
      if (!Number.isFinite(localView.seed)) localView.seed = 1;
    }
  } catch (e) { /* the defaults stand */ }
  const saveLocalView = () => { try { localStorage.setItem(LOCAL_VIEW_KEY, JSON.stringify(localView)); } catch (e) { /* localStorage optional */ } };
  const localFacetOf = {
    artist:  a => a.subtitle || "Unknown artist",
    decade:  a => a.year ? String(Math.floor(Number(a.year) / 10) * 10) + "s" : "Undated",
    quality: a => a.hires ? "Hi-Res" : (typeof a.quality === "string" && a.quality.includes("/")) ? "Lossless" : "Lossy"
  };
  const localFocusCount = () => LOCAL_FACETS.reduce((n, [id]) => n + localView[id].length, 0);
  // The Library's chip rule: a value included, or excluded with a "!" in front.
  function localPasses(a) {
    for (const [id] of LOCAL_FACETS) {
      const sel = localView[id];
      if (!sel.length) continue;
      const v = localFacetOf[id](a);
      if (sel.includes("!" + v)) return false;
      const on = sel.filter(x => !x.startsWith("!"));
      if (on.length && !on.includes(v)) return false;
    }
    return true;
  }
  function localSorted(list) {
    const cmp = new Intl.Collator(undefined, { sensitivity: "base", numeric: true }).compare;
    const out = list.slice();
    if (localView.sort === "random") {
      // The seed fixes which shuffle, so the wall stays put until ⟳.
      let s = (localView.seed || 1) >>> 0;
      const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
      for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
      return out;
    }
    const key = {
      album:  a => a.title || "",
      artist: a => (a.subtitle || "") + "\u0001" + (a.title || ""),
      year:   a => Number(a.year) || 0
    }[localView.sort] || (a => a.title || "");
    out.sort((x, y) => {
      const a = key(x), b = key(y);
      const d = typeof a === "number" ? a - b : cmp(a, b);
      return d || cmp(x.title || "", y.title || "");
    });
    if (localView.dir === "desc") out.reverse();
    return out;
  }
  function renderLocalControls() {
    let bar = document.getElementById("local-controls");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "local-controls";
      bar.className = "library-controls sub-bar";
      const row = document.querySelector(".topbar-row");
      if (row) row.insertAdjacentElement("afterend", bar);
      else grid.parentNode.insertBefore(bar, grid);
    }
    bar.innerHTML = "";
    bar.appendChild(buildFocusCtl(localFocusCount(), openLocalFocusSheet));
    const o = LOCAL_SORTS.find(x => x.id === localView.sort) || LOCAL_SORTS[0];
    const dirless = o.id === "random";
    bar.appendChild(buildSortCtl(o.label, dirless ? "⟳" : (localView.dir === "desc" ? "↓" : "↑"),
      dirless ? "Sort — Random" : "Sort — " + o.label + ", " + (localView.dir === "desc" ? o.desc : o.asc), openLocalSortSheet));
    bar.classList.remove("hidden");
  }
  function hideLocalControls() {
    const bar = document.getElementById("local-controls");
    if (bar) bar.classList.add("hidden");
  }
  // The artist view borrows the grid and puts it back: the row with it.
  window.__restoreLocalControls = () => { if (localWallOpen()) renderLocalControls(); };
  function openLocalSortSheet() {
    openLibSheet("Sort by", (body, close) => {
      const paint = () => {
        body.innerHTML = "";
        for (const opt of LOCAL_SORTS) {
          const on = localView.sort === opt.id, hasDir = opt.id !== "random";
          const row = document.createElement("button");
          row.type = "button";
          row.className = "lib-sort-row" + (on ? " is-on" : "");
          const arrow = document.createElement("span");
          arrow.className = "lib-sort-arrow";
          arrow.setAttribute("aria-hidden", "true");
          arrow.textContent = on && hasDir ? (localView.dir === "desc" ? "↓" : "↑") : "";
          row.appendChild(arrow);
          const text = document.createElement("span");
          text.className = "lib-sort-text";
          const main = document.createElement("span");
          main.className = "lib-sort-label";
          main.textContent = opt.label;
          text.appendChild(main);
          if (opt.note) { const sub = document.createElement("span"); sub.className = "lib-sort-note"; sub.textContent = opt.note; text.appendChild(sub); }
          row.appendChild(text);
          if (on && hasDir) row.setAttribute("aria-label", opt.label + " — " + (localView.dir === "desc" ? opt.desc : opt.asc) + ", tap to reverse");
          row.addEventListener("click", () => {
            if (on) {
              if (hasDir) localView.dir = localView.dir === "desc" ? "asc" : "desc";
              else { localView.seed = libNextSeed(localView.seed); close(); }
            } else {
              localView.sort = opt.id;
              localView.dir = opt.dir;
              if (!hasDir) localView.seed = libNextSeed(localView.seed);
              close();
            }
            saveLocalView();
            if (document.body.contains(body)) paint();
            renderLocalWall();
          });
          body.appendChild(row);
        }
      };
      paint();
    });
  }
  function openLocalFocusSheet() {
    const all = localList();
    const openSections = {};
    openLibSheet("Focus", (body) => {
      const render = () => {
        body.innerHTML = "";
        for (const [id, label] of LOCAL_FACETS) {
          const sel = localView[id];
          if (openSections[id] === undefined && sel.length) openSections[id] = true;
          const expanded = !!openSections[id];
          const s = document.createElement("div");
          s.className = "lib-sheet-section" + (expanded ? " is-open" : "");
          const head = document.createElement("button");
          head.type = "button";
          head.className = "lib-sheet-section-head";
          head.setAttribute("aria-expanded", expanded ? "true" : "false");
          const t = document.createElement("span"); t.className = "lib-sheet-section-label"; t.textContent = label; head.appendChild(t);
          if (sel.length) { const n = document.createElement("span"); n.className = "lib-sheet-section-count"; n.textContent = String(sel.length); head.appendChild(n); }
          const car = document.createElement("span"); car.className = "lib-sheet-section-caret"; car.setAttribute("aria-hidden", "true"); car.textContent = expanded ? "⌃" : "⌄"; head.appendChild(car);
          head.addEventListener("click", () => { openSections[id] = !expanded; render(); });
          s.appendChild(head);
          body.appendChild(s);
          if (!expanded) continue;
          const wrap = document.createElement("div");
          wrap.className = "lib-chips";
          s.appendChild(wrap);
          const counts = new Map();
          for (const a of all) { const v = localFacetOf[id](a); counts.set(v, (counts.get(v) || 0) + 1); }
          const values = [...counts.keys()].sort((a, b) => id === "decade" ? String(b).localeCompare(String(a)) : String(a).localeCompare(String(b), undefined, { sensitivity: "base" }));
          for (const v of values) {
            const state = facetState(sel, v);
            const c = document.createElement("button");
            c.type = "button";
            c.className = "lib-chip" + (state === "on" ? " is-on" : state === "not" ? " is-not" : "");
            c.textContent = v + " (" + counts.get(v) + ")";
            if (state === "not") c.setAttribute("aria-label", "Excluding " + v);
            c.addEventListener("click", () => { facetCycle(sel, v); saveLocalView(); render(); renderLocalWall(); });
            wrap.appendChild(c);
          }
        }
      };
      render();
    }, (foot, close) => {
      const clear = document.createElement("button");
      clear.type = "button"; clear.className = "action-btn"; clear.textContent = "Clear";
      clear.addEventListener("click", () => { for (const [id] of LOCAL_FACETS) localView[id] = []; saveLocalView(); renderLocalWall(); close(); });
      const show = document.createElement("button");
      show.type = "button"; show.className = "action-btn primary"; show.textContent = "Show albums";
      show.addEventListener("click", close);
      foot.appendChild(clear); foot.appendChild(show);
    });
  }
  // A name as the artist view compares it: case, accents and punctuation aside.
  const foldName = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  // The phone's own albums by an artist (v0.7.4), for the artist view — the
  // server never sees them, so the page brings them to that screen itself.
  window.__phoneAlbumsByArtist = (name) => {
    const k = foldName(name);
    return k ? localList().filter(a => foldName(a.subtitle) === k) : [];
  };
  // The wall open now, still showing the phone's albums (another wall may
  // have taken the grid since)?
  const localWallOpen = () => grid.dataset.wall === "local" && !grid.classList.contains("hidden") &&
    [...grid.children].every(t => !t.__album || isPhoneAlbum(t.__album));
  if (hasLocal) window.__musicdLocalChanged = () => {
    if (localWallOpen()) renderLocalWall();
    loadHomeLocal();
    if (window.__renderHomeRowsList) window.__renderHomeRowsList();
    if (window.__renderLocalFolder) window.__renderLocalFolder();
  };

  // An album downloaded (or started) while the row was off switches it on for
  // good — until the downloads are removed and it's switched off again.
  function downloadsRowOnIfNeeded() {
    const dl = homeLayout.find(x => x.id === "downloads");
    if (!dl || dl.on || !downloadList().length) return;
    dl.on = true;
    fetch("/api/settings/home-rows", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: homeLayout.map(x => ({ id: x.id, on: x.on })) })
    }).catch(() => {});
  }
  // The app calls this whenever a download starts, moves on, finishes or is
  // removed (MainActivity): the row, and the switch in Settings, follow live.
  if (DL) window.__musicdDownloadsChanged = () => {
    downloadsRowOnIfNeeded();
    loadHomeDownloads();
    if (window.__renderHomeRowsList) window.__renderHomeRowsList();
  };
  // With albums on the phone the row is on, whatever the switch said: it can
  // only be switched off once they're removed.
  const rowIsOn = row => row.id === "downloads" ? (row.on || downloadList().length > 0) : row.on;

  const HOME_ROWS = [
    { id: "unplayed", title: "Not played in 6 months",
      load: () => { loadHomeUnplayed(); }, isFresh: () => rowsTtlFresh() },
    { id: "later", title: "Listen later",
      load: () => { loadHomeLater(); }, isFresh: () => homeLaterLoaded },
    { id: "playlists", title: "Playlists",
      load: () => { loadHomePlaylists(); }, isFresh: () => homePlaylistsLoaded },
    { id: "favourites", title: "Favourites",
      load: () => { loadHomeFavourites(); }, isFresh: () => homeFavouritesLoaded },
    { id: "history",  title: "Recently played",
      load: () => { loadHomeHistory(); }, isFresh: () => homeHistoryLoaded },
    { id: "picks",    title: "Smart Picks",
      load: () => { loadHomeSmartPicks(); }, isFresh: () => homePicksDay === localDayKey() },
    { id: "lotw",     title: "Label of the week",
      load: () => { loadHomeLabelOfWeek(); }, isFresh: () => homeLotwLoaded },
    { id: "random",   title: "Random albums",
      load: () => { loadHomeRandom(); }, isFresh: () => false },
    { id: "library",  title: "Library",
      load: () => { loadHomeLibrary(); }, isFresh: () => homeLibraryKey === libSortKey() },
    { id: "genres",   title: "Browse by genre",
      load: () => { loadHomeGenres(); }, isFresh: () => homeSectionsLoaded },
  ];
  if (DL) HOME_ROWS.unshift({ id: "downloads", title: "Downloaded albums",
    load: () => { loadHomeDownloads(); }, isFresh: () => homeDownloadsKey === downloadsKey(downloadList()) });
  if (hasLocal) HOME_ROWS.unshift({ id: "phone", title: "Music on device",
    load: () => { loadHomeLocal(); }, isFresh: () => homeLocalKey === localKey(localList()) });
  function homeRowEl(id) {
    return homeSections ? homeSections.querySelector('[data-row="' + id + '"]') : null;
  }
  // The stored layout, defaulting to the table's own order with everything on.
  let homeLayout = HOME_ROWS.map(r => ({ id: r.id, on: true }));

  // Put the sections in the stored order and hide the ones switched off.
  //
  // appendChild on an element already in the DOM MOVES it — listeners, closures
  // and all. Rebuilding this from an HTML string would silently drop every
  // handler on every tile, which is the v1.6.52 "albums untappable after Back"
  // bug (CLAUDE.md pre-flight step 4).
  // Rows that legitimately hide themselves when they have nothing to show. A
  // fresh install has no history and no picks, and an empty labelled shelf
  // reads as a fault rather than an absence.
  function rowHidesWhenEmpty(id) {
    return id === "unplayed" || id === "history" || id === "picks" || id === "lotw" || id === "favourites" || id === "later" || id === "playlists" || id === "phone";
  }
  function rowHasAnyContent(sectionEl) {
    return !!(sectionEl && sectionEl.querySelector(".album, .pick-card, .home-genre-tile"));
  }

  function applyHomeLayout() {
    if (!homeSections) return;
    for (const row of homeLayout) {
      const el = homeRowEl(row.id);
      if (!el) continue;
      homeSections.appendChild(el);
      // toggle, not add. Only ever adding meant a row switched off stayed off
      // for the rest of the session: nothing removed the class, and the
      // renderers write into the carousel div rather than the section wrapper.
      //
      // Rows that hide themselves when empty (History, Smart Picks, Label of
      // the week) get their emptiness respected: re-showing a row the layout
      // enables must not un-hide one that simply has nothing in it.
      // `unavailable` beats the stored preference: the feature behind the row
      // is switched off, so there is nothing for it to show. Kept separate from
      // `on` so the user's own choice survives untouched until they turn the
      // feature back on.
      //
      // Belt and braces, honestly labelled: the two rows that can currently be
      // unavailable (picks, lotw) are also the two that hide themselves when
      // empty, and with their feature off they ARE empty — so today this term
      // changes nothing on its own. The gate that does the work is homeRowOn(),
      // which stops the row's loader running at all. This one states the intent
      // so a future unavailable row that does not hide-when-empty is covered.
      const showable = rowIsOn(row) && !row.unavailable;
      el.classList.toggle("hidden",
        !showable || (showable && rowHidesWhenEmpty(row.id) && !rowHasAnyContent(el)));
    }
  }
  // The greeting above Home: the part of the day, and the date.
  function paintGreeting() {
    const d = new Date(), h = d.getHours();
    const t = document.getElementById("home-greeting-text");
    const dt = document.getElementById("home-greeting-date");
    if (t) t.textContent = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    if (dt) {
      try { dt.textContent = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }); }
      catch (e) { dt.textContent = ""; }
    }
  }
  paintGreeting();
  setInterval(paintGreeting, 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) paintGreeting(); });

  async function loadHomeLayout() {
    try {
      const r = await fetch("/api/settings/home-rows");
      if (!r.ok) return;
      const j = await r.json();
      if (j && Array.isArray(j.rows) && j.rows.length) homeLayout = j.rows;
      // A row this device has that the saved layout doesn't know (an older
      // server): at the top, on — never silently missing.
      for (const r of HOME_ROWS) if (!homeLayout.some(x => x.id === r.id)) homeLayout.unshift({ id: r.id, on: true });
      downloadsRowOnIfNeeded();
    } catch (e) {
      // Offline or pre-upgrade server: keep the default order. A Home screen
      // in the wrong order is recoverable; one that never renders is not.
    }
    applyHomeLayout();
  }
  function homeRowOn(id) {
    const r = homeLayout.find(x => x.id === id);
    // Gates the row's LOADER as well as its visibility — a row whose feature is
    // off must not fetch either, or Smart Picks keeps polling a route that is
    // now returning nothing.
    return !r || (rowIsOn(r) && !r.unavailable);
  }

  // Topbar chrome per view: Back button (off Home), Refresh button (random /
  // genre grids), and the Search box (Home only, beside the hamburger).
  // Grid or list for the walls is Settings → UI Settings now (v0.6.5; it was
  // a button in the top bar's corner): painted onto the grid by __uiPrefs.
  function applyAlbumView() {
    if (window.__uiPrefs) window.__uiPrefs.apply();
  }

  // `view` (whether the screen shows album tiles) is kept for the callers'
  // sake; nothing in the bar depends on it since the list button went.
  // The menu button is Home's alone (v0.6.24): on every other screen — the
  // album grids, Labels, Listen later, the playlists, an artist — the brass ‹
  // stands where it was. Followed from the ‹ itself, wherever it is toggled.
  {
    const menuBtn = document.getElementById("menu-toggle");
    if (menuBtn && topbarBack) {
      const sync = () => menuBtn.classList.toggle("hidden", !topbarBack.classList.contains("hidden"));
      new MutationObserver(sync).observe(topbarBack, { attributes: true, attributeFilter: ["class"] });
      sync();
    }
  }
  function setTopbarNav(back, refresh, search, view) {
    if (topbarBack)    topbarBack.classList.toggle("hidden", !back);
    if (topbarRefresh) topbarRefresh.classList.toggle("hidden", !refresh);
    if (topbarSearch)  topbarSearch.classList.toggle("hidden", !search);
    applyAlbumView();
  }

  // Show the Home landing (hide the wall). The wall loads lazily when entered.
  function showHome() {
    hideLibraryControls();
    unplayedWallActive = false;
    libraryWallActive = false;
    leavePlaylistScreens();
    if (window.__clearSearchIfActive) window.__clearSearchIfActive();  // drop stale search results
    if (window.__exitLabels) window.__exitLabels();   // leave the labels browser if active
    // Discard, don't restore: this function is establishing its own screen and
    // has already reset the view flags above.
    if (window.__exitArtistView) window.__exitArtistView({ restore: false });
    // Home is unfiltered — clear any active genre/tag filter so the breadcrumb
    // title goes away AND Home's full-library tiles resolve correctly.
    if (activeFilter) {
      activeFilter = null;
      try { localStorage.removeItem("rra-filter"); } catch (e) { /* localStorage optional (private browsing) */ }
    }
    updateCountReadout(null, true);   // hide the wall's title / the genre breadcrumb
    setBanner(null);            // drop any error/empty banner left by a wall view
    if (homeView) homeView.classList.remove("hidden");
    if (homeSections) homeSections.classList.remove("hidden");  // in case a search hid them
    grid.classList.add("hidden");
    setTopbarNav(false, false, true);   // Home: search box, no Back/Refresh
    const m = document.querySelector("main");
    if (m) m.scrollTop = 0;
    // The unplayed + random rows keep their tiles for 5 minutes: every Back tap
    // lands here, and rebuilding ~60 fresh-random tiles each time re-fetched
    // ~60 cover images through the Roon Core — the single biggest repeated cost
    // in the app. Within the TTL the existing DOM (and the browser's image
    // cache) is reused; after it, or if a load failed, both rows reload fresh.
    // The unplayed and random rows share one TTL, so mark it before the loop
    // rather than once per row.
    refreshHomeRows();
    if (window.__watchServices) window.__watchServices();
  }
  // Decided BEFORE the clock is marked (v0.6.0-RC4): marking first made the
  // unplayed row read as fresh, so once it held tiles it was never fetched
  // again — a saved Home (yesterday's Album of the day, an offline session's
  // list) stayed on screen for good, and the app and the browser drifted apart.
  function refreshHomeRows() {
    const ttlFresh = rowsTtlFresh();
    if (!ttlFresh) homeRowsLoadedAt = Date.now();
    for (const row of HOME_ROWS) {
      if (!homeRowOn(row.id)) continue;   // off means the work does not run
      if (row.id === "unplayed" ? ttlFresh : row.isFresh()) continue;
      row.load();
    }
    // The strip under the greeting, on every visit: Random Album at once,
    // Album of the day asked for (v0.6.1).
    refreshAotd();
  }
  // Back to the app or the tab after a while (overnight, say): Home on screen
  // catches up where it stands, without jumping to the top.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!homeView || homeView.classList.contains("hidden")) return;
    refreshHomeRows();
  });
  // Shared freshness for the two rows that turn over on a clock rather than a
  // flag: recheck every 5 minutes, but only when they actually hold tiles.
  function rowsTtlFresh() {
    return !!(homeRowsLoadedAt &&
      (Date.now() - homeRowsLoadedAt) < HOME_ROWS_TTL_MS &&
      (homeUnplayedLoaded || !homeRowOn("unplayed")) &&
      homeRandom && homeRandom.querySelector(".album"));
  }
  // Reveal the album wall. opts.loadIfEmpty loads a fresh wall only when it has
  // no content yet (so passive reveals — opening an overlay from the menu —
  // don't leave an empty grid behind, without racing actions that render their
  // own content, e.g. labels/search).
  function showWall(opts) {
    leavePlaylistScreens();   // this screen owns the grid now
    hideLibraryControls();
    unplayedWallActive = false;
    libraryWallActive = false;
    if (window.__clearSearchIfActive) window.__clearSearchIfActive();  // drop stale search results
    // Discard, don't restore: this function is establishing its own screen and
    // has already reset the view flags above.
    if (window.__exitArtistView) window.__exitArtistView({ restore: false });
    if (homeView) homeView.classList.add("hidden");
    grid.classList.remove("hidden");
    setTopbarNav(true, true, false, true);   // random / genre grid: Back + Refresh + view, no search
    // Home and the grid share <main>'s scroll container — without this, a
    // wall entered while Home was scrolled down (e.g. tapping a genre card
    // below the fold) opens mid-page/at-the-bottom instead of at the top.
    const mainEl = document.querySelector("main");
    if (mainEl) mainEl.scrollTop = 0;
    if (opts && opts.loadIfEmpty && !labelsActive && !grid.children.length) loadRandom();
  }
  window.__showHome = showHome;
  window.__showWall = showWall;
  // Labels/search reuse the shared grid but aren't the random-album wall, so
  // they show Back but not Refresh.
  window.__setTopbarNav = setTopbarNav;
  // The zone every "play this somewhere" action targets, for the modules that
  // live in their own IIFEs (the share sheet's suggestions). The SELECT wins
  // when it has a value — it is what the user last touched — with the
  // in-memory value behind it, which is the same order every caller inside
  // this scope already uses.
  window.__selectedZoneId = () => {
    const sel = document.getElementById("zone-select");
    return (sel && sel.value) || selectedZoneId || null;
  };

  // The artist view's own Back listener (capture) is meant to run first, but
  // browsers before the 2020–21 event-order change (older iPads) run the
  // listeners on the target in the order they were added — so this one checks
  // for itself (v0.6.1).
  if (topbarBack)    topbarBack.addEventListener("click", () => {
    if (window.__artistViewActive && window.__artistViewActive()) return;
    showHome();
  });
  if (topbarRefresh) topbarRefresh.addEventListener("click", () => loadRandom());

  // Home's "Not played" row is reused within this TTL instead of being rebuilt
  // on every visit — see showHome. Random albums turns over on every visit
  // (its isFresh is always false): a new handful each time you come back.
  const HOME_ROWS_TTL_MS = 5 * 60 * 1000;
  let homeRowsLoadedAt = 0;

  // --- Home content persistence (instant open) --------------------------
  // The in-memory rows above live only as long as the page's JS context, so a
  // cold PWA open (the process is torn down when the app is backgrounded) reset
  // homeRowsLoadedAt to 0 and reloaded — and re-randomised — the entire Home
  // screen every single time. Persist the last rendered rows to localStorage
  // and repaint them instantly on open, then revalidate in the background
  // (stale-while-revalidate). Covers come straight from the browser's HTTP
  // cache (the server sends them immutable for a week), so it's a flash-free
  // repaint, not a reload. Bumped the key suffix if the cached shape changes.
  const HOME_CACHE_KEY = "rra-home-cache-v1";
  // Album of the day's day: it turns over at 00:01, as on the server.
  const todayKey = () => { const d = new Date(Date.now() - 60 * 1000); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); };
  function saveHomeCache(patch) {
    // The app's own copy, offline (v0.5.58): what it shows is the phone's music,
    // which mustn't become the server's Home the next time it opens.
    if (window.__musicdOffline) return;
    try {
      const cur = JSON.parse(localStorage.getItem(HOME_CACHE_KEY) || "{}") || {};
      localStorage.setItem(HOME_CACHE_KEY, JSON.stringify(Object.assign(cur, patch)));
    } catch (e) { /* localStorage optional / over quota — persistence is best-effort */ }
  }
  function readHomeCache() {
    try { return JSON.parse(localStorage.getItem(HOME_CACHE_KEY) || "null"); }
    catch (e) { return null; } // corrupt cache — ignore and load fresh
  }
  // A row already carries real content (tiles or genre cards), so a background
  // revalidation can swap fresh data in without first flashing "Loading…" over
  // the cached content the user is already looking at.
  // Smart Picks tiles are .pick-card, not .album — they carry no offset and are
  // never ordinary album tiles — so that class has to be named here or a
  // hydrated picks row reads as empty and gets blanked.
  const rowHasContent = (el) => !!(el && el.querySelector(".album, .home-genre-card, .pick-card"));

  // Build a Home tile that always opens full-library (filter: null) so its
  // offset resolves even when a genre filter was last active.
  // "Artist · Disc 2 · 4:39" → ["Artist · Disc 2", "4:39"]: the server ends a
  // track's second line with its length, which the album view shows on the
  // right of the row instead.
  function splitTrackLength(sub) {
    const parts = String(sub || "").split(" · ");
    const last = parts[parts.length - 1];
    if (/^\d+:\d{2}(:\d{2})?$/.test(last)) { parts.pop(); return [parts.join(" · "), last]; }
    return [String(sub || ""), ""];
  }

  function homeTile(a, extraClass) {
    const tile = buildAlbumTile(a, () => openAlbum(a, { source: "home", filter: null }));
    if (extraClass) tile.classList.add(extraClass);
    return tile;
  }

  // The action that used to live in the side menu, as the first tile of the
  // "Not played" row. It reuses .album so the grid/carousel sizing, the hover
  // state and the art aspect ratio all come for free — only the inside of the
  // art square differs.
  function buildUnheardTile() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "album home-unheard-tile";
    btn.id = "home-unheard-tile";
    btn.setAttribute("aria-label", "Random Album");

    const art = document.createElement("div");
    art.className = "album-art-wrap unheard-art";
    const glyph = document.createElement("span");
    // A disc turning on its own centre, the middle of the tile (v0.6.0).
    glyph.className = "unheard-glyph unheard-disc";
    glyph.setAttribute("aria-hidden", "true");
    glyph.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
      '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none"/>' +
      '<path d="M6.6 8.4A6.6 6.6 0 0 1 9.4 5.9"/><path d="M17.4 15.6A6.6 6.6 0 0 1 14.6 18.1"/></svg>';
    art.appendChild(glyph);
    btn.appendChild(art);

    const meta = document.createElement("div");
    meta.className = "album-meta";
    const t = document.createElement("div");
    t.className = "album-title";
    t.textContent = "Random Album";
    meta.appendChild(t);
    btn.appendChild(meta);

    // One implementation, two triggers: the request, the zone check and the
    // spin all live in playUnheard, which spins whichever control was pressed.
    btn.addEventListener("click", () => {
      if (window.__playUnheard) window.__playUnheard(btn);
    });
    return btn;
  }

  // Album of the day's tile, with its ★ Today badge.
  function buildAotdTile(aotd) {
    const tile = homeTile(aotd, "home-aotd");
    const wrap = tile.querySelector(".album-art-wrap");
    if (wrap) {
      const badge = document.createElement("span");
      badge.className = "aotd-badge";
      badge.textContent = "★ Today";
      wrap.appendChild(badge);
    }
    return tile;
  }

  // Only unplayed albums since v0.6.1 — Random Album and Album of the day are
  // the strip under the greeting (renderHomeToday). The row stays hidden while
  // it has none, which is the whole of its first six months, and shows itself
  // once albums arrive, unless it is switched off in Settings → Home Screen.
  function renderHomeUnplayed(albums) {
    albums = albums || [];
    if (!homeUnplayed) return;
    homeUnplayed.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const a of albums) frag.appendChild(homeTile(a));
    homeUnplayed.appendChild(frag);
    const sec = homeUnplayed.closest(".home-section");
    if (sec) sec.classList.toggle("hidden", !albums.length || !homeRowOn("unplayed"));
  }

  // The strip under the greeting (v0.6.1): Random Album, then Album of the
  // day when there is one (none once it has been played, until the next
  // 00:01). Random Album is kept, not rebuilt, so a disc that is spinning
  // carries on spinning when Album of the day changes beside it.
  let shownAotd = null;
  function renderHomeToday(aotd) {
    if (!homeToday) return;
    shownAotd = aotd || null;
    const unheard = homeToday.querySelector("#home-unheard-tile") || buildUnheardTile();
    for (const el of [...homeToday.children]) if (el !== unheard) el.remove();
    if (unheard.parentElement !== homeToday) homeToday.appendChild(unheard);
    if (aotd) homeToday.appendChild(buildAotdTile(aotd));
  }

  /*
   * Album of the day, in step on every device (v0.6.0-RC4): the server
   * chooses it at 00:01 and keeps it (v0.6.0-RC8), and is asked every minute
   * while Home is on screen, when you come back to the app or the tab, and
   * on every Home visit. Played anywhere, it goes everywhere; at 00:01 the
   * new one comes everywhere. It no longer depends on the Not-played row
   * (v0.6.1): switched off or empty, Album of the day still turns over.
   */
  async function refreshAotd() {
    if (!homeToday) return;
    // Random Album needs no answer: it shows before one arrives.
    if (!homeToday.querySelector("#home-unheard-tile")) renderHomeToday(shownAotd);
    let aj;
    try {
      const r = await fetch("/api/home/album-of-the-day", { cache: "no-store" });
      if (!r.ok) return;   // the index building, or a server error: what is showing stays
      aj = await r.json();
    } catch (e) { return; }   // offline or restarting: what is showing stays
    const next = (aj && aj.album) || null;
    if ((next && next.offset) !== (shownAotd && shownAotd.offset)) renderHomeToday(next);
    saveHomeCache({ today: { aotd: next, day: todayKey() } });
  }
  setInterval(() => {
    if (document.visibilityState !== "visible" || !homeView || homeView.classList.contains("hidden")) return;
    refreshAotd();
  }, 60 * 1000);

  // Whether the Not-played row has had an answer (empty counts): its emptiness
  // is no longer a reason to ask again on every Home visit.
  let homeUnplayedLoaded = false;
  async function loadHomeUnplayed() {
    if (!homeUnplayed) return;
    try {
      const r = await fetch("/api/home/unplayed?months=6&count=30");
      if (r.status === 503 || !r.ok) {
        homeUnplayedLoaded = false;
        homeRowsLoadedAt = 0;   // retry on the next Home visit
        return;   // keep any cached tiles + cache untouched while the index builds
      }
      const j = await r.json();
      const albums = (j && j.albums) || [];
      renderHomeUnplayed(albums);
      homeUnplayedLoaded = true;
      // An empty row is saved as empty, so a cold open never shows albums the
      // server no longer offers. Timestamp is per-row so a stale sibling can't
      // ride a fresh one's freshness (see hydrateHomeFromCache).
      saveHomeCache({ unplayed: { albums }, unplayedAt: Date.now() });
    } catch (e) {
      homeUnplayedLoaded = false;
      homeRowsLoadedAt = 0;   // retry on the next Home visit
    }
  }

  // Random-albums row (reuses /api/random-albums, no filter → full library).
  // Reloaded when the Home rows go stale (see showHome's TTL); tapping the
  // header opens the full random wall (same as the hamburger "Random albums").
  // One renderer for the plain album carousels (Random, Library) — same tiles,
  // same empty state, so the rows can't drift apart.
  function renderAlbumRow(rowEl, albums) {
    albums = albums || [];
    if (!rowEl) return;
    rowEl.innerHTML = "";
    if (!albums.length) {
      rowEl.innerHTML = '<div class="home-carousel-empty">No albums.</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    for (const a of albums) frag.appendChild(homeTile(a));   // filter:null → offsets resolve
    rowEl.appendChild(frag);
  }
  function renderHomeRandom(albums) { renderAlbumRow(homeRandom, albums); }

  async function loadHomeRandom() {
    if (!homeRandom) return;
    if (!rowHasContent(homeRandom)) homeRandom.innerHTML = '<div class="home-carousel-empty">Loading…</div>';
    try {
      const r = await fetch("/api/random-albums?count=30");
      if (r.status === 503) {
        if (!rowHasContent(homeRandom)) homeRandom.innerHTML = '<div class="home-carousel-empty">Reading your music library…</div>';
        homeRowsLoadedAt = 0;   // retry on the next Home visit
        return;   // keep any cached tiles while the index builds
      }
      const j = await r.json();
      const albums = (j && j.albums) || [];
      renderHomeRandom(albums);
      if (albums.length) saveHomeCache({ random: albums, randomAt: Date.now() });
    } catch (e) {
      if (!rowHasContent(homeRandom)) homeRandom.innerHTML = '<div class="home-carousel-empty">Couldn’t load.</div>';
      homeRowsLoadedAt = 0;   // retry on the next Home visit
    }
  }

  // Library row — the first albums of the library in the order the user chose
  // on the wall, so the row is the head of the same list its header opens.
  // Re-reads whenever that order changes (see homeLibraryKey) and is otherwise
  // retried each Home visit until it populates, like the label of the week.
  function renderHomeLibrary(albums) { renderAlbumRow(homeLibrary, albums); }

  async function loadHomeLibrary() {
    if (!homeLibrary) return;
    if (!rowHasContent(homeLibrary)) homeLibrary.innerHTML = '<div class="home-carousel-empty">Loading…</div>';
    // Captured BEFORE the request: the answer describes the order that was
    // current when it was asked for, and the user can change Sort while it is
    // in the air.
    const key = libSortKey();
    try {
      const r = await fetch("/api/library/albums?offset=0&count=30&" + key);
      // Any non-OK response (503 while the index builds, 500 on a transient
      // server error) keeps the cached tiles — a built index never legitimately
      // returns zero albums, so blanking the row to "No albums." would only
      // ever be showing an error as an empty state.
      if (!r.ok) {
        if (!rowHasContent(homeLibrary)) homeLibrary.innerHTML = '<div class="home-carousel-empty">Reading your music library…</div>';
        return;   // retried on the next Home visit (homeLibraryKey stays unset)
      }
      const j = await r.json();
      const albums = (j && j.albums) || [];
      // The order changed while this was in flight. Painting it would put the
      // previous order on screen and, worse, record it as the current one — so
      // the row would look settled on an order the user had already replaced.
      if (key !== libSortKey()) return;
      if (albums.length) {
        renderHomeLibrary(albums);
        homeLibraryKey = key;   // this order is loaded — don't refetch it
        saveHomeCache({ library: albums, librarySort: key });
      } else if (!rowHasContent(homeLibrary)) {
        renderHomeLibrary([]);   // genuinely empty and nothing cached — show the empty state
      }
    } catch (e) {
      if (!rowHasContent(homeLibrary)) homeLibrary.innerHTML = '<div class="home-carousel-empty">Couldn’t load.</div>';
    }
  }

  // Recently played — one tile per album, newest first, 30 days.
  //
  // The section stays hidden until there is something in it: a fresh install
  // has no history, and an empty shelf labelled "Recently played" reads like a
  // fault rather than an absence.
  function renderHomeHistory(albums) {
    if (!homeHistory) return;
    renderAlbumRow(homeHistory, albums);
    const sec = homeHistory.closest(".home-section");
    if (sec) sec.classList.toggle("hidden", !albums.length || !homeRowOn("history"));
  }
  // ----- Favourites: the hearted albums, newest first -----
  function renderHomeFavourites(albums) {
    if (!homeFavourites) return;
    renderAlbumRow(homeFavourites, albums);
    const sec = homeFavourites.closest(".home-section");
    if (sec) sec.classList.toggle("hidden", !albums.length || !homeRowOn("favourites"));
  }
  async function loadHomeFavourites() {
    if (!homeFavourites) return;
    try {
      const r = await fetch("/api/favourites", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      renderHomeFavourites((j && j.albums) || []);
      homeFavouritesLoaded = true;
    } catch (e) { /* next visit tries again */ }
  }
  // A heart tapped anywhere: the row shows it at once.
  window.__favouritesChanged = () => { homeFavouritesLoaded = false; loadHomeFavourites(); };

  // ----- Listen later: albums put aside, newest first -----
  function renderHomeLater(albums) {
    if (!homeLater) return;
    renderAlbumRow(homeLater, albums);
    const sec = homeLater.closest(".home-section");
    if (sec) sec.classList.toggle("hidden", !albums.length || !homeRowOn("later"));
  }
  async function loadHomeLater() {
    if (!homeLater) return;
    try {
      const r = await fetch("/api/listen-later", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      renderHomeLater((j && j.albums) || []);
      homeLaterLoaded = true;
    } catch (e) { /* the row keeps what it had */ }
  }
  window.__listenLaterChanged = () => { homeLaterLoaded = false; loadHomeLater(); };
  // On or off the list, for one album or several; the row and the wall follow.
  async function setListenLater(offsets, on) {
    const ids = (Array.isArray(offsets) ? offsets : [offsets]).filter(o => typeof o === "number");
    if (!ids.length) { showToast("Only the library's albums can be put aside", "error"); return false; }
    try {
      const r = await fetch("/api/listen-later", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offsets: ids, on }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
      showToast(on ? (ids.length === 1 ? "Put aside to listen later" : ids.length + " albums put aside to listen later") : "Taken off Listen later");
      if (window.__listenLaterChanged) window.__listenLaterChanged();
      if (laterWallActive) showLaterWall();
      return true;
    } catch (e) { showToast(e.message, "error"); return false; }
  }
  window.__setListenLater = setListenLater;

  // ----- Playlists: yours and the Dynamic ones, one row -----
  // The side menu keeps the two apart (different screens); on Home they are
  // one shelf, your own first, then the Dynamic ones. The title opens the
  // Playlists wall; a Dynamic tile opens that playlist.
  function renderHomePlaylists(mine, smart) {
    if (!homePlaylists) return;
    homePlaylists.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const p of mine) {
      const n = p.track_total;
      frag.appendChild(buildAlbumTile({ title: p.name, subtitle: `${n} track${n === 1 ? "" : "s"}`, image_key: null, art_keys: p.art_keys || [] },
        () => openUserPlaylist(p), { selectable: false }));
    }
    for (const p of smart) {
      const n = Number.isFinite(p.count) ? p.count : p.album_total;
      frag.appendChild(buildAlbumTile({ title: p.name, subtitle: "Dynamic · " + (Number.isFinite(n) ? `${n} album${n === 1 ? "" : "s"}` : describeLibView(p.view)), image_key: null, art_keys: p.art_keys || [] },
        () => openSmartPlaylist(p), { selectable: false }));
    }
    homePlaylists.appendChild(frag);
    const sec = homePlaylists.closest(".home-section");
    if (sec) sec.classList.toggle("hidden", !(mine.length + smart.length) || !homeRowOn("playlists"));
  }
  async function loadHomePlaylists() {
    if (!homePlaylists) return;
    const read = async (url) => { try { const r = await fetch(url, { cache: "no-store" }); return r.ok ? await r.json() : null; } catch (e) { return null; } };
    const [mine, smart] = await Promise.all([read("/api/user-playlists"), read("/api/smart-playlists")]);
    if (mine === null && smart === null) return;   // the row keeps what it had
    const my = ((mine && mine.playlists) || []).slice().sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    renderHomePlaylists(my, (smart && smart.playlists) || []);
    homePlaylistsLoaded = true;
  }
  // A playlist made, changed or deleted anywhere: the row follows.
  window.__playlistsChanged = () => { homePlaylistsLoaded = false; loadHomePlaylists(); };

  async function loadHomeHistory() {
    if (!homeHistory) return;
    try {
      const r = await fetch("/api/home/history?count=30");
      if (!r.ok) return;   // retried next visit — homeHistoryLoaded stays false
      const j = await r.json();
      const albums = (j && j.albums) || [];
      renderHomeHistory(albums);
      // Marked loaded even when empty: an empty history is a real answer, and
      // retrying it on every Home visit would query the plays table forever on
      // a box nobody has played anything from.
      homeHistoryLoaded = true;
      if (albums.length) saveHomeCache({ history: albums });
    } catch (e) {
      // Offline or the server went away. The row keeps whatever it had; the
      // next visit tries again.
    }
  }

  // -------------------------------------------------------------------------
  // Smart Picks — five albums a day by artists NOT in the library.
  //
  // These albums are NOT in Roon, so they have no offset and cannot be played
  // or queued. The only action is Add, which favourites the album on the
  // connected streaming service; Roon imports it and it becomes playable on the
  // next sync. That is why this uses its own card rather than homeTile(), whose
  // tap handlers all assume an offset into the albums hierarchy.
  // -------------------------------------------------------------------------

  // Today, in the viewer's own timezone.
  //
  // This is deliberately NOT compared against the server's `day`. The container
  // sets no TZ and runs UTC, so for anyone east or west of Greenwich the two
  // strings differ for part of every day — and the guard below would then be
  // permanently true, refetching and re-rendering the row on every Back tap.
  // "Has the day rolled over" is a question about the VIEWER's midnight, so the
  // client answers it with its own clock and stores its own key.
  function localDayKey() {
    const d = new Date();
    const p = (n) => (n < 10 ? "0" + n : String(n));
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function smartPickAddLabel(added) { return added ? "✓ Added" : "＋ Add"; }

  // Favourite a pick's album on whichever service it came from. On success the
  // button latches to Added rather than toggling back off: this is a one-way
  // "put it in my library" action, and an accidental second tap that silently
  // un-favourited it would be much worse than a no-op.
  async function addSmartPick(pick, button) {
    if (!pick.album_id || !pick.service) {
      showToast("No streaming album to add", "error");
      return;
    }
    const before = button.textContent;
    button.disabled = true;
    button.textContent = "…";
    try {
      const r = await fetch("/api/" + pick.service + "/favorite", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ album_id: pick.album_id })
      });
      const j = await r.json();
      if (j && j.ok) {
        // Deliberately not just "Added": the album is in the streaming library
        // now, but Roon imports on its own schedule, and the first version's
        // bare "Added" left people wondering why they still could not play it.
        button.textContent = "✓ Added";
        button.classList.add("is-done");
        button.disabled = true;
        button.dataset.added = "1";
        showToast("Added to your Qobuz favourites", "ok");
      } else {
        button.textContent = before;
        button.disabled = false;
        showToast((j && j.error) || "Couldn't add that album", "error");
      }
    } catch (e) {
      button.textContent = before;
      button.disabled = false;
      showToast("Failed: " + e.message, "error");
    }
  }

  // "Not for me" — permanent, and only ever from an explicit tap. Silence is
  // never treated as rejection: the whole premise is albums the user would not
  // otherwise reach for, so a pick they simply ignored has to be allowed back.
  async function blockSmartPick(pick, card) {
    try {
      const r = await fetch("/api/smart-picks/block", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artist: pick.artist })
      });
      const j = await r.json();
      if (j && j.ok) {
        if (card && card.parentNode) card.parentNode.removeChild(card);
        showToast("Won't suggest " + pick.artist + " again", "ok");
      } else {
        showToast((j && j.error) || "Couldn't save that", "error");
      }
    } catch (e) {
      showToast("Failed: " + e.message, "error");
    }
  }

  // One pick. `full` adds the reason line and the action buttons — the Home
  // carousel stays a plain tile so it reads like the rows around it.
  function smartPickCard(pick, full) {
    const card = document.createElement("div");
    card.className = "pick-card" + (full ? " pick-card-full" : "");
    const art = document.createElement("div");
    art.className = "pick-art";
    if (pick.image) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "";
      img.src = pick.image;
      art.appendChild(img);
    }
    card.appendChild(art);

    const meta = document.createElement("div");
    meta.className = "pick-meta";
    const artist = document.createElement("div");
    artist.className = "pick-artist";
    artist.textContent = pick.artist;
    meta.appendChild(artist);
    const album = document.createElement("div");
    album.className = "pick-album";
    album.textContent = pick.album || "";
    meta.appendChild(album);
    // The reason is on the Smart Picks page only; the Home tile stays a
    // plain tile like the rows around it.
    if (pick.reason && full) {
      const why = document.createElement("div");
      why.className = "pick-reason";
      why.textContent = pick.reason;
      meta.appendChild(why);
    }
    card.appendChild(meta);

    if (full) {
      const actions = document.createElement("div");
      actions.className = "pick-actions";

      // Three states, and which one a pick is in is entirely about whether Roon
      // has it yet:
      //
      //   OPEN     — the library has it, so it has an offset and opens as any
      //              album does (Play Now and the rest are on its page). This
      //              is where the picks should be by morning when adding
      //              automatically is on.
      //   WAITING  — favourited on the service but not imported yet. Roon
      //              decides when, so there is nothing to press.
      //   ADD      — not in the streaming library. Where every pick sits when
      //              automatic adding is off.
      if (pick.offset !== null && pick.offset !== undefined) {
        const play = document.createElement("button");
        play.type = "button";
        play.className = "pick-add pick-play";
        play.textContent = "Open";
        play.addEventListener("click", () => openAlbum({
          offset:    pick.offset,
          // Roon's OWN strings for the album, not Qobuz's — the play routes
          // check identity against the snapshot, and an edition suffix that
          // differs would be refused as a stale offset.
          title:     pick.library_title || pick.album || "",
          subtitle:  pick.library_subtitle || pick.artist || "",
          image_key: pick.image_key || null
        }, { filter: null }));
        actions.appendChild(play);
      } else if (pick.added) {
        const wait = document.createElement("button");
        wait.type = "button";
        wait.className = "pick-add is-done";
        wait.disabled = true;
        wait.textContent = "✓ Added";
        actions.appendChild(wait);
      } else {
        const add = document.createElement("button");
        add.type = "button";
        add.className = "pick-add";
        add.textContent = smartPickAddLabel(false);
        add.addEventListener("click", () => addSmartPick(pick, add));
        actions.appendChild(add);
      }

      const nope = document.createElement("button");
      nope.type = "button";
      nope.className = "pick-block";
      nope.textContent = "Not for me";
      nope.addEventListener("click", () => blockSmartPick(pick, card));
      actions.appendChild(nope);
      card.appendChild(actions);
    } else {
      // On Home the whole tile opens the full screen, where the reason and the
      // actions live. A tile that did nothing on tap would read as broken.
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      // A pick Roon already has behaves like any other album tile; one it does
      // not opens the Smart Picks screen, where Add and the reason live.
      const open = () => {
        if (pick.offset !== null && pick.offset !== undefined) {
          openAlbum({
            offset:    pick.offset,
            title:     pick.library_title || pick.album || "",
            subtitle:  pick.library_subtitle || pick.artist || "",
            image_key: pick.image_key || null
          }, { filter: null });
        } else {
          showSmartPicks();
        }
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
    }
    return card;
  }

  function renderHomePicks(picks) {
    if (!homePicks) return false;
    const sec = homePicks.closest(".home-section");
    if (!picks || !picks.length) {
      // Nothing built yet. Hide the section rather than show an empty row —
      // the first build runs in the background and may take a minute.
      if (sec) sec.classList.add("hidden");
      return false;
    }
    if (sec) sec.classList.toggle("hidden", !homeRowOn("picks"));   // never un-hide a row the layout switched off
    homePicks.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const p of picks) frag.appendChild(smartPickCard(p, false));
    homePicks.appendChild(frag);
    return true;
  }

  async function loadHomeSmartPicks() {
    if (!homePicks) return;
    try {
      const r = await fetch("/api/smart-picks");
      if (!r.ok) return;   // 503 while pairing / 500 — retried on the next visit
      const j = await r.json();
      const picks = (j && j.picks) || [];
      if (picks.length) {
        renderHomePicks(picks);
        homePicksDay = localDayKey();   // our own key — see localDayKey
      } else if (!rowHasContent(homePicks)) {
        // Genuinely nothing yet (the build runs in the background) and no
        // cached row to keep — hide the section rather than leave an empty one.
        renderHomePicks([]);
      }
    } catch (e) {
      // Transient — the row simply stays hidden and is retried next visit.
      // Silence is safe here because nothing was replaced or lost.
    }
  }

  // The full Smart Picks screen: every pick with its reason and its actions.
  // (smartPicksActive / smartPicksSeq are declared with the other view flags at
  // the top of the file — leavePlaylistScreens writes them, and that can run
  // during boot.)
  async function showSmartPicks() {
    enterFullWall("Smart Picks");
    smartPicksActive = true;
    const mySeq = ++smartPicksSeq;
    let j;
    try {
      const r = await fetch("/api/smart-picks");
      j = await r.json();
      // A 503 while pairing carries a real explanation ("Not paired with Roon
      // Core yet"). Dropping it for the generic message throws away the one
      // thing that tells the user what to do.
      if (!r.ok && !(j && j.error)) j = { error: "HTTP " + r.status };
    } catch (e) {
      j = null;
    }
    if (!smartPicksActive || mySeq !== smartPicksSeq) return;   // user moved on
    grid.innerHTML = "";
    if (!j || j.error) {
      setBanner(j && j.error
        ? ("Couldn't load Smart Picks — " + j.error)
        : "Couldn't load Smart Picks — the extension didn't answer. Try again.", true);
      return;
    }
    const picks = j.picks || [];
    if (!picks.length) {
      setBanner(j.service_ready
        ? "Building today's picks — this takes a minute the first time. Come back shortly."
        : "No picks today yet — come back shortly.", false);
      return;
    }
    setBanner(j.service_ready ? null
      : null, false);
    const wrap = document.createElement("div");
    wrap.className = "pick-list";
    for (const p of picks) wrap.appendChild(smartPickCard(p, true));
    grid.appendChild(wrap);
  }

  // Label of the week — one label featured for the whole ISO week (backend
  // picks deterministically). Retried each Home visit until it populates (the
  // labels scan runs in the background), then left alone. Tapping the header
  // opens the full label view.
  // Returns true when it painted a real row (a qualifying label with albums).
  function renderHomeLotw(label, albums) {
    const titleEl = document.getElementById("home-lotw-title");
    albums = albums || [];
    const sec = homeLotw.closest(".home-section");
    if (!label || !albums.length) {
      // No qualifying label yet (labels still scanning / library too small):
      // hide the whole section rather than show an empty row.
      if (sec) sec.classList.add("hidden");
      return false;
    }
    if (titleEl) {
      // "Label of the week: Island" — the name in its own span, which the
      // Late-Night Hi-Fi theme sets large on its own line under the heading.
      titleEl.textContent = "Label of the week";
      const name = document.createElement("span");
      name.className = "home-lotw-name";
      const sep = document.createElement("span");
      sep.className = "home-lotw-sep";
      sep.textContent = ": ";
      name.appendChild(sep);
      name.appendChild(document.createTextNode(label));
      titleEl.appendChild(name);
    }
    homeLotw.dataset.label = label;
    if (sec) sec.classList.toggle("hidden", !homeRowOn("lotw"));   // never un-hide a row the layout switched off   // un-hide if a prior attempt hid it
    homeLotw.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const a of albums) frag.appendChild(homeTile(a));   // full-hierarchy offsets → filter:null
    homeLotw.appendChild(frag);
    return true;
  }

  async function loadHomeLabelOfWeek() {
    if (!homeLotw) return;
    if (!rowHasContent(homeLotw)) homeLotw.innerHTML = '<div class="home-carousel-empty">Loading…</div>';
    try {
      const r = await fetch("/api/home/label-of-the-week");
      const j = await r.json();
      const albums = (j && j.albums) || [];
      if (j && j.label && albums.length) {
        renderHomeLotw(j.label, albums);
        homeLotwLoaded = true;   // populated — stop retrying on future visits
        saveHomeCache({ lotw: { label: j.label, albums } });
      } else if (!rowHasContent(homeLotw)) {
        // Empty 200 (labels index still building after a restart returns
        // {label:null} — not a 503). Only hide the section when nothing is
        // cached; otherwise keep the hydrated row rather than blanking it.
        renderHomeLotw(null, []);
      }
    } catch (e) {
      // Transient failure: keep any cached row rather than blanking it. Only
      // hide the section when there's nothing cached to fall back on.
      if (!rowHasContent(homeLotw)) {
        const sec = homeLotw.closest(".home-section");
        if (sec) sec.classList.add("hidden");
      }
    }
  }
  // ---------------------------------------------------------------------
  // Overflow menu — Roon's three-dots-in-a-circle.
  //
  // ONE definition, used by every screen that has more secondary actions than
  // fit on a row. Before this, the playlist screens laid six pill buttons side
  // by side: .action-btn is `flex: 1 1 0`, so they all shrank together instead
  // of wrapping and "Send to Roon" rendered as "end to Roo".
  //
  // The dropdown reuses .sel-menu / .sel-menu-item — the album view's selection
  // menu — so there is one dropdown look in the app rather than a second one
  // that almost matches.
  // ---------------------------------------------------------------------
  // Mirrors libraryChangingAdvice() on the server, for the notes the client
  // composes itself. Same three things every message on this path carries: why
  // it happened, what the extension is doing, and the manual way out.
  //
  // `moved` is the server's library_moved flag, and it picks the TIMING as well
  // as the wording — the two cases wait on different clocks. When the change is
  // proven the server has already armed the recheck chain (5 minutes); when it
  // is only the likeliest explanation, the next look is the background watch
  // (10 minutes). One number for both would be wrong exactly when it is read.
  function libraryChangingAdvice(moved) {
    return (moved
      ? " Your library changed after this list was built"
      : " This usually means your library changed after this list was built") +
      " — normally because albums are being added or identified. " +
      (moved ? "A re-check is already scheduled — about 5 minutes"
             : "The extension re-checks every 10 minutes") +
      " — and it refreshes itself once the scan settles, so this usually clears on " +
      "its own. If it hasn't, open the side menu and tap Rescan library.";
  }

  // The three dots only. The circle round them is the BUTTON's border
  // (.overflow-btn in style.css, as in MusicD Remote v1.8.60): drawn here, it
  // was a ring about half the height of the Play now / Queue pills beside it.
  const OVERFLOW_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<circle cx="6" cy="12" r="1.9"/>' +
    '<circle cx="12" cy="12" r="1.9"/>' +
    '<circle cx="18" cy="12" r="1.9"/>' +
    "</svg>";

  // Bumped every time iOS backgrounds the app.
  //
  // A suspended PWA has its in-flight fetches torn down, and the rejection is
  // only delivered when the app is reopened. So a request that spanned a
  // hide/show did not fail in any sense the user should hear about — it was
  // interrupted by them switching apps, and the server almost certainly carried
  // it out. Comparing this counter before and after tells the two apart.
  let hiddenEpoch = 0;
  document.addEventListener("visibilitychange", () => { if (document.hidden) hiddenEpoch++; });

  // Close whichever overflow menu is open. Module-level rather than per-menu so
  // opening one closes any other, and so a screen teardown can shut it.
  let _openOverflow = null;
  function closeOverflowMenu() {
    if (!_openOverflow) return;
    _openOverflow.menu.classList.add("hidden");
    _openOverflow.menu.classList.remove("opens-up", "opens-down");
    _openOverflow.btn.setAttribute("aria-expanded", "false");
    _openOverflow = null;
  }
  document.addEventListener("click", (e) => {
    if (_openOverflow && !e.target.closest(".overflow-wrap")) closeOverflowMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverflowMenu();
  });

  // items: [{ label, onClick, danger, title }]. Returns the wrapper to append.
  const HEART_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 20.5s-7.5-4.6-9.3-9.1C1.4 8.1 3.4 5 6.6 5c1.9 0 3.4 1 4.4 2.5C12 6 13.5 5 15.4 5c3.2 0 5.2 3.1 3.9 6.4-1.8 4.5-9.3 9.1-9.3 9.1z"/></svg>';
  // The heart on an album's page: hollow, red once tapped, kept on the server.
  // A streamed album's favourite on its service (Qobuz v0.6.23, Tidal
  // v0.6.24), in the ⋯ menu — Add to Qobuz favourites, or Remove from —
  // apart from the heart, which is Mandarin's own. Only while signed in: the
  // page says whether it is one.
  function serviceMenuItem(page) {
    const a = page && page.album;
    const name = a && SOURCE_LABEL[a.source];
    if (!a || !a.source || a.source === "local" || !a.service_id || typeof a.service_favourite !== "boolean") return [];
    let on = a.service_favourite;
    const label = () => on ? "Remove from " + name + " favourites" : "Add to " + name + " favourites";
    return [{ label: label(), onClick: async (b) => {
      b.disabled = true;
      try {
        const r = await fetch("/api/" + a.source + "/" + (on ? "unfavorite" : "favorite"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ album_id: a.service_id }) });
        const s = await r.json().catch(() => ({}));
        if (!r.ok || s.error) throw new Error(s.error || "Couldn't change it");
        on = !on; a.service_favourite = on; b.textContent = label();
        showToast(on ? "Added to your " + name + " favourites" : "Removed from your " + name + " favourites");
        // Off the walls at once (v0.7.3): removed, the album is no longer in
        // the library, so its page closes and the wall under it is redrawn
        // without it; added, the walls take it in.
        if (!on) closeModal();
        if (window.__libraryChanged) window.__libraryChanged(on ? {} : { gone: a.offset });
      } catch (e) { showToast(e.message, "error"); }
      finally { b.disabled = false; }
    } }];
  }

  function buildFavButton(album, fresh) {
    const on0 = !!((fresh && fresh.favourite) || album.favourite);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "overflow-btn fav-btn" + (on0 ? " is-on" : "");
    b.innerHTML = HEART_SVG;
    const paint = (on) => {
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
      b.setAttribute("aria-label", on ? "Remove from favourites" : "Add to favourites");
      album.favourite = on;
    };
    paint(on0);
    b.addEventListener("click", async () => {
      const want = !b.classList.contains("is-on");
      paint(want);
      try {
        const r = await fetch("/api/favourites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offset: album.offset, on: want }) });
        const jr = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(jr.error || "HTTP " + r.status);
        paint(!!jr.favourite);
        if (window.__favouritesChanged) window.__favouritesChanged();
      } catch (e) {
        paint(!want);
        showToast(e.message, "error");
      }
    });
    return b;
  }

  /*
   * A menu that would be cut off, opened the other way (v0.7.8). Each menu
   * opens the way its screen has room for as a rule — downwards under the
   * button, or upwards over the cover on an album's page — but the box that
   * clips it (the nearest scrolling ancestor, within the window) is not always
   * where the rule expects: an album page scrolled so its button row is near
   * the top, a playlist's menu at the foot of the screen. A menu cut off at the
   * top cannot even be scrolled to. So it is measured as it opens, and turned
   * round when the other side has more room.
   */
  function placeOverflowMenu(menu, btn) {
    menu.classList.remove("opens-up", "opens-down");
    const m = menu.getBoundingClientRect(), b = btn.getBoundingClientRect();
    let top = 0, bottom = window.innerHeight;
    for (let el = menu.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(el).overflowY)) {
        const r = el.getBoundingClientRect();
        top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom);
        break;
      }
    }
    const up = m.bottom <= b.top + 1;
    const roomAbove = b.top - top - 6, roomBelow = bottom - b.bottom - 6;
    if (up && m.height > roomAbove && roomBelow > roomAbove) menu.classList.add("opens-down");
    else if (!up && m.height > roomBelow && roomAbove > roomBelow) menu.classList.add("opens-up");
  }

  function buildOverflowMenu(items, opts) {
    opts = opts || {};
    const wrap = document.createElement("div");
    wrap.className = "overflow-wrap";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "overflow-btn";
    btn.setAttribute("aria-label", opts.label || "More actions");
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = OVERFLOW_SVG;

    const menu = document.createElement("div");
    menu.className = "sel-menu overflow-menu hidden";
    menu.setAttribute("role", "menu");
    if (opts.title) {
      const t = document.createElement("div");
      t.className = "sel-menu-title";
      t.textContent = opts.title;
      menu.appendChild(t);
    }
    for (const it of items) {
      if (!it) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sel-menu-item" + (it.danger ? " is-danger" : "");
      b.setAttribute("role", "menuitem");
      b.textContent = it.label;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        closeOverflowMenu();
        // The button is passed on so an action can disable it / show progress,
        // exactly as the pill buttons it replaced did.
        it.onClick(b);
      });
      menu.appendChild(b);
    }

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = _openOverflow && _openOverflow.menu === menu;
      closeOverflowMenu();
      if (wasOpen) return;
      menu.classList.remove("hidden");
      placeOverflowMenu(menu, btn);
      btn.setAttribute("aria-expanded", "true");
      _openOverflow = { btn, menu };
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  }


  // Shared entry ritual for the full-screen Home walls (Not played / Library):
  // leave other views, clear the filter, take over the shared grid, set the
  // topbar chrome + title, scroll to the top, paint skeletons. Both walls'
  // active flags are reset here; the caller sets its own to true afterwards.
  // `albumWall` says whether this screen shows album TILES — the Library and
  // "Not played" walls do; the playlist screens share the same container but
  // list tracks, and offering a grid/list switch over those would be a control
  // that does nothing.
  function enterFullWall(title, albumWall) {
    // Leaving the artist view through the side menu (v0.6.1): Listen later,
    // Smart Picks, Playlists and the rest all come through here, and an
    // artist view left armed made the shared Back put the old screen back
    // over the new one and reopen the album.
    if (window.__exitArtistView) window.__exitArtistView({ restore: false });
    grid.dataset.wall = "";     // whichever wall comes next says what it is
    unplayedWallActive = false;
    libraryWallActive = false;
    favouritesWallActive = false;
    laterWallActive = false;
    // Cleared here as well as by the caller: every other wall's entry point must
    // orphan an in-flight playlist fetch, or its response paints into this one.
    leavePlaylistScreens();
    // The library wall's sort/focus row belongs to that wall only.
    hideLibraryControls();
    exitAlbumSelectMode();   // a stale multi-select bar must not survive into a new wall
    if (window.__exitLabels) window.__exitLabels();
    if (activeFilter) {
      activeFilter = null;
      try { localStorage.removeItem("rra-filter"); } catch (e) { /* localStorage optional (private browsing) */ }
    }
    if (homeView) homeView.classList.add("hidden");
    if (homeSections) homeSections.classList.remove("hidden");
    grid.classList.remove("hidden");
    setTopbarNav(true, false, false, !!albumWall);   // Back (to Home), no Refresh, no search
    setCountText(title);
    const m = document.querySelector("main");
    if (m) m.scrollTop = 0;
    renderSkeletons(computeAlbumCount());
    return m;
  }

  // Full-screen "Not played in 6 months" grid — reached by tapping the section
  // header. Fills the main grid with a larger unplayed list (tiles open
  // unfiltered, like the Home row) and shows a Back button to Home.
  async function showLaterWall() {
    enterFullWall("Listen later", true);
    laterWallActive = true;
    try {
      const r = await fetch("/api/listen-later", { cache: "no-store" });
      if (!laterWallActive) return;
      const j = await r.json();
      if (!laterWallActive) return;
      const albums = (j && j.albums) || [];
      grid.innerHTML = "";
      if (!albums.length) { setBanner("Nothing put aside — on an album, ⋯ → Listen later. An album comes off here once you’ve played it through.", false); return; }
      setBanner(null);
      const frag = document.createDocumentFragment();
      for (const a of albums) frag.appendChild(homeTile(a));
      grid.appendChild(frag);
    } catch (e) {
      if (!laterWallActive) return;
      grid.innerHTML = "";
      setBanner("Couldn’t load: " + e.message, true);
    }
  }
  let laterWallActive = false;
  window.__showListenLater = showLaterWall;

  async function showFavouritesWall() {
    enterFullWall("Favourites", true);
    favouritesWallActive = true;
    try {
      const r = await fetch("/api/favourites", { cache: "no-store" });
      if (!favouritesWallActive) return;
      const j = await r.json();
      if (!favouritesWallActive) return;
      const albums = (j && j.albums) || [];
      grid.innerHTML = "";
      if (!albums.length) { setBanner("No favourites yet — tap the heart on an album.", false); return; }
      setBanner(null);
      const frag = document.createDocumentFragment();
      for (const a of albums) frag.appendChild(homeTile(a));
      grid.appendChild(frag);
    } catch (e) {
      if (!favouritesWallActive) return;
      grid.innerHTML = "";
      setBanner("Couldn’t load: " + e.message, true);
    }
  }
  let favouritesWallActive = false;

  async function showUnplayedWall() {
    enterFullWall("Not played in 6 months", true);
    unplayedWallActive = true;
    try {
      const r = await fetch("/api/home/unplayed?months=6&count=96");
      // The user may have navigated away while the fetch ran — a late response
      // must not clobber whatever view owns the shared grid now.
      if (!unplayedWallActive) return;
      if (r.status === 503) {
        const j = await r.json().catch(() => ({}));
        if (!unplayedWallActive) return;
        setBanner(j.error || "Reading your music library…", true);
        grid.innerHTML = ""; return;
      }
      const j = await r.json();
      if (!unplayedWallActive) return;
      const albums = (j && j.albums) || [];
      grid.innerHTML = "";
      if (!albums.length) {
        // Six months of listening first (v0.6.0-RC4): before that, every album is "not played".
        const when = j && j.no_history && j.ready_at
          ? " — from " + new Date(j.ready_at).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" }) : "";
        setBanner(j && j.no_history
          ? "Albums show here once Mandarin has six months of listening behind it" + when + "."
          : "Nothing here yet — play some music and check back.", false);
        return;
      }
      setBanner(null);
      const frag = document.createDocumentFragment();
      for (const a of albums) frag.appendChild(homeTile(a));   // filter:null → offsets resolve
      grid.appendChild(frag);
    } catch (e) {
      if (!unplayedWallActive) return;
      grid.innerHTML = "";
      setBanner("Couldn’t load: " + e.message, true);
    }
  }

  // Full-screen Library wall — the WHOLE library in Roon's own album order,
  // loaded in pages from the snapshot index (no Roon calls) and appended as
  // the user scrolls. Reached by tapping the "Library" section header.
  const LIB_PAGE = 60;
  // sort/dir/focus persist so the wall reopens exactly as the user left it.
  // Roon's own Sort/Focus run on a private API — these are built from the
  // extension's own snapshot, so changing them costs no Roon calls at all.
  // ---- Library wall: sort + focus options ---------------------------------
  // Roon's Sort/Focus live on a private API, so these are built from this
  // extension's own snapshot.
  //
  // Declared HERE, above libView, because the persisted-state migration below
  // calls libSortDefaultDir(). A `const` referenced before its declaration is a
  // ReferenceError, not undefined — with these left further down the file the
  // app would fail to boot the moment a v1 blob was in localStorage.
  //
  // `asc`/`desc` are the human meanings of the two arrow directions for that
  // sort, and `dir` is which one you get when you first pick it: alphabetical
  // sorts open A→Z, everything quantitative opens with the biggest/newest
  // first, which is what people mean by "sort by year" or "most played".
  const LIB_SORT_OPTIONS = [
    { id: "album",      label: "Album name",   dir: "asc",
      asc: "A → Z", desc: "Z → A" },
    { id: "artist",     label: "Artist",       dir: "asc",
      asc: "A → Z", desc: "Z → A" },
    // "Release date": the server orders by the day wherever the tags (or
    // MusicBrainz) state one (the id stays "year" — saved views and smart
    // playlists store it). An album known only by its year sorts after that
    // year's dated albums newest-first, and before them oldest-first.
    { id: "year",       label: "Release date", dir: "desc",
      asc: "Oldest first", desc: "Newest first",
      note: "from dates collected during scanning" },
    { id: "added",      label: "Recently added", dir: "desc",
      asc: "Oldest first", desc: "Newest first",
      // Deliberately not "when you added it": Roon publishes no import date,
      // so this is the extension's own evidence — file timestamps, and albums
      // turning up between library scans.
      note: "from dates Mandarin could work out" },
    { id: "plays",      label: "Most played",  dir: "desc",
      asc: "Least played first", desc: "Most played first",
      note: "from plays Mandarin has seen" },
    { id: "lastplayed", label: "Last played",  dir: "desc",
      asc: "Longest ago first", desc: "Most recent first",
      note: "from plays Mandarin has seen" },
    { id: "random",     label: "Random",       dir: "asc" }   // no direction
  ];
  const LIB_PLAYED_OPTIONS = [
    { id: "any",   label: "Any" },
    { id: "never", label: "Never played" },
    { id: "6",     label: "Not in 6 months" },
    { id: "12",    label: "Not in 12 months" }
  ];
  // Random has no meaningful direction, so the arrow control hides for it.
  const libSortHasDir = (id) => id !== "random";
  // A seed the server hasn't just served, so a reshuffle visibly reorders
  // instead of repainting the same shuffle. 1..100000: the server does
  // `parseInt(seed) || 1`, so 0 would silently mean "the default seed".
  function libNextSeed(current) {
    let next = current;
    while (next === current) next = Math.floor(Math.random() * 100000) + 1;
    return next;
  }
  function libSortDefaultDir(id) {
    const o = LIB_SORT_OPTIONS.find(x => x.id === id);
    return o ? o.dir : "asc";
  }

  const LIB_VIEW_KEY = "rra-library-view";
  // v2 changed what `dir` MEANS for Most played / Last played, and ONLY those
  // two: the server used to invert them, so "asc" produced most-played-first.
  // Now "desc" means descending for every sort. Album/Artist/Release year meant
  // the same thing in v1, so a v1 blob keeps its direction for those — dropping
  // it wholesale would silently reset someone's Z→A wall to A→Z and, because
  // the migrated blob is written straight back, lose the preference for good.
  const LIB_VIEW_VERSION = 2;
  const LIB_V1_INVERTED_SORTS = ["plays", "lastplayed"];
  const libWall = { offset: 0, loading: false, done: false, seq: 0, total: 0 };
  // Every multi-select Focus facet, in the order the sheet lays them out. This
  // list is the client's half of libFacetDefs() on the server; the SERVER is
  // what decides which of them actually have values, and the sheet renders
  // whatever /api/library/facets returns rather than assuming. Keeping the ids
  // in one array is what stops the query builder, the saved-view snapshot, the
  // reset and the active-count from drifting apart as facets are added.
  const LIB_FACET_IDS = ["genre", "source", "decade", "label", "format",
                         "rate", "bits", "chan", "letter", "added"];
  const libEmptyFacets = () => {
    const o = {};
    for (const id of LIB_FACET_IDS) o[id] = [];
    return o;
  };
  // `prefix` is deliberately NOT persisted with the rest of the view: it is a
  // momentary narrowing, and restoring one on next launch would look like a
  // library that had lost most of its albums. It is stripped after the restore
  // below for the same reason.
  let libView = Object.assign(
    { v: LIB_VIEW_VERSION, sort: "album", dir: "asc", seed: 1, played: "any", prefix: "" },
    libEmptyFacets());
  try {
    const saved = JSON.parse(localStorage.getItem(LIB_VIEW_KEY) || "null");
    if (saved && typeof saved === "object") {
      const stale = saved.v !== LIB_VIEW_VERSION;
      const dirChangedMeaning = stale && LIB_V1_INVERTED_SORTS.indexOf(saved.sort) > -1;
      if (dirChangedMeaning) delete saved.dir;
      libView = Object.assign(libView, saved, { v: LIB_VIEW_VERSION, prefix: "" });
      if (dirChangedMeaning) libView.dir = libSortDefaultDir(libView.sort);
      // A blob is JSON, so it can be well-formed and still the wrong SHAPE —
      // a partial write or a synced/hand-edited value. Object.assign copies it
      // verbatim, and the try/catch here only covers the parse, so an
      // unvalidated `decade: null` throws later, at render time, inside an
      // un-awaited async handler: the wall opens empty with no error and no way
      // out of it short of clearing site data. Coerce instead.
      for (const id of LIB_FACET_IDS) {
        libView[id] = Array.isArray(libView[id]) ? libView[id].map(String) : [];
      }
      if (!LIB_PLAYED_OPTIONS.some(p => p.id === libView.played)) libView.played = "any";
      if (libView.dir !== "asc" && libView.dir !== "desc") libView.dir = libSortDefaultDir(libView.sort);
      if (!Number.isFinite(libView.seed)) libView.seed = 1;
      if (stale) {
        // Write the migrated blob back NOW rather than waiting for the user to
        // change something. Without this the stored blob stays at v1, so the
        // migration re-runs on every load and keeps resetting the direction
        // they just chose.
        saveLibView();
      }
    }
  } catch (e) { /* corrupt or unavailable — the defaults above stand */ }
  function saveLibView() {
    try { localStorage.setItem(LIB_VIEW_KEY, JSON.stringify(libView)); }
    catch (e) { /* localStorage optional (private browsing) */ }
  }
  // The ORDER half of the library view: the sort, its direction, and — when the
  // sort IS a shuffle — the seed that fixes which shuffle.
  //
  // Split out of libViewQuery() because the Home Library row mirrors the order
  // the user chose on the wall but NOT the Focus narrowing. Focus is a filter on
  // the wall in front of them; applied to a Home shelf labelled "Library" it
  // could empty it from a setting made on another screen, and that row does not
  // hide itself when empty. One function so the two callers cannot drift on what
  // "the order" means.
  function libSortParams() {
    const p = new URLSearchParams();
    p.set("sort", libView.sort);
    p.set("dir", libView.dir);
    if (libView.sort === "random") p.set("seed", String(libView.seed));
    return p;
  }
  // The order as one comparable string — what the Home row records so it can
  // tell "already loaded" from "loaded in an order the user has since changed".
  function libSortKey() { return libSortParams().toString(); }
  function libViewQuery() {
    const p = libSortParams();
    for (const id of LIB_FACET_IDS) {
      for (const v of (libView[id] || [])) p.append(id, v);
    }
    if (libView.played !== "any") p.set("played", libView.played);
    if (libView.prefix) p.set("prefix", libView.prefix);
    return p.toString();
  }
  // How many filters are ON. Every selected chip counts — including the
  // excluded ones, which are as much a filter as the included ones.
  // Only the facets the SERVER is currently publishing. With Labels off the
  // "Record label" facet is gone from the sheet, and counting a selection
  // stored before the switch was flipped would show a filter the user can
  // neither see nor clear.
  // Seeded at boot from the Labels switch, not only when the Focus sheet is
  // first opened. `/api/library/facets` is fetched on sheet open, so relying on
  // it alone left the wall's "N matching albums" and the Focus badge counting a
  // stored Record-label selection on every fresh load until the sheet had been
  // opened once — which is exactly the invisible, unclearable filter this is
  // meant to prevent.
  let libAvailableFacets = LIB_FACET_IDS.slice();
  window.__setLabelsFacetAvailable = (on) => {
    libAvailableFacets = on ? LIB_FACET_IDS.slice()
                            : LIB_FACET_IDS.filter(id => id !== "label");
  };
  const libFocusCount = () =>
    libAvailableFacets.reduce((n, id) => n + (libView[id] || []).length, 0) +
    (libView.played !== "any" ? 1 : 0);
  // Chip state, encoding Roon's tap-again-to-invert: a value prefixed with "!"
  // is EXCLUDED. Kept inside the value so the whole selection stays a plain
  // string array that saved playlists and the query string round-trip unchanged.
  const facetState = (sel, value) =>
    sel.indexOf(value) > -1 ? "on" : (sel.indexOf("!" + value) > -1 ? "not" : "off");
  // off → on → not → off, which is Roon's cycle (green, then red, then clear).
  function facetCycle(sel, value) {
    const i = sel.indexOf(value), j = sel.indexOf("!" + value);
    if (i > -1)      { sel.splice(i, 1, "!" + value); }
    else if (j > -1) { sel.splice(j, 1); }
    else             { sel.push(value); }
    return sel;
  }
  // Any view that takes over the shared grid without going through showHome/
  // showWall (labels browser, label deep-link, artist view) must call this so
  // the wall's infinite scroll can't append library tiles into that view.
  // Returns whether the wall WAS active, so a view that only borrows the grid
  // (the artist view, which restores it on Back) can re-arm paging afterwards.
  // ----- Roon playlists (read + play) --------------------------------------
  //
  // Reached from the side menu, not a Home row: listing playlists is a Roon
  // browse walk, and a Home row would pay for it on every Home load.
  //
  // A playlist is identified across requests by (offset, title) — never an
  // item_key, which is session-scoped server-side. The title is what makes a
  // drifted offset safe, so every call carries it.
  // ONE playlist screen. From the user's side a playlist is a playlist; that
  // some come from Roon and some are stored here is our problem, not something
  // to make them navigate around. Stored ones lead, because they are the ones
  // this app can actually change — imports, and anything added from a
  // selection — and finding a fresh import buried under the Roon list would
  // read as the import having failed.
  //
  // The two sources are fetched together but tolerated separately: Roon being
  // unreachable must not hide playlists that live on this disk, and vice versa.
  async function showPlaylists() {
    enterFullWall("Playlists");
    playlistsActive = true;
    const mySeq = ++playlistSeq;
    grid.innerHTML = "";
    // Import, at the top of the screen (v0.6.24; it was a side-menu item).
    { const pc = document.getElementById("content-count");
      if (pc) {
        pc.innerHTML = "";
        const b = document.createElement("button");
        b.type = "button"; b.className = "playlists-import"; b.textContent = "Import";
        b.setAttribute("aria-label", "Import a playlist");
        b.addEventListener("click", () => { if (window.__openImportSheet) window.__openImportSheet(); });
        pc.appendChild(b);
        pc.classList.remove("hidden");
      } }

    // `null` means "this source did not answer", which is distinct from a
    // source that answered with an empty list — one is a warning, the other is
    // just an empty shelf.
    const read = async (url) => {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) return null;
        return await r.json();
      } catch (e) { return null; }
    };
    const [roon, mine] = await Promise.all([
      read("/api/playlists"), read("/api/user-playlists"),
    ]);
    // Re-check after the await: a late response must not paint into a screen
    // the user has since navigated away from.
    if (!playlistsActive || mySeq !== playlistSeq) return;

    const roonList = (roon && roon.playlists) || [];
    const myList   = (mine && mine.playlists) || [];
    grid.innerHTML = "";

    if (!roonList.length && !myList.length) {
      setBanner(roon === null
        ? "Couldn't read playlists from the server."
        : "No playlists yet — import one, or select tracks and use Add to playlist.",
        roon === null);
      return;
    }
    setBanner(roon === null
      ? "Couldn't reach the server's playlists." : null, roon === null);

    const frag = document.createDocumentFragment();
    for (const p of myList) {
      const n = p.track_total;
      frag.appendChild(buildAlbumTile({
        title: p.name,
        subtitle: `${n} track${n === 1 ? "" : "s"}`,
        image_key: null,
        // Stored tracks carry their album's art, so the mosaic costs nothing.
        art_keys: p.art_keys || []
      }, () => openUserPlaylist(p), { selectable: false }));
    }

    const tiles = new Map();
    for (const p of roonList) {
      const tile = buildAlbumTile(p, () => openPlaylist(p), { selectable: false });
      tiles.set(p.title, tile);
      frag.appendChild(tile);
    }
    grid.appendChild(frag);
    // Only Roon's need a mosaic walk; the stored ones already have their keys.
    if (roonList.length) fillPlaylistMosaics(roonList, tiles, mySeq);
  }
  window.__showPlaylists = showPlaylists;

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
      for (const a of albums) frag.appendChild(homeTile(a));   // filter:null → offsets resolve
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

  // Roon's own phone layout for this row: Focus on the left behind a chevron,
  // the current Sort on the right behind a caret, and NOTHING between them.
  //
  // The separate direction arrow is gone. It was a third boxed control sitting
  // between two others, and Roon has no equivalent — direction is a property of
  // the sort, so it belongs in the sort menu, which has flipped it on a re-tap
  // since v1.6.59. The row still SHOWS the direction (and the reshuffle glyph
  // for Random) as part of the sort's own label, so nothing is hidden; it just
  // isn't its own button any more.
  // (libFilterOpen is declared with the other view flags near the top: since
  // v0.6.5 showHome() and friends reach it through hideLibraryControls().)

  function renderLibraryControls() {
    let bar = document.getElementById("library-controls");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "library-controls";
      // Its own row under the top bar's (v0.6.24): smaller pills, Focus on
      // the left, Sort and the magnifier on the right. Inside .topbar, which
      // lies over the scroller, so the row stays put while the grid scrolls,
      // and the bar's measured height reserves its room.
      bar.className = "library-controls sub-bar";
      const tb = document.querySelector(".topbar");
      const row = document.querySelector(".topbar-row");
      if (tb && row) row.insertAdjacentElement("afterend", bar);
      else grid.parentNode.insertBefore(bar, grid);
    }
    // The search glass stays in the top bar's row, at its right-hand end and
    // the bar's size (v0.6.5); open, the field takes that row as Home's does.
    let filt = document.getElementById("library-filter");
    if (!filt) {
      filt = document.createElement("div");
      filt.id = "library-filter";
      filt.className = "library-filter in-topbar";
      const row = document.querySelector(".topbar-row");
      const before = document.getElementById("labels-tools");
      if (row) row.insertBefore(filt, before && before.parentNode === row ? before : null);
      else bar.appendChild(filt);
    }
    // Both controls open a sheet rather than mutating the view in place, so a
    // rebuild can no longer land under the user's finger mid-interaction — but
    // applyLibView() still rebuilds this row while the sort sheet is open and
    // focus is inside it, and dropping focus to <body> then would strand a
    // keyboard user. Restoring by class is enough: there are two controls and
    // they are rebuilt in a fixed order.
    // Restored by the control's OWN class, not its first one. Every control
    // here starts with `lib-ctl`, so splitting on the first token matched
    // whichever came first in the DOM — focus on Sort came back on Focus.
    const act = document.activeElement;
    const refocus = act && (bar.contains(act) || filt.contains(act)) && act.className
      ? (String(act.className).split(" ").find(c => c !== "lib-ctl" && c) || "lib-ctl")
      : null;
    // Typing survives the rebuild applyLibView() does after every keystroke.
    // `libFilterOpen` is the truth; the live node is only consulted for where
    // the caret was.
    const typing = filt.querySelector(".lib-filter-input");
    const caret = typing ? typing.selectionStart : 0;

    bar.innerHTML = "";
    filt.innerHTML = "";
    // Focus left, Sort right in their row; the magnifier that narrows the
    // list in the bar's row above.
    bar.appendChild(buildLibFocusButton());
    bar.appendChild(buildLibSortButton());
    filt.appendChild(buildLibFilterControl(libFilterOpen));
    bar.classList.toggle("hidden", !libraryWallActive);
    filt.classList.toggle("hidden", !libraryWallActive);
    filt.classList.toggle("is-filtering", libFilterOpen);
    // Marks the bar as the Library wall's, for the phone rule that gives the
    // title's room to the controls.
    { const tb = document.querySelector(".topbar"); if (tb) tb.classList.toggle("lib-wall", libraryWallActive); }
    // Drives the layout: Sort's auto margin is released while the field is
    // open so the input, not the margin, gets the row's free space.
    bar.classList.toggle("is-filtering", libFilterOpen);
    // The open field takes the bar, title included, as Home's search does.
    { const tb = document.querySelector(".topbar");
      if (tb) tb.classList.toggle("lib-filtering", libFilterOpen && libraryWallActive); }

    if (libFilterOpen) {
      const again = filt.querySelector(".lib-filter-input");
      if (again) {
        again.focus();
        try { again.setSelectionRange(caret, caret); }
        catch (e) { /* type="search" refuses setSelectionRange on some engines */ }
      }
    } else if (refocus) {
      const again = bar.querySelector("." + refocus) || filt.querySelector("." + refocus);
      if (again) again.focus();
    }
  }

  // The funnel: a text filter that narrows the wall by the first letters of an
  // album title OR an artist name.
  //
  // A user asked for an A-Z rail down the edge of the screen. That works only
  // while the wall is sorted alphabetically, which is why it broke under the
  // other sorts — a letter index means nothing when the order is by year or
  // play count. Filtering is orthogonal to sorting, so this works under all of
  // them, and it reaches artists as well as titles, which a rail cannot.
  function buildLibFilterControl(open) {
    const wrap = document.createElement("div");
    wrap.className = "lib-filter-wrap";

    if (!open) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lib-filter-btn lib-ctl icon-btn" + (libView.prefix ? " is-active" : "");
      btn.setAttribute("aria-label", "Filter by name");
      btn.setAttribute("aria-expanded", "false");
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
        'aria-hidden="true"><circle cx="11" cy="11" r="7"/>' +
        '<line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        libFilterOpen = true;
        renderLibraryControls();
      });
      wrap.appendChild(btn);
      return wrap;
    }

    // The field as Home's search draws it: a pill with the glass, the input and
    // an ×. The × clears the text when there is any, and closes the field when
    // there is none (v0.6.5).
    const box = document.createElement("div");
    box.className = "search-box lib-filter-box";
    box.innerHTML = '<svg class="search-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    const input = document.createElement("input");
    input.type = "search";
    input.className = "lib-filter-input";
    input.value = libView.prefix || "";
    input.placeholder = "Starts with…";
    input.setAttribute("aria-label", "Filter albums and artists by first letters");
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("input", () => {
      libView.prefix = input.value.trim();
      applyLibView();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeLibFilter();
    });
    const x = document.createElement("button");
    x.type = "button";
    x.className = "search-clear lib-filter-clear";
    x.setAttribute("aria-label", "Clear the filter");
    x.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M18 6 6 18M6 6l12 12"/></svg>';
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!input.value.trim()) { closeLibFilter(); return; }
      input.value = "";
      libView.prefix = "";
      applyLibView();
    });
    box.appendChild(input);
    box.appendChild(x);
    wrap.appendChild(box);
    return wrap;
  }

  // Tap away closes AND clears, the same contract the topbar search follows.
  // A filter left applied behind a closed funnel is a wall that looks broken.
  function closeLibFilter() {
    if (!libFilterOpen) return;
    libFilterOpen = false;
    const had = !!libView.prefix;
    libView.prefix = "";
    if (had) applyLibView();
    else renderLibraryControls();
  }
  document.addEventListener("click", (e) => {
    if (!libFilterOpen) return;
    if (e.target.closest && e.target.closest(".lib-filter-wrap")) return;
    closeLibFilter();
  });

  // `› Focus`, with the number of active facets when there are any. The count
  // is the only state this control carries — what those facets ARE is the
  // sheet's job, and spelling them out here would wrap onto three lines on a
  // phone the moment more than one is on.
  function buildLibFocusButton() { return buildFocusCtl(libFocusCount(), () => openLibFocusSheet(null)); }
  // The control itself, for any wall with a Focus (the Library's; Music on
  // device's since v0.7.4): `n` active filters, `onClick` opens its sheet.
  function buildFocusCtl(n, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lib-ctl lib-ctl-focus" + (n ? " is-active" : "");

    const chev = document.createElement("span");
    chev.className = "lib-ctl-chevron";
    chev.setAttribute("aria-hidden", "true");
    chev.textContent = "›";
    b.appendChild(chev);

    const text = document.createElement("span");
    text.className = "lib-ctl-text";
    text.textContent = "Focus";
    b.appendChild(text);

    if (n) {
      const badge = document.createElement("span");
      badge.className = "lib-ctl-badge";
      badge.textContent = String(n);
      b.appendChild(badge);
    }
    b.setAttribute("aria-label", n
      ? "Focus — " + n + (n === 1 ? " filter active" : " filters active")
      : "Focus");
    // Wrapped, not passed by reference: the listener hands its callback an
    // event, which would arrive as editTarget and be treated as a playlist to
    // save over.
    b.addEventListener("click", () => onClick());
    return b;
  }

  // `Album name ↑ ⌄`. The arrow is a LABEL here, not a control — it says which
  // way the current sort runs, and tapping anywhere on the button opens the
  // sheet where it can be changed.
  function buildLibSortButton() {
    // Random has no direction to show, so the slot carries the reshuffle glyph
    // instead — the same symbol the sort sheet's Random row re-taps to.
    return buildSortCtl(libSortLabel(), libSortHasDir(libView.sort) ? (libView.dir === "desc" ? "↓" : "↑") : "⟳",
      libSortHasDir(libView.sort) ? "Sort — " + libSortLabel() + ", " + libDirLabel() : "Sort — " + libSortLabel(),
      openLibSortSheet);
  }
  function buildSortCtl(label, arrowText, aria, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lib-ctl lib-ctl-sort";

    const text = document.createElement("span");
    text.className = "lib-ctl-text";
    text.textContent = label;
    b.appendChild(text);

    const arrow = document.createElement("span");
    arrow.className = "lib-ctl-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = arrowText;
    b.appendChild(arrow);

    const caret = document.createElement("span");
    caret.className = "lib-ctl-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = "⌄";
    b.appendChild(caret);

    b.setAttribute("aria-label", aria);
    b.addEventListener("click", () => onClick());
    return b;
  }

  // One sheet builder for both — same bottom-sheet language as the filter and
  // settings sheets, built as live nodes (never restored from an HTML string).
  // `onClose` fires on EVERY dismissal path — X, backdrop, and the footer
  // buttons — so a caller that mutated shared state on open can undo it.
  // A name for something: the page's own dialog (the WebView has no prompt box).
  const askName = (message, initial) =>
    window.__promptDialog ? window.__promptDialog(message, initial) : Promise.resolve(window.prompt(message, initial));
  function openLibSheet(title, buildBody, footer, onClose) {
    const back = document.createElement("div");
    back.className = "lib-sheet-backdrop";
    const sheet = document.createElement("div");
    sheet.className = "lib-sheet";
    const head = document.createElement("div");
    head.className = "lib-sheet-head";
    const h = document.createElement("h3"); h.textContent = title;
    const x = document.createElement("button");
    x.type = "button"; x.className = "icon-btn"; x.setAttribute("aria-label", "Close");
    x.textContent = "✕";
    head.appendChild(h); head.appendChild(x);
    const body = document.createElement("div");
    body.className = "lib-sheet-body";
    sheet.appendChild(head); sheet.appendChild(body);
    const close = () => { back.remove(); if (onClose) onClose(); };
    buildBody(body, close);
    if (footer) {
      const f = document.createElement("div");
      f.className = "lib-sheet-foot";
      footer(f, close);
      sheet.appendChild(f);
    }
    x.addEventListener("click", close);
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    back.appendChild(sheet);
    document.body.appendChild(back);
  }

  // ----- Add a selection to a playlist --------------------------------------
  // Tracks go in as themselves. ALBUMS cannot: a stored entry names a specific
  // track, and the album's tracklist only exists on the Core. Rather than
  // opening every selected album — seconds of Roon calls behind a menu tap —
  // this says so plainly and leaves the album selection intact.
  async function addSelectionToPlaylist() {
    if (selMenuKind === "albums") {
      if (!albumSelected.length) return;
      // Every track of every selected album. The album's tracklist only exists
      // on the Core, so this is the one add that costs Roon calls — bounded
      // server-side and reported per album.
      openAddToPlaylistSheet(null, albumSelected.map(a => ({
        offset: a.offset, title: a.title || "", subtitle: a.subtitle || "",
        image_key: a.image_key || null,
      })));
      return;
    }
    if (!currentAlbum) { showToast("No album open", "error"); return; }
    const picks = trackSelected.slice().sort((a, b) => a.index - b.index);
    if (!picks.length) return;
    const entries = picks.map(p => ({
      album_offset:   currentAlbum.offset,
      album_title:    currentAlbum.title || "",
      album_subtitle: currentAlbum.subtitle || "",
      track_index:    p.index,
      title:          p.title,
      subtitle:       currentAlbum.subtitle || "",
      image_key:      currentAlbum.image_key || null,
    }));
    openAddToPlaylistSheet(entries, null);
  }

  // Exactly one of `entries` (tracks) and `albums` is supplied. They land on
  // different routes because only the album one has to talk to Roon.
  async function openAddToPlaylistSheet(entries, albums) {
    const n = entries ? entries.length : (albums || []).length;
    if (!n) { showToast("Nothing to add", "error"); return; }
    let list = [];
    try {
      const r = await fetch("/api/user-playlists", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast("Couldn't read your playlists", "error"); return; }
      list = j.playlists || [];
    } catch (e) {
      showToast("Couldn't reach the extension", "error");
      return;
    }

    const what = entries
      ? `${n} track${n === 1 ? "" : "s"}`
      : `${n} album${n === 1 ? "" : "s"}`;
    openLibSheet(`Add ${what} to…`,
      (body, close) => {
        const row = (label, fn) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "action-btn sheet-row";
          // textContent, never a template: a playlist name is user text and
          // this sheet has no business interpreting it as markup.
          b.textContent = label;
          b.addEventListener("click", () => { close(); fn(); });
          body.appendChild(b);
        };
        row("＋ New playlist…", async () => {
          const name = await askName("Name this playlist", "My playlist");
          if (name === null) return;
          const trimmed = String(name).trim();
          if (!trimmed) { showToast("Give it a name", "error"); return; }
          addToUserPlaylist({ name: trimmed }, entries, albums).then(ok => {
            if (ok) clearAfterAdd();
          });
        });
        for (const p of list) {
          row(`${p.name} · ${p.track_total} track${p.track_total === 1 ? "" : "s"}`, () => {
            addToUserPlaylist({ id: p.id }, entries, albums).then(ok => {
              if (ok) clearAfterAdd();
            });
          });
        }
      });
  }

  // ----- Playlists stored by this extension ---------------------------------
  // These share the Playlists wall with Roon's own (see showPlaylists) — there
  // is no separate screen, so there is no separate list renderer either.

  async function openUserPlaylist(p) {
    enterFullWall("");   // the stored playlist prints its own full-width heading
    userPlDetailActive = true;
    const mySeq = ++userPlSeq;
    setBanner(null);
    grid.innerHTML = "";

    let j = null;
    try {
      const r = await fetch(`/api/user-playlist?id=${encodeURIComponent(p.id)}`, { cache: "no-store" });
      j = await r.json().catch(() => ({}));
      if (!userPlDetailActive || mySeq !== userPlSeq) return;
      if (!r.ok) { setBanner(j.error || "Couldn't open that playlist.", true); return; }
    } catch (e) {
      if (!userPlDetailActive || mySeq !== userPlSeq) return;
      setBanner("Couldn't reach the extension.", true);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "playlist-detail";

    const back = document.createElement("button");
    back.type = "button"; back.className = "action-btn playlist-back";
    back.textContent = "← Playlists";
    back.addEventListener("click", () => { userPlDetailActive = false; showPlaylists(); });
    wrap.appendChild(back);

    const head = document.createElement("div");
    head.className = "playlist-head";
    const h = document.createElement("h2");
    h.className = "playlist-title";
    h.textContent = j.name || "Playlist";
    head.appendChild(h);
    const sub = document.createElement("div");
    sub.className = "playlist-sub";
    sub.textContent = `${j.track_total} track${j.track_total === 1 ? "" : "s"}`;
    head.appendChild(sub);
    wrap.appendChild(head);

    const tracks = j.tracks || [];
    const actions = document.createElement("div");
    actions.className = "playlist-actions";
    const mkBtn = (label, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = cls; b.textContent = label;
      b.addEventListener("click", () => fn(b));
      actions.appendChild(b);
      return b;
    };
    mkBtn("Play now", "action-btn primary", (b) => playUserPlaylist(tracks, "play_now", b));
    mkBtn("Queue",    "action-btn",         (b) => playUserPlaylist(tracks, "queue", b));
    const shareThisPlaylist = (b) => shareTracks(j.name || "Playlist",
      tracks.map(t => ({
        title: t.title, artist: t.subtitle,
        album: t.album_title, track_no: t.track_no
      })), b, {});
    const deleteThisPlaylist = async () => {
      const ok = await confirmDialog(`Delete "${j.name}"? This can't be undone.`);
      if (!ok) return;
      try {
        const r = await fetch("/api/user-playlists/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: p.id })
        });
        if (!r.ok) { showToast("Couldn't delete that", "error"); return; }
        showToast("Playlist deleted");
        if (window.__playlistsChanged) window.__playlistsChanged();
        userPlDetailActive = false;
        showPlaylists();
      } catch (e) { showToast("Couldn't reach the extension", "error"); }
    };
    actions.appendChild(buildOverflowMenu([
      { label: "Share",  onClick: (b) => shareThisPlaylist(b) },
      { label: "Delete", onClick: () => deleteThisPlaylist(), danger: true },
    ], { title: j.name || "Playlist" }));
    wrap.appendChild(actions);

    const ol = document.createElement("ol");
    ol.className = "track-list playlist-tracks";
    for (const t of tracks) ol.appendChild(userTrackRow(t));
    wrap.appendChild(ol);

    if (!tracks.length) {
      const empty = document.createElement("div");
      empty.className = "playlist-empty";
      empty.textContent = "Nothing in this playlist yet.";
      wrap.appendChild(empty);
    }
    grid.appendChild(wrap);
  }

  // Same row shape as the smart-playlist screen — artwork, two lines, tap to
  // play from its album.
  function userTrackRow(t) {
    const li = document.createElement("li");
    li.className = "track-row track-row-art";
    li.dataset.albumOffset = String(t.album_offset);

    const art = document.createElement("span");
    art.className = "track-art";
    if (t.image_key) {
      art.dataset.artKey = t.image_key;
      const img = document.createElement("img");
      img.loading = "lazy"; img.alt = "";
      img.src = `/api/image/${encodeURIComponent(t.image_key)}?size=80`;
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
          body: JSON.stringify({
            offset: t.album_offset, track: t.track_index, title: t.title,
            zone_or_output_id: zone, kind: "play_now",
            // A stored entry can be months old, so the album identity matters
            // far more here than it does from a modal opened seconds ago.
            album_title: t.album_title, album_subtitle: t.album_subtitle
          })
        });
        const j2 = await r.json().catch(() => ({}));
        if (!r.ok) { showToast(j2.error || "Couldn't play that track", "error"); return; }
        showToast(`Playing ${t.title}`);
      } catch (e) { showToast("Couldn't reach the extension", "error"); }
    });
    return li;
  }

  // Sequential by necessity: /api/play-track has no batch form, and firing
  // these in parallel would interleave into an arbitrary queue order.
  async function playUserPlaylist(tracks, kind, btn) {
    const zsel = document.getElementById("zone-select");
    const zone = (zsel && zsel.value) || selectedZoneId;
    if (!zone) { showToast("Choose a zone first", "error"); return; }
    if (!tracks.length) { showToast("Nothing in this playlist", "error"); return; }
    btn.disabled = true;
    let queued = 0, failed = 0, firstError = "";
    try {
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        if (tracks.length > 3) showToast(`Adding track ${i + 1} of ${tracks.length}…`);
        try {
          const r = await fetch("/api/play-track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              offset: t.album_offset, track: t.track_index, title: t.title,
              zone_or_output_id: zone,
              // Only the first honours the kind; the rest queue behind it.
              kind: (i === 0 ? kind : "queue"),
              album_title: t.album_title, album_subtitle: t.album_subtitle
            })
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) { failed++; if (!firstError) firstError = j.error || `HTTP ${r.status}`; }
          else queued++;
        } catch (e) {
          failed++;
          if (!firstError) firstError = "Couldn't reach the extension";
        }
      }
    } finally {
      btn.disabled = false;
    }
    if (!queued) { showToast(firstError || "Sonos refused those tracks", "error", TOAST_REPORT_MS); return; }
    const verb = kind === "queue" ? "Queued" : kind === "play_next" ? "Playing next:" : "Playing";
    let msg = `${verb} ${queued} track${queued === 1 ? "" : "s"}`;
    if (failed) msg += ` (${failed} couldn't be found: ${firstError})`;
    showToast(msg, failed ? "error" : null, TOAST_REPORT_MS);
  }

  // ----- Importing a shared playlist ----------------------------------------
  // The other half of Share. Paste the blob, and every entry is matched against
  // THIS library — the shared file names music, it does not carry it, so what
  // you end up with is whatever your own library can answer for.
  function openImportSheet() {
    openLibSheet("Import a playlist", (body) => {
      const note = document.createElement("div");
      note.className = "share-note";
      note.textContent =
        "Paste a playlist someone shared with you. It describes the music, so " +
        "you'll get the tracks your own library can match — the rest are listed " +
        "so you know what's missing.";
      body.appendChild(note);

      const ta = document.createElement("textarea");
      ta.className = "share-blob";
      ta.id = "import-blob";
      ta.rows = 4;
      ta.placeholder = "MDRP1:…";
      // iOS autocorrect treats MDRP1 as a word it doesn't know and lowercases
      // it on paste, which broke the marker while leaving the payload intact.
      // The payload itself is base64url and case-SENSITIVE, so this must be
      // off — a "correction" anywhere in it would be unrecoverable.
      ta.setAttribute("autocapitalize", "none");
      ta.setAttribute("autocorrect", "off");
      ta.setAttribute("autocomplete", "off");
      ta.spellcheck = false;
      body.appendChild(ta);

      // A downloaded .musicd file is the other half of Share's Download, and
      // on a phone it is far more reliable than a clipboard: the blob is long
      // enough that a hand-selection can silently come back short.
      const pick = document.createElement("label");
      pick.className = "action-btn import-file";
      pick.textContent = "Choose a file…";
      const file = document.createElement("input");
      file.type = "file";
      // .musicd is what Share writes; text/plain covers a file renamed or
      // re-saved by a mail client, and iOS is inconsistent about extensions it
      // does not recognise.
      file.accept = ".musicd,text/plain";
      file.className = "visually-hidden";
      file.id = "import-file";
      file.addEventListener("change", () => {
        const f = file.files && file.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          ta.value = String(reader.result || "");
          const out = document.getElementById("import-result");
          if (out) out.textContent = `Loaded ${f.name} — press Import.`;
        };
        reader.onerror = () => {
          const out = document.getElementById("import-result");
          if (out) out.textContent = "Couldn't read that file.";
        };
        reader.readAsText(f);
      });
      pick.appendChild(file);
      body.appendChild(pick);

      const out = document.createElement("div");
      out.className = "import-result";
      out.id = "import-result";
      body.appendChild(out);
    }, (foot, close) => {
      const go = document.createElement("button");
      go.type = "button"; go.className = "action-btn primary";
      go.textContent = "Import";
      go.addEventListener("click", () => runImport(go));
      foot.appendChild(go);

      const done = document.createElement("button");
      done.type = "button"; done.className = "action-btn";
      done.textContent = "Close";
      done.addEventListener("click", close);
      foot.appendChild(done);
    });
  }

  async function runImport(btn) {
    const ta = document.getElementById("import-blob");
    const out = document.getElementById("import-result");
    const blob = ta ? ta.value.trim() : "";
    if (!blob) { showToast("Paste the playlist first", "error"); return; }
    btn.disabled = true;
    if (out) out.textContent = "Matching against your library…";
    try {
      const j = await postImport(blob, false);
      if (!j.ok) {
        if (out) out.textContent = j.error || "Couldn't read that playlist";
        return;
      }
      renderImportResult(out, j, btn);

      // Anything names alone couldn't place gets a second pass that reads what
      // is actually ON the library's albums. It runs automatically because the
      // alternative is asking the user to do a manual search, which is the
      // thing this is meant to replace — but it runs SECOND, so the fast
      // answer is on screen while it works.
      if (j.deep_available) {
        // Saving DURING the second pass would create a playlist from the
        // smaller set, and the second render then replaces the "Saved" state
        // on a detached node — so a second tap makes a second playlist with
        // the same name (the server creates by name, it never finds one).
        // Nothing to save until the count is final.
        const save = out.querySelector(".import-save");
        if (save) { save.disabled = true; save.textContent = "Searching your library…"; }
        const note = document.createElement("div");
        note.className = "share-sum share-sub-note";
        note.textContent = `Looking inside your albums for the other ${j.missing.length}…`;
        out.appendChild(note);
        const deep = await postImport(blob, true);
        if (deep.ok) {
          renderImportResult(out, deep, btn);
        } else {
          note.textContent = "Couldn't finish the deeper search — the matches above still stand.";
          if (save) { save.disabled = false; save.textContent = `Save ${(j.resolved || []).length} tracks as a playlist`; }
        }
      }
    } catch (e) {
      if (out) out.textContent = "Couldn't reach the extension";
    } finally {
      btn.disabled = false;
    }
  }

  // Returns the parsed body with `ok` reflecting the HTTP status, so callers
  // never have to hold both.
  async function postImport(blob, deep) {
    const r = await fetch("/api/share/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blob, deep: !!deep })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j.error };
    return j;
  }

  // The resolution report. Showing what did NOT match is the point: every tool
  // in this space quietly substitutes the wrong version, and a count that only
  // celebrates the hits is how you stop trusting it.
  function renderImportResult(out, j, btn) {
    if (!out) return;
    out.textContent = "";
    const n = (j.resolved || []).length;
    const miss = j.missing || [];

    const head = document.createElement("div");
    head.className = "share-sum";
    head.textContent = `${n} of ${j.total} track${j.total === 1 ? "" : "s"} found in your library`;
    out.appendChild(head);

    if (j.truncated) {
      const w = document.createElement("div");
      w.className = "share-warn";
      w.textContent = "That playlist is longer than one import can take — the end of it was left out.";
      out.appendChild(w);
    }

    if (miss.length) {
      const w = document.createElement("div");
      w.className = "share-warn";
      w.textContent = `${miss.length} couldn't be matched:`;
      out.appendChild(w);
      const ul = document.createElement("ul");
      ul.className = "import-missing";
      // Bounded: a 500-track import that matched nothing would otherwise
      // render 500 rows into a bottom sheet.
      for (const m of miss.slice(0, 25)) {
        const li = document.createElement("li");
        li.textContent = [m.title, m.artist, m.album].filter(Boolean).join(" · ");
        ul.appendChild(li);
      }
      if (miss.length > 25) {
        const li = document.createElement("li");
        li.textContent = `…and ${miss.length - 25} more`;
        ul.appendChild(li);
      }
      out.appendChild(ul);
    }

    // Tracks found under an album the share did not name. Shown, not hidden:
    // this is a SUBSTITUTION, and the whole reason the import report exists is
    // that quietly swapping one record for another is what makes these tools
    // untrustworthy. Two servers indexing the same files group compilations
    // differently, so this is the normal case rather than an odd one.
    const sub = j.substituted || [];
    if (sub.length) {
      const w = document.createElement("div");
      w.className = "share-sum share-sub-note";
      w.textContent = `${sub.length} found on a different album than the playlist named:`;
      out.appendChild(w);
      const ul = document.createElement("ul");
      ul.className = "import-missing import-substituted";
      for (const m of sub.slice(0, 25)) {
        const li = document.createElement("li");
        li.textContent = [m.title, m.artist].filter(Boolean).join(" · ") +
                         " — " + (m.found_album || "your library");
        ul.appendChild(li);
      }
      if (sub.length > 25) {
        const li = document.createElement("li");
        li.textContent = `…and ${sub.length - 25} more`;
        ul.appendChild(li);
      }
      out.appendChild(ul);
    }

    if (!n) {
      const w = document.createElement("div");
      w.className = "share-warn";
      w.textContent = "Nothing here matched, so there's nothing to save.";
      out.appendChild(w);
      return;
    }

    const save = document.createElement("button");
    save.type = "button"; save.className = "action-btn primary import-save";
    save.textContent = `Save ${n} track${n === 1 ? "" : "s"} as a playlist`;
    save.addEventListener("click", async () => {
      const name = await askName("Name this playlist", j.name || "Shared playlist");
      if (name === null) return;
      const trimmed = String(name).trim();
      if (!trimmed) { showToast("Give it a name", "error"); return; }
      save.disabled = true;
      const okAdd = await addToUserPlaylist({ name: trimmed }, j.resolved);
      save.disabled = false;
      if (okAdd) {
        save.textContent = "Saved";
        save.disabled = true;
      }
    });
    out.appendChild(save);
  }

  // Whichever selection is live, cleared once it has been filed somewhere.
  function clearAfterAdd() {
    if (trackSelectMode) exitTrackSelectMode();
    if (albumSelectMode) exitAlbumSelectMode();
  }

  // Shared by import and by "Add to playlist". `target` is {id} for an existing
  // playlist or {name} to create one. Exactly one of `tracks`/`albums` is set —
  // albums go to the route that reads their tracklists off the Core.
  async function addToUserPlaylist(target, tracks, albums) {
    const url = albums ? "/api/user-playlists/add-albums" : "/api/user-playlists/add";
    const payload = albums
      ? { id: target.id, name: target.name, albums }
      : { id: target.id, name: target.name, tracks };
    if (albums) showToast(`Reading ${albums.length} album${albums.length === 1 ? "" : "s"}…`);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(j.error || "Couldn't save that", "error"); return false; }
      let msg = `Added ${j.added} track${j.added === 1 ? "" : "s"}`;
      if (Number.isFinite(j.albums_read)) {
        msg += ` from ${j.albums_read} album${j.albums_read === 1 ? "" : "s"}`;
      }
      msg += ` to "${j.name}"`;
      if (j.full)    msg += " — the playlist is now full";
      if (j.skipped) msg += `; ${j.skipped} couldn't be stored` + (j.reason ? ` (${j.reason})` : "");
      // Named, not counted: knowing WHICH album Roon wouldn't open is the only
      // way to do anything about it.
      if (j.albums_failed && j.albums_failed.length) {
        msg += `; couldn't read ${j.albums_failed.join(", ")}`;
      }
      showToast(msg, (j.albums_failed && j.albums_failed.length) ? "error" : null,
                TOAST_REPORT_MS);
      if (window.__playlistsChanged) window.__playlistsChanged();
      return true;
    } catch (e) {
      showToast("Couldn't reach the extension", "error");
      return false;
    }
  }

  window.__openImportSheet = openImportSheet;

  // ----- Sharing a playlist -------------------------------------------------
  // What leaves the app is a DESCRIPTION of the music, never audio and never
  // anything else: the entries below are built field-by-field from the rows on
  // screen. Nothing is forwarded wholesale from a server response, so an export
  // cannot pick up a field it was never meant to carry.
  //
  // See docs/design/playlist-sharing.md.

  // Ask the server to turn entries into a share blob, then show it.
  //
  // `caveats` is what the CLIENT knows and the server cannot: that collection
  // stopped at the album cap, that a page failed part-way, or that the source
  // playlist was already truncated before we saw it. The server's own
  // `truncated` only ever describes the list it was handed, so relying on it
  // alone meant every client-side limit went unreported — the exact shape of
  // the v1.7.17 bug this feature was written to avoid repeating.
  async function shareTracks(name, entries, btn, caveats) {
    if (!entries.length) { showToast("Nothing to share yet", "error"); return; }
    if (btn) btn.disabled = true;
    try {
      const r = await fetch("/api/share/encode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, tracks: entries })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(j.error || "Couldn't build the share file", "error"); return; }
      openShareSheet(name, j, caveats || {});
    } catch (e) {
      showToast("Couldn't reach the extension", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // The blob, plus the two ways to get it off this device. Everything the user
  // is told here is a fact from the response — how many tracks went in, and
  // what was left out — because a share file that quietly dropped half a
  // playlist is worse than one that refused to build.
  function openShareSheet(name, j, caveats) {
    const c = caveats || {};
    openLibSheet("Share " + name, (body) => {
      const n = j.track_count || 0;
      const sum = document.createElement("div");
      sum.className = "share-sum";
      sum.textContent = `${n} track${n === 1 ? "" : "s"}`;
      body.appendChild(sum);

      // Every reason this file might be less than the whole playlist, each on
      // its own line. One run-on sentence buried the important half.
      const warnings = [];
      if (c.incomplete) {
        warnings.push("Reading stopped early because the server returned an error — " +
                      "this file is INCOMPLETE. Try again before sharing it.");
      }
      if (c.albumsCapped) {
        warnings.push(`Only the first ${SHARE_ALBUM_MAX} albums were read — ` +
                      "that's the limit for one go.");
      }
      if (c.sourceTruncated) {
        warnings.push("The playlist is longer than this app can read in one go, " +
                      "so the end of it isn't here.");
      }
      if (j.truncated) warnings.push("Stopped at the sharing limit of tracks.");
      if (j.skipped) {
        warnings.push(`${j.skipped} entr${j.skipped === 1 ? "y" : "ies"} had no title ` +
                      `and ${j.skipped === 1 ? "was" : "were"} left out.`);
      }
      // Above 40 KB a paste starts getting silently truncated by messaging
      // apps, which turns into a blob that decodes to nothing on the far end.
      if (j.bytes > 40000) {
        warnings.push(`This is ${Math.round(j.bytes / 1024)} KB — too big to paste ` +
                      "reliably. Use Download and send the file.");
      }
      for (const w of warnings) {
        const el = document.createElement("div");
        el.className = "share-warn";
        el.textContent = w;
        body.appendChild(el);
      }

      const note = document.createElement("div");
      note.className = "share-note";
      note.textContent =
        "This describes the music, not the music itself. Whoever imports it " +
        "gets whatever their own library or streaming service can match.";
      body.appendChild(note);

      // readOnly rather than disabled: the text must stay selectable so a
      // long-press copy works where the Clipboard API doesn't.
      const ta = document.createElement("textarea");
      ta.className = "share-blob";
      ta.id = "share-blob";
      ta.readOnly = true;
      ta.setAttribute("autocapitalize", "none");
      ta.setAttribute("autocorrect", "off");
      ta.spellcheck = false;
      ta.rows = 4;
      ta.value = j.blob || "";
      body.appendChild(ta);
    }, (foot, close) => {
      const copy = document.createElement("button");
      copy.type = "button"; copy.className = "action-btn primary";
      copy.textContent = "Copy";
      copy.addEventListener("click", async () => {
        // navigator.clipboard is a SECURE-CONTEXT api and this extension is
        // served over plain http on the LAN, so on most devices it simply does
        // not exist — the "modern" path was never once taken in practice, and
        // every user was silently pushed to hand-selecting the blob. That is
        // how a copy comes back short. execCommand still works on http, so it
        // is tried FIRST and the async API is the fallback, not the other way
        // round.
        const ta = document.getElementById("share-blob");
        if (ta) {
          ta.focus();
          ta.setSelectionRange(0, (j.blob || "").length);
          try {
            if (document.execCommand && document.execCommand("copy")) {
              showToast("Copied — paste it to whoever you're sharing with");
              return;
            }
          } catch (e) { /* falls through to the async API below */ }
        }
        try {
          await navigator.clipboard.writeText(j.blob || "");
          showToast("Copied — paste it to whoever you're sharing with");
        } catch (e) {
          // Both refused. The text is selected, so a manual copy still works —
          // say so rather than failing silently.
          showToast("Couldn't copy automatically — the text is selected, copy it by hand",
                    "error", TOAST_REPORT_MS);
        }
      });
      foot.appendChild(copy);

      const dl = document.createElement("button");
      dl.type = "button"; dl.className = "action-btn";
      dl.textContent = "Download";
      dl.addEventListener("click", () => {
        const safe = (name || "playlist").replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
        const blob = new Blob([j.blob || ""], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = safe + ".musicd";
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoking immediately can race the download on some browsers.
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      });
      foot.appendChild(dl);

      const done = document.createElement("button");
      done.type = "button"; done.className = "action-btn";
      done.textContent = "Done";
      done.addEventListener("click", close);
      foot.appendChild(done);
    });
  }

  // Roon ARC's sort popover, in this app's bottom-sheet language: a plain list
  // of fields, and the SELECTED one carries an arrow. Tapping the selected row
  // flips that arrow instead of re-selecting; tapping any other row switches to
  // it at its own default direction. There is no separate direction row and no
  // sentence to read — the arrow is the whole affordance.
  function openLibSortSheet() {
    openLibSheet("Sort by", (body, close) => {
      const paint = () => {
        // Reversing in place replaces the row that was just activated — keep
        // focus on its replacement so the row can be pressed again without
        // tabbing back to it. Rows are rebuilt in a fixed order, so position
        // identifies the replacement.
        const rows = body.querySelectorAll(".lib-sort-row");
        const focused = Array.prototype.indexOf.call(rows, document.activeElement);
        body.innerHTML = "";
        for (const opt of LIB_SORT_OPTIONS) {
          const on = libView.sort === opt.id;
          const row = document.createElement("button");
          row.type = "button";
          row.className = "lib-sort-row" + (on ? " is-on" : "");

          // The arrow occupies a fixed column on every row, filled only on the
          // selected one, so the labels stay on a single left edge.
          const arrow = document.createElement("span");
          arrow.className = "lib-sort-arrow";
          arrow.setAttribute("aria-hidden", "true");
          arrow.textContent = (on && libSortHasDir(opt.id))
            ? (libView.dir === "desc" ? "↓" : "↑") : "";
          row.appendChild(arrow);

          const text = document.createElement("span");
          text.className = "lib-sort-text";
          const main = document.createElement("span");
          main.className = "lib-sort-label";
          main.textContent = opt.label;
          text.appendChild(main);
          if (opt.note) {
            const sub = document.createElement("span");
            sub.className = "lib-sort-note";
            sub.textContent = opt.note;
            text.appendChild(sub);
          }
          row.appendChild(text);

          if (on && libSortHasDir(opt.id)) {
            row.setAttribute("aria-label", opt.label + " — " + libDirLabel() + ", tap to reverse");
          }
          row.addEventListener("click", () => {
            if (on) {
              // Already selected: this tap means "reverse", exactly as in ARC.
              // Random is the one row with nothing to reverse — re-tapping it
              // reshuffles instead, which is the only useful thing it can do.
              if (libSortHasDir(opt.id)) {
                libView.dir = libView.dir === "desc" ? "asc" : "desc";
              } else {
                libView.seed = libNextSeed(libView.seed);
                close();
              }
            } else {
              libView.sort = opt.id;
              libView.dir = libSortDefaultDir(opt.id);
              // Switching TO Random re-rolls: without this the first shuffle on
              // a fresh install always runs on the default seed, so "random"
              // gives every device the identical order until ⟳ is tapped.
              if (!libSortHasDir(opt.id)) libView.seed = libNextSeed(libView.seed);
              close();
            }
            // Repaint before applying so a reverse-in-place shows its new arrow
            // immediately; the wall reloads behind the open sheet.
            if (document.body.contains(body)) paint();
            applyLibView();
          });
          body.appendChild(row);
        }
        // Focus back on the row in the same place (v0.7.9: worked out above
        // and then never applied, so a keyboard user lost their place).
        if (focused >= 0) { const again = body.querySelectorAll(".lib-sort-row")[focused]; if (again) again.focus(); }
      };
      paint();
    });
  }

  // `editTarget` (a smart playlist) makes this sheet's "Save as…" an
  // update-in-place. Passed in rather than held in a module variable: an
  // abandoned edit — closing the sheet with X, the backdrop, or Show albums —
  // would otherwise leave that variable set, and the NEXT save from the Focus
  // bar would silently overwrite the playlist edited earlier.
  // Album counts a dynamic playlist can be limited to. The ceiling is the
  // play-time one: 400 albums is ~3,200 Roon calls and minutes of queueing.
  const SMART_LIMITS = [25, 50, 100, 200, 400];
  const SMART_LIMIT_DEFAULT = 100;   // matches smartLimitDefault() on the server

  // What a new playlist is made OF, asked first because it changes what the
  // playlist DOES rather than which albums it matches — and because it is the
  // one choice that can't be inferred from the focus.
  //
  // Both modes run the same album query. "Albums" queues whole records in
  // order; "Tracks" expands them and lists the tracks individually. The filter
  // itself is always album-level: Roon's API publishes no track list without
  // opening each album one at a time, so a genuinely track-level FILTER would
  // mean indexing every track in the library — thousands of Roon calls, redone
  // on every change — which is the traffic the snapshot exists to avoid. This
  // is stated in the sheet rather than hidden, so the choice is understood.
  const SMART_MODES = [
    { id: "albums", label: "Albums",
      note: "Queues whole albums, in their own running order." },
    { id: "tracks", label: "Tracks",
      note: "Lists the tracks from those albums, so you can play or queue them one at a time." }
  ];
  const SMART_MODE_DEFAULT = "albums";   // matches smartModeDefault() on the server
  // What order it comes out in — a separate axis from what it is made of.
  const SMART_ORDERS = [
    { id: "album",  label: "Album order" },
    { id: "random", label: "Random" }
  ];
  const SMART_ORDER_DEFAULT = "album";   // matches smartOrderDefault() on the server

  async function openLibFocusSheet(editTarget) {
    // Snapshot BEFORE the edited view is applied, so abandoning the sheet can
    // put the user's own Library view back exactly as it was.
    const viewBefore = editTarget ? currentLibViewSnapshot() : null;
    // Lives outside the view: two playlists can share a query and differ here,
    // which is also why the server applies it by slicing rather than inside
    // libraryView(), whose cache is keyed on the query alone.
    let editLimit = (editTarget && editTarget.limit) || 100;
    // Same reasoning as the limit: two playlists can share a query and differ
    // in what order it comes out in, so this lives beside the view rather than
    // inside it.
    let editOrder = (editTarget && editTarget.order) || SMART_ORDER_DEFAULT;
    if (editTarget) applyViewToLibView(editTarget.view);
    let committed = false;
    // Re-read every time the sheet opens. Caching these for the life of the
    // page meant a rescan changed the library and the Focus sheet went on
    // reporting the old counts until a full reload — which reads as the rescan
    // having done nothing.
    try {
      const r = await fetch("/api/library/facets", { cache: "no-store" });
      if (r.ok) libFacets = await r.json();
    } catch (e) { /* offline — keep whatever we last had rather than blanking */ }
    // The server decides the vocabulary — it drops "Record label" when Labels
    // is switched off — so the count badge follows what it publishes rather
    // than a list hardcoded here.
    if (libFacets && Array.isArray(libFacets.facets)) {
      const ids = libFacets.facets.map(x => x && x.id).filter(Boolean);
      if (ids.length) libAvailableFacets = ids;
    }
    const f = libFacets || { facets: [], coverage: {} };
    // Which sections are expanded. Held across repaints (a chip tap rebuilds
    // the body) but NOT across openings: a sheet that reopens half-collapsed
    // hides filters that are still on.
    const openSections = {};
    openLibSheet("Focus", (body) => {
      // One collapsible category. Roon's own Focus is a row of scrolling
      // columns; on a phone that becomes a vertical stack, and with ten
      // categories — some of them hundreds of labels long — every one expanded
      // is a sheet nobody can find the bottom of. Collapsed by default unless
      // something in it is selected, so what's ON is always visible.
      // `openByDefault` is for sections that aren't filters at all — the
      // playlist's own Order and size. They have no "active count" to open
      // them, and collapsing the two controls this screen exists to set would
      // hide them behind a tap for no gain.
      const section = (id, label, activeCount, openByDefault) => {
        // Default open when something in here is ON, and REMEMBER that, because
        // a chip tap repaints the whole body: clearing the last filter in a
        // category would otherwise drop its active count to zero and collapse
        // the section under the user's finger, taking the other chips with it.
        // Once open, a section stays open until the header is tapped or the
        // sheet is closed.
        if (openSections[id] === undefined && (activeCount > 0 || openByDefault)) {
          openSections[id] = true;
        }
        const expanded = openSections[id] === undefined ? false : openSections[id];
        const s = document.createElement("div");
        s.className = "lib-sheet-section" + (expanded ? " is-open" : "");

        const head = document.createElement("button");
        head.type = "button";
        head.className = "lib-sheet-section-head";
        head.setAttribute("aria-expanded", expanded ? "true" : "false");
        const t = document.createElement("span");
        t.className = "lib-sheet-section-label";
        t.textContent = label;
        head.appendChild(t);
        if (activeCount) {
          const n = document.createElement("span");
          n.className = "lib-sheet-section-count";
          n.textContent = String(activeCount);
          head.appendChild(n);
        }
        const car = document.createElement("span");
        car.className = "lib-sheet-section-caret";
        car.setAttribute("aria-hidden", "true");
        car.textContent = expanded ? "⌃" : "⌄";
        head.appendChild(car);
        head.addEventListener("click", () => {
          openSections[id] = !expanded;
          renderFocusBody();
        });
        s.appendChild(head);
        body.appendChild(s);
        if (!expanded) return null;   // collapsed: no body to fill
        const wrap = document.createElement("div");
        wrap.className = "lib-chips";
        s.appendChild(wrap);
        return { section: s, chips: wrap };
      };
      // state: "on" (included) | "not" (excluded) | "off".
      const chip = (host, label, state, onTap) => {
        const c = document.createElement("button");
        c.type = "button";
        c.className = "lib-chip" + (state === "on" ? " is-on" : state === "not" ? " is-not" : "");
        c.textContent = label;
        if (state === "not") c.setAttribute("aria-label", "Excluding " + label);
        c.addEventListener("click", () => { onTap(); renderFocusBody(); });
        host.appendChild(c);
      };
      const note = (host, text) => {
        const n = document.createElement("div");
        n.className = "lib-facet-note";
        n.textContent = text;
        host.appendChild(n);
      };
      // Why a facet's chips don't add up to the library. Every one of these
      // comes from somewhere other than Roon — the browse API publishes none of
      // it — so the number is stated rather than left to be noticed.
      const COVERAGE_NOTE = {
        decade: "Release years come from your file tags (ORIGINALDATE, then DATE) " +
                "and from MusicBrainz. Undated albums aren't in any decade.",
        genre:  "Genres are read from your files' GENRE tags. " +
                "An album with no genre tag won't appear here.",
        label:  "Labels are collected during the label scan, which runs in the background " +
                "and fills in over time.",
        format: "Read from your own files.",
        added:  "Date added is when the files arrived in your music folder, as Mandarin could work " +
                "out for itself — file timestamps, and albums appearing between scans."
      };
      // Format, Sample rate, Bit depth and Channels all come from the same file
      // scan and all carry the same caveat; saying it four times is noise.
      const COVERAGE_OF = { rate: "format", bits: "format", chan: "format" };

      const renderFocusBody = () => {
        body.innerHTML = "";

        // The playlist's OWN properties lead, ahead of every filter. Order and
        // size are decisions about the playlist rather than about which albums
        // match, and burying them under ten collapsed facets meant scrolling
        // past the whole sheet to reach the two controls this screen exists to
        // set. Open by default for the same reason.
        if (editTarget) {
          const ord = section("order", "Order", 0, true);
          if (ord) {
            for (const o of SMART_ORDERS) {
              chip(ord.chips, o.label, editOrder === o.id ? "on" : "off",
                   () => { editOrder = o.id; });
            }
            note(ord.section,
              (editTarget.mode === "tracks"
                ? "Album order plays each record straight through, in the sort you " +
                  "chose. Random shuffles the albums AND the tracks inside them."
                : "Album order queues the albums in the sort you chose. Random " +
                  "shuffles which albums, and what order they play in.") +
              " The shuffle is fixed per playlist, so it stays put while you scroll " +
              "rather than reshuffling under you.");
          }

          const lim = section("limit", "Playlist size", 0, true);
          if (lim) {
            for (const n of SMART_LIMITS) {
              chip(lim.chips, String(n), editLimit === n ? "on" : "off", () => { editLimit = n; });
            }
            note(lim.section,
              "How many albums this playlist actually plays. A query can match your " +
              "whole library, but a Sonos queue holds 1,000 tracks — 400 albums " +
              "is thousands of tracks and takes minutes.");
          }
        }

        // Listening first — it is the one facet that is always available,
        // because it runs on this extension's own play history rather than on
        // anything harvested.
        const played = libView.played !== "any" ? 1 : 0;
        const ls = section("played", "Listening", played);
        if (ls) {
          for (const p of LIB_PLAYED_OPTIONS) {
            chip(ls.chips, p.label, libView.played === p.id ? "on" : "off",
                 () => { libView.played = p.id; });
          }
          if (!f.hasPlays) {
            note(ls.section, "Mandarin hasn't seen anything play yet, so these use an " +
                             "empty history — everything counts as never played.");
          }
        }

        for (const facet of (f.facets || [])) {
          const sel = libView[facet.id];
          if (!Array.isArray(sel)) continue;   // a facet this client doesn't know
          const s = section(facet.id, facet.label, sel.length);
          if (!s) continue;
          for (const v of facet.values) {
            chip(s.chips, v.label + " (" + v.count + ")",
                 facetState(sel, v.value), () => facetCycle(sel, v.value));
          }
          // Anything SELECTED that the server didn't send back gets a chip of
          // its own. Genre and Label are truncated to the commonest values, so a
          // saved playlist — or a filter set before the library changed — can
          // easily name one that isn't in the list. Without this the filter is
          // active, invisible, and clearable only by Clear all, which would
          // take every other filter with it.
          const listed = facet.values.map(v => v.value);
          for (const raw of sel) {
            const value = raw.charAt(0) === "!" ? raw.slice(1) : raw;
            if (listed.includes(value)) continue;
            chip(s.chips, value, facetState(sel, value), () => facetCycle(sel, value));
          }
          if (facet.total_values > facet.values.length) {
            note(s.section, "Showing the " + facet.values.length + " most common of " +
                            facet.total_values.toLocaleString() + ".");
          }
          const covId = COVERAGE_OF[facet.id] || facet.id;
          const have = f.coverage && f.coverage[covId];
          if (COVERAGE_NOTE[covId] && Number.isFinite(have) && f.total && have < f.total) {
            note(s.section, have.toLocaleString() + " of " + f.total.toLocaleString() +
                            " albums. " + COVERAGE_NOTE[covId]);
          }
          if (facet.id === "source" && f.sources_derived) {
            // Say WHERE the number came from. Matching file tags against Roon's
            // own metadata is lossy — Roon rewrites titles for albums it
            // identifies — so when nothing else can claim an album, counting by
            // elimination is both exact and honest, and the user should know
            // that's the reasoning rather than assume every file was matched.
            note(s.section, "Every album in your library came from your own files.");
          }
        }

        const foot = document.createElement("div");
        foot.className = "lib-sheet-note";
        foot.textContent =
          "Tap a filter once to include it, again to exclude it, once more to clear it. " +
          "Everything here is read from your files' own tags.";
        body.appendChild(foot);
      };
      renderFocusBody();
    }, (foot, close) => {
      const clear = document.createElement("button");
      clear.type = "button"; clear.className = "action-btn";
      clear.textContent = "Clear all";
      clear.addEventListener("click", () => {
        committed = true;
        Object.assign(libView, libEmptyFacets());
        libView.played = "any";
        close(); applyLibView();
      });
      const save = document.createElement("button");
      save.type = "button"; save.className = "action-btn";
      save.textContent = "Save as…";
      save.addEventListener("click", () => {
        committed = true;
        close();
        // Carry the chosen size into the save — the sheet is the only place it
        // can be set, so it has to travel with the thing being saved. `mode`
        // rides along on editTarget from the create sheet (or from the record
        // being edited); Save-as from the Library bar has no editTarget and
        // takes the server default.
        saveSmartPlaylistPrompt(editTarget
          ? Object.assign({}, editTarget, { limit: editLimit, order: editOrder })
          : null);
      });
      const show = document.createElement("button");
      show.type = "button"; show.className = "action-btn primary";
      show.textContent = "Show albums";
      show.addEventListener("click", () => { committed = true; close(); applyLibView(); });
      foot.appendChild(clear); foot.appendChild(save); foot.appendChild(show);
    }, () => {
      // Abandoned (X or backdrop) while editing a saved playlist — put the
      // user's own Library view back. Never persisted in the first place, so
      // there is nothing on disk to undo.
      if (editTarget && !committed && viewBefore) applyViewToLibView(viewBefore);
    });
  }

  // ----- Smart playlists ---------------------------------------------------
  //
  // A smart playlist is just a saved library view (sort + focus), re-evaluated
  // every time it's opened. It runs entirely on the extension's own album
  // snapshot — the same engine as the Library screen — so it makes NO Roon calls
  // and adds nothing to the Core's memory. Opening one applies its view and
  // shows the library wall; there is no separate screen to maintain.
  // Derived from LIB_FACET_IDS rather than listed again: a facet added to that
  // array is savable immediately, instead of working on the Library screen and
  // silently vanishing the moment somebody saves the view as a playlist.
  const SMART_VIEW_KEYS = ["sort", "dir", "seed", "played"].concat(LIB_FACET_IDS);

  function currentLibViewSnapshot() {
    const out = {};
    for (const k of SMART_VIEW_KEYS) {
      out[k] = Array.isArray(libView[k]) ? libView[k].slice() : libView[k];
    }
    return out;
  }

  // A one-line human description, so the picker says what a saved view DOES
  // rather than only what it was named.
  function describeLibView(v) {
    const bits = [];
    const sortOpt = LIB_SORT_OPTIONS.find(o => o.id === v.sort);
    if (sortOpt) bits.push(sortOpt.label + (v.dir === "desc" ? " ↓" : " ↑"));
    // Decades read as "1980s"; everything else is already a display name, and
    // an excluded value says so rather than reading as if it were included.
    const shown = (id, val) => (val.charAt(0) === "!" ? "not " : "") +
      (id === "decade" ? val.replace("!", "") + "s" : val.replace(/^!/, ""));
    for (const id of LIB_FACET_IDS) {
      const sel = v[id];
      if (Array.isArray(sel) && sel.length) bits.push(sel.map(x => shown(id, x)).join(", "));
    }
    if (v.played && v.played !== "any") {
      const opt = LIB_PLAYED_OPTIONS.find(p => p.id === v.played);
      bits.push(opt ? opt.label.toLowerCase() : "not played in " + v.played + " months");
    }
    return bits.join(" · ");
  }

  // Returns null on failure, [] for a genuinely empty list. The caller must tell
  // them apart: rendering "No Dynamic Playlists yet" after a network blip reads as
  // "your saved playlists are gone".
  async function fetchSmartPlaylists() {
    try {
      const r = await fetch("/api/smart-playlists", { cache: "no-store" });
      if (!r.ok) return null;
      const j = await r.json();
      return Array.isArray(j.playlists) ? j.playlists : null;
    } catch (e) {
      return null;
    }
  }

  function saveSmartPlaylistPrompt(existing) {
    // NOT describeLibView(): using the description as the default name printed
    // the same string as both the row's title and its subtitle.
    const suggested = (existing && existing.name) || "My Dynamic Playlist";
    (async () => {
      const name = await askName("Name this Dynamic Playlist", suggested);
      if (name === null) return;                 // cancelled
      const trimmed = String(name).trim();
      if (!trimmed) { showToast("Give it a name", "error"); return; }
      try {
        const r = await fetch("/api/smart-playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: existing && existing.id, name: trimmed,
                                 view: currentLibViewSnapshot(),
                                 // Editing keeps whatever the playlist already
                                 // had; a new one takes the server's default.
                                 limit: existing && existing.limit,
                                 // Set by the create sheet before the focus
                                 // screen opens, and preserved through an edit.
                                 mode:  existing && existing.mode,
                                 // Set in the focus sheet's Order section.
                                 order: existing && existing.order })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { showToast(j.error || "Couldn't save that", "error"); return; }
        if (window.__playlistsChanged) window.__playlistsChanged();
        const lim = j.playlist && j.playlist.limit;
        const matched = j.playlist && j.playlist.album_matched;
        showToast(Number.isFinite(matched) && Number.isFinite(lim) && matched > lim
          ? `Saved "${trimmed}" — it plays ${lim} of the ${matched} albums that match. ` +
            "Change that with Edit."
          : `Saved "${trimmed}"`, null, TOAST_REPORT_MS);
        // Editing an existing one lands back on it so the change is visible
        // immediately; a brand new one goes to the list.
        if (j.playlist && existing) openSmartPlaylist(j.playlist);
        else showSmartPlaylists();
      } catch (e) {
        showToast("Couldn't save that", "error");
      }
    })();
  }

  // Smart playlists get the same shape as Roon playlists: a wall of tiles, and a
  // detail screen listing TRACKS with each track's album artwork. They used to
  // open the library wall with the view applied, which was the query working
  // correctly but reading as "it just took me to the library".
  // "New Dynamic Playlist", as the first tile of the wall. Built on .album so it
  // sizes with the grid at every width — the same approach as Home's unheard
  // tile, and for the same reason: no breakpoints of its own to get wrong.
  function buildNewSmartTile() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "album home-unheard-tile";
    btn.id = "new-smart-tile";
    btn.setAttribute("aria-label", "Create a Dynamic Playlist");

    const art = document.createElement("div");
    art.className = "album-art-wrap unheard-art";
    const glyph = document.createElement("span");
    glyph.className = "unheard-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = "＋";
    art.appendChild(glyph);
    btn.appendChild(art);

    const meta = document.createElement("div");
    meta.className = "album-meta";
    const t = document.createElement("div");
    t.className = "album-title";
    t.textContent = "New Dynamic Playlist";
    const sub = document.createElement("div");
    sub.className = "album-artist";
    sub.textContent = "Albums or tracks, then a focus";
    meta.appendChild(t); meta.appendChild(sub);
    btn.appendChild(meta);

    btn.addEventListener("click", createSmartPlaylist);
    return btn;
  }


  // Creating is editing a playlist that doesn't exist yet: same sheet, same
  // sections, same Playlist size control. Passing a target with no id is what
  // makes the save create rather than overwrite, so there is one editor rather
  // than two that have to be kept in step.
  function createSmartPlaylist() {
    openLibSheet("New Dynamic Playlist", (body, close) => {
      const intro = document.createElement("div");
      intro.className = "lib-facet-note";
      intro.textContent = "What should this playlist be made of?";
      body.appendChild(intro);

      for (const m of SMART_MODES) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "lib-sort-row";
        row.dataset.mode = m.id;

        const text = document.createElement("span");
        text.className = "lib-sort-text";
        const main = document.createElement("span");
        main.className = "lib-sort-label";
        main.textContent = m.label;
        const sub = document.createElement("span");
        sub.className = "lib-sort-note";
        sub.textContent = m.note;
        text.appendChild(main); text.appendChild(sub);
        row.appendChild(text);

        row.addEventListener("click", () => {
          close();
          // Straight into the focus screen, whose options are what fuel the
          // playlist. A target with no id makes the save create rather than
          // overwrite.
          openLibFocusSheet({ id: null, name: "", view: currentLibViewSnapshot(),
                              limit: SMART_LIMIT_DEFAULT, mode: m.id,
                              order: SMART_ORDER_DEFAULT });
        });
        body.appendChild(row);
      }

      const note = document.createElement("div");
      note.className = "lib-sheet-note";
      note.textContent =
        "Either way the playlist follows the same focus, and re-runs it every time " +
        "you open it — it isn't a fixed list. The focus works at album level, " +
        "so Tracks means the tracks OF the albums that match.";
      body.appendChild(note);
    });
  }

  async function showSmartPlaylists() {
    enterFullWall("Dynamic Playlists");
    smartWallActive = true;
    const mySeq = ++smartSeq;
    const list = await fetchSmartPlaylists();
    if (!smartWallActive || mySeq !== smartSeq) return;
    grid.innerHTML = "";
    if (list === null) {
      setBanner("Couldn't read your Dynamic Playlists — the extension didn't answer. " +
                "They're still saved; try again.", true);
      return;
    }
    setBanner(list.length ? null
      : "No Dynamic Playlists yet — start one with New, or set a sort and focus on the " +
        "Library screen and use Focus → Save as…", false);
    const frag = document.createDocumentFragment();
    // Leads the wall so an empty one still has something to do. Creating opens
    // the SAME editor Edit does, rather than sending the user off to the
    // Library screen to discover Focus → Save as… for themselves.
    frag.appendChild(buildNewSmartTile());
    for (const p of list) {
      const n = p.album_total;
      const matched = p.album_matched;
      const tile = buildAlbumTile({
        title: p.name,
        subtitle: (n === undefined || n === null)
          ? describeLibView(p.view)
          // Says what it PLAYS, and — when the query found more — what it left
          // out. Showing only the match count while playing a capped subset is
          // what made the number misleading.
          : (Number.isFinite(matched) && matched > n
              ? `${n} of ${matched} Albums`
              : `${n} Album${n === 1 ? "" : "s"}`),
        image_key: null,
        // A smart playlist has no cover either — the mosaic comes from the first
        // few albums it resolves to, which the server reads straight out of the
        // snapshot at no cost.
        art_keys: p.art_keys || []
      }, () => openSmartPlaylist(p), { selectable: false });
      frag.appendChild(tile);
    }
    grid.appendChild(frag);
  }
  window.__showSmartPlaylists = showSmartPlaylists;
  window.__showSmartPicks = showSmartPicks;

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

  async function deleteSmartPlaylist(sp) {
    const ok = await confirmDialog(`Delete the Dynamic Playlist "${sp.name}"?`);
    if (!ok) return;
    try {
      const r = await fetch("/api/smart-playlists/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sp.id })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(j.error || "Couldn't delete that", "error"); return; }
      showToast(`Deleted "${sp.name}"`);
      if (window.__playlistsChanged) window.__playlistsChanged();
      smartDetailActive = false;
      showSmartPlaylists();
    } catch (e) {
      showToast("Couldn't delete that", "error");
    }
  }

  // A zone row's label. Grouped zones get a second line naming their outputs,
  // as Roon's own remote does — without it a zone called "Kitchen + Study" and
  // a real Kitchen+Study group look identical.
  function fillZoneRow(item, z) {
    const outs = z.outputs || [];
    const name = document.createElement("span");
    name.className = "group-name";
    name.textContent = z.display_name;
    item.appendChild(name);
    if (outs.length > 1) {
      const sub = document.createElement("span");
      sub.className = "np-device-sub";
      sub.textContent = outs.map(o => o.display_name).filter(Boolean).join(" + ");
      item.appendChild(sub);
    }
  }
  window.__fillZoneRow = fillZoneRow;

  // ----- Zone grouping (Roon group_outputs / ungroup_outputs) ---------------
  //
  // Roon groups OUTPUTS, not zones: a zone IS whichever outputs currently play
  // in sync. So this is a checklist of outputs anchored on the zone the app is
  // driving. Roon preserves the first output's queue, so the anchor's own
  // output is always sent first and always stays ticked — grouping can never
  // throw away what you're listening to.
  async function openGroupSheet() {
    const anchorZoneId = selectedZoneId;
    let list = [];
    try {
      const r = await fetch("/api/outputs", { cache: "no-store" });
      if (r.ok) { const j = await r.json(); if (Array.isArray(j.outputs)) list = j.outputs; }
    } catch (e) { /* leaves `list` empty — the empty state below explains it */ }

    const anchorOutputs = anchorZoneId ? list.filter(o => o.zone_id === anchorZoneId) : [];
    const anchorIds     = anchorOutputs.map(o => o.output_id);
    const primary       = anchorOutputs[0] || null;

    // Roon says which outputs an output may join. A Core that doesn't send the
    // list gives us null, which we read as "unknown" and offer everything —
    // offering nothing would make the feature look broken rather than limited.
    const allowed = primary && Array.isArray(primary.can_group_with_output_ids)
      ? new Set(primary.can_group_with_output_ids)
      : null;
    const offerable = list.filter(o =>
      anchorIds.includes(o.output_id) || !allowed || allowed.has(o.output_id));

    const picked = new Set(anchorIds);

    openLibSheet("Group zones", (body, close) => {
      const paint = () => {
        body.innerHTML = "";
        if (!primary) {
          const note = document.createElement("div");
          note.className = "lib-sheet-note";
          note.textContent = list.length
            ? "Choose a zone first — grouping needs a zone to build the group around."
            : "No Sonos rooms found. The server must share a network with your speakers (host networking), or set SONOS_HOSTS to a speaker's IP.";
          body.appendChild(note);
          return;
        }
        for (const o of offerable) {
          const isPrimary = o.output_id === primary.output_id;
          const on = picked.has(o.output_id);
          const row = document.createElement("button");
          row.type = "button";
          row.className = "group-row" + (on ? " is-on" : "") + (isPrimary ? " is-anchor" : "");
          row.dataset.output = o.output_id;
          const box = document.createElement("span");
          box.className = "group-box";
          box.textContent = "✓";
          const text = document.createElement("span");
          text.className = "group-text";
          const nm = document.createElement("span");
          nm.className = "group-name";
          nm.textContent = o.display_name || o.output_id;
          text.appendChild(nm);
          // Say why a row can't be unticked, and warn when taking an output
          // would break up a group it is already in. Outputs already in THIS
          // zone get nothing — they're ticked, which says it, and naming the
          // group we're editing back at the user is just noise.
          const noteText = isPrimary
            ? "Keeps playing — this group's queue"
            : (!anchorIds.includes(o.output_id) && o.zone_name && o.zone_name !== o.display_name
                ? "In " + o.zone_name : "");
          if (noteText) {
            const nt = document.createElement("span");
            nt.className = "group-note";
            nt.textContent = noteText;
            text.appendChild(nt);
          }
          row.appendChild(box); row.appendChild(text);
          if (isPrimary) {
            row.disabled = true;
            row.setAttribute("aria-pressed", "true");
          } else {
            row.setAttribute("aria-pressed", String(on));
            row.addEventListener("click", () => {
              if (picked.has(o.output_id)) picked.delete(o.output_id);
              else picked.add(o.output_id);
              paint();
              const again = body.querySelector('[data-output="' + o.output_id + '"]');
              if (again) again.focus();
            });
          }
          body.appendChild(row);
        }
        if (offerable.length < list.length) {
          const note = document.createElement("div");
          note.className = "lib-sheet-note";
          note.textContent = "Outputs your Core can't sync with " + primary.display_name +
                             " aren't listed — Sonos decides which rooms can play together.";
          body.appendChild(note);
        }
      };
      paint();
    }, (foot, close) => {
      const cancel = document.createElement("button");
      cancel.type = "button"; cancel.className = "action-btn";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", close);
      const apply = document.createElement("button");
      apply.type = "button"; apply.className = "action-btn primary";
      apply.textContent = "Apply";
      apply.addEventListener("click", async () => {
        if (!primary) { close(); return; }
        const toRemove = anchorIds.filter(id => !picked.has(id));
        const toAdd    = [...picked].filter(id => !anchorIds.includes(id));
        if (!toRemove.length && !toAdd.length) { close(); return; }
        apply.disabled = true; cancel.disabled = true;
        const ok = await applyGrouping(anchorIds, toRemove, toAdd, primary);
        apply.disabled = false; cancel.disabled = false;
        if (ok) close();
      });
      foot.appendChild(cancel); foot.appendChild(apply);
    });
  }

  // Split first, then group: ungrouping an output that is also being regrouped
  // elsewhere would otherwise race, and Roon takes the whole desired set for a
  // group in one call anyway.
  async function applyGrouping(anchorIds, toRemove, toAdd, primary) {
    const post = async (url, output_ids) => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ output_ids })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || ("HTTP " + r.status));
      }
    };
    try {
      if (toRemove.length) await post("/api/ungroup-outputs", toRemove);
      if (toAdd.length) {
        // primary first — Roon preserves the first output's zone's queue.
        const kept = anchorIds.filter(id => id !== primary.output_id && !toRemove.includes(id));
        await post("/api/group-outputs", [primary.output_id, ...kept, ...toAdd]);
      }
      showToast("Zones updated");
    } catch (e) {
      showToast(e.message || "Could not change grouping", "error");
      return false;
    }
    // Roon has accepted the change, so the sheet's work is done — settling the
    // app onto the new zone happens in the background rather than holding the
    // sheet open for it. Detached deliberately: an unresolved settle must not
    // leave the user staring at a sheet Roon has already acted on.
    const want = new Set([
      primary.output_id,
      ...anchorIds.filter(id => !toRemove.includes(id)),
      ...toAdd,
    ]);
    settleZoneAfterGrouping(primary.output_id, want);
    return true;
  }

  // Grouping retires zone ids — Roon mints a zone per set of outputs — so the
  // app has to be re-pointed at whichever zone now holds the output we anchored
  // on. Left alone, loadZones() would find the old id gone and fall back to
  // whichever zone sorts first, quietly moving the user elsewhere.
  //
  // The Core's zone update is asynchronous, so a single fixed wait is a guess.
  // Poll instead: take the best answer available on each attempt and stop as
  // soon as the topology matches what was asked for. Bounded at ~2s, after which
  // loadZones() and the 1.5s transport poll resync regardless.
  async function settleZoneAfterGrouping(anchorOutputId, want) {
    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise(r => setTimeout(r, 250));
      let zs = null;
      try {
        const r = await fetch("/api/zones", { cache: "no-store" });
        if (r.ok) { const j = await r.json(); if (Array.isArray(j.zones)) zs = j.zones; }
      } catch (e) { /* transient — retry; the loop is bounded and resyncs after */ }
      if (!zs) continue;
      const z = zs.find(zz => (zz.outputs || []).some(o => o.output_id === anchorOutputId));
      if (!z) continue;
      try { localStorage.setItem("rra-zone", z.zone_id); }
      catch (e) { /* private mode — loadZones() still selects a zone, just not this one */ }
      const have = new Set((z.outputs || []).map(o => o.output_id));
      if (have.size === want.size && [...want].every(id => have.has(id))) break;
    }
    await loadZones();
    if (typeof window.__refreshTransport === "function") window.__refreshTransport();
  }
  window.__openGroupSheet = openGroupSheet;

  // ----- Device power (Roon standby / convenience switch) -------------------
  //
  // Roon can power the amp or DAC behind an output, but only through a SOURCE
  // CONTROL the device itself exposes — most outputs have none, and for those
  // there is nothing to show. So this sheet is a list of source controls, not of
  // zones, and it is honest about an empty result rather than pretending the
  // feature is missing.
  //
  // Unlike the grouping sheet these actions fire immediately: a power button
  // that waits for an Apply is a power button people press twice.
  const SOURCE_STATUS_LABEL = {
    selected:      "On — this input selected",
    deselected:    "On — another input selected",
    standby:       "In standby",
    indeterminate: "",
  };

  async function openDevicePowerSheet() {
    let list = [];
    try {
      const r = await fetch("/api/outputs", { cache: "no-store" });
      if (r.ok) { const j = await r.json(); if (Array.isArray(j.outputs)) list = j.outputs; }
    } catch (e) { /* leaves `list` empty — the empty state below explains it */ }

    openLibSheet("Device power", (body) => {
      // Re-read after every action so the status lines reflect the device, not
      // what we asked for — the same rule the mode buttons follow.
      const refresh = async () => {
        try {
          const r = await fetch("/api/outputs", { cache: "no-store" });
          if (r.ok) { const j = await r.json(); if (Array.isArray(j.outputs)) list = j.outputs; }
        } catch (e) { /* keep the previous list; paint() still renders something */ }
        paint();
      };

      const act = async (url, payload, btn) => {
        btn.disabled = true;
        try {
          const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            showToast(j.error || "Sonos refused that", "error");
          }
        } catch (e) {
          showToast("Could not reach the extension", "error");
        } finally {
          btn.disabled = false;
        }
        // Roon reports the new status asynchronously; give it a moment.
        setTimeout(refresh, 400);
      };

      const paint = () => {
        body.innerHTML = "";
        const withControls = list.filter(o => (o.source_controls || []).length);
        if (!withControls.length) {
          const note = document.createElement("div");
          note.className = "lib-sheet-note";
          note.textContent = list.length
            ? "None of your devices can be switched on or off from here."
            : "No Sonos rooms found. The server must share a network with your speakers (host networking), or set SONOS_HOSTS to a speaker's IP.";
          body.appendChild(note);
          return;
        }
        for (const o of withControls) {
          const controls = o.source_controls || [];
          const sec = document.createElement("div");
          sec.className = "lib-sheet-section";
          const label = document.createElement("div");
          label.className = "lib-sheet-section-label";
          label.textContent = o.display_name;
          sec.appendChild(label);

          for (const sc of controls) {
            const row = document.createElement("div");
            row.className = "dev-row";
            row.dataset.control = sc.control_key;

            const text = document.createElement("div");
            text.className = "dev-text";
            const nm = document.createElement("span");
            nm.className = "dev-name";
            nm.textContent = sc.display_name;
            text.appendChild(nm);
            const st = SOURCE_STATUS_LABEL[sc.status] || "";
            if (st) {
              const stEl = document.createElement("span");
              stEl.className = "dev-status";
              stEl.textContent = st;
              text.appendChild(stEl);
            }
            row.appendChild(text);

            const actions = document.createElement("div");
            actions.className = "dev-actions";
            if (sc.supports_standby) {
              const pwr = document.createElement("button");
              pwr.type = "button";
              pwr.className = "dev-btn" + (sc.status === "standby" ? "" : " is-on");
              pwr.dataset.action = "standby";
              pwr.textContent = "Power";
              pwr.setAttribute("aria-label",
                sc.status === "standby" ? "Wake " + sc.display_name
                                        : "Put " + sc.display_name + " into standby");
              pwr.addEventListener("click", () => act("/api/output/standby",
                { output_id: o.output_id, control_key: sc.control_key, mode: "toggle" }, pwr));
              actions.appendChild(pwr);
            }
            const sw = document.createElement("button");
            sw.type = "button";
            sw.className = "dev-btn";
            sw.dataset.action = "switch";
            sw.textContent = "Select input";
            sw.setAttribute("aria-label", "Switch " + sc.display_name + " to this input");
            sw.addEventListener("click", () => act("/api/output/convenience-switch",
              { output_id: o.output_id, control_key: sc.control_key }, sw));
            actions.appendChild(sw);
            row.appendChild(actions);
            sec.appendChild(row);
          }

          // Roon's standby() with no control_key covers every standby-capable
          // control at once. That is only a distinct action on a device with
          // more than one, so it appears only there.
          if (controls.filter(sc => sc.supports_standby).length > 1) {
            const all = document.createElement("button");
            all.type = "button";
            all.className = "dev-btn dev-all-off";
            all.dataset.action = "all-off";
            all.textContent = "Put whole device into standby";
            all.addEventListener("click", () => act("/api/output/standby",
              { output_id: o.output_id, mode: "standby" }, all));
            sec.appendChild(all);
          }
          body.appendChild(sec);
        }
      };
      paint();
    }, (foot, close) => {
      const done = document.createElement("button");
      done.type = "button"; done.className = "action-btn primary";
      done.textContent = "Done";
      done.addEventListener("click", close);
      foot.appendChild(done);
    });
  }
  window.__openDevicePowerSheet = openDevicePowerSheet;

  async function showLibraryWall() {
    const m = enterFullWall("Library", true);
    libraryWallActive = true;
    renderLibraryControls();
    if (window.__watchServices) window.__watchServices();
    libWall.seq++;
    const mySeq = libWall.seq;
    libWall.offset = 0; libWall.loading = false; libWall.done = false;
    await fetchLibraryPage(mySeq, true);
    // Wide screens (9 columns) can swallow the first page without producing a
    // scrollbar — no scrollbar means no scroll events, so keep filling until
    // the viewport overflows (or the library runs out). fetchLibraryPage's
    // loading guard makes a concurrent scroll-handler fetch harmless (this
    // iteration then no-ops and the offset check below ends the loop).
    while (libraryWallActive && mySeq === libWall.seq && !libWall.done && !libWall.loading &&
           m && m.scrollHeight <= m.clientHeight + 200) {
      const before = libWall.offset;
      await fetchLibraryPage(mySeq, false);
      if (libWall.offset === before) break;   // page failed or empty — stop; scroll retries
    }
  }

  // Infinite scroll: <main> is the shared scroll container for every grid view;
  // only act while the library wall owns it (labelsActive double-checks — the
  // labels browser paints the same grid without touching the wall flags).
  {
    const mainEl = document.querySelector("main");
    if (mainEl) {
      mainEl.addEventListener("scroll", () => {
        if (!libraryWallActive || labelsActive || libWall.loading || libWall.done) return;
        if (mainEl.scrollTop + mainEl.clientHeight >= mainEl.scrollHeight - 600) {
          fetchLibraryPage(libWall.seq, false);
        }
      }, { passive: true });
    }
  }

  // Section-header activation (click + Enter/Space) — one wiring for all four
  // Home headers so keyboard behaviour can't drift between them.
  function wireSectionHeader(id, handler) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", handler);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); }
    });
  }

  // Header taps: Not played → full unplayed grid; Random albums → full random
  // wall; Library → full A-Z wall; Label of the week → label view.
  {
    wireSectionHeader("home-unplayed-title", showUnplayedWall);
    wireSectionHeader("home-favourites-title", showFavouritesWall);
    wireSectionHeader("home-later-title", showLaterWall);
    wireSectionHeader("home-playlists-title", () => showPlaylists());
    wireSectionHeader("home-random-title", () => { if (window.__applyFilter) window.__applyFilter(null); });
    wireSectionHeader("home-library-title", showLibraryWall);
    wireSectionHeader("home-lotw-title", () => {
      const name = homeLotw && homeLotw.dataset.label;
      if (name && window.__showLabelAlbums) window.__showLabelAlbums(name);
    });
    wireSectionHeader("home-picks-title", showSmartPicks);
  }

  // Weighted-random pick from a list of { title, count }.
  function pickWeightedSub(items) {
    let total = 0;
    for (const it of items) total += Math.max(1, it.count || 1);
    let r = Math.random() * total;
    for (const it of items) { r -= Math.max(1, it.count || 1); if (r <= 0) return it; }
    return items[items.length - 1];
  }

  // Render the genre buttons from card descriptors ({label, genre} or
  // {label, group, parent}). Shared by the live loader and the cache repaint;
  // the descriptors are plain data, so they persist and rebuild identically.
  function renderHomeGenres(cards) {
    cards = cards || [];
    homeGenres.innerHTML = "";
    if (!cards.length) {
      homeGenres.innerHTML = '<div class="home-carousel-empty">No genres found.</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    for (const c of cards) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "home-genre-card";
      card.textContent = c.label;
      card.addEventListener("click", () => {
        if (!window.__applyFilter) return;
        if (c.group) {
          // Pick a random sub-genre from the group; the breadcrumb keeps the
          // group label (e.g. "Rock/Metal"). Refreshing the grid reshuffles
          // that sub-genre; re-tapping the button picks a new one.
          const sub = pickWeightedSub(c.group);
          window.__applyFilter({ type: "genre", value: sub.title, parent: c.parent, label: c.label });
        } else {
          window.__applyFilter({ type: "genre", value: c.genre });
        }
      });
      frag.appendChild(card);
    }
    homeGenres.appendChild(frag);
  }

  async function loadHomeGenres() {
    if (!homeGenres) return;
    if (!rowHasContent(homeGenres)) homeGenres.innerHTML = '<div class="home-carousel-empty">Loading…</div>';
    try {
      const [genresRes, groupsRes] = await Promise.all([
        fetch("/api/filters/genres").catch(() => null),
        fetch("/api/home/genre-groups").catch(() => null)
      ]);
      if ((genresRes && genresRes.status === 503) || (groupsRes && groupsRes.status === 503)) {
        if (!rowHasContent(homeGenres)) homeGenres.innerHTML = '<div class="home-carousel-empty">Reading your music library…</div>';
        return;   // keep any cached cards while the index builds
      }
      const genresJ = genresRes ? await genresRes.json().catch(() => ({})) : {};
      const groupsJ = groupsRes ? await groupsRes.json().catch(() => ({})) : {};
      // Pull extra genres up front — splitting Pop/Rock adds a card, and we trim
      // down to an even count afterwards so the 2-column grid has full rows.
      const top = ((genresJ && genresJ.genres) || []).slice(0, 16); // biggest first
      const groups = groupsJ || {};
      const parent = groups.parent;

      // Build card descriptors. The "Pop/Rock" parent is split into two buttons:
      // "Rock/Metal" (curated rock/metal sub-genres) and "Pop" (pop sub-genres).
      // Rock/Metal and Pop are pushed FIRST so they always survive the trim.
      const cards = [];
      const haveRockMetal = groups.rockmetal && groups.rockmetal.length;
      const havePop = groups.pop && groups.pop.length;
      if (parent && (haveRockMetal || havePop)) {
        if (haveRockMetal) cards.push({ label: "Rock/Metal", group: groups.rockmetal, parent });
        if (havePop) cards.push({ label: "Pop", group: groups.pop, parent });
      }
      for (const g of top) {
        // Drop the raw Pop/Rock parent — it's represented by the split buttons.
        if (parent && /pop\s*\/\s*rock/i.test(g.title)) continue;
        cards.push({ label: g.title, genre: g.title });
      }

      // Target an even 12 buttons so the grid rows are balanced on every screen.
      // If we have more, keep the first 12 (biggest, Rock/Metal + Pop first); if
      // fewer, drop the last one when the count is odd.
      const MAX_CARDS = 12;
      if (cards.length > MAX_CARDS) cards.length = MAX_CARDS;
      if (cards.length % 2 === 1) cards.length -= 1;

      if (cards.length) {
        renderHomeGenres(cards);
        homeSectionsLoaded = true;   // populated — stop retrying on future visits
        saveHomeCache({ genres: cards });
      } else if (!rowHasContent(homeGenres)) {
        // Empty 200 (index still building after a restart) — keep the hydrated
        // cards if we have them; only show "No genres found." when nothing is
        // cached, rather than blanking a good cached row.
        renderHomeGenres([]);
      }
    } catch (e) {
      if (!rowHasContent(homeGenres)) homeGenres.innerHTML = '<div class="home-carousel-empty">Couldn’t load genres.</div>';
    }
  }

  // Instant open: repaint the last persisted Home rows immediately, before we've
  // even reconnected to Roon. Returns true if it painted the main content, so
  // the boot path can reveal Home right away instead of a blank "Connecting…".
  // The live loaders (called by showHome once paired) then revalidate silently,
  // swapping fresh data in without a "Loading…" flash. Seeding homeRowsLoadedAt
  // lets the existing 5-minute TTL skip the unplayed/random refetch entirely on
  // a quick reopen — but only when BOTH rows are recent: it's seeded from the
  // OLDER of the two per-row timestamps, so a stale sibling (e.g. unplayed kept
  // an old cache while random refreshed) forces a silent revalidation instead
  // of riding the fresh row's freshness.
  function hydrateHomeFromCache() {
    // Offline the saved Home is the server's: its albums aren't on the phone.
    // Only what the app answers (the phone's music and downloads) is shown.
    if (window.__musicdOffline) return false;
    const c = readHomeCache();
    if (!c) return false;
    // Order and enablement first: painting into the default order and then
    // reordering is a visible flash on every cold open.
    applyHomeLayout();
    let painted = false;
    // The strip: Random Album always; Album of the day only on its own day,
    // so a saved one from yesterday isn't painted.
    if (homeToday) { renderHomeToday(c.today && c.today.day === todayKey() ? c.today.aotd : null); }
    if (c.unplayed && homeUnplayed) { renderHomeUnplayed(c.unplayed.albums); homeUnplayedLoaded = true; painted = rowHasContent(homeUnplayed) || painted; }
    if (c.random   && homeRandom)   { renderHomeRandom(c.random);                              painted = rowHasContent(homeRandom)   || painted; }
    // Only when it was cached in the order that is current NOW. The other rows
    // hydrate stale-then-revalidate, but "stale" here means the wrong ORDER —
    // painting it would flash the previous sort on every cold open, which is
    // the very thing the row is supposed to be reflecting. A cache written
    // before this field existed has no librarySort, so it does not match and
    // the row simply loads fresh: no cache-key bump needed for that.
    // Painted, and still read again (v0.8.43): before, the copy kept from
    // last time counted as loaded, and albums added since stayed off the row
    // until the sort was changed.
    if (c.library && homeLibrary && c.librarySort === libSortKey()) {
      renderHomeLibrary(c.library);
    }
    if (c.lotw     && homeLotw)     { renderHomeLotw(c.lotw.label, c.lotw.albums); }
    if (c.history  && homeHistory)  { renderHomeHistory(c.history); }
    if (c.genres   && homeGenres)   { renderHomeGenres(c.genres); }
    if (!painted) return false;
    if (typeof c.unplayedAt === "number" && typeof c.randomAt === "number") {
      homeRowsLoadedAt = Math.min(c.unplayedAt, c.randomAt);   // honour the TTL across reopens
    }
    // Reveal Home so the cached content is actually on screen while we reconnect.
    if (homeView)     homeView.classList.remove("hidden");
    if (homeSections) homeSections.classList.remove("hidden");
    grid.classList.add("hidden");
    setTopbarNav(false, false, true);   // Home chrome: search box, no Back/Refresh
    return true;
  }

  // ----- Toast / banner -----
  let toastTimer = null;
  // `ms` overrides the 2.4s default. Anything that lands at the END of a
  // multi-minute operation needs longer: the user has usually looked away, and
  // 2.4s of "queued 400 of 1179" is the same as never having said it.
  function showToast(msg, kind, ms) {
    toast.textContent = msg;
    toast.classList.remove("hidden", "error");
    if (kind === "error") toast.classList.add("error");
    requestAnimationFrame(() => toast.classList.add("show"));
    clearTimeout(toastTimer);
    // 2.4s is right for "Queued 12 albums" and nowhere near enough for the
    // library-changed messages, which explain the cause, what happens next and
    // the manual way out — roughly 330 characters, gone before they could be
    // read. Scaled by length so short toasts are unchanged.
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.classList.add("hidden"), 250);
    }, ms || (String(msg).length > 120 ? 11000 : 2400));
  }
  // One sentence describing what actually reached the queue: how many albums,
  // how many the cap left behind, and how many Roon refused. `pj` is
  // /api/play-multi's body, `asked` the albums we sent, `total` the size of the
  // whole playlist. Shared so Play now, Queue and Send to Roon cannot drift.
  // How many albums the playlist's query MATCHED, as opposed to how many it
  // delivers. Older responses carried only the delivered count; falling back to
  // it makes the comparison a no-op rather than a wrong number.
  function smartMatched(j) {
    return Number.isFinite(j.matched) ? j.matched : j.total;
  }
  function multiOutcome(verb, pj, asked, total) {
    const queued = Number.isFinite(pj.queued) ? pj.queued : asked;
    const failed = Number.isFinite(pj.failed) ? pj.failed : 0;
    const capped = Number.isFinite(total) && asked < total;
    let msg = `${verb} ${queued}`;
    if (capped) msg += ` of ${total}`;
    // Pluralise off whichever number the noun follows.
    msg += ` album${(capped ? total : queued) === 1 ? "" : "s"}`;
    if (failed > 0) msg += ` (Sonos refused ${failed})`;
    if (capped) msg += " — that's the limit per go";
    return msg;
  }
  function setBanner(msg, isError) {
    if (!msg) { banner.classList.add("hidden"); banner.textContent = ""; return; }
    banner.textContent = msg;
    banner.classList.toggle("error", !!isError);
    banner.classList.remove("hidden");
  }

  // ----- Scan progress bar -----
  function updateScanBar(progress) {
    const bar  = document.getElementById("scan-progress-bar");
    const fill = document.getElementById("scan-progress-fill");
    if (!bar || !fill) return;
    if (progress === null || progress === undefined) {
      bar.classList.add("hidden");
      fill.style.width = "0%";
    } else {
      bar.classList.remove("hidden");
      fill.style.width = Math.round((progress || 0) * 100) + "%";
    }
  }

  // ----- Skeletons -----
  function renderSkeletons(n) {
    grid.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const el = document.createElement("div");
      el.className = "album skeleton";
      el.innerHTML = `
        <div class="album-art-wrap"></div>
        <div class="album-meta">
          <div class="album-title">&nbsp;</div>
          <div class="album-artist">&nbsp;</div>
        </div>`;
      grid.appendChild(el);
    }
  }

  // ----- Long-press utility -----
  //
  // The callback fires at 500ms while the finger is STILL DOWN, so the browser
  // goes on to dispatch a click on release. Without suppression that click ran
  // the element's normal handler straight after the long-press handler — on an
  // album tile it selected the album and then immediately deselected it, so a
  // long press opened select mode with nothing in it. `longPressAte` is set by
  // the callback and consumed by the very next click, in the capture phase so
  // it lands before any listener the element itself carries.
  function addLongPress(el, callback) {
    let timer = null;
    let moved = false;
    const onStart = () => {
      moved = false;
      timer = setTimeout(() => {
        if (moved) return;
        if (navigator.vibrate) navigator.vibrate(25);
        longPressAte = true;
        callback();
      }, 500);
    };
    const onMove  = () => { moved = true; clearTimeout(timer); timer = null; };
    const onEnd   = () => { clearTimeout(timer); timer = null; };
    el.addEventListener("touchstart",  onStart,  { passive: true });
    el.addEventListener("touchmove",   onMove,   { passive: true });
    el.addEventListener("touchend",    onEnd);
    el.addEventListener("touchcancel", onEnd);
    el.addEventListener("mousedown",   onStart);
    el.addEventListener("mousemove",   onMove);
    el.addEventListener("mouseup",     onEnd);
    el.addEventListener("contextmenu", e => e.preventDefault());
    el.addEventListener("click", (e) => {
      if (!longPressAte) return;
      longPressAte = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }

  // ----- Render -----
  // Tile art size matched to the display: tiles render at ~150-220px CSS, so
  // 500px covers were ~2.8× oversized on DPR-2 iPads — each one an on-demand
  // rescale by the Roon Core. Rounded to coarse steps so the whole session
  // shares a handful of cache keys (server LRU + browser cache); the 300px
  // floor keeps DPR-1 desktops sharp on wide walls where tiles exceed 200px.
  // Sized from the tile actually drawn (v0.6.5: UI Settings can make a tile
  // two or three times its old width), in device pixels, and held inside the
  // 300–500 band the server keeps cached.
  // The artwork size to ask for: the larger of the two tiles it may fill (a
  // grid column, a Home carousel tile), in device pixels, to the next 100.
  // v0.6.10: no 190px floor (a phone's 3-across tile is ~130px, so it was
  // fetching and decoding 500px covers for it), and the density counted up to
  // 2x only — a 3x phone draws a 150px tile from 300px, not 450-500px, which
  // is under half the pixels to fetch, decode and hold while scrolling. A
  // quarter of a four-cover mosaic asks for half.
  function tileImgSize(quarter) {
    const p = window.__uiPrefs;
    const gridTile = window.innerWidth / (p ? p.cols() : 3);
    const carouselTile = 150 * parseFloat(p ? p.get("tile") : "1");
    const css = Math.max(Math.min(gridTile, 600), carouselTile) / (quarter ? 2 : 1);
    const px = css * Math.min(2, window.devicePixelRatio || 1);
    return Math.min(500, Math.max(quarter ? 100 : 200, Math.ceil(px / 100) * 100));
  }

  // Source badge for an album payload: "local" | "qobuz" | "tidal", or null
  // when the server couldn't determine it. `a.local` is still honoured so a
  // tile built from an older cached payload keeps its badge.
  // ----- Quality badge -----------------------------------------------------
  //
  // "24/96" on the artwork, always (the switch in Settings went in v0.5.19).
  // It is read from your own files, so a streamed album simply has none — the
  // server sends the field only when it knows, and no badge is drawn
  // otherwise. A question mark or a guess would be worse than silence.
  function qualityBadge(a) {
    if (!a.quality) return null;
    const el = document.createElement("span");
    el.className = "album-quality" + (a.hires ? " is-hires" : "");
    el.textContent = a.quality;
    // The badge is two characters of shorthand; the accessible name says what
    // they mean, and the tooltip does the same for a mouse.
    const words = /\//.test(a.quality)
      ? a.quality.split("/")[0] + "-bit, " + a.quality.split("/")[1] + " kHz"
      : a.quality;
    el.title = words;
    el.setAttribute("aria-label", words);
    return el;
  }

  const SOURCE_LABEL = { local: "Local albums", qobuz: "Qobuz", tidal: "Tidal" };
  function sourceBadge(a) {
    const kind = a.source || (a.local ? "local" : null);
    if (!kind || !SOURCE_LABEL[kind]) return null;
    const el = document.createElement("span");
    el.className = "album-source " + kind;
    el.title = SOURCE_LABEL[kind];
    el.setAttribute("aria-label", SOURCE_LABEL[kind]);
    return el;
  }

  // ARTWORK, WITH A RETRY. `/api/image` answers 503 whenever the extension is
  // still connecting to the Core and the art is not already in the disk store —
  //
  //     if (!core) return res.status(503).end();
  //
  // and a cold app open lands squarely in that window, because Home repaints
  // from its saved copy immediately while pairing takes a second or two. Every
  // <img> that lost the race fired onerror, and onerror did this:
  //
  //     img.onerror = () => { wrap.classList.add("no-image"); img.remove(); };
  //
  // — one failure, a music note for the life of the page, even though the art
  // became available moments later and nothing ever asked again. Which rows
  // were affected came down to which requests happened to be in flight, so the
  // same screen would show covers on some carousels and notes on others.
  //
  // Retries with a widening gap, then gives up. `r` is not read by the server
  // (it keys on the path and ?size); it is there so a retry is a genuinely new
  // request rather than anything a cache could answer from the failure.
  function loadArt(container, key, size, onGiveUp) {
    // Inside the function on purpose. This is declared 3000 lines below two of
    // its callers — hoisting makes the FUNCTION reachable from them, but a
    // module-level `const` would not be, and CLAUDE.md's declaration-before-use
    // rule exists because that distinction has bitten this file before.
    const RETRY_MS = [1200, 3500, 8000];
    const img = document.createElement("img");
    img.loading = "lazy"; img.alt = "";
    const url = `/api/image/${encodeURIComponent(key)}?size=${size}`;
    let tries = 0;
    img.onerror = () => {
      if (tries >= RETRY_MS.length) {
        if (onGiveUp) onGiveUp(img); else img.remove();
        return;
      }
      const wait = RETRY_MS[tries++];
      setTimeout(() => {
        // The tile may have been replaced by a re-render in the meantime;
        // retrying a detached <img> is a request nobody will ever see.
        if (img.isConnected) img.src = url + "&r=" + tries;
      }, wait);
    };
    // The cover's own colour, for the glow under it (Late-Night Hi-Fi):
    // averaged from a few pixels once it has loaded.
    img.addEventListener("load", () => {
      try {
        // Kept on the function, not a module-level let: loadArt runs before
        // its own position in the file is reached (hoisting; see RETRY_MS).
        const c = loadArt.glowCanvas || (loadArt.glowCanvas = document.createElement("canvas"));
        c.width = c.height = 6;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0, 6, 6);
        const d = g.getImageData(0, 0, 6, 6).data;
        let r = 0, gr = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
        const n = d.length / 4;
        container.style.setProperty("--glow", Math.round(r / n) + "," + Math.round(gr / n) + "," + Math.round(b / n));
      } catch (e) { /* a cover from elsewhere: the theme's own glow */ }
    }, { once: true });
    img.src = url;
    container.appendChild(img);
    return img;
  }

  // Build a single album tile. onClick defaults to opening the album modal,
  // but callers (e.g. the label browser) can override it to carry a filter.
  function buildAlbumTile(a, onClick, opts) {
    const btn = document.createElement("button");
    btn.className = "album";
    btn.type = "button";
    btn.setAttribute("aria-label",
      `${a.title || "Untitled"}${a.subtitle ? " by " + a.subtitle : ""}`);
    btn.dataset.albumKey = (a.title || "").toLowerCase().trim();

    const artWrap = document.createElement("div");
    artWrap.className = "album-art-wrap";
    // Source badge — only shown when the server is confident: local files, or
    // an album matched in your Qobuz/Tidal favourites. No badge means the
    // source couldn't be determined, not that it's missing.
    const srcBadge = sourceBadge(a);
    if (srcBadge) artWrap.appendChild(srcBadge);
    // Always built, shown or hidden by one class on <body>. Rendering it
    // conditionally would mean every tile already on screen kept its old state
    // until something rebuilt it, so the toggle would look like it had done
    // nothing until you navigated away and back.
    const qBadge = qualityBadge(a);
    if (qBadge) artWrap.appendChild(qBadge);
    // More than one disc (v0.6.0): two discs, bottom right, opposite the quality.
    if (a.discs > 1) {
      const d = document.createElement("span");
      d.className = "album-discs";
      d.title = a.discs + " discs";
      d.setAttribute("aria-label", a.discs + " discs");
      artWrap.appendChild(d);
    }
    // A playlist has no cover of its own, so it gets a mosaic of the artwork
    // from the first few tracks — the way Roon draws them. Two or more distinct
    // covers make a 2x2; a single one just fills the tile, because a lone
    // quarter-sized sleeve in an empty square looks broken.
    const mosaic = Array.isArray(a.art_keys) ? a.art_keys.filter(Boolean) : [];
    if (mosaic.length >= 2) {
      artWrap.classList.add("album-art-mosaic");
      artWrap.dataset.mosaic = String(Math.min(mosaic.length, 4));
      // Keys recorded on the element so "what artwork was this tile given" is
      // answerable even after a failed <img> removes itself.
      artWrap.dataset.artKeys = mosaic.slice(0, 4).join(",");
      for (const k of mosaic.slice(0, 4)) loadArt(artWrap, k, tileImgSize(mosaic.length >= 4));
    } else if (mosaic.length === 1 || a.image_key) {
      const key = mosaic[0] || a.image_key;
      // The key stays on the tile even after a failed <img> removes itself, so
      // "what artwork was this tile given" is answerable after the fact.
      artWrap.dataset.artKey = key;
      loadArt(artWrap, key, tileImgSize(),
        (img) => { artWrap.classList.add("no-image"); img.remove(); });
    } else {
      artWrap.classList.add("no-image");
    }

    const meta = document.createElement("div");
    meta.className = "album-meta";
    meta.innerHTML = `<div class="album-title"></div><div class="album-artist"></div>`;
    meta.querySelector(".album-title").textContent  = a.title    || "Untitled";
    meta.querySelector(".album-artist").textContent = a.subtitle || "";

    btn.appendChild(artWrap);
    btn.appendChild(meta);

    // Whether long-press can multi-select this tile. It used to be inferred
    // from "was a custom opener passed", which quietly disabled selection on
    // seven of the eleven tile screens — the Library A-Z wall, Not-played,
    // label albums and the Home carousels all pass an opener for the sole
    // purpose of forcing `filter: null`, and paid for it with no select mode.
    // Stating it outright separates "how do I open" from "can I select".
    // Playlist tiles pass false: a playlist is not an album and cannot be
    // queued as one.
    const selectable = opts && "selectable" in opts ? !!opts.selectable : true;
    if (selectable) btn.dataset.offset = String(a.offset);

    // The tile knows its album and how it opens, so the album page can step to
    // the tile beside it (albumNav, below).
    btn.__album = a;
    btn.__open = onClick || (() => openAlbum(a));
    btn.__isAlbum = selectable && a.offset != null;
    btn.addEventListener("click", () => {
      if (selectable && albumSelectMode) { handleAlbumTileSelect(btn, a); return; }
      albumNav.from(btn);
      btn.__open();
    });
    if (selectable) {
      // A long press starts selecting, with the tile under the finger the
      // first pick (v0.6.24: as the labels grid and the queue; the release
      // click is eaten, so it stays picked).
      addLongPress(btn, () => {
        if (albumSelectMode) return;
        enterAlbumSelectMode();
        handleAlbumTileSelect(btn, a);
      });
    }
    return btn;
  }

  // ----- The multi-select actions menu -------------------------------------
  // One menu serves both selections: albums on a grid screen, and tracks inside
  // the album view. They can never both be live — opening the album view exits
  // album select mode — so `selMenuKind` says which one the menu is acting on
  // rather than two menus racing for the same corner of the screen.
  let selMenuKind = null;   // "albums" | "tracks" | null

  function closeSelectMenu() {
    if (!selMenu) return;
    selMenu.classList.add("hidden");
    if (selMenuBtn) selMenuBtn.setAttribute("aria-expanded", "false");
  }

  // The album view is a full-viewport modal painted OVER the top bar, so a menu
  // that lives in the top bar is invisible and untappable while an album is
  // open — selecting tracks produced ticks and no way to act on them.
  //
  // The live node is MOVED rather than duplicated. A second copy in the modal
  // would need its own listeners and its own count, and the two would drift.
  let selMenuHome = null;
  function parkSelectMenu(intoModal) {
    if (!selMenuWrap) return;
    if (intoModal) {
      const panel = modal && modal.querySelector(".modal-panel");
      if (!panel || selMenuWrap.parentNode === panel) return;
      // Remember exactly where it came from, so it goes back to the same slot
      // rather than to the end of the row.
      selMenuHome = { parent: selMenuWrap.parentNode, next: selMenuWrap.nextSibling };
      selMenuWrap.classList.add("in-modal");
      panel.appendChild(selMenuWrap);
    } else {
      if (!selMenuHome) return;
      selMenuWrap.classList.remove("in-modal");
      selMenuHome.parent.insertBefore(selMenuWrap, selMenuHome.next);
      selMenuHome = null;
    }
  }

  // Show/hide the whole control and keep its count honest. Called after every
  // change to either selection.
  function refreshSelectMenu(kind, n) {
    selMenuKind = n > 0 ? kind : null;
    if (!selMenuWrap) return;
    selMenuWrap.classList.toggle("hidden", n === 0);
    if (n === 0) { closeSelectMenu(); return; }
    if (selCount) selCount.textContent = String(n);
    const noun = kind === "tracks" ? "track" : "album";
    if (selMenuTitle) selMenuTitle.textContent = `${n} ${noun}${n === 1 ? "" : "s"} selected`;
    const addItem = selMenu && selMenu.querySelector('[data-sel-act="add"]');
    // Albums are allowed. Adding one stores its tracks, which means reading the
    // album on the Core first — see /api/user-playlists/add-albums.
    if (addItem) addItem.classList.remove("hidden");
    if (selMenuBtn) {
      selMenuBtn.setAttribute("aria-label",
        `Actions for ${n} selected ${noun}${n === 1 ? "" : "s"}`);
    }
  }

  function enterAlbumSelectMode() {
    albumSelectMode = true;
    updateAlbumActionBar();
  }

  function exitAlbumSelectMode() {
    albumSelectMode = false;
    albumSelected = [];
    if (albumActionBar) albumActionBar.classList.add("hidden");
    // Hides the whole control, not just the open dropdown — closeSelectMenu()
    // alone left a "0" badge sitting in the top bar with nothing behind it.
    refreshSelectMenu("albums", 0);
    // Document-wide, not just #album-grid: Home's carousels live outside the
    // grid and are selectable now, so a grid-scoped clear would leave ticks
    // behind on rows the user had already scrolled past.
    document.querySelectorAll(".album.is-selected")
            .forEach(b => b.classList.remove("is-selected"));
  }
  window.__exitAlbumSelectMode = exitAlbumSelectMode;
  window.__enterAlbumSelectMode = enterAlbumSelectMode;   // the tests' long press

  // The bottom bar is kept as the "you are in select mode, nothing chosen yet"
  // hint — without it, long-pressing produces no visible change at all until
  // the first tap. Once something IS selected the top-bar menu carries the
  // actions, so the bar's own buttons are gone.
  function updateAlbumActionBar() {
    const n = albumSelected.length;
    if (albumActionBar) albumActionBar.classList.toggle("hidden", !albumSelectMode || n > 0);
    if (albumActionInfo) albumActionInfo.textContent = "Tap albums to select";
    refreshSelectMenu("albums", n);
  }

  function handleAlbumTileSelect(btn, a) {
    const idx = albumSelected.findIndex(x => x.offset === a.offset);
    if (idx === -1) { albumSelected.push(a); btn.classList.add("is-selected"); }
    else            { albumSelected.splice(idx, 1); btn.classList.remove("is-selected"); }
    updateAlbumActionBar();
  }

  // Builds the album tiles into the grid. Shared by the random wall and search.
  function renderAlbumGrid(albums) {
    grid.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const a of albums) frag.appendChild(buildAlbumTile(a));
    grid.appendChild(frag);
  }

  function renderAlbums(albums) {
    if (!albums.length) {
      grid.innerHTML = "";
      setBanner("No albums were returned. Is your library indexed?", true);
      return;
    }
    setBanner(null);
    renderAlbumGrid(albums);
  }

  // ----- Random albums fetch -----
  // ----- Library album count -----
  // The topbar no longer shows a persistent "N albums" readout — it crowded
  // the controls on phones. The library total now lives in Settings; the
  // topbar element is reused only for transient CONTEXT (the active filter
  // value and the labels-browser breadcrumb) and is hidden on the plain wall.
  // Set the topbar context text directly (used by the labels browser).
  function setCountText(text) {
    const el = document.getElementById("album-count");
    if (!el) return;
    el.textContent = text || "";
    // An empty label HIDES the readout rather than showing a blank one. The
    // playlist detail screens pass "" because they already print the full name
    // as a heading; the topbar copy only repeated it, truncated to fit
    // ("My Dynamic Playlist - Electroni…" above "My Dynamic Playlist -
    // Electronic 100").
    el.classList.toggle("hidden", !text);
  }
  // Topbar context label: the active filter's value (genre/tag name) with NO
  // count, or "Random albums" on the plain wall (v0.6.24: a title, as every
  // other grid screen has); hidden on Home (`hide`). Counts were removed
  // from all screens.
  function updateCountReadout(filteredTotal, hide) {
    const el = document.getElementById("album-count");
    if (!el) return;
    if (labelsActive) return;   // labels browser manages its own header text
    if (activeFilter) {
      el.textContent = activeFilter.label || activeFilter.value;   // group label (e.g. "Rock/Metal") if set
      el.classList.remove("hidden");
    } else if (!hide && !libraryWallActive && !unplayedWallActive && !grid.classList.contains("hidden")) {
      el.textContent = "Random albums";
      el.classList.remove("hidden");
    } else {
      el.textContent = "";
      el.classList.add("hidden");
    }
  }

  async function loadRandom() {
    refreshBtn.disabled = true;
    albumCount = computeAlbumCount();
    renderSkeletons(albumCount);
    try {
      const r = await fetch(`/api/random-albums?count=${albumCount}${filterQS()}`);
      if (r.status === 503) {
        const j = await r.json().catch(() => ({}));
        setBanner(j.error || "Reading your music library…", true);
        grid.innerHTML = ""; return;
      }
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const j = await r.json();
      renderAlbums(j.albums || []);
      updateCountReadout(j.filtered ? j.total : null);
    } catch (e) {
      setBanner(`Couldn't load albums: ${e.message}`, true);
      grid.innerHTML = "";
    } finally {
      refreshBtn.disabled = false;
    }
  }

  // ----- Zones -----
  // One ask at a time (v0.8.36): a slow answer isn't joined by another every 15 s.
  let zonesAsked = null;
  function loadZones() {
    return zonesAsked || (zonesAsked = loadZonesNow().finally(() => { zonesAsked = null; }));
  }
  async function loadZonesNow() {
    try {
      const r = await fetch("/api/zones");
      const j = await r.json();
      zones = j.zones || [];
      let prev = localStorage.getItem("rra-zone");
      zoneSel.innerHTML = "";
      if (!zones.length) {
        const opt = document.createElement("option");
        // Away from home (over Tailscale) the rooms aren't offered at all.
        opt.textContent = j.away ? "Away from home — no rooms" : "No Sonos rooms found yet"; opt.value = "";
        zoneSel.appendChild(opt);
        selectedZoneId = null;
        return;
      }
      // Nothing is picked for you: until you choose a zone (the mini
      // transport's speaker button, or here) there is no zone selected, and
      // the bar says so. A zone chosen before is remembered.
      let known = prev && zones.some(z => z.zone_id === prev);
      // The phone alone (no network, or away from home): it's the zone, picked already.
      const only = zones.length === 1 && zones[0].is_phone ? zones[0].zone_id : null;
      if (!known && only) { known = true; prev = only; }
      if (!known) {
        const opt = document.createElement("option");
        opt.value = ""; opt.textContent = "Choose a zone…";
        zoneSel.appendChild(opt);
      }
      for (const z of zones) {
        const opt = document.createElement("option");
        opt.value = z.zone_id; opt.textContent = z.display_name;
        zoneSel.appendChild(opt);
      }
      selectedZoneId = known ? prev : null;
      zoneSel.value = selectedZoneId || "";
    } catch (e) { /* status banner handles */ }
  }
  // Styled yes/no confirm. Resolves true/false. Falls back to native confirm.
  // A notice with one OK (v0.7.2): the confirm box with its No put away.
  function noticeDialog(message, okLabel) {
    return new Promise((resolve) => {
      const ov  = document.getElementById("confirm-overlay");
      const msg = document.getElementById("confirm-msg");
      const yes = document.getElementById("confirm-yes");
      const no  = document.getElementById("confirm-no");
      if (!ov || !msg || !yes || !no) { window.alert(message); resolve(); return; }
      msg.textContent = message;
      msg.classList.add("is-notice");
      no.classList.add("hidden");
      const was = yes.textContent; yes.textContent = okLabel || "OK";
      let done = false;
      const close = () => {
        if (done) return; done = true;
        ov.classList.add("hidden");
        no.classList.remove("hidden"); msg.classList.remove("is-notice"); yes.textContent = was;
        yes.removeEventListener("click", close);
        ov.removeEventListener("click", onBackdrop);
        resolve();
      };
      const onBackdrop = (e) => { if (e.target.classList.contains("confirm-backdrop")) close(); };
      yes.addEventListener("click", close);
      ov.addEventListener("click", onBackdrop);
      ov.classList.remove("hidden");
      yes.focus();
    });
  }
  window.__noticeDialog = noticeDialog;
  function confirmDialog(message) {
    return new Promise((resolve) => {
      const ov  = document.getElementById("confirm-overlay");
      const msg = document.getElementById("confirm-msg");
      const yes = document.getElementById("confirm-yes");
      const no  = document.getElementById("confirm-no");
      if (!ov || !msg || !yes || !no) { resolve(window.confirm(message)); return; }
      msg.textContent = message;
      let done = false;
      const close = (val) => {
        if (done) return; done = true;
        ov.classList.add("hidden");
        yes.removeEventListener("click", onYes);
        no.removeEventListener("click", onNo);
        ov.removeEventListener("click", onBackdrop);
        resolve(val);
      };
      const onYes = () => close(true);
      const onNo  = () => close(false);
      const onBackdrop = (e) => { if (e.target.classList.contains("confirm-backdrop")) close(false); };
      yes.addEventListener("click", onYes);
      no.addEventListener("click", onNo);
      ov.addEventListener("click", onBackdrop);
      ov.classList.remove("hidden");
    });
  }
  // For the other parts of the page. The Android app's WebView answers the
  // browser's own confirm() with "no" (it has no dialog for it), so a
  // yes/no anywhere in the page is asked with this one.
  window.__confirmDialog = confirmDialog;

  // A name, asked the same way. Resolves the text, or null when cancelled —
  // what prompt() would give, which the WebView answers with null every time
  // (so "New playlist…" and "Save as…" used to close and do nothing in the app).
  function promptDialog(message, initial, okLabel) {
    return new Promise((resolve) => {
      const ov = document.getElementById("prompt-overlay");
      const form = document.getElementById("prompt-form");
      const msg = document.getElementById("prompt-msg");
      const input = document.getElementById("prompt-input");
      const ok = document.getElementById("prompt-ok");
      const cancel = document.getElementById("prompt-cancel");
      if (!ov || !form || !msg || !input || !ok || !cancel) { resolve(window.prompt(message, initial || "")); return; }
      msg.textContent = message;
      input.value = initial || "";
      ok.textContent = okLabel || "Save";
      let done = false;
      const close = (val) => {
        if (done) return; done = true;
        ov.classList.add("hidden");
        form.removeEventListener("submit", onSubmit);
        cancel.removeEventListener("click", onCancel);
        ov.removeEventListener("click", onBackdrop);
        document.removeEventListener("keydown", onKey);
        resolve(val);
      };
      const onSubmit = (e) => { e.preventDefault(); close(input.value); };
      const onCancel = () => close(null);
      const onBackdrop = (e) => { if (e.target.classList.contains("confirm-backdrop")) close(null); };
      const onKey = (e) => { if (e.key === "Escape") close(null); };
      form.addEventListener("submit", onSubmit);
      cancel.addEventListener("click", onCancel);
      ov.addEventListener("click", onBackdrop);
      document.addEventListener("keydown", onKey);
      ov.classList.remove("hidden");
      setTimeout(() => { input.focus(); input.select(); }, 30);
    });
  }
  window.__promptDialog = promptDialog;

  zoneSel.addEventListener("change", async () => {
    const newZoneId  = zoneSel.value;
    const prevZoneId = selectedZoneId;

    // Switch the active zone right away — this is what play actions and the
    // mini-transport target. Changing zones no longer moves the queue on its
    // own; we ask first (and only when the old zone is actually playing).
    selectedZoneId = newZoneId || null;
    if (selectedZoneId) {
      localStorage.setItem("rra-zone", selectedZoneId);
      const blank = zoneSel.querySelector('option[value=""]');
      if (blank) blank.remove();
    }

    if (!prevZoneId || !newZoneId || prevZoneId === newZoneId) return;

    let playing = false;
    try {
      const r = await fetch(`/api/album/now-playing?zone=${encodeURIComponent(prevZoneId)}`, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        playing = !!(j && j.album && j.album.title);
      }
    } catch (e) { /* treat as nothing playing */ }
    if (!playing) return;

    const nameOf = (id, fb) => (zones.find(z => z.zone_id === id) || {}).display_name || fb;
    const move = await confirmDialog(
      `Move what's playing in ${nameOf(prevZoneId, "the other zone")} to ${nameOf(newZoneId, "this zone")}?`
    );
    if (!move) return;

    try {
      const r = await fetch("/api/transfer-zone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: prevZoneId, to: newZoneId })
      });
      const toast = (m, kind) => { if (window.__showToast) window.__showToast(m, kind); };
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast((j.error || "Couldn't move the music").toString(), "error");
      } else {
        toast(`Moved to ${nameOf(newZoneId, "this zone")}`);
      }
      loadZones();
    } catch (e) {
      if (window.__showToast) window.__showToast("Couldn't reach the server to move the music", "error");
    }
  });

  // ----- Device picker (now-playing screen) -----
  // Replaces the old share button. Lists available zones and switches the
  // active zone by driving the existing topbar selector, so playback, the
  // mini-transport, and the now-playing screen all stay in sync.
  const npDeviceBtn     = document.getElementById("np-device");
  const npDevicePopover = document.getElementById("np-device-popover");
  const npDeviceList    = document.getElementById("np-device-list");

  async function renderDeviceList() {
    if (!npDeviceList) return;
    let list = zones;
    try {
      const r = await fetch("/api/zones", { cache: "no-store" });
      if (r.ok) { const j = await r.json(); if (Array.isArray(j.zones)) { zones = j.zones; list = j.zones; } }
    } catch (e) { /* fall back to cached zones */ }

    npDeviceList.innerHTML = "";
    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "np-device-empty";
      empty.textContent = "No zones available";
      npDeviceList.appendChild(empty);
      return;
    }
    for (const z of list) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "np-device-item" + (z.zone_id === selectedZoneId ? " is-current" : "");
      item.dataset.zone = z.zone_id;
      fillZoneRow(item, z);
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        npDevicePopover.classList.add("hidden");
        npDeviceBtn.setAttribute("aria-expanded", "false");
        if (z.zone_id === selectedZoneId) return;
        zoneSel.value = z.zone_id;
        zoneSel.dispatchEvent(new Event("change"));   // reuse the existing switch flow
        if (typeof window.__refreshTransport === "function") window.__refreshTransport();
      });
      npDeviceList.appendChild(item);
    }
  }

  if (npDeviceBtn && npDevicePopover) {
    npDeviceBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const vp = document.getElementById("np-vol-popover");
      const vb = document.getElementById("np-volbtn");
      if (vp) vp.classList.add("hidden");
      if (vb) vb.setAttribute("aria-expanded", "false");
      const willShow = npDevicePopover.classList.contains("hidden");
      if (willShow) await renderDeviceList();
      npDevicePopover.classList.toggle("hidden", !willShow);
      npDeviceBtn.setAttribute("aria-expanded", String(willShow));
    });
  }

  const npGroupOpen = document.getElementById("np-group-open");
  if (npGroupOpen) {
    npGroupOpen.addEventListener("click", (e) => {
      e.stopPropagation();
      if (npDevicePopover) npDevicePopover.classList.add("hidden");
      if (npDeviceBtn) npDeviceBtn.setAttribute("aria-expanded", "false");
      openGroupSheet();
    });
  }

  const npPowerOpen = document.getElementById("np-power-open");
  if (npPowerOpen) {
    npPowerOpen.addEventListener("click", (e) => {
      e.stopPropagation();
      if (npDevicePopover) npDevicePopover.classList.add("hidden");
      if (npDeviceBtn) npDeviceBtn.setAttribute("aria-expanded", "false");
      openDevicePowerSheet();
    });
  }

  // Roon's all-zone actions, in the sheet that is already about which zones.
  // Looked up at click time rather than at wiring time: the side menu's
  // closure defines __allZoneActions, and the two run in either order.
  for (const act of ["pause-all", "mute-all", "unmute-all"]) {
    const btn = document.getElementById("np-" + act);
    if (!btn) continue;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (npDevicePopover) npDevicePopover.classList.add("hidden");
      if (npDeviceBtn) npDeviceBtn.setAttribute("aria-expanded", "false");
      const fn = window.__allZoneActions && window.__allZoneActions[act];
      if (fn) fn();
    });
  }

  // ----- Modal -----
  let currentSource = "random";
  let currentSourceZoneId = null;

  // Ambient glow layer behind the modal header — mirrors the cover image so
  // the blur always matches the art shown. Same URL as #modal-img, so the
  // browser serves it from cache (no second fetch). Pass null to hide.
  const modalAmbient = document.getElementById("modal-ambient");
  function setModalAmbient(url) {
    if (!modalAmbient) return;
    if (url) {
      // The glow is blurred anyway, so feed it a TINY cover (96px) instead of
      // the 800px big art: Safari otherwise keeps a full-size blurred layer
      // composited behind the scrolling modal body. Upscaling the small image
      // does most of the smoothing (the CSS blur radius is tuned to match).
      // Only /api/image URLs carry a size param; anything else passes through.
      modalAmbient.src = url.includes("/api/image/")
        ? url.replace(/([?&])size=\d+/, "$1size=96")
        : url;
      modalAmbient.classList.remove("hidden");
    } else {
      modalAmbient.removeAttribute("src");
      modalAmbient.classList.add("hidden");
    }
  }
  // The transport poll (separate closure) re-points the big art when the
  // playing track changes album; it uses this bridge to keep the Queue tab's
  // ambient glow on the same album.
  window.__setModalAmbient = setModalAmbient;

  function setModalArtist(subtitle, names) {
    // `names` is the server's library-validated split (/api/album `artists`):
    // it also breaks on comma/&/+/and, but only when a fragment is a known
    // library artist — so "Panda Bear, Sonic Boom & Adrian Sherwood" becomes
    // three links while "Earth, Wind & Fire" stays one. Until the detail
    // response lands (or for legacy callers) the conservative client split
    // applies: " / " is Roon's standard separator; feat/featuring/ft handle
    // featured artists; " & " and comma are NOT split here because they are
    // often part of a band name ("Simon & Garfunkel").
    //
    // The links live in their own container as modalSub's first child so the
    // late validated re-render can't wipe the year/label/score spans that
    // renderExtras appends after them. A call WITHOUT `names` is an album
    // (re)open: full reset, and the previous album's extras go with it.
    const validated = Array.isArray(names) && names.length > 0;
    let box = document.getElementById("modal-artist-names");
    if (!validated || !box) {
      modalSub.innerHTML = "";
      box = document.createElement("span");
      box.id = "modal-artist-names";
      modalSub.appendChild(box);
    }
    box.innerHTML = "";
    if (!subtitle) return;
    const parts = validated
      ? names
      : subtitle.split(/ \/ | feat\.? | featuring | ft\.? /i).map(s => s.trim()).filter(Boolean);
    // Album credits are always linkable: the credit came from a library album,
    // so at minimum that album is on the artist's screen.
    renderArtistLinks(box, parts.map(name => ({ name, linkable: true })), {
      separator: validated ? " · " : " / ",
      linkClass: "modal-artist-link",
      sepClass:  "modal-subtitle-year",
    });
  }

  // The per-artist link row, shared by the album view and the now-playing
  // screen so both behave identically — one implementation, one set of
  // listeners, one navigation rule.
  //
  // `parts` is [{ name, linkable }]. A non-linkable name renders as plain text
  // rather than a button: the library has no screen for it, and a link that
  // opens an empty page is worse than no link. The album view marks everything
  // linkable (see above); the now-playing screen doesn't, because its credit is
  // the track artist.
  function renderArtistLinks(box, parts, opts) {
    opts = opts || {};
    const sep        = opts.separator || " · ";
    const linkClass  = opts.linkClass || "modal-artist-link";
    const sepClass   = opts.sepClass  || "modal-subtitle-year";
    // Non-linkable names default to the separator's muted tone, but the
    // now-playing screen overrides it: on a compilation EVERY track artist can
    // be unlinkable, and dimming the whole line reads as a rendering fault
    // rather than as information.
    const plainClass = opts.plainClass || sepClass;
    box.innerHTML = "";
    parts.forEach((part, i) => {
      if (i > 0) {
        const s = document.createElement("span");
        s.className = sepClass;
        s.textContent = sep;
        box.appendChild(s);
      }
      if (!part.linkable) {
        const span = document.createElement("span");
        span.className = plainClass;
        span.textContent = part.name;
        box.appendChild(span);
        return;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = linkClass;
      btn.textContent = part.name;
      btn.addEventListener("click", () => {
        // Close FIRST. showArtistAlbums parks the grid/topbar/labels but knows
        // nothing about the album modal, so with the modal still open the
        // artist grid renders behind it and body scroll stays locked.
        // The album it was opened from (v0.6.0-RC11): Back on the artist page
        // comes back to it, not to Home.
        const fromAlbum = currentAlbum ? { album: currentAlbum, opts: { source: currentSource, zoneId: currentSourceZoneId, filter: currentDetailFilter } } : null;
        closeModal();
        // The artist view PARKS the labels browser itself (see showArtistAlbums)
        // so its Back can restore it — tearing it down here would lose the open
        // label and leave the restored grid without its labels bar.
        window.__showArtistAlbums && window.__showArtistAlbums(part.name, { fromAlbum });
      });
      box.appendChild(btn);
    });
  }
  // The now-playing screen lives inside this modal but is rendered by the
  // transport IIFE, which has no access to closeModal or this renderer.
  window.__renderArtistLinks = renderArtistLinks;

  /*
   * Previous and next on the album page (v0.5.44): an album opened from a
   * list — a Home row, an artist's albums, a label's, the Library wall,
   * search — remembers the tiles beside it, and the page steps to them with
   * the two discs at the top, a swipe, or the arrow keys, each opening the
   * way its own tile would (the same source and filter). Back still returns
   * to the list. An album opened any other way (a search match, a link, the
   * page restored) has no list, and the discs stay hidden.
   */
  const albumNav = {
    pending: null,   // set by a tile's click, read once by openAlbum
    current: null,   // { items: [{ album, open }], index }
    from(btn) {
      const parent = btn.parentElement;
      if (!parent) { this.pending = null; return; }
      const tiles = [...parent.children].filter(el => el.__isAlbum && el.__album);
      const index = tiles.indexOf(btn);
      this.pending = tiles.length > 1 && index >= 0
        ? { items: tiles.map(el => ({ album: el.__album, open: el.__open })), index }
        : null;
    },
    take() { const n = this.pending; this.pending = null; return n; },
    step(dir) {
      const nav = this.current;
      if (!nav || modal.classList.contains("np-mode")) return false;
      const i = nav.index + dir;
      if (i < 0 || i >= nav.items.length) return false;
      this.pending = { items: nav.items, index: i };
      nav.items[i].open();
      return true;
    },
    paint() {
      const wrap = document.getElementById("modal-nav");
      if (!wrap) return;
      const nav = this.current;
      wrap.classList.toggle("hidden", !nav);
      const prev = document.getElementById("modal-prev"), next = document.getElementById("modal-next");
      if (prev) prev.disabled = !nav || nav.index <= 0;
      if (next) next.disabled = !nav || nav.index >= nav.items.length - 1;
      if (nav) {
        const at = n => nav.items[n] && nav.items[n].album.title ? ": " + nav.items[n].album.title : "";
        if (prev) prev.setAttribute("aria-label", "Previous album" + at(nav.index - 1));
        if (next) next.setAttribute("aria-label", "Next album" + at(nav.index + 1));
      }
    }
  };
  {
    const prev = document.getElementById("modal-prev"), next = document.getElementById("modal-next");
    if (prev) prev.addEventListener("click", () => albumNav.step(-1));
    if (next) next.addEventListener("click", () => albumNav.step(1));
    // A swipe across the page: left for the next album, right for the one before.
    const panel = modal ? modal.querySelector(".modal-panel") : null;
    if (panel) {
      let sx = 0, sy = 0, st = 0, live = false;
      panel.addEventListener("touchstart", (e) => {
        if (e.touches.length !== 1) { live = false; return; }
        sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); live = true;
      }, { passive: true });
      panel.addEventListener("touchend", (e) => {
        if (!live) return;
        live = false;
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - sx, dy = t.clientY - sy;
        if (Date.now() - st > 800 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) / 2) return;
        albumNav.step(dx < 0 ? 1 : -1);
      }, { passive: true });
    }
    document.addEventListener("keydown", (e) => {
      if (!modal || modal.classList.contains("hidden") || e.altKey || e.ctrlKey || e.metaKey) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight" && albumNav.step(1)) e.preventDefault();
      else if (e.key === "ArrowLeft" && albumNav.step(-1)) e.preventDefault();
    });
  }

  // The screen Now playing was opened over (v0.6.1). Now playing is this same
  // modal, so tapping the mini player while an album is open REPLACES that
  // album — and the only way out was Home. Its Back puts back what it
  // replaced: the album that was open, or (none) whatever screen is under the
  // modal, which closing reveals as it was.
  let npReturn = null;

  /*
   * ROOM FOR THE ⋯ MENU ABOVE THE BUTTON ROW (v0.7.8). From 720px up the
   * album view is two columns, and the right-hand one starts with the title
   * and the artist line — all that stands between the button row and the
   * panel's top edge. The menu opens upwards from that row, and four to six
   * items rose past the edge, where the panel clips them: on an iPad the
   * first two could be neither seen nor tapped. So the column is dropped by
   * exactly the room missing, measured: the menu's own height (however many
   * items this album's has), the row's place at the top of the scroll
   * (however many lines the title takes), and the pinned Share button's
   * foot, which the menu stays clear of. Phones and Now playing: none — the
   * menu opens over the cover there. Re-measured when the title, the artist
   * line or the row changes size, and when the window does.
   */
  function fitAlbumMenuRoom() {
    const info = modal.querySelector(".modal-info");
    const body = modal.querySelector(".modal-body");
    if (!info || !body) return;
    const two = !modal.classList.contains("hidden") && !modal.classList.contains("np-mode") &&
      window.matchMedia && window.matchMedia("(min-width: 720px)").matches;
    const menu = two ? modalActs.querySelector(".overflow-wrap .overflow-menu") : null;
    if (!menu) { info.style.removeProperty("--album-menu-room"); return; }
    const shown = !menu.classList.contains("hidden");
    if (!shown) { menu.style.visibility = "hidden"; menu.classList.remove("hidden"); }
    const h = menu.getBoundingClientRect().height;
    if (!shown) { menu.classList.add("hidden"); menu.style.visibility = ""; }
    info.style.setProperty("--album-menu-room", "0px");
    const bodyTop = body.getBoundingClientRect().top;
    const rowTop = modalActs.getBoundingClientRect().top - bodyTop + body.scrollTop;
    const share = document.getElementById("modal-share-btn");
    const sb = share && share.getClientRects().length ? share.getBoundingClientRect().bottom - bodyTop : 0;
    const clear = Math.max(8, sb + 8);
    const missing = Math.ceil(h + 6 + clear - rowTop);
    info.style.setProperty("--album-menu-room", Math.max(0, missing) + "px");
  }
  {
    let raf = 0;
    const refit = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; fitAlbumMenuRoom(); }); };
    window.addEventListener("resize", refit);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(refit);
      for (const el of [modalTitle, modalSub, modalActs]) if (el) ro.observe(el);
    }
  }

  /* An album's length: 52:41, or 1:02:15 past the hour. */
  function fmtTotal(secs) {
    const s = Math.round(secs), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    const pad = n => String(n).padStart(2, "0");
    return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
  }

  function openAlbum(album, opts) {
    opts = opts || {};
    if (opts.source === "now-playing") {
      const albumOpen = !modal.classList.contains("hidden") && !modal.classList.contains("np-mode");
      // Re-opened while already on Now playing: keep what it is to go back to.
      if (albumOpen) {
        // Where the album was opened from (its prev/next) and how far down it
        // was scrolled go with it, so Back puts back the screen as it was.
        const bodyEl = modal.querySelector(".modal-body");
        npReturn = currentAlbum
          ? { album: currentAlbum, opts: { source: currentSource, zoneId: currentSourceZoneId, filter: currentDetailFilter },
              nav: albumNav.current, scrollTop: bodyEl ? bodyEl.scrollTop : 0 }
          : null;
      } else if (modal.classList.contains("hidden")) {
        npReturn = null;
      }
    } else {
      npReturn = null;
    }
    albumNav.current = albumNav.take();
    // Album select mode and track select mode both drive the one top-bar menu,
    // so they must never be live together. Opening an album ends the grid
    // selection rather than leaving a count behind that the menu would then
    // act on with the wrong list.
    if (albumSelectMode) exitAlbumSelectMode();
    exitTrackSelectMode();
    currentAlbum = album;
    window.__currentAlbum = album;
    // Its big cover fetched now, so the share card is ready the moment it's asked for.
    if (album && album.image_key && window.__prewarmShareCard) window.__prewarmShareCard(album.image_key);
    currentSource = opts.source || "random";
    currentSourceZoneId = opts.zoneId || null;
    // An explicit opts.filter (incl. null) wins over the active filter — Home
    // tiles carry full-library offsets and must resolve unfiltered even if a
    // genre filter is still active.
    currentDetailFilter = ("filter" in opts) ? opts.filter : activeFilter;

    // Persist so the modal survives a Safari reload after tapping an external link
    try {
      sessionStorage.setItem("rra-modal",
        JSON.stringify({ album, source: currentSource, zoneId: currentSourceZoneId,
                         filter: currentDetailFilter }));
    } catch (e) { /* ignore */ }

    const isNP = currentSource === "now-playing";
    if (isNP) albumNav.current = null;
    albumNav.paint();
    resetModalScroll();   // a reopened modal must never start mid-scroll

    // Tabs visible only in now-playing mode
    const tabsEl = document.getElementById("modal-tabs");
    tabsEl.classList.toggle("hidden", !isNP);
    modal.classList.toggle("np-mode", isNP);
    showTab("album");

    modalTitle.textContent = album.title || "Untitled";
    setModalArtist(album.subtitle);
    modalActs.innerHTML    = isNP ? "" : `<div class="modal-loading">Loading…</div>`;
    modalTracks.innerHTML  = "";
    { const tt = document.getElementById("modal-total"); if (tt) tt.textContent = ""; }

    // Reset bio sections, and the sections under them (cleared before any
    // answer for this album can arrive)
    resetMoreSections();
    document.getElementById("album-bio-section").classList.add("hidden");
    document.getElementById("album-bio-toggle").classList.add("hidden");
    document.getElementById("album-bio-source").classList.add("hidden");
    document.getElementById("album-bio-text").dataset.clipped = "true";
    setModalSource(album);   // tile data may already carry it; refreshed below from the detail response
    resetBooklets();         // a previous album's book never lingers; asked for once its offset is sure
    if (album.image_key) {
      modalImg.src = `/api/image/${encodeURIComponent(album.image_key)}?size=800`;
      modalImg.style.display = "";
      setModalAmbient(modalImg.src);
    } else {
      modalImg.removeAttribute("src");
      modalImg.style.display = "none";
      setModalAmbient(null);
    }
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    if (isNP) {
      // The now-playing screen is driven live by the transport poll loop;
      // refresh it immediately from the latest zone state.
      if (typeof window.__refreshTransport === "function") window.__refreshTransport();
    } else {
      fetchAlbumDetail(album).catch(err => {
        // An album of the phone's own music that has left the folder since
        // its tile was drawn (moved to the server, say): say so, take the
        // tile off Home and the wall, and go back to where you were.
        if (err.gone && isPhoneAlbum(album)) {
          showToast(err.message, "error");
          if (window.__musicdLocalChanged) window.__musicdLocalChanged();
          const back = modal.querySelector(".modal-close[data-close]");
          if (album === currentAlbum) { if (back) back.click(); else closeModal(); }
          return;
        }
        modalActs.innerHTML = `<div class="modal-error">${escapeHtml(err.message)}</div>`;
      });
      fetchAlbumExtras(album).catch(() => { /* extras are non-critical — modal still opens */ });
    }
  }

  // Put the modal's scroller back to the top.
  //
  // .modal-body is a LONG-LIVED node — the modal is hidden and shown, never
  // rebuilt — so its scrollTop outlives everything drawn inside it. An album
  // opened after another one was scrolled halfway down therefore started
  // halfway down, and switching back from the Queue tab kept the queue's
  // offset. No caller ever wants to open a screen already scrolled.
  //
  // NOT the fix for "now playing is stretched too high above the top of the
  // screen" — that was the missing status-bar inset (style.css, np-mode
  // padding-top), and the Now playing tab is `overflow: hidden` anyway, so its
  // scrollTop cannot be anything but 0 on a phone-sized viewport.
  function resetModalScroll() {
    const body = modal ? modal.querySelector(".modal-body") : null;
    if (body) body.scrollTop = 0;
  }

  function showTab(name) {
    document.querySelectorAll(".modal-tab").forEach(b => {
      b.classList.toggle("is-active", b.dataset.tab === name);
    });
    document.getElementById("tab-album").classList.toggle("hidden", name !== "album");
    document.getElementById("tab-queue").classList.toggle("hidden", name !== "queue");

    // Track the active tab on the modal so the transport bar / now-playing
    // screen can react: bar hidden on the Now playing tab, shown on Queue.
    modal.classList.toggle("tab-album", name === "album");
    modal.classList.toggle("tab-queue", name === "queue");

    // The Roon-style now-playing block only shows on the Now playing tab while
    // in now-playing mode.
    const npScreen = document.getElementById("np-screen");
    if (npScreen) {
      npScreen.classList.toggle("hidden",
        !(name === "album" && modal.classList.contains("np-mode")));
    }
    resetModalScroll();

    if (name === "queue") loadQueue();
    if (typeof window.__refreshTransport === "function") window.__refreshTransport();
  }
  // Switching zones with the Queue tab already open has to repaint it — the
  // fix above makes the FETCH follow the live zone, but nothing was asking it
  // to fetch again, so the stale list stayed on screen until you left the tab
  // and came back.
  {
    const zs = document.getElementById("zone-select");
    if (zs) zs.addEventListener("change", () => {
      if (modal && !modal.classList.contains("hidden") && modal.classList.contains("tab-queue")) {
        loadQueue();
      }
    });
  }

  document.querySelectorAll(".modal-tab").forEach(b => {
    b.addEventListener("click", () => showTab(b.dataset.tab));
  });

  // A queue belongs to a ZONE, and the zone the user is pointed at can change
  // while this screen stays open. currentSourceZoneId is a snapshot taken in
  // openAlbum(), so reading it here showed the queue of whichever zone happened
  // to be selected when the screen was opened — switch from Sonos to WPP
  // without moving playback and you kept looking at the Sonos queue, and
  // "Play from here" acted on it too.
  //
  // The live zone selector is the single source of truth every other control
  // already follows (the transport bar and now-playing screen both read it), so
  // the queue follows it as well. The snapshot stays as a last-resort fallback
  // for the case where the selector isn't populated yet.
  function queueZoneId() {
    const sel = document.getElementById("zone-select");
    return (sel && sel.value) || selectedZoneId || currentSourceZoneId || null;
  }

  // Collapsed by default, remembered for the session. Every play action on this
  // screen re-pulls the queue, and a fold-out that shut itself on each of those
  // would be unusable.
  let queueHistoryOpen = false;
  // Select mode, and the picks in the order they were MADE — which is the order
  // they will be queued in, and is not the order they are shown in. Both are
  // reset whenever the list is rebuilt: the rows are new nodes then, and a
  // selection pointing at rows that no longer exist is worse than none.
  let historySelectMode = false;
  let historySelected = [];
  // The queue's own selection (v0.6.24): a long press on a row starts it with
  // that row picked; taps pick more, in order; the ⋯ beside the remaining
  // time plays them now or next, or removes them. Reset with the rows.
  let queueSelectMode = false;
  let queueSelected = [];
  let repaintQueueSelection = () => {};   // the bar and rows repainted after an action
  // Mirrors lib/queue-history.js. Each track is a full browse navigation, so a
  // large selection is minutes of Core traffic; the server enforces the same
  // number and this is only here to say so before the request is made.
  const HISTORY_MULTI_MAX = 20;
  // Repaints the fold-out from the state above. Held here because the send
  // finishes OUTSIDE the render that drew the rows, and without it the Select
  // button stayed lit and the action bar stayed open over an empty selection
  // until the queue reload landed 600ms later.
  let repaintHistory = () => {};

  // What already played, above the live queue.
  //
  // Roon's queue reports the current track and what is coming; anything played
  // or skipped past is gone from it, and there is no queue-history call in the
  // extension API. These rows are what the extension watched leave the zone.
  //
  // They are a RECORD, not a rewindable queue, and the UI has to be honest
  // about that: tapping one adds it after the current track. Restoring the
  // queue around it would mean rebuilding every track after it through the
  // browse hierarchy — roughly eight Core round trips each, behind a play_now
  // that wipes the live queue first.
  function renderQueueHistory(list, history) {
    if (!history.length) return;
    // The server sends newest first ("the last N"); on screen it reads
    // oldest-at-the-top so the most recent sits against the Now playing
    // divider, the way a queue is read.
    const rows = history.slice().reverse();

    // The disclosure and the actions are ONE element, and it is the element
    // that sticks. Two sticky rows would each need to know the other's height
    // to stack without overlapping; one wrapper just works, at any text size.
    //
    // Still inside the list rather than floating over it — a bar positioned
    // above the queue would be a new stacking context on a screen that already
    // has the transport bar in it, which is how v1.6.58's sheets ended up
    // underneath something.
    const head = document.createElement("li");
    head.className = "q-history-head";

    const bar = document.createElement("div");
    bar.className = "q-history-bar";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "q-history-toggle";
    const selBtn = document.createElement("button");
    selBtn.type = "button";
    selBtn.className = "q-history-select";
    bar.appendChild(btn);
    bar.appendChild(selBtn);

    const actions = document.createElement("div");
    actions.className = "q-hist-actions hidden";
    const count = document.createElement("span");
    count.className = "q-hist-count";
    const mkAct = (label, cls) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "q-hist-act" + (cls ? " " + cls : "");
      b.textContent = label;
      return b;
    };
    const actNext  = mkAct("Play next", "primary");
    const actQueue = mkAct("Add to queue");
    const actClear = mkAct("Clear");
    actions.append(count, actNext, actQueue, actClear);
    head.append(bar, actions);

    const rowEls = rows.map((h) => {
      const li = document.createElement("li");
      li.className = "q-hist-row is-tappable";

      // The pick number. Selection order is not display order, so without a
      // number on the row there is no way to see what order you chose — and
      // the order is the entire point of selecting more than one.
      const num = document.createElement("span");
      num.className = "q-hist-num hidden";

      const art = document.createElement("img");
      art.className = "q-art";
      if (h.image_key) art.src = `/api/image/${encodeURIComponent(h.image_key)}?size=120`;
      else art.style.visibility = "hidden";

      const tx = document.createElement("div"); tx.className = "q-text";
      const tt = document.createElement("div"); tt.className = "q-title";
      tt.textContent = h.track || "";
      const ts = document.createElement("div"); ts.className = "q-sub";
      ts.textContent = [h.artist, h.album].filter(Boolean).join(" · ");
      tx.appendChild(tt); tx.appendChild(ts);

      const len = document.createElement("span");
      len.className = "q-len";
      // A skip is only legible next to how long the track was — "0:12" alone
      // reads as a very short track. Anything that counted as played just
      // shows its length, like every other row.
      if (!h.played && h.elapsed > 0 && h.duration) {
        len.textContent = `${fmtDuration(h.elapsed)} / ${fmtDuration(h.duration)}`;
        len.classList.add("is-skipped");
        li.classList.add("was-skipped");
      } else if (h.duration) {
        len.textContent = fmtDuration(h.duration);
      }

      li.append(num, art, tx, len);
      return li;
    });

    // Which rows are picked, and where each sits in the pick order. Rerun on
    // every toggle because removing a pick renumbers everything after it.
    const paintSelection = () => {
      rowEls.forEach((el, i) => {
        const at = historySelected.indexOf(i);
        el.classList.toggle("is-picked", at !== -1);
        const n = el.querySelector(".q-hist-num");
        n.textContent = at === -1 ? "" : String(at + 1);
        n.classList.toggle("hidden", at === -1 || !historySelectMode);
      });
      const n = historySelected.length;
      count.textContent = n ? `${n} selected` : "Tap tracks in play order";
      for (const b of [actNext, actQueue]) b.disabled = n === 0;
    };

    const paint = () => {
      btn.setAttribute("aria-expanded", String(queueHistoryOpen));
      btn.textContent = (queueHistoryOpen ? "▾ " : "▸ ") +
        `${rows.length} played earlier`;
      for (const el of rowEls) el.classList.toggle("hidden", !queueHistoryOpen);
      // Selecting is only offered while the rows are on screen — a Select
      // button above a collapsed list acts on things you cannot see.
      selBtn.classList.toggle("hidden", !queueHistoryOpen);
      selBtn.textContent = historySelectMode ? "Done" : "Select";
      selBtn.setAttribute("aria-pressed", String(historySelectMode));
      actions.classList.toggle("hidden", !queueHistoryOpen || !historySelectMode);
      // Only pinned while the rows are showing. Collapsed, it is one line above
      // the Now playing divider and pinning it would park a bar over the live
      // queue for the whole scroll of it.
      head.classList.toggle("is-open", queueHistoryOpen);
      for (const el of rowEls) el.classList.toggle("is-selecting", historySelectMode);
      paintSelection();
    };

    btn.addEventListener("click", () => {
      queueHistoryOpen = !queueHistoryOpen;
      // Closing the fold-out ends the selection with it: picks that cannot be
      // seen cannot be checked before acting on them.
      if (!queueHistoryOpen) { historySelectMode = false; historySelected = []; }
      paint();
    });
    selBtn.addEventListener("click", () => {
      historySelectMode = !historySelectMode;
      if (!historySelectMode) historySelected = [];
      paint();
    });
    actClear.addEventListener("click", () => { historySelected = []; paintSelection(); });
    actNext.addEventListener("click",  () => runHistoryMulti("play_next", rows));
    actQueue.addEventListener("click", () => runHistoryMulti("queue", rows));

    rowEls.forEach((el, i) => {
      el.addEventListener("click", () => {
        if (!historySelectMode) { playHistoryNext(rows[i]); return; }
        const at = historySelected.indexOf(i);
        if (at === -1) {
          if (historySelected.length >= HISTORY_MULTI_MAX) {
            showToast(`Up to ${HISTORY_MULTI_MAX} tracks at a time`, "error");
            return;
          }
          historySelected.push(i);          // pushed, so the array IS the order
        } else {
          historySelected.splice(at, 1);
        }
        paintSelection();
      });
    });

    // The control first, then what it discloses: collapsed it sits alone at the
    // top of the list, and expanded the rows run down from it to finish against
    // the Now playing divider — the order they were played in.
    list.appendChild(head);
    for (const el of rowEls) list.appendChild(el);
    repaintHistory = paint;
    paint();
  }

  // Send the selection, in the order it was picked.
  async function runHistoryMulti(kind, rows) {
    if (!historySelected.length) return;
    const picks = historySelected.map(i => rows[i]).filter(Boolean);
    const verb = kind === "queue" ? "Add" : "Play";
    const what = picks.length === 1 ? `"${picks[0].track}"` : `${picks.length} tracks`;
    if (!await confirmDialog(
      `${verb} ${what} ${kind === "queue" ? "to the end of the queue" : "next"}?`)) return;

    for (const b of document.querySelectorAll(".q-hist-act")) b.disabled = true;
    showToast(`Adding ${picks.length} track${picks.length === 1 ? "" : "s"}…`,
              null, TOAST_REPORT_MS);
    try {
      const r = await fetch("/api/queue/history-multi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zone_or_output_id: queueZoneId(),
          kind,
          // Selection order. The server decides what order to SEND them in so
          // they land this way round — see playNextSendOrder.
          tracks: picks.map(h => ({ track: h.track, artist: h.artist, album: h.album })),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        showToast(j.error || `Couldn't add those: HTTP ${r.status}`, "error", TOAST_REPORT_MS);
        return;
      }
      // Every part of a partial result is worth saying: which went, which the
      // library could not find, which Roon refused.
      let msg = `${kind === "queue" ? "Queued" : "Playing"} ${j.queued} track${j.queued === 1 ? "" : "s"}`;
      // Name them. "1 not in your library" leaves the user to work out WHICH of
      // their picks it meant, and the answer decides whether it is a real
      // absence or something to report.
      const named = (list, what) => {
        if (!list || !list.length) return "";
        const shown = list.slice(0, 3).map(t => `“${t}”`).join(", ");
        return `, ${shown}${list.length > 3 ? ` and ${list.length - 3} more` : ""} ${what}`;
      };
      const missed = (j.unresolved || []).length;
      const failed = (j.failed || []).length;
      msg += named(j.unresolved, "not in your library");
      msg += named(j.failed, "refused by Sonos");
      showToast(msg, (missed || failed) ? "error" : null, TOAST_REPORT_MS);
      historySelectMode = false;
      historySelected = [];
      // Now, not when the reload lands: the send has finished and the controls
      // have to say so immediately, or they sit there lit over nothing.
      repaintHistory();
      setTimeout(loadQueue, 600);
    } catch (e) {
      showToast("Couldn't reach the extension", "error");
    } finally {
      for (const b of document.querySelectorAll(".q-hist-act")) b.disabled = false;
    }
  }

  // Add a played track back, after the current one.
  async function playHistoryNext(h) {
    const name = h.track || "this track";
    if (!await confirmDialog(`Play "${name}" next?`)) return;
    try {
      const r = await fetch("/api/queue/play-history-next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Re-read at tap time, exactly as the live rows do: these rows belong
          // to whichever zone the screen is showing now.
          zone_or_output_id: queueZoneId(),
          track: h.track, artist: h.artist, album: h.album
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        // "Not in your library" is an outcome, not a fault — a stream, or an
        // album since removed. Saying which stops it reading as a bug.
        showToast(j.unresolved
          ? `Can't play "${name}" again — it isn't in your library`
          : "Couldn't play that: " + (j.error || `HTTP ${r.status}`), "error");
        return;
      }
      showToast(`Playing "${j.track || name}" next`);
      setTimeout(loadQueue, 600);
    } catch (e) {
      showToast("Couldn't reach the extension", "error");
    }
  }

  // The queue as last shown (v0.8.35): while it is asked for again, that one
  // stays on screen and the fresh one replaces it once it comes — the list is
  // never emptied to wait. Only a zone not yet shown says "Loading queue…".
  let queueView = null;     // { zoneId, items, history }
  let queueLoads = 0;       // the latest load: an earlier one that answers after it is dropped
  // [expectFirst]: a track just played from here. Until the room's own queue
  // has it as "Now playing", the screen keeps it so (asked again three times,
  // then the room's word is taken).
  async function loadQueue(opts = {}) {
    const zoneId = queueZoneId();
    if (!zoneId) return;
    const seq = ++queueLoads;
    const summary = document.getElementById("queue-summary");
    const list    = document.getElementById("queue-list");
    const empty   = document.getElementById("queue-empty");
    if (!queueView || queueView.zoneId !== zoneId) {
      queueView = null;
      summary.textContent = "Loading queue…";
      list.innerHTML = "";
      empty.classList.add("hidden");
    }
    try {
      const r = await fetch(`/api/queue?zone=${encodeURIComponent(zoneId)}`);
      const j = await r.json();
      if (seq !== queueLoads || zoneId !== queueZoneId()) return;
      const view = { zoneId, items: j.items || [], history: Array.isArray(j.history) ? j.history : [] };
      const tries = opts.tries || 0;
      if (opts.expectFirst != null && (view.items[0] || {}).queue_item_id !== opts.expectFirst && tries < 3) {
        setTimeout(() => { if (seq === queueLoads) loadQueue({ expectFirst: opts.expectFirst, tries: tries + 1 }); }, 700);
        return;
      }
      renderQueue(view);
    } catch (e) {
      if (seq !== queueLoads) return;
      if (!queueView) summary.textContent = "Couldn't load queue: " + e.message;
    }
  }
  // The queue once a track further down plays from here: the ones above it
  // played (newest first, as the server sends them), it "Now playing".
  function playedFrom(view, k) {
    const played = view.items.slice(0, k).reverse().map(x => ({
      track: x.title, artist: x.subtitle, album: x.album, image_key: x.image_key,
      duration: x.length || 0, elapsed: x.length || 0, played: true, queue_item_id: x.queue_item_id
    }));
    return { zoneId: view.zoneId, items: view.items.slice(k), history: played.concat(view.history) };
  }
  function renderQueue(view) {
    queueView = view;
    const summary = document.getElementById("queue-summary");
    const list    = document.getElementById("queue-list");
    const empty   = document.getElementById("queue-empty");
    summary.textContent = "";
    list.innerHTML = "";
    // The rows about to be discarded are the ones the picks point at, so the
    // selection goes with them. Select MODE goes too: leaving it on with an
    // empty selection shows an action bar over rows nobody has picked yet.
    historySelectMode = false;
    historySelected = [];
    queueSelectMode = false;
    queueSelected = [];
    empty.classList.add("hidden");
    try {
      const items = view.items;
      const history = view.history;
      // Only truly empty when there is nothing either side of the divider. A
      // queue that has run out but played twenty tracks is not an empty screen.
      if (!items.length && !history.length) {
        summary.textContent = "";
        empty.classList.remove("hidden");
        return;
      }
      let totalSec = 0;
      for (const it of items) if (it.length) totalSec += it.length;
      // The bar: the count and time on the left; on the right Clear all, or,
      // selecting, the ⋯ menu (Play now, Play next, Remove) and Done.
      summary.innerHTML = "";
      const sumText = document.createElement("span");
      sumText.className = "queue-summary-text";
      sumText.textContent = items.length
        ? `${items.length} track${items.length === 1 ? "" : "s"} · ${fmtDuration(totalSec)} remaining`
        : "Nothing more queued";
      const tools = document.createElement("div");
      tools.className = "queue-summary-tools";
      const clearAll = document.createElement("button");
      clearAll.type = "button"; clearAll.className = "q-tool"; clearAll.textContent = "Clear all";
      clearAll.setAttribute("aria-label", "Clear the queue");
      const menuWrap = document.createElement("div");
      menuWrap.className = "sel-menu-wrap q-sel-menu-wrap hidden";
      const menuBtn = document.createElement("button");
      menuBtn.type = "button"; menuBtn.className = "q-tool q-tool-menu"; menuBtn.textContent = "⋯";
      menuBtn.setAttribute("aria-label", "What to do with the selected tracks");
      menuBtn.setAttribute("aria-haspopup", "menu"); menuBtn.setAttribute("aria-expanded", "false");
      const menu = document.createElement("div");
      menu.className = "sel-menu hidden"; menu.setAttribute("role", "menu");
      const menuCount = document.createElement("div"); menuCount.className = "sel-menu-title";
      menu.appendChild(menuCount);
      const mkItem = (label, act, danger) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "sel-menu-item" + (danger ? " is-danger" : ""); b.setAttribute("role", "menuitem");
        b.dataset.queueAct = act; b.textContent = label;
        b.addEventListener("click", () => { closeMenu(); runQueueAction(act, items); });
        menu.appendChild(b);
        return b;
      };
      mkItem("Play now", "play_now"); mkItem("Play next", "play_next"); mkItem("Remove", "remove", true);
      menuWrap.append(menuBtn, menu);
      const done = document.createElement("button");
      done.type = "button"; done.className = "q-tool hidden"; done.textContent = "Done";
      tools.append(clearAll, menuWrap, done);
      summary.append(sumText, tools);
      const closeMenu = () => { menu.classList.add("hidden"); menuBtn.setAttribute("aria-expanded", "false"); };
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = menu.classList.toggle("hidden") === false;
        menuBtn.setAttribute("aria-expanded", String(open));
        if (open) setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
      });
      clearAll.addEventListener("click", () => clearQueueAll());
      done.addEventListener("click", () => { queueSelectMode = false; queueSelected = []; paintQueueSelection(); });
      const itemRows = [];
      // Which rows are picked and in what order; the tools for the mode.
      const paintQueueSelection = () => {
        itemRows.forEach(({ li, num, it }) => {
          const at = queueSelected.indexOf(it.queue_item_id);
          li.classList.toggle("is-picked", at !== -1);
          li.classList.toggle("is-selecting", queueSelectMode);
          num.textContent = at === -1 ? "" : String(at + 1);
          num.classList.toggle("hidden", at === -1 || !queueSelectMode);   // unpicked: the outlined circle
        });
        const n = queueSelected.length;
        menuCount.textContent = n ? `${n} selected` : "Tap tracks to select them";
        for (const b of menu.querySelectorAll(".sel-menu-item")) b.disabled = n === 0;
        clearAll.classList.toggle("hidden", queueSelectMode || !items.length);
        menuWrap.classList.toggle("hidden", !queueSelectMode);
        done.classList.toggle("hidden", !queueSelectMode);
        if (!queueSelectMode) closeMenu();
      };
      repaintQueueSelection = paintQueueSelection;

      // Above the "Now playing" divider, because that is where it happened.
      renderQueueHistory(list, history);

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (i === 0) {
          // Roon-style "Now playing" divider above the current track
          const div = document.createElement("li");
          div.className = "q-divider";
          div.setAttribute("aria-hidden", "true");
          div.innerHTML =
            '<span class="q-divider-line"></span>' +
            '<span class="q-divider-label">Now playing</span>' +
            '<span class="q-divider-line"></span>';
          list.appendChild(div);
        }
        const li = document.createElement("li");
        if (i === 0) li.classList.add("is-now");
        else li.classList.add("is-tappable");

        // The pick number, as the played-earlier rows carry it.
        const num = document.createElement("span"); num.className = "q-hist-num hidden";
        const art = document.createElement("img"); art.className = "q-art";
        if (it.image_key) art.src = `/api/image/${encodeURIComponent(it.image_key)}?size=120`;
        else art.style.visibility = "hidden";
        const tx = document.createElement("div"); tx.className = "q-text";
        const tt = document.createElement("div"); tt.className = "q-title";  tt.textContent = it.title || "";
        const ts = document.createElement("div"); ts.className = "q-sub";    ts.textContent = it.subtitle || "";
        tx.appendChild(tt); tx.appendChild(ts);
        const len = document.createElement("span"); len.className = "q-len";
        if (it.length) len.textContent = fmtDuration(it.length);
        li.appendChild(num); li.appendChild(art); li.appendChild(tx); li.appendChild(len);
        itemRows.push({ li, num, it });

        // A long press starts selecting, with this row the first pick.
        const pick = () => {
          const at = queueSelected.indexOf(it.queue_item_id);
          if (at === -1) queueSelected.push(it.queue_item_id); else queueSelected.splice(at, 1);
          paintQueueSelection();
        };
        addLongPress(li, () => {
          if (queueSelectMode) return;
          queueSelectMode = true; queueSelected = [it.queue_item_id];
          paintQueueSelection();
        });
        li.addEventListener("click", (e) => { if (queueSelectMode) { e.stopImmediatePropagation(); pick(); } });

        if (i !== 0) {
          li.addEventListener("click", async () => {
            const trackName = it.title || "this track";
            // confirmDialog, not window.confirm: a native confirm can be left
            // open when the app is backgrounded and then resolves on reopen,
            // firing the request into a network stack that is still coming
            // back up. An in-page sheet cannot be resolved by backgrounding.
            if (!await confirmDialog(`Play from "${trackName}"?`)) return;
            const epochAtSend = hiddenEpoch;
            // "Now playing" moves to it at once (v0.8.35); the room's own queue is asked for after.
            const at = queueView ? queueView.items.indexOf(it) : -1;
            if (at > 0) renderQueue(playedFrom(queueView, at));
            try {
              const r = await fetch("/api/play-from-here", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  // Re-read at click time: the rows on screen belong to
                  // queueZoneId()'s queue, so the action must target that same
                  // zone, not the one captured when the screen opened.
                  zone_or_output_id: queueZoneId(),
                  queue_item_id: it.queue_item_id
                })
              });
              if (!r.ok) {
                const j = await r.json().catch(() => ({}));
                showToast("Couldn't play from here: " + (j.error || `HTTP ${r.status}`), "error");
                loadQueue();
                return;
              }
              // The room's own queue, now it has moved: the server answers once it has.
              loadQueue({ expectFirst: it.queue_item_id });
            } catch (e) {
              // Backgrounded mid-flight. iOS killed the connection and handed
              // us the rejection on reopen, so this is not a failure the user
              // caused or can act on — and Roon has almost certainly already
              // played the track. Re-pull the queue (the success path's own
              // follow-up never ran) and say nothing, rather than alerting
              // about a tap made minutes ago.
              if (hiddenEpoch !== epochAtSend) { loadQueue(); return; }
              showToast("Couldn't play from here: " + e.message, "error");
              loadQueue();
            }
          });
        }

        list.appendChild(li);
      }
      paintQueueSelection();
    } catch (e) {
      summary.textContent = "Couldn't show the queue: " + e.message;
    }
  }
  // The picks played now (moved to after the track playing and the first of
  // them played), played next (moved), or removed.
  async function runQueueAction(kind, items) {
    const picks = queueSelected.slice();
    if (!picks.length) return;
    const names = picks.map(id => { const it = items.find(x => x.queue_item_id === id); return it && it.title; }).filter(Boolean);
    const what = picks.length === 1 ? `"${names[0] || "this track"}"` : `${picks.length} tracks`;
    if (kind === "remove" && !await confirmDialog(`Remove ${what} from the queue?`)) return;
    try {
      const r = await fetch(kind === "remove" ? "/api/queue/remove" : "/api/queue/move", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone_or_output_id: queueZoneId(), queue_item_ids: picks, kind })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast((j.error || `HTTP ${r.status}`), "error"); return; }
      showToast(kind === "remove" ? `Removed ${what}` : kind === "play_now" ? `Playing ${what}` : `Playing ${what} next`);
      queueSelectMode = false; queueSelected = [];
      repaintQueueSelection();
      setTimeout(loadQueue, 600);
    } catch (e) {
      showToast("Couldn't reach the server", "error");
    }
  }
  async function clearQueueAll() {
    if (!await confirmDialog("Clear the queue? Playback stops.")) return;
    try {
      const r = await fetch("/api/queue/clear", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone_or_output_id: queueZoneId() })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast((j.error || `HTTP ${r.status}`), "error"); return; }
      showToast("Queue cleared");
      setTimeout(loadQueue, 600);
    } catch (e) {
      showToast("Couldn't reach the server", "error");
    }
  }
  function fmtDuration(secs) {
    secs = Math.max(0, Math.floor(secs || 0));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    return `${m}:${String(s).padStart(2,"0")}`;
  }

  function closeModal() {
    // Track selection belongs to the album that is closing. Leaving it set
    // would arm the next album's rows with someone else's picks.
    exitTrackSelectMode();
    modal.classList.add("hidden");
    modal.classList.remove("np-mode", "tab-album", "tab-queue");
    document.body.style.overflow = "";
    currentAlbum = null;
    window.__currentAlbum = null;
    try { sessionStorage.removeItem("rra-modal"); } catch (e) { /* sessionStorage optional */ }
    if (typeof window.__refreshTransport === "function") window.__refreshTransport();
  }
  modal.addEventListener("click", (e) => {
    if (!(e.target.closest && e.target.closest("[data-close]"))) return;
    // On Now playing a close — the backdrop round a reduced card, say — is the
    // same as its Back: it returns to the album it replaced, if there was one.
    if (modal.classList.contains("np-mode")) leaveNowPlaying();
    else closeModal();
  });

  // np-mode's top-left Back (v0.6.1; it was Home, which always went Home):
  // back to the screen before the mini player was tapped — the album that was
  // open, or the screen under the modal, which closing leaves exactly as it was.
  function leaveNowPlaying() {
    const back = npReturn;
    npReturn = null;
    closeModal();
    if (!back) return;
    // Reopened as if from its tile, so previous / next, the swipe and the
    // arrow keys still walk the list it came from.
    albumNav.pending = back.nav || null;
    try { openAlbum(back.album, back.opts); }
    finally { albumNav.pending = null; }
    // And scrolled back to where it was, once the track list is long enough
    // to hold that position again (it loads after the panel opens).
    const want = back.scrollTop || 0;
    if (want > 0) {
      const bodyEl = modal.querySelector(".modal-body");
      let tries = 0;
      const settle = () => {
        // Stop if the panel was closed or something else was opened meanwhile.
        if (!bodyEl || modal.classList.contains("hidden") || currentAlbum !== back.album) return;
        if (bodyEl.scrollHeight - bodyEl.clientHeight >= want) { bodyEl.scrollTop = want; return; }
        if (++tries < 20) setTimeout(settle, 100);
      };
      setTimeout(settle, 50);
    }
  }

  // THE PHONE'S BACK BUTTON (Android app): one step back, the way the page's
  // own buttons go — a dialog, a pop-up, the menu, the share sheet, the album
  // or Now playing, then from any wall to Home (which is how the Random row
  // turns over, as the PWA's Back does). Only on Home does the app leave.
  // Overlays that keep their own history (Qobuz, Tidal, Pitchfork…) are
  // stepped back through it. Returns true when it did something.
  const visibleEl = (sel) => { const el = document.querySelector(sel); return el && !el.classList.contains("hidden") ? el : null; };
  window.__pageBack = () => {
    const confirmOv = visibleEl("#confirm-overlay");
    if (confirmOv) { const no = document.getElementById("confirm-no"); if (no) no.click(); return true; }
    const st = history.state;
    if (st && typeof st === "object" && Object.keys(st).length) { history.back(); return true; }
    for (const sel of ["#mt-zone-popover", "#mt-vol-popover"]) {
      const pop = visibleEl(sel);
      if (pop) { pop.classList.add("hidden"); return true; }
    }
    const menu = visibleEl("#menu-overlay");
    if (menu) { const c = menu.querySelector("[data-menu-close]"); if (c) c.click(); else menu.classList.add("hidden"); return true; }
    const share = visibleEl("#share-overlay");
    if (share) { const c = share.querySelector("[data-share-close]"); if (c) c.click(); return true; }
    if (!modal.classList.contains("hidden")) {
      if (modal.classList.contains("np-mode")) leaveNowPlaying(); else closeModal();
      return true;
    }
    // The artist view: back to the album it was opened from (v0.6.0-RC11).
    if (window.__artistViewActive && window.__artistViewActive()) { window.__exitArtistView(); return true; }
    if ((homeView && homeView.classList.contains("hidden")) || !grid.classList.contains("hidden")) { showHome(); return true; }
    return false;
  };
  const modalHomeBtn = document.getElementById("modal-home-btn");
  if (modalHomeBtn) modalHomeBtn.addEventListener("click", leaveNowPlaying);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || modal.classList.contains("hidden")) return;
    if (modal.classList.contains("np-mode")) leaveNowPlaying();
    else closeModal();
  });

  // The album view's corner button names what it does at each size: a back
  // chevron while the album view fills the screen, an × from 720px up, where it
  // is a card over the page (the glyph swaps in CSS at the same width).
  // Now playing's corner button: on a desktop — a large screen driven by a
  // mouse — it CLOSES the screen (×), full size or reduced; on a phone or a
  // tablet it goes BACK (‹). The same tests as the CSS that swaps the glyphs,
  // and the same action either way.
  {
    const watch = (mq, fn) => {
      fn();
      if (!mq) return;
      if (mq.addEventListener) mq.addEventListener("change", fn);
      else if (mq.addListener) mq.addListener(fn);   // older Safari
    };
    const name = (btn, word) => { if (btn) { btn.setAttribute("aria-label", word); btn.title = word; } };
    const closeBtn = document.getElementById("modal-close-btn");
    const card = window.matchMedia ? window.matchMedia("(min-width: 720px)") : null;
    watch(card, () => name(closeBtn, card && card.matches ? "Close" : "Back"));
    const desktop = window.matchMedia
      ? window.matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)") : null;
    watch(desktop, () => name(modalHomeBtn, desktop && desktop.matches ? "Close" : "Back"));
  }

  // ---------------------------------------------------------------------------
  // NOW PLAYING, REDUCED (v0.6.1) — large screens only.
  //
  // On a big desktop the full-screen Now playing hides everything. Reduce size
  // turns it into a card the size of the album view's; the same button then
  // reads "Full size". The card is dragged by its top strip (not by its
  // buttons, its tabs or anything inside the body). The choice is remembered
  // on this device; the position is not — every opening starts centred.
  // ---------------------------------------------------------------------------
  {
    const sizeBtn = document.getElementById("modal-np-size-btn");
    const panel = modal.querySelector(".modal-panel");
    const SIZE_KEY = "rra-np-reduced";
    const large = window.matchMedia ? window.matchMedia("(min-width: 1200px) and (min-height: 700px)") : null;
    let reduced = false;
    try { reduced = localStorage.getItem(SIZE_KEY) === "1"; }
    catch (e) { /* storage blocked — full size, the default */ }
    let dx = 0, dy = 0;

    const place = () => { if (panel) panel.style.transform = (dx || dy) ? "translate(" + dx + "px," + dy + "px)" : ""; };
    function paintSize() {
      const on = reduced && !!(large && large.matches) && modal.classList.contains("np-mode");
      if (modal.classList.contains("np-reduced") !== on) modal.classList.toggle("np-reduced", on);
      if (!on) { dx = 0; dy = 0; place(); }
      if (sizeBtn) {
        sizeBtn.setAttribute("aria-pressed", on ? "true" : "false");
        sizeBtn.setAttribute("aria-label", on ? "Full size" : "Reduce size");
        sizeBtn.title = on ? "Full size" : "Reduce size";
      }
    }
    if (sizeBtn) sizeBtn.addEventListener("click", () => {
      reduced = !modal.classList.contains("np-reduced");
      try { localStorage.setItem(SIZE_KEY, reduced ? "1" : "0"); }
      catch (e) { /* storage blocked — it still applies for this visit */ }
      dx = 0; dy = 0;
      paintSize();
    });
    if (large) {
      if (large.addEventListener) large.addEventListener("change", paintSize);
      else if (large.addListener) large.addListener(paintSize);
    }
    // Opening and closing come and go through the classes on the modal, so the
    // state follows them: a fresh opening is centred.
    // Every write below is guarded by a check that it CHANGES something:
    // classList.remove() rewrites the class attribute even when the token is
    // absent, and that write would wake this observer again, for ever.
    new MutationObserver(() => {
      if (modal.classList.contains("hidden") || !modal.classList.contains("np-mode")) {
        if (modal.classList.contains("np-reduced")) modal.classList.remove("np-reduced");
        if (dx || dy) { dx = 0; dy = 0; place(); }
        if (sizeBtn && sizeBtn.getAttribute("aria-pressed") !== "false") paintSize();
      } else if (reduced && !modal.classList.contains("np-reduced") && large && large.matches) {
        paintSize();
      }
    }).observe(modal, { attributes: true, attributeFilter: ["class"] });

    // Drag by the top strip: a press on the panel above its body's content —
    // never on a button, a tab or anything that is itself interactive.
    const STRIP = 56;
    let drag = null;
    if (panel) panel.addEventListener("pointerdown", (e) => {
      if (!modal.classList.contains("np-reduced") || e.button !== 0) return;
      if (e.target.closest("button, a, input, select, .modal-tabs, [role='button']")) return;
      const box = panel.getBoundingClientRect();
      if (e.clientY - box.top > STRIP) return;
      drag = { id: e.pointerId, x: e.clientX - dx, y: e.clientY - dy,
               baseLeft: box.left - dx, baseTop: box.top - dy, w: box.width, h: box.height };
      panel.classList.add("is-dragging");
      try { panel.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety; the move handler still works */ }
      e.preventDefault();
    });
    if (panel) panel.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      // Kept wholly on screen, so its corner buttons can never be dragged out
      // of reach.
      const minX = -drag.baseLeft, maxX = Math.max(minX, window.innerWidth - drag.baseLeft - drag.w);
      const minY = -drag.baseTop,  maxY = Math.max(minY, window.innerHeight - drag.baseTop - drag.h);
      dx = Math.max(minX, Math.min(maxX, e.clientX - drag.x));
      dy = Math.max(minY, Math.min(maxY, e.clientY - drag.y));
      place();
    });
    const endDrag = (e) => {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      drag = null;
      if (panel) panel.classList.remove("is-dragging");
    };
    if (panel) {
      panel.addEventListener("pointerup", endDrag);
      panel.addEventListener("pointercancel", endDrag);
    }
    paintSize();
  }

  // ---- Edit album ---------------------------------------------------------
  // Title, artist and year corrections plus a cover for an album without one.
  // Nothing is written to the music (it's mounted read-only): the server keeps
  // the edits in its database and lays them over the scan. An album with no
  // cover of its own is searched for straight away; a sure match (same tracks,
  // artist and title) is picked for you, anything less is offered to choose
  // from, with a box for pasting an image address found elsewhere.
  const aeEl = document.getElementById("album-edit-overlay");
  const ae = aeEl && {
    img: document.getElementById("ae-cover-img"),
    status: document.getElementById("ae-cover-status"),
    find: document.getElementById("ae-find"),
    remove: document.getElementById("ae-art-remove"),
    undo: document.getElementById("ae-art-undo"),
    search: document.getElementById("ae-search"),
    sStatus: document.getElementById("ae-search-status"),
    cands: document.getElementById("ae-candidates"),
    url: document.getElementById("ae-url"),
    urlUse: document.getElementById("ae-url-use"),
    urlErr: document.getElementById("ae-url-err"),
    title: document.getElementById("ae-title"),
    artist: document.getElementById("ae-artist"),
    year: document.getElementById("ae-year"),
    err: document.getElementById("ae-err"),
    save: document.getElementById("ae-save"),
    reset: document.getElementById("ae-reset"),
    mStatus: document.getElementById("ae-match-status"),
    mFind: document.getElementById("ae-match-find"),
    folder: document.getElementById("ae-folder"),
    mBox: document.getElementById("ae-match"),
    mSearchStatus: document.getElementById("ae-match-search-status"),
    mCands: document.getElementById("ae-match-cands"),
    barcode: document.getElementById("ae-barcode"),
    barcodeUse: document.getElementById("ae-barcode-use"),
    barcodeErr: document.getElementById("ae-barcode-err")
  };
  let aeState = null;   // { album, data, pick: {url, source, label} | "remove" | null, searchSeq }

  // Every picture on screen that still shows an album's old cover address
  // takes the new one — tiles in other rows included.
  function swapAlbumArt(oldKey, newKey) {
    if (!oldKey || !newKey || oldKey === newKey) return;
    const from = encodeURIComponent(oldKey), to = encodeURIComponent(newKey);
    document.querySelectorAll("img").forEach(im => {
      const src = im.getAttribute("src") || "";
      if (src.indexOf(from) >= 0) im.src = src.replace(from, to);
    });
  }

  function aeImageSrc(key, size) { return `/api/image/${encodeURIComponent(key)}?size=${size || 300}`; }

  function aeCoverStatus() {
    const d = aeState.data, pick = aeState.pick;
    ae.undo.classList.toggle("hidden", !pick);
    ae.remove.classList.toggle("hidden", !(d.art.found && !pick));
    if (pick === "remove") {
      ae.img.src = aeImageSrc(d.image_key, 300);
      ae.status.innerHTML = "The found cover will be removed when you save.";
      return;
    }
    if (pick) {
      ae.img.src = pick.thumb || pick.url;
      ae.status.innerHTML = `<strong>New cover</strong> from ${escapeHtml(pick.source)} — save to use it.`;
      return;
    }
    ae.img.src = aeImageSrc(d.image_key, 300);
    if (d.art.found) ae.status.innerHTML = `<strong>Found cover</strong>${d.art.source && !/^https?:/.test(d.art.source) ? " from " + escapeHtml(d.art.source) : ""}.`;
    else if (d.art.own) ae.status.textContent = "Cover from the album's files.";
    else ae.status.innerHTML = "<strong>No cover.</strong> This album's folder and tracks have no artwork.";
  }

  function aeWas(field) {
    const box = aeEl.querySelector(`[data-ae-was="${field}"]`);
    const d = aeState.data;
    const scanned = d.scanned[field] == null ? "" : String(d.scanned[field]);
    const now = ae[field].value.trim();
    box.innerHTML = "";
    if (now === scanned) return;
    box.appendChild(document.createTextNode(`From the files: ${scanned || "(none)"} · `));
    const b = document.createElement("button");
    b.type = "button"; b.textContent = "Put back";
    b.addEventListener("click", () => { ae[field].value = scanned; aeWas(field); });
    box.appendChild(b);
  }

  function aePick(c, el) {
    aeState.pick = c;
    ae.cands.querySelectorAll(".ae-cand").forEach(x => x.classList.toggle("is-picked", x === el));
    aeCoverStatus();
  }

  function aeMatchLine(c) {
    const m = c.match || {};
    if (m.tracks != null) {
      return m.tracks >= 0.999 ? "All tracks match" : `${Math.round(m.tracks * 100)}% tracks match`;
    }
    return [c.year, c.tracks ? c.tracks + " tracks" : ""].filter(Boolean).join(" · ");
  }

  function aeRenderCandidates(list, sure) {
    ae.cands.innerHTML = "";
    for (const c of list) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "ae-cand";
      b.title = `${c.title} — ${c.artist} (${c.source})`;
      const box = document.createElement("div"); box.className = "ae-cand-img";
      const im = document.createElement("img"); im.loading = "lazy"; im.alt = ""; im.src = c.thumb || c.url;
      // A dead image (the archive sometimes has none after all) drops out.
      im.addEventListener("error", () => b.remove());
      box.appendChild(im);
      if (sure && c === sure) { const t = document.createElement("span"); t.className = "ae-cand-best"; t.textContent = "Match"; box.appendChild(t); }
      const t1 = document.createElement("div"); t1.className = "ae-cand-t"; t1.textContent = c.title || "—";
      const t2 = document.createElement("div"); t2.className = "ae-cand-s"; t2.textContent = c.source;
      const t3 = document.createElement("div"); t3.className = "ae-cand-s"; t3.textContent = aeMatchLine(c);
      b.append(box, t1, t2, t3);
      b.addEventListener("click", () => aePick(c, b));
      ae.cands.appendChild(b);
      if (sure && c === sure) aePick(c, b);
    }
  }

  async function aeSearch(auto) {
    const seq = aeState.searchSeq = (aeState.searchSeq || 0) + 1;
    ae.search.classList.remove("hidden");
    ae.cands.innerHTML = "";
    ae.sStatus.textContent = "Searching Apple Music, Deezer and MusicBrainz…";
    ae.find.disabled = true;
    try {
      const r = await fetch(`/api/album/art-search?offset=${aeState.album.offset}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (!aeState || seq !== aeState.searchSeq) return;
      const list = j.candidates || [];
      if (j.sure) {
        ae.sStatus.innerHTML = `<strong>Found it</strong> on ${escapeHtml(j.sure.source)} — same tracks, artist and title. Save to use it, or pick another.`;
      } else if (list.length) {
        ae.sStatus.innerHTML = "<strong>Not sure which one is right.</strong> Pick the cover that matches, or paste an image address below.";
      } else {
        ae.sStatus.innerHTML = "<strong>Nothing found.</strong> Paste an image address below — from a record shop, Discogs or a search engine (copy image address).";
      }
      aeRenderCandidates(list, j.sure || null);
    } catch (e) {
      if (!aeState || seq !== aeState.searchSeq) return;
      ae.sStatus.textContent = `The search didn't work (${e.message}). You can still paste an image address below.`;
    } finally {
      if (aeState && seq === aeState.searchSeq) ae.find.disabled = false;
    }
  }

  // ---- names from MusicBrainz (the identification scan, by hand) ----------
  // Find match lists the releases the scan would weigh, best first, to tap;
  // the box under them takes a barcode or a MusicBrainz link for an exact
  // match. Either is applied at once — artist, title, year, track titles —
  // and the page behind follows; Undo is on the Identify albums page.
  function aeMatchLineFor(c) {
    const bits = [];
    if (c.source === "itunes") bits.push("iTunes");
    if (c.year) bits.push(String(c.year));
    if (c.release_year && c.year && c.release_year !== c.year) bits.push("this pressing " + c.release_year);
    if (c.edition) bits.push(c.edition);
    if (c.country) bits.push(c.country);
    if (c.track_count) bits.push(c.track_count + " tracks");
    if (c.missing_tracks) bits.push(c.missing_tracks + " missing here");
    if (c.extra_tracks) bits.push(c.extra_tracks + " not on it");
    return bits.join(" · ");
  }

  function aeRenderMatches(list, verdict) {
    ae.mCands.innerHTML = "";
    list.forEach((c, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "ae-mcand";
      const top = document.createElement("div"); top.className = "ae-mcand-top";
      const t1 = document.createElement("span"); t1.className = "ae-mcand-t"; t1.textContent = (c.artist ? c.artist + " — " : "") + (c.title || "—");
      const pc = document.createElement("span"); pc.className = "ae-mcand-pc" + (c.similarity >= 96 ? " is-sure" : ""); pc.textContent = c.similarity + " %";
      top.append(t1, pc);
      const t2 = document.createElement("div"); t2.className = "ae-cand-s"; t2.textContent = aeMatchLineFor(c);
      b.append(top, t2);
      if (i === 0 && (verdict === "applied" || verdict === "proposed")) { const m = document.createElement("span"); m.className = "ae-cand-best ae-mcand-best"; m.textContent = verdict === "applied" ? "Match" : "Likely"; top.prepend(m); }
      b.addEventListener("click", () => aeMatch(c.mbid, "pick", b));
      ae.mCands.appendChild(b);
    });
  }

  async function aeFindMatch() {
    if (!aeState || !aeState.data) return;
    const mine = aeState;
    const seq = mine.matchSeq = (mine.matchSeq || 0) + 1;
    ae.mBox.classList.remove("hidden");
    ae.mCands.innerHTML = "";
    ae.barcodeErr.textContent = "";
    ae.mSearchStatus.textContent = "Asking MusicBrainz… (a few seconds: one request a second)";
    ae.mFind.disabled = true;
    try {
      const r = await fetch(`/api/identify/candidates?offset=${mine.album.offset}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (aeState !== mine || seq !== mine.matchSeq) return;
      const list = j.candidates || [];
      if (!list.length) ae.mSearchStatus.innerHTML = "<strong>Nothing with this title on MusicBrainz.</strong> Try the barcode below, or a link to the release.";
      else if (j.verdict === "applied") ae.mSearchStatus.innerHTML = "<strong>This is it</strong> — the same tracks and lengths. Tap to apply, or choose another.";
      else if (j.verdict === "proposed") ae.mSearchStatus.innerHTML = "<strong>Close</strong>" + (j.ambiguous ? ", but two releases fit" : "") + ". Tap the right one to apply.";
      else ae.mSearchStatus.innerHTML = "<strong>Not sure which.</strong> Tap one to apply it, or use the barcode below.";
      aeRenderMatches(list, j.verdict);
    } catch (e) {
      if (aeState !== mine || seq !== mine.matchSeq) return;
      ae.mSearchStatus.textContent = `The search didn't work (${e.message}). You can still enter a barcode below.`;
    } finally {
      if (aeState === mine && seq === mine.matchSeq) ae.mFind.disabled = false;
    }
  }

  async function aeMatch(query, how, btn) {
    if (!aeState || !aeState.data) return;
    const mine = aeState;
    ae.barcodeErr.textContent = ""; ae.err.textContent = "";
    const orig = btn && btn.textContent;
    if (btn) { btn.disabled = true; if (btn === ae.barcodeUse) btn.textContent = "Matching…"; }
    ae.mCands.querySelectorAll(".ae-mcand").forEach(x => { x.disabled = true; });
    try {
      const r = await fetch("/api/identify/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offset: mine.album.offset, query, how }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (aeState !== mine) return;
      // The editor and the page behind take the new names.
      const r2 = await fetch(`/api/album/edit?offset=${mine.album.offset}`);
      const d = await r2.json().catch(() => ({}));
      if (aeState !== mine) return;
      if (r2.ok) {
        mine.data = d;
        ae.title.value = d.title || ""; ae.artist.value = d.artist || ""; ae.year.value = d.year || "";
        ["title", "artist", "year"].forEach(aeWas);
        ae.reset.classList.toggle("hidden", !d.edited);
        aeApplyToScreen(Object.assign({}, d, { album: { year: d.year } }));
        if (mine.album === currentAlbum) fetchAlbumDetail(currentAlbum).catch(() => {});
      }
      const done = (j.applied || []).find(x => x.album && x.album.offset === mine.album.offset);
      const c = done && done.candidate;
      ae.mStatus.innerHTML = c ? `<strong>Matched:</strong> ${escapeHtml((c.artist ? c.artist + " — " : "") + c.title)}${c.year ? " (" + c.year + ")" : ""}. Undo is under Settings → Library Scanner.` : "<strong>Matched.</strong>";
      ae.mCands.querySelectorAll(".ae-mcand").forEach(x => x.classList.toggle("is-picked", x === btn));
      showToast("Matched — names applied");
    } catch (e) {
      if (aeState !== mine) return;
      (how === "pick" ? ae.err : ae.barcodeErr).textContent = e.message;
    } finally {
      if (aeState === mine) {
        if (btn) { btn.disabled = false; if (orig && btn === ae.barcodeUse) btn.textContent = orig; }
        ae.mCands.querySelectorAll(".ae-mcand").forEach(x => { x.disabled = false; });
      }
    }
  }

  function aeClose() {
    if (!aeEl) return;
    aeEl.classList.add("hidden");
    aeState = null;
  }

  async function openAlbumEditor(album) {
    if (!aeEl || !album) return;
    aeState = { album, data: null, pick: null };
    const mine = aeState;
    ae.err.textContent = ""; ae.urlErr.textContent = ""; ae.url.value = "";
    ae.search.classList.add("hidden"); ae.cands.innerHTML = "";
    if (ae.mBox) {
      ae.mBox.classList.add("hidden"); ae.mCands.innerHTML = ""; ae.barcode.value = ""; ae.barcodeErr.textContent = "";
      ae.mStatus.textContent = "Names from MusicBrainz — artist, title, year and every track.";
      ae.mFind.disabled = false;
    }
    ae.title.value = album.title || ""; ae.artist.value = album.subtitle || ""; ae.year.value = "";
    if (ae.folder) { ae.folder.classList.add("hidden"); ae.folder.textContent = ""; }
    ae.status.textContent = "Loading…";
    ae.img.removeAttribute("src");
    ae.save.disabled = true;
    aeEl.querySelectorAll(".ae-was").forEach(x => { x.innerHTML = ""; });
    aeEl.classList.remove("hidden");
    try {
      const r = await fetch(`/api/album/edit?offset=${album.offset}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (aeState !== mine) return;
      mine.data = d;
      // The album's folder (v0.6.3), for telling a remix or a box set apart
      // when matching by hand.
      if (ae.folder && d.folder) {
        ae.folder.innerHTML = '<span class="ae-folder-label">Folder</span>';
        ae.folder.appendChild(document.createTextNode(d.folder));
        // Part of a box set (v0.6.3): said here too, for choosing the release.
        if (d.box) {
          const b = document.createElement("span");
          b.className = "ae-folder-box";
          b.textContent = "From " + d.box.name + " · disc " + d.box.disc + " of " + d.box.of;
          ae.folder.appendChild(b);
        }
        ae.folder.classList.remove("hidden");
      }
      ae.title.value = d.title || ""; ae.artist.value = d.artist || ""; ae.year.value = d.year || "";
      ["title", "artist", "year"].forEach(aeWas);
      ae.reset.classList.toggle("hidden", !d.edited);
      ae.save.disabled = false;
      aeCoverStatus();
      // Auto first: an album with no cover at all is searched for at once.
      if (!d.art.own) aeSearch(true);
    } catch (e) {
      if (aeState === mine) ae.err.textContent = e.message;
    }
  }

  function aeApplyToScreen(d) {
    const album = aeState && aeState.album;
    if (!album) return;
    const oldKey = album.image_key;
    album.title = d.title; album.subtitle = d.artist; album.image_key = d.image_key;
    if (d.album && d.album.year) album.year = d.album.year;
    // Tiles already on screen for this album take the new cover.
    swapAlbumArt(oldKey, d.image_key);
    if (album === currentAlbum) {
      modalTitle.textContent = d.title || "Untitled";
      setModalArtist(d.artist);
      modalImg.src = aeImageSrc(d.image_key, 800);
      modalImg.style.display = "";
      setModalAmbient(modalImg.src);
      try {
        sessionStorage.setItem("rra-modal", JSON.stringify({ album, source: currentSource, zoneId: currentSourceZoneId, filter: currentDetailFilter }));
      } catch (e) { /* ignore */ }
      fetchAlbumExtras(album).catch(() => {});
    }
  }

  async function aePost(path, body, btn) {
    ae.err.textContent = "";
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      aeApplyToScreen(j);
      aeClose();
      showToast("Album saved");
    } catch (e) {
      ae.err.textContent = e.message;
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  }

  if (aeEl) {
    aeEl.querySelectorAll("[data-ae-close]").forEach(b => b.addEventListener("click", aeClose));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && aeState) aeClose(); });
    ["title", "artist", "year"].forEach(f => ae[f].addEventListener("input", () => { if (aeState && aeState.data) aeWas(f); }));
    ae.find.addEventListener("click", () => { if (aeState && aeState.data) aeSearch(false); });
    ae.remove.addEventListener("click", () => { if (aeState) { aeState.pick = "remove"; aeCoverStatus(); } });
    ae.undo.addEventListener("click", () => {
      if (!aeState) return;
      aeState.pick = null;
      ae.cands.querySelectorAll(".ae-cand").forEach(x => x.classList.remove("is-picked"));
      aeCoverStatus();
    });
    const useUrl = () => {
      if (!aeState) return;
      const u = ae.url.value.trim();
      ae.urlErr.textContent = "";
      if (!/^https?:\/\/\S+$/i.test(u)) { ae.urlErr.textContent = "That doesn't look like a web address (it should start with http)."; return; }
      // Previewed in the page first; the server downloads and checks it on Save.
      const probe = new Image();
      probe.onload = () => { if (aeState) { ae.cands.querySelectorAll(".ae-cand").forEach(x => x.classList.remove("is-picked")); aeState.pick = { url: u, thumb: u, source: "a pasted address" }; aeCoverStatus(); } };
      probe.onerror = () => { ae.urlErr.textContent = "No picture loaded from that address. Make sure it's the image itself (“Copy image address”), not the page it's on."; };
      probe.src = u;
    };
    ae.urlUse.addEventListener("click", useUrl);
    ae.url.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); useUrl(); } });
    if (ae.mFind) {
      ae.mFind.addEventListener("click", aeFindMatch);
      const useBarcode = () => {
        const q = ae.barcode.value.trim();
        if (!q) { ae.barcodeErr.textContent = "Type the digits under the bars, or paste a musicbrainz.org release link."; return; }
        aeMatch(q, "barcode", ae.barcodeUse);
      };
      ae.barcodeUse.addEventListener("click", useBarcode);
      ae.barcode.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); useBarcode(); } });
    }
    ae.save.addEventListener("click", () => {
      if (!aeState || !aeState.data) return;
      const y = ae.year.value.trim();
      if (y && !/^\d{4}$/.test(y)) { ae.err.textContent = "The year should be four digits, like 2002."; return; }
      const body = { offset: aeState.album.offset, title: ae.title.value, artist: ae.artist.value, year: y };
      const pick = aeState.pick;
      if (pick === "remove") body.art = "remove";
      else if (pick) { body.art_url = pick.url; body.art_source = pick.source === "a pasted address" ? pick.url : pick.source; }
      aePost("/api/album/edit", body, ae.save);
    });
    ae.reset.addEventListener("click", () => {
      if (!aeState) return;
      aePost("/api/album/edit/reset", { offset: aeState.album.offset }, ae.reset);
    });
  }

  // Listen later: put the album aside, or take it off the list.
  function laterMenuItem(album, page) {
    if (!album || typeof album.offset !== "number") return [];
    const on = !!((page && page.album && page.album.later) || album.later);
    return [{ label: on ? "Remove from Listen later" : "Listen later", onClick: async () => { if (await setListenLater(album.offset, !on)) album.later = !on; } }];
  }

  // Add to playlist (v0.8.34): the whole album, into one of your playlists or a
  // new one, through the same sheet as a selection of albums.
  function playlistMenuItem(album) {
    if (!album || typeof album.offset !== "number") return [];
    return [{ label: "Add to playlist", onClick: () => openAddToPlaylistSheet(null, [{
      offset: album.offset, title: album.title || "", subtitle: album.subtitle || "", image_key: album.image_key || null
    }]) }];
  }

  // Inside the Android app only (its MusicdDownloads bridge): keep this album
  // on the phone, or take it off. Browsers and the iPhone app never see it.
  function downloadMenuItem(album) {
    const dl = window.MusicdDownloads;
    if (!dl || !album || typeof album.offset !== "number") return [];
    // A streamed album (Qobuz, Tidal) is never kept on the phone (v0.6.23).
    if (album.source && album.source !== "local") return [];
    let st = {};
    try { st = JSON.parse(dl.status(album.offset)) || {}; } catch (e) { /* treat as not downloaded */ }
    if (st.state === "done") return [{ label: "Remove from this phone", onClick: () => dl.remove(album.offset) }];
    if (st.state === "downloading" || st.state === "queued" || st.state === "waiting") {
      return [{ label: `Downloading… ${st.done || 0}/${st.total || "?"}`, onClick: () => dl.open() }];
    }
    if (isPhoneAlbum(album)) return [];
    return [{ label: "Download to this phone", onClick: () => dl.download(album.offset, album.title || "", album.subtitle || "") }];
  }

  async function fetchAlbumDetail(album) {
    // Send the album's identity so the server can detect a stale offset
    // (library changed since the tile rendered) and relocate — or 409 —
    // instead of returning whatever album now sits at that position.
    const idQS = `&title=${encodeURIComponent(album.title || "")}` +
                 `&subtitle=${encodeURIComponent(album.subtitle || "")}`;
    const r = await fetch(`/api/album?offset=${album.offset}${idQS}${filterQSOf(currentDetailFilter)}`);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { gone: r.status === 409 });
    }
    const j = await r.json();

    // Modal may have been closed/reopened on a different album while we
    // waited — bail rather than render album A's rows (whose tap handlers
    // would fire against album B's offset). Same guard as fetchAlbumExtras.
    if (album !== currentAlbum) return;

    // The server corrects the offset when the stale-offset defense relocated
    // the album — adopt it so Play/Queue and per-track actions use the fresh
    // position instead of re-tripping the same relocation on every call.
    if (typeof j.offset === "number" && j.offset >= 0) album.offset = j.offset;
    // Its booklets, by that id (v0.8.33): the book on the cover when it has any.
    loadBooklets(album);

    // The offset is the album's permanent id on this server, so what comes
    // back IS this album — and its title, artist, year and cover are the
    // current ones. The tile that opened the page may have been drawn before
    // an edit (another row, a screen loaded earlier, a page restored after an
    // update); take the server's word and bring the page up to date, rather
    // than keeping the old names on screen.
    if (j.album && j.album.title) {
      modalTitle.textContent = j.album.title;
      const stale = album.title !== j.album.title || album.subtitle !== j.album.subtitle ||
                    (j.album.image_key && album.image_key !== j.album.image_key) ||
                    (j.album.year && album.year !== j.album.year);
      if (stale) {
        album.title = j.album.title;
        album.subtitle = j.album.subtitle;
        if (j.album.year) album.year = j.album.year;
        if (j.album.image_key && album.image_key !== j.album.image_key) {
          swapAlbumArt(album.image_key, j.album.image_key);
          album.image_key = j.album.image_key;
          modalImg.src = `/api/image/${encodeURIComponent(album.image_key)}?size=800`;
          modalImg.style.display = "";
          setModalAmbient(modalImg.src);
        }
        if (!(Array.isArray(j.artists) && j.artists.length)) setModalArtist(album.subtitle);
        try {
          sessionStorage.setItem("rra-modal", JSON.stringify({ album, source: currentSource, zoneId: currentSourceZoneId, filter: currentDetailFilter }));
        } catch (e) { /* ignore */ }
        // The write-ups/year were asked for under the old names: ask again.
        fetchAlbumExtras(album).catch(() => {});
      }
    }
    // Re-render the artist line with the server's library-validated split so
    // each collaborator becomes their own link (openAlbum rendered the
    // conservative client split as a placeholder).
    if (Array.isArray(j.artists) && j.artists.length) {
      setModalArtist((j.album && j.album.subtitle) || album.subtitle || "", j.artists);
    }
    // Below the review: more by the album's lead artist (the name its first
    // artist link shows), what they appear on, and Last.fm's suggestions.
    fetchAlbumMore(album, (Array.isArray(j.artists) && j.artists[0]) || album.subtitle || "")
      .catch(() => { /* extras: the album page stands without them */ });
    // Named from its folders, its files carrying no tags (v0.6.0-RC10): said
    // under the names, so they read as the best guess they are.
    {
      let note = document.getElementById("modal-names-note");
      if (j.names_from_folders) {
        if (!note && modalSub && modalSub.parentNode) {
          note = document.createElement("div");
          note.id = "modal-names-note";
          note.className = "modal-names-note";
          modalSub.parentNode.insertBefore(note, modalSub.nextSibling);
        }
        if (note) note.textContent = "Names from its folders — the files carry no tags";
      } else if (note) note.remove();
    }
    // A streamed album, signed in (v0.7.3): why it is in the library — a
    // favourite or a purchase on the service, and since when; held by a
    // playlist or favourite track; or only played — and, for one not out
    // yet, its release date. So an album that appeared unasked explains
    // itself on its page.
    {
      let why = document.getElementById("modal-why-note");
      const w = j.album && j.album.service_why;
      if (w && modalSub && modalSub.parentNode) {
        if (!why) {
          why = document.createElement("div");
          why.id = "modal-why-note";
          why.className = "modal-names-note";
        }
        const anchor = document.getElementById("modal-names-note") || modalSub;
        anchor.parentNode.insertBefore(why, anchor.nextSibling);
        const when = w.since ? " since " + new Date(w.since).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
        let text = w.kept === "purchase" ? "In your library as a " + w.name + " purchase" + when
          : w.kept ? "In your library as a " + w.name + " favourite" + when
          : w.held ? "Here for a " + w.name + " playlist or favourite track — not in your favourites"
          : "Played from " + w.name + " — not in your favourites";
        if (w.releases) text += " · not out until " + formatReleaseDate(w.releases);
        why.textContent = text;
      } else if (why) why.remove();
    }

    // A disc of a box set filed as albums of their own (v0.6.3): which box,
    // which disc, and the other discs a tap away — stepping through the box
    // with previous / next once one is opened from here.
    {
      let box = document.getElementById("modal-box-note");
      const b = j.album && j.album.box;
      if (b && modalSub && modalSub.parentNode) {
        if (!box) {
          box = document.createElement("div");
          box.id = "modal-box-note";
          box.className = "modal-box-note";
        }
        const anchor = document.getElementById("modal-names-note") || modalSub;
        anchor.parentNode.insertBefore(box, anchor.nextSibling);
        box.innerHTML = "";
        const line = document.createElement("div");
        line.textContent = "From " + b.name + " · disc " + b.disc + " of " + b.of;
        box.appendChild(line);
        const all = [Object.assign({}, album, { disc: b.disc })].concat(j.box_albums || []).sort((x, y) => (x.disc || 0) - (y.disc || 0));
        const others = document.createElement("div");
        others.className = "modal-box-discs";
        all.forEach((x, i) => {
          if (x.offset === album.offset) return;
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "modal-box-disc";
          btn.textContent = "Disc " + x.disc + " · " + x.title;
          btn.addEventListener("click", () => {
            albumNav.pending = { items: all.map(a => ({ album: a, open: () => openAlbum(a, { source: "home", filter: null }) })), index: i };
            openAlbum(x, { source: "home", filter: null });
          });
          others.appendChild(btn);
        });
        box.appendChild(others);
      } else if (box) box.remove();
    }

    // Build action buttons in preferred order
    const order  = ["play_now", "queue", "play_next", "shuffle", "radio"];
    const labels = {
      play_now:  "Play Now",
      queue:     "Queue",
      play_next: "Play Next",
      shuffle:   "Shuffle",
      radio:     "Radio"
    };
    const map = new Map();
    for (const a of (j.actions || [])) {
      if (!map.has(a.kind)) map.set(a.kind, a);
    }

    // Play Now and Queue stay on the row; Next / Shuffle / Radio go behind the
    // overflow menu. Five pills hit the same wall the playlist screens did —
    // .action-btn is `flex: 1 1 0`, so they shrink together instead of
    // wrapping, and on a phone the labels start clipping.
    const ROW_ACTIONS = 2;
    modalActs.innerHTML = "";
    // The heart, first: the same size as the ⋯ button at the other end.
    modalActs.appendChild(buildFavButton(album, j.album));
    const available = order.filter(k => map.has(k));
    let first = true;
    for (const k of available.slice(0, ROW_ACTIONS)) {
      const btn = document.createElement("button");
      btn.className = "action-btn" + (first ? " primary" : "");
      btn.type = "button";
      btn.textContent = labels[k];
      btn.addEventListener("click", () => invoke(k, btn));
      modalActs.appendChild(btn);
      first = false;
    }
    const overflow = available.slice(ROW_ACTIONS);
    if (overflow.length) {
      const more = buildOverflowMenu(
        overflow.map(k => ({ label: labels[k], onClick: (b) => invoke(k, b) }))
          .concat(serviceMenuItem(j))
          .concat(laterMenuItem(album, j))
          .concat(playlistMenuItem(album))
          .concat(album.source && album.source !== "local" ? [] : [{ label: "Edit album", onClick: () => openAlbumEditor(album) }])
          .concat(downloadMenuItem(album)),
        { label: "More actions" });
      modalActs.appendChild(more);
    }
    fitAlbumMenuRoom();
    if (!available.length) {
      // "No playback actions available" was true and useless — it described
      // our own empty array rather than anything the user could act on. When
      // Roon's live album count no longer matches the snapshot we can say why,
      // and that a re-check is already running.
      modalActs.innerHTML = "";
      const err = document.createElement("div");
      err.className = "modal-error";
      // BOTH branches explain themselves now. The second one — the plain
      // sentence with no explanation at all — is the red line users actually
      // reported, and it was composed here in the client, so the server-side
      // builder never touched it.
      err.textContent = "No playback options for this album." +
                        libraryChangingAdvice(!!j.library_moved);
      modalActs.appendChild(err);
    }

    // Tracks — each row is tappable and reveals Play now / Queue for that
    // track (one open row at a time; tapping again collapses it).
    const trackWrap = document.querySelector(".track-list-wrap");
    modalTracks.innerHTML = "";
    const trackList = j.tracks || [];
    // The album's total time (v0.7.10), beside the Tracks heading.
    const totalEl = document.getElementById("modal-total");
    if (totalEl) {
      const secs = trackList.reduce((s, t) => s + (Number(t.length) || 0), 0);
      totalEl.textContent = secs > 0 ? fmtTotal(secs) : "";
    }
    // A thin or empty answer is now distinguishable from an album that really
    // has no tracks: Roon declares how many rows the level holds, so we know
    // when it sent fewer. Previously the whole section was hidden and an album
    // mid-reindex looked identical to one with nothing on it.
    if (j.partial) {
      const note = document.createElement("div");
      note.className = "modal-error";
      note.textContent = (j.declared_tracks
        ? "Only " + trackList.length + " of " + j.declared_tracks + " tracks were readable."
        : "Some tracks couldn't be read.") +
        libraryChangingAdvice(!!j.library_moved);
      modalActs.appendChild(note);
    }
    if (trackList.length === 0) {
      if (!j.partial && j.library_moved) {
        const note = document.createElement("div");
        note.className = "modal-error";
        note.textContent = "No playable tracks were found for this album." +
                           libraryChangingAdvice(!!j.library_moved);
        modalActs.appendChild(note);
      }
      trackWrap.classList.add("hidden");
    } else {
      trackWrap.classList.remove("hidden");
      trackList.forEach((t, idx) => {
        const li = document.createElement("li");
        li.className = "t-row"; li.dataset.trackId = t.track_id == null ? "" : String(t.track_id);   // nowdisc.js finds the playing track by it
        // Same two-line .t-text structure as the cached render above — the
        // .t-actions row stays a SIBLING of .t-text so the is-open flex-wrap
        // still drops it onto its own full-width line.
        const tx = document.createElement("div"); tx.className = "t-text";
        const ti = document.createElement("span"); ti.className = "t-title";
        ti.textContent = t.title || "";
        const su = document.createElement("span"); su.className = "t-sub";
        const [subText, len] = splitTrackLength(t.subtitle);
        su.textContent = subText;
        tx.appendChild(ti); tx.appendChild(su);
        li.appendChild(tx);
        // The track's length on the right, level with the title.
        if (len) { const ln = document.createElement("span"); ln.className = "t-len"; ln.textContent = len; li.appendChild(ln); }

        // The select target, on the right. Present from the start but hidden
        // until select mode is armed, so arming it doesn't reflow every row.
        // A real element rather than a ::after: .album-art-wrap's ♪ placeholder
        // already taught us what happens when two states share one pseudo.
        // It stays a sibling BEFORE .t-actions so is-open's flex-wrap still
        // drops the action row onto its own full-width line beneath it.
        const mark = document.createElement("button");
        mark.type = "button";
        mark.className = "t-mark";
        mark.setAttribute("aria-label", "Select this track");
        mark.setAttribute("aria-pressed", "false");
        mark.addEventListener("click", (e) => {
          // Selecting must never also expand or collapse the row's actions.
          e.stopPropagation();
          toggleTrackSelected(li, t, idx);
        });
        li.appendChild(mark);

        li.addEventListener("click", (e) => {
          if (e.target.closest(".t-actions")) return;   // taps on the buttons themselves
          if (e.target.closest(".t-mark")) return;      // handled above
          // Once the mode is armed the whole row selects. Making the user hunt
          // for a small circle is the wrong ergonomics for a list you are
          // deliberately working through.
          if (trackSelectMode) { toggleTrackSelected(li, t, idx); return; }
          toggleTrackActions(li, t, idx);
        });

        // A long press starts selecting, with this track the first pick —
        // the same rule as the album grid (v0.6.24).
        addLongPress(li, () => { if (trackSelectMode) return; enterTrackSelectMode(); toggleTrackSelected(li, t, idx); });
        modalTracks.appendChild(li);
      });
    }
  }

  // ----- Track multi-select (album view) ------------------------------------
  // Scoped to one album: every selected track shares `currentAlbum`, so the
  // album identity travels once rather than per track.
  function enterTrackSelectMode() {
    trackSelectMode = true;
    parkSelectMenu(true);
    modalTracks.classList.add("is-selecting");
    // An open action row and a selection are two different intents; leaving
    // the row expanded under a set of circles reads as both at once.
    modalTracks.querySelectorAll(".t-row.is-open").forEach(closeTrackRow);
    updateTrackSelection();
  }

  function exitTrackSelectMode() {
    trackSelectMode = false;
    trackSelected = [];
    parkSelectMenu(false);
    if (modalTracks) {
      modalTracks.classList.remove("is-selecting");
      modalTracks.querySelectorAll(".t-row.is-picked").forEach(li => {
        li.classList.remove("is-picked");
        const m = li.querySelector(".t-mark");
        if (m) m.setAttribute("aria-pressed", "false");
      });
    }
    refreshSelectMenu("tracks", 0);
  }

  function toggleTrackSelected(li, track, index) {
    const at = trackSelected.findIndex(x => x.index === index);
    if (at === -1) trackSelected.push({ index, title: track.title || "" });
    else           trackSelected.splice(at, 1);
    const on = at === -1;
    li.classList.toggle("is-picked", on);
    const m = li.querySelector(".t-mark");
    if (m) m.setAttribute("aria-pressed", String(on));
    updateTrackSelection();
  }

  function updateTrackSelection() {
    refreshSelectMenu("tracks", trackSelected.length);
  }

  // Play or queue the selected tracks, in the order they appear on the ALBUM —
  // not the order they were tapped. Someone ticking four tracks expects the
  // record's running order, not a record of their own clicking.
  //
  // These go one at a time on purpose: /api/play-track has no batch form, and
  // firing them in parallel would interleave into an arbitrary queue order.
  async function invokeTrackMulti(kind) {
    const zone = selectedZoneId;
    if (!currentAlbum) { showToast("No album open", "error"); return; }
    const picks = trackSelected.slice().sort((a, b) => a.index - b.index);
    if (!picks.length) return;
    // Play next, several at once (v0.6.22): each goes in straight after the
    // track playing, so they are sent last to first and end up in order.
    if (kind === "play_next") picks.reverse();
    if (isPhoneAlbum(currentAlbum)) {
      picks.forEach((p, i) => invokePhone(currentAlbum, p.index, kind === "play_next" ? kind : i === 0 ? kind : "queue"));
      exitTrackSelectMode();
      return;
    }
    if (!zone) { showToast("Pick a zone first", "error"); return; }

    let queued = 0, failed = 0, firstError = "";
    for (let i = 0; i < picks.length; i++) {
      const p = picks[i];
      if (picks.length > 3) showToast(`Adding track ${i + 1} of ${picks.length}…`);
      try {
        const r = await fetch("/api/play-track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offset: currentAlbum.offset,
            track: p.index,
            title: p.title,
            zone_or_output_id: zone,
            // Only the FIRST track honours Play now; the rest queue behind it
            // (play_now for each would leave the last track playing alone,
            // having wiped the ones before it). Play next is every one, last
            // to first (above).
            kind: (kind === "play_next" || i === 0 ? kind : "queue"),
            album_title: currentAlbum.title || "",
            album_subtitle: currentAlbum.subtitle || "",
            filter_type:   currentDetailFilter ? currentDetailFilter.type   : "",
            filter_value:  currentDetailFilter ? currentDetailFilter.value  : "",
            filter_parent: currentDetailFilter && currentDetailFilter.parent ? currentDetailFilter.parent : ""
          })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { failed++; if (!firstError) firstError = j.error || `HTTP ${r.status}`; }
        else queued++;
      } catch (e) {
        failed++;
        if (!firstError) firstError = "Couldn't reach the extension";
      }
    }

    if (!queued) {
      showToast(firstError || "Sonos refused those tracks", "error", TOAST_REPORT_MS);
      return;
    }
    const verb = kind === "queue" ? "Queued" : kind === "play_next" ? "Playing next:" : "Playing";
    let msg = `${verb} ${queued} track${queued === 1 ? "" : "s"}`;
    if (failed) msg += ` (${failed} failed: ${firstError})`;
    showToast(msg, failed ? "error" : null, TOAST_REPORT_MS);
    exitTrackSelectMode();
  }

  // Expand/collapse the per-track action row. Only one row is open at a time.
  function closeTrackRow(li) {
    li.classList.remove("is-open");
    const row = li.querySelector(".t-actions");
    if (row) row.remove();
  }
  function toggleTrackActions(li, track, index) {
    const wasOpen = li.classList.contains("is-open");
    const open = modalTracks.querySelector("li.is-open");
    if (open) closeTrackRow(open);
    if (wasOpen) return;

    li.classList.add("is-open");
    const row = document.createElement("div");
    row.className = "t-actions";
    const mk = (label, kind, primary) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "action-btn t-act" + (primary ? " primary" : "");
      b.textContent = label;
      b.addEventListener("click", () => invokeTrack(kind, b, track, index, li));
      return b;
    };
    row.appendChild(mk("Play now", "play_now", true));
    // Play next (v0.6.22): after the track playing, the rest of the queue moved down.
    row.appendChild(mk("Play next", "play_next", false));
    row.appendChild(mk("Queue", "queue", false));
    li.appendChild(row);
  }

  // Mirrors invoke() for a single track (same zone + filter handling).
  async function invokeTrack(kind, btn, track, index, li) {
    if (!currentAlbum) return;
    if (isPhoneAlbum(currentAlbum)) { if (invokePhone(currentAlbum, index, kind)) closeTrackRow(li); return; }
    if (!selectedZoneId) { showToast("Pick a zone first", "error"); return; }
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "…";
    try {
      const r = await fetch("/api/play-track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset: currentAlbum.offset,
          track:  index,
          title:  track.title || "",
          zone_or_output_id: selectedZoneId,
          kind,
          // The album's own identity, so a drifted offset is relocated rather
          // than playing whatever record now sits at that position.
          album_title:    currentAlbum.title || "",
          album_subtitle: currentAlbum.subtitle || "",
          filter_type:   currentDetailFilter ? currentDetailFilter.type   : "",
          filter_value:  currentDetailFilter ? currentDetailFilter.value  : "",
          filter_parent: currentDetailFilter && currentDetailFilter.parent ? currentDetailFilter.parent : ""
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      const said = { play_now: "Playing", play_next: "Playing next", queue: "Queued" }[j.action || kind] || orig;
      showToast(`${said}: ${track.title} → ${zoneName(selectedZoneId)}`);
      // Success — collapse the action row; the user stays on the album.
      closeTrackRow(li);
    } catch (e) {
      showToast(e.message, "error");
      btn.disabled = false; btn.textContent = orig;
    }
  }

  // ----- Below the review (from Rouen v1.9.3) -------------------------------
  // The library's other albums by this album's lead artist and the albums
  // they appear on (/api/artist-albums: the library in memory, nothing asked
  // outside), then Last.fm's similar artists and similar albums. Three of
  // each; More shows the rest. A section stays hidden until it has something
  // to show, and an answer for an album that is no longer open is dropped.
  //
  // What a tile does is visible before it is tapped: one in the library looks
  // like every other album or artist here and opens in Mandarin; one only
  // Last.fm knows carries "Last.fm ↗" and opens its Last.fm page.
  //
  // State is kept on the functions, not in module-level lets: openAlbum can
  // run before this point in the file is reached (a page restored).
  function moreSectionIds() {
    return ["album-more-by", "album-more-appears", "album-lastfm-artists", "album-lastfm-albums"];
  }
  function resetMoreSections() {
    // The previous album's requests, abandoned: the server stops asking
    // Last.fm for an answer nobody will read.
    if (resetMoreSections.abort) { try { resetMoreSections.abort.abort(); } catch (e) { /* already done */ } resetMoreSections.abort = null; }
    for (const id of moreSectionIds()) {
      const sec = document.getElementById(id);
      if (!sec) continue;
      sec.classList.add("hidden");
      const grid = sec.querySelector(".more-grid");
      if (grid) grid.textContent = "";
      const note = sec.querySelector(".more-note");
      if (note) note.remove();
      const toggle = sec.querySelector(".more-toggle");
      if (toggle) { toggle.classList.add("hidden"); toggle.setAttribute("aria-expanded", "false"); toggle.textContent = "More"; }
      const site = sec.querySelector(".more-site");
      if (site) { site.classList.add("hidden"); site.removeAttribute("href"); }
      if (!sec.__wired && toggle) {
        sec.__wired = true;
        toggle.addEventListener("click", () => {
          const open = toggle.getAttribute("aria-expanded") !== "true";
          for (const el of sec.querySelectorAll(".more-extra")) el.classList.toggle("hidden", !open);
          toggle.setAttribute("aria-expanded", open ? "true" : "false");
          toggle.textContent = open ? "Less" : "More";
        });
      }
    }
  }
  // Fill one section: the first three shown, the rest behind More.
  function fillMoreSection(id, items, build, title) {
    const SHOWN = 3;
    const sec = document.getElementById(id);
    if (!sec) return;
    const grid = sec.querySelector(".more-grid");
    const toggle = sec.querySelector(".more-toggle");
    if (title) { const t = sec.querySelector(".more-title"); if (t) t.textContent = title; }
    grid.textContent = "";
    if (!Array.isArray(items) || !items.length) { sec.classList.add("hidden"); return; }
    items.forEach((it, i) => {
      const el = build(it);
      if (i >= SHOWN) el.classList.add("more-extra", "hidden");
      grid.appendChild(el);
    });
    toggle.classList.toggle("hidden", items.length <= SHOWN);
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "More";
    sec.classList.remove("hidden");
  }
  // A Last.fm section that cannot answer because of the key says so — the one
  // failure the user can fix. Anything else (Last.fm slow, an artist it does
  // not know) leaves the section out.
  function moreNote(id, text) {
    const sec = document.getElementById(id);
    if (!sec) return;
    const note = document.createElement("p");
    note.className = "more-note";
    note.textContent = text;
    sec.querySelector(".more-grid").after(note);
    sec.classList.remove("hidden");
  }
  function openLastfmPage(url) {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }
  function lastfmTag() {
    const tag = document.createElement("div");
    tag.className = "more-ext";
    tag.textContent = "Last.fm \u2197";
    return tag;
  }
  // An album in the library: the album view.
  function moreAlbumTile(a) {
    return buildAlbumTile(a, () => openAlbum(a, { filter: null }), { selectable: false });
  }
  // A Last.fm album: the library's own when it has it, else its Last.fm page.
  function lastfmAlbumTile(al) {
    if (al.album) return moreAlbumTile(al.album);
    const tile = buildAlbumTile({ title: al.title, subtitle: al.artist, image_key: al.image_key || null },
                                () => openLastfmPage(al.url), { selectable: false });
    tile.classList.add("is-external");
    tile.setAttribute("aria-label", tile.getAttribute("aria-label") + " on Last.fm");
    (tile.querySelector(".album-meta") || tile).appendChild(lastfmTag());
    return tile;
  }
  // A similar artist: their page here when the library has them (with one of
  // their covers to stand for them), else their Last.fm page.
  function lastfmArtistTile(a) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "more-artist" + (a.in_library ? "" : " is-external");
    btn.setAttribute("aria-label", a.in_library ? a.name : a.name + " on Last.fm");
    const pic = document.createElement("div");
    pic.className = "more-artist-pic";
    const initial = document.createElement("span");
    initial.className = "more-artist-initial";
    initial.textContent = (String(a.name || "").trim().charAt(0) || "?").toUpperCase();
    pic.appendChild(initial);
    if (a.image_key) loadArt(pic, a.image_key, tileImgSize());
    const name = document.createElement("div");
    name.className = "more-artist-name";
    name.textContent = a.name;
    btn.append(pic, name);
    if (!a.in_library) btn.appendChild(lastfmTag());
    btn.addEventListener("click", () => {
      if (!a.in_library) { openLastfmPage(a.url); return; }
      // As the album view's own artist links: its Back comes back here.
      const fromAlbum = currentAlbum ? { album: currentAlbum, opts: { source: currentSource, zoneId: currentSourceZoneId, filter: currentDetailFilter } } : null;
      closeModal();
      if (window.__showArtistAlbums) window.__showArtistAlbums(a.name, { fromAlbum });
    });
    return btn;
  }

  async function fetchAlbumMore(album, lead) {
    lead = String(lead || "").trim();
    // The phone's own music has no place in the server's library.
    if (!lead || isPhoneAlbum(album) || album.offset == null) return;
    const json = (r) => (r.ok ? r.json() : null);
    const mine = () => album === currentAlbum && !modal.classList.contains("hidden") && !modal.classList.contains("np-mode");
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    resetMoreSections.abort = ctl;
    const opt = ctl ? { signal: ctl.signal } : {};
    const byTitle = (a, b) => String(a.title || "").localeCompare(String(b.title || ""));
    const library = fetch("/api/artist-albums?" + new URLSearchParams({ artist: lead }), opt)
      .then(json).then((j) => {
        if (!j || !mine()) return;
        // Not the album being looked at — by its id, so another pressing of
        // the same title by the same act stays.
        const by = (j.primary || []).filter(a => a.offset !== album.offset).sort(byTitle);
        const appears = (j.featured || []).filter(a => a.offset !== album.offset).sort(byTitle);
        fillMoreSection("album-more-by", by, moreAlbumTile, "More by " + lead);
        fillMoreSection("album-more-appears", appears, moreAlbumTile, lead + " appears on");
      });
    const q = new URLSearchParams({ artist: lead });
    const lastfm = fetch("/api/lastfm/similar-artists?" + q, opt).then(json).then((j) => {
      // No key: Last.fm is simply not here, and the albums are not asked for.
      if (!j || !j.enabled || !mine()) return;
      if (j.error) { if (/key/i.test(j.error)) moreNote("album-lastfm-artists", j.error + " — Settings → Setup → API Keys."); return; }
      fillMoreSection("album-lastfm-artists", j.artists, lastfmArtistTile);
      const site = document.querySelector("#album-lastfm-artists .more-site");
      if (site && j.url && j.artists && j.artists.length) { site.href = j.url; site.classList.remove("hidden"); }
      return fetch("/api/lastfm/similar-albums?" + q, opt).then(json).then((k) => {
        if (!k || !k.enabled || k.error || !mine()) return;
        fillMoreSection("album-lastfm-albums", k.albums, lastfmAlbumTile);
      });
    });
    await Promise.allSettled([library, lastfm]);
  }

  async function fetchAlbumExtras(album) {
    if (!album) return;
    const params = new URLSearchParams({
      title:  album.title    || "",
      artist: album.subtitle || "",
      // This screen shows the full release date, so it asks the server to look
      // the day up if it has only the year (the other callers do not wait).
      day:    "1"
    });
    const askedAs = (album.title || "") + "\u0001" + (album.subtitle || "");
    const r = await fetch(`/api/album/extras?${params}`);
    if (!r.ok) return;
    const j = await r.json();
    // Modal may have been closed/reopened while we waited; bail if so.
    if (album !== currentAlbum) return;
    // Or renamed meanwhile (the page caught up with an edit): a newer ask
    // under the new names is on its way, and this answer is for the old ones.
    if ((album.title || "") + "\u0001" + (album.subtitle || "") !== askedAs) return;
    renderExtras(j, album);
  }

  // "2026-09-25" as the device writes a date ("25 September 2026" or
  // "September 25, 2026"), "2026-09" as a month, "2026" as it is. Read as UTC,
  // because a bare date parsed in a timezone west of Greenwich is the evening
  // before. "" for anything else.
  function formatReleaseDate(s) {
    const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(String(s || ""));
    if (!m) return "";
    if (!m[2]) return m[1];
    const opts = { year: "numeric", month: "long", timeZone: "UTC" };
    if (m[3]) opts.day = "numeric";
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1));
    // "2026-13-40" would roll over into another month rather than fail.
    if (isNaN(d.getTime()) || d.getUTCMonth() !== Number(m[2]) - 1 ||
        (m[3] && d.getUTCDate() !== Number(m[3]))) return m[1];
    try { return d.toLocaleDateString(undefined, opts); }
    catch (e) { return m[1]; /* no Intl on this device: the year is still right */ }
  }

  function renderExtras(extras, album) {
    // Asked again after an edit: the previous answer's year/score go first,
    // so the line never reads "Artist · 1997 · 1999". The artist links are
    // modalSub's first child and stay.
    while (modalSub.childNodes.length > 1) modalSub.removeChild(modalSub.lastChild);
    // 1. Append the release date + label to subtitle line (artist button
    // already present). The date is the one the Release date sort orders this
    // album by, to the day wherever one is known; the year is the fallback.
    const yearToShow = formatReleaseDate(extras.release_date) || extras.year ||
      (extras.album && extras.album.year ? String(extras.album.year) : "");
    if (yearToShow) {
      const yearSpan = document.createElement("span");
      yearSpan.className = "modal-subtitle-year";
      yearSpan.textContent = " · " + yearToShow;
      modalSub.appendChild(yearSpan);
    }
    if (extras.album && extras.album.label) {
      const sep = document.createElement("span");
      sep.className = "modal-subtitle-year";
      sep.textContent = " · ";
      modalSub.appendChild(sep);
      const labelBtn = document.createElement("button");
      labelBtn.className = "modal-artist-link";
      labelBtn.textContent = extras.album.label;
      labelBtn.addEventListener("click", () => {
        // Back from the label's albums returns to this page (v0.6.24).
        const back = { album, opts: { source: currentSource, zoneId: currentSourceZoneId, filter: currentDetailFilter } };
        closeModal();
        if (window.__showLabelAlbums) window.__showLabelAlbums(extras.album.label, false, back);
      });
      modalSub.appendChild(labelBtn);
    }
    if (extras.album && typeof extras.album.score === "number" && !isNaN(extras.album.score)) {
      const sep = document.createElement("span");
      sep.className = "modal-subtitle-year";
      sep.textContent = " · ";
      modalSub.appendChild(sep);
      const chip = document.createElement("span");
      chip.className = "pitchfork-score";
      chip.textContent = extras.album.score % 1 === 0
        ? extras.album.score + ".0"
        : String(extras.album.score);
      modalSub.appendChild(chip);
      if (extras.album.isBestNewMusic) {
        const bnm = document.createElement("span");
        bnm.className = "bnm-badge";
        bnm.textContent = "BNM";
        modalSub.appendChild(bnm);
      }
    }

    // 2. Album bio section (description + source link; year/label now in subtitle)
    if (extras.album && (extras.album.description || (extras.album.url && extras.album.source))) {
      const section = document.getElementById("album-bio-section");
      const meta    = document.getElementById("album-meta");
      const text    = document.getElementById("album-bio-text");
      const toggle  = document.getElementById("album-bio-toggle");
      const srcLink = document.getElementById("album-bio-source");

      meta.style.display = "none";

      text.textContent = extras.album.description || "";
      text.style.display = extras.album.description ? "" : "none";

      if (extras.album.url && extras.album.source) {
        srcLink.href = extras.album.url;
        // Pitchfork review text is never shown (UK-law compliance) — the
        // link is the way to read it, so say so explicitly.
        srcLink.textContent = extras.album.source === "Pitchfork"
          ? "Read the full review on Pitchfork"
          : "View on " + extras.album.source;
        srcLink.classList.remove("hidden");
      } else {
        srcLink.classList.add("hidden");
      }

      // WHOSE WORDS THESE ARE, when that is not the same as where the link
      // goes. A Pitchfork-reviewed album now shows WIKIPEDIA's description
      // (their own prose never leaves the server), and the only link beside it
      // says "Read the full review on Pitchfork" — which would read as though
      // the paragraph above it were Pitchfork's. It is not, and one line saying
      // so is the difference between a citation and a misattribution.
      const textSrc = document.getElementById("album-bio-text-source");
      if (textSrc) {
        const ds = extras.album.description_source;
        const show = !!(extras.album.description && ds && ds !== extras.album.source);
        if (show && extras.album.description_url) {
          textSrc.innerHTML = "";
          const a = document.createElement("a");
          a.href = extras.album.description_url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = "From " + ds;
          textSrc.appendChild(a);
        } else if (show) {
          textSrc.textContent = "From " + ds;
        }
        textSrc.classList.toggle("hidden", !show);
      }

      section.classList.remove("hidden");
      if (extras.album.description) setupBioToggle(text, toggle);
      else toggle.classList.add("hidden");
    }

    // (Artist bio section removed — the album bio is enough, and the
    // artist Wikipedia lookup was prone to returning wrong articles for
    // less-famous artists.)
  }

  function setupBioToggle(textEl, toggleEl) {
    requestAnimationFrame(() => {
      textEl.dataset.clipped = "true";
      if (textEl.scrollHeight > textEl.clientHeight + 4) {
        toggleEl.classList.remove("hidden");
        toggleEl.textContent = "Show more";
        toggleEl.onclick = () => {
          const isClipped = textEl.dataset.clipped === "true";
          textEl.dataset.clipped = isClipped ? "false" : "true";
          toggleEl.textContent  = isClipped ? "Show less" : "Show more";
        };
      } else {
        toggleEl.classList.add("hidden");
      }
    });
  }
  // Shared with the artist-albums view and the Qobuz artist screen (separate
  // IIFEs) — same clamp/expand behavior everywhere a bio renders.
  window.__setupBioToggle = setupBioToggle;

  // The phone's own music plays on the phone, through the app, whatever
  // zone is picked: the server never has these files.
  function invokePhone(album, index, kind) {
    const dl = window.MusicdDownloads;
    if (!dl || typeof dl.playLocal !== "function") { showToast("Only the Mandarin app plays music on this phone", "error"); return false; }
    try { dl.playLocal(phoneKey(album), index, kind); } catch (e) { showToast(e.message, "error"); return false; }
    showToast((kind === "queue" ? "Queued" : kind === "play_next" || kind === "add_next" ? "Next" : "Playing") + " → This phone");
    return true;
  }
  async function invoke(kind, btn) {
    if (!currentAlbum) return;
    if (isPhoneAlbum(currentAlbum)) { invokePhone(currentAlbum, -1, kind); return; }
    if (!selectedZoneId) { showToast("Pick a zone first", "error"); return; }
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "…";
    try {
      const r = await fetch("/api/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset: currentAlbum.offset,
          // Identity travels with the play so a stale offset is relocated
          // (or refused with a 409) server-side — never played blind.
          title:    currentAlbum.title    || "",
          subtitle: currentAlbum.subtitle || "",
          zone_or_output_id: selectedZoneId,
          kind,
          filter_type:   currentDetailFilter ? currentDetailFilter.type   : "",
          filter_value:  currentDetailFilter ? currentDetailFilter.value  : "",
          filter_parent: currentDetailFilter && currentDetailFilter.parent ? currentDetailFilter.parent : ""
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (typeof j.offset === "number" && j.offset >= 0) currentAlbum.offset = j.offset;
      const said = { play_now: "Playing", play_next: "Playing next", queue: "Queued", shuffle: "Shuffling", radio: "Radio" }[j.action || kind] || orig;
      showToast(`${said} → ${zoneName(selectedZoneId)}`);
      // Keep the album view open after playing so the user stays on the album.
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  }

  function zoneName(id) {
    const z = zones.find(z => z.zone_id === id);
    return z ? z.display_name : "zone";
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    })[c]);
  }

  // While a text field has the focus (the keyboard is up), the page says so
  // on <html>. The Android app's stylesheet hides the mini transport bar
  // then: its WebView shrinks the page to fit above the keyboard, so the bar
  // rode up with it and sat on top of the keys. Browsers ignore the class.
  (function watchTyping() {
    const typing = el => !!el && (el.tagName === "TEXTAREA" ||
      (el.tagName === "INPUT" && !/^(checkbox|radio|range|button|submit|file|color)$/i.test(el.type || "text")));
    document.addEventListener("focusin", (e) => { if (typing(e.target)) document.documentElement.classList.add("is-typing"); });
    document.addEventListener("focusout", (e) => {
      if (!typing(e.target)) return;
      // The focus may be moving to another field: decide once it has settled.
      setTimeout(() => { if (!typing(document.activeElement)) document.documentElement.classList.remove("is-typing"); }, 50);
    });
  })();

  // ----- Library search (instant, prefix-aware; collapsible) -----
  (function initSearch() {
    const input    = document.getElementById("search-input");
    const clear    = document.getElementById("search-clear");
    const statusEl = document.getElementById("search-status");
    const row      = document.getElementById("search-row");
    if (!input || !row) return;

    let seq           = 0;     // guards against out-of-order responses
    let abort         = null;  // in-flight fetch controller
    let debounceTimer = null;
    let retryTimer    = null;
    let extTimer      = null;  // delayed external (Qobuz/Tidal/Pitchfork) search
    let active        = false; // currently showing search results?

    function setStatus(msg) { statusEl.textContent = msg || ""; }

    // Stop searching and restore the random wall, WITHOUT touching whether the
    // bar itself is open. Used when the field is emptied (incl. the 1st X tap).
    // Search lives on the Home screen. Clearing it drops the results grid and
    // restores the Home sections (unplayed / genres) below the search box.
    function stopSearch() {
      active = false;
      seq++;                                   // invalidate any pending response
      if (abort) { try { abort.abort(); } catch (e) { /* already settled */ } abort = null; }
      clearTimeout(retryTimer);
      clearTimeout(extTimer);
      if (extAbort) { try { extAbort.abort(); } catch (e) { /* already settled */ } extAbort = null; }
      extWrap = null; extWrapSeq = -1;         // release the rendered external sections
      setStatus("");
      setBanner(null);
      grid.innerHTML = "";
      grid.classList.add("hidden");
      const hs = document.getElementById("home-sections");
      if (hs) hs.classList.remove("hidden");
    }

    async function run(q) {
      const mySeq = ++seq;
      if (abort) { try { abort.abort(); } catch (e) { /* already settled */ } }
      abort = new AbortController();
      clearTimeout(retryTimer);
      // Global search: the external sources (Qobuz/Tidal catalogues, Pitchfork
      // reviews) ride a LONGER debounce than the instant local-index search —
      // they're network calls against rate-limit-sensitive APIs. Scheduled
      // before the library fetch so external results appear even when the
      // library search errors or has zero matches.
      clearTimeout(extTimer);
      // Close behind the library's own debounce (v0.6.24; it was 600 ms): the
      // services' type-ahead is what their own apps do, and the server keeps
      // each answer for an hour.
      extTimer = setTimeout(() => runExternal(q, mySeq), 200);
      extAllowBannerClear = false;
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=60`,
                              { signal: abort.signal, cache: "no-store" });
        if (mySeq !== seq) return;                       // superseded by a newer keystroke
        // Library-search failures clear the grid: leaving the PREVIOUS query's
        // results would let this query's external sections append beneath them
        // (a mixed-query page). The banner/status explains what's missing, and
        // extAllowBannerClear stays false so arriving externals can't wipe it.
        if (r.status === 503) { grid.innerHTML = ""; extReappend(mySeq); setBanner("Reading your music library…", true); return; }
        if (!r.ok) { grid.innerHTML = ""; extReappend(mySeq); setStatus("search error"); return; }
        const j = await r.json();
        if (mySeq !== seq) return;

        if (j.building) {
          // First-time index build still running — show progress and retry.
          const pct = Math.round((j.progress || 0) * 100);
          setStatus(`Building index… ${pct}%`);
          grid.innerHTML = "";
          extReappend(mySeq);
          retryTimer = setTimeout(() => {
            if (active && input.value.trim() === q) run(q);
          }, 350);
          return;
        }

        const results = j.results || [];
        const labels  = j.labels  || [];
        const artists = j.artists || [];
        if (!results.length && !labels.length && !artists.length) {
          grid.innerHTML = "";
          setStatus("");
          // Externals can still match \u2014 if some already landed, keep them and
          // skip the banner; otherwise show it and let a later external
          // arrival clear it (extAllowBannerClear).
          extAllowBannerClear = true;
          if (!extReappend(mySeq)) setBanner(`No matches for \u201C${q}\u201D.`, false);
          return;
        }
        setBanner(null);
        const more = results.length >= 60 ? "+" : "";
        const parts = [];
        if (artists.length) parts.push(`${artists.length} artist${artists.length === 1 ? "" : "s"}`);
        if (labels.length)  parts.push(`${labels.length} label${labels.length === 1 ? "" : "s"}`);
        if (results.length) parts.push(`${results.length}${more} album${results.length === 1 ? "" : "s"}`);
        setStatus(parts.join(", "));

        grid.innerHTML = "";
        const frag = document.createDocumentFragment();

        // Artists section
        if (artists.length) {
          const hdr = document.createElement("div"); hdr.className = "search-section-header"; hdr.textContent = "Artists";
          frag.appendChild(hdr);
          const row = document.createElement("div"); row.className = "search-chip-row";
          for (const ar of artists) {
            const btn = document.createElement("button"); btn.className = "search-chip";
            btn.textContent = ar.name;
            btn.addEventListener("click", () => {
              stopSearch();
              window.__showArtistAlbums && window.__showArtistAlbums(ar.name);
            });
            row.appendChild(btn);
          }
          frag.appendChild(row);
        }

        // Labels section
        if (labels.length) {
          const hdr = document.createElement("div"); hdr.className = "search-section-header"; hdr.textContent = "Labels";
          frag.appendChild(hdr);
          const row = document.createElement("div"); row.className = "search-chip-row";
          for (const lb of labels) {
            const btn = document.createElement("button"); btn.className = "search-chip";
            btn.textContent = lb.display;
            btn.addEventListener("click", () => {
              stopSearch();
              if (window.__exitLabels) window.__exitLabels();
              if (window.__showLabelAlbums) window.__showLabelAlbums(lb.display);
            });
            row.appendChild(btn);
          }
          frag.appendChild(row);
        }

        // Albums section
        if (results.length) {
          if (artists.length || labels.length) {
            const hdr = document.createElement("div"); hdr.className = "search-section-header"; hdr.textContent = "Albums";
            frag.appendChild(hdr);
          }
          for (const a of results) frag.appendChild(buildAlbumTile(a));
        }

        grid.appendChild(frag);
        // A slow library response can land AFTER this query's external sections
        // rendered — the innerHTML reset above destroyed them, so re-attach.
        extReappend(mySeq);
      } catch (e) {
        if (e && e.name === "AbortError") return;        // expected when typing fast
        if (mySeq === seq) setStatus("search error");
      }
    }

    // ---- Global search: external sources (Qobuz / Tidal / Pitchfork) ----
    // Best-effort and additive: sections are appended below the library results
    // when they arrive; any failure just means that section doesn't appear.
    // All sections live in ONE wrapper (display:contents, so the grid lays out
    // its children directly) — run(q)'s innerHTML resets would otherwise
    // destroy already-rendered externals; extReappend re-attaches the wrapper.
    let extWrap = null;              // rendered external sections for extWrapSeq
    let extWrapSeq = -1;
    let extAllowBannerClear = false; // only the "No matches" banner may be cleared

    // The sections on screen put back after the grid is rebuilt — this query's,
    // or the previous query's dimmed as stale (v0.6.24), so the services'
    // results don't blink out on every keystroke the way the library's never
    // do; the fresh ones take their place as they land.
    function extReappend(mySeq) {
      if (!extWrap || !extWrap.childNodes.length) return false;
      extWrap.classList.toggle("is-stale", extWrapSeq !== mySeq);
      grid.appendChild(extWrap);     // appendChild MOVES it if already attached
      return true;
    }
    let extAbort = null;

    // The services and Pitchfork are asked separately (v0.6.24), each
    // section landing as its answer comes: Qobuz and Tidal are no longer
    // held for a slow Pitchfork search. One wrapper, two slots in a fixed
    // order, so whichever answers first the services stay above the reviews.
    async function runExternal(q, mySeq) {
      if (extAbort) { try { extAbort.abort(); } catch (e) { /* already settled */ } }   // the previous keystroke's asks
      const ctl = extAbort = new AbortController();
      const wrap = document.createElement("div");
      wrap.className = "ext-search-wrap";
      const slots = { qobuz: document.createElement("div"), tidal: document.createElement("div"), pitchfork: document.createElement("div") };
      for (const el of Object.values(slots)) { el.className = "ext-search-slot"; wrap.appendChild(el); }
      let added = 0;
      const landed = (n) => {
        if (mySeq !== seq || !n) return;
        added += n;
        if (extWrap && extWrap !== wrap) extWrap.remove();   // the previous query's, stale
        extWrap = wrap;
        extWrapSeq = mySeq;
        // Externals may arrive while a "No matches for X" banner shows —
        // clear THAT banner (there are matches after all), but never the
        // Roon-disconnect/error banners, which explain the missing library rows.
        if (extAllowBannerClear) setBanner(null);
        grid.appendChild(wrap);     // appendChild MOVES it if already attached
      };
      const ask = async (part, fill) => {
        try {
          const r = await fetch(`/api/search/external?q=${encodeURIComponent(q)}&parts=${part}`, { cache: "no-store", signal: ctl.signal });
          if (mySeq !== seq || !r.ok) return;
          const j = await r.json();
          if (mySeq !== seq) return;
          landed(fill(j));
        } catch (e) { /* best-effort — that section just doesn't appear */ }
      };
      await Promise.all([
        ask("qobuz", (j) => extServiceSection(slots.qobuz, "qobuz", "Qobuz", j.qobuz, j.qobuz_artists, "qobuz-toggle", "qobuz-search-input")),
        ask("tidal", (j) => extServiceSection(slots.tidal, "tidal", "Tidal", j.tidal, j.tidal_artists, "tidal-toggle", "tidal-search-input")),
        ask("pitchfork", (j) => extPitchforkSection(slots.pitchfork, j.pitchfork))
      ]);
      // Nothing from anywhere for this query: the stale sections go, and the
      // library's "No matches" stands if the library had nothing either.
      if (mySeq === seq && !added) {
        if (extWrap && extWrap !== wrap) { extWrap.remove(); extWrap = null; extWrapSeq = -1; }
        if (extAllowBannerClear && !grid.querySelector(".album")) setBanner(`No matches for \u201C${q}\u201D.`, false);
      }
    }

    function extHeader(frag, label) {
      const hdr = document.createElement("div");
      hdr.className = "search-section-header";
      hdr.textContent = label;
      frag.appendChild(hdr);
    }

    function extRow(cover, title, sub, onClick) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ext-search-row";
      const img = document.createElement("img");
      img.className = "ext-search-art"; img.loading = "lazy"; img.alt = "";
      if (cover) {
        img.src = cover;
        // Dead cover URL → blank placeholder box, not the broken-image glyph.
        img.addEventListener("error", () => { img.removeAttribute("src"); img.style.visibility = "hidden"; });
      } else {
        img.style.visibility = "hidden";
      }
      const tx = document.createElement("div"); tx.className = "ext-search-meta";
      const t  = document.createElement("div"); t.className = "ext-search-title"; t.textContent = title;
      const s  = document.createElement("div"); s.className = "ext-search-sub";   s.textContent = sub || "";
      tx.appendChild(t); tx.appendChild(s);
      btn.appendChild(img); btn.appendChild(tx);
      btn.addEventListener("click", onClick);
      return btn;
    }

    // Qobuz / Tidal (v0.6.24): the service's artists as a strip of chips (a
    // tap: the artist's albums in the service's browser) and its albums as
    // tiles of this grid, + / ✓ on each cover, a tap opening the album's own
    // page over the results — in the library or not, from either service.
    // Without the service's browser on the page, the rows of before.
    function extServiceSection(frag, service, label, albums, artists, toggleId, inputId) {
      const sb = window.__serviceBrowsers && window.__serviceBrowsers[service];
      const nA = (albums && albums.length) || 0, nR = (sb && artists && artists.length) || 0;
      if (!nA && !nR) return 0;
      extHeader(frag, label);
      if (nR) {
        const strip = document.createElement("div");
        strip.className = "ext-search-artists";
        for (const ar of artists) {
          const chip = document.createElement("button");
          chip.type = "button"; chip.className = "qobuz-artist-chip";
          const img = document.createElement(ar.image ? "img" : "div");
          img.className = "qobuz-artist-thumb";
          if (ar.image) { img.loading = "lazy"; img.alt = ""; img.src = ar.image; }
          const name = document.createElement("span"); name.className = "qobuz-artist-name"; name.textContent = ar.name;
          chip.appendChild(img); chip.appendChild(name);
          chip.addEventListener("click", () => sb.openArtist(ar));
          strip.appendChild(chip);
        }
        frag.appendChild(strip);
      }
      if (!nA) return nR;
      if (sb) { for (const a of albums) frag.appendChild(sb.tile(a)); return nA + nR; }
      for (const a of albums) {
        frag.appendChild(extRow(a.image, a.title, a.artist, () => {
          stopSearch();
          const t = document.getElementById(toggleId);
          if (!t) return;
          t.click();
          const si = document.getElementById(inputId);
          const seedQ = ((a.artist || "") + " " + (a.title || "")).trim();
          if (si && seedQ) { si.value = seedQ; si.dispatchEvent(new Event("input", { bubbles: true })); }
        }));
      }
      return nA;
    }

    // Pitchfork section: tapping a review deep-links to its detail view.
    function extPitchforkSection(frag, items) {
      if (!items || !items.length) return 0;
      extHeader(frag, "Pitchfork reviews");
      for (const it of items) {
        const row = extRow(it.cover, it.album, it.artist, () => {
          stopSearch();
          if (window.__openPitchforkReview) window.__openPitchforkReview(it);
        });
        if (it.score != null) {
          const sc = document.createElement("span");
          sc.className = "ext-search-score" + (it.isBestNewMusic ? " is-bnm" : "");
          sc.textContent = Number(it.score).toFixed(1);
          row.appendChild(sc);
        }
        frag.appendChild(row);
      }
      return items.length;
    }

    function onInput() {
      const q = input.value.trim();
      clearTimeout(debounceTimer);
      if (!q) { stopSearch(); return; }                  // emptied: back to Home sections
      if (window.__exitLabels) window.__exitLabels();    // leave the label browser
      exitAlbumSelectMode();
      active = true;
      // Show the results grid in place of the Home sections (the search box
      // above it stays put).
      const hs = document.getElementById("home-sections");
      if (hs) hs.classList.add("hidden");
      grid.classList.remove("hidden");
      // Small debounce: long enough to coalesce a fast burst, short enough to
      // still feel instant.
      debounceTimer = setTimeout(() => run(q), 120);
    }

    input.addEventListener("input",  onInput);
    input.addEventListener("search", onInput);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSearch();
    });

    // The X clears the text and keeps the field open, so a retype needs no
    // second tap on the glass. With nothing left to clear, a second tap
    // closes the bar (as tapping away does) — the one button does both.
    clear.addEventListener("click", () => {
      if (!input.value) { closeSearch(); return; }
      input.value = "";
      stopSearch();
      input.focus();
    });

    // ---- Open / close --------------------------------------------------
    //
    // The field is no longer permanently in the top bar: the glass is the
    // resting state and the field opens from it. This follows the overflow
    // menu's pattern exactly (module-level "what is open", stopPropagation on
    // the trigger, a `closest()` containment test on the document) rather than
    // inventing a second idiom for the same gesture.
    //
    // Closing always CLEARS. A field that reopens holding last week's query,
    // with the results gone, is a worse state than an empty one.
    const openBtn = document.getElementById("search-open");

    const searchWrap = document.getElementById("topbar-search");
    function openSearch() {
      row.classList.add("open");
      if (searchWrap) searchWrap.classList.add("is-open");
      if (openBtn) {
        openBtn.classList.add("hidden");
        openBtn.setAttribute("aria-expanded", "true");
      }
      input.focus();
    }
    function closeSearch() {
      if (!row.classList.contains("open")) return;
      input.value = "";
      stopSearch();
      input.blur();
      row.classList.remove("open");
      if (searchWrap) searchWrap.classList.remove("is-open");
      if (openBtn) {
        openBtn.classList.remove("hidden");
        openBtn.setAttribute("aria-expanded", "false");
      }
    }

    if (openBtn) {
      openBtn.addEventListener("click", (e) => {
        e.stopPropagation();   // must not reach the document listener below
        openSearch();
      });
    }
    // Tap anywhere outside the search container closes it. `closest()` on the
    // container, not `contains()` on the input, so a tap on the X or the
    // status text is inside rather than a dismissal.
    // A tap on a result, or in the album page, a sheet or a menu opened over
    // the results, is not a tap away (v0.6.24): the results stay for when
    // the page closes.
    document.addEventListener("click", (e) => {
      if (!row.classList.contains("open")) return;
      if (e.target.closest && e.target.closest("#topbar-search, #album-grid, #album-modal, .settings-overlay, #menu-overlay, .sel-menu, .confirm-overlay, .sheet-overlay")) return;
      closeSearch();
    });

    // The services' sections alone, for the Library wall's filter (v0.6.24):
    // Qobuz's and Tidal's artists and albums for the letters typed, or null.
    window.__serviceSearchSections = async (q) => {
      const r = await fetch(`/api/search/external?q=${encodeURIComponent(q)}&parts=services`, { cache: "no-store" });
      if (!r.ok) return null;
      const j = await r.json();
      const wrap = document.createElement("div");
      wrap.className = "ext-search-wrap";
      const n = extServiceSection(wrap, "qobuz", "Qobuz", j.qobuz, j.qobuz_artists, "qobuz-toggle", "qobuz-search-input")
        + extServiceSection(wrap, "tidal", "Tidal", j.tidal, j.tidal_artists, "tidal-toggle", "tidal-search-input");
      return n ? wrap : null;
    };
    // Seed and open in one step. Used by anything that wants to hand the user
    // a started search rather than an empty box.
    window.__runSearch = (q) => { openSearch(); input.value = q; onInput(); };
    // Called when leaving Home for the wall/labels so stale search results
    // don't linger in the shared grid. Closes the field too: the glass is the
    // resting state, and every one of these call sites is a navigation away
    // from Home.
    window.__clearSearchIfActive = () => {
      if (active) { input.value = ""; stopSearch(); }
      closeSearch();
    };
    window.__searchActive = () => active;
  })();

  // ----- Boot -----
  refreshBtn.addEventListener("click", loadRandom);

  // ----- Filter sheet (All / Genre / Tag) -----
  (() => {
    const overlay      = document.getElementById("filter-overlay");
    const toggleBtn    = document.getElementById("filter-toggle");
    const allBtn       = document.getElementById("filter-all");
    const allCheck     = overlay && overlay.querySelector('.filter-check[data-for="all"]');
    const genresToggle = document.getElementById("filter-genres-toggle");
    const genresList   = document.getElementById("filter-genres-list");
    const tagsToggle   = document.getElementById("filter-tags-toggle");
    const tagsList     = document.getElementById("filter-tags-list");
    const decadesToggle = document.getElementById("filter-decades-toggle");
    const decadesList   = document.getElementById("filter-decades-list");
    if (!overlay || !toggleBtn) return;

    function markActive() {
      toggleBtn.classList.toggle("is-active", !!activeFilter);
      if (allCheck) allCheck.classList.toggle("hidden", !!activeFilter);
      for (const el of overlay.querySelectorAll(".filter-item")) {
        const t = el.dataset.ftype, v = el.dataset.fvalue;
        el.classList.toggle("is-current",
          !!activeFilter && activeFilter.type === t && activeFilter.value === v);
      }
    }

    function applyFilter(f) {
      activeFilter = f;
      try {
        if (f) localStorage.setItem("rra-filter", JSON.stringify(f));
        else   localStorage.removeItem("rra-filter");
      } catch (e) { /* localStorage optional (private browsing) */ }
      if (window.__exitLabels) window.__exitLabels();
      markActive();
      close();
      if (window.__showWall) window.__showWall();   // reveal the album grid (leave Home)
      updateCountReadout(null);
      loadRandom();
    }
    window.__applyFilter = applyFilter;   // used by the Home "Browse by genre" cards

    function renderList(container, type, rows) {
      container.innerHTML = "";
      if (!rows.length) {
        const d = document.createElement("div");
        d.className = "filter-empty";
        d.textContent = type === "genre" ? "No genres found"
                      : (type === "tag" ? "No tags found"
                      : "No decades yet — release years fill in as the label scan runs.");
        container.appendChild(d);
        return;
      }
      for (const row of rows) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "filter-item";
        b.dataset.ftype = type;
        b.dataset.fvalue = row.title;
        const t = document.createElement("span");
        t.className = "filter-item-title";
        t.textContent = row.title;
        b.appendChild(t);
        if (row.subtitle) {
          const sub = document.createElement("span");
          sub.className = "filter-item-sub";
          sub.textContent = row.subtitle;
          b.appendChild(sub);
        }
        b.addEventListener("click", () => applyFilter({ type, value: row.title }));
        container.appendChild(b);
      }
      markActive();
    }

    const loaded = { genre: false, tag: false, decade: false };
    async function ensureList(type) {
      if (loaded[type]) return;
      const container = type === "genre" ? genresList : (type === "tag" ? tagsList : decadesList);
      container.innerHTML = '<div class="filter-empty">Loading\u2026</div>';
      try {
        const url = type === "genre" ? "/api/filters/genres"
                  : (type === "tag" ? "/api/filters/tags" : "/api/filters/decades");
        const r = await fetch(url);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
        const rows = type === "genre" ? j.genres : (type === "tag" ? j.tags : j.decades);
        renderList(container, type, rows || []);
        loaded[type] = true;
      } catch (e) {
        container.innerHTML = "";
        const d = document.createElement("div");
        d.className = "filter-empty";
        d.textContent = "Couldn't load: " + e.message;
        container.appendChild(d);
      }
    }

    function wireSection(toggle, list, type) {
      toggle.addEventListener("click", async () => {
        const willOpen = list.classList.contains("hidden");
        list.classList.toggle("hidden", !willOpen);
        toggle.setAttribute("aria-expanded", String(willOpen));
        toggle.classList.toggle("is-open", willOpen);
        if (willOpen) await ensureList(type);
      });
    }
    wireSection(genresToggle, genresList, "genre");
    wireSection(tagsToggle,   tagsList,   "tag");
    wireSection(decadesToggle, decadesList, "decade");

    function open()  { overlay.classList.remove("hidden"); markActive(); }
    function close() { overlay.classList.add("hidden"); }

    toggleBtn.addEventListener("click", open);
    allBtn.addEventListener("click", () => applyFilter(null));
    overlay.addEventListener("click", (e) => {
      if (e.target.closest && e.target.closest("[data-filter-close]")) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.classList.contains("hidden")) close();
    });

    markActive();
  })();

  // ----- Labels browser (record labels → their albums) -----
  // Tapping the tag button shows every record label as a grid tile
  // (alphabetical). Tapping a label shows its albums — alphabetical by
  // default, or shuffled per the "Label album order" setting. Each album
  // opens carrying a { type:"label" } filter so detail + play resolve the
  // offset against that label's album list (reusing all existing machinery).
  (() => {
    const labelsBtn          = document.getElementById("labels-toggle");
    const labelsBar          = document.getElementById("labels-bar");
    const labelsBack         = document.getElementById("labels-back");
    const labelsTitle        = document.getElementById("labels-title");
    const labelMergeBar      = document.getElementById("label-merge-bar");
    const labelMergeInfo     = document.getElementById("label-merge-info");
    const labelMergeBtn      = document.getElementById("label-merge-btn");
    const labelMergeCancelBtn = document.getElementById("label-merge-cancel-btn");
    const labelUnmergeSheet  = document.getElementById("label-unmerge-sheet");
    const labelUnmergeName   = document.getElementById("label-unmerge-name");
    const labelUnmergeList   = document.getElementById("label-unmerge-list");
    const labelUnmergeClose  = document.getElementById("label-unmerge-close");
    const labelsLogoBtn      = document.getElementById("labels-logo-btn");
    const logoUrlSheet       = document.getElementById("logo-url-sheet");
    const logoCandidatesEl   = document.getElementById("logo-candidates");
    const logoUrlInput       = document.getElementById("logo-url-input");
    const logoUrlSave        = document.getElementById("logo-url-save");
    const logoUrlCancel      = document.getElementById("logo-url-cancel");
    if (!labelsBtn) return;

    // The labels' own controls, in the top bar's right corner (v0.6.5): find a
    // label and turn the order round (# to Z, Z to #) on the list; the logo
    // button on one label's albums. The bar under it that held "‹ All labels"
    // and the label's name again is gone — the top bar's ‹ and title say both.
    const labelsTools = document.createElement("div");
    labelsTools.id = "labels-tools";
    labelsTools.className = "labels-tools hidden";
    labelsTools.innerHTML =
      '<div class="search-box labels-search hidden">' +
        '<svg class="search-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
        '<input id="labels-search-input" type="search" inputmode="search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" placeholder="Find a label…" aria-label="Find a label">' +
        '<button id="labels-search-clear" class="search-clear" type="button" aria-label="Clear">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
      '</div>' +
      '<button id="labels-sort-btn" class="icon-btn labels-sort-btn" type="button"></button>' +
      '<button id="labels-search-btn" class="icon-btn" type="button" aria-label="Find a label" title="Find a label">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>';
    {
      const row = document.querySelector(".topbar-row");
      const before = document.getElementById("topbar-refresh");
      if (row) row.insertBefore(labelsTools, before && before.parentNode === row ? before : null);
      if (labelsLogoBtn) labelsTools.appendChild(labelsLogoBtn);
    }
    const labelsSearchBox   = labelsTools.querySelector(".labels-search");
    const labelsSearchInput = labelsTools.querySelector("#labels-search-input");
    const labelsSearchClear = labelsTools.querySelector("#labels-search-clear");
    const labelsSearchBtn   = labelsTools.querySelector("#labels-search-btn");
    const labelsSortBtn     = labelsTools.querySelector("#labels-sort-btn");
    let labelsReversed = false;
    try { labelsReversed = localStorage.getItem("rra-labels-reversed") === "1"; } catch (e) { /* localStorage optional */ }
    let lastLabels = null;   // the list as the server sent it, for re-ordering without a fetch

    function paintSortBtn() {
      labelsSortBtn.innerHTML = '<span class="labels-order-txt">' + (labelsReversed ? "Z–#" : "#–Z") + "</span>";
      const say = labelsReversed ? "Z to # — tap for # to Z" : "# to Z — tap for Z to #";
      labelsSortBtn.setAttribute("aria-label", "Order: " + say);
      labelsSortBtn.setAttribute("title", say);
    }
    paintSortBtn();
    // Which of the tools show: the list's, one label's, or none.
    function paintTools() {
      const list = labelsActive && mode === "list", one = labelsActive && mode === "albums";
      labelsTools.classList.toggle("hidden", !list && !one);
      labelsSortBtn.classList.toggle("hidden", !list);
      const open = list && !labelsSearchBox.classList.contains("hidden");
      labelsSearchBtn.classList.toggle("hidden", !list || open);
      if (!list) labelsSearchBox.classList.add("hidden");
      labelsTools.classList.toggle("is-searching", open);
      if (labelsLogoBtn) labelsLogoBtn.classList.toggle("hidden", !one);
      // The title gives the open field its room on a phone.
      const title = document.getElementById("album-count");
      if (title) title.classList.toggle("is-hidden-by-search", open);
    }
    const fold = v => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    function applyLabelFilter() {
      const q = fold(labelsSearchInput.value);
      let shown = 0;
      grid.querySelectorAll(".album.label-tile").forEach(t => {
        const hit = !q || fold(t.getAttribute("aria-label")).includes(q);
        t.classList.toggle("hidden", !hit);
        if (hit) shown++;
      });
      let none = grid.querySelector(".labels-none");
      if (q && !shown) {
        if (!none) { none = document.createElement("div"); none.className = "labels-none artist-view-empty"; grid.appendChild(none); }
        none.textContent = "No label matches “" + labelsSearchInput.value.trim() + "”";
      } else if (none) none.remove();
    }
    function closeLabelsSearch() {
      labelsSearchInput.value = "";
      labelsSearchBox.classList.add("hidden");
      applyLabelFilter();
      paintTools();
    }
    labelsSearchBtn.addEventListener("click", () => {
      labelsSearchBox.classList.remove("hidden");
      paintTools();
      labelsSearchInput.focus();
    });
    labelsSearchInput.addEventListener("input", applyLabelFilter);
    labelsSearchInput.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLabelsSearch(); });
    // × as on Home: the first tap clears the words, the next closes the field.
    labelsSearchClear.addEventListener("click", () => {
      if (labelsSearchInput.value) { labelsSearchInput.value = ""; applyLabelFilter(); labelsSearchInput.focus(); }
      else closeLabelsSearch();
    });
    labelsSortBtn.addEventListener("click", () => {
      labelsReversed = !labelsReversed;
      try { localStorage.setItem("rra-labels-reversed", labelsReversed ? "1" : "0"); } catch (e) { /* localStorage optional */ }
      paintSortBtn();
      if (lastLabels) { _lastLabelCount = -1; renderLabelTiles(lastLabels); }
      if (mainEl) mainEl.scrollTop = 0;
    });

    let currentLabelName = null;
    let currentLabelLogoUrl = null; // set when showLabelAlbums loads — used by logo picker
    let _labelsScrollSaved = 0;    // restores position when returning from a label's album view
    let _labelsScrollTarget = null; // label name to scroll into view when arriving via a deep-link (album/search)
    const mainEl = document.querySelector("main");

    let mode = null;           // null | "list" | "albums"
    let _lastLabelCount = -1;  // track last rendered count to avoid flicker on re-poll
    let labelsSelectMode = false;
    let labelsSelected   = [];  // [{key, display, mergedFrom}] — first item is merge target

    function labelOrder() {
      return localStorage.getItem("rra-label-order") === "random" ? "random" : "alpha";
    }
    function labelMin() {
      const v = parseInt(localStorage.getItem("rra-label-min") || "1", 10);
      return Number.isFinite(v) && v > 0 ? v : 1;
    }

    function enterLabelSelectMode() {
      labelsSelectMode = true;
      if (labelMergeBar) { labelMergeBar.classList.remove("hidden"); updateMergeBar(); }
    }

    function exitLabelSelectMode() {
      labelsSelectMode = false;
      labelsSelected = [];
      if (labelMergeBar) labelMergeBar.classList.add("hidden");
      grid.querySelectorAll(".album.label-tile.is-selected,.album.label-tile.is-first-selected")
        .forEach(b => b.classList.remove("is-selected", "is-first-selected"));
    }

    function updateMergeBar() {
      if (!labelMergeInfo || !labelMergeBtn) return;
      const n = labelsSelected.length;
      while (labelMergeInfo.firstChild) labelMergeInfo.removeChild(labelMergeInfo.firstChild);
      if (n === 0) {
        labelMergeInfo.textContent = "Tap labels to select";
        labelMergeBtn.textContent = "Merge";
        labelMergeBtn.disabled = true;
      } else if (n === 1) {
        const s = document.createElement("strong"); s.textContent = labelsSelected[0].display;
        labelMergeInfo.appendChild(s);
        labelMergeInfo.appendChild(document.createTextNode(" — select more to merge"));
        labelMergeBtn.textContent = "Merge";
        labelMergeBtn.disabled = true;
      } else {
        labelMergeInfo.appendChild(document.createTextNode("Merge " + n + " into "));
        const s = document.createElement("strong"); s.textContent = labelsSelected[0].display;
        labelMergeInfo.appendChild(s);
        labelMergeBtn.textContent = "Merge";
        labelMergeBtn.disabled = false;
      }
    }

    function handleLabelTileSelect(btn, lb) {
      const idx = labelsSelected.findIndex(s => s.key === lb.key);
      if (idx >= 0) {
        labelsSelected.splice(idx, 1);
        btn.classList.remove("is-selected", "is-first-selected");
      } else {
        labelsSelected.push({ key: lb.key, display: lb.title, mergedFrom: lb.mergedFrom || [] });
        btn.classList.add("is-selected");
      }
      // Re-apply first-selected only to the first item in the array.
      grid.querySelectorAll(".album.label-tile").forEach(b => b.classList.remove("is-first-selected"));
      if (labelsSelected.length > 0) {
        const fk = labelsSelected[0].key;
        const fb = grid.querySelector(`.album.label-tile[data-label-key="${CSS.escape(fk)}"]`);
        if (fb) fb.classList.add("is-first-selected");
      }
      updateMergeBar();
    }

    function showUnmergeSheet(targetDisplay, sources) {
      if (!labelUnmergeSheet || !labelUnmergeName || !labelUnmergeList) return;
      labelUnmergeName.textContent = targetDisplay;
      labelUnmergeList.innerHTML = "";
      for (const src of sources) {
        const row = document.createElement("div");
        row.className = "label-unmerge-row";
        const nameEl = document.createElement("span");
        nameEl.className = "label-unmerge-source";
        nameEl.textContent = src.display;
        const xBtn = document.createElement("button");
        xBtn.type = "button";
        xBtn.className = "icon-btn label-unmerge-remove";
        xBtn.setAttribute("aria-label", "Remove " + src.display);
        xBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
        xBtn.addEventListener("click", async () => {
          xBtn.disabled = true;
          try {
            const r = await fetch("/api/labels/merge/" + encodeURIComponent(src.key), { method: "DELETE" });
            if (!r.ok) throw new Error((await r.json()).error || "Failed");
            row.remove();
            if (!labelUnmergeList.children.length) labelUnmergeSheet.classList.add("hidden");
            _lastLabelCount = -1;
            showLabelsList(false);
          } catch(e) {
            xBtn.disabled = false;
            if (window.__showToast) window.__showToast("Unmerge failed: " + e.message, "error");
          }
        });
        row.appendChild(nameEl);
        row.appendChild(xBtn);
        labelUnmergeList.appendChild(row);
      }
      labelUnmergeSheet.classList.remove("hidden");
    }

    function exitLabels() {
      mode = null;
      labelsActive = false;
      _lastLabelCount = -1;
      labelsBtn.classList.remove("is-active");
      if (labelsBar) labelsBar.classList.add("hidden");
      closeLabelLogoSheet();
      exitLabelSelectMode();
      exitAlbumSelectMode();
      updateScanBar(null);
      labelsSearchInput.value = "";
      labelsSearchBox.classList.add("hidden");
      paintTools();
      if (labelUnmergeSheet) labelUnmergeSheet.classList.add("hidden");
    }
    window.__exitLabels       = exitLabels;
    window.__showLabelAlbums  = showLabelAlbums;

    // Park / unpark for views that BORROW the shared grid and hand it back
    // (the artist view). exitLabels() is a real teardown — it forgets which
    // label was open, so Back would land on a label grid the browser no longer
    // believes it owns (no labels bar, no way back to the list). Parking hides
    // the chrome and closes the sheets but remembers the mode/label, so the
    // artist view's Back restores the labels browser whole.
    function parkLabels() {
      if (!labelsActive) return null;
      const state = {
        mode,
        currentLabelName,
        currentLabelLogoUrl,
        barHidden: labelsBar ? labelsBar.classList.contains("hidden") : true
      };
      closeLabelLogoSheet();
      exitLabelSelectMode();
      exitAlbumSelectMode();
      if (labelUnmergeSheet) labelUnmergeSheet.classList.add("hidden");
      if (labelsBar) labelsBar.classList.add("hidden");
      labelsBtn.classList.remove("is-active");
      // Stops the list re-poll (guarded on mode === "list") from repainting
      // label tiles over the borrowing view.
      mode = null;
      labelsActive = false;
      paintTools();
      return state;
    }
    function unparkLabels(state) {
      if (!state) return;
      mode                = state.mode;
      currentLabelName    = state.currentLabelName;
      currentLabelLogoUrl = state.currentLabelLogoUrl;
      labelsActive        = true;
      labelsBtn.classList.add("is-active");
      if (labelsBar) labelsBar.classList.toggle("hidden", state.barHidden);
      paintTools();
    }
    window.__parkLabels   = parkLabels;
    window.__unparkLabels = unparkLabels;

    // ----- Logo picker sheet -----

    async function saveLogo(url) {
      if (!currentLabelName) return;
      try {
        const r = await fetch("/api/labels/logo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: currentLabelName, url })
        });
        const j = await r.json();
        if (j.ok) {
          currentLabelLogoUrl = j.storedUrl || url; // keep current URL in sync with what the server persisted
          closeLabelLogoSheet();
          showToast("Logo saved", "ok");
        } else {
          showToast(j.error || "Failed to save logo", "error");
        }
      } catch (e) {
        showToast("Failed: " + e.message, "error");
      }
    }

    async function loadLogoCandidates(labelName) {
      if (!logoCandidatesEl) return;
      logoCandidatesEl.innerHTML = '<span class="logo-candidates-hint">Searching Discogs…</span>';
      try {
        const r = await fetch("/api/labels/logo-candidates?label=" + encodeURIComponent(labelName));
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
        const candidates = (j && j.candidates) || [];
        logoCandidatesEl.innerHTML = "";
        if (!candidates.length) {
          logoCandidatesEl.innerHTML = '<span class="logo-candidates-hint">No logos found on Discogs</span>';
          return;
        }
        for (const c of candidates) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "logo-candidate-btn";
          btn.title = c.title || "";
          const img = document.createElement("img");
          img.src = c.img;
          img.alt = c.title || "";
          img.loading = "lazy";
          img.onerror = () => btn.remove();
          btn.appendChild(img);
          btn.addEventListener("click", () => saveLogo(c.img));
          logoCandidatesEl.appendChild(btn);
        }
      } catch (e) {
        logoCandidatesEl.innerHTML = '<span class="logo-candidates-hint">' + (e.message || "Discogs search failed") + '</span>';
      }
    }

    if (labelsLogoBtn) {
      labelsLogoBtn.addEventListener("click", () => {
        if (!logoUrlSheet) return;
        const opening = logoUrlSheet.classList.contains("hidden");
        logoUrlSheet.classList.toggle("hidden");
        if (opening) {
          loadLogoCandidates(currentLabelName || "");
          if (logoUrlInput) {
            if (currentLabelLogoUrl) logoUrlInput.value = currentLabelLogoUrl; // pre-fill existing logo URL
            logoUrlInput.focus();
          }
        }
      });
    }
    if (logoUrlCancel) {
      logoUrlCancel.addEventListener("click", closeLabelLogoSheet);
    }
    if (logoUrlSave) {
      logoUrlSave.addEventListener("click", async () => {
        const url = logoUrlInput ? logoUrlInput.value.trim() : "";
        if (!url || !currentLabelName) return;
        logoUrlSave.disabled = true;
        try {
          await saveLogo(url);
        } finally {
          logoUrlSave.disabled = false;
        }
      });
    }

    function makeScanLogLink() {
      const wrap = document.createElement("div");
      wrap.className = "scan-log-link";
      wrap.style.cssText = "text-align:center;margin:8px 0 4px;font-size:0.8em;opacity:0.7;";
      const a = document.createElement("a");
      a.href = "/api/labels-scan-log";
      a.download = "labels-scan.log";
      a.textContent = "Download scan log";
      a.style.cssText = "color:inherit;text-decoration:underline;cursor:pointer;margin-right:12px;";
      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copy log";
      copyBtn.style.cssText = "background:none;border:none;color:inherit;text-decoration:underline;cursor:pointer;font-size:inherit;padding:0;";
      copyBtn.addEventListener("click", async () => {
        try {
          const r = await fetch("/api/labels-scan-log");
          const text = await r.text();
          await navigator.clipboard.writeText(text);
          copyBtn.textContent = "Copied!";
          setTimeout(() => { copyBtn.textContent = "Copy log"; }, 2000);
        } catch (e) { copyBtn.textContent = "Failed"; setTimeout(() => { copyBtn.textContent = "Copy log"; }, 2000); }
      });
      wrap.appendChild(a);
      wrap.appendChild(copyBtn);
      return wrap;
    }

    async function showLabelsList(isRepoll = false) {
      if (window.__leavePlaylistScreens) window.__leavePlaylistScreens();
      if (!isRepoll) {
        if (window.__clearSearchIfActive) window.__clearSearchIfActive();  // drop stale search results
        exitAlbumSelectMode(); closeLabelLogoSheet(); currentLabelName = null; currentLabelLogoUrl = null;
      }
      const restoreScroll = !isRepoll && _labelsScrollSaved > 0;
      mode = "list";
      labelsActive = true;
      leaveLibraryWall();   // labels own the shared grid now — stop the wall's infinite scroll
      { const _hv = document.getElementById("home-view"); if (_hv) _hv.classList.add("hidden"); }
      grid.classList.remove("hidden");
      if (window.__setTopbarNav) window.__setTopbarNav(true, false, false);   // Back (to Home), no Refresh, no search
      labelsBtn.classList.add("is-active");
      if (labelsBar) labelsBar.classList.add("hidden");
      if (!isRepoll) { labelsSearchInput.value = ""; labelsSearchBox.classList.add("hidden"); }
      paintTools();
      setBanner(null);
      setCountText("Labels");
      if (!isRepoll) { renderSkeletons(computeAlbumCount()); _lastLabelCount = -1; }
      try {
        const r = await fetch("/api/filters/labels");
        const j = await r.json();
        if (!(labelsActive && mode === "list")) return;
        if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
        const minAlbums = labelMin();
        const labels = (j.labels || []).filter(lb => (lb.albumCount || 1) >= minAlbums);
        const pct = Math.round((j.progress || 0) * 100);
        if (!labels.length) {
          if (!isRepoll) grid.innerHTML = "";
          if (j.scanning) {
            const msg = pct > 0
              ? "Scanning for record labels… " + pct + "% complete."
              : "Building library index…";
            setBanner(msg, false);
            updateScanBar(j.scanning ? (j.progress || 0) : null);
            // Re-poll every 4 s while the scan is running
            setTimeout(() => { if (mode === "list") showLabelsList(true); }, 4000);
          } else {
            setBanner(j.lookups
              ? "No labels found yet — the background scan is looking them up. This can take a few minutes for large libraries."
              : "No labels yet: none of the albums' files carry a LABEL tag.", false);
            if (!j.lookups) return;
            // Show a rescan button so the user can retry without restarting the server.
            const rescanBtn = document.createElement("button");
            rescanBtn.className = "action-btn primary";
            rescanBtn.style.cssText = "margin:16px auto;";
            rescanBtn.textContent = "Rescan now";
            rescanBtn.addEventListener("click", async () => {
              rescanBtn.disabled = true;
              rescanBtn.textContent = "Starting…";
              try {
                await fetch("/api/labels/rescan", { method: "POST",
                  headers: { "Content-Type": "application/json" }, body: "{}" });
                _lastLabelCount = -1;
                setTimeout(() => { if (mode === "list") showLabelsList(false); }, 1000);
              } catch (e) { rescanBtn.disabled = false; rescanBtn.textContent = "Rescan now"; }
            });
            grid.appendChild(rescanBtn);
            grid.appendChild(makeScanLogLink());
          }
          return;
        }
        setCountText("Labels");
        updateScanBar(j.scanning ? (j.progress || 0) : null);
        // Only re-render tiles on first load or when the scan finishes.
        // During an active scan, just update the count text so the grid stays
        // stable — no flash every 5 s as new labels trickle in.
        if (_lastLabelCount <= 0 || !j.scanning) {
          renderLabelTiles(labels);
          const oldLink = grid.querySelector(".scan-log-link");
          if (oldLink) oldLink.remove();
          if (!j.scanning && j.lookups) grid.appendChild(makeScanLogLink());   // nothing to log when the tags are all there is
          if (_labelsScrollTarget && mainEl) {
            // Arrived via a deep-link (album view / search chip). Scroll the grid
            // to that label's tile so "back" lands on it instead of the top.
            const want = _labelsScrollTarget.trim().toLowerCase();
            _labelsScrollTarget = null;
            requestAnimationFrame(() => {
              let found = null;
              grid.querySelectorAll(".label-tile").forEach(t => {
                if (found) return;
                const tt = t.querySelector(".album-title");
                if (tt && tt.textContent.trim().toLowerCase() === want) found = t;
              });
              if (found) found.scrollIntoView({ block: "center" });
            });
          } else if (restoreScroll && mainEl) {
            requestAnimationFrame(() => { mainEl.scrollTop = _labelsScrollSaved; _labelsScrollSaved = 0; });
          }
        }
        // Keep polling while the scan is running
        if (j.scanning) {
          setTimeout(() => { if (mode === "list") showLabelsList(true); }, 5000);
        }
      } catch (e) {
        if (!isRepoll) grid.innerHTML = "";
        setBanner("Couldn't load labels: " + e.message, true);
        // Retry after 10 s so a transient network error doesn't stop updates permanently.
        setTimeout(() => { if (mode === "list") showLabelsList(true); }, 10000);
      }
    }

    function setLabelTextArt(artEl, title) {
      artEl.className = "album-art-wrap is-label-text";
      artEl.innerHTML = "";
      artEl.style.fontSize = "";
      const words = (title || "").trim().split(/\s+/).filter(Boolean);
      (words.length ? words : ["?"]).forEach(word => {
        const span = document.createElement("span");
        span.textContent = word;
        artEl.appendChild(span);
      });
    }

    function renderLabelTiles(labels) {
      lastLabels = labels;
      if (labels.length === _lastLabelCount && !labelsSelectMode) return; // no change — skip re-render
      if (labelsSelectMode) exitLabelSelectMode(); // re-render clears tile selection state
      _lastLabelCount = labels.length;
      grid.innerHTML = "";
      const frag = document.createDocumentFragment();
      // The server sends them # to Z; Z to # is the same list turned round.
      for (const lb of (labelsReversed ? labels.slice().reverse() : labels)) {
        const btn = document.createElement("button");
        btn.className = "album label-tile";
        btn.type = "button";
        btn.setAttribute("aria-label", lb.title || "Label");
        btn.dataset.labelKey = lb.key || "";
        const art = document.createElement("div");
        if (lb.logo_url) {
          art.className = "album-art-wrap is-label-logo";
          const img = document.createElement("img");
          img.loading = "lazy"; img.alt = "";
          img.src = lb.logo_url;
          img.onerror = () => { img.remove(); setLabelTextArt(art, lb.title); };
          art.appendChild(img);
        } else {
          setLabelTextArt(art, lb.title);
        }
        const meta = document.createElement("div");
        meta.className = "album-meta";
        const titleEl  = document.createElement("div"); titleEl.className  = "album-title";  titleEl.textContent  = lb.title || "";
        const artistEl = document.createElement("div"); artistEl.className = "album-artist"; artistEl.textContent = lb.subtitle || "";
        meta.appendChild(titleEl);
        meta.appendChild(artistEl);
        if (lb.mergedFrom && lb.mergedFrom.length > 0) {
          const mergedEl = document.createElement("div");
          mergedEl.className = "album-merged-info";
          mergedEl.textContent = lb.mergedFrom.length + " merged";
          mergedEl.title = "Tap to manage merged labels";
          mergedEl.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!labelsSelectMode) showUnmergeSheet(lb.title, lb.mergedFrom);
          });
          meta.appendChild(mergedEl);
        }
        btn.appendChild(art);
        btn.appendChild(meta);
        btn.addEventListener("click", () => {
          if (labelsSelectMode) handleLabelTileSelect(btn, lb);
          else showLabelAlbums(lb.title, true);
        });
        addLongPress(btn, () => {
          if (!labelsSelectMode) enterLabelSelectMode();
          handleLabelTileSelect(btn, lb);
        });
        frag.appendChild(btn);
      }
      grid.appendChild(frag);
      applyLabelFilter();   // a search under way still holds after a re-poll
    }

    function closeLabelLogoSheet() {
      if (logoUrlSheet) logoUrlSheet.classList.add("hidden");
      if (logoUrlInput) logoUrlInput.value = "";
      if (logoCandidatesEl) logoCandidatesEl.innerHTML = "";
    }

    // Where ‹ goes from one label's albums when they were opened from an
    // album's page: back to that page, not to the list of all labels (v0.6.24).
    let _labelsReturn = null;
    async function showLabelAlbums(name, fromLabelsList = false, returnTo = null) {
      if (window.__leavePlaylistScreens) window.__leavePlaylistScreens();
      if (window.__clearSearchIfActive) window.__clearSearchIfActive();  // drop stale search results
      _labelsReturn = returnTo && returnTo.album ? returnTo : null;
      if (fromLabelsList) {
        // Came from a tap on the Labels grid — remember the grid scroll position.
        _labelsScrollSaved = mainEl ? mainEl.scrollTop : 0;
        _labelsScrollTarget = null;
      } else {
        // Deep-linked from an album view or search chip — there's no Labels-grid
        // scroll position to restore, so remember which label to scroll to on back.
        _labelsScrollSaved = 0;
        _labelsScrollTarget = name;
      }
      exitAlbumSelectMode();
      closeLabelLogoSheet();
      currentLabelName = name;
      mode = "albums";
      labelsActive = true;
      leaveLibraryWall();   // label albums own the shared grid now — stop the wall's infinite scroll
      { const _hv = document.getElementById("home-view"); if (_hv) _hv.classList.add("hidden"); }
      grid.classList.remove("hidden");
      if (window.__setTopbarNav) window.__setTopbarNav(true, false, false);   // Back (to Home), no Refresh, no search
      labelsBtn.classList.add("is-active");
      // The name is the top bar's title and its ‹ goes back to all labels.
      if (labelsBar)   labelsBar.classList.add("hidden");
      if (labelsTitle) labelsTitle.textContent = name;
      paintTools();
      setBanner(null);
      setCountText(name);
      renderSkeletons(computeAlbumCount());
      try {
        const r = await fetch("/api/label-albums?label=" + encodeURIComponent(name) +
                              "&order=" + encodeURIComponent(labelOrder()));
        const j = await r.json();
        // ‹ (or Home) while this was on its way: it no longer belongs on screen.
        if (!stillOnLabel()) return;
        if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
        currentLabelLogoUrl = j.logo_url || null; // expose to logo picker
        const albums = j.albums || [];
        if (!albums.length) {
          grid.innerHTML = "";
          setBanner("No albums found for this label.", false);
          return;
        }
        setCountText(name);
        grid.innerHTML = "";
        const frag = document.createDocumentFragment();
        for (const a of albums) {
          // Label albums carry FULL-LIBRARY offsets; without the explicit
          // filter:null override a lingering genre/tag filter would resolve
          // them against the wrong (filtered) list — the offset misses, and
          // the stale-offset defense correctly refuses with "library changed"
          // even though nothing did. (Same override Home rows use.)
          frag.appendChild(buildAlbumTile(a, () => openAlbum(a, { filter: null })));
        }
        grid.appendChild(frag);
      } catch (e) {
        if (!stillOnLabel()) return;
        grid.innerHTML = "";
        setBanner("Couldn't load albums: " + e.message, true);
      }
      function stillOnLabel() { return labelsActive && mode === "albums" && currentLabelName === name; }
    }

    if (labelsBack) labelsBack.addEventListener("click", () => showLabelsList());
    // The top bar's ‹ on one label's albums goes back to all labels, ahead of
    // its usual "go Home" (v0.6.5; the "‹ All labels" pill it replaces is gone).
    {
      const tb = document.getElementById("topbar-back");
      if (tb) tb.addEventListener("click", (e) => {
        if (!(labelsActive && mode === "albums")) return;
        if (window.__artistViewActive && window.__artistViewActive()) return;
        // Opened from an album's page: the usual ‹ (Home) runs, and the album's
        // page comes back over it.
        if (_labelsReturn) {
          const r = _labelsReturn; _labelsReturn = null;
          if (window.__openAlbum) setTimeout(() => window.__openAlbum(r.album, r.opts), 0);
          return;
        }
        e.stopImmediatePropagation();
        showLabelsList();
      }, true);
    }

    window.__exitLabelSelectMode = exitLabelSelectMode;

    if (labelMergeBtn) {
      labelMergeBtn.addEventListener("click", async () => {
        if (labelsSelected.length < 2) return;
        labelMergeBtn.disabled = true;
        try {
          const r = await fetch("/api/labels/merge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: labelsSelected.map(s => ({ key: s.key, display: s.display })) })
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || "Merge failed");
          exitLabelSelectMode();
          _lastLabelCount = -1;
          showLabelsList(false);
        } catch(e) {
          labelMergeBtn.disabled = false;
          if (window.__showToast) window.__showToast("Merge failed: " + e.message, "error");
        }
      });
    }

    if (labelMergeCancelBtn) labelMergeCancelBtn.addEventListener("click", exitLabelSelectMode);

    if (labelUnmergeClose) {
      labelUnmergeClose.addEventListener("click", () => {
        if (labelUnmergeSheet) labelUnmergeSheet.classList.add("hidden");
      });
    }

    labelsBtn.addEventListener("click", () => {
      if (mode) { exitLabels(); loadRandom(); }
      else      { showLabelsList(); }
    });

    // Refresh always returns to the random wall.
    if (refreshBtn) refreshBtn.addEventListener("click", exitLabels);
  })();



  // A selection of albums from anywhere (v0.7.4): the server's — your files,
  // Qobuz, Tidal — go to the zone in one ask; the phone's own go to the
  // phone's player when that is the zone (one queue of everything), and are
  // left out, with a word, when a room or a device is. Before, the phone's
  // were sent to the server with the rest, which knows nothing of them and
  // refused the lot ("offsets required").
  // The zone chosen is this phone's own player ("This phone", as the server
  // names it to the app that owns it).
  const playingOnThisPhone = () => { const z = zones.find(z => z.zone_id === selectedZoneId); return !!(z && z.is_phone && z.display_name === "This phone"); };
  async function invokeAlbumMulti(kind) {
    if (!albumSelected.length) return;
    const phone = albumSelected.filter(isPhoneAlbum);
    const server = albumSelected.filter(a => !isPhoneAlbum(a));
    if (server.length && !selectedZoneId) { showToast("Pick a zone first", "error"); return; }
    const verb = kind === "play_now" ? "Playing" : kind === "play_next" ? "Playing next:" : "Queued";
    const said = [];
    try {
      if (server.length) {
        const r = await fetch("/api/play-multi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offsets: server.map(a => a.offset),
            // Identity per album so a mid-scan stale offset is relocated or
            // refused server-side instead of queueing the wrong records.
            items: server.map(a => ({ offset: a.offset, title: a.title || "", subtitle: a.subtitle || "" })),
            zone_or_output_id: selectedZoneId,
            kind,
            filter_type:   activeFilter ? activeFilter.type   : "",
            filter_value:  activeFilter ? activeFilter.value  : "",
            filter_parent: activeFilter && activeFilter.parent ? activeFilter.parent : ""
          })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        // play-multi now answers 200 with counts when some albums failed, so the
        // count reported has to come from the response, not from what was asked.
        // `total` is omitted — a hand-picked selection is never capped.
        said.push(multiOutcome(verb, j, server.length, null) + " → " + zoneName(selectedZoneId));
      }
      if (phone.length && server.length && !playingOnThisPhone()) {
        // A room or a device is the zone: the server's albums went there, and
        // the phone's can't follow (the server has no copy of them). Said, and
        // left out, rather than played on the phone beside the room.
        said.push("Unable to add music on this phone to queue");
      } else if (phone.length) {
        const dl = window.MusicdDownloads;
        if (!dl || typeof dl.playLocal !== "function") throw new Error("Only the Mandarin app plays music on this phone");
        // Play now: the first plays now and the rest follow it; Queue: at the
        // end, in order; Play next: the app puts each one straight after the
        // playing track, so they are sent last to first and land in order.
        const want = kind === "play_next" || kind === "add_next" ? "play_next" : kind === "play_now" ? "play_now" : "queue";
        const order = want === "play_next" ? phone.slice().reverse() : phone;
        order.forEach((a, i) => {
          const k = want === "play_now" ? (i === 0 && !server.length ? "play_now" : "queue") : want;
          dl.playLocal(phoneKey(a), -1, k);
        });
        said.push(`${server.length ? "Queued" : verb} ${phone.length} album${phone.length === 1 ? "" : "s"} on this phone → This phone`);
      }
      showToast(said.join(" · "));
      exitAlbumSelectMode();
    } catch (e) {
      showToast(e.message, "error");
      updateAlbumActionBar();
    }
  }

  if (albumActionCancelBtn) albumActionCancelBtn.addEventListener("click", exitAlbumSelectMode);

  // ----- Select-menu wiring -------------------------------------------------
  if (selMenuBtn) {
    selMenuBtn.addEventListener("click", (e) => {
      // The document-level dismisser below would otherwise see this very click
      // and shut the menu in the same tick it opened.
      e.stopPropagation();
      const willShow = selMenu.classList.contains("hidden");
      selMenu.classList.toggle("hidden", !willShow);
      selMenuBtn.setAttribute("aria-expanded", String(willShow));
    });
  }
  if (selMenu) {
    selMenu.addEventListener("click", (e) => {
      const item = e.target.closest("[data-sel-act]");
      if (!item) return;
      e.stopPropagation();
      closeSelectMenu();
      const act = item.dataset.selAct;
      if (act === "clear") {
        if (selMenuKind === "tracks") exitTrackSelectMode();
        else exitAlbumSelectMode();
        return;
      }
      if (act === "add") { addSelectionToPlaylist(); return; }
      if (act === "later") {
        if (selMenuKind === "tracks") { if (currentAlbum) setListenLater(currentAlbum.offset, true); exitTrackSelectMode(); }
        else { setListenLater(albumSelected.map(a => a.offset), true); exitAlbumSelectMode(); }
        return;
      }
      if (selMenuKind === "tracks") invokeTrackMulti(act);
      else invokeAlbumMulti(act);
    });
    // Contains-checks rather than a scoped closest(): there are already four
    // document-level click listeners in this file and every popover trigger
    // stops propagation on its own button, so a shared container selector
    // would fight them.
    document.addEventListener("click", (e) => {
      if (selMenu.classList.contains("hidden")) return;
      if (selMenu.contains(e.target)) return;
      if (selMenuBtn && selMenuBtn.contains(e.target)) return;
      closeSelectMenu();
    });
  }

  window.__openAlbum = openAlbum;
  // The Home Screen settings page renders its list from these, so the row
  // vocabulary has exactly one definition (HOME_ROWS) and the settings list
  // cannot describe a row that does not exist.
  window.__downloadedCount = () => downloadList().length;
  window.__homeRowTitles = () => {
    const out = {};
    for (const r of HOME_ROWS) out[r.id] = r.title;
    return out;
  };
  window.__applyHomeLayout = (rows) => {
    if (Array.isArray(rows) && rows.length) homeLayout = rows;
    applyHomeLayout();
    // A row switched back on has never been loaded this session, so give it a
    // chance to fill before the user goes looking for it.
    for (const row of HOME_ROWS) {
      if (!homeRowOn(row.id)) continue;
      if (row.isFresh()) continue;
      row.load();
    }
  };

  // Reflect the opt-in features into the side menu.
  //
  // A menu entry for a feature that is switched off leads to a screen that can
  // only ever be empty — the Labels browser with no scan behind it, Smart Picks
  // with no build. Hiding the entry is part of "off", not decoration.
  //
  // Exported because the settings pane flips these switches and the menu lives
  // elsewhere; both call this rather than reaching into each other's DOM.
  // A key absent from `state` leaves that entry alone, so one failed lookup
  // cannot hide the other feature's entry.
  window.__applyFeatureMenu = (state) => {
    const labelsItem = document.getElementById("menu-item-labels");
    const picksItem  = document.getElementById("menu-item-picks");
    if (labelsItem && typeof state.labels === "boolean") {
      labelsItem.classList.toggle("hidden", !state.labels);
      // The same switch decides whether the Library Focus vocabulary still
      // contains "Record label", and the count badge has to agree with the
      // sheet from the first paint, not from the first time it is opened.
      if (window.__setLabelsFacetAvailable) window.__setLabelsFacetAvailable(state.labels);
    }
    if (picksItem && typeof state.picks === "boolean") {
      picksItem.classList.toggle("hidden", !state.picks);
    }
  };

  // Ask at boot. Two independent calls, so an older server or a transient
  // error on one endpoint does not decide the other entry's visibility.
  // The three side by side (v0.6.10), not one after another.
  async function applyFeatureMenuFromServer() {
    const state = {};
    const ask = async (url) => { try { const r = await fetch(url); return r.ok ? !!(await r.json()).enabled : null; } catch (e) { return null; } };
    const [labels, picks] = await Promise.all([ask("/api/settings/labels"), ask("/api/settings/smart-picks")]);
    // A failed lookup leaves the entry as the markup has it.
    if (labels !== null) state.labels = labels;
    if (picks !== null) state.picks = picks;
    window.__applyFeatureMenu(state);
  }

  window.__buildAlbumTile = (a) => buildAlbumTile(a);
  window.__loadRandom = loadRandom;
  window.__showLibraryWall = showLibraryWall;

  // The library changed under the page (v0.7.3): a streamed album favourited
  // or removed — here, or in the service's own app and found by the watch.
  // Whatever is on screen is redrawn, within the moment: the tile of an
  // album gone (`gone`, its offset) is taken off every wall and row at once,
  // the Home rows are marked stale and reloaded if Home is showing, and the
  // Library wall or the random wall is read again.
  window.__libraryChanged = (opts) => {
    // Albums added or taken away under the page (v0.8.43, the server's mark
    // moved): the Library row read again, on Home now; the Library wall read
    // again if it is at its top and no album is open over it (further down,
    // or under an album, it stays put, and is read again when next opened).
    // Nothing else is reshuffled.
    if (opts && opts.live) {
      homeLibraryKey = "";
      if (homeView && !homeView.classList.contains("hidden")) { if (homeRowOn("library")) loadHomeLibrary(); return; }
      if (libraryWallActive && !labelsActive && (!modal || modal.classList.contains("hidden"))) {
        const m = document.querySelector("main");
        if (m && m.scrollTop < m.clientHeight) showLibraryWall();
      }
      return;
    }
    const gone = opts && opts.gone != null ? String(opts.gone) : null;
    if (gone) for (const el of document.querySelectorAll('.album[data-offset="' + gone + '"]')) el.remove();
    homeRowsLoadedAt = 0; homeUnplayedLoaded = false; homeFavouritesLoaded = false; homeLaterLoaded = false;
    homeHistoryLoaded = false; homeLibraryKey = ""; homePlaylistsLoaded = false;
    if (homeView && !homeView.classList.contains("hidden")) { refreshHomeRows(); return; }
    if (window.__searchActive && window.__searchActive()) return;
    if (window.__artistViewActive && window.__artistViewActive()) return;
    if (labelsActive || favouritesWallActive || laterWallActive) return;
    if (libraryWallActive) { showLibraryWall(); return; }
    if (unplayedWallActive) return;   // a fixed wall: the tile is gone, the rest stands
    if (!grid.classList.contains("hidden") && !gone) loadRandom();
  };

  // The services' favourites checked when the page comes back to Home or to
  // the Library wall (v0.7.3), not only on the server's two-minute clock:
  // an album favourited in the Qobuz or Tidal app on the way home is on the
  // wall by the time it is looked at. Not more than once a half-minute.
  let servicesWatchedAt = 0;
  window.__watchServices = async () => {
    if (window.__musicdOffline || Date.now() - servicesWatchedAt < 30000) return;
    servicesWatchedAt = Date.now();
    try {
      const r = await fetch("/api/services/watch", { method: "POST" });
      const j = r.ok ? await r.json() : null;
      if (j && j.changed) window.__libraryChanged();
    } catch (e) { /* next time */ }
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") window.__watchServices(); });
  window.__showToast = (msg, kind) => showToast(msg, kind);

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
})();