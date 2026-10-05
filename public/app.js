/*
 * Random Albums — frontend
 *
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 */

/* ------------------------------------------------------------------ */
/*  Signed out (another device signed this one out, or the account was */
/*  reset on the server): any API answer that says so goes to sign-in.  */
/* ------------------------------------------------------------------ */
(function signOutGuard() {
  const real = window.fetch.bind(window);
  let leaving = false;
  window.fetch = async function (input, init) {
    const r = await real(input, init);
    if (r.status === 401 && !leaving) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const u = new URL(url, location.href);
      if (u.origin === location.origin && u.pathname.startsWith("/api/") && !u.pathname.startsWith("/api/auth/")) {
        leaving = true;
        location.replace("/login?next=" + encodeURIComponent(location.pathname + location.search));
      }
    }
    return r;
  };
})();

/* ------------------------------------------------------------------ */
/*  Later, once the first screen is up (v0.6.10): what the page asks   */
/*  for at start but nothing on that screen shows waits until the page */
/*  has loaded and settled, so the rows and covers go first.           */
/* ------------------------------------------------------------------ */
window.__afterStart = (fn) => {
  const go = () => setTimeout(() => {
    if (window.requestIdleCallback) requestIdleCallback(() => fn(), { timeout: 2000 }); else fn();
  }, 1500);
  if (document.readyState === "complete") go(); else window.addEventListener("load", go, { once: true });
};

/* ------------------------------------------------------------------ */
/*  UI Settings (v0.6.5, as Rouen v1.8.77 has them): text size, grid   */
/*  layout and tile size — per device, in localStorage, painted as     */
/*  custom properties on <html> so every screen reads the same numbers */
/*  without being told. Nothing here rebuilds a tile.                  */
/*    --ui-text   album and artist text, a multiplier on each size     */
/*    --ui-title  a grid screen's title in the top bar, a playlist name*/
/*    --ui-tile   the Home carousels' tile width (150px × this)        */
/*    --grid-cols every .album-grid's columns, when not the screen's   */
/* ------------------------------------------------------------------ */
(function uiSettings() {
  const OPTS = {
    // +75% and +100% are a desktop's (v0.6.6): elsewhere they read as +50%.
    text:   { key: "rra-ui-text",  def: "1",    allowed: ["1", "1.1", "1.25", "1.5", "1.75", "2"] },
    title:  { key: "rra-ui-title", def: "1",    allowed: ["1", "1.1", "1.25", "1.5", "1.75", "2"] },
    // Every other piece of text: the side menu, Home's headings, Settings, the
    // album and Now playing views, the player bar (v0.6.6).
    menu:   { key: "rra-ui-menu",  def: "1",    allowed: ["1", "1.1", "1.25", "1.5", "1.75", "2"] },
    layout: { key: "rra-ui-cols",  def: "auto", allowed: ["auto", "3", "2", "list"] },
    tile:   { key: "rra-ui-tile",  def: "1",    allowed: ["0.5", "0.75", "0.9", "1", "1.1", "1.25", "1.5"] }
  };
  const mem = {};
  // A desktop: a large screen with a mouse (the test Now playing's corner
  // button uses). Only there do the text sizes go past +50%.
  const desktopQ = window.matchMedia ? window.matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)") : null;
  const isDesktop = () => !!(desktopQ && desktopQ.matches);
  const BIG = ["1.75", "2"];
  const TEXT = ["text", "title", "menu"];
  // Text sizes only: "2" is also the Grid layout's 2 columns.
  function get(k) {
    const v = stored(k);
    return (TEXT.indexOf(k) > -1 && BIG.indexOf(v) > -1 && !isDesktop()) ? "1.5" : v;
  }
  function stored(k) {
    if (k in mem) return mem[k];
    const o = OPTS[k];
    let v = null;
    try {
      v = localStorage.getItem(o.key);
      // List was the top bar's grid ⇄ list button until v0.6.5.
      if (v === null && k === "layout" && localStorage.getItem("rra-album-view") === "list") v = "list";
    } catch (e) {} // localStorage optional — the default stands
    return (mem[k] = o.allowed.indexOf(v) > -1 ? v : o.def);
  }
  // The screen's own column count, by the SAME breakpoints style.css uses for
  // .album-grid (keep the two in step).
  function baseCols() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w >= 1200) return 9;
    if (w >= 768) return h >= w ? 5 : 7;
    return 3;
  }
  // "3" or "2" fixes the count; Auto (and List, for the count a wall asks for)
  // is the screen's own count divided by the tile size: bigger tiles, fewer columns.
  function cols() {
    const l = get("layout");
    if (l === "3" || l === "2") return Number(l);
    return Math.max(1, Math.round(baseCols() / parseFloat(get("tile"))));
  }
  function apply() {
    const root = document.documentElement.style;
    const put = (prop, v, def) => { if (v === def) root.removeProperty(prop); else root.setProperty(prop, v); };
    put("--ui-text", get("text"), "1");
    put("--ui-title", get("title"), "1");
    put("--ui-menu", get("menu"), "1");
    put("--ui-tile", get("tile"), "1");
    const c = cols();
    if (c === baseCols()) root.removeProperty("--grid-cols"); else root.setProperty("--grid-cols", String(c));
    const grid = document.getElementById("album-grid");
    if (grid) grid.classList.toggle("as-list", get("layout") === "list");
  }
  function set(k, v) {
    const o = OPTS[k];
    if (!o || o.allowed.indexOf(v) < 0) return;
    try { localStorage.setItem(o.key, v); } catch (e) {} // localStorage optional — applied for this session regardless
    mem[k] = v;
    apply();
    // The columns moved at once (CSS); the random wall's COUNT was a screenful
    // at the old columns, so it asks again when that is now a different number.
    if ((k === "layout" || k === "tile") && window.__refreshWallCount) window.__refreshWallCount();
  }
  window.addEventListener("resize", apply);
  if (desktopQ && desktopQ.addEventListener) desktopQ.addEventListener("change", apply);
  window.__uiPrefs = { get, set, cols, apply, OPTS, isDesktop };
  apply();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply);
})();

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
    const label = { local: "Local albums", qobuz: "Qobuz" }[kind];
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
  let discoverActive = false;       // viewing the Discover screen?
  let discoverSeq = 0;              // orphans in-flight Discover fetches
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
  } catch (e) {} // corrupt localStorage entry — start with no filter
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
        () => { try { DL.play(d.id); } catch (e) {} if (window.__showToast) window.__showToast("Not in the library right now — playing from this phone"); });
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
    const list = localList();
    if (!list.length) { grid.innerHTML = ""; setBanner("Nothing on this phone yet — choose a folder in Settings → Music Folders.", false); return; }
    setBanner(null);
    grid.innerHTML = "";
    grid.appendChild(localTiles(list));
  }
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
      try { localStorage.removeItem("rra-filter"); } catch (e) {} // localStorage optional (private browsing)
    }
    updateCountReadout(null);   // hide the genre/label breadcrumb
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
    } catch (e) {} // localStorage optional / over quota — persistence is best-effort
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
    let aj = null;
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
    let j = null;
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

  /*
   * DISCOVER — new records by the acts you play.
   *
   * The screen this app did not have. Smart Picks is LATERAL (acts next to
   * your library that you do not own) and the Pitchfork and service screens
   * are EDITORIAL (what somebody else rates this week); neither can answer
   * "has anyone I actually listen to put something out", because that question
   * needs your listening history and nobody outside this box has it.
   *
   * The rows are the same KIND of answer the share card's suggestions give —
   * a record that is either in your library or on a service — so they are
   * built by the same goRow() and go to the same places. What differs is the
   * emphasis: here the RECORD is the headline and the act is the quiet line,
   * because you already know the act. That is the whole point of the screen.
   */
  async function showDiscover() {
    enterFullWall("Discover");
    discoverActive = true;
    const mySeq = ++discoverSeq;
    let j = null;
    try {
      const r = await fetch("/api/discover");
      j = await r.json();
      // A 503 while pairing carries a real explanation. Dropping it for the
      // generic message throws away the one thing that says what to do.
      if (!r.ok && !(j && j.error)) j = { error: "HTTP " + r.status };
    } catch (e) {
      j = null;
    }
    if (!discoverActive || mySeq !== discoverSeq) return;   // the user moved on
    grid.innerHTML = "";
    if (!j || j.error) {
      setBanner(j && j.error
        ? ("Couldn't load Discover — " + j.error)
        : "Couldn't load Discover — the extension didn't answer. Try again.", true);
      return;
    }
    if (!j.enabled) {
      setBanner("Discover is switched off. Turn it on in Settings \u2192 Setup \u2192 Discover and " +
                "it will look for new records by the artists you play.", false);
      return;
    }
    const releases = j.releases || [];
    if (!releases.length) {
      // "Building" and "found nothing" are different answers and the screen
      // says which: the first is worth coming back to in a minute, the second
      // is not.
      setBanner(j.building
        ? "Looking for new records by the artists you play \u2014 come back shortly."
        : "Nothing new from the artists you play in the last " +
          (j.window_days || 60) + " days. This rebuilds every day.", false);
      return;
    }
    setBanner(null, false);

    if (!window.__goRow) {
      // The share overlay's closure owns the row builder and publishes it at
      // load. Nothing can reach this screen before that has run, so this is a
      // guard against a future reordering rather than a live case — and a
      // silent empty screen would be a worse way to find out.
      setBanner("Couldn't draw the list — reload the app.", true);
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "discover-list";
    for (const rel of releases) {
      if (!rel || !rel.album) continue;
      wrap.appendChild(window.__goRow(rel, rel.album, discoverSubLine(rel),
                                      discoverArt(rel)));
    }
    grid.appendChild(wrap);

    // The Qobuz links upgraded AFTER the rows are on screen and never before
    // them — a page read per row, and a failure leaves the search link that is
    // already there. Not awaited, for the same reason.
    if (window.__upgradeQobuzLinks) {
      window.__upgradeQobuzLinks(releases, {
        container: wrap, current: () => discoverActive && mySeq === discoverSeq,
        album: r => r.album, artist: r => r.artist,
      });
    }
  }
  window.__showDiscover = showDiscover;

  /*
   * Where a release's cover comes from, or "" for none.
   *
   * ROON'S OWN ART WINS WHENEVER THERE IS ANY. A record the library already
   * holds has an image_key, and that art is served from this box, is already
   * cached, and is the same picture the album shows everywhere else in the
   * app — using Deezer's copy for it would put two different covers on the
   * same record on two different screens.
   *
   * Everything else falls back to the cover Deezer named during the build,
   * loaded straight from their CDN. That is what the Smart Picks cards and the
   * Pitchfork grid already do with their services' images, so it introduces no
   * new kind of request; rowArt() handles the ones that never arrive.
   */
  function discoverArt(rel) {
    if (rel.image_key) {
      return "/api/image/" + encodeURIComponent(rel.image_key) + "?size=160";
    }
    return rel.cover || "";
  }

  /*
   * The quiet line under a release: who made it, and when it came out.
   *
   * The DATE and not the year. A screen whose whole subject is what is new has
   * to distinguish last week from ten months ago, and "2026" cannot — every
   * row would read the same for the first eleven months of a year.
   */
  function discoverSubLine(rel) {
    const when = discoverWhen(rel.release_date);
    return when ? (rel.artist + " \u00b7 " + when) : rel.artist;
  }

  /*
   * A release date as a human distance: "today", "3 days ago", "2 weeks ago",
   * then the date itself.
   *
   * Compared in whole DAYS, from the local midnight of each — not by
   * subtracting timestamps. A release dated yesterday afternoon is one day
   * old at any hour of today, and an hours-based rule calls it "today" all
   * morning and "yesterday" all evening for the same record.
   */
  function discoverWhen(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ""));
    if (!m) return "";
    const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const now = new Date();
    const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((midnight(now) - midnight(then)) / 86400000);
    if (!Number.isFinite(days) || days < 0) return "";
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return days + " days ago";
    if (days < 14) return "last week";
    if (days < 60) return Math.floor(days / 7) + " weeks ago";
    return then.toLocaleDateString(undefined, { month: "short", year: "numeric" });
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
      try { localStorage.removeItem("rra-filter"); } catch (e) {} // localStorage optional (private browsing)
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
    // Discover joins the same ritual, and for the same reason: its fetch is
    // slower than most (the server resolves every row against the library), so
    // it is the likeliest of all of them to land after the user has moved on.
    discoverActive = false;
    playlistSeq++;
    smartSeq++;
    userPlSeq++;
    smartPicksSeq++;
    discoverSeq++;
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
      if (firstPage) { grid.innerHTML = ""; setBanner(null); }
      const frag = document.createDocumentFragment();
      for (const a of albums) frag.appendChild(homeTile(a));   // filter:null → offsets resolve
      grid.appendChild(frag);
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
      // In the top bar (v0.6.5, as Rouen v1.8.78), at its right-hand end where
      // Home keeps its search: Focus, Sort, then the magnifier in the corner.
      bar.className = "library-controls in-topbar";
      const row = document.querySelector(".topbar-row");
      const before = document.getElementById("labels-tools");
      if (row) row.insertBefore(bar, before && before.parentNode === row ? before : null);
      else grid.parentNode.insertBefore(bar, grid);
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
    const refocus = act && bar.contains(act) && act.className
      ? (String(act.className).split(" ").find(c => c !== "lib-ctl" && c) || "lib-ctl")
      : null;
    // Typing survives the rebuild applyLibView() does after every keystroke.
    // `libFilterOpen` is the truth; the live node is only consulted for where
    // the caret was.
    const typing = bar.querySelector(".lib-filter-input");
    const caret = typing ? typing.selectionStart : 0;

    bar.innerHTML = "";
    // Roon's own order on this screen: Focus left, Sort right, then the
    // magnifier that narrows the list. Matching it means the row reads the
    // same way in both apps rather than being a third arrangement to learn.
    bar.appendChild(buildLibFocusButton());
    bar.appendChild(buildLibSortButton());
    bar.appendChild(buildLibFilterControl(libFilterOpen));
    bar.classList.toggle("hidden", !libraryWallActive);
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
      const again = bar.querySelector(".lib-filter-input");
      if (again) {
        again.focus();
        try { again.setSelectionRange(caret, caret); }
        catch (e) { /* type="search" refuses setSelectionRange on some engines */ }
      }
    } else if (refocus) {
      const again = bar.querySelector("." + refocus);
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
  function buildLibFocusButton() {
    const n = libFocusCount();
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
    b.addEventListener("click", () => openLibFocusSheet(null));
    return b;
  }

  // `Album name ↑ ⌄`. The arrow is a LABEL here, not a control — it says which
  // way the current sort runs, and tapping anywhere on the button opens the
  // sheet where it can be changed.
  function buildLibSortButton() {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lib-ctl lib-ctl-sort";

    const text = document.createElement("span");
    text.className = "lib-ctl-text";
    text.textContent = libSortLabel();
    b.appendChild(text);

    const arrow = document.createElement("span");
    arrow.className = "lib-ctl-arrow";
    arrow.setAttribute("aria-hidden", "true");
    // Random has no direction to show, so the slot carries the reshuffle glyph
    // instead — the same symbol the sort sheet's Random row re-taps to.
    arrow.textContent = libSortHasDir(libView.sort)
      ? (libView.dir === "desc" ? "↓" : "↑") : "⟳";
    b.appendChild(arrow);

    const caret = document.createElement("span");
    caret.className = "lib-ctl-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = "⌄";
    b.appendChild(caret);

    b.setAttribute("aria-label", libSortHasDir(libView.sort)
      ? "Sort — " + libSortLabel() + ", " + libDirLabel()
      : "Sort — " + libSortLabel());
    b.addEventListener("click", openLibSortSheet);
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
    const verb = kind === "queue" ? "Queued" : "Playing";
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

  // Turn a smart playlist into a real Roon playlist.
  //
  // Roon's extension API has NO playlist write of any kind — no create, add,
  // remove or reorder, and no "Add to Playlist" action anywhere in the browse
  // tree. Roon has left that request unanswered since 2017. What Roon DOES
  // offer is saving the current queue as a playlist from its own remote, so the
  // extension does the half it can (assembling the queue in the right order)
  // and then says exactly which two taps finish the job.
  async function sendSmartPlaylistToQueue(sp, btn) {
    const zsel = document.getElementById("zone-select");
    const zone = (zsel && zsel.value) || selectedZoneId;
    if (!zone) { showToast("Choose a zone first", "error"); return; }

    // Disclose the cap BEFORE asking, not after: the confirm destroys the
    // existing queue, and a user agreeing to "send 1,179 albums" would not
    // necessarily agree to "destroy the queue to send 400 of them".
    const capNote = (typeof sp.album_total === "number" && sp.album_total > SMART_SEND_MAX)
      ? `\n\nOnly the first ${SMART_SEND_MAX} of ${sp.album_total} albums fit in one go.`
      : "";
    const ok = await confirmDialog(
      `Queue "${sp.name}" to ${(zsel && zsel.selectedOptions[0] && zsel.selectedOptions[0].textContent) || "this zone"}?\n\n` +
      "This replaces what's in the queue now." +
      capNote);
    if (!ok) return;

    btn.disabled = true;
    try {
      const r = await fetch(`/api/smart-playlist/albums?id=${encodeURIComponent(sp.id)}&max=${SMART_SEND_MAX}`,
                            { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(j.error || "Couldn't read this playlist", "error"); return; }
      const albums = j.albums || [];
      if (!albums.length) { showToast("Nothing matches this Dynamic Playlist", "error"); return; }

      const pr = await fetch("/api/play-multi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: albums.map(a => ({ offset: a.offset, title: a.title, subtitle: a.subtitle })),
          zone_or_output_id: zone,
          // play_now on the first album, queue for the rest — that is what
          // play-multi does, and it is what builds an ordered queue.
          kind: "play_now"
        })
      });
      const pj = await pr.json().catch(() => ({}));
      if (!pr.ok) { showToast(pj.error || "Sonos refused that", "error"); return; }
      showToast(multiOutcome("Queued", pj, albums.length, smartMatched(j)), null, TOAST_REPORT_MS);
    } catch (e) {
      // Same reasoning as playSmartPlaylist: the server run outlives our fetch.
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
    if (c.library && homeLibrary && c.librarySort === libSortKey()) {
      renderHomeLibrary(c.library);
      homeLibraryKey = c.librarySort;   // hydrated in the current order — no refetch
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

  const SOURCE_LABEL = { local: "Local albums", qobuz: "Qobuz" };
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
      // Long press ARMS selection without selecting the tile under the finger.
      // Pressing something and having it become selected is how you end up
      // with a selection you didn't ask for when you only wanted the mode.
      addLongPress(btn, () => {
        if (!albumSelectMode) enterAlbumSelectMode();
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
  // count; hidden on the plain wall. Counts were removed from all screens.
  function updateCountReadout(filteredTotal) {
    const el = document.getElementById("album-count");
    if (!el) return;
    if (labelsActive) return;   // labels browser manages its own header text
    if (activeFilter) {
      el.textContent = activeFilter.label || activeFilter.value;   // group label (e.g. "Rock/Metal") if set
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
  async function loadZones() {
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

    // Reset bio sections
    document.getElementById("album-bio-section").classList.add("hidden");
    document.getElementById("album-bio-toggle").classList.add("hidden");
    document.getElementById("album-bio-source").classList.add("hidden");
    document.getElementById("album-bio-text").dataset.clipped = "true";
    setModalSource(album);   // tile data may already carry it; refreshed below from the detail response
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

  async function fetchNowPlayingDetail(zoneId) {
    const r = await fetch(`/api/album/now-playing?zone=${encodeURIComponent(zoneId)}`);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${r.status}`);
    }
    const j = await r.json();
    if (j.album) {
      setModalSource(j.album);   // authoritative: the server resolved this album
      if (j.album.title)    modalTitle.textContent = j.album.title;
      if (j.album.subtitle) setModalArtist(j.album.subtitle);
      if (j.album.image_key) {
        modalImg.src = `/api/image/${encodeURIComponent(j.album.image_key)}?size=800`;
        setModalAmbient(modalImg.src);
      }
    }
    const wrap = document.querySelector(".track-list-wrap");
    if ((j.tracks || []).length) {
      wrap.classList.remove("hidden");
      modalTracks.innerHTML = "";
      for (const t of j.tracks) {
        const li = document.createElement("li");
        // Two-line rows (queue-tab style): title over the FULL artist credit,
        // stacked in a .t-text column so multi-artist tracks aren't clipped.
        const tx = document.createElement("div"); tx.className = "t-text";
        const ti = document.createElement("span"); ti.className = "t-title";
        ti.textContent = t.title || "";
        const su = document.createElement("span"); su.className = "t-sub";
        const [subText, len] = splitTrackLength(t.subtitle);
        su.textContent = subText;
        tx.appendChild(ti); tx.appendChild(su);
        li.appendChild(tx);
        if (len) { const ln = document.createElement("span"); ln.className = "t-len"; ln.textContent = len; li.appendChild(ln); }
        modalTracks.appendChild(li);
      }
    } else {
      wrap.classList.add("hidden");
    }
  }

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

  async function loadQueue() {
    const zoneId = queueZoneId();
    if (!zoneId) return;
    const summary = document.getElementById("queue-summary");
    const list    = document.getElementById("queue-list");
    const empty   = document.getElementById("queue-empty");
    summary.textContent = "Loading queue…";
    list.innerHTML = "";
    // The rows about to be discarded are the ones the picks point at, so the
    // selection goes with them. Select MODE goes too: leaving it on with an
    // empty selection shows an action bar over rows nobody has picked yet.
    historySelectMode = false;
    historySelected = [];
    empty.classList.add("hidden");
    try {
      const r = await fetch(`/api/queue?zone=${encodeURIComponent(zoneId)}`);
      const j = await r.json();
      const items = j.items || [];
      const history = Array.isArray(j.history) ? j.history : [];
      // Only truly empty when there is nothing either side of the divider. A
      // queue that has run out but played twenty tracks is not an empty screen.
      if (!items.length && !history.length) {
        summary.textContent = "";
        empty.classList.remove("hidden");
        return;
      }
      let totalSec = 0;
      for (const it of items) if (it.length) totalSec += it.length;
      summary.textContent = items.length
        ? `${items.length} track${items.length === 1 ? "" : "s"} · ${fmtDuration(totalSec)} remaining`
        : "Nothing more queued";

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

        const art = document.createElement("img"); art.className = "q-art";
        if (it.image_key) art.src = `/api/image/${encodeURIComponent(it.image_key)}?size=120`;
        else art.style.visibility = "hidden";
        const tx = document.createElement("div"); tx.className = "q-text";
        const tt = document.createElement("div"); tt.className = "q-title";  tt.textContent = it.title || "";
        const ts = document.createElement("div"); ts.className = "q-sub";    ts.textContent = it.subtitle || "";
        tx.appendChild(tt); tx.appendChild(ts);
        const len = document.createElement("span"); len.className = "q-len";
        if (it.length) len.textContent = fmtDuration(it.length);
        li.appendChild(art); li.appendChild(tx); li.appendChild(len);

        if (i !== 0) {
          li.addEventListener("click", async () => {
            const trackName = it.title || "this track";
            // confirmDialog, not window.confirm: a native confirm can be left
            // open when the app is backgrounded and then resolves on reopen,
            // firing the request into a network stack that is still coming
            // back up. An in-page sheet cannot be resolved by backgrounding.
            if (!await confirmDialog(`Play from "${trackName}"?`)) return;
            const epochAtSend = hiddenEpoch;
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
                return;
              }
              // Give Roon a moment, then re-pull the queue so the "now playing"
              // marker moves and earlier-played tracks fall away.
              setTimeout(loadQueue, 600);
            } catch (e) {
              // Backgrounded mid-flight. iOS killed the connection and handed
              // us the rejection on reopen, so this is not a failure the user
              // caused or can act on — and Roon has almost certainly already
              // played the track. Re-pull the queue (the success path's own
              // follow-up never ran) and say nothing, rather than alerting
              // about a tap made minutes ago.
              if (hiddenEpoch !== epochAtSend) { loadQueue(); return; }
              showToast("Couldn't play from here: " + e.message, "error");
            }
          });
        }

        list.appendChild(li);
      }
    } catch (e) {
      summary.textContent = "Couldn't load queue: " + e.message;
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
    try { sessionStorage.removeItem("rra-modal"); } catch (e) {} // sessionStorage optional
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
      const n = c.tracks || 0;
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

  // Inside the Android app only (its MusicdDownloads bridge): keep this album
  // on the phone, or take it off. Browsers and the iPhone app never see it.
  function downloadMenuItem(album) {
    const dl = window.MusicdDownloads;
    if (!dl || !album || typeof album.offset !== "number") return [];
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
      play_next: "Next",
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
      modalActs.appendChild(buildOverflowMenu(
        overflow.map(k => ({ label: labels[k], onClick: (b) => invoke(k, b) }))
          .concat(laterMenuItem(album, j))
          .concat([{ label: "Edit album", onClick: () => openAlbumEditor(album) }])
          .concat(downloadMenuItem(album)),
        { label: "More actions" }));
    }
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
        li.className = "t-row";
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

        // Long press ARMS selection without selecting this track — same rule
        // as the album grid.
        addLongPress(li, () => { if (!trackSelectMode) enterTrackSelectMode(); });
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
    if (isPhoneAlbum(currentAlbum)) {
      picks.forEach((p, i) => invokePhone(currentAlbum, p.index, i === 0 ? kind : "queue"));
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
            // Only the FIRST track honours the requested kind; the rest queue
            // behind it. Sending play_now for each would leave the last track
            // playing alone, having wiped the ones before it.
            kind: (i === 0 ? kind : "queue"),
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
    const verb = kind === "queue" ? "Queued" : "Playing";
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
      showToast(`${j.action || orig}: ${track.title} → ${zoneName(selectedZoneId)}`);
      // Success — collapse the action row; the user stays on the album.
      closeTrackRow(li);
    } catch (e) {
      showToast(e.message, "error");
      btn.disabled = false; btn.textContent = orig;
    }
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
        closeModal();
        if (window.__showLabelAlbums) window.__showLabelAlbums(extras.album.label);
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
      showToast(`${j.action || orig} → ${zoneName(selectedZoneId)}`);
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
      if (abort) { try { abort.abort(); } catch (e) {} abort = null; }
      clearTimeout(retryTimer);
      clearTimeout(extTimer);
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
      if (abort) { try { abort.abort(); } catch (e) {} }
      abort = new AbortController();
      clearTimeout(retryTimer);
      // Global search: the external sources (Qobuz/Tidal catalogues, Pitchfork
      // reviews) ride a LONGER debounce than the instant local-index search —
      // they're network calls against rate-limit-sensitive APIs. Scheduled
      // before the library fetch so external results appear even when the
      // library search errors or has zero matches.
      clearTimeout(extTimer);
      extTimer = setTimeout(() => runExternal(q, mySeq), 600);
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

    function extReappend(mySeq) {
      if (extWrapSeq !== mySeq || !extWrap || !extWrap.childNodes.length) return false;
      grid.appendChild(extWrap);     // appendChild MOVES it if already attached
      return true;
    }

    async function runExternal(q, mySeq) {
      try {
        const r = await fetch(`/api/search/external?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        if (mySeq !== seq || !r.ok) return;
        const j = await r.json();
        if (mySeq !== seq) return;
        const wrap = document.createElement("div");
        wrap.className = "ext-search-wrap";
        let added = 0;
        added += extServiceSection(wrap, "Qobuz", j.qobuz, "qobuz-toggle", "qobuz-search-input");
        added += extPitchforkSection(wrap, j.pitchfork);
        if (!added) return;
        extWrap = wrap;
        extWrapSeq = mySeq;
        // Externals may arrive while a "No matches for X" banner shows —
        // clear THAT banner (there are matches after all), but never the
        // Roon-disconnect/error banners, which explain the missing library rows.
        if (extAllowBannerClear) setBanner(null);
        grid.appendChild(wrap);
      } catch (e) { /* best-effort — external sections just don't appear */ }
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

    // Qobuz/Tidal section: tapping a result opens that service's browser seeded
    // with a search for the album (same hand-off the Pitchfork detail uses) —
    // favourite it there to make it appear in Roon.
    function extServiceSection(frag, label, albums, toggleId, inputId) {
      if (!albums || !albums.length) return 0;
      extHeader(frag, label);
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
      return albums.length;
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
    document.addEventListener("click", (e) => {
      if (!row.classList.contains("open")) return;
      if (e.target.closest && e.target.closest("#topbar-search")) return;
      closeSearch();
    });

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
      } catch (e) {} // localStorage optional (private browsing)
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
    try { labelsReversed = localStorage.getItem("rra-labels-reversed") === "1"; } catch (e) {} // localStorage optional
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
      try { localStorage.setItem("rra-labels-reversed", labelsReversed ? "1" : "0"); } catch (e) {} // localStorage optional
      paintSortBtn();
      if (lastLabels) { _lastLabelCount = -1; renderLabelTiles(lastLabels); }
      if (mainEl) mainEl.scrollTop = 0;
    });

    let currentLabelName = null;
    let currentLabelLogoUrl = null; // set when showLabelAlbums loads — used by logo picker
    let _labelsScrollSaved = 0;    // restores position when returning from a label's album view
    let _labelsScrollTarget = null; // label name to scroll into view when arriving via a deep-link (album/search)
    const mainEl = document.querySelector("main");

    const TAG_SVG =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>' +
      '<line x1="7" y1="7" x2="7.01" y2="7"/></svg>';

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

    async function showLabelAlbums(name, fromLabelsList = false) {
      if (window.__leavePlaylistScreens) window.__leavePlaylistScreens();
      if (window.__clearSearchIfActive) window.__clearSearchIfActive();  // drop stale search results
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
        grid.innerHTML = "";
        setBanner("Couldn't load albums: " + e.message, true);
      }
    }

    if (labelsBack) labelsBack.addEventListener("click", () => showLabelsList());
    // The top bar's ‹ on one label's albums goes back to all labels, ahead of
    // its usual "go Home" (v0.6.5; the "‹ All labels" pill it replaces is gone).
    {
      const tb = document.getElementById("topbar-back");
      if (tb) tb.addEventListener("click", (e) => {
        if (!(labelsActive && mode === "albums")) return;
        if (window.__artistViewActive && window.__artistViewActive()) return;
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



  async function invokeAlbumMulti(kind) {
    if (!albumSelected.length) return;
    if (!selectedZoneId) { showToast("Pick a zone first", "error"); return; }
    try {
      const r = await fetch("/api/play-multi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offsets: albumSelected.map(a => a.offset),
          // Identity per album so a mid-scan stale offset is relocated or
          // refused server-side instead of queueing the wrong records.
          items: albumSelected.map(a => ({ offset: a.offset, title: a.title || "", subtitle: a.subtitle || "" })),
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
      showToast(multiOutcome(kind === "play_now" ? "Playing" : "Queued",
                             j, albumSelected.length, null) +
                " → " + zoneName(selectedZoneId));
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
    const discoverItem = document.getElementById("menu-item-discover");
    if (discoverItem && typeof state.discover === "boolean") {
      discoverItem.classList.toggle("hidden", !state.discover);
    }
  };

  // Ask at boot. Two independent calls, so an older server or a transient
  // error on one endpoint does not decide the other entry's visibility.
  // The three side by side (v0.6.10), not one after another.
  async function applyFeatureMenuFromServer() {
    const state = {};
    const ask = async (url) => { try { const r = await fetch(url); return r.ok ? !!(await r.json()).enabled : null; } catch (e) { return null; } };
    const [labels, picks, discover] = await Promise.all([
      ask("/api/settings/labels"), ask("/api/settings/smart-picks"), ask("/api/settings/discover")
    ]);
    // A failed lookup leaves the entry as the markup has it — which for
    // Discover is HIDDEN: unlike the other two it is off for everyone until
    // asked for, so a failed lookup must not offer a menu entry that leads to
    // an empty screen.
    if (labels !== null) state.labels = labels;
    if (picks !== null) state.picks = picks;
    if (discover !== null) state.discover = discover;
    window.__applyFeatureMenu(state);
  }

  window.__buildAlbumTile = (a) => buildAlbumTile(a);
  window.__loadRandom = loadRandom;
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
              // Offline, a server album left open isn't reopened (it isn't on the phone).
              if (parsed && parsed.album && !window.__musicdOffline) {
                openAlbum(parsed.album, { source: parsed.source, zoneId: parsed.zoneId,
                                         filter: parsed.filter });
              }
            }
          } catch (e) {} // corrupt sessionStorage modal state — skip restore, open normally

          setInterval(loadZones, 15000);
          return;
        }
      } catch (e) {} // /api/status fetch failed — server not ready yet, fall through to "Waiting" banner
      setBanner("Waiting for Mandarin to start…");
      await new Promise(r => setTimeout(r, 2000));
    }
    setBanner("Mandarin isn't answering. Check the container is running.", true);
  }
  bootstrap();
})();

/* ------------------------------------------------------------------ */
/*  Mini transport (now-playing bar at the bottom)                     */
/* ------------------------------------------------------------------ */
(() => {
  const bar       = document.getElementById("mini-transport");
  const titleEl   = document.getElementById("mt-title");
  const kickerEl  = document.getElementById("mt-kicker");
  const artistEl  = document.getElementById("mt-artist");
  const artEl     = document.getElementById("mt-art");
  const btnPP     = document.getElementById("mt-playpause");
  const btnZone   = document.getElementById("mt-zone");
  const zonePop   = document.getElementById("mt-zone-popover");
  const zoneList  = document.getElementById("mt-zone-list");
  const progFill  = document.getElementById("mt-progress-fill");
  const btnVol    = document.getElementById("mt-vol-btn");
  const iconPlay  = document.getElementById("mt-icon-play");
  const iconPause = document.getElementById("mt-icon-pause");
  const iconVol   = document.getElementById("mt-icon-vol");
  const iconMute  = document.getElementById("mt-icon-mute");
  const volPop    = document.getElementById("mt-vol-popover");
  const volSlider = document.getElementById("mt-vol-slider");
  const volVal    = document.getElementById("mt-vol-value");
  const volMinL   = document.getElementById("mt-vol-min");
  const volMaxL   = document.getElementById("mt-vol-max");
  const volWrap   = document.getElementById("mt-vol-sliderwrap");

  // The selected zone's controllable output, looked up at READ time — never a
  // mirrored global (same principle as window.__getCurrentNp below: mirrors
  // strand stale state across zone switches and early-return render paths).
  // type "incremental" means relative-only (no absolute scale): the sheets
  // hide the slider/scale and the −/+ send relative nudges.
  function currentVolOutput() {
    return (currentZone && (currentZone.outputs || []).find(o => o.volume)) || null;
  }

  // WebKit has no ::range-progress, so the accent fill left of the thumb is a
  // gradient driven by --vol-fill; keep it in sync whenever value/min/max move.
  function paintVolFill(slider) {
    if (!slider) return;
    const val = parseFloat(slider.value);
    if (!Number.isFinite(val)) return;   // empty/cleared attrs — leave the fill untouched
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max);
    const hi  = Number.isFinite(max) && max > min ? max : min + 100;
    const pct = ((val - min) / (hi - min)) * 100;
    slider.style.setProperty("--vol-fill", Math.max(0, Math.min(100, pct)) + "%");
  }

  // One writer for "both sliders + both readouts + both fills" — the mini bar
  // and the NP sheet must always show the same number for the same output.
  function syncVolumeUI(v) {
    volSlider.value = v;
    volVal.textContent = Math.round(v);
    if (npVolSlider) npVolSlider.value = v;
    if (npVolValue)  npVolValue.textContent = Math.round(v);
    paintVolFill(volSlider); paintVolFill(npVolSlider);
  }
  // The highest value this output will actually accept. soft_limit is Roon's
  // own ceiling: it has always been sent (index.js) and nothing read it, so a
  // request above it was clamped by Roon and the next poll dragged the thumb
  // back down — indistinguishable from the jitter. Applied to the slider's own
  // max as well as the −/+ buttons, or dragging could still ask for a value the
  // zone will never report back, leaving the hold waiting on an echo that can
  // never match.
  function volCeiling(v) {
    const max = v.max != null ? v.max : 100;
    return v.soft_limit != null ? Math.min(max, v.soft_limit) : max;
  }
  // Scale labels show the output's real range (0/100 for number volumes,
  // e.g. -80/0 for dB volumes) — matches what the slider actually spans.
  function paintVolScale(minEl, maxEl, v) {
    if (minEl) minEl.textContent = Math.round(v.min != null ? v.min : 0);
    if (maxEl) maxEl.textContent = Math.round(volCeiling(v));
  }

  // Now-playing screen (Roon-style) elements — shared modal, driven by the
  // same poll loop so there's a single source of truth.
  const modalEl     = document.getElementById("album-modal");
  const bigArt      = document.getElementById("modal-img");
  const npTrack     = document.getElementById("np-track");
  const npArtist    = document.getElementById("np-artist");
  const npAlbum     = document.getElementById("np-album");
  const npFormat    = document.getElementById("np-format");
  const npSeek      = document.getElementById("np-seek");
  const npCur       = document.getElementById("np-cur");
  const npTot       = document.getElementById("np-tot");
  const npPrev      = document.getElementById("np-prev");
  const npPlayPause = document.getElementById("np-playpause");
  const npNext      = document.getElementById("np-next");
  const npIconPlay  = document.getElementById("np-icon-play");
  const npIconPause = document.getElementById("np-icon-pause");
  const npVolBtn    = document.getElementById("np-volbtn");
  const npVolPopover= document.getElementById("np-vol-popover");
  const npVolFixed  = document.getElementById("np-vol-fixed");
  const npVolControls = document.getElementById("np-vol-controls");
  const npVolValue  = document.getElementById("np-vol-value");
  const npVolMinL   = document.getElementById("np-vol-min");
  const npVolMaxL   = document.getElementById("np-vol-max");
  const npVolWrap   = document.getElementById("np-vol-sliderwrap");
  const npIconVol   = document.getElementById("np-icon-vol");
  const npIconMute  = document.getElementById("np-icon-mute");
  const npVolSlider = document.getElementById("np-vol-slider");
  const npShuffle   = document.getElementById("np-shuffle");
  const npLoop      = document.getElementById("np-loop");
  const npLoopBadge = document.getElementById("np-loop-badge");

  let currentZone = null;       // server-side zone state
  let pollTimer   = null;
  let lastNpImgKey = null;
  let userIsDraggingVolume = false;

  // The volume the user last ASKED for, held until the server echoes it back.
  //
  // The only guard used to be userIsDraggingVolume, set on the slider's `input`
  // event and cleared on `change`. The −/+ buttons never touched it, so from the
  // moment a tap painted 51 until Roon echoed 51 (a round trip, plus Roon's own
  // ~1Hz event cadence), any poll tick wrote the PRE-tap 50 straight back over
  // it: the thumb retreating after +, advancing after −. That is the reported
  // "increase it and it jumps back, vice versa".
  //
  // Held, not locked: the hold ends the moment the echo matches, and lapses on
  // its own after volEchoMs() so a change made in the Roon app or on a hardware
  // knob still reaches the slider.
  const VOL_ECHO_MS   = 2000;
  let volPending      = null;   // value written locally, not yet echoed
  let volPendingUntil = 0;      // Date.now() after which we stop believing it
  let volPendingZone  = null;   // the zone it was written to — see settleVolumeHold
  function holdVolume(v) {
    volPending = v;
    volPendingUntil = Date.now() + VOL_ECHO_MS;
    volPendingZone = currentZone && currentZone.zone_id;
  }
  function clearVolumeHold() { volPending = null; volPendingZone = null; }

  // Retire the hold when it is spent. Called ONCE per poll, from renderZone.
  //
  // Kept separate from the predicate below because two render paths ask whether
  // the volume is held (the mini bar, and the now-playing sheet), and a
  // predicate that also retires the hold means whichever happens to ask first
  // consumes it — a property neither call site can see.
  function settleVolumeHold(serverValue, stepSz) {
    if (volPending === null) return;
    // A hold belongs to the zone it was taken for. Without this, tapping + on
    // one zone and switching to another inside the window left the new zone's
    // slider showing the OLD zone's number, and the next tap stepped from it —
    // sending a wildly wrong absolute value to a zone never touched.
    if (volPendingZone !== (currentZone && currentZone.zone_id)) { clearVolumeHold(); return; }
    if (Date.now() > volPendingUntil) { clearVolumeHold(); return; }
    // Match within half a step rather than exactly: Roon quantises to the
    // output's own grid, so an exact compare never matches on a dB output and
    // the hold runs its full 2s before snapping — the very symptom it exists
    // to remove.
    const tol = Math.max(0.001, (stepSz || 0) / 2);
    if (serverValue != null && Math.abs(serverValue - volPending) < tol) clearVolumeHold();
  }
  // Pure — safe to call from any render path, in any order, any number of times.
  function volumeHeld() {
    if (userIsDraggingVolume) return true;
    if (volPending === null) return false;
    return Date.now() <= volPendingUntil;
  }

  let userIsDraggingSeek   = false;
  let npLen = 0;                // current track length (s)
  // The position is a BASE plus elapsed wall-clock, not a counter. It used to be
  // `npPos += 1` on a 1000ms interval while the 1500ms poll assigned the server's
  // value unconditionally: two unsynchronised timers writing one variable,
  // realigning every 3s, so the bar hopped forward a second, snapped back a
  // second, then caught up two. That beat IS the jerkiness. Wall-clock also
  // survives a late or throttled timer, which a counter cannot.
  // Same shape display.js has always used (seekBase / seekBaseAt).
  let npBase   = 0;             // last known position (s)
  let npBaseAt = 0;             // Date.now() when npBase was set
  let npWasPlaying = false;     // play state over the interval just elapsed
  let npSeekHold = 0;           // ignore server re-baselining until this time
  // The last position the server reported, to tell a MOVING feed from a stuck
  // one. See the reconcile in refreshTransport for why a repeated value must
  // not be treated as news.
  let npPrevSrv = null;
  function npPlaying() {
    return !!currentZone && (currentZone.state === "playing" || currentZone.state === "loading");
  }
  // Current position: the base, plus real time since it was taken.
  function npNow() {
    const pos = npBase + (npPlaying() ? (Date.now() - npBaseAt) / 1000 : 0);
    return npLen > 0 ? Math.max(0, Math.min(npLen, pos)) : Math.max(0, pos);
  }
  function npSetBase(seconds) {
    npBase = Math.max(0, seconds || 0);
    npBaseAt = Date.now();
  }

  // Tap the album name on the now-playing screen to open that album's detail.
  // We must search the index first to find the album's offset — the now-playing
  // data alone doesn't carry it, and /api/album requires a valid numeric offset.
  if (npAlbum) {
    npAlbum.addEventListener("click", async () => {
      const np = currentZone && currentZone.now_playing;
      if (!np || typeof window.__openAlbum !== "function") return;
      const albumTitle = np.line3 || "";
      const artist     = np.line2 || "";
      if (!albumTitle) return;
      const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      try {
        const r = await fetch("/api/search?q=" + encodeURIComponent(albumTitle) + "&limit=20");
        if (r.ok) {
          const j  = await r.json();
          const rs = j.results || [];
          // Whole credited NAME agreement, not "contains the artist's first
          // word" (which opened Bonnie "Prince" Billy's album for Prince) and
          // not whole-string equality either — the now-playing line is the
          // track artist, so "Prince" must still match "Prince & The
          // Revolution". Split both sides on the credit separators and look
          // for a shared name.
          const names = (s) => (s || "")
            .split(/ \/ |\/| feat\.? | featuring | ft\.? |,| & | \+ | and /i)
            .map(x => norm(x)).filter(Boolean);
          const wanted = names(artist);
          const shares = (sub) => {
            const got = names(sub);
            return wanted.some(w => got.includes(w));
          };
          const match =
            rs.find(a => norm(a.title) === norm(albumTitle) &&
                         (!wanted.length || shares(a.subtitle))) ||
            (!wanted.length ? rs.find(a => norm(a.title) === norm(albumTitle)) : null);
          if (match && typeof match.offset === "number") {
            window.__openAlbum(match, { source: "search" }); return;
          }
        }
      } catch (e) {} // sessionStorage/JSON parse error — fall through to "not indexed" toast
      if (window.__showToast) window.__showToast("Album not yet indexed — try again in a moment");
    });
  }

  // Is the Roon-style now-playing screen currently on view?
  function onNowPlayingScreen() {
    return modalEl
      && !modalEl.classList.contains("hidden")
      && modalEl.classList.contains("np-mode")
      && modalEl.classList.contains("tab-album");
  }

  function fmtTime(secs) {
    secs = Math.max(0, Math.floor(secs || 0));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  function selectedZoneId() {
    // Read from the existing zone selector in the topbar
    const sel = document.getElementById("zone-select");
    return sel && sel.value || null;
  }

  let lastTransportSig = "";
  function saveTransportState(zone) {
    if (!zone || !zone.now_playing) return;
    const np = zone.now_playing;
    // The 1.5s poll calls this every tick — synchronous localStorage writes
    // are only worth paying when the persisted fields actually changed.
    const sig = [np.line1, np.line2, np.line3, np.image_key, zone.state].join("|");
    if (sig === lastTransportSig) return;
    lastTransportSig = sig;
    try {
      localStorage.setItem("rra-transport", JSON.stringify({
        line1: np.line1 || "", line2: np.line2 || "", line3: np.line3 || "",
        image_key: np.image_key || "", state: zone.state || "stopped"
      }));
    } catch (e) {} // localStorage optional — transport bar persistence is best-effort
  }

  // The cover for the playing track. Hidden rather than broken when the zone
  // reports no art (a stream, a zone mid-handshake): an empty <img> draws the
  // browser's broken-image glyph, which looks like a fault.
  function paintTransportArt(imageKey) {
    if (!artEl) return;
    if (imageKey) {
      const src = `/api/image/${encodeURIComponent(imageKey)}?size=120`;
      // Guarded: assigning the same src restarts the request on some browsers,
      // and this runs off a 1.5s poll.
      if (artEl.getAttribute("src") !== src) artEl.setAttribute("src", src);
      artEl.classList.remove("hidden");
    } else {
      artEl.removeAttribute("src");
      artEl.classList.add("hidden");
    }
  }

  function restoreTransportState() {
    try {
      const saved = JSON.parse(localStorage.getItem("rra-transport") || "null");
      if (!saved || !saved.line1) return;
      titleEl.textContent  = saved.line1;
      const sub = [saved.line2, saved.line3].filter(Boolean).join(" · ");
      artistEl.textContent = sub || "—";
      paintTransportArt(saved.image_key);
      bar.classList.remove("hidden");
    } catch (e) {} // corrupt localStorage — transport bar stays hidden, no action needed
  }

  // The server's change counter as of the last answer applied, and the zone it
  // was for: an answer older than one already painted (a slow one-off fetch
  // landing after the long-poll's) is dropped rather than painted backwards.
  let stateRev = -1, stateZone = null;
  function applyState(zid, j) {
    if (zid !== selectedZoneId()) return false;
    const rev = typeof j.revision === "number" ? j.revision : -1;
    if (zid === stateZone && rev < stateRev) return false;
    stateRev = rev; stateZone = zid;
    renderZone(j.zone);
    saveTransportState(j.zone);
    return true;
  }

  async function fetchState() {
    const zid = selectedZoneId();
    if (!zid) { renderZone(null); return; }   // no zone yet: the bar says so
    try {
      const r = await fetch("/api/zone-state?zone=" + encodeURIComponent(zid), { cache: "no-store" });
      if (!r.ok) return;  // server/network error — keep current state
      applyState(zid, await r.json());
    } catch (e) {
      // network blip — keep what we have
    }
  }

  function renderZone(zone) {
    currentZone = zone;
    const np = zone && zone.now_playing;
    if (!np) {
      npLen = 0; npSetBase(0); npPrevSrv = null;
      paintBarProgress();
      // The bar is always there, so it can be where a zone is picked: with no
      // zone it says so; with a silent one, whose it is and that it is quiet.
      const idleSig = "idle|" + (zone ? zone.zone_id + "|" + zone.display_name + "|" + (zone.outputs || []).some(o => o.is_muted) : "");
      if (idleSig !== lastBarSig) {
        lastBarSig = idleSig;
        if (kickerEl) kickerEl.textContent = zone ? zone.display_name : "";
        titleEl.textContent  = zone ? "Nothing playing" : "No Zone Selected";
        artistEl.textContent = zone ? "Pick an album to play here" : "Tap the speaker to choose where to play";
        paintTransportArt("");
        iconPlay.classList.remove("hidden"); iconPause.classList.add("hidden");
        btnPP.setAttribute("aria-label", "Play");
        const muted = !!(zone && (zone.outputs || []).some(o => o.is_muted));
        iconVol.classList.toggle("hidden", muted); iconMute.classList.toggle("hidden", !muted);
      }
      refreshVisibility();
      updateNpScreen();
      return;
    }

    // The static mini-bar bits (text, icons, volume) are skipped when nothing
    // changed — this ran every 1.5s before v0.6.10, and unconditional text-node replacement
    // invalidated the fixed bar's paint on every tick even mid-scroll. The
    // seek baseline below always resyncs (it moves every tick by design).
    const volOutput = (zone.outputs || []).find(o => o.volume);
    const muted = (zone.outputs || []).some(o => o.is_muted);
    const playing = zone.state === "playing" || zone.state === "loading";
    const fmt = np.format || null;
    const fmtWord = !fmt ? "" : fmt.kind === "opus" ? ("Opus " + (fmt.text || "").replace(/\s*kbps$/i, "")).trim() : (fmt.text || "");
    const kicker = [zone.display_name, fmtWord].filter(Boolean).join(" · ");
    const barSig = [np.line1, np.line2, np.line3, np.image_key, zone.state, muted, kicker].join("|");
    if (barSig !== lastBarSig) {
      lastBarSig = barSig;
      if (kickerEl) kickerEl.textContent = kicker;

      // Title = track, subtitle = artist · album
      titleEl.textContent  = np.line1 || "—";
      const sub = [np.line2, np.line3].filter(Boolean).join(" · ");
      artistEl.textContent = sub || "—";
      paintTransportArt(np.image_key);

      // Play/pause state
      iconPlay .classList.toggle("hidden",  playing);
      iconPause.classList.toggle("hidden", !playing);
      btnPP.setAttribute("aria-label", playing ? "Pause" : "Play");

      iconVol .classList.toggle("hidden",  muted);
      iconMute.classList.toggle("hidden", !muted);
    }

    // Volume UI — every tick, NOT barSig-gated: a zone switch can leave the
    // signature unchanged, and the sheet must never keep serving the previous
    // zone's range/type. volumeHeld() still guards the value writes.
    if (volOutput) {
      const v = volOutput.volume;
      volSlider.min   = v.min   != null ? v.min  : 0;
      volSlider.max   = volCeiling(v);
      volSlider.step  = v.step  != null ? v.step : 1;
      settleVolumeHold(v.value, v.step);   // once per poll, before either read
      if (!volumeHeld()) {
        volSlider.value = v.value != null ? v.value : 0;
        volVal.textContent = v.value != null ? Math.round(v.value) : "—";
        paintVolFill(volSlider);
      }
      paintVolScale(volMinL, volMaxL, v);
      // Relative-only (incremental) outputs have no absolute scale — the
      // sheet collapses to the −/+ nudge buttons, matching Roon.
      if (volWrap) volWrap.classList.toggle("hidden", (v.type || null) === "incremental");
      btnVol.disabled = false;
    } else {
      btnVol.disabled = true;
    }

    // Reconcile the local clock with the server — do NOT snap to it.
    //
    // What arrives here is always a little stale, by two independent amounts:
    // Roon reports whole seconds (up to 1s of quantisation) on its own ~1Hz
    // event cadence (up to another 1s of age). So the honest expectation is
    // that `srv` sits up to ~2s behind the position already painted, with the
    // two clocks advancing at the same rate thereafter. Assigning it
    // unconditionally is what produced the visible backwards jerk.
    //
    // Re-baseline only when it disagrees by more than that expected lag, which
    // means a real event: a track change, a seek from another remote, a stall.
    // The threshold is deliberately WIDER than the lag it tolerates — too tight
    // and normal staleness re-triggers the jerk this is here to remove. The
    // cost is that an external seek of under ~3s is not followed until the next
    // track change; nobody seeks by two seconds, and our own seeks are exact
    // (npSeekHold below).
    const prevLen = npLen;
    npLen = np.length || 0;
    const srv = np.seek_position != null ? np.seek_position : 0;

    const playingNow   = npPlaying();
    const stateChanged = playingNow !== npWasPlaying;

    // Carry the base forward by the interval just elapsed, using the play state
    // that was in effect FOR that interval, then restart the clock from now.
    //
    // Without this, npBaseAt kept its pre-pause timestamp across a pause and the
    // paused seconds were counted as playback on resume. A 2.5s pause left the
    // bar permanently 2.5s ahead — under the 3s threshold, so never corrected —
    // and a few short pauses accumulated past it, at which point the reconcile
    // fired and yanked the bar back by MORE than three seconds. A rarer, bigger
    // version of the jerk this whole change exists to remove.
    npSetBase(npBase + (npWasPlaying ? (Date.now() - npBaseAt) / 1000 : 0));
    npWasPlaying = playingNow;

    // A track change or a play/pause transition is unambiguous new information,
    // so both take the server's position outright — it is exact at that moment
    // and stale only by the usual fixed lag, whereas the local clock has just
    // counted up to a poll interval of the wrong state. Both bypass the seek
    // hold: gating the track change behind it meant scrubbing to the end of a
    // track — a normal way to skip on — opened the next one pinned at 100%.
    // A server position that has not MOVED since the last poll is not news,
    // it is a stuck feed — and re-baselining to it is how a stuck feed turns
    // into a sawtooth: the local clock counts up, crosses the 3s threshold,
    // gets yanked back to the same stale number, and starts again. Reported
    // as "0 to 4 seconds then returns to 0, and repeats all the time", which
    // is exactly the period this threshold and the poll interval produce.
    //
    // Reconcile against a value that has CHANGED, therefore. When the feed is
    // stuck the local wall clock is the better answer anyway: the track is
    // playing, so time really is passing, whatever the zone last said.
    //
    // A track change or a play/pause transition still takes the server's
    // position outright even when the number repeats — both are unambiguous
    // new information, and at a track change the repeat is usually a genuine
    // 0. Our own seeks are exact and keep their own hold (npSeekHold).
    const srvMoved = npPrevSrv === null || srv !== npPrevSrv;
    npPrevSrv = srv;

    if (npLen !== prevLen || stateChanged) npSetBase(srv);
    else if (srvMoved && Date.now() >= npSeekHold && Math.abs(srv - npNow()) > 3) npSetBase(srv);
    paintBarProgress();

    refreshVisibility();
    updateNpScreen();
  }

  // Mini bar shows whenever something is playing, EXCEPT on the now-playing
  // screen (which has its own transport). It returns on the Queue tab.
  // The bar shows everywhere but on the Now playing screen — with nothing
  // playing, and with no zone chosen, too: it is where a zone is picked.
  function refreshVisibility() {
    bar.classList.toggle("hidden", onNowPlayingScreen());
  }

  // Last-rendered signature of the mini transport bar's static content —
  // renderZone skips its DOM writes while this is unchanged.
  let lastBarSig = "";

  // Track title with any trailing "(…)" detail broken onto its own line
  // (e.g. "Hangover Sex (with Viktoria Tolstoy)" → main line + sub-line).
  let lastNpTitle = null;
  // The format badge under the album name (now_playing.format from the
  // server: { kind: "opus" | "lossless" | "lossy", text }). Opus wears its
  // logo, drawn by the stylesheet, beside the bit rate.
  let lastNpFormatSig = null;
  function paintNpFormat(np) {
    if (!npFormat) return;
    const f = np && np.format;
    const sig = f ? f.kind + "|" + (f.text || "") : "";
    if (sig === lastNpFormatSig) return;
    lastNpFormatSig = sig;
    npFormat.textContent = "";
    npFormat.className = "np-format" + (f ? " is-" + f.kind : " hidden");
    if (!f) { npFormat.removeAttribute("aria-label"); return; }
    if (f.kind === "opus") {
      const logo = document.createElement("span");
      logo.className = "np-format-opus";
      logo.setAttribute("aria-hidden", "true");
      npFormat.appendChild(logo);
    }
    if (f.text) {
      const t = document.createElement("span");
      t.className = "np-format-text";
      t.textContent = f.text;
      npFormat.appendChild(t);
    }
    npFormat.setAttribute("aria-label", f.kind === "opus" ? ("Opus " + (f.text || "")).trim() : f.text);
    npFormat.setAttribute("role", "img");
  }

  function setNpTrack(title) {
    title = title || "—";
    if (title === lastNpTitle) return;   // poll runs every 1.5s — skip rebuilds
    lastNpTitle = title;
    npTrack.textContent = "";
    const m = /^(.*\S)\s*(\([^()]*\))$/.exec(title);
    if (m) {
      npTrack.append(m[1]);
      const sub = document.createElement("div");
      sub.className = "np-track-sub";
      sub.textContent = m[2];
      npTrack.appendChild(sub);
    } else {
      npTrack.textContent = title;
    }
  }

  // The artist line, as individual links — the same control the album view
  // offers, driven by the same library-validated split (the server sends it on
  // now_playing.artists, see creditLinks).
  //
  // Signature-gated like setNpTrack: this runs on the 1.5s poll, and rebuilding
  // a row of buttons every tick would drop keyboard focus mid-press and thrash
  // the DOM behind the artwork.
  let lastNpArtistSig = null;
  function setNpArtists(np) {
    const parts = (np && Array.isArray(np.artists) && np.artists.length)
      ? np.artists
      // Older server, or a credit the server couldn't split (no library yet):
      // show the raw line as plain text rather than nothing.
      : ((np && np.line2) ? [{ name: np.line2, linkable: false }] : []);
    const sig = JSON.stringify(parts);
    if (sig === lastNpArtistSig) return;
    lastNpArtistSig = sig;
    if (!parts.length) { npArtist.textContent = ""; return; }
    if (window.__renderArtistLinks) {
      window.__renderArtistLinks(npArtist, parts, {
        separator: " · ",
        linkClass:  "np-artist-link",
        sepClass:   "np-artist-sep",
        plainClass: "np-artist-plain",
      });
    } else {
      // The modal IIFE didn't export the renderer — never expected, but the
      // artist line must still say who is playing.
      npArtist.textContent = parts.map(p => p.name).join(" · ");
    }
  }

  // Populate the Roon-style now-playing screen from the live zone state.
  function updateNpScreen() {
    // Big art + ambient glow track the playing album on BOTH np-mode tabs —
    // the Queue tab hides the art but shows the glow — so update them BEFORE
    // the tab-album gate below (onNowPlayingScreen() is false on tab-queue,
    // which would otherwise leave the glow stale across album changes).
    const np = currentZone && currentZone.now_playing;
    const npModeVisible = modalEl
      && !modalEl.classList.contains("hidden")
      && modalEl.classList.contains("np-mode");
    if (npModeVisible && bigArt && np && np.image_key && np.image_key !== lastNpImgKey) {
      bigArt.src = "/api/image/" + encodeURIComponent(np.image_key) + "?size=800";
      lastNpImgKey = np.image_key;
      // Same URL as the big art, so the browser serves it from cache.
      if (window.__setModalAmbient) window.__setModalAmbient(bigArt.src);
    }

    if (!npTrack || !onNowPlayingScreen()) return;
    // Playback modes belong to the ZONE, not to the track — a stopped zone can
    // still have shuffle on, and Roon lets you set it before pressing play.
    paintModeButtons();
    paintNpFormat(np);
    if (!np) { setNpTrack(null); setNpArtists(null); npAlbum.textContent = ""; return; }

    setNpTrack(np.line1);
    setNpArtists(np);
    npAlbum.textContent  = np.line3 || "";
    if (npAlbum) npAlbum.setAttribute("aria-label", "Open album: " + (np.line3 || ""));

    const playing = currentZone.state === "playing" || currentZone.state === "loading";
    npIconPlay .classList.toggle("hidden",  playing);
    npIconPause.classList.toggle("hidden", !playing);
    npPlayPause.setAttribute("aria-label", playing ? "Pause" : "Play");
    npPrev.disabled = !currentZone.is_previous_allowed;
    npNext.disabled = !currentZone.is_next_allowed;

    // Progress / seek (blue fill before the thumb, like Roon)
    const seekable = !!currentZone.is_seek_allowed && npLen > 0;
    npSeek.disabled = !seekable;
    // The position the fill is painted from must be the one the thumb is at.
    // A stream with no length pins the input to 0/max 100, and npNow() keeps
    // counting regardless — passing it here would paint a fill under a thumb
    // parked at zero.
    let seekPos = 0;
    if (npLen > 0) {
      npSeek.max = npLen;
      seekPos = userIsDraggingSeek ? (parseFloat(npSeek.value) || 0)
                                   : Math.min(npNow(), npLen);
      if (!userIsDraggingSeek) {
        npSeek.value = seekPos;
        npCur.textContent = fmtTime(seekPos);
      }
      npTot.textContent = fmtTime(npLen);
    } else {
      npSeek.max = 100; npSeek.value = 0;
      npCur.textContent = "0:00"; npTot.textContent = "0:00";
    }
    paintSeek(seekPos);
    // Cheap on every poll: loadWaveform returns immediately unless the track
    // key actually changed, so this is a string compare, not a fetch.
    loadWaveform();

    // Volume — show the controls only when the endpoint has a controllable
    // volume; otherwise show "Volume control is fixed" (matches Roon).
    const volOutput = (currentZone.outputs || []).find(o => o.volume);
    if (volOutput) {
      const v = volOutput.volume;
      npVolSlider.min  = v.min  != null ? v.min  : 0;
      npVolSlider.max  = volCeiling(v);
      npVolSlider.step = v.step != null ? v.step : 1;
      if (!volumeHeld()) {
        npVolSlider.value = v.value != null ? v.value : 0;
        if (npVolValue) npVolValue.textContent = v.value != null ? Math.round(v.value) : "—";
        paintVolFill(npVolSlider);
      }
      paintVolScale(npVolMinL, npVolMaxL, v);
      if (npVolWrap) npVolWrap.classList.toggle("hidden", (v.type || null) === "incremental");
      if (npVolControls) npVolControls.classList.remove("hidden");
      if (npVolFixed) npVolFixed.classList.add("hidden");
    } else {
      if (npVolControls) npVolControls.classList.add("hidden");
      if (npVolFixed) npVolFixed.classList.remove("hidden");
    }
    const muted = (currentZone.outputs || []).some(o => o.is_muted);
    npIconVol .classList.toggle("hidden",  muted);
    npIconMute.classList.toggle("hidden", !muted);
  }

  // Thin progress line along the top of the mini bar (Roon-style).
  // `pos` is optional and follows paintSeek's convention: pass the position
  // being painted so both the line and the thumb are drawn from one number.
  function paintBarProgress(pos) {
    if (!progFill) return;
    const at = Number.isFinite(pos) ? pos
             : (userIsDraggingSeek ? (parseFloat(npSeek.value) || 0) : npNow());
    const pct = npLen > 0 ? Math.max(0, Math.min(100, (at / npLen) * 100)) : 0;
    progFill.style.width = pct.toFixed(2) + "%";
  }

  // Paint the elapsed portion of the scrubber blue (before the thumb).
  // `pos` is passed in rather than read back out of the input: the input is
  // step-quantised, so round-tripping through it threw away the sub-second part
  // and the fill could only ever move in whole-second jumps.
  /* ---------------- Waveform ---------------- */
  /*
   * The shape of the track, drawn under the seek bar.
   *
   * Local files and streamed ones alike: Roon sends audio to the endpoint and
   * never to an extension, so the server reads a local file directly and
   * fetches a streamed track from Qobuz or TIDAL with the user's own account to
   * measure it. Either way this end is the same — it asks /api/waveform for a
   * few thousand levels and draws them; a track the server cannot identify
   * answers with none and keeps the plain bar.
   *
   * The canvas is decoration UNDER the range input, never a replacement for it:
   * the input keeps the drag, the keyboard, the thumb and the disabled state,
   * and if any of this fails the bar is exactly what it was before.
   */
  const npWave = document.getElementById("np-wave");
  const npProgressEl = document.querySelector(".np-progress");
  let npWavePeaks = null;     // Uint8Array for the current track, or null
  let npWaveKey = "";         // which track those peaks are for
  let npWaveReq = 0;          // generation, so a slow answer cannot land late

  function npWaveIdentity() {
    const np = (currentZone && currentZone.now_playing) || null;
    if (!np) return null;
    const t3 = np.three_line || {};
    const track  = t3.line1 || np.line1 || "";
    const artist = t3.line2 || np.line2 || "";
    const album  = t3.line3 || np.line3 || "";
    return track ? { track, artist, album, key: track + " " + album } : null;
  }

  // Redraw when the canvas changes size (v0.6.1). drawWave sizes its bars
  // from the canvas's width AT THE TIME IT DRAWS, and while a track is paused
  // nothing else redraws it — so a reflow after the draw (a web font arriving
  // and moving the time labels, a rotation, a resize) left the shape
  // stretched to the old width, its silences a couple of pixels off the
  // playhead.
  if (npWave && typeof ResizeObserver === "function") {
    let lastW = -1, lastH = -1;
    new ResizeObserver(() => {
      const w = npWave.clientWidth, h = npWave.clientHeight;
      if (w === lastW && h === lastH) return;
      lastW = w; lastH = h;
      if (npWavePeaks && npWavePeaks.length) drawWave();
    }).observe(npWave);
  }

  function drawWave(pos) {
    if (!npWave || !npProgressEl) return;
    const peaks = npWavePeaks;
    if (!peaks || !peaks.length) {
      npWave.classList.add("hidden");
      npProgressEl.classList.remove("has-wave");
      return;
    }
    npWave.classList.remove("hidden");
    npProgressEl.classList.add("has-wave");

    // Size the backing store to the DEVICE pixels actually on screen, or the
    // bars are soft on every phone made in the last decade.
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(npWave.clientWidth));
    const h = Math.max(1, Math.round(npWave.clientHeight));
    if (npWave.width !== w * dpr || npWave.height !== h * dpr) {
      npWave.width = w * dpr; npWave.height = h * dpr;
    }
    const ctx = npWave.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cs = getComputedStyle(document.documentElement);
    const played = cs.getPropertyValue("--accent").trim() || "#4cb7e6";
    // The track ahead is drawn in the TEXT colour, not the border colour: it is
    // the shape of the music and it should be as legible as the title above it.
    // `--text` is near-white on the dark palettes and near-black on the light
    // ones, so "white" here means "reads clearly", in both.
    const ahead  = cs.getPropertyValue("--text").trim() || "#e9eaec";
    const at = Number.isFinite(pos) ? pos : npNow();
    const frac = npLen > 0 ? Math.max(0, Math.min(1, at / npLen)) : 0;

    /*
     * WHERE THE THUMB ACTUALLY IS, which is not frac * width.
     *
     * A range input cannot let its thumb hang off either end, so the CENTRE
     * travels from thumbW/2 to width - thumbW/2 rather than from 0 to width.
     * The bars were laid from 0 to w regardless, so the two mappings from TIME
     * to X disagreed by thumbW * (0.5 - frac): half a thumb ahead of the music
     * at the start, level in the middle, half a thumb behind it at the end. On
     * a phone that is seven pixels of a ~350px bar — several seconds of a
     * five-minute track — and it reads as the waveform failing to keep up.
     * Zero in the middle, which is how it survived being looked at.
     *
     * So the shape is inset to the thumb's travel and both are computed from
     * `span`. A peak is then under the dot at the moment you hear it, at every
     * point in the track rather than only halfway through.
     */
    // Read from the PROGRESS block, which is where --seek-thumb is declared —
    // a custom property inherits downward, so asking documentElement (its
    // ancestor, not its descendant) would silently get nothing and fall back.
    const thumbW = parseFloat(
      getComputedStyle(npProgressEl).getPropertyValue("--seek-thumb")) || 14;
    const inset = thumbW / 2;
    const span = Math.max(1, w - thumbW);
    const head = inset + frac * span;

    /*
     * ONE BAR PER DEVICE-PIXEL PITCH, not per 2 CSS pixels.
     *
     * A phone has three device pixels to every CSS one and the old step threw
     * two of them away: ~190 bars for a five-minute track, a second and a half
     * each, which is a coarse picture of a record however well it is measured.
     * Two device pixels of ink and one of gap gives ~360 on the same phone, and
     * each one lands on a whole device pixel, so they stay separate instead of
     * blurring into a band. The store holds 4000 values, so there is data for
     * them.
     *
     * Drawn in DEVICE pixels for that reason — the transform is dropped here
     * and put back at the end. A screen with no pixels to spare keeps the old
     * one-and-one, because at 1x a two-pixel bar and a one-pixel gap is a
     * different, worse drawing rather than a finer one.
     */
    const pitch = dpr >= 2 ? 3 : 2;
    const ink = pitch - 1;
    const devSpan = span * dpr, devInset = inset * dpr, devHead = head * dpr;
    const bars = Math.max(1, Math.floor(devSpan / pitch));
    // Fractional so the bars fill the travel exactly; the LEFT EDGE of each is
    // rounded, which is what keeps them crisp.
    const step = devSpan / bars;
    const mid = Math.round((h / 2) * dpr);
    const height = (h - 2) * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < bars; i++) {
      /*
       * Folded the way the server folds, and for the same reason: these are RMS
       * levels, so the RMS of them is exactly the level of the whole span — a
       * bar drawn from eleven stored values is the same height it would be if
       * the track had been analysed straight into this many buckets. A MAXIMUM
       * here would put the flattening straight back, because the loudest bucket
       * in a bar of a limited record is the same number in every bar of it.
       */
      const a = Math.floor(i * peaks.length / bars);
      const b = Math.min(peaks.length, Math.max(a + 1, Math.floor((i + 1) * peaks.length / bars)));
      let sum = 0;
      for (let j = a; j < b; j++) sum += peaks[j] * peaks[j];
      const v = Math.sqrt(sum / (b - a));
      /*
       * NOT ROUNDED TO A WHOLE PIXEL. Everything up to here is exact and then
       * the height used to be snapped to a pixel, which threw away more than
       * the stored value ever had: at 34px a whole pixel is 2.9% of full scale
       * against a stored value good to 0.4%. A fractional height antialiases
       * the two END CAPS and nothing else — the bar stays on whole device
       * pixels horizontally, so the top edge gains precision rather than the
       * whole shape losing crispness.
       *
       * The floor stays, in device pixels: silence is a line rather than a gap,
       * because a gap reads as "the waveform stopped loading".
       */
      const barH = Math.max(1, (v / 255) * height);
      const x = Math.round(devInset + i * step);
      // A bar counts as played once its MIDDLE is behind the playhead, so the
      // boundary lands where the dot is rather than a bar's width either side.
      const done = (x + ink / 2) <= devHead;
      ctx.fillStyle = done ? played : ahead;
      // The played side goes to full strength so the accent still reads as the
      // position marker against a now-bright track ahead of it.
      ctx.globalAlpha = done ? 1 : 0.72;
      // Centred on the midline exactly. Rounding the offset as well as the
      // height pushed an odd-numbered bar half a pixel upwards, every time.
      ctx.fillRect(x, mid - barH / 2, ink, barH);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // The switch's state, fetched once. loadWaveformEnabled() in the settings
  // module also writes window.__waveformOn, but that only runs when the
  // Settings pane is opened — without this the waveform stayed invisible on a
  // fresh load until you happened to go and look at the setting.
  let waveFlagPending = null;
  function waveformOn() {
    if (window.__waveformOn !== undefined) return Promise.resolve(window.__waveformOn);
    if (!waveFlagPending) {
      waveFlagPending = fetch("/api/settings/waveform")
        .then(r => (r.ok ? r.json() : null))
        .then(j => { window.__waveformOn = !!(j && j.enabled); return window.__waveformOn; })
        .catch(() => { window.__waveformOn = false; return false; });
    }
    return waveFlagPending;
  }

  async function loadWaveform() {
    if (!npWave) return;
    const on = await waveformOn();
    const id = npWaveIdentity();
    if (!id || !on) {
      npWavePeaks = null; npWaveKey = "";
      drawWave();
      return;
    }
    if (id.key === npWaveKey) return;    // same track: what we have still applies
    npWaveKey = id.key;
    npWavePeaks = null;
    drawWave();                          // plain bar while we ask
    const mine = ++npWaveReq;
    try {
      // The LENGTH goes with it. For a streaming track the server has no file
      // and matches the track on the service by title AND duration — without
      // this it cannot tell a song from a remaster of it that shares the title,
      // so it declines rather than guessing and nothing is ever drawn.
      const q = "track=" + encodeURIComponent(id.track) +
                "&album=" + encodeURIComponent(id.album) +
                "&artist=" + encodeURIComponent(id.artist) +
                "&length=" + encodeURIComponent(npLen || 0);
      const r = await fetch("/api/waveform?" + q);
      if (!r.ok) return;
      const j = await r.json();
      // The track may have moved on while the server was decoding. Landing a
      // stale waveform under a different song is worse than none: it looks
      // authoritative and it is simply the wrong shape.
      //
      // The KEY check is the one that does the work, and it catches two things:
      // a skip (the key is now the next track's) and the setting being switched
      // off mid-decode (__repaintWaveform blanks the key without touching the
      // generation). The generation is belt and braces — every path that bumps
      // it without changing the key is a repeat request for the SAME track, so
      // a late answer there is the right shape anyway. It stays because it is
      // what keeps this correct if the key logic is ever changed.
      if (mine !== npWaveReq || npWaveKey !== id.key) return;
      // "busy" means the server is decoding a DIFFERENT track and will be free
      // in a moment. Leaving the key set would latch this track to no waveform
      // for as long as it plays, so drop it and let the next poll ask again —
      // the request costs nothing while the server is busy, because it answers
      // without decoding.
      if (j && j.reason === "busy") { npWaveKey = ""; return; }
      if (!j || !j.peaks) return;
      const bin = atob(j.peaks);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      npWavePeaks = u8;
      drawWave();
    } catch (e) {
      /* No waveform is a normal answer — a streaming track, an undecodable
         file, the server busy. The plain bar is already showing. */
    }
  }

  // The settings switch repaints through this rather than reaching into the
  // module: turning it off must clear a waveform already on screen.
  window.__repaintWaveform = () => { npWaveKey = ""; loadWaveform(); };

  function paintSeek(pos) {
    if (!npSeek) return;
    const max = parseFloat(npSeek.max) || 0;
    // Number.isFinite, not `!= null`: NaN passes a null check and would reach
    // the gradient string as "NaN%", which is invalid and drops the fill
    // entirely rather than reading zero.
    const val = Number.isFinite(pos) ? pos : (parseFloat(npSeek.value) || 0);
    const pct = max > 0 ? Math.max(0, Math.min(100, (val / max) * 100)) : 0;

    // The waveform carries the same progress, from the same number, so the two
    // can never disagree about where the track is. Drawn FIRST because this is
    // what adds and removes .has-wave, which the fill below reads.
    drawWave(val);

    // With a waveform showing, the range's own 4px track draws a line straight
    // through the middle of the shape, and the canvas already paints the
    // played/unplayed split. The stylesheet sets --seek-fill to transparent for
    // that case, but an INLINE custom property beats any stylesheet rule
    // however specific, so it has to be REMOVED here rather than overridden —
    // writing the gradient unconditionally is what put a grey line across the
    // waveform in v1.7.90.
    if (npProgressEl && npProgressEl.classList.contains("has-wave")) {
      npSeek.style.removeProperty("--seek-fill");
      return;
    }
    // The unplayed part in --seek-rest where a theme sets it (Mandarin's
    // level meter uses its unlit-segment colour), the border colour otherwise.
    npSeek.style.setProperty("--seek-fill",
      "linear-gradient(to right, var(--accent) 0%, var(--accent) " + pct + "%, " +
      "var(--seek-rest, var(--border)) " + pct + "%, var(--seek-rest, var(--border)) 100%)");
  }

  async function seek(seconds) {
    if (!currentZone) return;
    // Believe our own seek, BEFORE the await so the caller can paint straight
    // after this returns into its first suspension. The refresh scheduled below
    // almost always arrives before Roon has applied the seek, so the pre-seek
    // position came back and yanked the bar to where it had just been — then a
    // later poll yanked it forward again. Two visible jumps for one drag.
    // Base and hold are set together, here, so a future second caller cannot
    // get one without the other and freeze the bar at a stale position.
    npSetBase(seconds);
    npSeekHold = Date.now() + 1500;   // longer than the refresh it guards
    try {
      await fetch("/api/seek", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone_or_output_id: currentZone.zone_id, seconds })
      });
      setTimeout(fetchState, 200);
    } catch (e) { /* seek is best-effort; fetchState() already scheduled above */ }
  }

  async function control(command) {
    if (!currentZone) return;
    try {
      const r = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone_or_output_id: currentZone.zone_id, command })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        console.warn("control failed:", j.error || r.status);
      }
      // Refresh quickly so the icon updates
      setTimeout(fetchState, 200);
    } catch (e) { /* transport control is best-effort; fetchState() already scheduled above */ }
  }

  // Roon's per-zone playback modes. The server always sends `settings`, but a
  // page kept alive across an extension update can briefly be talking to the
  // old one — an absent block reads as everything off rather than throwing.
  function zoneModes() {
    const s = (currentZone && currentZone.settings) || {};
    return {
      shuffle:    !!s.shuffle,
      loop:       (s.loop === "loop" || s.loop === "loop_one") ? s.loop : "disabled",
      auto_radio: !!s.auto_radio
    };
  }

  const LOOP_LABEL = { disabled: "Repeat off", loop: "Repeat queue", loop_one: "Repeat track" };
  // Tapping repeat cycles off → whole queue → this track, as Roon's remote does.
  const LOOP_NEXT  = { disabled: "loop", loop: "loop_one", loop_one: "disabled" };

  let lastModeSig = "";
  function paintModeButtons() {
    const live = !!currentZone;
    const m = zoneModes();
    // updateNpScreen() runs on the 1.5s poll, and setAttribute() marks an
    // attribute dirty even when the value is unchanged — the same reason the
    // mini bar's repaint is gated by lastBarSig. Nothing below changes unless
    // the zone's modes do, so skip the whole thing when they haven't.
    const sig = [live, m.shuffle, m.loop, m.auto_radio].join("|");
    if (sig === lastModeSig) return;
    lastModeSig = sig;
    if (npShuffle) {
      npShuffle.disabled = !live;
      npShuffle.classList.toggle("is-on", live && m.shuffle);
      npShuffle.setAttribute("aria-pressed", String(live && m.shuffle));
      npShuffle.setAttribute("aria-label", live && m.shuffle ? "Shuffle on" : "Shuffle");
    }
    if (npLoop) {
      const loop = live ? m.loop : "disabled";
      npLoop.disabled = !live;
      npLoop.classList.toggle("is-on", loop !== "disabled");
      npLoop.setAttribute("aria-label", LOOP_LABEL[loop]);
      if (npLoopBadge) npLoopBadge.classList.toggle("hidden", loop !== "loop_one");
    }
  }

  // Shuffle / repeat / Roon Radio. Mirrors control(): fire, then re-poll, so the
  // buttons show what the ZONE reports rather than what we asked for — a change
  // the Core rejects must not leave a button lit.
  async function changeZoneSettings(patch) {
    if (!currentZone) return;
    try {
      const r = await fetch("/api/zone-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ zone_or_output_id: currentZone.zone_id }, patch))
      });
      const j = await r.json().catch(() => ({}));
      // Shuffle and repeat only — Roon Radio moved to Settings → Playback in
      // v1.7.71, where the exclusivity rule announces itself by the two
      // switches moving. So a failure is the only thing left to report here.
      if (!r.ok) {
        console.warn("zone-settings failed:", j.error || r.status);
        if (window.__showToast) window.__showToast(j.error || "Could not change that", "error");
      }
    } catch (e) {
      // Network blip. The finally below still re-polls, so the buttons resync.
    } finally {
      setTimeout(fetchState, 200);
    }
  }

  // The single choke point for every ABSOLUTE volume write — drag, release and
  // the −/+ buttons — so the hold cannot be forgotten at one of them the way it
  // was for the buttons. (The incremental branch of stepVolume sends a RELATIVE
  // nudge and deliberately does not come through here; there is no absolute
  // value to hold.)
  //
  // Serialised and latest-wins. These are absolute writes issued fire-and-forget
  // over separate connections, so a drag from 40 to 60 could emit 45, 52, 60 and
  // have 52 arrive last — leaving the zone at 52 and the poll then faithfully
  // dragging the thumb backwards. One in flight at a time, with only the newest
  // value queued behind it, makes that impossible.
  let volInFlight = false, volQueued = null;

  // The zone id travels WITH the value. It used to be read off currentZone
  // inside the loop, which is after an await on every iteration but the first —
  // so switching zones mid-drag posted the queued value to the zone just
  // switched TO, and a switch to nothing threw a TypeError the catch swallowed
  // as a network blip.
  async function postVolume(zoneId, value) {
    // Bounded, because neither this fetch nor /api/volume had any timeout: the
    // server only answers once Roon's change_volume callback fires, and if the
    // Core drops mid-call that promise never settles. volInFlight would then
    // stay true for the lifetime of the page and every later write would queue
    // behind it forever — volume dead until reload.
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), 5000) : null;
    try {
      await fetch("/api/volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone_or_output_id: zoneId, value }),
        signal: ctl ? ctl.signal : undefined
      });
    } finally {
      if (t) clearTimeout(t);
    }
  }

  async function setVolume(value) {
    if (!currentZone) return;
    const zoneId = currentZone.zone_id;
    holdVolume(value);                         // covers the drag AND the buttons
    if (volInFlight) { volQueued = { zoneId, value }; return; }
    volInFlight = true;
    let job = { zoneId, value };
    while (job) {
      // Inside the loop, so one failed write does not abandon a value already
      // queued and already painted — the user would be looking at a number
      // nothing had been told about.
      try { await postVolume(job.zoneId, job.value); }
      catch (e) { /* blip or 5s timeout — the poll resyncs once the hold expires */ }
      job = volQueued; volQueued = null;
    }
    volInFlight = false;
    // Pull the echo rather than waiting up to 1.5s for it — the same pattern
    // control() and toggleMute() use (they wait 200ms and 150ms). Coalesced:
    // stepVolume has no debounce, so four fast taps would otherwise schedule
    // four refreshes all landing within a few hundred ms of each other.
    scheduleEchoFetch();
  }
  let volEchoTimer = null;
  function scheduleEchoFetch() {
    clearTimeout(volEchoTimer);
    volEchoTimer = setTimeout(fetchState, 200);
  }
  async function toggleMute() {
    if (!currentZone) return;
    const muted = (currentZone.outputs || []).some(o => o.is_muted);
    try {
      await fetch("/api/volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone_or_output_id: currentZone.zone_id, mute: !muted })
      });
      setTimeout(fetchState, 150);
    } catch (e) { /* mute is best-effort; fetchState() already scheduled above */ }
  }

  // Wire controls
  btnPP  .addEventListener("click", () => control("playpause"));

  // Now-playing screen transport (mirrors the mini bar's controls)
  if (npPlayPause) npPlayPause.addEventListener("click", () => control("playpause"));
  if (npPrev)      npPrev.addEventListener("click", () => control("previous"));
  if (npNext)      npNext.addEventListener("click", () => control("next"));

  // Playback modes. Each reads the zone's CURRENT value at click time (not a
  // mirrored local flag) and sends the concrete state it wants.
  if (npShuffle) npShuffle.addEventListener("click", () => changeZoneSettings({ shuffle: !zoneModes().shuffle }));
  if (npLoop)    npLoop.addEventListener("click", () => changeZoneSettings({ loop: LOOP_NEXT[zoneModes().loop] }));

  // Volume popover: tap the speaker to reveal the slider (or the "fixed" note).
  if (npVolBtn && npVolPopover) {
    npVolBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const dp = document.getElementById("np-device-popover");
      if (dp) dp.classList.add("hidden");
      const willShow = npVolPopover.classList.contains("hidden");
      npVolPopover.classList.toggle("hidden", !willShow);
      npVolBtn.setAttribute("aria-expanded", String(willShow));
    });
  }

  // Shut both now-playing popovers (volume, device) and reset their buttons.
  function closeNpPopovers() {
    if (npVolPopover) npVolPopover.classList.add("hidden");
    if (npVolBtn) npVolBtn.setAttribute("aria-expanded", "false");
    const dp = document.getElementById("np-device-popover");
    const db = document.getElementById("np-device");
    if (dp) dp.classList.add("hidden");
    if (db) db.setAttribute("aria-expanded", "false");
  }

  // Close the now-playing popovers when tapping outside the controls row.
  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest(".np-secondary")) return;
    closeNpPopovers();
  });

  // Now-playing scrubber: show the dragged time live, seek on release.
  if (npSeek) {
    npSeek.addEventListener("input", () => {
      userIsDraggingSeek = true;
      npCur.textContent = fmtTime(parseFloat(npSeek.value));
      paintSeek(parseFloat(npSeek.value));
      paintBarProgress();
    });
    npSeek.addEventListener("change", () => {
      const target = parseFloat(npSeek.value);
      userIsDraggingSeek = false;
      seek(target);         // sets the base + hold synchronously, then posts
      paintSeek(target);
      paintBarProgress();   // the thumb and the mini bar's line must land together
    });
  }

  // Now-playing volume slider (kept in sync with the mini bar)
  let npVolDebounce = null;
  if (npVolSlider) {
    npVolSlider.addEventListener("input", () => {
      userIsDraggingVolume = true;
      const v = parseFloat(npVolSlider.value);
      syncVolumeUI(v);
      clearTimeout(npVolDebounce);
      npVolDebounce = setTimeout(() => setVolume(v), 90);
    });
    npVolSlider.addEventListener("change", () => {
      userIsDraggingVolume = false;
      // Drop the queued mid-drag write: it holds an older value and would land
      // AFTER this final one, re-sending a position the user has moved past.
      clearTimeout(npVolDebounce);
      setVolume(parseFloat(npVolSlider.value));
    });
  }

  // Paint the progress bar from the clock, four times a second.
  //
  // It PAINTS, it does not advance — npNow() derives the position from the base
  // and elapsed time, so a late or throttled tick cannot make the bar drift, and
  // missing ticks entirely just means it repaints correctly when it resumes.
  // 250ms matches display.js; rAF would be waste, since the fill moves about a
  // pixel and a half per second.
  setInterval(() => {
    // npPlaying() already null-checks currentZone, and no now_playing implies
    // npLen === 0, so those two clauses are covered by what remains.
    if (userIsDraggingSeek || !npPlaying() || npLen <= 0) return;
    const pos = npNow();                 // already clamped to [0, npLen]
    paintBarProgress(pos);
    if (onNowPlayingScreen()) {
      npSeek.value = pos;
      paintSeek(pos);
      npCur.textContent = fmtTime(pos);
    }
  }, 250);

  // Let the modal code refresh bar visibility + the now-playing screen on open,
  // tab switch, and close.
  window.__refreshTransport = () => { refreshVisibility(); updateNpScreen(); };

  // Live getter for the share button: reads currentZone directly at call time
  // instead of relying on a mirrored global kept in sync by convention. This
  // is the third fix for "share card shows a stale album" (v1.5.89, v1.5.90,
  // and the Queue-tab case fixed alongside this getter) — a read-time getter
  // makes the whole class of "forgot to update the mirror" bug impossible.
  window.__getCurrentNp = () => currentZone && currentZone.now_playing;

  btnVol.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!currentZone) { btnZone.click(); return; }
    if (!currentVolOutput()) { if (window.__showToast) window.__showToast("This zone's volume is set on the device itself"); return; }
    volPop.classList.toggle("hidden");
    btnVol.setAttribute("aria-expanded", !volPop.classList.contains("hidden"));
  });
  // Long-press the speaker icon to mute (kept simple: shift-click also mutes on desktop)
  btnVol.addEventListener("dblclick", (e) => {
    e.preventDefault();
    toggleMute();
  });

  let volDebounce = null;
  volSlider.addEventListener("input", () => {
    userIsDraggingVolume = true;
    const v = parseFloat(volSlider.value);
    syncVolumeUI(v);
    clearTimeout(volDebounce);
    volDebounce = setTimeout(() => setVolume(v), 90);
  });
  volSlider.addEventListener("change", () => {
    userIsDraggingVolume = false;
    clearTimeout(volDebounce);   // see the NP slider's change handler
    setVolume(parseFloat(volSlider.value));
  });

  // Close volume popover when clicking outside it
  document.addEventListener("click", (e) => {
    if (volPop.classList.contains("hidden")) return;
    if (volPop.contains(e.target) || btnVol.contains(e.target)) return;
    volPop.classList.add("hidden");
    btnVol.setAttribute("aria-expanded", "false");
  });

  // Zone picker on the bar (Roon-style speaker button)
  async function renderBarZoneList() {
    if (!zoneList) return;
    let list = [];
    try {
      const r = await fetch("/api/zones", { cache: "no-store" });
      if (r.ok) { const j = await r.json(); if (Array.isArray(j.zones)) list = j.zones; }
    } catch (e) { /* zone list is non-critical; picker shows "No zones available" */ }
    zoneList.innerHTML = "";
    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "np-device-empty";
      empty.textContent = "No zones available";
      zoneList.appendChild(empty);
      return;
    }
    const sel = document.getElementById("zone-select");
    const cur = sel && sel.value;
    for (const z of list) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "np-device-item" + (z.zone_id === cur ? " is-current" : "");
      if (window.__fillZoneRow) window.__fillZoneRow(item, z);
      else item.textContent = z.display_name;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        zonePop.classList.add("hidden");
        btnZone.setAttribute("aria-expanded", "false");
        if (!sel || z.zone_id === cur) return;
        sel.value = z.zone_id;
        sel.dispatchEvent(new Event("change"));   // reuse the existing switch flow
      });
      zoneList.appendChild(item);
    }
  }
  if (btnZone && zonePop) {
    btnZone.addEventListener("click", async (e) => {
      e.stopPropagation();
      volPop.classList.add("hidden");
      btnVol.setAttribute("aria-expanded", "false");
      const willShow = zonePop.classList.contains("hidden");
      if (willShow) await renderBarZoneList();
      zonePop.classList.toggle("hidden", !willShow);
      btnZone.setAttribute("aria-expanded", String(willShow));
    });
    document.addEventListener("click", (e) => {
      if (zonePop.classList.contains("hidden")) return;
      if (zonePop.contains(e.target) || btnZone.contains(e.target)) return;
      zonePop.classList.add("hidden");
      btnZone.setAttribute("aria-expanded", "false");
    });
    const popoverAction = (id, open) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        zonePop.classList.add("hidden");
        btnZone.setAttribute("aria-expanded", "false");
        const fn = window[open];
        if (fn) fn();
      });
    };
    popoverAction("mt-group-open", "__openGroupSheet");
    popoverAction("mt-power-open", "__openDevicePowerSheet");
    // Same three all-zone actions as the now-playing picker, same source.
    for (const act of ["pause-all", "mute-all", "unmute-all"]) {
      const b = document.getElementById("mt-" + act);
      if (!b) continue;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        zonePop.classList.add("hidden");
        btnZone.setAttribute("aria-expanded", "false");
        const fn = window.__allZoneActions && window.__allZoneActions[act];
        if (fn) fn();
      });
    }
  }

  // Tap the info area (art + text) to open the now-playing album in the modal
  const infoArea = bar.querySelector(".mt-info");
  infoArea.addEventListener("click", () => {
    if (!currentZone || !currentZone.now_playing) return;
    if (typeof window.__openAlbum !== "function") return;
    const np = currentZone.now_playing;
    window.__openAlbum({
      title:     np.line3 || np.line1 || "",
      subtitle:  np.line2 || "",
      image_key: np.image_key
    }, { source: "now-playing", zoneId: currentZone.zone_id });
  });

  // Volume +/- buttons (shared by the mini-bar sheet and the NP sheet)
  const stepMinus   = document.getElementById("mt-vol-minus");
  const stepPlus    = document.getElementById("mt-vol-plus");
  const npStepMinus = document.getElementById("np-vol-minus");
  const npStepPlus  = document.getElementById("np-vol-plus");
  async function stepVolume(delta) {
    const vo = currentVolOutput();   // read-time — never a stale mirror
    if (!vo) return;
    if ((vo.volume.type || null) === "incremental") {
      // Relative-only output: no absolute scale exists — send a nudge.
      try {
        await fetch("/api/volume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zone_or_output_id: currentZone.zone_id, relative: delta > 0 ? 1 : -1 })
        });
      } catch (e) { /* best-effort, like setVolume */ }
      return;
    }
    // Safe to step from the painted value: volumeHeld() keeps a stale poll from
    // reverting it, so what is on screen IS what we last sent. Without that hold
    // this read is what silently lost taps — the display having gone back to 50,
    // a second + recomputed 51 and re-sent a value already sent.
    const cur = parseFloat(volSlider.value);
    // Range and step come from the output itself, not from the slider's
    // attributes. Those attributes are only a mirror written by renderZone, and
    // reading state back out of a mirror is the exact thing currentVolOutput()
    // exists to avoid.
    const vol = vo.volume;
    const min = vol.min != null ? vol.min : 0;
    // The zone's own step, not a hardcoded 2: Roon `number` volumes step by 1,
    // dB outputs commonly by 0.5, so a fixed 2 moved two or four positions.
    // `delta * stepSz` rather than sign(delta), so a caller can still ask for a
    // multi-step nudge later without rewriting this.
    const stepSz = vol.step != null ? vol.step : 1;
    const next = Math.max(min, Math.min(volCeiling(vol), cur + delta * stepSz));
    syncVolumeUI(next);
    setVolume(next);
  }
  if (stepMinus)   stepMinus  .addEventListener("click", (e) => { e.stopPropagation(); stepVolume(-1); });
  if (stepPlus)    stepPlus   .addEventListener("click", (e) => { e.stopPropagation(); stepVolume(+1); });
  if (npStepMinus) npStepMinus.addEventListener("click", (e) => { e.stopPropagation(); stepVolume(-1); });
  if (npStepPlus)  npStepPlus .addEventListener("click", (e) => { e.stopPropagation(); stepVolume(+1); });

  // Long-poll (v0.6.10): rather than asking every 1.5s, ask the server to
  // answer when something changes (wait_for = the last revision seen) or after
  // 10s regardless. Between answers the bar's clock moves the progress, and
  // the server bumps the revision on a seek or a drift of more than 3s, so the
  // screen is as current as before for a fraction of the requests — the phone's
  // radio and CPU idle instead of waking forty times a minute. 10s, not longer:
  // each ask also keeps the room "watched" (polled fast on the server), which
  // lapses after 15s. pollTimer holds the loop's AbortController.
  async function pollLoop(ctl) {
    let fails = 0;
    while (pollTimer === ctl) {
      const zid = selectedZoneId();
      if (!zid) { renderZone(null); await new Promise(r => setTimeout(r, 1500)); continue; }
      const wait = zid === stateZone && stateRev >= 0 ? "&wait_for=" + stateRev + "&timeout=10000" : "";
      try {
        const r = await fetch("/api/zone-state?zone=" + encodeURIComponent(zid) + wait, { cache: "no-store", signal: ctl.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json();
        if (pollTimer !== ctl) return;
        // Not newer (a one-off fetch got there first, or the room changed):
        // a breath before asking again, so a mismatch can never spin.
        if (!applyState(zid, j)) await new Promise(r => setTimeout(r, 250));
        fails = 0;
      } catch (e) {
        if (pollTimer !== ctl) return;
        // Server or network trouble: back off (1.5s, 3s … 15s) and keep what we have.
        fails++;
        await new Promise(r => setTimeout(r, Math.min(15000, 1500 * fails)));
      }
    }
  }
  function startPolling() {
    if (pollTimer) return;
    pollTimer = new AbortController();
    pollLoop(pollTimer);
  }
  function stopPolling() {
    if (pollTimer) { pollTimer.abort(); pollTimer = null; }
  }
  // A new room: the waiting ask is for the old one, so start again at once.
  function restartPolling() { if (!pollTimer) return; stopPolling(); startPolling(); }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { stopPolling(); return; }
    // Discard the elapsed time accumulated while hidden before anything paints.
    // The poll stops when the page is hidden but the clock does not, so after a
    // long background the first tick would compute a position minutes ahead,
    // clamp it to the track length, and flash the bar at 100% with the full
    // duration in the readout until the refresh landed. Holding the last known
    // position instead is stale by the same amount but never absurd, and
    // startPolling() corrects it within one round trip.
    npSetBase(npBase);
    npWasPlaying = npPlaying();
    startPolling();
  });

  // Refresh when zone selector changes
  const zoneSel = document.getElementById("zone-select");
  if (zoneSel) zoneSel.addEventListener("change", restartPolling);

  // v1.7.81 gave the pill a backdrop-filter and stripped it here for the
  // duration of every scroll, so the look and the frame rate could coexist.
  // Both halves of that are gone as of v1.7.85: `saturate()` brightens whatever
  // shows through the pill, so the filtered and unfiltered states never looked
  // alike no matter how opaque the background got, and the pill is now
  // translucent with no filter at all. Nothing styles .is-scrolling any more,
  // so the listener that set it — a capture-phase document scroll handler with
  // a 260ms settle timer — has gone with it rather than being left to toggle a
  // class on every scroll frame for nothing.

  // Boot — restore last known state instantly, then let the poll loop refresh it.
  restoreTransportState();
  startPolling();
})();

/* ------------------------------------------------------------------ */
/*  Top bar height -> --topbar-h                                       */
/* ------------------------------------------------------------------ */
/* v1.7.88. The top bar overlays the scroller now, so album art passes under
   it and shows through the veil. The cost of taking it out of the flow is that
   <main> has to reserve its height itself, and that height is not a constant:
   it grows with the status-bar inset, with the scan-progress strip appearing,
   and with the search row opening.
   So it is MEASURED rather than guessed. style.css carries a fallback for the
   frame before this runs (and for no-JS); this replaces it with the real
   number and keeps it current. .filter-bar sticks to the same variable, which
   until now hard-coded 56px and had to be kept in step by hand. */
(() => {
  const bar = document.querySelector(".topbar");
  const app = document.querySelector(".app");
  if (!bar || !app) return;

  let last = -1;
  const publish = () => {
    // Rounded UP: half a pixel short leaves a hairline of album art peeking
    // above the first row, which reads as a rendering fault rather than a
    // design. A pixel of extra reserve is invisible.
    const h = Math.ceil(bar.getBoundingClientRect().height);
    if (h > 0 && h !== last) {
      last = h;
      app.style.setProperty("--topbar-h", h + "px");
    }
  };
  publish();

  if (typeof ResizeObserver === "function") {
    /*
     * BORDER BOX, NOT THE DEFAULT CONTENT BOX — and the difference is the
     * whole bug this line fixes.
     *
     * What is published is `getBoundingClientRect().height`, which INCLUDES
     * padding. The bar's padding is `calc(12px + env(safe-area-inset-top))`,
     * so the inset is inside it. A ResizeObserver with default options
     * watches the CONTENT box, which the inset is not part of — so a change
     * to the safe area could move the bar's real height without the observer
     * ever firing, and `--topbar-h` would keep a value from the orientation
     * before. `main` reserves that number as padding, so the Home screen
     * opened one whole inset too far down, with an empty band above the first
     * row. Reported after rotating, which is the one thing that changes an
     * inset.
     */
    new ResizeObserver(publish).observe(bar, { box: "border-box" });
  }
  /*
   * AND the viewport events as well, not as a fallback.
   *
   * The observer is the right primary — it catches the search row opening,
   * which fires nothing else — but an inset can change with no box change at
   * all, and a rotation is not an instant: iOS fires orientationchange before
   * the web view has finished resizing, so a value read on the event can be
   * from mid-transition. Sampled again as it settles, the same way the window
   * pin and the diagnostic panel sample a turn, and `h !== last` means the
   * extra reads cost a comparison and nothing else.
   */
  const republish = () => { publish(); setTimeout(publish, 300); setTimeout(publish, 1000); };
  window.addEventListener("resize", republish, { passive: true });
  window.addEventListener("orientationchange", republish, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", republish, { passive: true });
  }
})();

/* ------------------------------------------------------------------ */
/*  Settings info-icon toasts                                         */
/* ------------------------------------------------------------------ */
/* An ⓘ after a setting's name: its help, shown when tapped (v0.6.0-RC7 puts
 * every longer explanation behind one, as Smart Picks and the rest had). */
function settingsInfo(text) {
  const t = String(text == null ? "" : text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return ' <button class="settings-info-btn" type="button" data-info="' + t + '" aria-label="Info">ⓘ</button>';
}

(() => {
  let toast = null;
  let dismissTimer = null;

  function getToast() {
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "settings-info-toast";
      toast.setAttribute("role", "tooltip");
      document.body.appendChild(toast);
    }
    return toast;
  }

  function hideToast() {
    if (!toast) return;
    toast.classList.remove("visible");
    clearTimeout(dismissTimer);
  }

  function showToast(text) {
    const t = getToast();
    t.textContent = text;
    t.classList.add("visible");
    clearTimeout(dismissTimer);
    // Long enough to READ (v0.6.1): 5s was gone halfway through the longer
    // notes. About a fifth of a second a word on top of four seconds, at most
    // 25s; any tap elsewhere still closes it at once.
    const words = String(text || "").split(/\s+/).length;
    dismissTimer = setTimeout(hideToast, Math.min(25000, 4000 + words * 220));
  }

  // Every ⓘ was announced as just "Info". Each is named after the setting it
  // explains, read from the label it sits in — the ones in the page now and
  // the ones the settings screens draw later.
  function nameInfoButtons(root) {
    const list = root.matches && root.matches(".settings-info-btn") ? [root]
      : root.querySelectorAll ? root.querySelectorAll(".settings-info-btn") : [];
    for (const btn of list) {
      if (btn.getAttribute("aria-label") && btn.getAttribute("aria-label") !== "Info") continue;
      const host = btn.closest(".settings-label, .settings-block-title") || btn.parentElement;
      const name = host ? host.textContent.replace(/[ⓘ\u24D8]/g, "").trim() : "";
      btn.setAttribute("aria-label", name && name.length <= 60 ? "About " + name : "More information");
    }
  }
  nameInfoButtons(document);
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) nameInfoButtons(n);
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".settings-info-btn");
    if (btn) {
      e.stopPropagation();
      showToast(btn.dataset.info || "");
      return;
    }
    hideToast();
  }, true);
})();

/* ------------------------------------------------------------------ */
/*  Share card overlay                                                 */
/* ------------------------------------------------------------------ */
(() => {
  const overlay   = document.getElementById("share-overlay");
  const frame     = document.getElementById("share-frame");
  const actions   = document.getElementById("share-actions");
  const linksEl   = document.getElementById("share-links");
  const similarEl = document.getElementById("share-similar");
  const similarLs = document.getElementById("share-similar-list");
  const hintEl    = document.getElementById("share-hint");
  const errEl     = document.getElementById("share-err");
  const modalBtn  = document.getElementById("modal-share-btn");

  // Bounded (v0.6.1): a font that never arrived held the card up for ever.
  async function ensureFont() {
    if (!document.fonts || !document.fonts.load) return;
    const loaded = (async () => {
      await Promise.all([
        document.fonts.load('700 42px Manrope'),
        document.fonts.load('400 28px Manrope'),
        document.fonts.load('700 16px Manrope'),
        document.fonts.load('400 22px Manrope')
      ]);
      await document.fonts.ready;
    })().catch(() => { /* fall back to the system face */ });
    await Promise.race([loaded, new Promise(r => setTimeout(r, 2000))]);
  }

  function close() {
    // Anything still in flight for the record that was on screen is no longer
    // wanted: without this a card or a suggestions row can arrive after the
    // sheet has been shut and paint into it.
    shareSeq++;
    overlay.classList.add("hidden");
    frame.innerHTML =
      `<div class="share-placeholder"><div class="share-spinner"></div><div>Generating card…</div></div>`;
    actions.innerHTML = "";
    if (linksEl) { linksEl.innerHTML = ""; linksEl.classList.add("hidden"); }
    if (similarEl && similarLs) { similarLs.innerHTML = ""; similarEl.classList.add("hidden"); }
    lastActs = [];
    hintEl.textContent = "";
    errEl.textContent  = "";
  }
  overlay.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("[data-share-close]")) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) close();
  });

  // What the card shows, from an /api/album/extras answer (or none).
  function cardFields(j) {
    const f = { releaseRaw: "", labelText: "", reviewText: "", reviewSource: "", links: null, score: null, bestNew: false };
    if (j) {
      if (j.links) f.links = j.links;
      if (j.year) f.releaseRaw = j.year;
      if (j.album && j.album.year && !f.releaseRaw) f.releaseRaw = String(j.album.year);
      if (j.album && j.album.label) f.labelText = String(j.album.label);
      // Pitchfork's number and their Best New Music flag — never their
      // prose, which the server nulls before it leaves fetchAlbumBios.
      if (j.album && j.album.score != null) f.score = j.album.score;
      if (j.album && j.album.isBestNewMusic) f.bestNew = true;
      const desc = j.album && j.album.description;
      // Settings → Share Card → Review switched off: a card without it.
      const wantReview = !(j.card && j.card.review === false);
      if (desc && wantReview) {
        // Card height grows to fit, so show most of the review — capped
        // (~10 sentences / 1400 chars) against a very long article.
        let t = String(desc).trim();
        const sentences = t.match(/[^.!?]+[.!?]+/g);
        if (sentences && sentences.length > 10) t = sentences.slice(0, 10).join(" ").trim();
        if (t.length > 1400) t = t.slice(0, 1398).replace(/\s+\S*$/, "") + "…";
        f.reviewText = t;
        // Whose prose it is — not where the link goes (kept apart on purpose).
        if (j.album.description_source) f.reviewSource = String(j.album.description_source);
      }
    }
    f.signature = [f.releaseRaw, f.labelText, f.reviewText, f.reviewSource, f.score, f.bestNew].join("|");
    return f;
  }
  // Draw the card and put it on screen (an object URL: no base64 copy of a
  // large PNG to make first). Only while this open is still the current one.
  let cardUrl = null;
  async function paintCard(f, coverUrl, title, artist, seq) {
    const blob = await ShareCard.render({
      coverUrl, wordmarkUrl: null, title, artist,
      releaseRaw: f.releaseRaw, label: f.labelText, review: f.reviewText,
      reviewSource: f.reviewSource, score: f.score, bestNewMusic: f.bestNew
    });
    if (seq !== shareSeq) return;
    if (cardUrl) URL.revokeObjectURL(cardUrl);
    cardUrl = URL.createObjectURL(blob);
    frame.innerHTML = "";
    const img = document.createElement("img");
    img.src = cardUrl; img.alt = "Share card";
    frame.appendChild(img);
    buildActions(blob, title, artist);
  }
  // Called when an album opens: fetch its big cover now, so a share is instant.
  window.__prewarmShareCard = (imageKey) => {
    if (!imageKey) return;
    try { const im = new Image(); im.src = `/api/image/${encodeURIComponent(imageKey)}?size=1000`; } catch (e) { /* only a head start */ }
  };

  // Public entry point — called from album modal share button + mini transport
  async function open(input) {
    const title  = input.title  || "";
    const artist = input.artist || "";
    if (!title) return;

    /*
     * WHICH OPEN THIS IS. Stamped here, at the top, and not where each
     * asynchronous piece is issued — because two opens can finish their awaits
     * OUT OF ORDER and the later stamp then belongs to the earlier record.
     *
     * Found by the test rather than by reading: open, close, open again, and
     * the suggestions row came back showing acts for the first record under
     * the second one's card. The stamp used to be taken where the suggestion
     * fetch was issued (`++similarSeq` at the end of open), so whichever open
     * got there first owned the newest number — and the first open is not
     * always the first to get there. ensureFont() alone is enough to reorder
     * them: it really loads the font once and resolves instantly afterwards.
     *
     * Everything this open paints is now gated on still being the current one,
     * the card included — a superseded open painting its card over the live
     * one is the same bug wearing a different hat.
     */
    const mySeq = ++shareSeq;

    actions.innerHTML = "";
    if (linksEl) { linksEl.innerHTML = ""; linksEl.classList.add("hidden"); }
    if (similarEl && similarLs) { similarLs.innerHTML = ""; similarEl.classList.add("hidden"); }
    lastActs = [];
    hintEl.textContent = "";
    errEl.textContent  = "";
    frame.innerHTML =
      `<div class="share-placeholder"><div class="share-spinner"></div><div>Generating card…</div></div>`;
    overlay.classList.remove("hidden");

    try {
      // NEAR-INSTANT: the card is drawn from what the server already knows
      // (fast=1: its cache, no lookups) — the album is the one on screen, so
      // title, artist, cover and, almost always, year and review are known.
      // The full lookup runs alongside; only if it brings something the card
      // lacked (a review found for the first time) is the card drawn again.
      const params = new URLSearchParams({ title, artist });
      const getExtras = (fast) => fetch("/api/album/extras?" + params + (fast ? "&fast=1" : ""), { cache: "no-store" })
        .then(r => r.ok ? r.json() : null).catch(() => null);
      const full = getExtras(false);
      const [, quick] = await Promise.all([ensureFont(), getExtras(true)]);
      if (mySeq !== shareSeq) return;

      // The cover as the page already has it (the server sends covers
      // immutable, so it's the browser's cached copy, not a new download).
      const coverUrl = input.image_key
        ? `/api/image/${encodeURIComponent(input.image_key)}?size=1000`
        : "";

      const first = cardFields(quick);
      await paintCard(first, coverUrl, title, artist, mySeq);
      if (mySeq !== shareSeq) return;
      renderLinks(first.links);
      // The card's own Qobuz chip lands on the download store for exactly the
      // same reason the suggestions did, so it gets the same upgrade.
      upgradeQobuzChip(title, artist, mySeq);
      // AFTER the card, and deliberately not awaited: this costs up to five
      // Deezer calls and the card must not wait behind it. A generation stamp
      // rather than a plain flag, because the sheet can be reopened on another
      // record while this is still out — and three acts for the previous album
      // under the new one's card is worse than none at all.
      loadSimilar(artist, mySeq);

      const later = cardFields(await full);
      if (mySeq !== shareSeq) return;
      if (later.signature !== first.signature) {
        await paintCard(later, coverUrl, title, artist, mySeq).catch(() => {});
        if (mySeq === shareSeq && later.links) renderLinks(later.links);
      }
    } catch (e) {
      if (mySeq !== shareSeq) return;   // a superseded open's failure is not news
      frame.innerHTML = `<div class="share-placeholder">Could not generate the card.</div>`;
      errEl.textContent = (e && e.message) ? e.message : String(e);
    }
  }
  window.__openShareCard = open;
  /*
   * The row builder and the Qobuz upgrade, published for the Discover screen.
   *
   * They live in THIS closure because everything they depend on does — the
   * default-service preference, the chips that set it, the share sequence that
   * orphans a superseded open. Discover is in the main closure (it needs the
   * wall, the banner and the grid), so the two halves reach each other the way
   * every other pair in this file does: one named window.__ export rather than
   * a second copy of the rules about where a tap goes.
   */
  window.__goRow = goRow;
  window.__upgradeQobuzLinks = upgradeQobuzLinks;

  /*
   * The services and review sites under the card.
   *
   * Every url is built server-side by lib/share-links.js and arrives on the
   * extras response the card already waits for, so there is no second request
   * and nothing renders twice. The labels are constants from that module —
   * never anything off the record, which is what keeps one six-line chip from
   * setting the height of the whole grid.
   *
   * rel="noreferrer" as well as noopener: these are search pages on other
   * people's sites, and there is no reason to tell them which library sent the
   * visitor.
   */
  // Bumped by every open() and by close(), so anything still in flight can ask
  // whether it is still wanted. See the note at the top of open().
  let shareSeq = 0;

  /*
   * THE DEFAULT SERVICE — where a suggestion goes when the record is not in
   * the library.
   *
   * PER DEVICE, IN localStorage, which is the Share Card app's choice and the
   * right one: the phone and the tablet across the house can reasonably differ,
   * and a display preference is not worth a server write. Every touch of
   * storage is guarded — it throws outright in a private window — and the
   * fallback is the first service that is switched on rather than a hardcoded
   * name, so a user who has turned Qobuz off is never sent to it.
   *
   * SET BY HOLDING A SERVICE CHIP, the gesture the Share Card app uses, and
   * also from Settings -> Share Card. The gesture is the discoverable one once
   * you know it; the setting is the discoverable one before that.
   */
  const SHARE_PREF_KEY = "musicd-share-service";

  function preferredService(available) {
    const list = available || [];
    let stored = null;
    try { stored = localStorage.getItem(SHARE_PREF_KEY); }
    catch (e) { /* private browsing — the fallback below stands */ }
    // A remembered service that is now switched off (or was removed from the
    // build) must not win: it would send a tap somewhere the user cannot see.
    if (stored && (!list.length || list.indexOf(stored) > -1)) return stored;
    return list.length ? list[0] : "qobuz";
  }

  function setPreferredService(id) {
    if (!id) return;
    try { localStorage.setItem(SHARE_PREF_KEY, id); }
    catch (e) { /* the choice lasts this session, which beats none */ }
    markPreferredChip();
    renderLinks(lastLinks);       // the tick moves
    renderSimilar(lastActs);      // and so does where the suggestions point
    // Switching TO Qobuz means the rows now point at search links that have
    // never been upgraded, so they get the same treatment they would have had
    // if Qobuz had been the default when they were drawn.
    const seq = shareSeq;
    upgradeQobuzLinks(lastActs, {
      container: similarLs, current: () => seq === shareSeq,
      album: a => a.album, artist: a => a.name,
    });
    if (window.__showToast) {
      const svc = (lastLinks && lastLinks.services || []).find(x => x.id === id);
      window.__showToast((svc ? svc.name : id) + " is now the default", "ok");
    }
  }

  /** Exactly one chip carries the tick, so the old one has to lose it. */
  function markPreferredChip() {
    if (!linksEl) return;
    const chips = linksEl.querySelectorAll("a[data-service]");
    const ids = Array.prototype.map.call(chips, c => c.dataset.service);
    const chosen = preferredService(ids);
    for (const chip of chips) {
      const mine = chip.dataset.service === chosen;
      chip.classList.toggle("is-default", mine);
      chip.setAttribute("aria-pressed", mine ? "true" : "false");
    }
  }

  /*
   * A HOLD, NOT A TAP, AND THE TAP STILL HAS TO WORK.
   *
   * There is no long-press event, so it is a timer armed on touchstart and
   * cancelled by a move or a lift. When it fires, the click that follows on
   * both platforms has to be swallowed, or choosing a service would also open
   * it. contextmenu covers the desktop right-click and is what iOS raises when
   * the callout is suppressed — preventing it is what stops a held chip
   * showing a link preview instead of choosing.
   */
  const HOLD_MS = 500;
  function holdToPrefer(chip, id) {
    let timer = null, held = false;
    const cancel = () => { if (timer) clearTimeout(timer); timer = null; };
    chip.addEventListener("touchstart", () => {
      held = false; cancel();
      timer = setTimeout(() => { held = true; setPreferredService(id); }, HOLD_MS);
    }, { passive: true });
    chip.addEventListener("touchmove",   cancel, { passive: true });
    chip.addEventListener("touchend",    cancel);
    chip.addEventListener("touchcancel", cancel);
    chip.addEventListener("click", (e) => {
      if (!held) return;
      held = false;
      e.preventDefault();      // the hold already did something
    });
    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      setPreferredService(id);
    });
  }

  // What is currently on screen, so a change of default can repaint both rows
  // without asking the server again.
  let lastLinks = null;
  let lastActs  = [];

  /*
   * "If you like this" — three acts, each with one record.
   *
   * Never blocks the card and never reports a failure: a suggestion row is the
   * page's business, and an error message where three names should be is worse
   * than the row simply not being there.
   */
  async function loadSimilar(artist, seq) {
    if (!similarEl || !similarLs || !artist) return;
    let acts = [];
    try {
      const r = await fetch("/api/similar?artist=" + encodeURIComponent(artist));
      if (!r.ok) return;
      const j = await r.json();
      acts = (j && j.acts) || [];
    } catch (e) { return; }      // no row, no message
    if (seq !== shareSeq) return;   // the sheet moved on, or closed
    lastActs = acts;
    renderSimilar(acts);
    upgradeQobuzLinks(acts, {
      container: similarLs, current: () => seq === shareSeq,
      album: a => a.album, artist: a => a.name,
    });
  }

  /*
   * A Qobuz search link lands on their DOWNLOAD STORE and never opens the app.
   * Only an album id does — see lib/qobuz-deeplink.js for why no search URL
   * anywhere can. Getting an id costs a page read on the server, so it happens
   * AFTER the rows are on screen and never before them: a suggestion must not
   * wait on it, and a failure leaves the search link that was already there.
   *
   * ONLY WHEN QOBUZ IS THE DEFAULT, because that is the only link the rows
   * actually point at. Switching the default to Qobuz later runs this again.
   *
   * The row is found again by what it LINKS TO rather than held onto: the list
   * may have been rebuilt while a lookup was in flight (a change of default
   * repaints it), and a reference to a discarded node would upgrade nothing.
   */
  async function upgradeQobuzLinks(items, opts) {
    opts = opts || {};
    const box     = opts.container;
    const current = typeof opts.current === "function" ? opts.current : () => true;
    const albumOf = opts.album  || (x => x.album);
    const artistOf = opts.artist || (x => x.name);
    if (!box) return;
    for (const item of (items || [])) {
      if (!current()) return;                       // the screen moved on
      const album = item && albumOf(item);
      if (!item || !album || item.in_library) continue;
      const svc = (item.services || []).find(x => x.id === "qobuz");
      if (!svc || !svc.url) continue;
      const ids = (item.services || []).map(x => x.id);
      if (preferredService(ids) !== "qobuz") continue;
      if (svc.url.indexOf("open.qobuz.com") === 0) continue;   // already upgraded
      try {
        const params = new URLSearchParams({ album, artist: artistOf(item) || "" });
        const r = await fetch("/api/qobuz-link?" + params);
        if (!r.ok) continue;
        const j = await r.json();
        if (!j || !j.url) continue;
        if (!current()) return;
        const before = svc.url;
        // Remember it on the item, so a repaint (a change of default and back)
        // keeps the good link instead of asking again.
        svc.url = j.url;
        const row = box.querySelector('a[href="' + cssEscapeUrl(before) + '"]');
        if (row) row.href = j.url;
      } catch (e) { /* the search link is still there, which is not nothing */ }
    }
  }

  /*
   * The card's Qobuz chip, upgraded the same way and for the same reason.
   * Separate from the suggestions only because it is one link rather than
   * three and it is about the record on the card, not about an act like it.
   */
  async function upgradeQobuzChip(title, artist, seq) {
    if (!linksEl || !title) return;
    const svc = (lastLinks && lastLinks.services || []).find(x => x.id === "qobuz");
    if (!svc || !svc.url || svc.url.indexOf("open.qobuz.com") === 0) return;
    try {
      const params = new URLSearchParams({ album: title, artist: artist || "" });
      const r = await fetch("/api/qobuz-link?" + params);
      if (!r.ok) return;
      const j = await r.json();
      if (!j || !j.url || seq !== shareSeq) return;
      const before = svc.url;
      svc.url = j.url;
      const chip = linksEl.querySelector('a[href="' + cssEscapeUrl(before) + '"]');
      if (chip) chip.href = j.url;
    } catch (e) { /* the search link is still there */ }
  }

  /** Quotes and backslashes, so a URL can sit inside an attribute selector. */
  function cssEscapeUrl(value) {
    return String(value).replace(/["\\]/g, "\\$&");
  }

  /*
   * Each suggestion is somewhere to GO, not a line of text.
   *
   *   IN THE LIBRARY -> a button that queues it. The server resolved it and
   *     sent the offset plus the library's own title and artist, and those go
   *     with the request: /api/play relocates a drifted offset rather than
   *     playing whatever now sits at it, and that guarantee is worth nothing
   *     if the caller does not send the identity to check against.
   *   NOT IN THE LIBRARY -> a link to the default service's search for it.
   *
   * The two are visibly different before they are tapped, because "this adds
   * to your queue" and "this leaves the app" should not look the same.
   */
  /*
   * ONE ROW BUILDER, used by the suggestions under the card and by the
   * Discover screen. They ask different questions — "acts like this one" and
   * "new records by acts you play" — but the answer is the same KIND of thing
   * in both: a record that is either in the library or on a service, and the
   * rules about which (send the library's own identity with a queue, leave via
   * the default service otherwise) must not have two implementations that can
   * drift apart. The caller supplies the two lines; everything about where the
   * row GOES lives here.
   *
   * @param {object} item     { in_library, offset, library_title,
   *                            library_subtitle, services[] }
   * @param {string} primary  the bold line
   * @param {string} sub      the quiet line, or ""
   */
  function goRow(item, primary, sub, art) {
    const label = document.createElement("span");
    label.className = "share-similar-name";
    label.textContent = primary;
    const rec = document.createElement("span");
    rec.className = "share-similar-rec";
    if (sub) rec.textContent = sub;

    /*
     * WITH ARTWORK, the two lines become a column beside the cover; without it
     * they stay direct children of the row exactly as before.
     *
     * Two shapes rather than one, deliberately. The suggestions under the share
     * card are a compact list inside a sheet and carry no artwork — that is
     * the older decision and this must not quietly change it — while Discover
     * is a full screen of RECORDS, where a wall of text is the odd one out.
     * Callers that pass no art get byte-identical markup to before.
     */
    let holder = null;
    if (art) {
      holder = document.createElement("span");
      holder.className = "row-text";
      holder.appendChild(label);
      if (sub) holder.appendChild(rec);
    }
    const fill = (row) => {
      if (art) { row.appendChild(rowArt(art)); row.appendChild(holder); }
      else { row.appendChild(label); if (sub) row.appendChild(rec); }
    };

    let row;
    if (item.in_library && typeof item.offset === "number") {
      row = document.createElement("button");
      row.type = "button";
      row.className = "share-similar-act is-library";
      fill(row);
      row.appendChild(tagEl("Queue"));
      row.addEventListener("click", () => queueSuggestion(item, row));
    } else {
      const ids = (item.services || []).map(x => x.id);
      const svc = (item.services || []).find(x => x.id === preferredService(ids));
      if (svc) {
        row = document.createElement("a");
        row.className = "share-similar-act is-service";
        row.href = svc.url;
        row.target = "_blank";
        row.rel = "noopener noreferrer";
        fill(row);
        row.appendChild(tagEl(svc.name));
      } else {
        // Nothing to link to — every service switched off, or no record was
        // named. Still shown, because the name itself is the answer.
        row = document.createElement("div");
        row.className = "share-similar-act";
        fill(row);
      }
    }
    if (art) row.classList.add("has-art");
    return row;
  }

  /*
   * A row's cover, in a box that holds its place whether or not the image ever
   * arrives.
   *
   * THE TILE IS ALWAYS THERE AND THE IMAGE IS WHAT IS OPTIONAL. These covers
   * come from a third party (Deezer, for a record the library does not have),
   * so some fraction of them will 404, be blocked, or simply not exist — and
   * an <img> with a dead src draws the browser's broken-image glyph, which
   * reads as "this app is broken" rather than "this record has no cover". On
   * error the img removes itself and the empty tile stands, so every row keeps
   * the same shape either way.
   */
  function rowArt(url) {
    const box = document.createElement("span");
    box.className = "row-art";
    // What this tile was ASKED for, kept on the box rather than only on the
    // img: the img removes itself when the cover does not load, and without
    // this there is then nothing left to say which URL was tried — neither for
    // a person looking at the row nor for a test asserting that an in-library
    // record used Roon's art rather than a streaming service's.
    box.dataset.artSrc = url;
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "";
    img.addEventListener("error", () => {
      box.dataset.artFailed = "1";
      if (img.parentNode) img.parentNode.removeChild(img);
    });
    img.src = url;
    box.appendChild(img);
    return box;
  }

  function renderSimilar(acts) {
    if (!similarEl || !similarLs) return;
    similarLs.innerHTML = "";
    for (const act of (acts || [])) {
      if (!act || !act.name) continue;
      // An act whose records could not be named is still worth showing, so the
      // record line is optional rather than the row being dropped.
      const sub = act.album
        ? (act.year ? act.album + " \u00b7 " + act.year : act.album) : "";
      similarLs.appendChild(goRow(act, act.name, sub));
    }
    similarEl.classList.toggle("hidden", !similarLs.children.length);
  }

  function tagEl(text) {
    const t = document.createElement("span");
    t.className = "share-similar-tag";
    t.textContent = text;
    return t;
  }

  /*
   * Queue a suggestion that is in the library.
   *
   * Sends the LIBRARY's title and artist, not Deezer's: /api/play compares the
   * identity against what sits at the offset and relocates or refuses when
   * they disagree, and Deezer's punctuation is not Roon's.
   */
  async function queueSuggestion(act, row) {
    const zone = (window.__selectedZoneId && window.__selectedZoneId()) || null;
    if (!zone) { if (window.__showToast) window.__showToast("Pick a zone first", "err"); return; }
    if (row.dataset.busy === "1") return;
    row.dataset.busy = "1";
    const tag = row.querySelector(".share-similar-tag");
    const was = tag ? tag.textContent : "";
    if (tag) tag.textContent = "\u2026";
    try {
      const r = await fetch("/api/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset:   act.offset,
          title:    act.library_title    || act.album || "",
          subtitle: act.library_subtitle || "",
          zone_or_output_id: zone,
          kind: "queue",
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
      if (typeof j.offset === "number" && j.offset >= 0) act.offset = j.offset;
      if (tag) tag.textContent = "Queued";
      if (window.__showToast) window.__showToast("Queued " + (act.album || act.name), "ok");
    } catch (e) {
      if (tag) tag.textContent = was;
      if (window.__showToast) window.__showToast("Couldn't queue that", "err");
    } finally {
      row.dataset.busy = "";
    }
  }

  function renderLinks(links) {
    if (!linksEl) return;
    lastLinks = links || null;
    linksEl.innerHTML = "";
    const all = [
      ...((links && links.services) || []).map(l => ({ link: l, review: false })),
      ...((links && links.reviews)  || []).map(l => ({ link: l, review: true  })),
    ];
    for (const { link, review } of all) {
      if (!link || !link.url) continue;
      const a = document.createElement("a");
      a.className = "share-link" + (review ? " is-review" : "");
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      // textContent, not innerHTML: the label is a constant today, and this is
      // what keeps it harmless if it ever stops being one.
      a.textContent = link.chip || link.name || link.id;
      // Only a SERVICE can be the default — a review site is not somewhere to
      // hear a record, so holding one does nothing.
      if (!review) {
        a.dataset.service = link.id;
        holdToPrefer(a, link.id);
      }
      linksEl.appendChild(a);
    }
    // An empty row is a gap under the card, not a row.
    linksEl.classList.toggle("hidden", !linksEl.children.length);
    markPreferredChip();
  }

  /*
   * An iOS app added to the home screen, as opposed to iOS in a browser tab.
   *
   * Two separate facts, and both are needed. `navigator.standalone` is the
   * iOS-only flag for a home-screen launch; the display-mode query is the
   * standard one and covers an installed app elsewhere. The platform test is
   * what keeps this from firing on an installed desktop PWA, where downloading
   * works perfectly well — and it checks maxTouchPoints because an iPad reports
   * its platform as "MacIntel" and is indistinguishable from a Mac without it.
   */
  function iosStandalone() {
    try {
      const p = (navigator.platform || "") + " " + (navigator.userAgent || "");
      const isIOS = /iPhone|iPad|iPod/.test(p) ||
                    (/Mac/.test(p) && (navigator.maxTouchPoints || 0) > 1);
      if (!isIOS) return false;
      if (navigator.standalone === true) return true;
      return !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    } catch (e) {
      // A UA sniff that throws must not take the share sheet with it; the
      // download button is the safe answer because it is what every other
      // platform gets.
      return false;
    }
  }

  function buildActions(blob, title, artist) {
    actions.innerHTML = "";
    const fileName =
      `${(artist || "artist").replace(/[^a-z0-9]+/gi, "_")}-` +
      `${(title  || "card"  ).replace(/[^a-z0-9]+/gi, "_")}.png`;

    const canShare = (() => {
      try {
        if (!navigator.share || !navigator.canShare) return false;
        const probe = new File([new Uint8Array([0])], "p.png", { type: "image/png" });
        return navigator.canShare({ files: [probe] });
      } catch { return false; }
    })();
    const canCopy = typeof window.ClipboardItem !== "undefined"
      && navigator.clipboard && typeof navigator.clipboard.write === "function";

    if (canCopy) {
      const b = mkBtn("ghost", icon("copy"), "Copy image");
      b.onclick = async () => {
        try {
          await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
          setLabel(b, "Copied!"); setTimeout(() => setLabel(b, "Copy image"), 2000);
        } catch (e) { errEl.textContent = e.message || String(e); }
      };
      actions.appendChild(b);
    }
    if (canShare) {
      const b = mkBtn("primary", icon("share"), "Share…");
      b.onclick = async () => {
        try {
          const file = new File([blob], fileName, { type: "image/png" });
          await navigator.share({ files: [file] });
        } catch (e) { if (e && e.name !== "AbortError") errEl.textContent = e.message || String(e); }
      };
      actions.appendChild(b);
    }
    // NOT on an installed iOS app. `<a download>` is not implemented in WebKit
    // on iOS — the attribute is ignored, so the button either navigates away
    // from the app to a blob: URL or does nothing at all, and in a standalone
    // PWA there is no browser chrome to get back from it. Long-pressing the
    // image gives the real Save Image, which is what the hint already says.
    //
    // Narrowed to STANDALONE rather than to iOS: in Safari proper the tab is
    // still there to return from, and on every other platform it works.
    // In the Android app (v0.6.0-RC4): a download link does nothing in its
    // WebView, so the app saves the card itself — to Pictures/Mandarin.
    const app = window.MusicDShare;
    if (app && typeof app.saveImage === "function") {
      const b = mkBtn("ghost", icon("download"), "Download");
      b.onclick = async () => {
        try {
          const url = await blobToDataUrl(blob);
          const ok = app.saveImage(String(url).slice(String(url).indexOf(",") + 1), fileName, "image/png");
          setLabel(b, ok ? "Saved to Pictures" : "Couldn’t save");
          setTimeout(() => setLabel(b, "Download"), 2500);
        } catch (e) { errEl.textContent = e.message || String(e); }
      };
      actions.appendChild(b);
    } else if (!iosStandalone()) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.appendChild(document.createTextNode(""));
      a.innerHTML = `${icon("download")}<span>Download</span>`;
      actions.appendChild(a);
    }

    hintEl.textContent = (canCopy || canShare)
      ? "Tap a button above, or long-press the card to save."
      : "Long-press the card to save.";
  }

  function blobToDataUrl(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = () => res(r.result);
      r.onerror = () => rej(new Error("read failed"));
      r.readAsDataURL(blob);
    });
  }
  function mkBtn(cls, iconSvg, label) {
    const b = document.createElement("button");
    b.className = cls;
    b.type = "button";
    b.innerHTML = `${iconSvg}<span>${label}</span>`;
    return b;
  }
  function setLabel(btn, text) {
    const s = btn.querySelector("span");
    if (s) s.textContent = text;
  }
  function icon(name) {
    const I = {
      share:    '<polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>',
      copy:     '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
      download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name] || ""}</svg>`;
  }

  // Wire the share button inside the album modal
  if (modalBtn) {
    modalBtn.addEventListener("click", () => {
      // On the now-playing screen read the live zone state directly via
      // window.__getCurrentNp() (not a mirrored global) so the card always
      // reflects the current track, not the album that was playing when the
      // modal first opened, regardless of which modal tab is active.
      const npModal = document.getElementById("album-modal");
      const isNp = npModal && npModal.classList.contains("np-mode");
      const np = isNp && window.__getCurrentNp && window.__getCurrentNp();
      if (np) {
        open({ title: np.line3 || "", artist: np.line2 || "", image_key: np.image_key });
        return;
      }
      const a = window.__currentAlbum;
      if (!a) return;
      open({ title: a.title || "", artist: a.subtitle || "", image_key: a.image_key });
    });
  }
})();

/* ------------------------------------------------------------------ */
/*  Android app only: the app's own update, looked for by the app on   */
/*  GitHub, so one Update button can do the server and the app. Null   */
/*  anywhere else (browsers, the iPhone home-screen app, older apps).  */
/* ------------------------------------------------------------------ */
window.__musicdAppUpd = (function () {
  const app = window.MusicdApp;
  if (!app || typeof app.appUpdateStatus !== "function") return null;
  try { app.pageHandlesUpdates(); } catch (e) {}
  const waiters = [];
  const status = () => { try { return JSON.parse(app.appUpdateStatus()); } catch (e) { return null; } };
  window.__musicdAppUpdateChanged = () => { const s = status(); waiters.splice(0).forEach(w => w(s)); };
  return {
    status,
    // Resolves with {current, latest, available} once the app has looked
    // (at most hourly unless forced); never waits more than 12 s.
    look(force) {
      return new Promise(resolve => {
        waiters.push(resolve);
        setTimeout(() => resolve(status()), 12000);
        try { app.lookForAppUpdate(!!force); } catch (e) { resolve(status()); }
      });
    },
    install() { try { app.installAppUpdate(); } catch (e) {} }
  };
})();

/* ------------------------------------------------------------------ */
/*  Self-update: poll status, show a toast, install on tap            */
/*  (in the Android app, the app's update rides along: one offer, one  */
/*  Update, the server's and the app's started together)              */
/* ------------------------------------------------------------------ */
(function initUpdater() {
  const toast    = document.getElementById("update-toast");
  const textEl   = document.getElementById("update-text");
  const actions  = document.getElementById("update-actions");
  const btnNow   = document.getElementById("update-now");
  const btnLater = document.getElementById("update-later");
  const notesEl  = document.getElementById("update-notes");
  if (!toast || !btnNow) return;

  const PHASE = {
    checking:   "Preparing\u2026",
    downloading:"Downloading\u2026",
    extracting: "Unpacking\u2026",
    restarting: "Restarting\u2026"
  };
  const DISMISS_KEY = "rra-update-dismissed";
  const appUpd = window.__musicdAppUpd;
  let applying = false;
  let pollTimer = null;
  // What the banner is offering right now.
  let offer = { server: false, app: false, sig: "" };

  const dismissedVer = () => { try { return sessionStorage.getItem(DISMISS_KEY) || ""; } catch (e) { return ""; } };
  const setDismissed = (v) => { try { sessionStorage.setItem(DISMISS_KEY, v); } catch (e) {} };
  const show = (msg) => { textEl.textContent = msg; toast.classList.add("open"); };
  const hide = () => { toast.classList.remove("open"); if (notesEl) notesEl.classList.add("hidden"); };

  function showNotes(notes) {
    if (!notesEl || !notes) { if (notesEl) notesEl.classList.add("hidden"); return; }
    notesEl.textContent = notes;
    notesEl.classList.remove("hidden");
  }

  function showProgress(phase) {
    applying = true;
    window.__musicdUpdating = true;   // the empty-screen notice keeps quiet meanwhile
    actions.classList.add("busy");
    toast.classList.remove("is-error");
    if (notesEl) notesEl.classList.add("hidden");
    show(PHASE[phase] || "Updating\u2026");
  }

  // The banner's line for what's on offer: the server, this app, or both.
  function offerText(s, a, server, app) {
    if (server && app) {
      return s.latest === a.latest
        ? "v" + s.latest + " available for the server and this app (you have v" + s.current + ")"
        : "Server v" + s.latest + " and app v" + a.latest + " available";
    }
    if (app) return "App v" + a.latest + " available (you have v" + a.current + ")";
    return (s.isDowngrade ? "Rollback to v" : "v") + s.latest + " available (you have v" + s.current + ")";
  }

  async function check() {
    if (applying) return;
    let s = null;
    try {
      const r = await fetch("/api/update/status", { cache: "no-store" });
      if (r.ok) s = await r.json();
    } catch (e) { /* offline; try again next tick */ }
    if (s) {
      const ph = s.apply && s.apply.phase;
      if (ph === "downloading" || ph === "extracting" || ph === "restarting") {
        showProgress(ph); startPoll(s.latest); return;
      }
    }
    const a = appUpd ? await appUpd.look(false) : null;
    if (applying) return;
    const server = !!(s && s.available && s.latest);
    const app = !!(a && a.available && a.latest && !a.installing);
    const sig = (server ? "s" + s.latest : "") + (app ? "a" + a.latest : "");
    if ((server || app) && sig !== dismissedVer()) {
      offer = { server, app, sig };
      actions.classList.remove("busy"); btnNow.disabled = false;
      toast.classList.remove("is-error");
      show(offerText(s, a, server, app));
      showNotes(server ? s.notes : null);
      btnNow.querySelector("span").textContent = server && s.isDowngrade && !app ? "Roll back" : "Update";
    } else {
      hide();
    }
  }

  function startPoll(targetVer) {
    if (pollTimer) clearInterval(pollTimer);
    let wasDown = false;
    pollTimer = setInterval(async () => {
      try {
        const r = await fetch("/api/update/status", { cache: "no-store" });
        if (!r.ok) throw new Error("bad");
        const s = await r.json();
        if (wasDown && ((targetVer && s.current === targetVer) || !s.available)) {
          clearInterval(pollTimer); location.reload(); return;
        }
        const ph = s.apply && s.apply.phase;
        if (ph === "error") {
          clearInterval(pollTimer); applying = false;
          actions.classList.remove("busy"); btnNow.disabled = false;
          toast.classList.add("is-error");
          show("Update failed: " + ((s.apply && s.apply.error) || "unknown") + ". Tap Update to retry.");
          return;
        }
        if (PHASE[ph]) show(PHASE[ph]);
      } catch (e) {
        wasDown = true;                 // server is restarting
        show(PHASE.restarting);
      }
    }, 1500);
    setTimeout(() => {
      if (pollTimer && applying) {
        clearInterval(pollTimer);
        show("Update is taking a while \u2014 if the app doesn't come back on its own, restart the container (docker restart musicd-server).");
      }
    }, 180000);
  }

  btnNow.addEventListener("click", async () => {
    if (applying) return;
    // The app's update starts alongside: it downloads with its own progress
    // and then Android's installer asks (an app not from a store always
    // does). The server's update carries on by itself meanwhile.
    if (offer.app && appUpd) appUpd.install();
    if (!offer.server) { hide(); return; }
    btnNow.disabled = true;
    showProgress("checking");
    try {
      const r = await fetch("/api/update/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const s = await r.json().catch(() => null);
      if (!r.ok) {
        applying = false; actions.classList.remove("busy"); btnNow.disabled = false;
        toast.classList.add("is-error");
        show("Couldn't start update: " + ((s && s.error) || ("HTTP " + r.status)));
        return;
      }
      startPoll(s && s.status && s.status.latest);
    } catch (e) {
      startPoll(null);                  // request cut off by restart — keep polling
    }
  });

  btnLater.addEventListener("click", () => {
    if (offer.sig) setDismissed(offer.sig);
    hide();
  });

  // Settings' "Check for updates" flow hands off here after its own check:
  // applying through the banner keeps a single implementation of the
  // download/unpack/restart progress UI (the banner sits behind the Settings
  // sheet, so the caller closes Settings first). Clearing the "Later"
  // dismissal lets the banner's error/retry states show normally afterwards.
  // In the Android app it says which: { server, app } (both by default).
  window.__applyUpdateNow = (what) => {
    setDismissed("");
    if (what) offer = { server: !!what.server, app: !!what.app, sig: "" };
    else if (!offer.server && !offer.app) offer = { server: true, app: false, sig: "" };
    btnNow.click();
  };

  window.__afterStart(check);   // a notice, not the first screen
  setInterval(check, 15 * 60 * 1000);
})();

/* ------------------------------------------------------------------ */
/*  Settings sheet: theme toggle (lives here now), version, repo link  */
/* ------------------------------------------------------------------ */
(function initSettings() {
  // showToast lives in the album/grid IIFE above and is NOT in scope here —
  // this is a different top-level IIFE. Every one of the 28 bare showToast()
  // calls in this function was therefore throwing ReferenceError instead of
  // showing a message: token saves, display settings, and the Qobuz/TIDAL
  // connect flows all failed silently, and the catch blocks that tried to
  // report the failure threw again. window.__showToast is the existing bridge
  // (declared where showToast is), so aliasing it here fixes all of them at
  // once and keeps the call sites readable.
  const showToast = (msg, kind) => {
    if (window.__showToast) window.__showToast(msg, kind);
  };
  const openBtn    = document.getElementById("settings-toggle");
  const overlay    = document.getElementById("settings-overlay");
  // While Settings covers the page, the page behind it doesn't scroll — so its
  // scrollbar isn't drawn beside a Settings page that has nothing to scroll.
  const markOpen = () => document.body.classList.toggle("settings-open", !overlay.classList.contains("hidden"));
  new MutationObserver(markOpen).observe(overlay, { attributes: true, attributeFilter: ["class"] });
  markOpen();
  const versionEl  = document.getElementById("settings-version");
  const radioToggle = document.getElementById("radio-toggle");
  const roonRadioToggle = document.getElementById("roon-radio-toggle");
  const zoneSelect  = document.getElementById("zone-select");
  const labelOrderSelect = document.getElementById("label-order-select");
  const labelMinSelect   = document.getElementById("label-min-select");
  if (!openBtn || !overlay) return;

  // Label album order (alphabetical default). Persisted in localStorage and
  // read by the labels browser when it loads a label's albums.
  if (labelOrderSelect) {
    labelOrderSelect.value =
      localStorage.getItem("rra-label-order") === "random" ? "random" : "alpha";
    labelOrderSelect.addEventListener("change", () => {
      const v = labelOrderSelect.value === "random" ? "random" : "alpha";
      localStorage.setItem("rra-label-order", v);
    });
  }

  // Minimum albums per label — hides one-off outliers from the labels grid.
  if (labelMinSelect) {
    const stored = localStorage.getItem("rra-label-min");
    // "Show all" until chosen otherwise — what labelMin() in the labels browser assumes.
    labelMinSelect.value = (stored === "2" || stored === "5" || stored === "10") ? stored : "1";
    labelMinSelect.addEventListener("change", () => {
      localStorage.setItem("rra-label-min", labelMinSelect.value);
    });
  }

  // The two radios for the selected zone. Both answer "what plays when this
  // queue runs out", so both on means two things racing to fill one queue: the
  // server switches the other off, and these read back from it rather than
  // assuming it did — a change the Core rejects must not leave a switch lit.
  //
  // Every paint and every write of the two switches is stamped with a
  // generation. Only the newest may paint.
  //
  // Serialising the writes (below) stops two of them being in flight at once,
  // but it cannot stop an answer arriving after the user has tapped again — and
  // that answer, painted, drags both switches back to the state before the tap.
  // Reads carry a generation for the same reason: loadRadio() is two round
  // trips, and a tap during them must win.
  let radioGen = 0, radioInFlight = false, radioQueued = null;

  function paintRadios(s) {
    if (!s) return;
    if (radioToggle)     radioToggle.checked     = !!s.own;
    if (roonRadioToggle) roonRadioToggle.checked = !!s.roon;
  }

  // Read both switches for a zone. `gen` is passed by callers that already hold
  // one (a write falling back to a re-read); anyone else is the newest intent
  // and takes a fresh one.
  async function loadRadio(zoneId, gen) {
    // The switches now live on each device's page (initAudioDevicesPane);
    // with neither here there is nothing to read for.
    if (!radioToggle && !roonRadioToggle) return;
    if (!zoneSelect || !zoneSelect.value) return;
    const zone = zoneId || zoneSelect.value;
    const g = (gen === undefined) ? ++radioGen : gen;
    // Together rather than one after the other: sequential awaits painted the
    // two switches a beat apart every time the pane opened.
    const [own, roon] = await Promise.all([
      fetch("/api/radio?zone=" + encodeURIComponent(zone), { cache: "no-store" })
        .then(r => (r.ok ? r.json() : null))
        .then(j => (j ? !!j.enabled : null))
        .catch(() => null),   // network error — null means "don't know", below
      fetch("/api/zone-state?zone=" + encodeURIComponent(zone), { cache: "no-store" })
        .then(r => (r.ok ? r.json() : null))
        .then(j => {
          const s = j && j.zone && j.zone.settings;
          return j ? !!(s && s.auto_radio) : null;
        })
        .catch(() => null),
    ]);
    // A newer tap or read happened while these were in the air. Its answer is
    // the current truth and this one would undo it.
    if (g !== radioGen) return;
    // null is "don't know" — leave that switch where it is rather than
    // reporting a radio off because the request for it failed.
    if (own  !== null && radioToggle)     radioToggle.checked     = own;
    if (roon !== null && roonRadioToggle) roonRadioToggle.checked = roon;
  }
  // One radio write, bounded.
  //
  // Bounded for the reason postVolume is: neither route answers until Roon's
  // change_settings callback fires, and a Core that drops mid-call never
  // settles the promise. With the in-flight guard below that would leave the
  // switches queueing behind a request that never returns — dead until reload,
  // which is the v1.7.69 volume bug wearing a different hat.
  //
  // Returns the server's `radios` block, or null when it refused or failed —
  // the caller re-reads rather than trusting the switch the user moved.
  async function postRadio(which, on, zoneId) {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const t   = ctl ? setTimeout(() => ctl.abort(), 5000) : null;
    try {
      const r = await fetch(which === "own" ? "/api/radio" : "/api/zone-settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(which === "own"
          ? { zone: zoneId, enabled: on }
          : { zone_or_output_id: zoneId, auto_radio: on }),
        signal: ctl ? ctl.signal : undefined,
      });
      const j = await r.json().catch(() => null);
      return (r.ok && j && j.radios) ? j.radios : null;
    } finally {
      if (t) clearTimeout(t);
    }
  }

  // Drive one switch. Serialised, latest-wins — the volume control's shape
  // (v1.7.69), for its reasons and one of its own.
  //
  // The two switches write to DIFFERENT endpoints, so with nothing holding them
  // apart a quick Random-on then Roon-on puts two requests in flight at once.
  // They finish in whatever order the Core answers, the older answer paints
  // last, and the switches settle on the tap before last. On the server the two
  // routes are reading and writing the same zone set concurrently, and the
  // interleaving where each cancels the other's radio leaves BOTH off.
  async function writeRadio(which, on) {
    if (!zoneSelect || !zoneSelect.value) return;
    const zoneId = zoneSelect.value;

    // Show the rule NOW: as this switch comes on, the other goes off. It is a
    // rule the client knows and the server is about to confirm, and waiting for
    // a Core round trip to draw it left the other switch lit for long enough to
    // read as broken — displaying, of all things, the both-on state the rule
    // exists to prevent. Reconciled against the server's answer below, the same
    // trade the volume slider makes. Only for ON: the rule is "at most one",
    // so switching a radio off says nothing about the other.
    if (on) paintRadios(which === "own" ? { own: true, roon: false }
                                        : { own: false, roon: true });

    const gen = ++radioGen;
    if (radioInFlight) { radioQueued = { which, on, zoneId, gen }; return; }
    radioInFlight = true;
    let job = { which, on, zoneId, gen };
    try {
      while (job) {
        let radios = null;
        // Inside the loop, so one failed write does not abandon a tap already
        // queued behind it and already painted.
        try { radios = await postRadio(job.which, job.on, job.zoneId); }
        catch (e) { radios = null; }   // blip, or the 5s timeout above
        // Superseded: a newer tap is queued or already painted, and this answer
        // describes the state before it.
        if (job.gen === radioGen) {
          if (radios) paintRadios(radios);
          // Refused or never landed. We don't know what the server did, so go
          // and look rather than leave the switch showing a change that may
          // never have happened.
          else loadRadio(job.zoneId, job.gen);
        }
        job = radioQueued; radioQueued = null;
      }
    } finally {
      // In a finally so an unexpected throw cannot wedge every later tap.
      radioInFlight = false;
    }
  }

  if (radioToggle) {
    radioToggle.addEventListener("change", () => writeRadio("own", radioToggle.checked));
  }
  if (roonRadioToggle) {
    roonRadioToggle.addEventListener("change", () => writeRadio("roon", roonRadioToggle.checked));
  }
  // The switches belong to the selected zone, and nothing re-read them when it
  // changed: with the Playback pane open, changing zone left both showing the
  // PREVIOUS zone's radios — and the next tap wrote that stale reading to the
  // new zone. Runs alongside the other two listeners on this select (the active
  // zone, and the now-playing refresh); it only reads.
  if (zoneSelect) zoneSelect.addEventListener("change", () => loadRadio());

  let versionLoaded = false;
  async function loadVersion() {
    if (versionLoaded || !versionEl) return;
    try {
      const r = await fetch("/api/update/status", { cache: "no-store" });
      if (r.ok) {
        const s = await r.json();
        if (s && s.current) {
          const parts = (s.current || "").split(".");
          versionEl.textContent = parts.length >= 3
            ? "Mandarin v" + parts[0] + "." + parts[1] + " (Build " + parts[2] + ")"
            : "Mandarin v" + s.current;
          versionLoaded = true;
        }
      }
    } catch (e) {} // network error loading version — settings panel shows without version, non-critical
  }

  const forceRescanBtn    = document.getElementById("force-rescan-btn");
  const forceRescanStatus = document.getElementById("force-rescan-status");
  if (forceRescanBtn) {
    forceRescanBtn.addEventListener("click", async () => {
      if (forceRescanBtn.disabled) return;
      forceRescanBtn.disabled = true;
      forceRescanBtn.textContent = "Starting…";
      if (forceRescanStatus) forceRescanStatus.classList.add("hidden");
      try {
        const r = await fetch("/api/labels/rescan-force", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
        forceRescanBtn.textContent = j.started === false ? "Done" : "Rescan started";
        if (forceRescanStatus) {
          forceRescanStatus.textContent = j.started === false
            ? "Labels re-read from the library's tags and folders" + (j.count != null ? ": " + j.count + " label" + (j.count === 1 ? "" : "s") + "." : ".")
            : "Full rescan started — this may take several minutes. Label data will update as results come in.";
          forceRescanStatus.classList.remove("hidden");
        }
        setTimeout(() => {
          forceRescanBtn.disabled = false;
          forceRescanBtn.textContent = "Force rescan";
        }, 5000);
      } catch (e) {
        forceRescanBtn.disabled = false;
        forceRescanBtn.textContent = "Force rescan";
        if (forceRescanStatus) { forceRescanStatus.textContent = "Error: " + e.message; forceRescanStatus.classList.remove("hidden"); }
      }
    });
  }

  // Whether each API key works (v0.6.1): the server asks the service, and the
  // box says so — a brass ✓ and "Checked and working", or a red ✕ and "Not
  // accepted". No answer (offline, the service down) is not shown as bad.
  function paintKeyCheck(input, badge, j, emptyHint) {
    const state = j && j.set ? j.check : null;
    if (badge) {
      badge.classList.toggle("hidden", state !== "ok" && state !== "invalid");
      badge.classList.toggle("is-ok", state === "ok");
      badge.classList.toggle("is-bad", state === "invalid");
      badge.textContent = state === "ok" ? "✓" : state === "invalid" ? "✕" : "";
      badge.setAttribute("aria-label", state === "ok" ? "Key checked and working"
        : state === "invalid" ? "Key refused by the service" : "");
      badge.title = badge.getAttribute("aria-label");
    }
    if (input) {
      input.classList.toggle("is-ok", state === "ok");
      input.classList.toggle("is-bad", state === "invalid");
      input.placeholder = !(j && j.set) ? emptyHint
        : state === "ok" ? "Checked and working — " + j.masked
        : state === "invalid" ? "Not accepted — paste a new one"
        : "Saved — " + j.masked;
    }
  }
  function keyStatusText(j) {
    if (!j.set) return "Not set";
    if (j.check === "ok") return "✓ Checked and working: " + j.masked;
    if (j.check === "invalid") return "The service refused this key (" + j.masked + "). Check it was copied in full.";
    return "Current: " + j.masked + " — couldn’t reach the service to check it.";
  }

  // One API key's box, status line and Save: Discogs' token and FanArt.tv's key.
  function wireKey({ route, field, inputId, saveId, statusId, checkId, service, noun }) {
    const input  = document.getElementById(inputId);
    const save   = document.getElementById(saveId);
    const status = document.getElementById(statusId);
    const badge  = document.getElementById(checkId);
    const hint   = input ? input.placeholder : "";
    const paint = (j) => {
      paintKeyCheck(input, badge, j, hint);
      if (status) status.textContent = keyStatusText(j);
    };
    async function load() {
      try {
        const r = await fetch("/api/settings/" + route);
        paint(await r.json());
      } catch (_) { /* display-only status — if the fetch fails, silence is fine; status just stays stale */ }
    }
    if (save) save.addEventListener("click", async () => {
      const value = input ? input.value.trim() : "";
      if (!value) return;
      save.disabled = true;
      try {
        const r = await fetch("/api/settings/" + route, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value })
        });
        const j = await r.json();
        if (j.ok) {
          if (input) input.value = "";
          paint(j);
          if (j.check === "invalid") showToast("Saved, but " + service + " refused this " + noun, "error");
          else showToast(service + " " + noun + " saved" + (j.check === "ok" ? " — checked and working" : ""), "ok");
        } else {
          showToast(j.error || "Failed to save " + noun, "error");
        }
      } catch (e) {
        showToast("Failed: " + e.message, "error");
      } finally {
        save.disabled = false;
      }
    });
    return load;
  }
  const loadDiscogsToken = wireKey({ route: "discogs-token", field: "token", inputId: "discogs-token-input", saveId: "discogs-token-save",
    statusId: "discogs-token-status", checkId: "discogs-token-check", service: "Discogs", noun: "token" });
  const loadFanartKey = wireKey({ route: "fanart-key", field: "key", inputId: "fanart-key-input", saveId: "fanart-key-save",
    statusId: "fanart-key-status", checkId: "fanart-key-check", service: "FanArt.tv", noun: "key" });

  // ----- Wall display (/display): toggle + rotation interval -----
  const displayToggle    = document.getElementById("display-toggle");
  const displaySeconds   = document.getElementById("display-seconds");
  const displaySecsValue = document.getElementById("display-seconds-value");

  async function loadDisplaySettings() {
    try {
      const r = await fetch("/api/settings/display");
      const j = await r.json();
      if (displayToggle) displayToggle.checked = !!j.enabled;
      if (displaySeconds && Number.isFinite(parseInt(j.seconds, 10))) {
        displaySeconds.value = j.seconds;
        if (displaySecsValue) displaySecsValue.textContent = j.seconds + "s";
      }
    } catch (_) { /* display-only status — if the fetch fails, the sheet just shows defaults */ }
  }

  async function saveDisplaySettings() {
    try {
      const r = await fetch("/api/settings/display", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: displayToggle ? displayToggle.checked : false,
          seconds: displaySeconds ? parseInt(displaySeconds.value, 10) : 10
        })
      });
      const j = await r.json();
      if (!j.ok) showToast("Display settings didn't persist — check the data volume", "error");
    } catch (e) {
      showToast("Failed: " + e.message, "error");
    }
  }

  if (displayToggle) displayToggle.addEventListener("change", saveDisplaySettings);
  if (displaySeconds) {
    // Live value while dragging; persist on release.
    displaySeconds.addEventListener("input", () => {
      if (displaySecsValue) displaySecsValue.textContent = displaySeconds.value + "s";
    });
    displaySeconds.addEventListener("change", saveDisplaySettings);
  }
  const lfdInput  = document.getElementById("label-folder-depth-input");
  const lfdSave   = document.getElementById("label-folder-depth-save");
  const lfdStatus = document.getElementById("label-folder-depth-status");

  async function loadLabelFolderDepth() {
    try {
      const r = await fetch("/api/settings/label-folder-depth");
      const j = await r.json();
      if (lfdInput && document.activeElement !== lfdInput) lfdInput.value = j.depth || 0;
      if (lfdStatus) lfdStatus.textContent = j.depth ? ("Using folder depth " + j.depth) : "Off — using file label tags";
    } catch (_) { /* display-only status — stale on failure is fine */ }
  }

  if (lfdSave) {
    lfdSave.addEventListener("click", async () => {
      const depth = parseInt(lfdInput ? lfdInput.value : "0", 10) || 0;
      lfdSave.disabled = true;
      try {
        const r = await fetch("/api/settings/label-folder-depth", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ depth })
        });
        const j = await r.json();
        if (j.ok) {
          showToast(j.rescanning ? "Saved — re-scanning labels…" : "Saved", "ok");
          loadLabelFolderDepth();
        } else {
          showToast(j.error || "Failed to save", "error");
        }
      } catch (e) {
        showToast("Failed: " + e.message, "error");
      } finally {
        lfdSave.disabled = false;
      }
    });
  }

  const qobuzPasteRow   = document.getElementById("qobuz-signin-paste");
  const qobuzPasteUrl   = document.getElementById("qobuz-signin-url");
  const qobuzPasteGo    = document.getElementById("qobuz-signin-finish");
  const qobuzConnect    = document.getElementById("qobuz-connect");
  const qobuzDisconnect = document.getElementById("qobuz-disconnect");
  const qobuzStatus     = document.getElementById("qobuz-status");
  const qobuzTopbarBtn  = document.getElementById("qobuz-toggle");
  const qobuzMenuItem   = document.getElementById("menu-item-qobuz");

  // Gates the Qobuz controls on the connection, exactly as loadTidalStatus
  // does. This used to toggle the Disconnect button ALONE, so the top-bar
  // button and the side-menu entry stayed visible after logging out — the
  // Qobuz browser remained one tap away from an account that no longer
  // existed, and every catalogue call behind it threw "not connected".
  async function loadQobuzStatus() {
    try {
      const r = await fetch("/api/settings/qobuz");
      const j = await r.json();
      if (qobuzStatus) qobuzStatus.textContent = j.connected
        ? ("Connected" + (j.displayName ? " as " + j.displayName : ""))
        : "Not connected";
      if (qobuzDisconnect) qobuzDisconnect.classList.toggle("hidden", !j.connected);
      // The sign-in landed by itself; the recovery field has nothing left to do.
      if (qobuzPasteRow && j.connected) qobuzPasteRow.hidden = true;
      if (qobuzConnect) qobuzConnect.classList.toggle("hidden", !!j.connected);
      if (qobuzTopbarBtn) qobuzTopbarBtn.classList.toggle("hidden", !j.connected);
      if (qobuzMenuItem)  qobuzMenuItem.classList.toggle("hidden", !j.connected);
      // Deliberately NOT force-closing an open Qobuz browser: hideOverlay() is
      // reachable only from the popstate handler so viewStack and the history
      // stack cannot drift, and the overlay already renders its own
      // not-connected state on the next request.
    } catch (_) { /* display-only status — stale on failure is fine */ }
  }

  // One sign-in for everything Qobuz. It happens on Qobuz's own page, so no
  // password is typed into this app, and the token it returns serves the
  // catalogue, the favourites and the waveforms alike.
  if (qobuzConnect) {
    qobuzConnect.addEventListener("click", async () => {
      qobuzConnect.disabled = true;
      try {
        const r = await fetch("/api/qobuz/oauth/start");
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.url) throw new Error(j.error || "Couldn't start the Qobuz sign-in");
        // Opened rather than navigated, so this page keeps its state; the tab
        // that comes back carries the code straight to the server.
        window.open(j.url, "_blank", "noopener");
        if (qobuzPasteRow) qobuzPasteRow.hidden = false;
        if (qobuzStatus) {
          qobuzStatus.textContent = "Sign in on the Qobuz tab, then come back here. " +
            "If it does not connect by itself, paste the address you landed on below.";
        }
      } catch (e) {
        showToast(e.message, "error");
      } finally {
        qobuzConnect.disabled = false;
      }
    });
  }

  if (qobuzPasteGo && qobuzPasteUrl) {
    qobuzPasteGo.addEventListener("click", async () => {
      qobuzPasteGo.disabled = true;
      try {
        const r = await fetch("/api/qobuz/oauth/paste", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: qobuzPasteUrl.value })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(j.error || "Couldn't finish signing in");
        qobuzPasteUrl.value = "";
        if (qobuzPasteRow) qobuzPasteRow.hidden = true;
        showToast("Qobuz connected", "ok");
        loadQobuzStatus();
      } catch (e) {
        showToast(e.message, "error");
      } finally { qobuzPasteGo.disabled = false; }
    });
  }

  if (qobuzDisconnect) {
    qobuzDisconnect.addEventListener("click", async () => {
      qobuzDisconnect.disabled = true;
      try {
        await fetch("/api/settings/qobuz/disconnect", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
        });
        showToast("Qobuz disconnected", "ok");
        loadQobuzStatus();
      } catch (e) {
        showToast("Failed: " + e.message, "error");
      } finally {
        qobuzDisconnect.disabled = false;
      }
    });
  }

  // Boot-time gate: the topbar Qobuz button — and its side-menu entry — must
  // reflect the connection without the user ever opening Settings.
  loadQobuzStatus();

  // ----- Share card: services and reviews -----
  //
  // Both lists are BUILT FROM THE SERVER'S ANSWER rather than from markup, for
  // the same reason the theme picker is built from the THEMES table: the list
  // of what can be linked to lives in lib/share-links.js, and a hand-written
  // copy here would be a second place for it to be wrong. The screen shows
  // what CAN be shown, which is why the endpoint serves the full table
  // alongside the enabled set and not just the set.
  //
  // Saving sends the whole array, never a delta. An empty array is a real
  // answer — "all of them off" — and the server tells the two apart by
  // Array.isArray, so a user who switches everything off gets what they asked
  // for instead of the defaults back.
  const shareServicesList = document.getElementById("share-services-list");
  const shareReviewsList  = document.getElementById("share-reviews-list");
  let shareLinkState = null;   // { services: {all, enabled}, reviews: {...} }

  function renderShareToggles(listEl, group, onSave) {
    if (!listEl || !group) return;
    listEl.innerHTML = "";
    const on = new Set(group.enabled || []);
    for (const item of group.all || []) {
      const row = document.createElement("div");
      row.className = "settings-row";

      const label = document.createElement("span");
      label.className = "settings-label";
      // The chip label where there is one, so this screen reads the same as
      // the row it controls — "AllMusic artist", not "AllMusic" twice.
      label.textContent = item.chip || item.name;

      const sw = document.createElement("label");
      sw.className = "switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = on.has(item.id);
      input.setAttribute("aria-label", item.chip || item.name);
      input.dataset.id = item.id;
      const track = document.createElement("span");
      track.className = "switch-track";
      const thumb = document.createElement("span");
      thumb.className = "switch-thumb";
      track.appendChild(thumb);
      sw.appendChild(input); sw.appendChild(track);

      input.addEventListener("change", () => {
        // Read the whole list off the DOM rather than tracking a set: what is
        // on screen IS the answer being saved, so the two cannot drift.
        const ids = Array.prototype.filter
          .call(listEl.querySelectorAll('input[type="checkbox"]'), c => c.checked)
          .map(c => c.dataset.id);
        group.enabled = ids;
        onSave(ids);
        // Switching a service off can invalidate the default, so the list of
        // candidates is rebuilt from what is left.
        if (listEl === shareServicesList) renderShareDefault(group);
      });

      row.appendChild(label); row.appendChild(sw);
      listEl.appendChild(row);
    }
  }

  async function saveShareLinks(patch) {
    try {
      const r = await fetch("/api/settings/share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
    } catch (e) {
      if (window.__showToast) window.__showToast("Couldn't save that", "err");
    }
  }

  /*
   * The default service, in Settings as well as on the chip.
   *
   * THE SAME localStorage KEY the share sheet uses — one preference, two ways
   * in. It is per device and not a server setting (see the note beside
   * preferredService in the share module), which is why this reads and writes
   * storage directly rather than posting anything.
   *
   * The list is the ENABLED services only: offering a default that is switched
   * off would send a tap somewhere the user has already said they do not want.
   * Turning off the current default therefore changes it, so the select is
   * rebuilt whenever the toggles are.
   */
  const shareDefaultSel = document.getElementById("share-default-service");
  const SHARE_PREF_KEY_SETTINGS = "musicd-share-service";

  function renderShareDefault(group) {
    if (!shareDefaultSel || !group) return;
    const all = group.all || [];
    const on  = new Set(group.enabled || []);
    const enabled = all.filter(s => on.has(s.id));
    shareDefaultSel.innerHTML = "";
    if (!enabled.length) {
      const o = document.createElement("option");
      o.textContent = "No services switched on";
      o.value = "";
      shareDefaultSel.appendChild(o);
      shareDefaultSel.disabled = true;
      return;
    }
    shareDefaultSel.disabled = false;
    let stored = null;
    try { stored = localStorage.getItem(SHARE_PREF_KEY_SETTINGS); }
    catch (e) { /* private browsing */ }
    const chosen = (stored && enabled.some(s => s.id === stored)) ? stored : enabled[0].id;
    for (const svc of enabled) {
      const o = document.createElement("option");
      o.value = svc.id;
      o.textContent = svc.name;
      o.selected = svc.id === chosen;
      shareDefaultSel.appendChild(o);
    }
  }

  if (shareDefaultSel) {
    shareDefaultSel.addEventListener("change", () => {
      const id = shareDefaultSel.value;
      if (!id) return;
      try { localStorage.setItem(SHARE_PREF_KEY_SETTINGS, id); }
      catch (e) { /* the choice lasts this session */ }
    });
  }

  async function loadShareLinkSettings() {
    if (!shareServicesList && !shareReviewsList) return;
    try {
      const r = await fetch("/api/settings/share-links");
      if (!r.ok) return;
      shareLinkState = await r.json();
      renderShareToggles(shareServicesList, shareLinkState.services,
        ids => saveShareLinks({ services: ids }));
      renderShareToggles(shareReviewsList, shareLinkState.reviews,
        ids => saveShareLinks({ reviews: ids }));
      renderShareDefault(shareLinkState.services);
      renderCardReview(!(shareLinkState.card && shareLinkState.card.review === false));
    } catch (e) { /* the panes stay empty; nothing else depends on them */ }
  }

  const cardReviewInput = document.getElementById("share-card-review");
  const cardReviewNote  = document.getElementById("share-card-review-note");
  function renderCardReview(on) {
    if (!cardReviewInput) return;
    cardReviewInput.checked = on;
    if (cardReviewNote) {
      cardReviewNote.textContent = on
        ? "On. The card carries the write-up about the album under the cover."
        : "Off. The card shows the cover, title, artist and year — no write-up.";
    }
  }
  if (cardReviewInput) {
    cardReviewInput.addEventListener("change", () => {
      renderCardReview(cardReviewInput.checked);
      saveShareLinks({ card_review: cardReviewInput.checked });
    });
  }
  window.__afterStart(loadShareLinkSettings);   // Settings panes only

  // Settings is a two-level view: a category home list and one pane per
  // category. Only one .settings-view is visible at a time. The controls and
  // their IDs are unchanged — they just live inside panes now — so all the
  // load*/save* wiring above still resolves against the same elements.
  const sheet = overlay.querySelector(".settings-sheet");
  // Looked up each time: the Android app adds a pane of its own (Downloads).
  const showView = (name) => {
    const views = sheet ? sheet.querySelectorAll(".settings-view") : [];
    let matched = false;
    views.forEach(v => {
      const isHome = v.getAttribute("data-view") === "home";
      const key    = isHome ? "home" : v.getAttribute("data-pane");
      const on     = key === name;
      v.classList.toggle("hidden", !on);
      if (on) matched = true;
    });
    // Fall back to home if an unknown pane was requested.
    if (!matched) views.forEach(v => v.classList.toggle("hidden", v.getAttribute("data-view") !== "home"));
    // On a tablet or desktop the list is a drawer the side menu's width and a page is as
    // wide as it needs (style.css, v0.6.6); the sheet says which it holds.
    if (sheet) sheet.classList.toggle("is-pane", matched && name !== "home");
    // Each level starts scrolled to the top, like a pushed page.
    if (sheet) sheet.scrollTop = 0;
  };
  const atHome = () => {
    const home = sheet && sheet.querySelector('.settings-view[data-view="home"]');
    return !home || !home.classList.contains("hidden");
  };
  // One level up: a pane that names its parent (data-parent) goes there,
  // anything else to the Settings list (one list since v0.5.54; Setup's
  // pages are on it).
  const stepBack = () => {
    const open = sheet && sheet.querySelector('.settings-view[data-view="pane"]:not(.hidden)');
    const parent = open && open.getAttribute("data-parent");
    showView(parent || "home");
  };
  // For panes filled elsewhere (a device's page, opened from a list row).
  window.__settingsShowView = showView;

  if (sheet) {
    sheet.addEventListener("click", (e) => {
      const nav = e.target.closest(".settings-nav-item");
      if (nav) { showView(nav.getAttribute("data-pane")); return; }
      if (e.target.closest("[data-settings-back]")) { stepBack(); return; }
    });
  }

  // ----- Smart Picks -----------------------------------------------------
  // The build reaches three external services and then hands Roon a batch of
  // albums to import, so WHEN it runs is a real setting rather than a nicety:
  // 4am costs nothing, the same work at 8pm competes with whatever Roon is
  // doing while somebody is listening.
  const picksHour    = document.getElementById("picks-hour");
  const picksAutoAdd = document.getElementById("picks-autoadd");
  const picksRebuild = document.getElementById("picks-rebuild");
  const picksNote    = document.getElementById("picks-service-note");

  if (picksHour && !picksHour.options.length) {
    for (let h = 0; h < 24; h++) {
      const o = document.createElement("option");
      o.value = String(h);
      o.textContent = (h < 10 ? "0" + h : String(h)) + ":00";
      picksHour.appendChild(o);
    }
  }

  async function saveSmartPicksSettings(patch) {
    try {
      const r = await fetch("/api/settings/smart-picks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      const j = await r.json();
      if (!r.ok || j.error) { showToast(j.error || "Couldn't save", "error"); return false; }
      return true;
    } catch (e) {
      showToast("Couldn't save: " + e.message, "error");
      return false;
    }
  }

  const picksEnabled = document.getElementById("picks-enabled");

  async function loadSmartPicksSettings() {
    if (!picksHour && !picksAutoAdd && !picksEnabled) return;
    try {
      const r = await fetch("/api/settings/smart-picks");
      if (!r.ok) return;
      const j = await r.json();
      if (picksEnabled) picksEnabled.checked = !!j.enabled;
      // A device that was not the one that flipped the switch catches up here.
      if (window.__applyFeatureMenu) window.__applyFeatureMenu({ picks: !!j.enabled });
      if (picksHour && Number.isFinite(j.hour)) picksHour.value = String(j.hour);
      if (picksAutoAdd) picksAutoAdd.checked = !!j.auto_add;
      if (picksNote) {
        picksNote.textContent = j.service_ready
          ? "Picks you were not offered automatically are always yours to accept or reject."
          : "Picks can be shown but not added to a streaming library.";
      }
    } catch (e) {
      // Settings simply show their last values; the pane is not the place to
      // report a transient fetch failure.
    }
  }

  if (picksEnabled) {
    picksEnabled.addEventListener("change", async () => {
      const on = picksEnabled.checked;
      if (await saveSmartPicksSettings({ enabled: on })) {
        showToast(on ? "Smart Picks on — the first set builds at the scheduled hour"
                     : "Smart Picks off — nothing runs in the background");
        if (window.__applyFeatureMenu) window.__applyFeatureMenu({ picks: on });
      } else {
        picksEnabled.checked = !on;   // the server refused — do not lie about it
      }
    });
  }

  if (picksHour) {
    picksHour.addEventListener("change", async () => {
      const h = parseInt(picksHour.value, 10);
      if (await saveSmartPicksSettings({ hour: h })) {
        showToast("Smart Picks will build at " + (h < 10 ? "0" + h : h) + ":00");
      }
    });
  }
  if (picksAutoAdd) {
    picksAutoAdd.addEventListener("change", async () => {
      const on = picksAutoAdd.checked;
      if (await saveSmartPicksSettings({ auto_add: on })) {
        showToast(on ? "Picks will be added automatically"
                     : "Every pick will ask before adding");
      } else {
        picksAutoAdd.checked = !on;   // the server refused — do not lie about it
      }
    });
  }
  if (picksRebuild) {
    picksRebuild.addEventListener("click", async () => {
      picksRebuild.disabled = true;
      const orig = picksRebuild.textContent;
      picksRebuild.textContent = "…";
      try {
        const r = await fetch("/api/smart-picks/rebuild", { method: "POST" });
        const j = await r.json().catch(() => ({}));
        showToast(r.ok ? "Rebuilding today's picks — check back in a minute"
                       : (j.error || "Couldn't rebuild"), r.ok ? "ok" : "error");
      } catch (e) {
        showToast("Couldn't rebuild: " + e.message, "error");
      } finally {
        picksRebuild.disabled = false;
        picksRebuild.textContent = orig;
      }
    });
  }

  // ----- Discover --------------------------------------------------------
  // Up to eighty Deezer reads in a row, once a day. The hour matters for the
  // same reason Smart Picks' does — not because it competes with Roon (nothing
  // here touches the Core) but because a burst of outbound calls belongs at an
  // hour nobody is listening.
  const discEnabled = document.getElementById("discover-enabled");
  const discHour    = document.getElementById("discover-hour");
  const discRebuild = document.getElementById("discover-rebuild");
  const discNote    = document.getElementById("discover-note");

  if (discHour && !discHour.options.length) {
    for (let h = 0; h < 24; h++) {
      const o = document.createElement("option");
      o.value = String(h);
      o.textContent = (h < 10 ? "0" + h : String(h)) + ":00";
      discHour.appendChild(o);
    }
  }

  async function saveDiscoverSettings(patch) {
    try {
      const r = await fetch("/api/settings/discover", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      const j = await r.json();
      if (!r.ok || j.error) { showToast(j.error || "Couldn't save", "error"); return false; }
      return true;
    } catch (e) {
      showToast("Couldn't save: " + e.message, "error");
      return false;
    }
  }

  async function loadDiscoverSettings() {
    if (!discEnabled && !discHour) return;
    try {
      const r = await fetch("/api/settings/discover");
      if (!r.ok) return;
      const j = await r.json();
      if (discEnabled) discEnabled.checked = !!j.enabled;
      // A device that was not the one that flipped the switch catches up here.
      if (window.__applyFeatureMenu) window.__applyFeatureMenu({ discover: !!j.enabled });
      if (discHour && Number.isFinite(j.hour)) discHour.value = String(j.hour);
      if (discNote) {
        // The numbers come from the SERVER rather than being written into the
        // copy, so the sentence cannot end up describing a window or a seed
        // count that the build no longer uses.
        discNote.textContent = "Reads your play history for the " +
          (j.seed_count || 40) + " artists you return to most, and looks for " +
          "records they have released in the last " + (j.window_days || 60) +
          " days. Only the lookups leave your network.";
      }
    } catch (e) {
      // Settings show their last values; the pane is not the place to report a
      // transient fetch failure.
    }
  }

  if (discEnabled) {
    discEnabled.addEventListener("change", async () => {
      const on = discEnabled.checked;
      if (await saveDiscoverSettings({ enabled: on })) {
        showToast(on ? "Discover on — the first list builds at the scheduled hour"
                     : "Discover off — nothing runs in the background");
        if (window.__applyFeatureMenu) window.__applyFeatureMenu({ discover: on });
      } else {
        discEnabled.checked = !on;   // the server refused — do not lie about it
      }
    });
  }

  if (discHour) {
    discHour.addEventListener("change", async () => {
      const h = parseInt(discHour.value, 10);
      if (await saveDiscoverSettings({ hour: h })) {
        showToast("Discover will look at " + (h < 10 ? "0" + h : h) + ":00");
      }
    });
  }

  if (discRebuild) {
    discRebuild.addEventListener("click", async () => {
      discRebuild.disabled = true;
      const orig = discRebuild.textContent;
      discRebuild.textContent = "\u2026";
      try {
        const r = await fetch("/api/discover/rebuild", { method: "POST" });
        const j = await r.json().catch(() => ({}));
        showToast(r.ok ? "Looking for new records — check back in a minute"
                       : (j.error || "Couldn't refresh"), r.ok ? "ok" : "error");
      } catch (e) {
        showToast("Couldn't refresh: " + e.message, "error");
      } finally {
        discRebuild.disabled = false;
        discRebuild.textContent = orig;
      }
    });
  }

  // ----- Waveform on/off -----
  const waveEnabledEl = document.getElementById("waveform-enabled");
  const waveEnabledNote = document.getElementById("waveform-enabled-note");
  async function loadWaveformEnabled() {
    if (!waveEnabledEl) return;
    try {
      const r = await fetch("/api/settings/waveform");
      if (!r.ok) return;
      const j = await r.json();
      waveEnabledEl.checked = !!j.enabled;
      window.__waveformOn = !!j.enabled;
      showQobuzSecretState(j);
      if (waveEnabledNote) {
        waveEnabledNote.textContent = j.enabled
          ? "On. Each track is analysed the first time it plays and kept, " +
            "so it is instant after that."
          : "Off. The progress bar stays a plain line.";
      }
    } catch (e) { /* keep the last shown value */ }
  }
  // ----- Qobuz app secret (streaming waveforms) -----
  // Blank is the default and the off switch: with no secret the server never
  // asks Qobuz for audio and streaming tracks keep the plain bar.
  const qSecStatus = document.getElementById("qobuz-secret-status");

  // No controls of its own any more: one Qobuz sign-in under Streaming accounts
  // covers browsing, favourites and waveforms alike, so this only reports what
  // that sign-in means for waveforms.
  function showQobuzSecretState(j) {
    if (!qSecStatus) return;
    if (j && j.qobuz_connected) {
      qSecStatus.textContent = "Using your Qobuz sign-in. Qobuz tracks will show a " +
        "waveform once analysed.";
      return;
    }
    if (j && j.qobuz_secret_set) {
      qSecStatus.textContent = "Using saved credentials from an earlier version. " +
        "Reconnect Qobuz under Streaming accounts to replace them.";
      return;
    }
    qSecStatus.textContent = "Connect Qobuz under Streaming accounts to enable this. " +
      "Qobuz tracks keep the plain bar until then.";
  }

  if (waveEnabledEl) {
    waveEnabledEl.addEventListener("change", async () => {
      const on = waveEnabledEl.checked;
      try {
        const r = await fetch("/api/settings/waveform", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: on })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(j.error || "Couldn't save");
        window.__waveformOn = on;
        showToast(on ? "Waveform on \u2014 local files show the track's shape"
                     : "Waveform off");
        loadWaveformEnabled();
        // Repaint now rather than at the next track change, so the switch is
        // seen to do something.
        if (window.__repaintWaveform) window.__repaintWaveform();
      } catch (e) {
        waveEnabledEl.checked = !on;   // the server refused — do not lie about it
        showToast(e.message, "error");
      }
    });
  }

  // ----- Labels on/off -----
  const labelsEnabledEl = document.getElementById("labels-enabled");
  const labelsEnabledNote = document.getElementById("labels-enabled-note");
  async function loadLabelsEnabled() {
    if (!labelsEnabledEl) return;
    try {
      const r = await fetch("/api/settings/labels");
      if (!r.ok) return;
      const j = await r.json();
      labelsEnabledEl.checked = !!j.enabled;
      if (window.__applyFeatureMenu) window.__applyFeatureMenu({ labels: !!j.enabled });
      if (labelsEnabledNote) {
        const tagged = j.tagged || 0, untagged = j.untagged || 0, lookedUp = j.looked_up || 0;
        const have = tagged + " album" + (tagged === 1 ? "" : "s") + " name" + (tagged === 1 ? "s" : "") + " a label in " + (tagged === 1 ? "its" : "their") + " tags" +
          (lookedUp ? ", " + lookedUp + " " + (lookedUp === 1 ? "has" : "have") + " one looked up" : "") + "; " +
          untagged + " " + (untagged === 1 ? "has" : "have") + " none" + (j.enabled && untagged && !j.scanning && !lookedUp ? " (MusicBrainz and Discogs didn't know them)" : "") + ".";
        const logos = j.count
          ? (j.scanning ? " Looking up labels and logos now…"
             : (j.discogs || j.fanart) ? " " + (j.logos || 0) + " logo" + (j.logos === 1 ? "" : "s") + "."
             : " Logos need a Discogs token or a FanArt.tv key (Settings → API Keys).")
          : "";
        labelsEnabledNote.textContent = j.enabled
          ? (j.count ? j.count + " label" + (j.count === 1 ? "" : "s") + ". " + have + logos
                     : "No labels yet: none of the albums' files carry a LABEL tag.")
          : "Off. " + have;
      }
    } catch (e) { /* keep the last shown value */ }
  }
  if (labelsEnabledEl) {
    labelsEnabledEl.addEventListener("change", async () => {
      const on = labelsEnabledEl.checked;
      try {
        const r = await fetch("/api/settings/labels", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: on })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(j.error || "Couldn't save");
        showToast(on ? "Labels on" : "Labels off");
        if (window.__applyFeatureMenu) window.__applyFeatureMenu({ labels: on });
        loadLabelsEnabled();
      } catch (e) {
        labelsEnabledEl.checked = !on;   // the server refused — do not lie about it
        showToast(e.message, "error");
      }
    });
  }

  // ----- Home Screen: which rows show, and in what order -----
  //
  // Rendered from the same HOME_ROWS table the Home screen itself loops, via
  // the globals below, so a row can never appear in one and not the other.
  const homeRowsList = document.getElementById("home-rows-list");
  let homeRowsDraft = [];

  function renderHomeRowsList() {
    if (!homeRowsList) return;
    homeRowsList.innerHTML = "";
    const titles = window.__homeRowTitles ? window.__homeRowTitles() : {};
    const downloaded = window.__downloadedCount ? window.__downloadedCount() : 0;
    for (const row of homeRowsDraft) {
      // Rows this device doesn't have (Downloaded albums, outside the Android
      // app) stay in the saved order but aren't listed.
      if (!titles[row.id]) continue;
      // Downloaded albums can't be switched off while there are any.
      const held = row.id === "downloads" && downloaded > 0;
      const li = document.createElement("li");
      li.className = "home-row-item";
      li.dataset.row = row.id;

      const grip = document.createElement("span");
      grip.className = "home-row-grip";
      grip.setAttribute("aria-hidden", "true");
      grip.textContent = "⠿";

      // A row whose FEATURE is off is not a layout choice. It reads as off and
      // cannot be switched on here, because switching it on would do nothing —
      // the row has no data to show. `row.on` is deliberately left ALONE, so
      // turning Smart Picks or Labels back on restores the Home screen the user
      // had rather than one this screen quietly rewrote.
      const off = row.unavailable || null;
      if (off) li.classList.add("is-unavailable");
      if (held) li.classList.add("is-held");

      const name = document.createElement("span");
      name.className = "home-row-name";
      name.textContent = titles[row.id] || row.id;
      if (off || held) {
        const why = document.createElement("span");
        why.className = "home-row-why";
        why.textContent = off || "On while albums are downloaded to this phone";
        name.appendChild(why);
      }

      const sw = document.createElement("label");
      sw.className = "switch";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = held || (!off && row.on !== false);
      cb.disabled = !!off || held;
      cb.setAttribute("aria-label", (titles[row.id] || row.id) + " row");
      cb.addEventListener("change", () => {
        row.on = cb.checked;
        saveHomeRows();
      });
      const track = document.createElement("span");
      track.className = "switch-track";
      const thumb = document.createElement("span");
      thumb.className = "switch-thumb";
      track.appendChild(thumb);
      sw.appendChild(cb); sw.appendChild(track);

      li.appendChild(grip); li.appendChild(name); li.appendChild(sw);
      attachRowDrag(li, grip);
      homeRowsList.appendChild(li);
    }
  }

  // Hold the grip, then drag. Pointer events so one code path covers touch and
  // mouse; the list reorders live under the finger and the draft array is
  // rewritten from the DOM on drop, so the two can never disagree.
  //
  // The dragged row itself is never moved in the DOM — its NEIGHBOURS are,
  // past it. Moving the row that holds the pointer capture (insertBefore is a
  // remove and an insert) makes the browser drop the capture: the drag
  // stopped after one place, and the drop that saves the order never came, so
  // a row seen moved went back on the next visit. Swapping neighbours one at a
  // time also lets a fast drag pass several rows in one move.
  function attachRowDrag(li, grip) {
    let dragging = false;
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      dragging = true;
      li.classList.add("is-dragging");
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* moves still arrive while over the grip */ }
    });
    const mid = el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    grip.addEventListener("pointermove", (e) => {
      if (!dragging || !homeRowsList) return;
      let prev = li.previousElementSibling, next = li.nextElementSibling;
      while (prev && prev.classList.contains("home-row-item") && e.clientY < mid(prev)) {
        homeRowsList.insertBefore(prev, li.nextSibling);   // the row above drops below
        prev = li.previousElementSibling;
      }
      while (next && next.classList.contains("home-row-item") && e.clientY > mid(next)) {
        homeRowsList.insertBefore(next, li);               // the row below rises above
        next = li.nextElementSibling;
      }
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      li.classList.remove("is-dragging");
      // The DOM is the truth now — read the order back out of it rather than
      // trying to mirror every move into the array as it happened.
      if (homeRowsList) {
        const order = [...homeRowsList.querySelectorAll(".home-row-item")].map(x => x.dataset.row);
        homeRowsDraft.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      }
      saveHomeRows();
    };
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
    // However the drag ends, the order it left is saved.
    grip.addEventListener("lostpointercapture", end);
  }

  window.__renderHomeRowsList = () => { if (homeRowsList && homeRowsList.offsetParent) renderHomeRowsList(); };

  async function saveHomeRows() {
    try {
      const r = await fetch("/api/settings/home-rows", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: homeRowsDraft })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || "Couldn't save");
      if (Array.isArray(j.rows)) {
        homeRowsDraft = j.rows;
        // REDRAW. The server answers with freshly built {id,on} objects, so
        // replacing the array orphaned every checkbox handler still closing
        // over the previous one — after one save, every further toggle
        // mutated a discarded object and was silently dropped, and after a
        // drag the whole list went dead. The list is cheap; rebuild it.
        renderHomeRowsList();
      }
      // Apply immediately — the Home screen is behind this sheet, and a layout
      // that only takes effect on the next launch reads as a broken control.
      if (window.__applyHomeLayout) window.__applyHomeLayout(homeRowsDraft);
    } catch (e) {
      showToast(e.message, "error");
      loadHomeRowsSettings();   // resync from the server rather than keep a lie
    }
  }

  async function loadHomeRowsSettings() {
    if (!homeRowsList) return;
    try {
      const r = await fetch("/api/settings/home-rows");
      if (!r.ok) return;
      const j = await r.json();
      if (j && Array.isArray(j.rows)) homeRowsDraft = j.rows;
    } catch (e) { /* keep whatever is drawn */ }
    renderHomeRowsList();
  }

  const open = () => { showView("home"); loadRadio(); loadVersion(); loadDiscogsToken(); loadFanartKey(); loadDisplaySettings(); loadLabelFolderDepth(); loadQobuzStatus(); loadSmartPicksSettings(); loadDiscoverSettings(); loadLabelsEnabled(); loadWaveformEnabled(); loadHomeRowsSettings(); overlay.classList.remove("hidden"); };
  const close = () => { overlay.classList.add("hidden"); };

  openBtn.addEventListener("click", open);
  overlay.addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-settings-close")) close();
  });
  // Settings fills the screen (as the Android app has always had it), so
  // there's no backdrop to tap: a close button in its head, everywhere.
  {
    const head = overlay.querySelector('.settings-view[data-view="home"] .settings-head');
    if (head) {
      const x = document.createElement("button");
      x.type = "button";
      x.className = "settings-app-close";
      x.setAttribute("aria-label", "Close settings");
      x.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      x.addEventListener("click", close);
      // On the left, before the title, where every page's Back is.
      head.prepend(x);
    }
  }
  // The Android app's Back steps out of Settings — a pane to the list, the
  // list to Home.
  if (window.MusicdDownloads) {
    window.__musicdBack = () => {
      if (overlay.classList.contains("hidden")) return window.__pageBack ? window.__pageBack() : false;
      if (atHome()) close(); else stepBack();
      return true;
    };
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || overlay.classList.contains("hidden")) return;
    // Escape steps back one level: pane → home, home → closed.
    if (atHome()) close();
    else stepBack();
  });
})();

/* ------------------------------------------------------------------ */
/*  Streaming-service browser factory — self-contained overlay (tabs,  */
/*  search, artists, album detail + favourite). Instantiated once per  */
/*  service (Qobuz, Tidal) below; each instance owns its closure state */
/*  (viewStack, reqSeq, timers) so the two overlays never interact.    */
/*  Isolated from the album grid / labels / filters; uses only the     */
/*  service's API endpoints and window.__showToast.                    */
/*                                                                     */
/*  cfg: {                                                             */
/*    service          "qobuz" | "tidal" (internal identifier)         */
/*    serviceName      display name for toasts ("Qobuz" / "Tidal")     */
/*    idPrefix         element-id prefix ("qobuz-…" / "tidal-…")       */
/*    apiBase          "/api/qobuz" | "/api/tidal"                     */
/*    historyKey       key used in history.pushState state objects —   */
/*                     "qz" (pre-factory value, kept so Qobuz behaves  */
/*                     byte-identically) | "td"                        */
/*    closeAttr        data attribute on the overlay's close targets   */
/*    notConnectedMsg  status text when the API says "not connected"   */
/*    tabs             [{ id, label, kind }] — kind "new-releases"     */
/*                     hits /new-releases?days=30, kind "featured"     */
/*                     hits /featured?type=<id>. tabs[0] is the        */
/*                     default tab shown when the overlay opens.       */
/*  }                                                                  */
/* ------------------------------------------------------------------ */
function initServiceBrowser(cfg) {
  const byId = (suffix) => document.getElementById(cfg.idPrefix + suffix);
  const btn          = byId("-toggle");
  const overlay      = byId("-overlay");
  const listEl       = byId("-nr-list");
  const statusEl     = byId("-nr-status");
  const detailEl     = byId("-nr-detail");
  const searchInput  = byId("-search-input");
  const searchClear  = byId("-search-clear");
  const tabsEl       = byId("-tabs");
  const artistHeadEl = byId("-artist-head");
  const artistsEl    = byId("-artists");
  const loadMoreEl   = byId("-load-more");
  // Both overlays share the .qobuz-* CSS classes (only ids differ), so the
  // class-based lookups below work for every instance.
  const searchRowEl  = overlay ? overlay.querySelector(".qobuz-search-row") : null;
  if (!btn || !overlay) return;

  const defaultTab = cfg.tabs[0].id;

  const PAGE_SIZE = 50;

  const toast = (msg, kind) => { if (window.__showToast) window.__showToast(msg, kind); };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const overlayVisible = () => !overlay.classList.contains("hidden");

  // View stack — one entry per history level pushed while the overlay is open.
  // Each entry: { kind: 'tab', tab } | { kind: 'search', query }
  //           | { kind: 'artist', artistId, artistName } | { kind: 'detail', album, rowFavBtn }
  // plus bookkeeping set while shown: loaded (fetch completed), offset/hasMore/
  // limit (paged views), snapshot (rendered list DOM saved when an artist view
  // covers this one — see snapshotListInto/restoreSnapshot).
  // Invariant: entry N was created by the history.pushState carrying
  // {[cfg.historyKey]: N+1…}, so history.state[historyKey] always equals the
  // stack depth for the current entry.
  // The popstate handler RECONCILES against that depth rather than blindly
  // popping once, which keeps the stack correct across Forward presses and
  // multi-step history jumps. Tab switches and new searches REPLACE the top
  // entry (no push) — they are siblings, not depth.
  let viewStack = [];
  const currentView = () => viewStack[viewStack.length - 1] || null;

  // Last tab the user explicitly selected — where clearing the search returns to.
  let activeTab = defaultTab;

  // Monotonic request counter: every render/loadMore bumps it and any response
  // arriving after a newer request started is dropped (out-of-order guard).
  let reqSeq = 0;

  let searchTimer = null;

  function clearSearchTimer() {
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
  }

  function clearDetail() {
    if (detailEl) { detailEl.classList.add("hidden"); detailEl.innerHTML = ""; detailEl.dataset.albumId = ""; }
  }

  // Empty the shared list containers (rows, artist strip/header, load-more).
  // During a view change this runs only once the fetch outcome (results, empty,
  // or error) is ready — never before the fetch — so the previous rows stay on
  // screen under the "Searching…"/"Loading…" status instead of the content area
  // blanking while a request is in flight.
  function resetListContainers() {
    if (listEl) listEl.innerHTML = "";
    if (artistHeadEl) { artistHeadEl.classList.add("hidden"); artistHeadEl.innerHTML = ""; }
    if (artistsEl) { artistsEl.classList.add("hidden"); artistsEl.innerHTML = ""; }
    if (loadMoreEl) loadMoreEl.classList.add("hidden");
  }

  // Reset the search box UI (text, × visibility, pending debounce) WITHOUT
  // navigating — for callers about to render a view of their own (tab click,
  // overlay open). clearSearch() adds the return-to-tab navigation on top.
  function resetSearchBox() {
    if (searchInput) searchInput.value = "";
    if (searchClear) searchClear.classList.add("hidden");
    clearSearchTimer();
  }

  // Cancel the search: empty the box, drop any pending debounce, and return to
  // the last active tab. Shared by the × clear button and the Escape key.
  function clearSearch() {
    resetSearchBox();
    applySearch("");
  }

  // Fully hide the overlay (and any open detail). Called only from the popstate
  // handler when the view stack empties — never directly from a close affordance,
  // so viewStack and the history stack can never get out of step.
  function hideOverlay() {
    overlay.classList.add("hidden");
    viewStack = [];
    reqSeq++; // orphan any in-flight fetch — a late response must not repopulate the hidden overlay
    clearSearchTimer();
    clearDetail();
    // Drop this session's rows/status now — the deferred-clear render path
    // would otherwise show them again on the next open while its first
    // request is still in flight.
    resetListContainers();
    if (statusEl) statusEl.textContent = "";
  }

  // All back/close affordances (× button, backdrop, ‹ Back, Esc) step back one
  // history level via history.back(), which the popstate handler turns into
  // detail → list → … → closed. This also makes the Android/browser back button
  // behave naturally instead of leaving the page.
  const goBack = () => history.back();

  overlay.querySelectorAll("[" + cfg.closeAttr + "]").forEach(el => el.addEventListener("click", goBack));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !overlayVisible()) return;
    // Escape while typing must never navigate the overlay away. Staged:
    // 1st press (text present) clears the box — same action as the × button —
    // keeping focus so the user can retype; 2nd press (box empty) just blurs;
    // only with the input unfocused does Escape step back / close.
    if (searchInput && document.activeElement === searchInput) {
      if (searchInput.value) clearSearch();
      else searchInput.blur();
      return;
    }
    goBack();
  });

  // Browser / Android back (and Forward): while the overlay is open, reconcile
  // the view stack against the depth stored in history.state instead of blindly
  // popping once — Forward presses and multi-step jumps then self-heal rather
  // than corrupting the stack. No-op when the overlay isn't open, so the rest
  // of the app (which uses no history state) — including the OTHER service's
  // browser — is unaffected. Each instance reads only its own historyKey: a
  // state carrying just the other service's key (or no state at all) counts as
  // depth 0 for this instance, and depth 0 while this overlay is visible means
  // "backed out past this overlay's root" — close it. That is exactly the
  // pre-factory close-on-back behaviour, and it is safe cross-service because
  // every history entry pushed while this overlay is open carries this
  // instance's key (pushState truncates any forward entries the other overlay
  // left behind, so a foreign-key state can only ever sit BELOW this overlay's
  // root — where closing is the correct response).
  window.addEventListener("popstate", (e) => {
    if (!overlayVisible()) return;
    const depth = (e.state && Number.isFinite(e.state[cfg.historyKey])) ? e.state[cfg.historyKey] : 0;
    if (depth >= viewStack.length) {
      // Forward into a history entry whose view we already discarded — bounce
      // back to the deepest view we still have. The resulting popstate lands
      // exactly on depth === viewStack.length and no-ops.
      if (depth > viewStack.length) history.go(viewStack.length - depth);
      return;
    }
    const popped = currentView();
    viewStack.length = depth;
    if (!viewStack.length) { hideOverlay(); return; }
    const top = currentView();
    // A view covered by an artist push had its rendered list saved — restore
    // it without refetching (keeps loaded pages + scroll position).
    if (top.snapshot) { restoreSnapshot(top); return; }
    // Leaving a detail view: the list underneath is still intact in the DOM
    // (detail only hides it), so just restore visibility — no refetch.
    if (popped && popped.kind === "detail") { restoreListAfterDetail(top); return; }
    render(top);
  });

  // Push a deeper view (detail or artist): one viewStack entry + one history entry.
  function pushView(view) {
    const covered = currentView();
    // An artist view re-renders the shared list DOM, so save the covered list
    // view's rendered state first for an instant, fetch-free back. (Detail
    // views only hide the list — no snapshot needed. Views that never finished
    // loading have nothing worth saving; back will refetch them instead.)
    if (view.kind === "artist" && covered && covered.kind !== "detail" && covered.loaded) {
      snapshotListInto(covered);
    }
    viewStack.push(view);
    history.pushState({ [cfg.historyKey]: viewStack.length }, "");
    render(view);
  }

  // Replace the top view (tab switch, new search): no history entry, so the
  // 1:1 viewStack ↔ history invariant is preserved.
  function replaceTop(view) {
    if (!viewStack.length) return;
    viewStack[viewStack.length - 1] = view;
    render(view);
  }

  // Reflect favourite state on a button (added = in the user's service library).
  function setFavState(button, added) {
    button.dataset.fav = added ? "1" : "0";
    button.textContent = added ? "✓ Added" : "♥ Favourite";
    button.classList.toggle("is-done", added);
  }

  // Toggle favourite/un-favourite against the service, updating every button
  // that represents this album (the list row and, if open, the detail view) so
  // they stay in sync. `buttons` may be a single button or an array.
  async function toggleFavourite(albumId, buttons) {
    const btns = (Array.isArray(buttons) ? buttons : [buttons]).filter(Boolean);
    if (!btns.length) return;
    const wasAdded = btns[0].dataset.fav === "1";
    const prev = btns.map(b => b.textContent);
    btns.forEach(b => { b.disabled = true; b.textContent = "…"; });
    try {
      const r = await fetch(cfg.apiBase + (wasAdded ? "/unfavorite" : "/favorite"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ album_id: albumId })
      });
      const j = await r.json();
      if (j.ok) {
        btns.forEach(b => setFavState(b, !wasAdded));
        toast(wasAdded
          ? ("Removed from " + cfg.serviceName + " favourites")
          : ("Added to " + cfg.serviceName + " favourites"), "ok");
      } else {
        btns.forEach((b, i) => { b.textContent = prev[i]; });
        toast(j.error || "Couldn't update favourite", "error");
      }
    } catch (e) {
      btns.forEach((b, i) => { b.textContent = prev[i]; });
      toast("Failed: " + e.message, "error");
    } finally {
      btns.forEach(b => { b.disabled = false; });
    }
  }

  // Highlight the active tab chip. While a search / artist / detail view is on
  // top, no chip is highlighted.
  function updateTabActive() {
    if (!tabsEl) return;
    const top = currentView();
    const active = top && top.kind === "tab" ? top.tab : null;
    tabsEl.querySelectorAll(".qobuz-tab").forEach(t =>
      t.classList.toggle("is-active", t.dataset.qtab === active));
  }

  // Muted edition/version suffix ("Deluxe Edition" …) shown after a title.
  const versionHtml = (a) =>
    a.version ? ' <span class="qobuz-nr-version">' + esc(a.version) + '</span>' : '';

  // Build one album row (art, title [+ version], artist, date, favourite button;
  // row tap → detail). Shared by every list-type view.
  function buildAlbumRow(a) {
    const row = document.createElement("div");
    row.className = "qobuz-nr-row";
    const art = a.image
      ? '<img class="qobuz-nr-art" loading="lazy" alt="" src="' + esc(a.image) + '">'
      : '<div class="qobuz-nr-art"></div>';
    const date = a.release_date ? '<div class="qobuz-nr-date">' + esc(a.release_date) + '</div>' : '';
    row.innerHTML = art +
      '<div class="qobuz-nr-meta">' +
        '<div class="qobuz-nr-title">'  + esc(a.title) + versionHtml(a) + '</div>' +
        '<div class="qobuz-nr-artist">' + esc(a.artist) + '</div>' +
        date +
      '</div>';
    const fav = document.createElement("button");
    fav.type = "button";
    fav.className = "qobuz-nr-fav";
    // Tappable toggle: "✓ Added" (in library) ⇄ "♥ Favourite". Initial state
    // reflects the user's current service favourites (added here or elsewhere).
    setFavState(fav, !!a.favourited);
    fav.addEventListener("click", (e) => { e.stopPropagation(); toggleFavourite(a.id, fav); });
    row.appendChild(fav);
    // Tapping the row (anywhere but the favourite button) opens the detail view.
    row.addEventListener("click", () => pushView({ kind: "detail", album: a, rowFavBtn: fav }));
    return row;
  }

  function appendAlbumRows(albums) {
    if (!listEl) return;
    const frag = document.createDocumentFragment();
    for (const a of albums) frag.appendChild(buildAlbumRow(a));
    listEl.appendChild(frag);
  }

  // Artist matches strip shown above search results (offset 0 only).
  function renderArtistStrip(artists) {
    if (!artistsEl) return;
    artistsEl.innerHTML = "";
    if (!artists.length) { artistsEl.classList.add("hidden"); return; }
    for (const ar of artists) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "qobuz-artist-chip";
      chip.innerHTML =
        (ar.image
          ? '<img class="qobuz-artist-thumb" loading="lazy" alt="" src="' + esc(ar.image) + '">'
          : '<div class="qobuz-artist-thumb"></div>') +
        '<span class="qobuz-artist-name">' + esc(ar.name) + '</span>';
      chip.addEventListener("click", () =>
        pushView({ kind: "artist", artistId: ar.id, artistName: ar.name }));
      artistsEl.appendChild(chip);
    }
    artistsEl.classList.remove("hidden");
  }

  // Artist discography header: ‹ Back affordance (same as detail) + round thumb + name.
  function renderArtistHead(image, name) {
    if (!artistHeadEl) return;
    artistHeadEl.innerHTML = "";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "qobuz-nr-back";
    back.textContent = "‹ Back";
    back.addEventListener("click", goBack);
    const head = document.createElement("div");
    head.className = "qobuz-artist-head-row";
    head.innerHTML =
      (image
        ? '<img class="qobuz-artist-head-art" alt="" src="' + esc(image) + '">'
        : '<div class="qobuz-artist-head-art"></div>') +
      '<div class="qobuz-artist-head-name">' + esc(name) + '</div>';
    artistHeadEl.appendChild(back);
    artistHeadEl.appendChild(head);
    artistHeadEl.classList.remove("hidden");
  }

  // Restore the list chrome after popping a detail view. The underlying list
  // DOM (rows, artist strip/header, load-more state) was only hidden, never
  // cleared, so this is pure visibility work — no refetch.
  function restoreListAfterDetail(top) {
    // Exception: with deferred clearing, stale rows stay clickable while a
    // request is in flight, so a detail can be opened from a view whose fetch
    // was then orphaned (reqSeq bumped) before it ever loaded. Restoring
    // visibility would present the PREVIOUS view's rows under a stuck
    // "Searching…"/"Loading…" status — refetch the view instead.
    if (!top.loaded) { render(top); return; }
    clearDetail();
    if (searchRowEl) searchRowEl.classList.remove("hidden");
    if (tabsEl) tabsEl.classList.remove("hidden");
    if (statusEl) statusEl.classList.remove("hidden");
    if (listEl) listEl.classList.remove("hidden");
    if (artistHeadEl) artistHeadEl.classList.toggle("hidden", top.kind !== "artist");
    if (artistsEl) artistsEl.classList.toggle("hidden",
      !(top.kind === "search" && artistsEl.childElementCount > 0));
    if (loadMoreEl) loadMoreEl.classList.toggle("hidden", !top.hasMore);
    syncChrome(top);
  }

  // Save a rendered list view's DOM (rows, artist strip/header, status,
  // load-more state) onto its stack entry before an artist view takes over the
  // shared containers. Moving nodes into fragments keeps their listeners alive.
  function snapshotListInto(view) {
    const snap = {
      list:          document.createDocumentFragment(),
      artists:       document.createDocumentFragment(),
      head:          document.createDocumentFragment(),
      artistsHidden: artistsEl ? artistsEl.classList.contains("hidden") : true,
      headHidden:    artistHeadEl ? artistHeadEl.classList.contains("hidden") : true,
      status:        statusEl ? statusEl.textContent : "",
      loadMoreHidden: loadMoreEl ? loadMoreEl.classList.contains("hidden") : true
    };
    if (listEl) while (listEl.firstChild) snap.list.appendChild(listEl.firstChild);
    if (artistsEl) while (artistsEl.firstChild) snap.artists.appendChild(artistsEl.firstChild);
    if (artistHeadEl) while (artistHeadEl.firstChild) snap.head.appendChild(artistHeadEl.firstChild);
    view.snapshot = snap;
  }

  // Put a snapshotted list view back on screen — no refetch, loaded pages and
  // favourite-button state (live nodes) survive intact.
  function restoreSnapshot(view) {
    const snap = view.snapshot;
    view.snapshot = null;
    reqSeq++; // orphan any in-flight fetch owned by the view being discarded
    clearDetail();
    if (searchRowEl) searchRowEl.classList.remove("hidden");
    if (tabsEl) tabsEl.classList.remove("hidden");
    if (statusEl) { statusEl.classList.remove("hidden"); statusEl.textContent = snap.status; }
    if (listEl) { listEl.innerHTML = ""; listEl.appendChild(snap.list); listEl.classList.remove("hidden"); }
    if (artistHeadEl) {
      artistHeadEl.innerHTML = "";
      artistHeadEl.appendChild(snap.head);
      artistHeadEl.classList.toggle("hidden", snap.headHidden);
    }
    if (artistsEl) {
      artistsEl.innerHTML = "";
      artistsEl.appendChild(snap.artists);
      artistsEl.classList.toggle("hidden", snap.artistsHidden);
    }
    if (loadMoreEl) loadMoreEl.classList.toggle("hidden", snap.loadMoreHidden);
    syncChrome(view);
  }

  // Keep the search box, its clear button, and the tab chips consistent with
  // the view being shown — a popstate can resurface a search whose text a tab
  // switch cleared, and vice versa. Never fight live typing: the input is left
  // alone while focused.
  function syncChrome(view) {
    updateTabActive();
    if (!searchInput) return;
    if (document.activeElement !== searchInput) {
      if (view.kind === "search") searchInput.value = view.query;
      else if (view.kind === "tab") searchInput.value = "";
    }
    if (searchClear) searchClear.classList.toggle("hidden", !searchInput.value);
  }

  // fetch + JSON with a clean error path: non-JSON bodies (proxy or maintenance
  // HTML pages) surface as "HTTP nnn" instead of a JSON SyntaxError message.
  async function qFetch(url) {
    const r = await fetch(url);
    let j = null;
    try { j = await r.json(); } catch (e) { /* non-JSON body — handled below via r.ok/status */ }
    if (!r.ok) throw new Error((j && j.error) || ("HTTP " + r.status));
    return j || {};
  }

  // Isolated detail view for a service album: artwork, editorial review
  // (fetched by title+artist via the service-independent /api/album/extras —
  // no Roon needed, works for any catalogue), and a favourite toggle kept in
  // sync with the originating list row's button.
  async function renderDetail(album, rowFavBtn) {
    if (!detailEl) return;
    detailEl.innerHTML = "";
    detailEl.dataset.albumId = album.id;

    const back = document.createElement("button");
    back.type = "button";
    back.className = "qobuz-nr-back";
    back.textContent = "‹ Back";
    back.addEventListener("click", goBack);

    const head = document.createElement("div");
    head.className = "qobuz-nr-detail-head";
    head.innerHTML =
      (album.image
        ? '<img class="qobuz-nr-detail-art" alt="" src="' + esc(album.image) + '">'
        : '<div class="qobuz-nr-detail-art"></div>') +
      '<div class="qobuz-nr-detail-meta">' +
        '<div class="qobuz-nr-detail-title">' + esc(album.title) + versionHtml(album) + '</div>' +
        '<div class="qobuz-nr-detail-artist">' + esc(album.artist) + '</div>' +
        (album.release_date ? '<div class="qobuz-nr-date">' + esc(album.release_date) + '</div>' : '') +
      '</div>';

    const favBtn = document.createElement("button");
    favBtn.type = "button";
    favBtn.className = "qobuz-nr-fav";
    setFavState(favBtn, rowFavBtn && rowFavBtn.dataset.fav === "1");
    favBtn.addEventListener("click", () => toggleFavourite(album.id, [favBtn, rowFavBtn]));

    const review = document.createElement("div");
    review.className = "qobuz-nr-review";
    review.textContent = "Loading review…";

    detailEl.appendChild(back);
    detailEl.appendChild(head);
    detailEl.appendChild(favBtn);
    detailEl.appendChild(review);
    detailEl.classList.remove("hidden");

    try {
      const params = new URLSearchParams({ title: album.title || "", artist: album.artist || "" });
      const r = await fetch("/api/album/extras?" + params.toString());
      const j = await r.json().catch(() => ({}));
      // Guard against a fast back→open switching the detail to another album.
      if (detailEl.dataset.albumId !== String(album.id)) return;
      const alb = j && j.album;
      const desc = alb && alb.description;
      review.innerHTML = "";
      if (desc) {
        // desc is only ever Qobuz/Wikipedia editorial now — Pitchfork review
        // text is stripped server-side (UK-law compliance).
        const p = document.createElement("div");
        p.className = "qobuz-nr-review-text";
        p.textContent = desc;
        review.appendChild(p);
      } else if (alb && alb.source === "Pitchfork" && alb.url) {
        review.textContent = "Pitchfork reviewed this release — read it on pitchfork.com.";
      } else {
        review.textContent = "No review available for this release.";
      }
      // The source link renders with OR without text — with Pitchfork the
      // link IS the review access, so it must not hide behind if(desc).
      if (alb && alb.url && alb.source) {
        const link = document.createElement("a");
        link.className = "qobuz-nr-review-src";
        link.href = alb.url; link.target = "_blank"; link.rel = "noopener";
        link.textContent = alb.source === "Pitchfork"
          ? "Read the review on Pitchfork"
          : "View on " + alb.source;
        review.appendChild(link);
      }
    } catch (e) {
      if (detailEl.dataset.albumId === String(album.id)) review.textContent = "Couldn't load review.";
    }
  }

  // Single dispatcher: renders whatever view is on top of the stack.
  async function render(view) {
    const seq = ++reqSeq;
    // Any view change invalidates a pending debounced search — without this, a
    // timer set while typing could fire after the user navigated (e.g. into a
    // detail view) and replace what they're looking at with search results.
    clearSearchTimer();
    syncChrome(view);

    if (view.kind === "detail") {
      // Detail takes over the sheet: hide the list chrome but leave its DOM
      // intact so back is instant (see restoreListAfterDetail).
      [searchRowEl, tabsEl, statusEl, artistHeadEl, artistsEl, listEl, loadMoreEl]
        .forEach(el => { if (el) el.classList.add("hidden"); });
      renderDetail(view.album, view.rowFavBtn);
      return;
    }

    // Common chrome for list-type views (tab / search / artist). The list
    // containers are deliberately NOT cleared here: the previous rows stay
    // visible under the "Searching…"/"Loading…" status while the request is in
    // flight, and resetListContainers() swaps them out only once the outcome
    // (results, empty, or error) is known. The full-screen sheet plus this
    // deferred clear is what stops the overlay collapsing/jumping during a
    // search. The reqSeq guard already drops stale responses, so an old view's
    // rows can never be appended into the new view.
    clearDetail();
    if (searchRowEl) searchRowEl.classList.remove("hidden");
    if (tabsEl) tabsEl.classList.remove("hidden");
    if (statusEl) statusEl.classList.remove("hidden");
    if (listEl) listEl.classList.remove("hidden");
    // Chrome that ACTS on the outgoing view must not stay live while the
    // replacement view's request is in flight: the artist header's ‹ Back
    // would pop a level below the view just selected, and Load more would
    // page a list that's about to be replaced. Rows and artist chips stay —
    // taps on them push views that self-heal (see restoreListAfterDetail).
    if (artistHeadEl) artistHeadEl.classList.add("hidden");
    if (loadMoreEl) loadMoreEl.classList.add("hidden");

    try {
      // Tab endpoints come from cfg.tabs: the "new-releases" kind has its own
      // endpoint + status wording; every other tab is a /featured?type=<id>.
      const tabDef = view.kind === "tab" ? cfg.tabs.find(t => t.id === view.tab) : null;
      if (view.kind === "tab" && tabDef && tabDef.kind === "new-releases") {
        if (statusEl) statusEl.textContent = "Loading new releases…";
        const j = await qFetch(cfg.apiBase + "/new-releases?days=30");
        if (seq !== reqSeq) return; // a newer view/request superseded this one
        resetListContainers();
        const albums = j.albums || [];
        view.loaded = true;
        if (statusEl) statusEl.textContent = albums.length
          ? (albums.length + " releases in the last " + (j.days || 30) + " days")
          : ("No new releases found in the last " + (j.days || 30) + " days.");
        appendAlbumRows(albums);
      } else if (view.kind === "tab") {
        if (statusEl) statusEl.textContent = "Loading…";
        const j = await qFetch(cfg.apiBase + "/featured?type=" + encodeURIComponent(view.tab));
        if (seq !== reqSeq) return; // superseded
        resetListContainers();
        const albums = j.albums || [];
        view.loaded = true;
        if (statusEl) statusEl.textContent = albums.length
          ? (albums.length + " albums")
          : "No albums found.";
        appendAlbumRows(albums);
      } else if (view.kind === "search") {
        if (statusEl) statusEl.textContent = "Searching…";
        const j = await qFetch(cfg.apiBase + "/search?q=" + encodeURIComponent(view.query) + "&offset=0");
        if (seq !== reqSeq) return; // superseded (e.g. user kept typing)
        resetListContainers();
        const albums = j.albums || [];
        const artists = j.artists || [];
        view.offset = 0;
        view.hasMore = !!j.has_more;
        view.limit = j.limit || PAGE_SIZE;
        view.loaded = true;
        renderArtistStrip(artists);
        if (statusEl) statusEl.textContent = albums.length
          ? ((j.total || albums.length) + " albums for “" + view.query + "”")
          : (artists.length
              ? ("No album matches for “" + view.query + "” — artists below")
              : ("No results for “" + view.query + "”"));
        appendAlbumRows(albums);
        if (loadMoreEl) loadMoreEl.classList.toggle("hidden", !view.hasMore);
      } else if (view.kind === "artist") {
        if (statusEl) statusEl.textContent = "Loading…";
        const j = await qFetch(cfg.apiBase + "/artist-albums?artist_id=" +
          encodeURIComponent(view.artistId) + "&offset=0");
        if (seq !== reqSeq) return; // superseded
        resetListContainers();
        const albums = j.albums || [];
        view.offset = 0;
        view.hasMore = !!j.has_more;
        view.limit = j.limit || PAGE_SIZE;
        view.loaded = true;
        const artist = j.artist || {};
        renderArtistHead(artist.image || null, artist.name || view.artistName || "");
        // Qobuz's editorial bio (same clamp/expand as the library artist view).
        if (j.biography && artistHeadEl) {
          const bio = document.createElement("div");
          bio.className = "artist-bio-body qobuz-artist-bio";
          const text = document.createElement("div");
          text.className = "bio-text";
          text.dataset.clipped = "true";
          text.textContent = j.biography;
          const foot = document.createElement("div");
          foot.className = "artist-bio-foot";
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "bio-toggle hidden";
          toggle.textContent = "Show more";
          const src = document.createElement("span");
          src.className = "artist-bio-src";
          src.textContent = "Bio: Qobuz";
          foot.appendChild(toggle); foot.appendChild(src);
          bio.appendChild(text); bio.appendChild(foot);
          artistHeadEl.appendChild(bio);
          if (window.__setupBioToggle) window.__setupBioToggle(text, toggle);
        }
        if (statusEl) statusEl.textContent = albums.length
          ? ((j.total || albums.length) + " albums")
          : "No albums found.";
        appendAlbumRows(albums);
        if (loadMoreEl) loadMoreEl.classList.toggle("hidden", !view.hasMore);
      }
    } catch (e) {
      if (seq !== reqSeq) return; // superseded — a newer render owns the status line
      // The failed view owns the content area now — stale rows from the
      // previous view would be misleading under an error message, so clear.
      resetListContainers();
      const notConnected = /not connected/i.test(e.message);
      if (statusEl) statusEl.textContent = notConnected
        ? cfg.notConnectedMsg
        : ("Couldn't load: " + e.message);
    }
  }

  // Append the next page of a paged view (search / artist). offset advances by
  // the server's page limit; the server says whether more pages exist
  // (has_more) — it knows the raw page length, which the client cannot infer
  // once malformed items have been filtered out.
  async function loadMore() {
    const view = currentView();
    if (!view || (view.kind !== "search" && view.kind !== "artist") || !view.hasMore) return;
    if (!loadMoreEl || loadMoreEl.disabled) return;
    const seq = ++reqSeq;
    const nextOffset = (view.offset || 0) + (view.limit || PAGE_SIZE);
    loadMoreEl.disabled = true;
    loadMoreEl.textContent = "Loading…";
    try {
      const url = view.kind === "search"
        ? cfg.apiBase + "/search?q=" + encodeURIComponent(view.query) + "&offset=" + nextOffset
        : cfg.apiBase + "/artist-albums?artist_id=" + encodeURIComponent(view.artistId) + "&offset=" + nextOffset;
      const j = await qFetch(url);
      if (seq !== reqSeq) return; // superseded — the view was replaced meanwhile
      view.offset = nextOffset;
      view.hasMore = !!j.has_more;
      view.limit = j.limit || view.limit || PAGE_SIZE;
      appendAlbumRows(j.albums || []);
      loadMoreEl.classList.toggle("hidden", !view.hasMore);
    } catch (e) {
      if (seq === reqSeq) toast("Couldn't load more: " + e.message, "error");
    } finally {
      loadMoreEl.disabled = false;
      loadMoreEl.textContent = "Load more";
    }
  }
  if (loadMoreEl) loadMoreEl.addEventListener("click", loadMore);

  // Apply the current search box value: ≥2 chars starts/updates a search view;
  // an empty box returns from search to the last active tab. Always REPLACES
  // the top view (search is a sibling of the tabs, not a deeper level).
  function applySearch(q, explicit) {
    if (!overlayVisible() || !viewStack.length) return;
    const top = currentView();
    if (!q) {
      if (top.kind === "search") replaceTop({ kind: "tab", tab: activeTab });
      return;
    }
    if (q.length < 2) {
      // Too short for a useful catalog query. The debounce path just waits for
      // more input, but an explicit Enter deserves feedback, not silence.
      if (explicit && statusEl) statusEl.textContent = "Type at least 2 characters to search.";
      return;
    }
    if (top.kind === "search" && top.query === q) return; // unchanged
    replaceTop({ kind: "search", query: q });
  }

  if (searchInput) {
    // Debounced live search: 450 ms after the last keystroke.
    searchInput.addEventListener("input", () => {
      if (searchClear) searchClear.classList.toggle("hidden", !searchInput.value);
      clearSearchTimer();
      const q = searchInput.value.trim();
      if (!q) { applySearch(""); return; } // clearing reverts immediately
      searchTimer = setTimeout(() => { searchTimer = null; applySearch(q); }, 450);
    });
    // Enter searches immediately (and dismisses the mobile keyboard).
    searchInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      clearSearchTimer();
      applySearch(searchInput.value.trim(), true);
      searchInput.blur();
    });
  }

  if (searchClear) {
    searchClear.addEventListener("click", clearSearch);
  }

  if (tabsEl) {
    tabsEl.querySelectorAll(".qobuz-tab").forEach(t => t.addEventListener("click", () => {
      const tab = t.dataset.qtab;
      if (!tab || !viewStack.length) return;
      activeTab = tab;
      resetSearchBox();
      const top = currentView();
      if (top.kind === "tab" && top.tab === tab) { updateTabActive(); return; }
      replaceTop({ kind: "tab", tab });
    }));
  }

  btn.addEventListener("click", () => {
    if (overlayVisible()) return;
    activeTab = defaultTab;
    resetSearchBox();
    viewStack = [{ kind: "tab", tab: defaultTab }];
    history.pushState({ [cfg.historyKey]: 1 }, ""); // a back press from the root view closes the overlay
    overlay.classList.remove("hidden");
    render(currentView());
  });
}

initServiceBrowser({
  service:     "qobuz",
  serviceName: "Qobuz",
  idPrefix:    "qobuz",
  apiBase:     "/api/qobuz",
  historyKey:  "qz", // pre-factory key — kept so existing Qobuz history entries behave identically
  closeAttr:   "data-qobuz-close",
  notConnectedMsg: "Connect your Qobuz account in Settings to browse Qobuz.",
  tabs: [
    { id: "new-releases",  label: "New Releases",  kind: "new-releases" },
    { id: "best-sellers",  label: "Best Sellers",  kind: "featured" },
    { id: "most-streamed", label: "Most Streamed", kind: "featured" },
    { id: "press-awards",  label: "Press Awards",  kind: "featured" },
    { id: "editor-picks",  label: "Editor's Picks", kind: "featured" }
  ]
});

/* ------------------------------------------------------------------ */
/*  Pitchfork magazine — full-page overlay (side menu → Pitchfork)     */
/*                                                                     */
/*  A self-contained module (does NOT reuse initServiceBrowser, so it  */
/*  can't regress Qobuz/Tidal). It mirrors that factory's proven       */
/*  history-aware back mechanics — every close/back goes through       */
/*  history.back(), and a popstate handler reconciles the view stack   */
/*  against history.state[HKEY] — so the Android/browser back button   */
/*  behaves naturally. Two views deep: a magazine list (tab) → a       */
/*  review detail. Handler no-ops while the overlay is closed, so the  */
/*  rest of the app is unaffected.                                     */
/* ------------------------------------------------------------------ */
(function initPitchfork() {
  const overlay  = document.getElementById("pitchfork-overlay");
  const trigger  = document.getElementById("pitchfork-toggle");
  const tabsEl   = document.getElementById("pitchfork-tabs");
  const statusEl = document.getElementById("pitchfork-status");
  const listEl   = document.getElementById("pitchfork-list");
  const detailEl = document.getElementById("pitchfork-detail");
  if (!overlay || !trigger || !listEl || !detailEl) return;

  const HKEY = "pf";
  let viewStack = [];          // [{kind:'tab',tab}] then optionally {kind:'detail',item}
  let reqSeq = 0;              // monotonic guard so a late fetch can't repaint a newer view
  let activeTab = "latest";
  const listCache = { latest: null, best: null };  // per-tab items, cached for the session

  const visible     = () => !overlay.classList.contains("hidden");
  const currentView = () => viewStack[viewStack.length - 1];
  const setStatus   = (m) => { if (statusEl) statusEl.textContent = m || ""; };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g,
      c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtScore(n) { return Number(n).toFixed(1); }   // toFixed already rounds to 1 dp

  function hideOverlay() {
    overlay.classList.add("hidden");
    viewStack = [];
    reqSeq++;                 // orphan any in-flight fetch
    listEl.innerHTML = "";
    detailEl.classList.add("hidden");
    detailEl.innerHTML = "";
    if (tabsEl) tabsEl.classList.remove("hidden");
    setStatus("");
  }

  const goBack = () => history.back();
  overlay.querySelectorAll("[data-pitchfork-close]").forEach(el => el.addEventListener("click", goBack));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && visible()) goBack();
  });

  window.addEventListener("popstate", (e) => {
    if (!visible()) return;
    const depth = (e.state && Number.isFinite(e.state[HKEY])) ? e.state[HKEY] : 0;
    if (depth >= viewStack.length) {
      if (depth > viewStack.length) history.go(viewStack.length - depth);
      return;
    }
    const popped = currentView();
    viewStack.length = depth;
    if (!viewStack.length) { hideOverlay(); return; }
    // Leaving the detail: the list underneath is still in the DOM (detail only
    // hid it), so just restore it — no refetch. Exception: a detail opened as a
    // DEEP LINK (global search result) never rendered its list, so the grid is
    // empty — render it now instead of unhiding a blank page.
    if (popped && popped.kind === "detail") {
      reqSeq++;                          // orphan the detail's in-flight fetch, if any
      detailEl.classList.add("hidden");
      detailEl.innerHTML = "";
      if (!listEl.children.length) { render(currentView()); return; }
      listEl.classList.remove("hidden");
      if (tabsEl) tabsEl.classList.remove("hidden");   // tabs return with the list
      updateTabActive();
      return;
    }
    render(currentView());
  });

  function pushView(view) {
    viewStack.push(view);
    history.pushState({ [HKEY]: viewStack.length }, "");
    render(view);
  }

  // Leave the overlay entirely (unwinding its history entries) and then run a
  // follow-up — used by the detail's "open in library" / "find on <service>"
  // actions. history.go(-n) fires a single popstate that the handler above
  // turns into hideOverlay(). The follow-up must run only AFTER that close has
  // actually happened, otherwise a follow-up that opens ANOTHER history-managed
  // overlay (Qobuz/Tidal) would race the pending unwind and get torn down by
  // the stray popstate. A bare setTimeout doesn't guarantee that ordering
  // (flaky on iOS Safari), so we run fn from a one-shot popstate listener once
  // the overlay is confirmed hidden.
  function closeAndThen(fn) {
    const n = viewStack.length;
    if (!visible() || n <= 0) { hideOverlay(); fn(); return; }
    const once = () => {
      if (visible()) return;                       // not fully closed yet — wait for the next
      window.removeEventListener("popstate", once);
      fn();
    };
    window.addEventListener("popstate", once);
    history.go(-n);
  }

  function updateTabActive() {
    if (!tabsEl) return;
    const top = currentView();
    const tab = top && top.kind === "tab" ? top.tab : activeTab;
    tabsEl.querySelectorAll(".qobuz-tab").forEach(t =>
      t.classList.toggle("is-active", t.dataset.pftab === tab));
  }

  if (tabsEl) {
    tabsEl.querySelectorAll(".qobuz-tab").forEach(t => t.addEventListener("click", () => {
      const tab = t.dataset.pftab;
      if (!tab || !viewStack.length) return;
      activeTab = tab;
      const top = currentView();
      if (top.kind === "tab" && top.tab === tab) { updateTabActive(); return; }
      // Replace the top view (tab siblings never push history, keeping the
      // viewStack ↔ history 1:1 invariant).
      viewStack[viewStack.length - 1] = { kind: "tab", tab };
      render(currentView());
    }));
  }

  trigger.addEventListener("click", () => {
    if (visible()) return;
    activeTab = "latest";
    viewStack = [{ kind: "tab", tab: "latest" }];
    history.pushState({ [HKEY]: 1 }, "");   // a back press from the root closes the overlay
    overlay.classList.remove("hidden");
    render(currentView());
  });

  // Deep link from the global search: open the overlay straight to one review's
  // detail. Seeds the root list frame WITHOUT rendering it (rendering would be
  // orphaned by the detail's reqSeq bump anyway); the popstate leaving-detail
  // branch self-heals the empty list by rendering it on Back.
  window.__openPitchforkReview = (item) => {
    if (!item || !item.url) return;
    if (!visible()) {
      activeTab = "latest";
      viewStack = [{ kind: "tab", tab: "latest" }];
      history.pushState({ [HKEY]: 1 }, "");
      overlay.classList.remove("hidden");
    }
    pushView({ kind: "detail", item });
  };

  function render(view) {
    if (!view) return;
    if (view.kind === "detail") renderDetail(view.item);
    else renderList(view.tab);
  }

  async function renderList(tab) {
    const mySeq = ++reqSeq;
    detailEl.classList.add("hidden");
    detailEl.innerHTML = "";
    listEl.classList.remove("hidden");
    if (tabsEl) tabsEl.classList.remove("hidden");
    updateTabActive();
    if (listCache[tab]) { paintList(listCache[tab]); return; }
    listEl.innerHTML = "";
    setStatus("Loading…");
    let data;
    try {
      const r = await fetch("/api/pitchfork/reviews?type=" + encodeURIComponent(tab));
      if (mySeq !== reqSeq) return;
      data = await r.json();
      if (!r.ok) throw new Error(data.error || ("HTTP " + r.status));
    } catch (e) {
      if (mySeq !== reqSeq) return;
      setStatus("");
      listEl.innerHTML = '<div class="pf-empty">Couldn’t load Pitchfork right now. Try again in a little while.</div>';
      return;
    }
    if (mySeq !== reqSeq) return;
    const items = data.items || [];
    // Session-cache only a NON-EMPTY success (mirrors the backend's rule):
    // an empty response is a parse miss upstream — retry it next visit rather
    // than pinning "No reviews" for the whole session.
    if (items.length) listCache[tab] = items;
    paintList(items);
  }

  function paintList(items) {
    setStatus("");
    listEl.innerHTML = "";
    if (!items.length) {
      listEl.innerHTML = '<div class="pf-empty">No reviews to show right now.</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    for (const it of items) frag.appendChild(buildCard(it));
    listEl.appendChild(frag);
  }

  function buildCard(it) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "pf-card";

    const art = document.createElement("div");
    art.className = "pf-card-art";
    if (it.cover) {
      const img = document.createElement("img");
      img.loading = "lazy"; img.alt = ""; img.src = it.cover;
      img.addEventListener("error", () => { art.classList.add("pf-art-fallback"); img.remove(); });
      art.appendChild(img);
    } else {
      art.classList.add("pf-art-fallback");
    }
    if (it.score != null) {
      const s = document.createElement("span");
      s.className = "pf-score" + (it.isBestNewMusic ? " pf-score-bnm" : "");
      s.textContent = fmtScore(it.score);
      art.appendChild(s);
    }
    if (it.isBestNewMusic) {
      const b = document.createElement("span");
      b.className = "pf-bnm";
      b.textContent = "BNM";
      art.appendChild(b);
    }
    // Album/artist overlaid on the bottom of the cover so tiles stay square and
    // pack cleanly in the woven mosaic (no below-tile text breaking the grid).
    const meta = document.createElement("div");
    meta.className = "pf-card-meta";
    const al = document.createElement("div"); al.className = "pf-card-album";  al.textContent = it.album || "";
    const ar = document.createElement("div"); ar.className = "pf-card-artist"; ar.textContent = it.artist || "";
    meta.appendChild(al);
    meta.appendChild(ar);
    art.appendChild(meta);
    card.appendChild(art);

    card.addEventListener("click", () => pushView({ kind: "detail", item: it }));
    return card;
  }

  async function renderDetail(it) {
    const mySeq = ++reqSeq;
    listEl.classList.add("hidden");
    // Hide the tab chips while reading a review — switching tabs from within a
    // detail would leave a phantom stack entry (back would land on the wrong
    // list). You return to the list (tabs reappear) via Back first.
    if (tabsEl) tabsEl.classList.add("hidden");
    detailEl.classList.remove("hidden");
    detailEl.scrollTop = 0;
    detailEl.innerHTML =
      '<button class="pf-back" type="button">‹ Back</button>' +
      '<div class="pf-detail-head">' +
        (it.cover ? '<img class="pf-detail-art" src="' + esc(it.cover) + '" alt="">'
                  : '<div class="pf-detail-art pf-art-fallback"></div>') +
        '<div class="pf-detail-headmeta">' +
          '<div class="pf-detail-album">' + esc(it.album) + '</div>' +
          '<div class="pf-detail-artist">' + esc(it.artist) + '</div>' +
          '<div class="pf-detail-scorerow">' +
            (it.score != null ? '<span class="pf-score' + (it.isBestNewMusic ? ' pf-score-bnm' : '') + '">' + fmtScore(it.score) + '</span>' : '') +
            (it.isBestNewMusic ? '<span class="pf-bnm">Best New Music</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="pf-detail-body"><div class="pf-loading">Loading review…</div></div>' +
      '<div class="pf-detail-actions"></div>';
    detailEl.querySelector(".pf-back").addEventListener("click", goBack);
    // Match the card behaviour: a dead cover URL falls back to the ♪ tile
    // instead of the browser's broken-image glyph. (::after doesn't render on a
    // replaced <img>, so swap in a div that does.)
    const headImg = detailEl.querySelector("img.pf-detail-art");
    if (headImg) headImg.addEventListener("error", () => {
      const ph = document.createElement("div");
      ph.className = "pf-detail-art pf-art-fallback";
      headImg.replaceWith(ph);
    });
    const bodyEl = detailEl.querySelector(".pf-detail-body");
    const actEl  = detailEl.querySelector(".pf-detail-actions");

    // COMPLIANCE (UK law): the written review is never displayed in-app.
    // Paint the note and the actions (led by "Read on Pitchfork") IMMEDIATELY
    // — nothing they need is remote. The only async piece is the library
    // match, fetched after, which just upgrades the actions with an
    // "Open in your library" button when it lands.
    bodyEl.innerHTML =
      '<p class="pf-detail-note">The written review can’t be shown here — ' +
      'tap <strong>Read on Pitchfork</strong> to read it on pitchfork.com.</p>';
    buildActions(actEl, it, null);

    try {
      const qs = "?url=" + encodeURIComponent(it.url) +
                 "&album="  + encodeURIComponent(it.album  || "") +
                 "&artist=" + encodeURIComponent(it.artist || "");
      const r = await fetch("/api/pitchfork/review" + qs);
      if (mySeq !== reqSeq) return;
      const data = await r.json();
      if (r.ok && data.match) buildActions(actEl, it, data.match);
    } catch (e) { /* library match is optional — the actions already shown work */ }
  }

  function buildActions(container, it, match) {
    container.innerHTML = "";

    // Reading happens on pitchfork.com now — make that the first action.
    const link = document.createElement("a");
    link.className = "pf-action pf-action-link";
    link.href = it.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Read on Pitchfork ↗";
    container.appendChild(link);

    // Owned? → open the existing album modal (play/queue live there).
    if (match) {
      const play = document.createElement("button");
      play.type = "button";
      play.className = "pf-action pf-action-primary";
      play.textContent = "▶ Open in your library";
      play.addEventListener("click", () => {
        closeAndThen(() => {
          if (window.__openAlbum) window.__openAlbum(match, { source: "pitchfork", filter: null });
        });
      });
      container.appendChild(play);
    }

    // Not-owned path: hop to the streaming browsers, pre-seeding their search.
    const query = ((it.artist || "") + " " + (it.album || "")).trim();
    const qBtn = document.getElementById("qobuz-toggle");
    if (qBtn) container.appendChild(makeFindBtn("Find on Qobuz", qBtn, "qobuz-search-input", query));
  }

  function makeFindBtn(label, toggleBtn, searchInputId, query) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pf-action";
    b.textContent = label;
    b.addEventListener("click", () => {
      closeAndThen(() => {
        toggleBtn.click();                       // open that service's overlay
        const input = document.getElementById(searchInputId);
        if (input && query) {
          input.value = query;
          input.dispatchEvent(new Event("input", { bubbles: true }));   // its debounced search listens on 'input'
        }
      });
    });
    return b;
  }
})();

/* ------------------------------------------------------------------ */
/*  Check for updates button in settings                               */
/* ------------------------------------------------------------------ */
(function initCheckUpdate() {
  const btn      = document.getElementById("check-update-btn");
  const notesDiv = document.getElementById("settings-release-notes");
  if (!btn) return;
  // After a check finds an update, the button itself becomes the install
  // action (the old copy said "tap Update below", but the update banner sits
  // BEHIND the Settings sheet — there was no visible button to tap).
  let pendingUpdate = false;
  const appUpd = window.__musicdAppUpd;
  // "0.3.20" newer than "0.3.19", part by part; a pre-release before its
  // release, and RC2 before RC10 (0.6.0-RC1 < 0.6.0-RC2 < 0.6.0).
  const verNewer = (x, y) => {
    const parse = v => {
      const s = String(v).trim().replace(/^v/i, "");
      const i = s.indexOf("-");
      return { core: (i < 0 ? s : s.slice(0, i)).split(".").map(n => parseInt(n, 10) || 0), pre: i < 0 ? null : s.slice(i + 1).toLowerCase() };
    };
    const a = parse(x), b = parse(y);
    for (let i = 0; i < Math.max(a.core.length, b.core.length); i++) {
      if ((a.core[i] || 0) !== (b.core[i] || 0)) return (a.core[i] || 0) > (b.core[i] || 0);
    }
    if (!a.pre || !b.pre) return !a.pre && !!b.pre;
    const pa = a.pre.match(/\d+|\D+/g) || [], pb = b.pre.match(/\d+|\D+/g) || [];
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if (pa[i] === undefined || pb[i] === undefined) return pb[i] === undefined && pa[i] !== undefined;
      const na = /^\d+$/.test(pa[i]) && /^\d+$/.test(pb[i]);
      if (pa[i] !== pb[i]) return na ? Number(pa[i]) > Number(pb[i]) : pa[i] > pb[i];
    }
    return false;
  };
  let pendingWhat = null;          // { server, app } in the Android app

  btn.addEventListener("click", async () => {
    if (btn.disabled) return;

    if (pendingUpdate) {
      // Second tap: install. Close Settings so the update banner (which owns
      // the download/unpack/restart progress UI) is visible, then hand off.
      pendingUpdate = false;
      btn.classList.remove("is-update-ready");
      const closer = document.querySelector("#settings-overlay [data-settings-close]");
      if (closer) closer.click();
      if (window.__applyUpdateNow) window.__applyUpdateNow(pendingWhat);
      // The banner owns all progress/error/retry state from here — reset this
      // button so a reopened Settings offers a fresh check (on success the
      // page reloads anyway; on failure the banner shows the retry, and a
      // disabled "Updating…" here would strand with no reset path).
      btn.textContent = "Check for updates";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Checking…";
    if (notesDiv) notesDiv.classList.add("hidden");
    try {
      // In the Android app, the app looks for its own update at the same time.
      const appLook = appUpd ? appUpd.look(true) : Promise.resolve(null);
      await fetch("/api/update/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const r = await fetch("/api/update/status", { cache: "no-store" });
      const s = await r.json();
      const a = await appLook;
      const server = !!(s && s.available && s.latest);
      const app = !!(a && a.available && a.latest);
      if (server || app) {
        pendingUpdate = true;
        pendingWhat = { server, app };
        btn.disabled = false;
        btn.classList.add("is-update-ready");
        btn.textContent = server && app
          ? (s.latest === a.latest ? "Update server and app to v" + s.latest : "Update server and app")
          : app ? "Update app to v" + a.latest
          : s.isDowngrade ? "Roll back to v" + s.latest
          : "Update to v" + s.latest;
        if (notesDiv && server && s.notes) {
          notesDiv.textContent = s.notes;
          notesDiv.classList.remove("hidden");
        }
      } else if (a && s && s.current && a.current && verNewer(s.current, a.current)) {
        // The server is ahead of the app, and GitHub doesn't have the app yet:
        // it's built after the server's release, a few minutes later.
        btn.textContent = "App v" + s.current + " is on its way — try again in a few minutes";
        setTimeout(() => { btn.disabled = false; btn.textContent = "Check for updates"; }, 6000);
      } else {
        btn.textContent = a
          ? "Up to date (server v" + (s && s.current || "?") + ", app v" + (a.current || "?") + ")"
          : "Up to date (v" + (s && s.current || "?") + ")";
        setTimeout(() => { btn.disabled = false; btn.textContent = "Check for updates"; }, 4000);
      }
    } catch (e) {
      btn.textContent = "Check failed";
      setTimeout(() => { btn.disabled = false; btn.textContent = "Check for updates"; }, 3000);
    }
  });
})();

/* ------------------------------------------------------------------ */
/*  Play Unheard — topbar compass button with 2-second spin           */
/* ------------------------------------------------------------------ */
(function initPlayUnheard() {
  const btn        = document.getElementById("play-unheard-topbar");
  const zoneSelect = document.getElementById("zone-select");
  if (!btn) return;

  // `spinEl` is whichever control the user actually pressed — the top-bar
  // compass or the Home tile. Forwarding a click from one to the other would
  // have left the pressed control inert for the two seconds it takes.
  async function playUnheard(spinEl) {
    const el = spinEl || btn;
    const zone = zoneSelect && zoneSelect.value;
    if (!zone) { if (window.__showToast) window.__showToast("Select a zone first"); return; }
    if (el.classList.contains("spinning")) return;

    // Spin the compass for 2 seconds, then fetch. The Random Album disc speeds
    // up from where it is (v0.6.1) rather than jumping to another angle — the
    // same animation, run faster, and (v0.6.10) turning again if it had stopped.
    el.classList.add("spinning");
    const disc = el.querySelector && el.querySelector(".unheard-disc");
    discTurns(disc, Infinity);
    rampDisc(disc, 7.5);   // 6s a turn becomes 0.8s, as it was
    await new Promise(r => setTimeout(r, 2000));

    try {
      const r = await fetch("/api/play-unheard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone_or_output_id: zone })
      });
      const j = await r.json();
      if (!r.ok) {
        if (window.__showToast) window.__showToast(j.error || "Could not start playback", "error");
      } else {
        // The server answers with the album itself (its title, its artist).
        const al = j.album;
        const name = al && typeof al === "object" ? [al.title, al.subtitle].filter(Boolean).join(" — ") : al;
        if (window.__showToast) window.__showToast("Playing: " + (name || "an album you haven’t heard"));
      }
    } catch (e) {
      if (window.__showToast) window.__showToast("Request failed", "error");
    } finally {
      el.classList.remove("spinning");
      rampDisc(disc, 1);
      // Then still again at the end of the turn it is on: back where it began.
      discTurns(disc, 0);
    }
  }

  // The disc's turns: Infinity to keep it going (and start it if it had
  // stopped), 0 to stop at the end of the current turn. The animation stays
  // the same one throughout, so the angle never jumps.
  function discTurns(disc, n) {
    if (!disc || typeof disc.getAnimations !== "function") return;
    const anim = disc.getAnimations()[0];
    if (!anim || !anim.effect) return;   // reduced motion: no animation
    if (n === Infinity) {
      anim.effect.updateTiming({ iterations: Infinity });
      if (anim.playState !== "running") anim.play();
    } else {
      const turn = anim.effect.getTiming().duration || 6000;
      anim.effect.updateTiming({ iterations: Math.floor((Number(anim.currentTime) || 0) / turn) + 1 });
    }
  }

  // Eases the disc's own animation to `rate` times its speed over 0.6s.
  function rampDisc(disc, rate) {
    if (!disc || typeof disc.getAnimations !== "function") return;
    const anim = disc.getAnimations()[0];
    if (!anim) return;   // reduced motion: no animation to speed up
    clearTimeout(disc.__rampTimer);
    const from = anim.playbackRate || 1;
    const t0 = Date.now();
    // Timed steps (~60 a second) rather than requestAnimationFrame: the same
    // smoothness on screen, and a ramp that still finishes if no frame is
    // drawn meanwhile (a backgrounded tab), so the disc never stays fast.
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / 600);
      // Set directly: like updatePlaybackRate() it keeps the current angle,
      // and it is in effect at once rather than at the animation's next
      // "ready", which a ramp of quick steps would outrun.
      anim.playbackRate = from + (rate - from) * (1 - Math.pow(1 - k, 3));
      if (k < 1) disc.__rampTimer = setTimeout(step, 16);
    };
    step();
  }
  btn.addEventListener("click", () => playUnheard(btn));
  window.__playUnheard = playUnheard;
})();

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

    try {
      const r = await fetch("/api/artist-albums?artist=" + encodeURIComponent(artistName));
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      const total = j.primary.length + j.featured.length;

      if (artistViewActive) setTitle(total + " album" + (total !== 1 ? "s" : "") + " · " + artistName);

      if (!total) {
        grid.innerHTML = `<div class="artist-view-empty">No albums found for "${artistName}"</div>`;
        return;
      }

      const frag = document.createDocumentFragment();

      if (j.primary.length) {
        if (j.featured.length) {
          const hdr = document.createElement("div");
          hdr.className = "artist-section-header";
          hdr.textContent = "Albums";
          frag.appendChild(hdr);
        }
        for (const a of j.primary) {
          frag.appendChild(window.__buildAlbumTile(a));
        }
      }

      if (j.featured.length) {
        const hdr = document.createElement("div");
        hdr.className = "artist-section-header";
        hdr.textContent = "Also appears on";
        frag.appendChild(hdr);
        for (const a of j.featured) {
          frag.appendChild(window.__buildAlbumTile(a));
        }
      }

      grid.appendChild(frag);

      // Artist header (avatar + validated bio) loads after the albums so the
      // grid is never blocked on external services. One of the artist's own
      // album titles pins their identity for the lookup (see /api/artist-bio).
      const bioAlbum = (j.primary[0] && j.primary[0].title) ||
                       (j.featured[0] && j.featured[0].title) || "";
      renderArtistBioHead(artistName, bioAlbum);
    } catch (e) {
      if (countBar) {
        countBar.classList.remove("hidden");
        countBar.innerHTML = `
            <span class="count-text" style="color:var(--danger)">Error: ${e.message}</span>`;
        }
    }
  }

  // Build the LMS-style artist header: round avatar, bio with Show more,
  // "Bio: <source>" attribution. Decorative — any failure leaves the plain
  // album grid, and a view/artist switch mid-fetch renders nothing stale.
  let bioSeq = 0;
  async function renderArtistBioHead(artistName, albumTitle) {
    const seq = bioSeq;   // generation is bumped by showArtistAlbums/exitArtistView, not here
    try {
      const r = await fetch("/api/artist-bio?artist=" + encodeURIComponent(artistName) +
                            "&album=" + encodeURIComponent(albumTitle || ""));
      if (!r.ok) return;
      const j = await r.json();
      const b = j.bio;
      if (!b || !b.text) return;
      if (seq !== bioSeq || !artistViewActive) return;   // superseded / view closed

      // LMS-remote layout: large centred round portrait on top, bio beneath
      // it full-width, then a centred Show more and a centred "Bio: <source>"
      // caption — not a thumbnail beside the text.
      const head = document.createElement("div");
      head.className = "artist-bio-head";
      if (b.image) {
        const img = document.createElement("img");
        img.className = "artist-bio-avatar";
        img.alt = "";
        img.onerror = () => img.remove();   // dead portrait URL — no broken-image circle
        img.src = b.image;
        head.appendChild(img);
      }
      const body = document.createElement("div");
      body.className = "artist-bio-body";
      const text = document.createElement("div");
      text.className = "bio-text";
      text.dataset.clipped = "true";
      text.textContent = b.text;
      const foot = document.createElement("div");
      foot.className = "artist-bio-foot";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "bio-toggle hidden";
      toggle.textContent = "Show more";
      const src = document.createElement("span");
      src.className = "artist-bio-src";
      src.textContent = b.source ? "Bio: " + b.source : "";
      foot.appendChild(toggle); foot.appendChild(src);
      body.appendChild(text); body.appendChild(foot);
      head.appendChild(body);
      grid.prepend(head);
      if (window.__setupBioToggle) window.__setupBioToggle(text, toggle);
    } catch (e) { /* bio is decorative — the album grid stands alone */ }
  }

  window.__showArtistAlbums = showArtistAlbums;
  window.__exitArtistView   = exitArtistView;
  window.__artistViewActive = () => artistViewActive;
})();

/* ------------------------------------------------------------------ */
/*  Side menu (hamburger drawer)                                        */
/*  Items with data-target trigger the hidden top-bar button of that   */
/*  id; data-action items switch the main view (home / random wall).   */
/* ------------------------------------------------------------------ */
(function initMenuDrawer() {
  const overlay = document.getElementById("menu-overlay");
  const toggle  = document.getElementById("menu-toggle");
  if (!overlay || !toggle) return;

  // Manual library rescan: rebuilds the album snapshot, but the server refuses
  // (status "importing") while Roon is still adding albums, so a deliberate
  // press never fights an active import.
  // What a finished scan found, as the toast says it. The server's own
  // words ("updated"/"unchanged") are read the same as the page's.
  function scanDoneText(j) {
    const albums = j.count != null ? j.count : j.albums;
    const added = Number(j.added) || 0;
    if (j.status === "fresh" || j.status === "unchanged") return "Library already up to date" + (albums ? " — " + albums + " albums" : "");
    return "Library rescanned — " + (albums || 0) + " albums" + (added ? " (" + added + " new " + (added === 1 ? "track" : "tracks") + ")" : "");
  }

  // A scan still going when the server answered: wait for it here, then say
  // how it ended — rather than leave "scanning in the background" as the last word.
  async function waitForScan() {
    const toast = window.__showToast || (() => {});
    const until = Date.now() + 60 * 60 * 1000;
    while (Date.now() < until) {
      await new Promise(r => setTimeout(r, 2500));
      let s = null;
      try { s = await (await fetch("/api/status", { cache: "no-store" })).json(); } catch (e) { continue; }
      const scan = s && s.scan;
      if (!scan || scan.running) continue;
      const last = scan.last || {};
      if (last.status === "no-music") toast("The music folder isn't there — check the /music mount", "error");
      else toast(scanDoneText(Object.assign({ count: s.index_count }, last)));
      refreshRescanSub();
      return;
    }
  }

  async function rescanLibrary() {
    const toast = window.__showToast || (() => {});
    toast("Scanning your music folder…");
    try {
      const r = await fetch("/api/library/rescan", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      const st = j.status;
      const done = ["rebuilt", "updated", "fresh", "unchanged"].includes(st);
      const going = ["scanning", "running", "busy"].includes(st);
      const msg =
        done                     ? scanDoneText(j) :
        st === "scanning"        ? "Scanning in the background — new albums appear as it goes" :
        st === "running" || st === "busy" ? "A scan is already running — you'll hear when it's done" :
        st === "no-music"        ? "The music folder isn't there — check the /music mount" :
                                   (j.error || "Rescan failed");
      toast(msg, done || going ? undefined : "error");
      refreshRescanSub();   // the row's sub-line is now stale whatever happened
      if (going) waitForScan();
    } catch (e) {
      toast("Rescan failed", "error");
    }
  }

  // Roon's all-zone actions. They live in the zone picker — the sheet that is
  // already about "which zones", which is what these act on — and the popover
  // is closed by the time they run, so a toast is the only feedback channel.
  // Mute and unmute are separate rows rather than one toggle: the popover is
  // shut when the state changes, so a single "Mute all" would be wrong half
  // the time.
  async function allZones(url, body, pending, okMsg, failMsg) {
    const toast = window.__showToast || (() => {});
    toast(pending);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return toast(j.error || failMsg, "error");
      toast(okMsg);
    } catch (e) {
      toast(failMsg, "error");
    }
  }

  // Exposed for the two zone pickers (now-playing and mini-transport), which
  // are built in different closures. One implementation, three named actions,
  // so the two pickers cannot drift apart on wording or endpoint.
  window.__allZoneActions = {
    "pause-all":  () => allZones("/api/pause-all", null, "Pausing every zone…",
                                 "All zones paused", "Could not pause all zones"),
    "mute-all":   () => allZones("/api/mute-all", { how: "mute" }, "Muting every zone…",
                                 "All zones muted", "Could not mute all zones"),
    "unmute-all": () => allZones("/api/mute-all", { how: "unmute" }, "Unmuting every zone…",
                                 "All zones unmuted", "Could not unmute all zones"),
  };

  // What the snapshot is right now, under the Rescan row. Every phrase here is
  // deliberately PAST tense or explicitly a schedule, because none of it can be
  // a claim about this instant: `library_importing` is set at the last check
  // and cleared at the next clean one, and Roon publishes no import-finished
  // event to make it live. Saying "Roon is importing" would be a confident lie
  // dressed up as a status line.
  function libraryAgeText(ms) {
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 2)    return "just now";
    if (mins < 60)   return mins + " min ago";
    const hrs = Math.round(mins / 60);
    if (hrs < 48)    return hrs + (hrs === 1 ? " hour ago" : " hours ago");
    return Math.round(hrs / 24) + " days ago";
  }
  async function refreshRescanSub() {
    const el = document.getElementById("rescan-sub");
    if (!el) return;
    try {
      const r = await fetch("/api/status");
      const j = await r.json();
      if (!j.paired) { el.textContent = "Server not ready"; return; }
      const albums = (j.index_count || 0).toLocaleString() + " albums";
      if (j.library_importing) {
        el.textContent = albums + " · scanning the music folder now";
      } else if (j.library_recheck_pending) {
        el.textContent = albums + " · the library moved, checking again shortly";
      } else if (j.index_built_at) {
        el.textContent = albums + " · checked " + libraryAgeText(j.index_built_at);
      } else {
        el.textContent = "No snapshot yet";
      }
    } catch (e) {
      // The drawer must open regardless. An empty sub-line reads as "no
      // information", which is exactly what a failed status call means.
      el.textContent = "";
    }
  }

  // Offline mode (v0.5.58): only in the app, which keeps the setting.
  function offlineModeOn() {
    try { return !!JSON.parse(window.MusicdDownloads.settings()).offlineMode; } catch (e) { return false; }
  }
  function paintOfflineItem() {
    const item = document.getElementById("menu-item-offline");
    if (!item) return;
    let has = false;
    try { has = "offlineMode" in JSON.parse(window.MusicdDownloads.settings()); } catch (e) {}
    item.classList.toggle("hidden", !has);
    if (!has) return;
    const on = offlineModeOn();
    item.classList.toggle("is-on", on);
    item.setAttribute("aria-checked", String(on));
    const sub = document.getElementById("offline-sub");
    if (sub) sub.textContent = on ? "On · only the music on this phone" : "Off";
  }
  paintOfflineItem();

  const openMenu  = () => { overlay.classList.remove("hidden"); refreshRescanSub(); paintOfflineItem(); };
  const closeMenu = () => overlay.classList.add("hidden");

  toggle.addEventListener("click", openMenu);
  overlay.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("[data-menu-close]")) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeMenu();
  });

  overlay.querySelectorAll(".menu-item").forEach((item) => {
    item.addEventListener("click", () => {
      const action = item.dataset.action;
      const target = item.dataset.target;
      closeMenu();

      if (action === "offline-mode") {
        // The app reloads the page onto the phone's music, or back onto the server.
        try { window.MusicdDownloads.set("offlineMode", String(!offlineModeOn())); } catch (e) {}
        return;
      }
      if (action === "home") {
        if (window.__showHome) window.__showHome();
        return;
      }
      if (action === "later") {
        if (window.__showListenLater) window.__showListenLater();
        return;
      }
      if (action === "shuffle") {
        // Clear any active filter/labels so "Random albums" is a fresh wall.
        // applyFilter(null) reveals the wall and loads it.
        if (window.__applyFilter) window.__applyFilter(null);
        else if (window.__loadRandom) window.__loadRandom();
        return;
      }
      if (action === "rescan-library") {
        rescanLibrary();
        return;
      }
      if (action === "smart-picks") {
        if (window.__showSmartPicks) window.__showSmartPicks();
        return;
      }
      if (action === "discover") {
        if (window.__showDiscover) window.__showDiscover();
        return;
      }
      if (action === "smart-playlists") {
        if (window.__showSmartPlaylists) window.__showSmartPlaylists();
        return;
      }
      if (action === "playlists") {
        if (window.__showPlaylists) window.__showPlaylists();
        return;
      }
      if (action === "import-playlist") {
        if (window.__openImportSheet) window.__openImportSheet();
        return;
      }

      // Everything else just triggers the original control; each one manages
      // its own view — Filter/Labels reveal the wall when they render, Qobuz/
      // Tidal/Settings open an overlay over Home, Play-unheard just plays.
      if (target) {
        const btn = document.getElementById(target);
        if (btn) btn.click();
      }
    });
  });
})();

/* ------------------------------------------------------------------ */
/*  MusicD Server: say why the screen is empty                        */
/*  A fresh install with no music found, or no Sonos rooms found,     */
/*  otherwise just looks blank. This names the cause and the fix,     */
/*  and goes away once there are albums and rooms.                    */
/* ------------------------------------------------------------------ */
(function serverNotice() {
  const main = document.querySelector("main");
  if (!main) return;
  const el = document.createElement("div");
  el.className = "status-banner server-notice hidden";
  el.id = "server-notice";
  el.setAttribute("role", "status");
  main.insertBefore(el, main.firstChild);

  function say(text, isError) {
    el.textContent = text;
    el.classList.toggle("error", !!isError);
    el.classList.remove("hidden");
  }

  // A music folder that has gone (a -v left off a new container, a drive not
  // mounted): its albums are kept, and this says which, with the way to put it
  // back — or to forget it, if it's gone for good.
  function sayMissing(dirs) {
    el.innerHTML = "";
    el.classList.add("error");
    el.classList.remove("hidden");
    const n = d => (d.tracks || 0).toLocaleString();
    for (const d of dirs) {
      const p = document.createElement("div");
      const name = "“" + d.name + "”";
      let button = "Forget " + name;
      if (d.reason === "unreadable") {
        p.textContent = "Part of the music folder " + name + " couldn't be read (a share that dropped, a disk that stalled?) — its " + n(d) +
          " tracks are kept as they were, and it's read again next scan.";
        button = null;
      } else if (d.reason === "vanished") {
        p.textContent = "Most of " + name + " was gone at once — " + n(d) + " tracks. They're kept, in case it's a drive or share only half there. " +
          "Deleted them yourself? Then remove them from the library:";
        button = "Remove the missing ones";
      } else {
        p.textContent = "The music folder " + name + (d.missing ? " isn't there" : " is empty") + " — its " + n(d) +
          " tracks are kept, not removed. Mount the drive or share again (or add its -v line back to the container) and they're back as they were. Gone for good? Forget it:";
      }
      el.appendChild(p);
      if (!button) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "settings-update-btn server-notice-btn";
      b.textContent = button;
      b.addEventListener("click", async () => {
        const q = d.reason === "vanished"
          ? "Remove the tracks in " + name + " whose files are gone? Only those leave the library; anything still there stays."
          : "Forget " + name + "? Its " + n(d) + " tracks and their albums leave the library (they come back with a rescan if the folder does).";
        if (!(await (window.__confirmDialog ? window.__confirmDialog(q) : Promise.resolve(confirm(q))))) return;
        b.disabled = true;
        try {
          const r = await fetch("/api/library/forget-folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dir: d.dir }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
          if (window.__showToast) window.__showToast("Removed " + (j.removed || 0).toLocaleString() + " tracks from " + name);
          check();
        } catch (e) { b.disabled = false; if (window.__showToast) window.__showToast(e.message, "error"); }
      });
      el.appendChild(b);
    }
  }

  let unreachable = 0;
  async function check() {
    let j = null;
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      j = await r.json();
    } catch (e) {
      // An update restarting the server, or a moment's blip: say nothing.
      // Only a server that stays away for ~15 seconds outside an update is news.
      unreachable++;
      if (!window.__musicdUpdating && unreachable >= 3) {
        say("Can't reach Mandarin — check the container is running.", true);
      } else {
        el.classList.add("hidden");
      }
      setTimeout(check, 5000);
      return;
    }
    unreachable = 0;
    const scan = j.scan || {};
    const last = scan.last || {};
    const albums = j.index_count || 0;
    const rooms = (j.sonos && j.sonos.rooms) || 0;
    const dir = (j.music_dirs && j.music_dirs.join(", ")) || j.music_dir || "/music";
    // The first scan finished after the page drew an empty Home: reload once
    // so every row fills, rather than leaving "No albums" on screen.
    if (albums && el.dataset.wasEmpty === "1") { location.reload(); return; }
    let msg = null, err = false;
    if (j.offline) {
      // The Android app answering for the server (no connection, or offline mode): say so, once, quietly.
      msg = j.offline_mode
        ? "Offline mode — showing the music on this phone. Switch it off in the menu to see the server’s library."
        : "Offline — Mandarin can’t be reached. Showing what’s on this phone.";
    } else if (j.data_persistent === false) {
      msg = "Your library, album edits and play history are stored inside the container and will be lost " +
            "when it's replaced. Add  -v musicd-server-data:/app/data  to the docker run command.";
      err = true;
    } else if (!albums) {
      if (j.music_dir_exists === false || last.status === "no-music") {
        msg = "No music folder at " + dir + ". Add your library in Settings → Music folders — or to the docker run command " +
              "with  -v /path/to/your/Music:" + (j.music_dir || "/music") + ":ro  and start it again.";
        err = true;
      } else if (scan.running) {
        msg = "Scanning your music folder… " + (scan.files_seen || 0).toLocaleString() +
              " files so far. Albums appear when the first pass finishes.";
      } else if (last.status) {
        msg = "No audio files were found in " + dir + ". Check the -v …:" + dir + ":ro mount points at your " +
              "music, and that the container can read it" +
              (last.errors ? " (" + last.errors + " files couldn't be read)" : "") + ".";
        err = true;
      } else {
        msg = "Starting up — reading your music folder…";
      }
    } else if (Array.isArray(last.offline_dirs) && last.offline_dirs.length && !j.away) {
      sayMissing(last.offline_dirs);
      setTimeout(check, 30000);
      if (!albums) el.dataset.wasEmpty = "1";
      return;
    } else if (!rooms && !(j.sonos && j.sonos.searching) && !j.away) {
      // Not while the server is still looking (the first minute after a start
      // or an update): the rooms are usually back within seconds.
      msg = "No Sonos rooms found yet. The container needs --network host on the same network as your " +
            "speakers — or set -e SONOS_HOSTS=<a speaker's IP>." +
            (j.sonos && j.sonos.error ? " (" + j.sonos.error + ")" : "");
      err = true;
    }
    if (msg) {
      say(msg, err);
      setTimeout(check, scan.running ? 3000 : 8000);
    } else {
      el.classList.add("hidden");
      setTimeout(check, 60000);
    }
    if (!albums) el.dataset.wasEmpty = "1";
  }
  check();
})();

/* ------------------------------------------------------------------ */
/*  Settings → Account: signed-in devices, sign out, change password   */
/* ------------------------------------------------------------------ */
(function initAccount() {
  const listEl = document.getElementById("acct-devices");
  if (!listEl) return;
  const who = document.getElementById("acct-who");
  const toast = (m, k) => { if (window.__showToast) window.__showToast(m, k); };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function ago(ms) {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 2) return "active now";
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    if (h < 48) return h + (h === 1 ? " hour ago" : " hours ago");
    return Math.round(h / 24) + " days ago";
  }
  async function post(path, body) {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  }

  async function load() {
    try {
      const j = await (await fetch("/api/auth/devices", { cache: "no-store" })).json();
      who.textContent = "Signed in as " + (j.username || "?");
      listEl.innerHTML = "";
      for (const d of j.devices || []) {
        const row = document.createElement("div");
        row.className = "settings-row acct-device";
        const kind = d.kind === "android" ? "Android app" : "Browser";
        row.innerHTML = `<span class="settings-label"><span class="acct-name">${esc(d.name)}</span>` +
          `<span class="acct-sub">${esc(kind)} · ${d.current ? "this device" : esc(ago(d.last_seen))}</span></span>`;
        if (!d.current) {
          const b = document.createElement("button");
          b.type = "button"; b.className = "settings-update-btn"; b.textContent = "Sign out";
          b.addEventListener("click", async () => {
            b.disabled = true;
            try { await post("/api/auth/devices/revoke", { id: d.id }); row.remove(); toast(d.name + " signed out"); }
            catch (e) { b.disabled = false; toast(e.message, "error"); }
          });
          row.appendChild(b);
        }
        listEl.appendChild(row);
      }
    } catch (e) { who.textContent = "Couldn't load the account"; }
  }

  document.querySelectorAll('[data-pane="account"].settings-nav-item').forEach(b => b.addEventListener("click", load));

  document.getElementById("acct-signout").addEventListener("click", async () => {
    try { await post("/api/auth/logout"); } catch (e) { /* signed out either way */ }
    location.replace("/login");
  });

  const st = document.getElementById("acct-pw-status");
  document.getElementById("acct-pw").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    const cur = document.getElementById("acct-cur").value, n1 = document.getElementById("acct-new").value, n2 = document.getElementById("acct-new2").value;
    if (!cur) { st.textContent = "Enter your current password."; return; }
    if (n1.length < 8) { st.textContent = "Use at least 8 characters for the new password."; return; }
    if (n1 !== n2) { st.textContent = "The two new passwords don't match."; return; }
    btn.disabled = true; st.textContent = "Checking…";
    await new Promise(r => setTimeout(r, 30));
    try {
      const username = (who.textContent || "").replace(/^Signed in as /, "");
      const ch = await post("/api/auth/challenge", { username });
      const start = MusicdSrp.clientStart();
      const proof = MusicdSrp.clientProof(username, cur, ch.salt, ch.iterations, start, ch.B);
      const r = await post("/api/auth/verify", { id: ch.id, A: start.A, M1: proof.M1, purpose: "reauth" });
      if (r.M2 !== proof.expectM2) throw new Error("The server couldn't prove it's yours.");
      const v = MusicdSrp.makeVerifier(username, n1, MusicdSrp.ITERATIONS);
      await post("/api/auth/password", { salt: v.salt, verifier: v.verifier, iterations: MusicdSrp.ITERATIONS });
      ["acct-cur", "acct-new", "acct-new2"].forEach(id => { document.getElementById(id).value = ""; });
      st.textContent = "Password changed.";
    } catch (e) {
      st.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  });
})();

/* ------------------------------------------------------------------ */
/*  Android app only: Settings → Downloads.                            */
/*  A settings pane like the others — same header, back chevron, rows, */
/*  switches and theme — with the app supplying the data and applying  */
/*  the settings (MusicdDownloads). Browsers never get the tile.       */
/* ------------------------------------------------------------------ */
(function androidDownloadsPane() {
  const dl = window.MusicdDownloads;
  const nav = document.querySelector(".settings-nav");
  const sheet = document.querySelector("#settings-overlay .settings-sheet");
  if (!dl || !nav || !sheet) return;

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const size = (b) => b >= 1 << 30 ? (b / (1 << 30)).toFixed(1) + " GB" : Math.round(b / (1 << 20)) + " MB";
  const json = (f, fallback) => { try { return JSON.parse(f()) || fallback; } catch (e) { return fallback; } };
  const has = (name) => typeof dl[name] === "function";

  // The tile, after Wall display (just before Away from home).
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "settings-nav-item";
  tile.innerHTML = '<span class="settings-nav-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M5 21h14"/></svg></span>' +
    '<span class="settings-nav-txt"><span class="settings-nav-title">Downloads</span></span>';
  nav.insertBefore(tile, nav.querySelector('.settings-nav-item[data-pane="away"]'));

  // An app from before this pane existed: its own screen, as it was.
  if (!has("settings")) { tile.addEventListener("click", () => dl.open()); return; }
  tile.setAttribute("data-pane", "downloads");

  const pane = document.createElement("div");
  pane.className = "settings-view settings-pane hidden";
  pane.setAttribute("data-view", "pane");
  pane.setAttribute("data-pane", "downloads");
  sheet.appendChild(pane);

  const caret = '<svg class="settings-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  const select = (key, options, value) =>
    '<div class="settings-select-wrap"><select class="settings-select" data-dl-set="' + key + '">' +
    options.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value) ? " selected" : "") + ">" + esc(o[1]) + "</option>").join("") +
    "</select>" + caret + "</div>";
  const toggle = (key, on) =>
    '<label class="switch"><input type="checkbox" data-dl-set="' + key + '"' + (on ? " checked" : "") + '>' +
    '<span class="switch-track"><span class="switch-thumb"></span></span></label>';
  const row = (label, control) => '<div class="settings-row"><span class="settings-label">' + label + "</span>" + control + "</div>";

  const covers = new Map();   // album id → image key, from the server
  async function fetchCovers(ids) {
    const missing = ids.filter(id => !covers.has(id));
    if (!missing.length) return;
    try {
      const r = await fetch("/api/download/albums", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: missing }) });
      const j = await r.json();
      for (const a of (j && j.albums) || []) covers.set(a.id, a.exists ? a.album : null);
      render();
    } catch (e) { /* covers are a nicety */ }
  }

  function stateLine(d) {
    const q = d.quality === "opus" ? "Opus 256" : "Original";
    const auto = d.auto ? " · automatic" : "";
    if (d.state === "done") return d.total + " tracks · " + size(d.bytes || 0) + " · " + q + auto;
    if (d.state === "away") return "On a card that isn’t in · " + d.total + " tracks · " + size(d.bytes || 0);
    if (d.state === "downloading") return "Downloading " + (d.done || 0) + " of " + (d.total || "?") + " · " + q;
    if (d.state === "waiting") return "Waiting for the network · " + (d.done || 0) + " of " + (d.total || "?");
    if (d.state === "failed") return "Couldn’t download: " + (d.error || "unknown");
    return "Waiting to start · " + q;
  }

  // Two screens in this pane: the settings, with the albums behind one
  // "Downloads" folder row — so ten albums or a hundred never push the
  // settings out of view — and the albums themselves ("albums"), where they
  // can be removed one at a time, several at once (Select), or all.
  let view = "settings";
  let selecting = false;
  const chosen = new Set();
  const backSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
  const binSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
  const ask = (text) => window.__confirmDialog ? window.__confirmDialog(text) : Promise.resolve(window.confirm(text));

  // Removed without the app asking again: the page has just asked (Yes/No).
  // An app from before removeMany asks for each album itself.
  function removeAlbums(ids) {
    if (!ids.length) return;
    if (has("removeMany")) { try { dl.removeMany(JSON.stringify(ids)); } catch (e) {} }
    else for (const id of ids) { try { dl.remove(id); } catch (e) {} }
    for (const id of ids) chosen.delete(id);
  }

  function albumRows(list) {
    return list.map(d => {
      const al = covers.get(d.id);
      const art = al && al.image_key ? '<img src="/api/image/' + encodeURIComponent(al.image_key) + '?size=160" alt="" loading="lazy">' : "";
      const on = chosen.has(d.id);
      return '<div class="dl-row' + (selecting ? " is-selecting" : "") + (on ? " is-chosen" : "") + '" data-id="' + d.id + '">' +
        (selecting
          ? '<button type="button" class="dl-check" data-dl-choose="' + d.id + '" role="checkbox" aria-checked="' + on + '" aria-label="Select ' + esc(d.title) + '"><span class="dl-checkbox">' +
            (on ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12 10 17 19 7"/></svg>' : "") + "</span></button>"
          : "") +
        '<button type="button" class="dl-open" ' + (selecting ? 'data-dl-choose="' + d.id + '"' : 'data-dl-open="' + d.id + '"') + '><span class="dl-art">' + art + "</span>" +
        '<span class="dl-text"><span class="dl-title">' + esc(d.title) + '</span><span class="dl-artist">' + esc(d.artist) + "</span>" +
        '<span class="dl-state">' + esc(stateLine(d)) + "</span></span></button>" +
        (selecting || d.state === "away" ? "" :
          (d.state === "done" ? '<button type="button" class="dl-btn" data-dl-play="' + d.id + '" aria-label="Play on this phone">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg></button>' : "") +
          '<button type="button" class="dl-btn" data-dl-remove="' + d.id + '" aria-label="Remove from this phone">' + binSvg + "</button>") +
        "</div>";
    }).join("");
  }

  function renderAlbums(s, list) {
    const done = list.filter(d => d.state === "done").length;
    for (const id of [...chosen]) if (!list.some(d => d.id === id)) chosen.delete(id);
    if (!list.length) selecting = false;
    const n = chosen.size;
    pane.innerHTML =
      '<div class="settings-pane-head">' +
        '<button class="settings-back" type="button" data-dl-back aria-label="Back to Downloads">' + backSvg + "</button>" +
        "<h2>Downloads</h2></div>" +
      '<p class="settings-pane-desc">' + done + (done === 1 ? " album" : " albums") + " on this phone · " + size(s.used || 0) + "</p>" +
      (list.length
        ? '<div class="dl-toolbar">' +
            (selecting
              ? '<button type="button" class="settings-update-btn" data-dl-select-all>' + (n === list.length ? "Select none" : "Select all") + "</button>" +
                '<button type="button" class="settings-update-btn" data-dl-select-done>Done</button>'
              : '<button type="button" class="settings-update-btn" data-dl-select>Select</button>' +
                '<button type="button" class="settings-update-btn dl-danger" data-dl-clear-all>Clear all</button>') +
          "</div>" +
          '<div class="settings-block dl-list">' + albumRows(list) + "</div>" +
          (selecting
            ? '<div class="dl-selbar"><span>' + (n ? n + " selected" : "Tap albums to select them") + "</span>" +
              '<button type="button" class="settings-update-btn dl-danger" data-dl-delete-chosen' + (n ? "" : " disabled") + ">Remove" + (n ? " " + n : "") + "</button></div>"
            : "")
        : '<div class="settings-note">Nothing here yet. On an album’s page, choose ⋯ → Download to this phone.</div>');
    fetchCovers(list.map(d => d.id));
  }

  function render() {
    const s = json(() => dl.settings(), {});
    const list = json(() => dl.all(), []);
    if (view === "albums") return renderAlbums(s, list);
    const done = list.filter(d => d.state === "done").length;
    const going = list.length - done;
    const places = s.places || [];
    const folderSub = list.length
      ? done + (done === 1 ? " album" : " albums") + " · " + size(s.used || 0) + (going ? " · " + going + " on the way" : "")
      : "Nothing downloaded yet";

    pane.innerHTML =
      '<div class="settings-pane-head">' +
        '<button class="settings-back" type="button" data-settings-back aria-label="Back to settings">' + backSvg +
        "</button><h2>Downloads</h2></div>" +
      '<p class="settings-pane-desc">' + done + (done === 1 ? " album" : " albums") + " · " + size(s.used || 0) + " used</p>" +

      '<div class="settings-block">' +
        '<button type="button" class="dl-folder" data-dl-folder>' +
          '<span class="dl-folder-ico" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></span>' +
          '<span class="dl-folder-txt"><span class="dl-folder-title">Downloads</span><span class="dl-folder-sub">' + esc(folderSub) + "</span></span>" +
          '<svg class="dl-folder-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>' +
        "</button>" +
      "</div>" +
      '<div class="settings-divider"></div>' +

      ("offlineMode" in s ?
        '<div class="settings-block">' +
          row("Offline mode", toggle("offlineMode", s.offlineMode)) +
          '<div class="settings-note">' + (s.offlineMode
            ? "On. Only the music on this phone shows — its music folder and downloads — and the app doesn’t use the server, even when it can be reached."
            : "Off. The server’s library shows whenever it can be reached; with no connection, only the music on this phone.") + "</div>" +
        "</div>" +
        '<div class="settings-divider"></div>' : "") +

      '<div class="settings-block"><div class="settings-subhead">Downloading</div>' +
        row("Quality" + settingsInfo("Original is the files as they are (formats a phone can’t play become lossless FLAC). Opus 256 is about a quarter of the size of a CD-quality FLAC, less against hi-res. You can choose each time."),
          select("quality", [["original", "Original"], ["opus", "Opus 256 kbps"]], s.quality)) +
        row("Save to" + settingsInfo("Phone storage and the SD card here are the app’s own: no permission needed, but uninstalling the app deletes what’s there (updates don’t). A folder of your own outlives the app: a fresh install pointed at the same folder finds the albums again."), select("location", places.map(p => [p.id, p.label + " · " + size(p.free || 0) + " free"]), s.location)) +
        downloadFolderRow(s) +
        folderPlaceNote(s, places) +
        row("Size limit", select("limitGb", [0, 8, 16, 32, 64, 128, 256].map(g => [g, g ? g + " GB" : "No limit"]), s.limitGb)) +
        row("Wi-Fi only", toggle("wifiOnly", s.wifiOnly)) +
      "</div>" +
      '<div class="settings-divider"></div>' +

      ("awayQuality" in s ?
        '<div class="settings-block"><div class="settings-subhead">Playing away from home</div>' +
          row("Stream as" + settingsInfo("Albums not on the phone, over mobile data or other Wi-Fi. Opus 256 is made by the server as it plays, about a quarter of the data of a CD-quality FLAC; Original sends the files as they are."),
            select("awayQuality", [["opus", "Opus 256 kbps"], ["original", "Original"]], s.awayQuality)) +
          '<div class="settings-note">At home it’s always the original.</div>' +
        "</div>" +
        '<div class="settings-divider"></div>' : "") +

      ("cacheWifi" in s && s.cacheChoices ?
        '<div class="settings-block"><div class="settings-subhead">Cached ahead' + settingsInfo("Playing on this phone: the next tracks in the queue are kept on the phone ahead of time, so they play without the network — through a dead spot, or on mobile data without using any. On mobile data " + s.cacheMobile + " tracks is about " + Math.round(s.cacheMobile * 9) + " MB as Opus 256. Tracks stay until the space is needed, so one played again is already here.") + "</div>" +
          row("On Wi-Fi", select("cacheWifi", s.cacheChoices.wifi.map(n => [n, n + " tracks"]), s.cacheWifi)) +
          row("On mobile data", select("cacheMobile", s.cacheChoices.mobile.map(n => [n, n + " tracks"]), s.cacheMobile)) +
          row("Cache size", select("cacheGb", s.cacheChoices.gb.map(g => [g, g + " GB"]), s.cacheGb)) +
          '<div class="settings-row"><span class="settings-label dl-cache-status" id="dl-cache-status">…</span>' +
            '<button type="button" class="settings-update-btn" data-dl-clear-cache>Clear cache</button></div>' +
        "</div>" +
        '<div class="settings-divider"></div>' : "") +

      '<div class="settings-block"><div class="settings-subhead">Automatic downloads' + settingsInfo("Kept on the phone by themselves, in the quality above, and removed again when they drop off the list. Albums you download yourself are never removed.") + "</div>" +
        row("Today’s Smart Picks", toggle("autoPicks", s.autoPicks)) +
        row("Album of the day", toggle("autoAotd", s.autoAotd)) +
        row("Recently added", select("autoRecent", [0, 5, 10, 20, 30].map(n => [n, n ? "The newest " + n : "Off"]), s.autoRecent)) +
        '<div class="settings-note">Removed again when they drop off the list.</div>' +
      "</div>";

    paintCacheStatus();
  }

  // The download folder (v0.5.41): a folder of your own, chosen here on its
  // own — nothing to do with the music on the phone.
  function downloadFolderRow(s) {
    const f = s.folder || { access: "none" };
    if (!has("chooseDownloadFolder")) return "";
    if (!f.chosen) {
      return '<div class="settings-row"><span class="settings-label">Download folder</span>' +
        '<button type="button" class="settings-update-btn" data-dl-choose-folder>Choose</button></div>' +
        '<div class="settings-note">A folder of your own on the phone or an SD card, as a third place to save to. Albums there outlive the app.</div>';
    }
    return '<div class="settings-row"><span class="settings-label">Download folder: ' + esc(f.name || "chosen") + '</span>' +
      '<span><button type="button" class="settings-update-btn" data-dl-choose-folder>Change</button> ' +
      '<button type="button" class="settings-update-btn" data-dl-forget-folder>Forget</button></span></div>';
  }

  // What stands between the download folder and downloads landing in it,
  // and the move of what is elsewhere.
  function folderPlaceNote(s, places) {
    const f = s.folder || { access: "none" };
    let html = "";
    if (f.access === "needed") {
      html += '<div class="settings-row"><span class="settings-label">Save into “' + esc(f.name || "the download folder") + '”</span>' +
        '<button type="button" class="settings-update-btn" data-dl-allow>Allow</button></div>' +
        '<div class="settings-note">Android asks for the app to be allowed all files access first — tap Allow, switch it on, and come back.</div>';
    } else if (f.access === "unmapped") {
      html += '<div class="settings-note">The download folder you chose is on a drive the app can’t write plain files to (a cloud drive, say). Downloads can’t go there; choose a folder on the phone or its SD card.</div>';
    } else if (f.access === "away") {
      html += '<div class="settings-note">The download folder isn’t reachable right now (its card out?). Downloads go to the place above until it is back.</div>';
    }
    const mv = s.moving;
    if (mv) {
      html += '<div class="settings-note">' + (mv.error ? "Moving stopped: " + esc(mv.error) + " (" + mv.done + " of " + mv.total + " moved)"
        : "Moving " + (mv.done + 1 > mv.total ? mv.total : mv.done + 1) + " of " + mv.total + "…") + "</div>";
    } else if (s.elsewhere > 0 && places.length > 1) {
      html += '<div class="settings-row"><span class="settings-label">' + s.elsewhere + (s.elsewhere === 1 ? " album is" : " albums are") + ' saved elsewhere</span>' +
        '<button type="button" class="settings-update-btn" data-dl-move>Move all here</button></div>' +
        '<div class="settings-note">Copied album by album, then removed from where they were. Stopped partway, nothing is lost: each album is whole at one end or the other.</div>';
    }
    return html;
  }

  window.__renderLocalFolder = () => { if (window.__renderMusicFoldersPane) window.__renderMusicFoldersPane(); };

  // Music files on the phone (Stage 5), now on the Music Folders page (v0.5.41): the block's HTML, shared.
  window.__localFolderBlock = function localFolderBlock() {
    let info = null;
    try { const v = dl.localFolder(); info = v && v !== "null" ? JSON.parse(v) : null; } catch (e) { info = null; }
    let html = '<div class="settings-block" data-local-block><div class="settings-subhead">Music on this phone' + settingsInfo("Music bought on this phone (a Qobuz purchase, say) in a folder of your choosing. Mandarin reads its tags and covers, shows it on Home as “Music on device”, and plays it here through the phone’s DSP. The folder is read again by itself when it changes, when the app comes back, and every few minutes. Forget stops Mandarin reading it; nothing in it is touched.") + "</div>";
    if (!info) {
      html += '<div class="settings-row"><span class="settings-label">No folder chosen</span>' +
        '<button type="button" class="settings-update-btn" data-local-choose>Choose a folder</button></div>' +
        '<div class="settings-note">Music already on the phone, in a folder you choose.</div>';
    } else {
      const when = info.scanned_at ? new Date(info.scanned_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "never";
      const sub = info.scanning ? "Reading the folder…"
        : !info.available ? "Not reachable right now — its card may be out"
        : info.albums + (info.albums === 1 ? " album" : " albums") + " · " + info.tracks + (info.tracks === 1 ? " track" : " tracks") + " · read " + when;
      html += '<div class="dl-folder" style="cursor:default"><span class="dl-folder-ico" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>' +
        '<span class="dl-folder-txt"><span class="dl-folder-title">' + esc(info.name) + '</span><span class="dl-folder-sub">' + esc(sub) + "</span></span></div>" +
        (info.error ? '<div class="settings-note away-error">' + esc(info.error) + "</div>" : "") +
        '<div class="dl-toolbar" style="justify-content:flex-start;margin-top:10px">' +
          '<button type="button" class="settings-update-btn" data-local-rescan' + (info.scanning ? " disabled" : "") + ">Read again</button>" +
          '<button type="button" class="settings-update-btn" data-local-choose>Change folder</button>' +
          '<button type="button" class="settings-update-btn" data-local-forget>Forget</button></div>';
    }
    return html + "</div>";
  };

  // "12 of 20 ahead on the phone · 1.2 GB used", kept current while the pane is open.
  function paintCacheStatus() {
    const el = pane.querySelector("#dl-cache-status");
    if (!el || !has("cacheStatus")) return;
    const c = json(() => dl.cacheStatus(), {});
    const ahead = c.wanted ? c.ahead + " of " + c.wanted + " ahead on the phone" + (c.metered ? " (mobile data)" : "") : "Nothing queued";
    el.textContent = ahead + " · " + size(c.used || 0) + " used";
  }
  setInterval(() => { if (!pane.classList.contains("hidden")) paintCacheStatus(); }, 3000);

  pane.addEventListener("change", (e) => {
    const el = e.target.closest("[data-dl-set]");
    if (!el) return;
    const value = el.type === "checkbox" ? String(el.checked) : el.value;
    try { dl.set(el.getAttribute("data-dl-set"), value); } catch (err) { /* old app */ }
    render();
  });
  pane.addEventListener("click", async (e) => {
    const list = () => json(() => dl.all(), []);
    const titleOf = id => (list().find(d => d.id === id) || {}).title || "this album";
    if (e.target.closest("[data-dl-allow]")) { try { dl.allowAllFiles(); } catch (x) {} return; }
    if (e.target.closest("[data-dl-move]")) {
      if (!(await ask("Move every downloaded album to the place chosen under Save to?"))) return;
      try { dl.moveDownloads(); } catch (x) {}
      render(); return;
    }
    if (e.target.closest("[data-dl-choose-folder]")) { try { dl.chooseDownloadFolder(); } catch (x) {} return; }
    if (e.target.closest("[data-dl-forget-folder]")) {
      if (!(await ask("Forget the download folder?\n\nDownloads go to phone storage from now on. Albums already in the folder stay there, and aren’t shown until it is chosen again."))) return;
      try { dl.forgetDownloadFolder(); } catch (x) {}
      render(); return;
    }
    if (e.target.closest("[data-dl-folder]")) { view = "albums"; selecting = false; chosen.clear(); render(); pane.scrollTop = 0; return; }
    if (e.target.closest("[data-dl-back]")) { view = "settings"; selecting = false; chosen.clear(); render(); return; }
    if (e.target.closest("[data-dl-select]")) { selecting = true; chosen.clear(); render(); return; }
    if (e.target.closest("[data-dl-select-done]")) { selecting = false; chosen.clear(); render(); return; }
    if (e.target.closest("[data-dl-select-all]")) {
      const all = list().map(d => d.id);
      if (chosen.size === all.length) chosen.clear(); else all.forEach(id => chosen.add(id));
      render(); return;
    }
    const pick = e.target.closest("[data-dl-choose]");
    if (pick) {
      const id = Number(pick.getAttribute("data-dl-choose"));
      if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
      render(); return;
    }
    if (e.target.closest("[data-dl-delete-chosen]")) {
      const ids = [...chosen];
      if (!ids.length) return;
      const one = ids.length === 1;
      if (!(await ask("Remove " + (one ? "“" + titleOf(ids[0]) + "”" : ids.length + " albums") + " from this phone?\n\n" +
                      (one ? "It stays" : "They stay") + " in your library on the server."))) return;
      removeAlbums(ids);
      selecting = false;
      render(); return;
    }
    if (e.target.closest("[data-dl-clear-all]")) {
      const ids = list().map(d => d.id);
      if (!ids.length) return;
      if (!(await ask("Remove all " + ids.length + (ids.length === 1 ? " album" : " albums") + " from this phone?\n\n" +
                      "Everything downloaded goes (downloads under way are stopped). They stay in your library on the server."))) return;
      removeAlbums(ids);
      render(); return;
    }
    const play = e.target.closest("[data-dl-play]");
    if (play) { try { dl.play(Number(play.getAttribute("data-dl-play"))); } catch (err) {} return; }
    const rm = e.target.closest("[data-dl-remove]");
    if (rm) {
      const id = Number(rm.getAttribute("data-dl-remove"));
      if (has("removeMany")) {
        if (await ask("Remove “" + titleOf(id) + "” from this phone?\n\nIt stays in your library on the server.")) { removeAlbums([id]); render(); }
      } else dl.remove(id);   // an older app asks itself
      return;
    }
    if (e.target.closest("[data-dl-clear-cache]")) {
      try { dl.clearCache(); } catch (err) {}
      paintCacheStatus();
      return;
    }
    const open = e.target.closest("[data-dl-open]");
    if (open) {
      const al = covers.get(Number(open.getAttribute("data-dl-open")));
      if (al && window.__openAlbum) {
        const closer = document.querySelector("#settings-overlay [data-settings-close]");
        if (closer) closer.click();
        window.__openAlbum(al, { source: "home", filter: null });
      }
    }
  });
  tile.addEventListener("click", () => { view = "settings"; selecting = false; chosen.clear(); render(); });   // before the sheet shows the pane

  // The phone's Back: out of selecting, then from the albums to the settings.
  const settingsBack = window.__musicdBack;
  window.__musicdBack = () => {
    if (!pane.classList.contains("hidden") && view === "albums") {
      if (selecting) { selecting = false; chosen.clear(); } else view = "settings";
      render();
      return true;
    }
    return settingsBack ? settingsBack() : false;
  };

  // Downloads moving on (the app calls this) redraw the pane while it's open.
  const previous = window.__musicdDownloadsChanged;
  window.__musicdDownloadsChanged = () => {
    if (previous) previous();
    if (!pane.classList.contains("hidden")) render();
  };
})();

/* ------------------------------------------------------------------ */
/*  Android app only: Settings → System shows the app's own version    */
/*  and looks for a newer app (the server's updater doesn't touch it). */
/* ------------------------------------------------------------------ */
(function androidAppUpdateRow() {
  const app = window.MusicdApp;
  const pane = document.querySelector('.settings-pane[data-pane="system"] .settings-block');
  if (!app || !pane) return;
  const row = document.createElement("div");
  row.className = "settings-row";
  const label = document.createElement("span");
  label.className = "settings-label";
  let v = "";
  try { v = app.version(); } catch (e) {}
  label.textContent = "Android app" + (v ? " v" + v : "");
  if (window.__musicdAppUpd) {
    // "Check for updates" above does the server and this app, so this row
    // only says which app this is.
    row.appendChild(label);
    const note = document.createElement("span");
    note.className = "settings-note";
    note.textContent = "Updated with the server";
    row.appendChild(note);
    pane.appendChild(row);
  } else {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "settings-update-btn";
  btn.textContent = "Check for app update";
  btn.addEventListener("click", () => { try { app.checkUpdate(); } catch (e) {} });
  row.appendChild(label); row.appendChild(btn);
  pane.appendChild(row);
  }
  // This phone's own Tailscale (the app's): in Settings → Away from home,
  // beside the server's — one place for getting at the library away.
  const awayPane = document.querySelector('.settings-pane[data-pane="away"]');
  if (typeof app.tailscaleTest === "function" && awayPane) {
    const blk = document.createElement("div");
    blk.className = "settings-block away-phone";
    blk.innerHTML = '<div class="settings-divider"></div><div class="settings-subhead">This phone</div>' +
      '<div class="settings-row"><span class="settings-label">Tailscale on this phone' + settingsInfo("The app has its own Tailscale — no Tailscale app needed. Sign it in once, with the same account as the server; away from home the app then reaches the server by itself.") + "</span>" +
      '<button type="button" class="settings-update-btn">Tailscale</button></div>' +
      '<div class="settings-note">Built into the app; sign in with the server’s account.</div>';
    blk.querySelector("button").addEventListener("click", () => { try { app.tailscaleTest(); } catch (e) {} });
    awayPane.appendChild(blk);
  }
})();

/* ------------------------------------------------------------------ */
/*  Android app only: Settings' buttons are one column (android.css),  */
/*  every title one size — the largest at which the longest title      */
/*  still fits on one line.                                            */
/* ------------------------------------------------------------------ */
(function androidSettingsTitleSize() {
  if (!/MusicDAndroid/.test(navigator.userAgent)) return;
  // The main list and Setup's: each sized by its own longest title.
  const navs = [...document.querySelectorAll("#settings-overlay .settings-nav")];
  if (!navs.length || typeof ResizeObserver !== "function") return;
  const MAX = 20, MIN = 13, PROBE = 20;
  let busy = false;
  function fitOne(nav) {
    const items = [...nav.querySelectorAll(".settings-nav-item:not(.hidden)")];
    if (!items.length || !nav.offsetWidth) return;      // not on screen yet
    nav.style.setProperty("--settings-nav-fs", PROBE + "px");
    let scale = Infinity;
    for (const it of items) {
      const title = it.querySelector(".settings-nav-title");
      const box = it.querySelector(".settings-nav-txt");
      if (!title || !box) continue;
      const room = box.clientWidth, need = title.scrollWidth;
      if (room > 0 && need > 0) scale = Math.min(scale, room / need);
    }
    const fs = scale === Infinity ? 16 : Math.max(MIN, Math.min(MAX, Math.floor(PROBE * scale * 10) / 10));
    nav.style.setProperty("--settings-nav-fs", fs + "px");
    // Setup's buttons take the main list's height.
    if (nav === navs[0] && items[0].offsetHeight) {
      document.getElementById("settings-overlay").style.setProperty("--settings-row-h", items[0].offsetHeight + "px");
    }
  }
  function fit() {
    if (busy) return;
    busy = true;
    navs.forEach(fitOne);
    busy = false;
  }
  // Measured whenever a list is laid out: opened, rotated, or a button shown or hidden.
  const ro = new ResizeObserver(fit), mo = new MutationObserver(fit);
  for (const nav of navs) {
    ro.observe(nav);
    mo.observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }
})();

/* ------------------------------------------------------------------ */
/*  Settings → Away from home: Tailscale built into the server.        */
/*  Sign in once and the server is on your tailnet by itself.          */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/*  Settings → Music folders: where the library is read from, chosen    */
/*  here (as in Roon) — any number of folders, anywhere the server can  */
/*  see. From home only.                                                */
/* ------------------------------------------------------------------ */
(function initFoldersPane() {
  const body = document.getElementById("folders-pane-body");
  const pane = document.querySelector('.settings-pane[data-pane="folders"]');
  const navItem = document.querySelector('.settings-nav-item[data-pane="folders"]');
  if (!body || !pane || !navItem) return;
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ask = (q) => window.__confirmDialog ? window.__confirmDialog(q) : Promise.resolve(confirm(q));
  const toast = (m, kind) => { if (window.__showToast) window.__showToast(m, kind); };
  const folderSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  let st = null, err = "", busy = false;
  let browsing = null;   // { path, parent, dirs } while choosing a folder

  async function api(url, payload) {
    const r = await fetch(url, payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  }
  async function load() {
    try { st = await api("/api/library/folders"); err = ""; } catch (e) { st = null; err = e.message; }
    render();
  }
  async function browse(p) {
    try { browsing = await api("/api/library/browse?path=" + encodeURIComponent(p || "/")); err = ""; }
    catch (e) { err = e.message; if (!browsing) browsing = { path: "/", parent: null, dirs: [] }; }
    render();
    const list = body.querySelector(".mf-browse-list");
    if (list) list.scrollTop = 0;
  }

  function render() {
    if (browsing) return renderBrowser();
    if (!st) { body.innerHTML = '<div class="settings-note">' + esc(err || "Couldn’t ask the server.") + "</div>"; return; }
    let html = '<div class="mf-list">';
    for (const f of st.folders) {
      const state = !f.exists ? "Not there — its albums are kept" : !f.readable ? "Can’t be read — its albums are kept" : (f.tracks || 0).toLocaleString() + " tracks";
      html += '<div class="mf-row">' +
        '<span class="mf-ico">' + folderSvg + "</span>" +
        '<span class="mf-txt"><span class="mf-name">' + esc(f.name) + '</span><span class="mf-path">' + esc(f.path) + '</span>' +
        '<span class="mf-state' + (f.exists && f.readable ? "" : " is-bad") + '">' + esc(state) + "</span>" +
        (f.hint ? '<span class="mf-state is-bad">' + esc(f.hint) + "</span>" : "") + "</span>" +
        (st.folders.length > 1 ? '<button type="button" class="settings-update-btn mf-remove" data-mf-remove="' + esc(f.path) + '"' + (busy ? " disabled" : "") + ">Remove</button>" : "") +
        "</div>";
    }
    html += "</div>";
    html += '<div class="settings-row"><span class="settings-label"></span><button type="button" class="settings-update-btn" data-mf-add' + (busy ? " disabled" : "") + ">Add a folder</button></div>";
    if (st.scanning) html += '<div class="settings-note">Reading your music… new albums appear as they’re found.</div>';
    html += '<div class="settings-note">' + (st.docker
      ? "The server sees only what its container has mounted. Mount your drives and shares once — e.g. <b>-v /mnt:/mnt:ro,rslave</b> (on DietPi, everything in Drive Manager is under /mnt; <b>rslave</b> lets shares the machine mounts later show up) — and add any folders in them here. A folder that’s missing for a while (a drive asleep, a share that dropped) keeps its albums."
      : "Any folder on the machine the server runs on. A folder that’s missing for a while (a drive asleep, a share that dropped) keeps its albums.") + "</div>";
    if (err) html += '<div class="settings-note away-error">' + esc(err) + "</div>";
    // Music on this phone (the app): its folder is a watched folder too, so it lives here (v0.5.41).
    if (window.MusicdDownloads && typeof window.MusicdDownloads.localFolder === "function" && window.__localFolderBlock) {
      html += '<div class="settings-divider"></div>' + window.__localFolderBlock();
    }
    body.innerHTML = html;
  }
  window.__renderMusicFoldersPane = () => { if (!pane.classList.contains("hidden") && !browsing) render(); };

  function renderBrowser() {
    const b = browsing;
    const watched = new Set((st && st.folders || []).map(f => f.path));
    const inside = [...watched].find(w => b.path === w || b.path.startsWith(w + "/"));
    let html = '<div class="mf-browse-head"><button type="button" class="settings-update-btn" data-mf-cancel>Cancel</button>' +
      '<span class="mf-browse-path">' + esc(b.path) + "</span></div>";
    // The drives and shares the server can see, one tap away.
    const places = (st && st.mounts) || [];
    if (places.length) {
      html += '<div class="mf-places"><span class="mf-places-label">Mounted drives and shares</span>' +
        places.map(m => '<button type="button" class="mf-place' + (m.waiting ? " is-bad" : "") + (m.path === b.path ? " is-on" : "") +
          '" data-mf-go="' + esc(m.path) + '">' + esc(m.path) + "</button>").join("") + "</div>";
    }
    if (b.hint) html += '<div class="settings-note away-error mf-hint">' + esc(b.hint) + "</div>";
    html += '<div class="mf-browse-list">';
    if (b.parent) html += '<button type="button" class="mf-dir mf-up" data-mf-go="' + esc(b.parent) + '"><span class="mf-ico">↰</span><span class="mf-name">Up</span></button>';
    for (const d of b.dirs) {
      html += '<button type="button" class="mf-dir" data-mf-go="' + esc(d.path) + '"><span class="mf-ico">' + folderSvg + '</span><span class="mf-name">' + esc(d.name) + "</span>" +
        (watched.has(d.path) ? '<span class="mf-tag">In the library</span>' : "") + "</button>";
    }
    if (!b.dirs.length) html += '<div class="settings-note">No folders in here.</div>';
    html += "</div>";
    html += '<div class="mf-browse-foot">' + (inside
      ? '<span class="settings-note">Already in the library (' + esc(inside) + ")</span>"
      : '<button type="button" class="settings-update-btn mf-choose" data-mf-choose' + (busy || b.path === "/" ? " disabled" : "") + ">Add “" + esc(b.path.split("/").pop() || b.path) + "”</button>") + "</div>";
    if (err) html += '<div class="settings-note away-error">' + esc(err) + "</div>";
    body.innerHTML = html;
  }

  body.addEventListener("click", async (e) => {
    const t = e.target.closest("button");
    if (!t || busy) return;
    const dl = window.MusicdDownloads;
    if (t.hasAttribute("data-local-choose")) { try { dl.chooseLocalFolder(); } catch (x) {} return; }
    if (t.hasAttribute("data-local-rescan")) { try { dl.rescanLocal(); } catch (x) {} render(); return; }
    if (t.hasAttribute("data-local-forget")) {
      if (!(await ask("Forget this folder?\n\nMandarin stops reading it. Nothing in it is deleted."))) return;
      try { dl.forgetLocalFolder(); } catch (x) {}
      render(); return;
    }
    if (t.hasAttribute("data-mf-add")) { err = ""; return browse("/"); }
    if (t.hasAttribute("data-mf-cancel")) { browsing = null; err = ""; return render(); }
    if (t.hasAttribute("data-mf-go")) { err = ""; return browse(t.getAttribute("data-mf-go")); }
    if (t.hasAttribute("data-mf-choose")) {
      busy = true; render();
      try {
        st = Object.assign({}, st, await api("/api/library/folders", { add: browsing.path }));
        browsing = null; err = "";
        toast("Added — reading its music now");
      } catch (x) { err = x.message; }
      busy = false; render();
      return;
    }
    const rm = t.getAttribute("data-mf-remove");
    if (rm) {
      const f = st.folders.find(x => x.path === rm) || { name: rm, tracks: 0 };
      if (!(await ask("Remove “" + f.name + "” from the library?\n\nIts " + (f.tracks || 0).toLocaleString() + " tracks and their albums leave Mandarin. The files themselves aren’t touched."))) return;
      busy = true; render();
      try {
        const j = await api("/api/library/folders", { remove: rm });
        st = Object.assign({}, st, j); err = "";
        toast("Removed “" + f.name + "” — " + (j.removed || 0).toLocaleString() + " tracks");
      } catch (x) { err = x.message; }
      busy = false; render();
    }
  });
  navItem.addEventListener("click", () => { browsing = null; load(); });
  // While open and a scan is going: the counts follow.
  setInterval(() => { if (!pane.classList.contains("hidden") && !busy && !browsing && st && st.scanning) load(); }, 4000);
  // Back (the phone's, or the pane's) while choosing: back to the list first.
  pane.addEventListener("click", (e) => {
    if (browsing && e.target.closest("[data-settings-back]")) { e.stopImmediatePropagation(); e.preventDefault(); browsing = null; render(); }
  }, true);
})();

/* ------------------------------------------------------------------ */
/*  Settings → Audio Devices: every player Mandarin can see — Sonos     */
/*  rooms, phones, UPnP renderers — its name (yours, stored on the      */
/*  server) and what it can take. From home only. Playing to the UPnP   */
/*  renderers comes in a later version.                                 */
/* ------------------------------------------------------------------ */
(function initAudioDevicesPane() {
  const list = document.getElementById("devices-list");
  const pane = document.querySelector('.settings-pane[data-pane="playback"]');
  const navItem = document.querySelector('.settings-nav-item[data-pane="playback"]');
  const detail = document.querySelector('.settings-pane[data-pane="device"]');
  const body = document.getElementById("device-pane-body");
  const title = document.getElementById("device-pane-title");
  const desc = document.getElementById("device-pane-desc");
  const rescan = document.getElementById("devices-rescan");
  if (!list || !pane || !navItem || !detail || !body) return;
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ask = (q) => window.__confirmDialog ? window.__confirmDialog(q) : Promise.resolve(confirm(q));
  const toast = (m, kind) => { if (window.__showToast) window.__showToast(m, kind); };
  const svg = (paths) => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
  const ICONS = {
    sonos: svg('<rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><circle cx="12" cy="6" r="1"/>'),
    phone: svg('<rect x="7" y="2" width="10" height="20" rx="2"/><circle cx="12" cy="18" r="1"/>'),
    upnp: svg('<rect x="2" y="7" width="20" height="10" rx="2"/><circle cx="17" cy="12" r="2"/><path d="M5 12h7"/>')
  };
  const MARK = { verified: "✓", user: "✎", profile: "◆", advertised: "◆" };
  const SOURCE = {
    verified: "Confirmed by the device", user: "You set it", profile: "Known for this model",
    advertised: "The device advertises it", floor: "Every renderer takes this", sonos: "Sonos plays this",
    phone: "The phone plays this", later: "Not sent as DSD", off: "Not offered"
  };
  let devices = [], away = false, err = "", current = null, busy = false;
  // The DSP block's unsaved edits (bands, headroom) for the device open now.
  // Save sends them; opening another device drops them.
  let dspDraft = null;
  const BAND_TYPES = [["peak", "Peak"], ["low_shelf", "Low shelf"], ["high_shelf", "High shelf"], ["low_pass", "Low-pass"], ["high_pass", "High-pass"]];
  const isPass = t => t === "low_pass" || t === "high_pass";
  function dspOf(d) {
    if (dspDraft && dspDraft.id === d.id) return dspDraft;
    const cur = d.dsp || { enabled: false, peq: null, headroom: "auto" };
    dspDraft = { id: d.id, dirty: false, bands: ((cur.peq && cur.peq.bands) || []).map(b => Object.assign({}, b)), headroom: cur.headroom == null ? "auto" : cur.headroom,
      headphone: cur.headphone || null };
    return dspDraft;
  }
  function dspSetting(draft, enabled) {
    return { enabled, headphone: draft.headphone, peq: { bands: draft.bands }, headroom: draft.headroom };
  }
  // Every band the draft runs: the headphone profile's, then the PEQ's.
  const allBands = dr => (dr.headphone && dr.headphone.bands ? dr.headphone.bands : []).concat(dr.bands);
  const autoHeadroom = dr => window.Biquad ? window.Biquad.headroom(dspSetting(Object.assign({}, dr, { headroom: "auto" }), true), 48000) : 0;
  const fmtDb = v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + " dB";
  const fmtHz = v => v >= 1000 ? (Math.round(v / 100) / 10) + " kHz" : Math.round(v) + " Hz";

  async function api(url, method, payload) {
    const r = await fetch(url, method ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) } : { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  }
  const fmtRate = hz => String(hz / 1000);
  const stateWord = d => d.state === "playing" ? "Playing" : d.state === "paused" ? "Paused" : d.online ? "Idle" : "Offline";
  const when = ts => ts ? new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";

  async function load() {
    try { const j = await api("/api/audio-devices"); devices = j.devices || []; away = !!j.away; err = ""; }
    catch (e) { err = e.message; }
    renderList();
    if (current) refreshCurrent();
  }
  async function refreshCurrent() {
    const id = current.id;
    try {
      const d = await api("/api/audio-devices/" + encodeURIComponent(id));
      if (current && current.id === id) { current = d; renderDetail(true); }
    } catch (e) { /* the list carries the error */ }
  }

  function renderList() {
    // Away, the app sees the phone it is on and nothing else; the network
    // can't be searched from there, so Look again goes.
    if (rescan) rescan.classList.toggle("hidden", away);
    if (away && !devices.length) { list.innerHTML = '<div class="settings-note">Away from home, this phone is the only player — and it shows here once the app has started playing.</div>'; return; }
    if (!devices.length) { list.innerHTML = '<div class="settings-note">' + esc(err || "Nothing found yet — the network is being searched.") + "</div>"; return; }
    let html = "";
    for (const d of devices) {
      const sub = [d.model || (d.profile && d.profile.label) || "", d.renamed ? d.network_name : ""].filter(Boolean).join(" · ");
      const off = d.can_toggle && !d.enabled;
      html += '<div class="dev-row' + (d.online ? "" : " is-off") + (off ? " is-disabled" : "") + '">' +
        '<button type="button" class="dev-open" data-dev="' + esc(d.id) + '">' +
        '<span class="dev-ico">' + (ICONS[d.kind] || ICONS.upnp) + "</span>" +
        '<span class="dev-txt"><span class="dev-name">' + esc(d.name) + "</span>" + (sub ? '<span class="dev-sub">' + esc(sub) + "</span>" : "") + "</span>" +
        '<span class="dev-state' + (d.state === "playing" ? " is-playing" : "") + '">' + (off ? "Off" : stateWord(d)) + "</span>" +
        '<span class="dev-chev" aria-hidden="true">›</span></button>' +
        (d.can_toggle ? '<label class="switch dev-switch" title="' + (d.enabled ? "On: offered as a zone" : "Off: not offered as a zone") + '">' +
          '<input type="checkbox" data-dev-enable="' + esc(d.id) + '"' + (d.enabled ? " checked" : "") + ' aria-label="' + esc(d.name) + ' on">' +
          '<span class="switch-track"><span class="switch-thumb"></span></span></label>' : "") +
        "</div>";
    }
    if (away) html += '<div class="settings-note">' + (window.__musicdOffline
      ? "No network: this phone is the player, through its speaker, headphones, Bluetooth or a USB DAC. Sonos rooms and streamers come back with the network."
      : "Away from home, this phone is the only player. Sonos rooms and streamers are shown at home.") + "</div>";
    if (err) html += '<div class="settings-note away-error">' + esc(err) + "</div>";
    list.innerHTML = html;
  }

  function chip(kind, v, label, on, source, editable) {
    const tag = editable ? "button" : "span";
    return "<" + tag + (editable ? ' type="button"' : "") + ' class="cap-chip' + (on ? " is-on" : "") + (source === "later" ? " is-later" : "") +
      '" data-cap="' + kind + '" data-v="' + v + '" title="' + esc(SOURCE[source] || "") + '">' + esc(label) +
      (on && MARK[source] ? '<span class="cap-mark">' + MARK[source] + "</span>" : "") + "</" + tag + ">";
  }

  function renderDetail(keepInput) {
    const d = current;
    if (!d) return;
    // A refresh while a band is being typed would take the field away
    // mid-edit: the draft is kept and the block left as it is.
    if (keepInput && body.querySelector("[data-dsp-block]:focus-within")) return;
    title.textContent = d.name;
    desc.textContent = [d.model || (d.profile && d.profile.label) || "", d.manufacturer].filter(Boolean).join(" · ") ||
      (d.kind === "phone" ? "A phone running the Mandarin app" : "");
    const inp = keepInput && body.querySelector(".dev-name-input");
    const draft = inp && document.activeElement === inp ? inp.value : null;
    const ed = !!d.editable;
    let html = "";

    if (d.can_toggle) {
      html += '<div class="settings-block"><div class="settings-row"><span class="settings-label">' + (d.enabled ? "On" : "Off") + "</span>" +
        '<label class="switch"><input type="checkbox" data-dev-enable="' + esc(d.id) + '"' + (d.enabled ? " checked" : "") + ' aria-label="On">' +
        '<span class="switch-track"><span class="switch-thumb"></span></span></label></div>' +
        '<div class="settings-note">' + (d.enabled ? "Offered as a zone: in the zone picker and everywhere you play."
          : (d.kind === "upnp" ? "Not offered as a zone. A device found on the network stays off until you turn it on." : "Not offered as a zone.")) +
        "</div></div><div class=\"settings-divider\"></div>";
    }
    // Random album radio, per zone: what plays when this device's queue runs out.
    if (d.radio !== undefined && d.enabled && d.playable !== false) {
      html += '<div class="settings-block"><div class="settings-row"><span class="settings-label">Random album radio</span>' +
        '<label class="switch"><input type="checkbox" data-dev-radio="' + esc(d.id) + '"' + (d.radio ? " checked" : "") + ' aria-label="Random album radio">' +
        '<span class="switch-track"><span class="switch-thumb"></span></span></label></div>' +
        '<div class="settings-note">' + (d.radio
          ? "On. When this device’s queue ends, whole random albums keep coming — ones you haven’t played in the last two months."
          : "Off. When this device’s queue ends, it stops.") + "</div></div><div class=\"settings-divider\"></div>";
    }
    // A phone others at home may play to (v0.5.51).
    if (d.kind === "phone" && d.shared !== undefined) {
      html += '<div class="settings-block"><div class="settings-row"><span class="settings-label">Other devices can play here' + settingsInfo("At home, your other devices list this phone as a player while the Mandarin app is running on it, and can play to it and change its volume. Away from home it plays for itself only.") + "</span>" +
        '<label class="switch"><input type="checkbox" data-dev-shared="' + esc(d.id) + '"' + (d.shared ? " checked" : "") + ' aria-label="Other devices can play here">' +
        '<span class="switch-track"><span class="switch-thumb"></span></span></label></div>' +
        '<div class="settings-note">' + (d.shared
          ? "On. Your other devices at home can play here."
          : "Off. Only this phone plays to itself.") + "</div></div><div class=\"settings-divider\"></div>";
    }
    html += '<div class="settings-block"><div class="settings-block-title">Name</div>';
    if (d.kind === "phone") {
      html += '<div class="dev-kv"><span class="dev-v">' + esc(d.network_name) + '</span></div><div class="settings-note">Named in the app on the phone.</div>';
    } else {
      html += '<input class="dev-name-input" type="text" maxlength="60" value="' + esc(draft != null ? draft : d.name) + '" aria-label="Name" autocomplete="off" autocapitalize="words">' +
        '<div class="settings-note">On the network: ' + esc(d.network_name) +
        (d.renamed ? ' · <button type="button" class="dev-link" data-dev-reset>Use the network name</button>' : "") +
        (d.kind === "sonos" ? " · A name for Mandarin only; the Sonos app keeps its own." : "") + "</div>";
    }
    html += "</div>";

    const rows = [["Model", d.model], ["Made by", d.manufacturer], ["Firmware", d.firmware], ["Address", d.ip],
      ["Found by", d.found_by], ["Standard", d.kind === "upnp" ? (d.openhome ? "UPnP AV + OpenHome" : "UPnP AV / DLNA") : ""],
      ["Updates", d.kind === "upnp" && d.playable ? (d.events === "live" ? "Sent by the device (events)" : "Read every few seconds") : ""],
      ["Last seen", d.online ? "Now" : when(d.last_seen)], ["First seen", when(d.first_seen)]].filter(r => r[1]);
    html += '<div class="settings-divider"></div><div class="settings-block"><div class="settings-block-title">About</div><div class="dev-about">' +
      rows.map(r => '<div class="dev-kv"><span class="dev-k">' + esc(r[0]) + '</span><span class="dev-v">' + esc(r[1]) + "</span></div>").join("") + "</div>";
    if (d.kind === "upnp" && !d.playable) html += '<div class="settings-note away-error">This device offers no AVTransport service, so it cannot be played to.</div>';
    else if (d.kind === "upnp" && d.takes_flac === false) html += '<div class="settings-note away-error">This device doesn’t take FLAC, which is how Mandarin sends audio for now, so it isn’t offered as a zone yet.</div>';
    if (d.last_error && d.last_error.message) html += '<div class="settings-note away-error">Last trouble (' + esc(when(d.last_error.at)) + '): ' + esc(d.last_error.message) + "</div>";
    html += "</div>";

    html += '<div class="settings-divider"></div><div class="settings-block"><div class="settings-block-title">Capabilities</div>';
    html += '<div class="cap-group"><span class="cap-label">Sample rates (kHz)</span><div class="cap-chips">' +
      d.rates.map(r => chip("rate", r.hz, fmtRate(r.hz), r.on, r.source, ed)).join("") + "</div></div>";
    html += '<div class="cap-group"><span class="cap-label">Bit depth</span><div class="cap-chips">' +
      d.bits.map(b => chip("bits", b.n, b.n + "-bit", b.on, b.source, ed)).join("") + "</div></div>";
    // DSD (v0.6.0-RC3): sent as the file itself where the device says it takes
    // DSD files; tap one off and that multiple goes as PCM.
    const takesDsd = (d.containers || []).includes("dsd");
    html += '<div class="cap-group"><span class="cap-label">DSD</span><div class="cap-chips">' +
      d.dsd.map(x => chip("dsd", x.n, "DSD" + x.n, x.on, x.source, ed && takesDsd)).join("") + "</div></div>";
    if (d.containers && d.containers.length) {
      html += '<div class="cap-group"><span class="cap-label">Formats</span><div class="dev-v">' + esc(d.containers.map(c => c.toUpperCase()).join(", ")) + "</div></div>";
    }
    html += '<div class="cap-legend">' + (ed ? "Tap a rate or depth to change what Mandarin may send it. " : "") + "✓ confirmed by the device · ◆ known for this model · ✎ you set it.</div>";
    if (d.kind === "upnp") html += '<div class="settings-note">' + (takesDsd
      ? "DSD files go to it as they are, at the DSD rates that are on; any other goes as PCM. If DSD doesn’t play, tap it off."
      : "It doesn’t say it takes DSD files, so DSD goes to it as PCM.") + "</div>";
    if (d.kind === "sonos") html += '<div class="settings-note">Sonos plays up to 24-bit/48 kHz. Mandarin’s 24/48 rule applies; nothing to set here.</div>';
    if (d.kind === "phone") html += '<div class="settings-note">At home the phone plays the file as it is; away from home, Opus 256 kbps.</div>';
    if (d.profile && d.profile.notes) html += '<div class="settings-note">' + esc(d.profile.notes) + "</div>";
    html += "</div>";

    if (d.kind === "upnp") {
      const o = d.output || { mode: "original", bits: "auto", flac32: false };
      const seg = (name, opts, cur) => '<div class="seg" data-seg="' + name + '">' + opts.map(x =>
        '<button type="button" class="seg-btn' + (String(x.v) === String(cur) ? " is-on" : "") + '" data-seg-v="' + x.v + '"' + (x.off ? " disabled" : "") + ">" + esc(x.label) + "</button>").join("") + "</div>";
      const has32 = d.bits.some(b => b.n === 32 && b.on);
      const topOf = fam => { const on = d.rates.filter(r => r.on && (fam === 44100 ? r.hz % 44100 === 0 : r.hz % 44100 !== 0)).map(r => r.hz); return on.length ? Math.max(...on) : 0; };
      const outBits = (has32 && o.flac32 && o.bits !== 24) ? 32 : 24;
      const example = (() => {
        const top = topOf(44100);
        let rate = 44100;
        if (o.mode === "x2") rate = Math.min(88200, top || 44100); else if (o.mode === "x4") rate = Math.min(176400, top || 44100); else if (o.mode === "max") rate = top || 44100;
        if (o.mode === "original" || rate <= 44100) return "A 16-bit/44.1 kHz file plays as it is.";
        return "A 16-bit/44.1 kHz file plays as " + outBits + "-bit/" + (rate / 1000) + " kHz FLAC" + (rate === 176400 ? " (×4)" : rate === 88200 ? " (×2)" : "") + ".";
      })();
      html += '<div class="settings-divider"></div><div class="settings-block"><div class="settings-block-title">Output' + settingsInfo("Original sends the file as stored wherever this device takes its rate, depth and format; above its ceiling, FLAC at the highest rate it takes. Upsampling stays in the file's family (44.1 → 88.2 → 176.4; 48 → 96 → 192), runs in 64-bit float, and goes out at " + (has32 && o.flac32 ? "24 or 32 bits" : "24 bits") + ".") + "</div>" +
        '<div class="cap-group"><span class="cap-label">Mode</span>' +
        seg("mode", [{ v: "original", label: "Original" }, { v: "x2", label: "×2" }, { v: "x4", label: "×4" }, { v: "max", label: "Max" }], o.mode) + "</div>" +
        (has32 ? '<div class="cap-group"><span class="cap-label">Bit depth</span>' +
          seg("bits", [{ v: "auto", label: "Auto" }, { v: 24, label: "24" }, { v: 32, label: "32", off: !o.flac32 }], o.bits) +
          "" +
          (!o.flac32 ? '<div class="settings-note">32-bit needs an ffmpeg that writes 32-bit FLAC; this one stops at 24.</div>' : "") + "</div>" : "") +
        '<div class="settings-note">' + esc(example) + "</div>" +
        (d.can_fix_volume ? '<div class="settings-row" style="margin-top:14px"><span class="settings-label">Fixed volume</span>' +
          '<label class="switch"><input type="checkbox" data-dev-fixvol' + (d.volume_fixed ? " checked" : "") + ' aria-label="Fixed volume">' +
          '<span class="switch-track"><span class="switch-thumb"></span></span></label></div>' +
          '<div class="settings-note">' + (d.volume_fixed
            ? "The volume is set on the device itself (its knob, or its line out on fixed), so Mandarin shows no slider for it."
            : "Mandarin’s slider and mute drive the device. Turn on if the device’s volume is fixed — a WiiM on fixed line out, a Poly feeding a Mojo.") + "</div>" : "") +
        "</div>";
    }
    if (d.levelling) html += renderLevelling(d);
    if ((d.kind === "upnp" || d.kind === "phone") && d.dsp) html += renderDsp(d);
    if (d.kind === "phone" && isThisPhone(d)) html += renderUsb();
    if (!d.online) {
      html += '<div class="settings-divider"></div><div class="settings-block"><div class="settings-row"><span class="settings-label">Not on the network</span>' +
        '<button type="button" class="settings-update-btn" data-dev-forget' + (busy ? " disabled" : "") + ">Forget this device</button></div>" +
        '<div class="settings-note">Its name and settings go. If it turns up again it starts afresh.</div></div>';
    }
    if (err) html += '<div class="settings-note away-error">' + esc(err) + "</div>";
    body.innerHTML = html;
    drawDsp();
  }

  /*
   * Volume Levelling (v0.6.0-RC7): ReplayGain for this device — Off, Track,
   * Album or Auto; with it on, the target level and the adjustment for a
   * track whose loudness isn't known. Saved as soon as it's chosen.
   */
  const LV_MODES = [["off", "Off"], ["track", "Track"], ["album", "Album"], ["auto", "Auto"]];
  const infoBtn = t => ' <button class="settings-info-btn" type="button" data-info="' + esc(t) + '" aria-label="Info">ⓘ</button>';
  function renderLevelling(d) {
    const lv = d.levelling;
    const sel = (key, opts, cur) => '<div class="settings-select-wrap"><select class="settings-select" data-lv="' + key + '"' + (busy ? " disabled" : "") + ">" +
      opts.map(([v, label]) => '<option value="' + v + '"' + (String(v) === String(cur) ? " selected" : "") + ">" + esc(label) + "</option>").join("") + "</select></div>";
    const where = d.kind === "phone" ? "The app applies the gain itself, to streams and downloads alike."
      : "The gain goes into the stream: each track is sent as FLAC with it applied. Off sends every file as it is.";
    let html = '<div class="settings-divider"></div><div class="settings-block">' +
      '<div class="settings-row"><span class="settings-label">Volume levelling' + infoBtn("ReplayGain. Track plays every track at the same level. Album plays every record at the same level, its quiet and loud songs as they were made. Auto is Album while a record plays in order and Track when tracks from different records follow one another — a shuffle, a playlist, radio. Gains come from the files’ ReplayGain tags, or from Measure ReplayGain (Settings → Library Scanner); a track’s peak keeps it from being turned up into clipping. " + where + " A change is heard straight away, from where the music is.") +
      "</span>" + sel("mode", LV_MODES, lv.mode) + "</div>";
    if (lv.mode !== "off") {
      const targets = [];
      for (let n = -14; n >= -25; n--) targets.push([n, n + " LUFS" + (n === -14 ? " (Default)" : "")]);
      const unknown = [];
      for (let n = 0; n >= -12; n--) unknown.push([n, n + " dB" + (n === -5 ? " (Default)" : "")]);
      html += '<div class="settings-row"><span class="settings-label">Target volume level' + infoBtn("How loud every track is brought to. −14 LUFS is about the level streaming services play at; lower numbers play quieter and leave more room for loud peaks.") + "</span>" + sel("target", targets, lv.target) + "</div>" +
        '<div class="settings-row"><span class="settings-label">Volume adjustment when loudness is unknown' + infoBtn("For a track with no ReplayGain tags that hasn’t been measured: a fixed change instead, so it doesn’t jump out louder than the levelled tracks around it.") + "</span>" + sel("unknown", unknown, lv.unknown) + "</div>";
    }
    return html + "</div>";
  }

  /*
   * The USB DAC (Stage 9.1): only in the app, only on the page of the phone
   * the app is on. What the port holds, the permission for it, and what the
   * DAC's descriptors say it takes. Playing through it comes in 9.2, so the
   * switch is shown but not yet offered.
   */
  const USB = window.MusicdUsb || null;
  function isThisPhone(d) { try { return !!USB && USB.phoneZone() === d.id; } catch (e) { return false; } }
  function usbInfo() { try { return JSON.parse(USB.info()); } catch (e) { return { attached: false, error: e.message }; } }
  function renderUsb() {
    const u = usbInfo();
    let html = '<div class="settings-divider"></div><div class="settings-block"><div class="settings-block-title">USB DAC</div>';
    if (!u.attached) {
      html += '<div class="settings-note">Nothing on the USB port. Plug a DAC in and it shows here.</div></div>';
      return html;
    }
    const dev = u.device || {};
    const name = [dev.manufacturer, dev.name].filter(Boolean).join(" ");
    html += '<div class="settings-row"><span class="settings-label">' + esc(name || "USB audio device") + "</span>";
    if (!u.permission) html += '<button type="button" class="settings-update-btn" data-usb-allow>Allow</button>';
    html += "</div>";
    if (!u.permission) {
      html += '<div class="settings-note">Android asks once whether Mandarin may use this device; a yes is remembered for it.</div>';
      if (u.error) html += '<div class="settings-note away-error">' + esc(u.error) + "</div>";
      return html + "</div>";
    }
    const i = u.info;
    if (!i) return html + '<div class="settings-note away-error">' + esc(u.error || "Reading the DAC…") + "</div></div>";
    const rates = (i.rates || []).map(hz => chip("rate", hz, fmtRate(hz), true, "confirmed", false)).join("");
    const bits = (i.bits || []).map(n => chip("bits", n, n + "-bit", true, "confirmed", false)).join("");
    html += '<div class="cap-group"><span class="cap-label">Class</span><div class="dev-v">USB Audio Class ' + (i.uac === 2 ? "2" : "1") +
      (i.speed && i.speed !== "unknown" ? " · " + esc(i.speed) + " speed" : "") + " · " + esc(i.sync || "") + "</div></div>";
    html += '<div class="cap-group"><span class="cap-label">Sample rates (kHz)</span><div class="cap-chips">' + (rates || '<span class="dev-v">not stated</span>') + "</div></div>";
    html += '<div class="cap-group"><span class="cap-label">Bit depth</span><div class="cap-chips">' + (bits || '<span class="dev-v">not stated</span>') + "</div></div>";
    html += '<div class="cap-group"><span class="cap-label">DSD</span><div class="dev-v">' + (i.dsd ? "Native DSD offered" : "No native DSD in its descriptors (DoP may still work)") + "</div></div>";
    html += '<div class="cap-group"><span class="cap-label">Volume</span><div class="dev-v">' + (i.volume_control ? "The DAC has a USB volume control" : "No USB volume control (fixed at full)") + "</div></div>";
    if (i.current_rate) html += '<div class="cap-group"><span class="cap-label">Clock now</span><div class="dev-v">' + esc(fmtRate(i.current_rate)) + " kHz</div></div>";
    const st = u.stream;
    html += '<div class="settings-row" style="margin-top:14px"><span class="settings-label">USB direct' + settingsInfo("The app plays through its own USB driver: the DAC is fed the track at its own rate and the DAC’s depth, Android’s mixer out of the way — bit-perfect with the DSP off. A rate the DAC doesn’t take goes through Android as before. Off, the phone plays through Android’s mixer, at the mixer’s rate.") + "</span>" +
      '<label class="switch"><input type="checkbox" data-usb-direct' + (u.direct ? " checked" : "") + ' aria-label="USB direct">' +
      '<span class="switch-track"><span class="switch-thumb"></span></span></label></div>' +
      '<div class="settings-note">' + (u.direct
        ? "On. Through the app’s own USB driver, at the track’s own rate."
        : "Off. The phone plays through Android’s mixer, at the mixer’s rate.") + "</div>";
    if (u.direct) {
      const fixed = !!u.fixed;
      const limit = Number(u.limit) || 80;
      html += '<div class="settings-row" style="margin-top:14px"><span class="settings-label">Fixed volume</span>' +
        '<label class="switch"><input type="checkbox" data-usb-fixed' + (fixed ? " checked" : "") + ' aria-label="Fixed volume">' +
        '<span class="switch-track"><span class="switch-thumb"></span></span></label></div>' +
        '<div class="settings-note">' + (fixed
          ? "On. The DAC is driven at full and the amplifier sets the level — for a DAC into a preamp. Not for headphones on a DAC with its own volume control."
          : (i.volume_control
            ? "Off. The volume slider and the phone’s volume buttons drive the DAC’s own control. It starts at 10% whenever USB direct goes on or the DAC is plugged in — never at the DAC’s own level."
            : "Off. This DAC has no USB volume control, so the slider and the phone’s volume buttons scale the samples before they go out — no longer bit-perfect. Switch on for bit-perfect at full.")) + "</div>";
      if (!fixed) {
        html += '<div class="settings-row" style="margin-top:10px"><span class="settings-label">Volume limit</span>' +
          '<span class="dev-v" data-usb-limit-value>' + limit + '%</span></div>' +
          '<input type="range" min="10" max="100" step="5" value="' + limit + '" data-usb-limit aria-label="Volume limit" style="width:100%">' +
          '<div class="settings-note">The most the volume can be set to through USB — the slider stops here, so the DAC is never driven to full by mistake.</div>';
      }
    }
    if (u.direct && ((u.dsd_native || []).length || (u.dsd_dop || []).length)) {
      // DSD (Stage 9.3): natively where the DAC has a DSD alternate setting, as DoP where it takes 24-bit PCM at the rate, or PCM from the server.
      const nat = (u.dsd_native || []).map(n => "DSD" + n).join(", "), dop = (u.dsd_dop || []).map(n => "DSD" + n).join(", ");
      const mode = u.dsd_mode || "native";
      const opt = (v, label) => '<option value="' + v + '"' + (mode === v ? " selected" : "") + ">" + label + "</option>";
      html += '<div class="settings-row" style="margin-top:14px"><span class="settings-label">DSD</span><div class="settings-select-wrap"><select class="settings-select" data-usb-dsd>' +
        (nat ? opt("native", "Native") + opt("native_le", "Native, words reversed") : "") + (dop ? opt("dop", "DoP") : "") + opt("pcm", "PCM from the server") + "</select></div></div>" +
        '<div class="settings-note">' + (nat ? "Natively: " + nat + ". " : "") + (dop ? "As DoP: " + dop + ". " : "") +
        (mode === "pcm" ? "DSD files are converted to PCM on the server, as before." : mode === "dop" ? "DSD files go to the DAC as DoP (DSD over PCM), bit-perfect." :
          "DSD files go to the DAC as DSD, bit-perfect" + (mode === "native_le" ? ", each 32-bit word the other way round — for a DAC that plays noise with the usual order" : "") + (dop ? "; DoP where the rate isn’t native." : ".")) + "</div>";
    }
    if (st) {
      const s = st.stats || {};
      html += '<div class="cap-group"><span class="cap-label">Streaming now</span><div class="dev-v">' + (st.dsd ? "DSD" + st.dsd + (st.kind === "dop" ? " as DoP" : " native") : esc(fmtRate(st.rate)) + " kHz · " + esc(st.bits) + "-bit") +
        (u.fixed ? " · fixed volume" : (typeof st.level === "number" ? " · volume " + st.level + "%" + (st.software_volume ? " in software" : "") +
          (st.volume_db ? " (DAC range " + Number(st.volume_db.min).toFixed(1) + " to " + Number(st.volume_db.max).toFixed(1) + " dB)" : "") : "")) +
        (s.running === false ? " · paused" : "") +
        (s.feedback ? " · feedback " + Number(s.feedback).toFixed(3) + " frames/packet" : "") +
        (s.underruns ? " · " + s.underruns + " underrun" + (s.underruns === 1 ? "" : "s") : "") + (s.errors ? " · " + s.errors + " error" + (s.errors === 1 ? "" : "s") : "") + "</div></div>";
    }
    if (u.stream_error) html += '<div class="settings-note away-error">' + esc(u.stream_error) + "</div>";
    html += '<div class="settings-row" style="margin-top:10px"><span class="settings-label">Diagnostics</span><button type="button" class="settings-update-btn" data-usb-copy>Copy</button></div>' +
      '<div class="settings-note">Everything the DAC said about itself, as text — what a report needs.</div>';
    if (u.error) html += '<div class="settings-note away-error">' + esc(u.error) + "</div>";
    return html + "</div>";
  }
  window.__musicdUsbChanged = () => { if (current && current.kind === "phone" && isThisPhone(current)) renderDetail(true); };

  /*
   * DSP (v0.5.23): the switch, the parametric bands with their curve, the
   * headroom. Edits live in dspDraft until Save; the switch saves at once,
   * the draft with it. public/biquad.js draws the curve the server runs.
   */
  function renderDsp(d) {
    const dr = dspOf(d);
    const on = !!d.dsp.enabled;
    const B = window.Biquad;
    const peak = B ? B.peakDb(allBands(dr), 48000) : 0;
    const auto = autoHeadroom(dr);
    let html = '<div class="settings-divider"></div><div class="settings-block" data-dsp-block>' +
      '<div class="settings-row"><span class="settings-label">DSP' + settingsInfo(d.kind === "phone"
        ? "The app runs the headphone profile and the bands on everything this phone plays — the server's stream, Opus away from home, downloads — in 64-bit float, out through Bluetooth, USB or the speaker as float."
        : "Every track is decoded to 64-bit float, the headroom taken, upsampled if set, the bands run, then dithered to " + (d.output && d.output.flac32 && d.bits.some(b => b.n === 32 && b.on) && d.output.bits !== 24 ? "32" : "24") + " bits. Off, the device gets the file as stored (or the conversion the Output settings ask for).") + "</span>" +
      '<label class="switch"><input type="checkbox" data-dsp-on' + (on ? " checked" : "") + ' aria-label="DSP"><span class="switch-track"><span class="switch-thumb"></span></span></label></div>' +
      '<div class="settings-note">' + (on ? "On. A headphone profile and up to ten bands, on everything it plays."
        : d.kind === "phone" ? "Off. The app plays what it is given as it is." : "Off. The device gets the file as stored.") + "</div>";
    html += renderHeadphones(dr);
    html += '<div class="cap-group"><span class="cap-label">Parametric EQ · ' + dr.bands.length + ' of 10 bands</span>' +
      '<canvas class="dsp-curve" data-dsp-curve height="150" aria-label="The bands’ response"></canvas>';
    if (!dr.bands.length) html += '<div class="settings-note">No bands yet. Add one for each correction: a peak at a frequency, a shelf below or above one, or a pass filter.</div>';
    html += '<div class="dsp-bands">';
    dr.bands.forEach((b, i) => {
      html += '<div class="dsp-band" data-dsp-band="' + i + '">' +
        '<select class="dsp-type" data-dsp-f="type" aria-label="Type">' + BAND_TYPES.map(t => '<option value="' + t[0] + '"' + (t[0] === b.type ? " selected" : "") + ">" + t[1] + "</option>").join("") + "</select>" +
        '<label class="dsp-field"><span>Hz</span><input type="number" inputmode="decimal" min="10" max="24000" step="1" data-dsp-f="freq" value="' + esc(b.freq) + '"></label>' +
        '<label class="dsp-field' + (isPass(b.type) ? " is-off" : "") + '"><span>dB</span><input type="number" inputmode="decimal" min="-20" max="20" step="0.1" data-dsp-f="gain" value="' + esc(isPass(b.type) ? 0 : b.gain) + '"' + (isPass(b.type) ? " disabled" : "") + "></label>" +
        '<label class="dsp-field"><span>Q</span><input type="number" inputmode="decimal" min="0.1" max="20" step="0.01" data-dsp-f="q" value="' + esc(Math.round(b.q * 100) / 100) + '"></label>' +
        '<button type="button" class="dsp-remove" data-dsp-remove="' + i + '" aria-label="Remove band">×</button></div>';
    });
    html += "</div>";
    if (dr.bands.length < 10) html += '<button type="button" class="settings-update-btn dsp-add" data-dsp-add>Add band</button>';
    html += "</div>";
    const manual = typeof dr.headroom === "number";
    html += '<div class="cap-group"><span class="cap-label">Headroom</span>' +
      '<div class="seg" data-dsp-seg><button type="button" class="seg-btn' + (!manual ? " is-on" : "") + '" data-dsp-headroom="auto">Auto</button>' +
      '<button type="button" class="seg-btn' + (manual ? " is-on" : "") + '" data-dsp-headroom="set">Set</button></div>' +
      (manual ? '<label class="dsp-field dsp-headroom-set"><span>dB</span><input type="number" inputmode="decimal" min="-30" max="0" step="0.1" data-dsp-f="headroom" value="' + esc(dr.headroom) + '"></label>' : "") +
      '<div class="settings-note" data-dsp-headroom-note>' + esc(headroomNote(dr, peak, auto)) + "</div></div>";
    html += '<div class="dsp-actions"><span class="dsp-dirty" data-dsp-dirty>' + (dr.dirty ? "Not saved yet" : "") + '</span>' +
      '<button type="button" class="action-btn primary" data-dsp-save' + (dr.dirty ? "" : " disabled") + ">Save</button></div>";
    html += "</div>";
    return html;
  }
  function headroomNote(dr, peak, auto) {
    if (typeof dr.headroom === "number") return "Set by hand: " + fmtDb(dr.headroom) + " before the bands. Auto would take " + fmtDb(auto) + ".";
    if (!allBands(dr).length) return "Auto: nothing to take yet.";
    const own = dr.headphone && typeof dr.headphone.preamp === "number" ? dr.headphone.preamp : null;
    if (own != null && own === auto) return "Auto: " + fmtDb(auto) + " — the headphone profile's own preamp, which covers the bands' peak of " + fmtDb(peak) + ".";
    return "Auto: " + fmtDb(auto) + " before the bands — their peak together is " + fmtDb(peak) + ", and half a dB is kept under it so nothing clips." +
      (own != null ? " The profile's own " + fmtDb(own) + " would not cover it." : "");
  }

  /*
   * Headphones: an AutoEq profile (searched on the server, which fetches
   * and keeps it) or one pasted from a ParametricEQ.txt. The profile's
   * bands run before the PEQ's; they are shown, not edited.
   */
  function renderHeadphones(dr) {
    const hp = dr.headphone;
    const ui = dr.hp || null;
    let html = '<div class="cap-group" data-hp-group><span class="cap-label">Headphones</span>';
    if (hp) {
      html += '<div class="hp-current"><div class="hp-name">' + esc(hp.name || "Profile") + '</div><div class="hp-sub">' +
        esc((hp.source === "autoeq" ? "AutoEq · " : "") + hp.bands.length + " band" + (hp.bands.length === 1 ? "" : "s") + (typeof hp.preamp === "number" ? " · preamp " + fmtDb(hp.preamp) : "")) + "</div></div>";
    } else if (!ui) {
      html += '<div class="settings-note">None. A profile from AutoEq corrects a headphone’s measured response; pick yours, or paste one you have.</div>';
    }
    if (!ui) {
      html += '<div class="hp-actions"><button type="button" class="settings-update-btn" data-hp-choose>' + (hp ? "Change…" : "Choose from AutoEq…") + '</button>' +
        '<button type="button" class="settings-update-btn" data-hp-paste>Paste a profile…</button>' +
        (hp ? '<button type="button" class="settings-update-btn" data-hp-remove>Remove</button>' : "") + "</div>";
    } else if (ui.mode === "search") {
      html += '<div class="hp-search"><input type="search" class="dev-name-input" data-hp-q placeholder="Headphone name — HD 650, Aria, AirPods…" value="' + esc(ui.q || "") + '" autocomplete="off" autocapitalize="off">' +
        '<div class="hp-results" data-hp-results>' + renderHpResults(ui) + "</div>" +
        '<div class="hp-actions"><button type="button" class="settings-update-btn" data-hp-cancel>Cancel</button></div></div>';
    } else if (ui.mode === "paste") {
      html += '<div class="hp-paste"><input type="text" class="dev-name-input" data-hp-name placeholder="A name for it" maxlength="120" value="' + esc(ui.name || "") + '">' +
        '<textarea class="hp-text" data-hp-text rows="6" placeholder="Preamp: -6.1 dB&#10;Filter 1: ON LSC Fc 105 Hz Gain 6.4 dB Q 0.70&#10;Filter 2: ON PK Fc 8800 Hz Gain 5.1 dB Q 1.42">' + esc(ui.text || "") + "</textarea>" +
        (ui.error ? '<div class="settings-note away-error">' + esc(ui.error) + "</div>" : "") +
        '<div class="hp-actions"><button type="button" class="action-btn primary" data-hp-use>Use it</button><button type="button" class="settings-update-btn" data-hp-cancel>Cancel</button></div></div>';
    }
    html += "</div>";
    return html;
  }
  function renderHpResults(ui) {
    if (ui.busy) return '<div class="settings-note">Looking…</div>';
    if (ui.error) return '<div class="settings-note away-error">' + esc(ui.error) + "</div>";
    if (!ui.q || ui.q.trim().length < 2) return '<div class="settings-note">Type a name. AutoEq has profiles for most headphones and earphones that have been measured.</div>';
    if (!ui.results || !ui.results.length) return '<div class="settings-note">Nothing by that name. Try fewer words, or paste a profile.</div>';
    return ui.results.map(r => '<button type="button" class="hp-row" data-hp-pick="' + esc(r.id) + '"><span class="hp-row-name">' + esc(r.name) + '</span><span class="hp-row-sub">' + esc([r.source, r.rig, r.form].filter(Boolean).join(" · ")) + "</span></button>").join("");
  }
  let hpTimer = null;
  async function hpSearch(dr) {
    const ui = dr.hp; if (!ui) return;
    const q = (ui.q || "").trim();
    if (q.length < 2) { ui.results = []; ui.busy = false; paintHpResults(dr); return; }
    ui.busy = true; paintHpResults(dr);
    try { const j = await api("/api/dsp/headphones?q=" + encodeURIComponent(q)); if (dr.hp === ui && ui.q.trim() === q) { ui.results = j.results || []; ui.error = ""; } }
    catch (e) { if (dr.hp === ui) ui.error = e.message; }
    ui.busy = false; paintHpResults(dr);
  }
  function paintHpResults(dr) { const el = body.querySelector("[data-hp-results]"); if (el && dr.hp) el.innerHTML = renderHpResults(dr.hp); }
  async function hpPick(dr, id) {
    const ui = dr.hp; if (!ui) return;
    ui.busy = true; paintHpResults(dr);
    try {
      const j = await api("/api/dsp/headphones/profile?id=" + encodeURIComponent(id));
      dr.headphone = j.profile; dr.hp = null; dr.dirty = true;
      renderDetail();
      toast(j.profile.name + " — Save to use it");
    } catch (e) { ui.busy = false; ui.error = e.message; paintHpResults(dr); }
  }
  async function hpUse(dr) {
    const ui = dr.hp; if (!ui) return;
    try {
      const j = await api("/api/dsp/headphones/parse", "POST", { name: ui.name || "", text: ui.text || "" });
      dr.headphone = j.profile; dr.hp = null; dr.dirty = true;
      renderDetail();
    } catch (e) { ui.error = e.message; renderDetail(); }
  }
  function drawDsp() {
    const c = body.querySelector("[data-dsp-curve]");
    const B = window.Biquad;
    if (!c || !B || !current) return;
    const dr = dspOf(current);
    const cssW = c.clientWidth || 320, cssH = 150, dpr = window.devicePixelRatio || 1;
    c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
    const ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);
    const cs = getComputedStyle(document.documentElement);
    const col = n => cs.getPropertyValue(n).trim();
    const padL = 30, padR = 8, padT = 8, padB = 18;
    const W = cssW - padL - padR, H = cssH - padT - padB;
    const fx = f => padL + W * (Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20));
    const freqs = [];
    for (let i = 0; i <= 240; i++) freqs.push(Math.pow(10, Math.log10(20) + (Math.log10(20000) - Math.log10(20)) * i / 240));
    const r = B.response(allBands(dr), 48000, freqs);
    const pre = B.headroom(dspSetting(dr, true), 48000);
    const top = Math.max(6, Math.ceil(Math.max(...r.map(Math.abs), Math.abs(pre)) / 3) * 3);
    const fy = db => padT + H * (top - db) / (2 * top);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.font = "10px " + (col("--font-sans") || "sans-serif");
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.strokeStyle = col("--border") || "#444"; ctx.fillStyle = col("--text-faint") || "#888"; ctx.lineWidth = 1;
    for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      const x = Math.round(fx(f)) + 0.5;
      ctx.globalAlpha = [100, 1000, 10000].includes(f) ? 1 : .45;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + H); ctx.stroke();
      ctx.globalAlpha = 1;
      if ([20, 100, 1000, 10000, 20000].includes(f)) ctx.fillText(f >= 1000 ? (f / 1000) + "k" : String(f), x, padT + H + 4);
    }
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (const db of [top, top / 2, 0, -top / 2, -top]) {
      const y = Math.round(fy(db)) + 0.5;
      ctx.globalAlpha = db === 0 ? 1 : .45;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + W, y); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText((db > 0 ? "+" : "") + db, padL - 4, y);
    }
    // The bands' response, and — dashed — the same with the headroom taken.
    const line = (dbs, colour, dash) => {
      ctx.beginPath();
      dbs.forEach((db, i) => { const x = fx(freqs[i]), y = fy(db); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.setLineDash(dash || []); ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    };
    if (pre < 0) line(r.map(db => db + pre), col("--plum") || "#8b6fb0", [4, 4]);
    line(r, col("--accent") || "#c9a45c");
  }
  function bumpDsp() {
    const dr = dspOf(current);
    dr.dirty = true;
    const note = body.querySelector("[data-dsp-headroom-note]");
    const B = window.Biquad;
    if (note && B) note.textContent = headroomNote(dr, B.peakDb(allBands(dr), 48000), autoHeadroom(dr));
    const dirty = body.querySelector("[data-dsp-dirty]"); if (dirty) dirty.textContent = "Not saved yet";
    const save = body.querySelector("[data-dsp-save]"); if (save) save.disabled = false;
    drawDsp();
  }
  async function saveDsp(enabled) {
    const dr = dspOf(current);
    const on = enabled === undefined ? !!current.dsp.enabled : enabled;
    await patch({ dsp: dspSetting(dr, on) });
    if (!err) { dspDraft = null; toast(on ? (current.kind === "phone" ? "DSP saved — the phone has it" : "DSP saved — on from the next track") : "DSP is off"); }
    renderDetail();
  }

  async function open(id) {
    dspDraft = null;
    try { current = await api("/api/audio-devices/" + encodeURIComponent(id)); err = ""; }
    catch (e) { err = e.message; return renderList(); }
    renderDetail();
    if (window.__settingsShowView) window.__settingsShowView("device");
  }
  async function patch(payload) {
    if (!current) return;
    busy = true;
    try { current = await api("/api/audio-devices/" + encodeURIComponent(current.id), "PATCH", payload); err = ""; }
    catch (e) { err = e.message; }
    busy = false;
    renderDetail();
    load();
  }
  function toggleChip(el) {
    const kind = el.getAttribute("data-cap"), v = Number(el.getAttribute("data-v"));
    if (kind === "dsd") {
      // All off is allowed: DSD then goes as PCM.
      const on = current.dsd.filter(x => x.n === v ? !x.on : x.on).map(x => x.n);
      patch({ caps: { user: { dsd: on } } });
      return;
    }
    if (kind !== "rate" && kind !== "bits") return;
    const all = kind === "rate" ? current.rates.map(r => ({ v: r.hz, on: r.on })) : current.bits.map(b => ({ v: b.n, on: b.on }));
    const on = all.filter(x => x.v === v ? !x.on : x.on).map(x => x.v);
    if (!on.length) { toast("Leave at least one on", "error"); return; }
    patch({ caps: { user: { [kind === "rate" ? "rates" : "bits"]: on } } });
  }

  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-dev]");
    if (b) open(b.getAttribute("data-dev"));
  });
  // The switch on a row, or on the device's page: on or off, kept on the server.
  async function setEnabled(id, on, input) {
    if (busy) { input.checked = !on; return; }
    busy = true;
    try {
      const d = await api("/api/audio-devices/" + encodeURIComponent(id), "PATCH", { enabled: on });
      if (current && current.id === id) current = d;
      err = "";
      toast(on ? d.name + " is on — it’s in the zone picker now" : d.name + " is off");
    } catch (x) { err = x.message; input.checked = !on; }
    busy = false;
    if (current) renderDetail();
    load();
  }
  list.addEventListener("change", (e) => {
    const inp = e.target.closest("[data-dev-enable]");
    if (inp) setEnabled(inp.getAttribute("data-dev-enable"), inp.checked, inp);
  });
  if (rescan) {
    rescan.addEventListener("click", async () => {
      rescan.disabled = true; rescan.textContent = "Looking…";
      try { const j = await api("/api/audio-devices/rescan", "POST", {}); devices = j.devices || []; err = ""; }
      catch (e) { err = e.message; }
      rescan.disabled = false; rescan.textContent = "Look again";
      renderList();
    });
  }
  body.addEventListener("click", async (e) => {
    if (!current || busy) return;
    const c = e.target.closest("button.cap-chip");
    if (c) return toggleChip(c);
    const sb = e.target.closest(".seg-btn");
    if (sb && !sb.disabled) {
      const name = sb.closest(".seg").getAttribute("data-seg");
      const raw = sb.getAttribute("data-seg-v");
      const v = name === "bits" && raw !== "auto" ? Number(raw) : raw;
      return patch({ output: { [name]: v } });
    }
    const add = e.target.closest("[data-dsp-add]");
    if (add) { const dr = dspOf(current); if (dr.bands.length < 10) { dr.bands.push({ type: "peak", freq: 1000, gain: 0, q: 1.41 }); dr.dirty = true; renderDetail(); } return; }
    const rm = e.target.closest("[data-dsp-remove]");
    if (rm) { const dr = dspOf(current); dr.bands.splice(Number(rm.getAttribute("data-dsp-remove")), 1); dr.dirty = true; renderDetail(); return; }
    const hr = e.target.closest("[data-dsp-headroom]");
    if (hr) {
      const dr = dspOf(current);
      const B = window.Biquad;
      dr.headroom = hr.getAttribute("data-dsp-headroom") === "auto" ? "auto" : autoHeadroom(dr);
      dr.dirty = true; renderDetail(); return;
    }
    if (e.target.closest("[data-dsp-save]")) return saveDsp();
    if (e.target.closest("[data-hp-choose]")) { const dr = dspOf(current); dr.hp = { mode: "search", q: "", results: [] }; renderDetail(); const q = body.querySelector("[data-hp-q]"); if (q) q.focus(); return; }
    if (e.target.closest("[data-hp-paste]")) { const dr = dspOf(current); dr.hp = { mode: "paste", name: "", text: "" }; renderDetail(); return; }
    if (e.target.closest("[data-hp-cancel]")) { const dr = dspOf(current); dr.hp = null; renderDetail(); return; }
    if (e.target.closest("[data-hp-remove]")) { const dr = dspOf(current); dr.headphone = null; dr.dirty = true; renderDetail(); return; }
    const pick = e.target.closest("[data-hp-pick]");
    if (pick) return hpPick(dspOf(current), pick.getAttribute("data-hp-pick"));
    if (e.target.closest("[data-hp-use]")) return hpUse(dspOf(current));
    if (e.target.closest("[data-dev-reset]")) { await patch({ name: "" }); return toast("Back to its network name"); }
    if (e.target.closest("[data-usb-allow]")) { try { USB.request(); } catch (x) { toast(x.message, "error"); } return; }
    if (e.target.closest("[data-usb-copy]")) {
      try { await navigator.clipboard.writeText(USB.diagnostics()); toast("Copied — paste it into a report"); }
      catch (x) { toast("Couldn't copy: " + x.message, "error"); }
      return;
    }
    if (e.target.closest("[data-dev-forget]")) {
      if (!(await ask("Forget “" + current.name + "”?\n\nIts name and settings go. If it turns up again it starts afresh."))) return;
      busy = true;
      try { await api("/api/audio-devices/" + encodeURIComponent(current.id) + "/forget", "POST", {}); current = null; err = ""; toast("Forgotten"); }
      catch (x) { err = x.message; }
      busy = false;
      if (!current) { await load(); if (window.__settingsShowView) window.__settingsShowView("playback"); }
      else renderDetail();
    }
  });
  body.addEventListener("change", async (e) => {
    const sw = e.target.closest("[data-dev-enable]");
    if (sw) return setEnabled(sw.getAttribute("data-dev-enable"), sw.checked, sw);
    const fv = e.target.closest("[data-dev-fixvol]");
    if (fv) return patch({ output: { volume: fv.checked ? "fixed" : "upnp" } });
    const ud = e.target.closest("[data-usb-direct]");
    if (ud) { try { USB.setDirect(ud.checked); } catch (x) { toast(x.message, "error"); } return; }
    const uf = e.target.closest("[data-usb-fixed]");
    if (uf) { try { USB.setFixed(uf.checked); renderDetail(true); } catch (x) { toast(x.message, "error"); } return; }
    const ul = e.target.closest("[data-usb-limit]");
    if (ul) { try { USB.setLimit(Number(ul.value)); renderDetail(true); } catch (x) { toast(x.message, "error"); } return; }
    const udsd = e.target.closest("[data-usb-dsd]");
    if (udsd) { try { USB.setDsdMode(udsd.value); renderDetail(true); } catch (x) { toast(x.message, "error"); } return; }
    const dspOn = e.target.closest("[data-dsp-on]");
    if (dspOn) return saveDsp(dspOn.checked);
    const lv = e.target.closest("select[data-lv]");
    if (lv) {
      const key = lv.getAttribute("data-lv");
      await patch({ levelling: { [key]: key === "mode" ? lv.value : Number(lv.value) } });
      if (!err && key === "mode") toast("Volume levelling: " + (LV_MODES.find(m => m[0] === lv.value) || [, ""])[1]);
      return;
    }
    const bandType = e.target.closest("select[data-dsp-f='type']");
    if (bandType) {
      const dr = dspOf(current);
      const b = dr.bands[Number(bandType.closest("[data-dsp-band]").getAttribute("data-dsp-band"))];
      if (b) { b.type = bandType.value; if (isPass(b.type)) b.gain = 0; dr.dirty = true; renderDetail(); }
      return;
    }
    const sh = e.target.closest("[data-dev-shared]");
    if (sh) {
      const on = sh.checked;
      await patch({ shared: on });
      if (!err) toast(on ? "Your other devices can play to " + current.name : "Only " + current.name + " plays to itself now");
      return;
    }
    const rd = e.target.closest("[data-dev-radio]");
    if (rd) {
      const on = rd.checked;
      await patch({ radio: on });
      if (!err) toast(on ? "Random album radio is on for " + current.name : "Random album radio is off for " + current.name);
      return;
    }
    const inp = e.target.closest(".dev-name-input");
    if (inp && current && inp.value.trim() !== current.name) patch({ name: inp.value.trim() });
  });
  body.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.closest(".dev-name-input")) e.target.blur();
  });
  // A band's numbers as they are typed: the curve and the headroom follow.
  body.addEventListener("input", (e) => {
    if (!current) return;
    const ul = e.target.closest("[data-usb-limit]");
    if (ul) { const v = body.querySelector("[data-usb-limit-value]"); if (v) v.textContent = ul.value + "%"; return; }
    const hq = e.target.closest("[data-hp-q]");
    if (hq) { const dr = dspOf(current); if (dr.hp) { dr.hp.q = hq.value; clearTimeout(hpTimer); hpTimer = setTimeout(() => hpSearch(dr), 250); } return; }
    const hn = e.target.closest("[data-hp-name]"); if (hn) { const dr = dspOf(current); if (dr.hp) dr.hp.name = hn.value; return; }
    const ht = e.target.closest("[data-hp-text]"); if (ht) { const dr = dspOf(current); if (dr.hp) dr.hp.text = ht.value; return; }
    const inp = e.target.closest("input[data-dsp-f]");
    if (!inp) return;
    const dr = dspOf(current);
    const v = Number(inp.value);
    if (!Number.isFinite(v)) return;
    const f = inp.getAttribute("data-dsp-f");
    if (f === "headroom") { dr.headroom = Math.min(0, Math.max(-30, v)); return bumpDsp(); }
    const row = inp.closest("[data-dsp-band]");
    const b = row && dr.bands[Number(row.getAttribute("data-dsp-band"))];
    if (!b) return;
    if (f === "freq") b.freq = Math.min(24000, Math.max(10, v));
    else if (f === "gain") b.gain = Math.min(20, Math.max(-20, v));
    else if (f === "q") b.q = Math.min(20, Math.max(0.1, v));
    bumpDsp();
  });
  window.addEventListener("resize", () => { if (current && body.querySelector("[data-dsp-curve]")) drawDsp(); });
  navItem.addEventListener("click", () => { current = null; load(); });
  // Rows and states follow the network while either pane is open.
  setInterval(() => {
    if (busy) return;
    if (!pane.classList.contains("hidden") || !detail.classList.contains("hidden")) load();
  }, 10000);
})();

/* Settings → Library Scanner (v0.6.0-RC7; "Identify albums" before): the
 * identification scan's switch and its night window, how far it has got, what
 * it proposes, what it applied (undo), what it couldn't place (edit by hand)
 * — and Measure ReplayGain, the loudness of files without ReplayGain tags. */
(function initIdentifyPane() {
  const body = document.getElementById("identify-pane-body");
  const pane = document.querySelector('.settings-pane[data-pane="identify"]');
  const navItem = document.querySelector('.settings-nav-item[data-pane="identify"]');
  if (!body || !pane || !navItem) return;
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const toast = (m, kind) => { if (window.__showToast) window.__showToast(m, kind); };
  const num = n => Number(n || 0).toLocaleString();
  const SHOW = 60;
  let st = null, loud = null, busy = false, err = "", more = { proposed: false, unidentified: false, applied: false, rejected: false };
  let pack = null, packChecked = false;   // the MusicBrainz pack (v0.6.4)
  let packBrowse = null, packPlaces = [];   // choosing the pack's folder: { path, parent, dirs }
  let matching = null, matchDraft = "";   // the row whose barcode box is open, and what's typed in it

  async function api(url, payload) {
    const r = await fetch(url, payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  }
  async function load() {
    if (busy) return;
    try {
      const [a, b, c] = await Promise.all([api("/api/identify"), api("/api/loudness").catch(() => null),
        api("/api/identify/pack" + (packChecked ? "" : "?check=1")).catch(() => null)]);
      st = a; loud = b; pack = c; packChecked = true; err = "";
      if (pack && pack.job && !pack.job.error && pack.job.phase !== "done") followPack();
    } catch (e) { err = e.message; }
    render();
  }
  async function setMeasure(on) {
    if (busy) return;
    busy = true;
    try { loud = await api("/api/loudness", { measure: on }); err = ""; } catch (e) { err = e.message; }
    busy = false;
    render();
  }
  async function packAct(what) {
    if (busy) return;
    busy = true;
    try { pack = await api("/api/identify/pack/" + what, {}); err = ""; } catch (e) { err = e.message; }
    busy = false;
    render();
    if (what === "download") followPack();
  }
  // The download's progress, once a second until it's done.
  let following = false;
  async function followPack() {
    if (following) return;
    following = true;
    while (pack && pack.job && !pack.job.error && pack.job.phase !== "done") {
      await new Promise(r => setTimeout(r, 1000));
      try { pack = await api("/api/identify/pack"); } catch (e) { break; }
      if (!busy) render();
    }
    following = false;
    if (pack && pack.job && pack.job.phase === "done") toast("MusicBrainz pack ready");
  }
  const mbs = n => (Number(n || 0) / 1048576).toLocaleString(undefined, { maximumFractionDigits: 0 }) + " MB";
  const day = iso => { const d = new Date(iso || ""); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); };
  async function packGo(p) {
    try {
      if (!packPlaces.length) packPlaces = ((await api("/api/library/folders").catch(() => ({}))).mounts || []);
      packBrowse = await api("/api/library/browse?path=" + encodeURIComponent(p || "/")); err = "";
    } catch (e) { err = e.message; if (!packBrowse) packBrowse = { path: "/", parent: null, dirs: [] }; }
    render();
  }
  async function packFolder(dir) {
    if (busy) return;
    busy = true;
    // A pack already here is moved: it can take a minute between drives.
    if (pack && pack.installed) { pack = Object.assign({}, pack, { job: { phase: "moving" } }); render(); }
    try { pack = await api("/api/identify/pack/folder", { dir }); packBrowse = null; err = ""; toast("The pack’s folder is set"); }
    catch (e) { err = e.message; try { pack = await api("/api/identify/pack"); } catch (x) {} }
    busy = false;
    render();
  }
  const folderSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  function packBrowser() {
    const b = packBrowse;
    let html = '<div class="mf-browse-head"><button type="button" class="settings-update-btn" data-pack-cancel>Cancel</button>' +
      '<span class="mf-browse-path">' + esc(b.path) + "</span></div>";
    if (packPlaces.length) {
      html += '<div class="mf-places"><span class="mf-places-label">Mounted drives and shares</span>' +
        packPlaces.map(m => '<button type="button" class="mf-place' + (m.path === b.path ? " is-on" : "") + '" data-pack-go="' + esc(m.path) + '">' + esc(m.path) + "</button>").join("") + "</div>";
    }
    html += '<div class="mf-browse-list">';
    if (b.parent) html += '<button type="button" class="mf-dir mf-up" data-pack-go="' + esc(b.parent) + '"><span class="mf-ico">↰</span><span class="mf-name">Up</span></button>';
    for (const d of b.dirs) html += '<button type="button" class="mf-dir" data-pack-go="' + esc(d.path) + '"><span class="mf-ico">' + folderSvg + '</span><span class="mf-name">' + esc(d.name) + "</span></button>";
    if (!b.dirs.length) html += '<div class="settings-note">No folders in here.</div>';
    html += '</div><div class="mf-browse-foot"><button type="button" class="settings-update-btn mf-choose" data-pack-choose' + (busy || b.path === "/" ? " disabled" : "") + ">Keep the pack in “" + esc(b.path.split("/").pop() || b.path) + "”</button></div>";
    // Why it couldn't be kept there, by the button, not at the foot of the page.
    if (err) html += '<div class="settings-note away-error">' + esc(err) + "</div>";
    return html;
  }
  function packBlock() {
    if (!pack) return "";
    if (packBrowse) return '<div class="settings-divider"></div><div class="settings-block"><div class="settings-block-title">Where to keep the MusicBrainz pack</div>' + packBrowser() + "</div>";
    const have = pack.installed, job = pack.job, latest = pack.latest;
    let state, buttons = "";
    if (job && !job.error && job.phase === "moving") {
      state = "Moving the pack… between drives this takes a minute or two.";
    } else if (job && !job.error && job.phase !== "done") {
      const pc = job.total ? Math.floor(job.done / job.total * 100) : 0;
      state = job.phase === "checking" ? "Asking GitHub…" : "Downloading… " + pc + " % (" + mbs(job.done) + " of " + mbs(job.total) + ")";
    } else if (have) {
      state = num(have.releases) + " releases · from " + day(have.built) + " · " + mbs(have.size) + (pack.newer ? " · a newer one is out" : "");
      buttons = (pack.newer ? '<button type="button" class="id-btn is-primary" data-pack="download"' + (busy ? " disabled" : "") + ">Update</button>" : "") +
        '<button type="button" class="id-btn" data-pack="remove"' + (busy ? " disabled" : "") + ">Remove</button>";
    } else {
      const tight = latest && pack.free != null && pack.free < latest.size + 200 * 1048576;
      state = latest ? "Not downloaded. A " + mbs(latest.gz_size) + " download that unpacks to " + mbs(latest.size) + " in the folder below." +
        (tight ? ' <span class="away-error">Not enough room in this folder: choose another below.</span>' : "") : "Not downloaded." + (pack.check_error ? " (" + esc(pack.check_error) + ")" : "");
      buttons = '<button type="button" class="id-btn is-primary" data-pack="download"' + (busy || !latest ? " disabled" : "") + ">Download</button>";
    }
    return '<div class="settings-divider"></div><div class="settings-block">' +
      row("MusicBrainz pack" + info("Every MusicBrainz release with a barcode, with its tracks, kept on the server and refreshed weekly. Barcodes are matched here first, without asking musicbrainz.org; anything the pack lacks is asked for as before."),
        '<span class="id-actions">' + buttons + "</span>") +
      '<div class="settings-note">' + state + (job && job.error ? ' <span class="away-error">' + esc(job.error) + "</span>" : "") + "</div>" +
      // Where it's kept (v0.6.4): any folder the server can write to, on any drive.
      row("Folder" + info("The pack can live on any drive the server can write to. In Docker, mount the drive into the container first (for example -v /mnt/ssd/mandarin:/packs). A pack already downloaded is moved there."),
        pack.dir_fixed ? '<span class="away-value">Set by MBPACK_DIR</span>'
          : '<span class="id-actions">' + (pack.dir !== pack.data_dir ? '<button type="button" class="id-btn" data-pack-folder-reset' + (busy ? " disabled" : "") + ">Data folder</button>" : "") +
            '<button type="button" class="id-btn" data-pack-folder' + (busy ? " disabled" : "") + ">Change…</button></span>") +
      '<div class="settings-note">' + esc(pack.dir) + (pack.dir === pack.data_dir ? " (the data folder)" : "") + (pack.free != null ? " · " + mbs(pack.free) + " free" : "") +
        (pack.dir_problem && !(job && job.error === pack.dir_problem) ? ' <span class="away-error">' + esc(pack.dir_problem) + "</span>" : "") + "</div></div>";
  }
  async function act(url, payload, done) {
    if (busy) return;
    busy = true;
    try { st = await api(url, payload || {}); err = ""; if (done) toast(done); }
    catch (e) { err = e.message; }
    busy = false;
    render();
  }

  const sw = (attr, on, label) => '<label class="switch"><input type="checkbox" ' + attr + (on ? " checked" : "") + (busy ? " disabled" : "") +
    ' aria-label="' + esc(label) + '"><span class="switch-track"><span class="switch-thumb"></span></span></label>';
  const row = (label, right) => '<div class="settings-row"><span class="settings-label">' + label + "</span>" + right + "</div>";
  // The help behind ⓘ, as on every other settings page.
  const info = t => ' <button class="settings-info-btn" type="button" data-info="' + esc(t) + '" aria-label="Info">ⓘ</button>';
  const names = a => (a.artist ? esc(a.artist) + " — " : "") + esc(a.title);
  const btn = (act, off, label, primary) => '<button type="button" class="id-btn' + (primary ? " is-primary" : "") + '" data-id-act="' + act + '" data-id-off="' + off + '"' + (busy ? " disabled" : "") + ">" + label + "</button>";

  function status() {
    const s = st.settings;
    switch (st.reason) {
      case "off": return "Off.";
      case "waiting": return "Waits for " + esc(s.start) + " (the server's clock).";
      case "scanning": return "Paused while the library is being scanned.";
      case "unreachable": return "MusicBrainz isn't answering; trying again in a few minutes.";
      case "pack": return "MusicBrainz isn't answering, so the albums the MusicBrainz pack can answer are being matched from it: " + (st.current ? names(st.current) : "…");
      case "checking": return "Checking: " + (st.current ? names(st.current) : "…");
      case "starting": return "Starting…";
      default: return "Every album has been looked at. New ones are checked as they arrive.";
    }
  }

  // The pressing you have, as MusicBrainz sets it apart from the album:
  // "2015 remaster · released 2015" under a 1988 record.
  const version = c => {
    if (!c) return "";
    const bits = [];
    if (c.edition) bits.push(c.edition);
    if (c.release_year && c.year && c.release_year !== c.year) bits.push("released " + c.release_year);
    const p = c.parts || {};
    if (p.missing_tracks) bits.push(p.missing_tracks === 1 ? "1 track of the release missing here" : p.missing_tracks + " tracks of the release missing here");
    if (p.extra_tracks) bits.push(p.extra_tracks === 1 ? "1 track the release hasn't" : p.extra_tracks + " tracks the release hasn't");
    return bits.length ? " · " + esc(bits.join(", ")) : "";
  };
  function albumRow(it, kind) {
    const a = it.album, c = it.candidate;
    let line2 = "";
    const from = c && c.source === "itunes" ? " · from iTunes" : "";
    // Why it's short of 100 % (v0.6.3): the score's own reasons.
    const why = it.why && it.why.length ? " — " + esc(it.why.join(", ")) : "";
    if (kind === "proposed") line2 = "→ " + names(c) + (c.year ? " (" + c.year + ")" : "") + version(c) + " · " + it.similarity + " % alike" + why + (it.ambiguous ? " · two releases fit" : "") + from;
    else if (kind === "applied") line2 = "was " + names({ artist: it.scanned.artist, title: it.scanned.title }) + (c && c.year ? " · " + c.year : "") + version(c) + from;
    else if (kind === "unidentified") line2 = c ? "nearest: " + names(c) + " · " + it.similarity + " %" + why + from : "nothing with this title on MusicBrainz" + (st.settings.itunes ? " or iTunes" : "");
    else line2 = c ? "declined: " + names(c) : "";
    if (kind === "applied" && c && c.manual) line2 += " · matched by " + (c.manual === "barcode" ? "barcode" : c.manual === "pick" ? "you" : "link");
    // Found by what the files carry (v0.6.0-RC5).
    else if (kind === "applied" && c && c.matched_by) line2 += " · matched by " + (({ "musicbrainz-id": "the files' MusicBrainz ID", barcode: "barcode", "catalogue-number": "catalogue number", isrc: "ISRCs" }[c.matched_by] || c.matched_by) + (c.from_pack ? " (pack)" : ""));
    const actions = kind === "proposed" ? btn("accept", a.offset, "Accept", true) + btn("reject", a.offset, "Reject")
      : kind === "applied" ? btn("undo", a.offset, "Undo")
      : btn("recheck", a.offset, "Check again");
    // Everything but an applied album can be matched by hand: a barcode, or a link.
    const manual = kind === "applied" ? "" : '<button type="button" class="id-btn" data-id-match="' + a.offset + '" title="Match by barcode or MusicBrainz link"' + (busy ? " disabled" : "") + ">Barcode…</button>";
    const open = matching === a.offset;
    return '<div class="id-row' + (open ? " is-matching" : "") + '"><button type="button" class="id-open" data-id-open="' + a.offset + '">' +
      '<span class="id-name">' + names(a) + "</span>" + (line2 ? '<span class="id-sub">' + line2 + "</span>" : "") + "</button>" +
      '<span class="id-actions">' + actions + manual + "</span>" +
      (open ? '<form class="id-match" data-id-match-form="' + a.offset + '">' +
        '<input class="id-match-input" type="text" inputmode="numeric" autocomplete="off" placeholder="Barcode, or a MusicBrainz release link" aria-label="Barcode or MusicBrainz link" value="' + esc(matchDraft) + '">' +
        '<button type="submit" class="id-btn is-primary"' + (busy ? " disabled" : "") + ">Match</button></form>" +
        '<div class="settings-note id-match-note">The digits under the bars on the sleeve, or the address of the release (or album) on musicbrainz.org. That release is written to the album whatever the scan thought.</div>' : "") +
      "</div>";
  }

  function section(kind, title, note) {
    const list = st[kind] || [];
    if (!list.length) return "";
    const shown = more[kind] ? list : list.slice(0, SHOW);
    return '<div class="settings-divider"></div><div class="settings-block"><div class="settings-block-title">' + title + " (" + num(list.length) + ")</div>" +
      (note ? '<div class="settings-note" style="margin:0 0 10px">' + note + "</div>" : "") +
      '<div class="id-list">' + shown.map(it => albumRow(it, kind)).join("") + "</div>" +
      (shown.length < list.length ? '<button type="button" class="dev-link id-more" data-id-more="' + kind + '">Show all ' + num(list.length) + "</button>" : "") + "</div>";
  }

  function render() {
    if (!st) { body.innerHTML = '<div class="settings-note">' + esc(err || "Couldn’t ask the server.") + "</div>"; return; }
    const s = st.settings, p = st.progress;
    let html = '<div class="settings-block">' + row("Identify albums" + info("Each album is matched first by what its files carry — a MusicBrainz release ID, a barcode, a catalogue number with its label, the tracks’ ISRCs — then looked up on MusicBrainz by its title, track count and (where the tag can be trusted) its artist, scored against the tracks and their lengths. 95 % alike or better is applied: artist, title, year and track titles, kept in the database like an edit; your files are never touched. A near miss is proposed below; the rest are left for you. Albums you edited by hand are left alone."),
        sw("data-id-set=\"enabled\"", s.enabled, "Identify albums")) +
      '<div class="settings-note">The right names for each album, from its files and MusicBrainz.</div>' +
      row("Ask iTunes too" + info("An album MusicBrainz can’t place is looked up in Apple’s iTunes catalogue too — by barcode first, then by name; no account or key, a request every few seconds. Applied at 95 % alike or better, as a MusicBrainz match is; anything less is proposed. The album keeps the year its files carry, since Apple’s date is often a reissue’s."),
        sw("data-id-set=\"itunes\"", s.itunes !== false, "Ask iTunes too")) +
      '<div class="settings-note">A second opinion for what MusicBrainz can’t place.</div></div>';
    html += packBlock();
    // Measure ReplayGain: the server's loudness measuring (lib/loudness.js).
    if (loud) {
      const m = loud.settings || {};
      html += '<div class="settings-divider"></div><div class="settings-block">' +
        row("Measure ReplayGain" + info("Tracks without ReplayGain tags are measured on the server — EBU R128 loudness and true peak — one file at a time in the background, so Volume Levelling (Settings → Audio Devices → a device) can level them too. An album’s gain is worked out once all of its tracks are known. Your files are never changed."),
          '<label class="switch"><input type="checkbox" data-ld-measure' + (m.measure ? " checked" : "") + (busy ? " disabled" : "") + ' aria-label="Measure ReplayGain"><span class="switch-track"><span class="switch-thumb"></span></span></label>') +
        '<div class="settings-note">Loudness for tracks without ReplayGain tags.</div>' +
        '<div class="id-progress">' + num(loud.tagged) + " tagged · " + num(loud.measured) + " measured · " + num(loud.left) + " to measure" +
          (loud.failed ? " · " + num(loud.failed) + " couldn’t be read" : "") + "</div>" +
        (m.measure ? '<div class="settings-note">' + (loud.measuring ? "Measuring…" : "Every track is known.") + "</div>" : "") + "</div>";
    }
    html += '<div class="settings-divider"></div><div class="settings-block">' + row("Scheduling" + info("On: the scan runs between the start and end times each night, on the server’s clock. Off: it runs whenever the library isn’t being scanned. About twelve albums a minute, one MusicBrainz request a second, until every album has been looked at; new albums are checked as they arrive."),
      sw("data-id-set=\"schedule\"", s.schedule, "Scheduling"));
    if (s.schedule) {
      html += row("Start", '<input type="time" class="id-time" data-id-time="start" value="' + esc(s.start) + '"' + (busy ? " disabled" : "") + ' aria-label="Start">') +
        row("End", '<input type="time" class="id-time" data-id-time="end" value="' + esc(s.end) + '"' + (busy ? " disabled" : "") + ' aria-label="End">') +
        '<div class="settings-note">Each night, on the server’s clock.</div>';
    } else {
      html += '<div class="settings-note">Runs whenever the library isn’t being scanned.</div>';
    }
    html += "</div>";
    html += '<div class="settings-divider"></div><div class="settings-block"><div class="settings-block-title">Progress</div>' +
      '<div class="id-progress">' + num(p.checked) + " of " + num(p.eligible) + " albums checked · " + num(p.applied) + " applied · " + num(p.proposed) + " proposed · " + num(p.unidentified) + " unidentified</div>" +
      '<div class="settings-note">' + status() + "</div>" +
      ((p.proposed || p.unidentified) ? '<div class="settings-row" style="margin-top:12px"><span class="settings-label"></span><button type="button" class="settings-update-btn" data-id-recheck-all' + (busy ? " disabled" : "") + ">Check the proposed and unidentified again</button></div>" : "") +
      "</div>";
    html += section("proposed", "Proposed", "Close, but not close enough to apply unasked. Tap the name to see the album; Accept writes the names shown.");
    html += section("unidentified", "Unidentified", "Nothing near enough was found. Tap the name, then ⋯ → Edit album to name it yourself.");
    html += section("applied", "Applied", "Names written by the scan. Undo puts back what the album had.");
    html += section("rejected", "Declined");
    if (err && !packBrowse) html += '<div class="settings-note away-error">' + esc(err) + "</div>";
    body.innerHTML = html;
  }

  body.addEventListener("change", (e) => {
    if (e.target.closest("[data-ld-measure]")) return setMeasure(e.target.checked);
    const s = e.target.closest("[data-id-set]");
    if (s) return act("/api/identify/settings", { [s.getAttribute("data-id-set")]: s.checked });
    const t = e.target.closest("[data-id-time]");
    if (t && /^\d{1,2}:\d{2}$/.test(t.value)) return act("/api/identify/settings", { [t.getAttribute("data-id-time")]: t.value });
  });
  body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-id-act]");
    if (b) {
      const what = b.getAttribute("data-id-act");
      const said = { accept: "Applied", reject: "Declined", undo: "Put back", recheck: "It will be looked at again" }[what];
      return act("/api/identify/" + what, { offset: Number(b.getAttribute("data-id-off")) }, said);
    }
    if (e.target.closest("[data-pack-folder]")) { err = ""; return packGo((pack && pack.dir) || "/"); }
    if (e.target.closest("[data-pack-folder-reset]")) return packFolder(null);
    if (e.target.closest("[data-pack-cancel]")) { packBrowse = null; err = ""; return render(); }
    const pg = e.target.closest("[data-pack-go]");
    if (pg) { err = ""; return packGo(pg.getAttribute("data-pack-go")); }
    if (e.target.closest("[data-pack-choose]")) return packFolder(packBrowse.path);
    const pk = e.target.closest("[data-pack]");
    if (pk) return packAct(pk.getAttribute("data-pack"));
    if (e.target.closest("[data-id-recheck-all]")) return act("/api/identify/recheck-all", {}, "They will be looked at again");
    const mb = e.target.closest("[data-id-match]");
    if (mb) {
      const off = Number(mb.getAttribute("data-id-match"));
      matching = matching === off ? null : off; matchDraft = "";
      render();
      const inp = body.querySelector(".id-match-input");
      if (inp) inp.focus();
      return;
    }
    const m = e.target.closest("[data-id-more]");
    if (m) { more[m.getAttribute("data-id-more")] = true; return render(); }
    const o = e.target.closest("[data-id-open]");
    if (o && window.__openAlbum) {
      const off = Number(o.getAttribute("data-id-open"));
      const it = ["proposed", "unidentified", "applied", "rejected"].flatMap(k => st[k] || []).find(x => x.album.offset === off);
      if (!it) return;
      const closer = document.querySelector("#settings-overlay [data-settings-close]");
      if (closer) closer.click();
      window.__openAlbum(it.album, { source: "home", filter: null });
    }
  });
  body.addEventListener("input", (e) => { if (e.target.closest(".id-match-input")) matchDraft = e.target.value; });
  body.addEventListener("submit", async (e) => {
    const f = e.target.closest("[data-id-match-form]");
    if (!f) return;
    e.preventDefault();
    const q = matchDraft.trim();
    if (!q) return;
    const off = Number(f.getAttribute("data-id-match-form"));
    await act("/api/identify/match", { offset: off, query: q }, "Matched and applied");
    if (!err) { matching = null; matchDraft = ""; render(); }
  });
  navItem.addEventListener("click", () => { packChecked = false; packBrowse = null; more = { proposed: false, unidentified: false, applied: false, rejected: false }; matching = null; matchDraft = ""; load(); });
  // Progress moves while the pane is open (not while you're typing in it).
  setInterval(() => {
    if (pane.classList.contains("hidden") || busy || matching !== null || packBrowse) return;
    if (document.activeElement && document.activeElement.closest(".id-time")) return;
    load();
  }, 5000);
})();

/* ------------------------------------------------------------------ */
/*  Settings → UI Settings (v0.6.5): text sizes, the walls' columns or */
/*  list, and the tile size — on this device (window.__uiPrefs).        */
/* ------------------------------------------------------------------ */
(function initUiPane() {
  const pane = document.querySelector('.settings-pane[data-pane="ui"]');
  if (!pane || !window.__uiPrefs) return;
  const sels = { text: "ui-text-select", title: "ui-title-select", menu: "ui-menu-select", layout: "ui-layout-select", tile: "ui-tile-select" };
  function paint() {
    const desk = window.__uiPrefs.isDesktop();
    for (const [k, id] of Object.entries(sels)) {
      const el = document.getElementById(id);
      if (!el) continue;
      // +75% and +100% are offered on a desktop only.
      el.querySelectorAll("option[data-desktop]").forEach(o => { o.hidden = !desk; o.disabled = !desk; });
      el.value = window.__uiPrefs.get(k);
    }
  }
  for (const [k, id] of Object.entries(sels)) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => { window.__uiPrefs.set(k, el.value); paint(); });
  }
  const navItem = document.querySelector('.settings-nav-item[data-pane="ui"]');
  if (navItem) navItem.addEventListener("click", paint);
  paint();
})();

(function initAwayPane() {
  const body = document.getElementById("away-pane-body");
  const pane = document.querySelector('.settings-pane[data-pane="away"]');
  const navItem = document.querySelector('.settings-nav-item[data-pane="away"]');
  if (!body || !pane || !navItem) return;
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let st = null, busy = false, err = "";

  async function load() {
    try {
      const r = await fetch("/api/tailscale", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      st = await r.json();
    } catch (e) { st = null; }
    render();
  }

  async function act(what, payload) {
    if (busy) return;
    busy = true; err = ""; render();
    try {
      const r = await fetch("/api/tailscale/" + what, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
      st = j;
      if (what === "login" && j.auth_url) window.open(j.auth_url, "_blank", "noopener");
    } catch (e) { err = e.message; }
    busy = false; render();
  }

  function line(label, value) {
    return '<div class="settings-row"><span class="settings-label">' + label + '</span><span class="away-value">' + value + "</span></div>";
  }

  function render() {
    if (!st) { body.innerHTML = '<div class="settings-note">Couldn’t ask the server.</div>'; return; }
    if (!st.available) {
      body.innerHTML = '<div class="settings-note">Tailscale can’t be built in here — it runs in the Docker image (Linux, x64 or ARM64). Tailscale on the machine the server runs on works as before.</div>';
      return;
    }
    const toggle = '<label class="switch"><input type="checkbox" data-away-enable' + (st.enabled ? " checked" : "") + (busy ? " disabled" : "") + '>' +
      '<span class="switch-track"><span class="switch-thumb"></span></span></label>';
    let html = '<div class="settings-row"><span class="settings-label">Built-in Tailscale</span>' + toggle + "</div>";
    const state = !st.enabled ? "off" : st.state;
    const words = {
      off: "Off",
      Stopped: "Starting…",
      Downloading: "Getting Tailscale…",
      Starting: "Starting…",
      NoState: "Starting…",
      NeedsLogin: "Not signed in yet",
      NeedsMachineAuth: "Waiting for approval in the Tailscale admin console",
      Running: st.serving ? "Connected" : "Connecting…"
    };
    html += line("Status", esc(words[state] || state));
    if (state === "Running") {
      if (st.dns_name) html += line("Name", esc(st.dns_name));
      if (st.address) html += line("Address", esc(st.address.replace(/^http:\/\//, "")));
      html += '<div class="settings-row"><span class="settings-label"></span><button type="button" class="settings-update-btn" data-away-act="logout"' + (busy ? " disabled" : "") + ">Sign out of Tailscale</button></div>";
      html += '<div class="settings-note">On your tailnet as “' + esc(st.hostname) + '”' + settingsInfo("The Mandarin app on your Android phone uses it by itself away from home (after being home once, to learn the address); sign the phone in to Tailscale " + (window.MusicdApp ? "under This phone below" : "in the app, under Settings → Away from home") + ". Anything else with Tailscale — an iPhone, a laptop — opens " + (st.address || "the address above") + ".") + "</div>";
    } else if (st.enabled) {
      const link = st.auth_url
        ? '<a class="settings-update-btn" href="' + esc(st.auth_url) + '" target="_blank" rel="noopener">Sign in to Tailscale</a>'
        : '<button type="button" class="settings-update-btn" data-away-act="login"' + (busy ? " disabled" : "") + ">Sign in to Tailscale</button>";
      html += '<div class="settings-row"><span class="settings-label"></span>' + link + "</div>";
      html += '<div class="settings-note">Sign in with the same account as your phone.' + settingsInfo("Opens Tailscale’s sign-in page. The server then joins your tailnet as “" + st.hostname + "” — nothing else to install. Free for personal use.") + "</div>";
    }
    if (err || st.error) html += '<div class="settings-note away-error">' + esc(err || st.error) + "</div>";
    body.innerHTML = html;
  }

  body.addEventListener("change", (e) => {
    const t = e.target.closest("[data-away-enable]");
    if (t) act("enable", { on: t.checked });
  });
  body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-away-act]");
    if (b) act(b.getAttribute("data-away-act"));
  });
  navItem.addEventListener("click", load);
  // While it's open: signing in happens in another tab, so look now and then.
  setInterval(() => { if (!pane.classList.contains("hidden") && !busy) load(); }, 3000);
})();


/* ------------------------------------------------------------------ */
/*  Toasts above the mini transport bar (v0.6.0): --toast-lift is how   */
/*  far its top edge is from the bottom of the screen, plus a gap, kept */
/*  current as the bar shows, hides or changes size; 0 without it.      */
/* ------------------------------------------------------------------ */
(function keepToastsAboveTransport() {
  const bar = document.getElementById("mini-transport");
  if (!bar) return;
  const root = document.documentElement;
  const update = () => {
    const r = bar.getBoundingClientRect();
    const shown = !bar.classList.contains("hidden") && r.height > 0 && getComputedStyle(bar).display !== "none";
    root.style.setProperty("--toast-lift", shown ? Math.ceil(window.innerHeight - r.top + 10) + "px" : "0px");
  };
  update();
  new MutationObserver(update).observe(bar, { attributes: true, attributeFilter: ["class", "style"] });
  if (window.ResizeObserver) new ResizeObserver(update).observe(bar);
  window.addEventListener("resize", update);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", update);
})();

/* ------------------------------------------------------------------ */
/*  Restart & shut down (v0.6.12): Settings → Restart & shut down.     */
/*  Restart stops the server and starts it again; Shut down stops it   */
/*  until it's started again (on a Mac, from the Mandarin icon). A     */
/*  screen over the page says what's happening, and reloads the page   */
/*  when the server answers again.                                     */
/* ------------------------------------------------------------------ */
(() => {
  const restartBtn = document.getElementById("power-restart");
  const shutBtn    = document.getElementById("power-shutdown");
  const shutRow    = document.getElementById("power-shutdown-row");
  const shutNote   = document.getElementById("power-shutdown-note");
  if (!restartBtn || !shutBtn) return;
  const ask = (q) => window.__confirmDialog ? window.__confirmDialog(q) : Promise.resolve(confirm(q));
  const toast = (m, kind) => { if (window.__showToast) window.__showToast(m, kind); };
  let info = null;

  const START_AGAIN = {
    icon: "To start it again, double-click Mandarin on the Mac's desktop. It also starts when you log in.",
    manual: "To start it again, start it the way it was started (for example npm start).",
    docker: ""
  };

  async function load() {
    try {
      const r = await fetch("/api/system/power", { cache: "no-store" });
      if (!r.ok) return;
      info = await r.json();
    } catch (e) { return; }
    shutRow.classList.toggle("hidden", !info.shutdown);
    shutNote.textContent = info.shutdown
      ? "Stops Mandarin until you start it again. " + (START_AGAIN[info.start_again] || "")
      : "In Docker, stop Mandarin with docker stop musicd-server and start it again with docker start musicd-server.";
  }
  document.querySelectorAll('.settings-nav-item[data-pane="power"]').forEach(b => b.addEventListener("click", load));

  // The screen over everything while the server is away.
  function cover(title, text) {
    let el = document.getElementById("power-cover");
    if (!el) {
      el = document.createElement("div");
      el.id = "power-cover";
      el.className = "power-cover";
      el.setAttribute("role", "alertdialog");
      el.innerHTML = '<div class="power-card"><div class="power-title"></div><p class="power-text"></p></div>';
      document.body.appendChild(el);
    }
    el.querySelector(".power-title").textContent = title;
    el.querySelector(".power-text").textContent = text;
  }

  // Reload once the server has gone away and answered again.
  function reloadWhenBack(everyMs) {
    let wasDown = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (r.ok && wasDown) { location.reload(); return; }
        if (!r.ok) wasDown = true;
      } catch (e) { wasDown = true; }
      setTimeout(tick, everyMs);
    };
    setTimeout(tick, everyMs);
  }

  async function post(url) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "The server said no");
    return j;
  }

  restartBtn.addEventListener("click", async () => {
    if (!(await ask("Restart Mandarin? Music playing from Mandarin stops, and it's back in a few seconds."))) return;
    restartBtn.disabled = true;
    try {
      await post("/api/system/restart");
      cover("Restarting Mandarin…", "This page reloads when it's back.");
      reloadWhenBack(1000);
    } catch (e) {
      restartBtn.disabled = false;
      toast(e.message, "error");
    }
  });

  shutBtn.addEventListener("click", async () => {
    if (!info) await load();
    const again = (info && START_AGAIN[info.start_again]) || "";
    if (!(await ask("Shut down Mandarin? Music playing from Mandarin stops. " + again))) return;
    shutBtn.disabled = true;
    try {
      const j = await post("/api/system/shutdown");
      cover("Mandarin is shut down", START_AGAIN[j.start_again] || again);
      // Started again (the icon, a login): this page comes back by itself.
      reloadWhenBack(5000);
    } catch (e) {
      shutBtn.disabled = false;
      toast(e.message, "error");
    }
  });
})();
