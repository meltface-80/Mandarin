/* The page's core (app.js until v1.0.5), 6 of 33: Smart Picks, the label of the week, and an album's ⋯ menu. */
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
  return [{ label: label(), key: "album.service-favourite", onClick: async (b) => {
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

function buildFavButton(album, fresh, key) {
  const on0 = !!((fresh && fresh.favourite) || album.favourite);
  const b = document.createElement("button");
  b.type = "button";
  b.className = "overflow-btn fav-btn" + (on0 ? " is-on" : "");
  if (key) b.dataset.parity = key;   // the screens contract's (docs/specs/screens.json)
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
 * opens downwards under its button as a rule, but the box that clips it
 * (the nearest scrolling ancestor, within the window) is not always where
 * the rule expects: a playlist's menu at the foot of the screen, an album's
 * on a phone held sideways. A menu cut off at the
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
  // [opts.key], each item's [key]: the screens contract's (docs/specs/screens.json), where the menu is a contract screen's.
  if (opts.key) btn.dataset.parity = opts.key;
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
    if (it.key) b.dataset.parity = it.key;
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
  keepHomeScroll();   // Back comes to Home where it was (home-render.js)
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
  historyWallActive = false;
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
