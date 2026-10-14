/* The page's core (app.js until v1.0.5), 29 of 33: search beyond the library (Qobuz, Tidal, Pitchfork), opened and closed. */
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
const searchOpenBtn = document.getElementById("search-open");

const searchWrap = document.getElementById("topbar-search");
function openSearch() {
  searchRow.classList.add("open");
  if (searchWrap) searchWrap.classList.add("is-open");
  if (searchOpenBtn) {
    searchOpenBtn.classList.add("hidden");
    searchOpenBtn.setAttribute("aria-expanded", "true");
  }
  input.focus();
}
function closeSearch() {
  if (!searchRow.classList.contains("open")) return;
  input.value = "";
  stopSearch();
  input.blur();
  searchRow.classList.remove("open");
  if (searchWrap) searchWrap.classList.remove("is-open");
  if (searchOpenBtn) {
    searchOpenBtn.classList.remove("hidden");
    searchOpenBtn.setAttribute("aria-expanded", "false");
  }
}

if (searchOpenBtn) {
  searchOpenBtn.addEventListener("click", (e) => {
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
  if (!searchRow.classList.contains("open")) return;
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
