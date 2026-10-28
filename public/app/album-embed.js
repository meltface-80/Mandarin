/* The page's core: the album view on its own, for the Shelf (item 218); and the page opened at an artist, a label or a genre. */
// The owner: the Shelf's album view and the library's are the same screen. So the Shelf (shelf.html) shows an
// album in this page, held in a frame of its own over the shelf (/?embed=album): the album view alone, over the
// whole frame, the rest of the page out of sight (its bar, its walls, its row, its mini player: the Shelf has its
// own bar). The Shelf says which album, and the room it plays in (a message, { type: "musicd-album", album, zone });
// the page says when it is ready, when the album is closed, and where the album asks to go that isn't an album —
// an artist, a label, a genre ({ type: "musicd-go", what, arg }), which the Shelf opens as the whole page,
// /?go=<what>&arg=<name>, read below. Messages only from and to this page's own address.
(function albumEmbed() {
  "use strict";
  const w = /** @type {any} */ (window);
  const q = new URLSearchParams(location.search);
  const embedded = q.get("embed") === "album" && window.parent !== window;

  /** Once the page is up (app.js's startup: the server answered, the rooms read). @param {() => void} fn */
  function whenReady(fn) {
    if (w.__musicdReady) fn();
    else window.addEventListener("musicd-ready", () => fn(), { once: true });
  }

  // ---- The page opened at an artist, a label or a genre (/?go=…&arg=…) ----
  const go = q.get("go"), arg = q.get("arg");
  if (!embedded && go && arg) {
    history.replaceState(null, "", location.pathname);
    whenReady(() => {
      if (go === "genre") { if (w.__applyFilter) w.__applyFilter({ type: "genre", value: arg }); }
      else if (go === "artist" || go === "label") w.__musicdNative(go, arg);
    });
  }
  if (!embedded) return;

  // ---- The album view alone, in the Shelf's frame ----
  document.documentElement.classList.add("embed-album");
  const modal = document.getElementById("album-modal");
  /** @param {any} msg */
  const tell = (msg) => window.parent.postMessage(msg, location.origin);
  // Where the album asks to go that isn't an album: the Shelf opens it as the whole page. Set once the whole script
  // has run (a microtask), over what the parts after this one set.
  queueMicrotask(() => {
    w.__showArtistAlbums = (/** @type {string} */ name) => tell({ type: "musicd-go", what: "artist", arg: name });
    w.__showLabelAlbums = (/** @type {string} */ name) => tell({ type: "musicd-go", what: "label", arg: name });
    w.__applyFilter = (/** @type {any} */ f) => { if (f && f.type === "genre") tell({ type: "musicd-go", what: "genre", arg: f.value }); };
  });

  // Closed (its × or Back, Escape): the Shelf's case turns back. Watched, not hooked: every way the view closes ends with it hidden.
  let shown = false;
  if (modal) new MutationObserver(() => {
    const now = !modal.classList.contains("hidden");
    if (shown && !now) tell({ type: "musicd-album-closed" });
    shown = now;
  }).observe(modal, { attributes: true, attributeFilter: ["class"] });

  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || e.source !== window.parent) return;
    const m = e.data;
    // The Shelf's room changed with the album open: the page's too.
    if (m && m.type === "musicd-zone" && m.zone) { whenReady(() => w.__musicdNative("zone", m.zone)); return; }
    if (!m || m.type !== "musicd-album" || !m.album) return;
    whenReady(() => {
      // The Shelf's room: the page's too, quietly (no question about moving what plays: the Shelf asked its own).
      if (m.zone) w.__musicdNative("zone", m.zone);
      openAlbum(m.album, { source: "shelf" });
    });
  });
  whenReady(() => tell({ type: "musicd-album-ready" }));
})();
