/* The page's core (app.js until v1.0.5), 7 of 33: the full walls (Listen later, Favourites, Not played) and the Library wall's view. */
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

// Recently played, whole (v1.0.7): the row's title opens it, as the other rows' do.
async function showHistoryWall() {
  enterFullWall("Recently played", true);
  historyWallActive = true;
  try {
    const r = await fetch("/api/home/history?count=60", { cache: "no-store" });
    if (!historyWallActive) return;
    const j = await r.json();
    if (!historyWallActive) return;
    const albums = (j && j.albums) || [];
    grid.innerHTML = "";
    if (!albums.length) { setBanner("Nothing played in the last 30 days.", false); return; }
    setBanner(null);
    const frag = document.createDocumentFragment();
    for (const a of albums) frag.appendChild(homeTile(a));
    grid.appendChild(frag);
  } catch (e) {
    if (!historyWallActive) return;
    grid.innerHTML = "";
    setBanner("Couldn’t load: " + e.message, true);
  }
}
let historyWallActive = false;

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
