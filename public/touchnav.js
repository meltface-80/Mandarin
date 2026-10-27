// @ts-check
/*
 * touchnav.js — the touch layout's row along the foot of the screen (v0.9.6):
 * Home, Library, Artists (bug list item 130), Shelf while it is switched on and Search (item 210) under the
 * mini player, on a phone or a tablet in either orientation; and Home's own menu button, at its top left
 * (item 210: it was the row's first). A desktop (a mouse) never shows it: the
 * layout is style.css's "touch layout" section, under the same media query
 * as the touch-sized mini player.
 *
 * Each button works the page's own control, so there is one way to do each
 * thing: the menu is #menu-toggle's, Shelf is the side menu's own, Library is Home's "Library" heading's
 * (the full A–Z wall), Artists is the Artists wall (artists-wall.js), Search is the top bar's glass, and Home is the page's
 * own showHome. What covers the screen (an album's page) closes first, as
 * its Back would.
 *
 * It also tells the layout, on <html>, what is on screen: tn-home (Home, so
 * no top bar), tn-search (the search open, so the top bar is back with the
 * field across it), tn-lib (the Library wall), tn-filter (the Library's
 * filter, or the Labels list's or the Artists wall's find, open: the top bar back for its
 * field), tn-labels (the Labels list), tn-artists (the Artists wall), tn-np (Now playing, which
 * has its own transport and no row), tn-offline (offline: the pill at the
 * top of the screen, #offline-toast, bug list item 134).
 *
 * Elsewhere (the grid screens) the top bar has no strip: its buttons float
 * over the albums, which scroll up to the screen's edge, and the screen's
 * title (#album-count) is the page's heading, at the top of <main>, moved
 * there while the touch layout applies and back to the bar when it doesn't.
 * On the Library wall Search opens its filter ("starts with"), on the
 * Labels list its "Find a label" and on the Artists wall "Find an artist",
 * not Home's: their own glasses give way.
 */
