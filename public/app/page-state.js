/* The page's core (app.js until v1.0.5), 1 of 33: the page's elements, and the state its screens share. */
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
