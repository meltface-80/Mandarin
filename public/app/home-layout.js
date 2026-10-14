/* The page's core (app.js until v1.0.5), 3 of 33: Music on device's Focus and Sort, and Home's layout: which rows show, in what order. */
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