(function touchNav() {
  "use strict";
  const nav = document.getElementById("touch-nav");
  if (!nav) return;
  const root = document.documentElement;
  /** @param {string} id */
  const byId = (id) => document.getElementById(id);
  const home = byId("home-view");
  const topbar = document.querySelector(".topbar");
  const search = byId("topbar-search");
  const offline = byId("offline-btn");
  const modal = byId("album-modal");
  const labels = byId("labels-tools");
  const artists = byId("artists-tools");
  /** @param {Element | null} el @param {string} cls */
  const has = (el, cls) => !!el && el.classList.contains(cls);

  /* What is on screen, as classes on <html> for style.css. */
  function sync() {
    const modalOpen = !!modal && !has(modal, "hidden");
    root.classList.toggle("tn-home", !!home && !has(home, "hidden"));
    root.classList.toggle("tn-search", has(search, "is-open"));
    root.classList.toggle("tn-lib", has(topbar, "lib-wall"));
    root.classList.toggle("tn-filter", has(topbar, "lib-filtering") || has(labels, "is-searching") || has(artists, "is-searching"));
    // The Labels list: its tools shown, with their order (#–Z), which one label's albums don't have.
    const order = byId("labels-sort-btn");
    root.classList.toggle("tn-labels", !!labels && !has(labels, "hidden") && !!order && !has(order, "hidden"));
    root.classList.toggle("tn-artists", !!artists && !has(artists, "hidden"));
    // Now playing (the album tab of the player's own screen): as app.js's onNowPlayingScreen.
    root.classList.toggle("tn-np", modalOpen && has(modal, "np-mode") && has(modal, "tab-album"));
    root.classList.toggle("tn-offline", !!offline && !has(offline, "hidden"));
  }
  const watched = [home, topbar, search, offline, modal];
  for (const el of watched) if (el) new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ["class"] });
  for (const el of [labels, artists]) if (el) new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ["class"], subtree: true });
  sync();

  /* An album's page over the screen closes, as its Back does. */
  function clearOver() {
    if (!modal || has(modal, "hidden")) return;
    const back = byId("modal-close-btn");
    if (back) back.click();
  }
  /* The screen already showing: back to its top, as a second tap does in other apps. */
  function toTop() {
    const main = document.querySelector("main");
    if (main) main.scrollTo({ top: 0, behavior: "smooth" });
  }
  const w = /** @type {any} */ (window);

  /** @param {string} id @param {(e: MouseEvent) => void} fn */
  function on(id, fn) {
    const b = byId(id);
    if (b) b.addEventListener("click", fn);
  }
  on("home-menu", () => { const m = byId("menu-toggle"); if (m) m.click(); });
  // The side menu's Shelf, as it opens it (app/menu-drawer.js): a page of its own, its "‹ Remote" back to this one.
  on("tnav-shelf", () => { const s = document.querySelector('#menu-overlay .menu-item[data-action="shelf"]'); if (s) /** @type {HTMLElement} */ (s).click(); });
  on("tnav-home", () => {
    const already = root.classList.contains("tn-home") && !(modal && !has(modal, "hidden"));
    clearOver();
    if (already && !root.classList.contains("tn-search")) { toTop(); return; }
    if (typeof w.__showHome === "function") w.__showHome();
  });
  on("tnav-library", () => {
    const already = root.classList.contains("tn-lib") && !(modal && !has(modal, "hidden"));
    clearOver();
    if (already) { toTop(); return; }
    const heading = byId("home-library-title");
    if (heading) heading.click();
  });
  on("tnav-artists", () => {
    const already = root.classList.contains("tn-artists") && !(modal && !has(modal, "hidden"));
    clearOver();
    if (already) { toTop(); return; }
    if (typeof w.__showArtists === "function") w.__showArtists();
  });
  on("tnav-search", (e) => {
    // The page closes its search on any tap outside it: this one opens it.
    e.stopPropagation();
    if (has(search, "is-open")) { const i = byId("search-input"); if (i) i.focus(); return; }
    clearOver();
    // The Library wall: its own filter, opened (its glass is hidden in this layout) or, open, its field.
    if (root.classList.contains("tn-lib")) {
      const field = /** @type {HTMLElement | null} */ (document.querySelector("#library-filter .lib-filter-input"));
      const glass = /** @type {HTMLElement | null} */ (document.querySelector("#library-filter .lib-filter-btn"));
      if (field) field.focus(); else if (glass) glass.click();
      return;
    }
    // The Labels list: "Find a label", opened or, open, its field.
    if (root.classList.contains("tn-labels")) {
      if (has(labels, "is-searching")) { const i = byId("labels-search-input"); if (i) i.focus(); }
      else { const glass = byId("labels-search-btn"); if (glass) glass.click(); }
      return;
    }
    // The Artists wall: "Find an artist", opened or, open, its field.
    if (root.classList.contains("tn-artists")) {
      if (typeof w.__openArtistsFind === "function") w.__openArtistsFind();
      return;
    }
    // The search is Home's: from anywhere else, Home first.
    if (has(search, "hidden") && typeof w.__showHome === "function") w.__showHome();
    const glass = byId("search-open");
    if (glass) glass.click();
    // Its row shown now, not when the watch above next runs (after this tap):
    // the field was focused while still hidden, so it took no focus, and the
    // Android app's keyboard waited for a second tap (v1.0.7). Focused here,
    // inside the tap, the keyboard comes up with it.
    sync();
    const field = byId("search-input");
    if (field && document.activeElement !== field) field.focus();
  });
  on("offline-toast", (e) => { e.stopPropagation(); if (offline) offline.click(); });

  /* The screen's title: the page's heading in the touch layout, the bar's otherwise. */
  const title = byId("album-count");
  const main = document.querySelector("main");
  if (title && title.parentNode && main) {
    const home0 = { parent: title.parentNode, next: title.nextSibling };
    const heading = document.createElement("div");
    heading.id = "tnav-heading";
    heading.className = "tnav-heading";
    main.insertBefore(heading, main.firstChild);
    const touch = window.matchMedia("(hover: none), (pointer: coarse)");
    const place = () => {
      if (touch.matches) { if (title.parentNode !== heading) heading.appendChild(title); }
      else if (title.parentNode !== home0.parent) home0.parent.insertBefore(title, home0.next && home0.next.parentNode === home0.parent ? home0.next : null);
    };
    place();
    touch.addEventListener("change", place);
  }
})();
