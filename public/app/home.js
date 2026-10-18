/* The page's core (app.js until v1.0.5), 2 of 33: the album filter, the look, the album count, and Home's rows: their elements, and the downloads row. */
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
// The list as last drawn: the app says downloads changed on every return to
// it and every track done, and redrawing a row that hasn't changed held the
// page up and sent the row back to its first tile.
let homeDownloadsShown = null;
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
    // (And the server's albums known: a row drawn while the server couldn't say is drawn again.)
    const shown = JSON.stringify(list) + "|" + downloadAlbums.size;
    if (shown === homeDownloadsShown && rowHasContent(homeDownloads)) return;
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
    homeDownloadsShown = JSON.stringify(list) + "|" + downloadAlbums.size;
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
let homeLocal = null, homeLocalKey = null, homeLocalShown = null;   // shown: as homeDownloadsShown
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
  const shown = JSON.stringify(list);
  if (list.length && shown === homeLocalShown && rowHasContent(homeLocal)) return;
  homeLocalShown = shown;
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
