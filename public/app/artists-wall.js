/* The page's core: the Artists wall (bug list item 130), the row's Artists. */
// Every act an album of the library's is credited to, as round pictures in the
// shared album grid (#album-grid, so UI Settings' columns, sizes and list view
// hold here too): their own picture once the server has found one (item 129),
// else their first album's cover; their name and how many albums. Read a page
// at a time from /api/artists as <main> nears its end. Sort, top right, goes
// round A to Z, most albums and at random (kept); the row's Search opens
// "Find an artist", which the server answers (the whole library, not the
// pages read). A tap opens the artist's page (artist-view.js), whose Back
// brings this wall back as it was (park / unpark, as the labels browser's).
(function artistsWall() {
  "use strict";
  const SORTS = ["az", "albums", "random"];
  const WORD = { az: "A–Z", albums: "Most albums", random: "Random" };
  const SAY = { az: "A to Z", albums: "most albums", random: "random" };
  const PAGE = 120;
  const w = /** @type {any} */ (window);

  let active = false;
  let sort = "az";
  try { const s = localStorage.getItem("rra-artists-sort"); if (s && SORTS.includes(s)) sort = s; } catch (e) { /* localStorage optional */ }
  let seed = 1 + Math.floor(Math.random() * 100000);
  let find = "";
  let have = 0, total = -1, loading = false, seq = 0, findTimer = 0;

  const tools = document.createElement("div");
  tools.id = "artists-tools";
  tools.className = "labels-tools artists-tools hidden";
  tools.innerHTML =
    '<div class="search-box labels-search artists-search hidden">' +
      '<svg class="search-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
      '<input id="artists-find-input" type="search" inputmode="search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" placeholder="Find an artist…" aria-label="Find an artist" data-parity="artists.find-field">' +
      '<button id="artists-find-clear" class="search-clear" type="button" aria-label="Clear" data-parity="artists.find-clear">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
    '</div>' +
    '<button id="artists-sort-btn" class="icon-btn labels-sort-btn artists-sort-btn" type="button" data-parity="artists.sort"></button>' +
    '<button id="artists-search-btn" class="icon-btn" type="button" aria-label="Find an artist" title="Find an artist">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>';
  {
    const row = document.querySelector(".topbar-row");
    const before = document.getElementById("topbar-refresh");
    if (row) row.insertBefore(tools, before && before.parentNode === row ? before : null);
  }
  const box = /** @type {HTMLElement} */ (tools.querySelector(".artists-search"));
  const input = /** @type {HTMLInputElement} */ (tools.querySelector("#artists-find-input"));
  const clear = /** @type {HTMLElement} */ (tools.querySelector("#artists-find-clear"));
  const sortBtn = /** @type {HTMLElement} */ (tools.querySelector("#artists-sort-btn"));
  const glass = /** @type {HTMLElement} */ (tools.querySelector("#artists-search-btn"));
  const mainEl = document.querySelector("main");

  function paintSort() {
    const next = SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length];
    sortBtn.innerHTML = '<span class="labels-order-txt">' + WORD[sort] + "</span>";
    sortBtn.setAttribute("aria-label", "Sort: " + SAY[sort] + " — tap for " + SAY[next]);
    sortBtn.setAttribute("title", "Sort: " + SAY[sort]);
  }
  paintSort();
  // The tools show while the wall does; the field open in place of the glass.
  function paintTools() {
    tools.classList.toggle("hidden", !active);
    if (!active) box.classList.add("hidden");
    const open = active && !box.classList.contains("hidden");
    glass.classList.toggle("hidden", !active || open);
    tools.classList.toggle("is-searching", open);
    const title = document.getElementById("album-count");
    if (title) title.classList.toggle("is-hidden-by-search", open);
  }
  function heading() { setCountText(total < 0 ? "Artists" : "Artists · " + total); }

  /** One act's tile: the round picture (or their first letter), their name, how many albums. @param {any} a */
  function tile(a) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "album artist-tile"; btn.dataset.parity = "artists.artist";
    btn.setAttribute("aria-label", a.name);
    const art = document.createElement("div");
    art.className = "album-art-wrap is-round"; art.dataset.parity = "artists.artist-art";
    const letter = () => {
      const l = document.createElement("span");
      l.className = "artist-tile-letter"; l.textContent = String(a.name || "?").trim().charAt(0).toUpperCase();
      art.appendChild(l);
    };
    const key = a.photo_key || a.image_key;
    if (key) loadArt(art, key, tileImgSize(), (img) => { img.remove(); letter(); }); else letter();
    const meta = document.createElement("div");
    meta.className = "album-meta";
    const name = document.createElement("div"); name.className = "album-title"; name.textContent = a.name; name.dataset.parity = "artists.artist-name";
    const sub = document.createElement("div"); sub.className = "album-artist"; sub.dataset.parity = "artists.artist-subtitle";
    sub.textContent = a.albumCount === 1 ? "1 album" : a.albumCount + " albums";
    meta.appendChild(name); meta.appendChild(sub);
    btn.appendChild(art); btn.appendChild(meta);
    btn.addEventListener("click", () => { if (w.__showArtistAlbums) w.__showArtistAlbums(a.name); });
    return btn;
  }

  /** The next page, or the first ([fresh]: the wall starts again, for a new order or find). @param {boolean} fresh */
  async function more(fresh) {
    if (!active || (!fresh && (loading || (total >= 0 && have >= total)))) return;
    // Another screen took the grid without saying so: the wall is over.
    if (!fresh && have > 0 && !grid.querySelector(".artist-tile")) { exitArtists(); return; }
    const mine = fresh ? ++seq : seq;
    if (fresh) { have = 0; total = -1; renderSkeletons(computeAlbumCount()); if (mainEl) mainEl.scrollTop = 0; }
    loading = true;
    const q = "/api/artists?sort=" + sort + "&offset=" + have + "&limit=" + PAGE + (sort === "random" ? "&seed=" + seed : "") +
      (find ? "&q=" + encodeURIComponent(find) : "");
    try {
      const r = await fetch(q);
      const j = await r.json();
      if (!active || mine !== seq) return;
      if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
      if (have === 0) grid.innerHTML = "";
      const frag = document.createDocumentFragment();
      for (const a of j.artists || []) frag.appendChild(tile(a));
      grid.appendChild(frag);
      have += (j.artists || []).length;
      total = typeof j.total === "number" ? j.total : have;
      setBanner(null);
      heading();
      if (find && total === 0) {
        const none = document.createElement("div");
        none.className = "artists-none artist-view-empty"; none.dataset.parity = "artists.none";
        none.textContent = "No artist matches “" + find + "”";
        grid.appendChild(none);
      }
    } catch (e) {
      if (!active || mine !== seq) return;
      if (have === 0) grid.innerHTML = "";
      setBanner("Couldn't load artists: " + (e && e.message ? e.message : "no answer"), true);
    } finally {
      if (mine === seq) loading = false;
    }
    // A page that doesn't fill the screen: the next at once.
    if (active && mine === seq && mainEl && have < total && mainEl.scrollHeight <= mainEl.clientHeight + 600) more(false);
  }
  if (mainEl) mainEl.addEventListener("scroll", () => {
    if (active && !loading && have < total && mainEl.scrollTop + mainEl.clientHeight >= mainEl.scrollHeight - 600) more(false);
  }, { passive: true });

  function showArtists() {
    if (w.__leavePlaylistScreens) w.__leavePlaylistScreens();
    if (w.__clearSearchIfActive) w.__clearSearchIfActive();
    if (w.__exitArtistView) w.__exitArtistView({ restore: false });
    if (w.__exitLabels) w.__exitLabels();
    exitAlbumSelectMode();
    leaveLibraryWall();
    const hv = document.getElementById("home-view");
    if (hv) hv.classList.add("hidden");
    grid.classList.remove("hidden");
    if (w.__setTopbarNav) w.__setTopbarNav(true, false, false);   // Back (to Home), no Refresh, no search
    active = true;
    find = ""; input.value = ""; box.classList.add("hidden");
    paintTools();
    setBanner(null);
    total = -1; heading();
    more(true);
  }
  function exitArtists() {
    if (!active) return;
    active = false; seq++; loading = false;
    find = ""; input.value = "";
    paintTools();
  }
  // The artist view borrows the grid and hands it back on its Back: the wall
  // stops paging meanwhile, and comes back with its tiles, order and find.
  function parkArtists() {
    if (!active) return null;
    const state = { have, total, find, open: !box.classList.contains("hidden") };
    active = false; seq++; loading = false;
    paintTools();
    return state;
  }
  /** @param {any} state */
  function unparkArtists(state) {
    if (!state) return;
    active = true; have = state.have; total = state.total; find = state.find;
    input.value = find;
    box.classList.toggle("hidden", !state.open);
    paintTools();
  }

  function openFind() {
    box.classList.remove("hidden");
    paintTools();
    input.focus();
  }
  function closeFind() {
    input.value = "";
    box.classList.add("hidden");
    paintTools();
    if (find) { find = ""; more(true); }
  }
  glass.addEventListener("click", openFind);
  input.addEventListener("input", () => {
    clearTimeout(findTimer);
    findTimer = window.setTimeout(() => {
      const q = input.value.trim();
      if (q !== find) { find = q; more(true); }
    }, 250);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") closeFind(); });
  // × as on Home: the first tap clears the words, the next closes the field.
  clear.addEventListener("click", () => {
    if (input.value) { input.value = ""; if (find) { find = ""; more(true); } input.focus(); }
    else closeFind();
  });
  sortBtn.addEventListener("click", () => {
    sort = SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length];
    if (sort === "random") seed = 1 + Math.floor(Math.random() * 100000);
    try { localStorage.setItem("rra-artists-sort", sort); } catch (e) { /* localStorage optional */ }
    paintSort();
    more(true);
  });

  w.__showArtists = showArtists;
  w.__exitArtists = exitArtists;
  w.__parkArtists = parkArtists;
  w.__unparkArtists = unparkArtists;
  w.__openArtistsFind = () => { if (active) { if (box.classList.contains("hidden")) openFind(); else input.focus(); } };
})();
