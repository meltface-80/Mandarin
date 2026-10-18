/* The page's core (app.js until v1.0.5), 4 of 33: Home shown, its rows kept and drawn: tiles, Not played, Today and Random. */
// Where Home was scrolled to when a screen was opened from it (v1.0.7): a
// genre, a row's wall. Coming back puts Home there again, rather than at its
// top. Null: nothing kept, Home from its top.
let homeScrollKept = null;
function keepHomeScroll() {
  const m = document.querySelector("main");
  if (m && homeView && !homeView.classList.contains("hidden")) homeScrollKept = m.scrollTop;
}
// Show the Home landing (hide the wall). The wall loads lazily when entered.
function showHome() {
  const back = !!homeView && homeView.classList.contains("hidden");
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
  // Back from a screen opened from Home: where it was. Home tapped on Home: its top.
  if (m) m.scrollTop = back && homeScrollKept !== null ? homeScrollKept : 0;
  homeScrollKept = null;
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
  keepHomeScroll();
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
