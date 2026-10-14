/* The page's core (app.js until v1.0.5), 28 of 33: the library search. */
// ----- Library search (instant, prefix-aware; collapsible) -----
const input    = document.getElementById("search-input");
const clear    = document.getElementById("search-clear");
const statusEl = document.getElementById("search-status");
const searchRow      = document.getElementById("search-row");

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
  if (abort) { try { abort.abort(); } catch (e) { /* already settled */ } abort = null; }
  clearTimeout(retryTimer);
  clearTimeout(extTimer);
  if (extAbort) { try { extAbort.abort(); } catch (e) { /* already settled */ } extAbort = null; }
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
  if (abort) { try { abort.abort(); } catch (e) { /* already settled */ } }
  abort = new AbortController();
  clearTimeout(retryTimer);
  // Global search: the external sources (Qobuz/Tidal catalogues, Pitchfork
  // reviews) ride a LONGER debounce than the instant local-index search —
  // they're network calls against rate-limit-sensitive APIs. Scheduled
  // before the library fetch so external results appear even when the
  // library search errors or has zero matches.
  clearTimeout(extTimer);
  // Close behind the library's own debounce (v0.6.24; it was 600 ms): the
  // services' type-ahead is what their own apps do, and the server keeps
  // each answer for an hour.
  extTimer = setTimeout(() => runExternal(q, mySeq), 200);
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
