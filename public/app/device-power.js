/* The page's core (app.js until v1.0.5), 17 of 33: a device's power, the Library wall shown, and Home's genres and cache. */
// ----- Device power (Roon standby / convenience switch) -------------------
//
// Roon can power the amp or DAC behind an output, but only through a SOURCE
// CONTROL the device itself exposes — most outputs have none, and for those
// there is nothing to show. So this sheet is a list of source controls, not of
// zones, and it is honest about an empty result rather than pretending the
// feature is missing.
//
// Unlike the grouping sheet these actions fire immediately: a power button
// that waits for an Apply is a power button people press twice.
const SOURCE_STATUS_LABEL = {
  selected:      "On — this input selected",
  deselected:    "On — another input selected",
  standby:       "In standby",
  indeterminate: "",
};

async function openDevicePowerSheet() {
  let list = [];
  try {
    const r = await fetch("/api/outputs", { cache: "no-store" });
    if (r.ok) { const j = await r.json(); if (Array.isArray(j.outputs)) list = j.outputs; }
  } catch (e) { /* leaves `list` empty — the empty state below explains it */ }

  openLibSheet("Device power", (body) => {
    // Re-read after every action so the status lines reflect the device, not
    // what we asked for — the same rule the mode buttons follow.
    const refresh = async () => {
      try {
        const r = await fetch("/api/outputs", { cache: "no-store" });
        if (r.ok) { const j = await r.json(); if (Array.isArray(j.outputs)) list = j.outputs; }
      } catch (e) { /* keep the previous list; paint() still renders something */ }
      paint();
    };

    const act = async (url, payload, btn) => {
      btn.disabled = true;
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          showToast(j.error || "Sonos refused that", "error");
        }
      } catch (e) {
        showToast("Could not reach the extension", "error");
      } finally {
        btn.disabled = false;
      }
      // Roon reports the new status asynchronously; give it a moment.
      setTimeout(refresh, 400);
    };

    const paint = () => {
      body.innerHTML = "";
      const withControls = list.filter(o => (o.source_controls || []).length);
      if (!withControls.length) {
        const note = document.createElement("div");
        note.className = "lib-sheet-note";
        note.textContent = list.length
          ? "None of your devices can be switched on or off from here."
          : "No Sonos rooms found. The server must share a network with your speakers (host networking), or set SONOS_HOSTS to a speaker's IP.";
        body.appendChild(note);
        return;
      }
      for (const o of withControls) {
        const controls = o.source_controls || [];
        const sec = document.createElement("div");
        sec.className = "lib-sheet-section";
        const label = document.createElement("div");
        label.className = "lib-sheet-section-label";
        label.textContent = o.display_name;
        sec.appendChild(label);

        for (const sc of controls) {
          const row = document.createElement("div");
          row.className = "dev-row";
          row.dataset.control = sc.control_key;

          const text = document.createElement("div");
          text.className = "dev-text";
          const nm = document.createElement("span");
          nm.className = "dev-name";
          nm.textContent = sc.display_name;
          text.appendChild(nm);
          const st = SOURCE_STATUS_LABEL[sc.status] || "";
          if (st) {
            const stEl = document.createElement("span");
            stEl.className = "dev-status";
            stEl.textContent = st;
            text.appendChild(stEl);
          }
          row.appendChild(text);

          const actions = document.createElement("div");
          actions.className = "dev-actions";
          if (sc.supports_standby) {
            const pwr = document.createElement("button");
            pwr.type = "button";
            pwr.className = "dev-btn" + (sc.status === "standby" ? "" : " is-on");
            pwr.dataset.action = "standby";
            pwr.textContent = "Power";
            pwr.setAttribute("aria-label",
              sc.status === "standby" ? "Wake " + sc.display_name
                                      : "Put " + sc.display_name + " into standby");
            pwr.addEventListener("click", () => act("/api/output/standby",
              { output_id: o.output_id, control_key: sc.control_key, mode: "toggle" }, pwr));
            actions.appendChild(pwr);
          }
          const sw = document.createElement("button");
          sw.type = "button";
          sw.className = "dev-btn";
          sw.dataset.action = "switch";
          sw.textContent = "Select input";
          sw.setAttribute("aria-label", "Switch " + sc.display_name + " to this input");
          sw.addEventListener("click", () => act("/api/output/convenience-switch",
            { output_id: o.output_id, control_key: sc.control_key }, sw));
          actions.appendChild(sw);
          row.appendChild(actions);
          sec.appendChild(row);
        }

        // Roon's standby() with no control_key covers every standby-capable
        // control at once. That is only a distinct action on a device with
        // more than one, so it appears only there.
        if (controls.filter(sc => sc.supports_standby).length > 1) {
          const all = document.createElement("button");
          all.type = "button";
          all.className = "dev-btn dev-all-off";
          all.dataset.action = "all-off";
          all.textContent = "Put whole device into standby";
          all.addEventListener("click", () => act("/api/output/standby",
            { output_id: o.output_id, mode: "standby" }, all));
          sec.appendChild(all);
        }
        body.appendChild(sec);
      }
    };
    paint();
  }, (foot, close) => {
    const done = document.createElement("button");
    done.type = "button"; done.className = "action-btn primary";
    done.textContent = "Done";
    done.addEventListener("click", close);
    foot.appendChild(done);
  });
}
window.__openDevicePowerSheet = openDevicePowerSheet;

async function showLibraryWall() {
  const m = enterFullWall("Library", true);
  libraryWallActive = true;
  renderLibraryControls();
  if (window.__watchServices) window.__watchServices();
  libWall.seq++;
  const mySeq = libWall.seq;
  libWall.offset = 0; libWall.loading = false; libWall.done = false;
  await fetchLibraryPage(mySeq, true);
  // Wide screens (9 columns) can swallow the first page without producing a
  // scrollbar — no scrollbar means no scroll events, so keep filling until
  // the viewport overflows (or the library runs out). fetchLibraryPage's
  // loading guard makes a concurrent scroll-handler fetch harmless (this
  // iteration then no-ops and the offset check below ends the loop).
  while (libraryWallActive && mySeq === libWall.seq && !libWall.done && !libWall.loading &&
         m && m.scrollHeight <= m.clientHeight + 200) {
    const before = libWall.offset;
    await fetchLibraryPage(mySeq, false);
    if (libWall.offset === before) break;   // page failed or empty — stop; scroll retries
  }
}

// Infinite scroll: <main> is the shared scroll container for every grid view;
// only act while the library wall owns it (labelsActive double-checks — the
// labels browser paints the same grid without touching the wall flags).
{
  const mainEl = document.querySelector("main");
  if (mainEl) {
    mainEl.addEventListener("scroll", () => {
      if (!libraryWallActive || labelsActive || libWall.loading || libWall.done) return;
      if (mainEl.scrollTop + mainEl.clientHeight >= mainEl.scrollHeight - 600) {
        fetchLibraryPage(libWall.seq, false);
      }
    }, { passive: true });
  }
}

// Section-header activation (click + Enter/Space) — one wiring for all four
// Home headers so keyboard behaviour can't drift between them.
function wireSectionHeader(id, handler) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("click", handler);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); }
  });
}

// Header taps: Not played → full unplayed grid; Random albums → full random
// wall; Library → full A-Z wall; Label of the week → label view.
{
  wireSectionHeader("home-unplayed-title", showUnplayedWall);
  wireSectionHeader("home-favourites-title", showFavouritesWall);
  wireSectionHeader("home-later-title", showLaterWall);
  wireSectionHeader("home-playlists-title", () => showPlaylists());
  wireSectionHeader("home-random-title", () => { if (window.__applyFilter) window.__applyFilter(null); });
  wireSectionHeader("home-library-title", showLibraryWall);
  wireSectionHeader("home-lotw-title", () => {
    const name = homeLotw && homeLotw.dataset.label;
    if (name && window.__showLabelAlbums) window.__showLabelAlbums(name);
  });
  wireSectionHeader("home-picks-title", showSmartPicks);
}

// Weighted-random pick from a list of { title, count }.
function pickWeightedSub(items) {
  let total = 0;
  for (const it of items) total += Math.max(1, it.count || 1);
  let r = Math.random() * total;
  for (const it of items) { r -= Math.max(1, it.count || 1); if (r <= 0) return it; }
  return items[items.length - 1];
}

// Render the genre buttons from card descriptors ({label, genre} or
// {label, group, parent}). Shared by the live loader and the cache repaint;
// the descriptors are plain data, so they persist and rebuild identically.
function renderHomeGenres(cards) {
  cards = cards || [];
  homeGenres.innerHTML = "";
  if (!cards.length) {
    homeGenres.innerHTML = '<div class="home-carousel-empty">No genres found.</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const c of cards) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "home-genre-card";
    card.textContent = c.label;
    card.addEventListener("click", () => {
      if (!window.__applyFilter) return;
      if (c.group) {
        // Pick a random sub-genre from the group; the breadcrumb keeps the
        // group label (e.g. "Rock/Metal"). Refreshing the grid reshuffles
        // that sub-genre; re-tapping the button picks a new one.
        const sub = pickWeightedSub(c.group);
        window.__applyFilter({ type: "genre", value: sub.title, parent: c.parent, label: c.label });
      } else {
        window.__applyFilter({ type: "genre", value: c.genre });
      }
    });
    frag.appendChild(card);
  }
  homeGenres.appendChild(frag);
}

async function loadHomeGenres() {
  if (!homeGenres) return;
  if (!rowHasContent(homeGenres)) homeGenres.innerHTML = '<div class="home-carousel-empty">Loading…</div>';
  try {
    const [genresRes, groupsRes] = await Promise.all([
      fetch("/api/filters/genres").catch(() => null),
      fetch("/api/home/genre-groups").catch(() => null)
    ]);
    if ((genresRes && genresRes.status === 503) || (groupsRes && groupsRes.status === 503)) {
      if (!rowHasContent(homeGenres)) homeGenres.innerHTML = '<div class="home-carousel-empty">Reading your music library…</div>';
      return;   // keep any cached cards while the index builds
    }
    const genresJ = genresRes ? await genresRes.json().catch(() => ({})) : {};
    const groupsJ = groupsRes ? await groupsRes.json().catch(() => ({})) : {};
    // Pull extra genres up front — splitting Pop/Rock adds a card, and we trim
    // down to an even count afterwards so the 2-column grid has full rows.
    const top = ((genresJ && genresJ.genres) || []).slice(0, 16); // biggest first
    const groups = groupsJ || {};
    const parent = groups.parent;

    // Build card descriptors. The "Pop/Rock" parent is split into two buttons:
    // "Rock/Metal" (curated rock/metal sub-genres) and "Pop" (pop sub-genres).
    // Rock/Metal and Pop are pushed FIRST so they always survive the trim.
    const cards = [];
    const haveRockMetal = groups.rockmetal && groups.rockmetal.length;
    const havePop = groups.pop && groups.pop.length;
    if (parent && (haveRockMetal || havePop)) {
      if (haveRockMetal) cards.push({ label: "Rock/Metal", group: groups.rockmetal, parent });
      if (havePop) cards.push({ label: "Pop", group: groups.pop, parent });
    }
    for (const g of top) {
      // Drop the raw Pop/Rock parent — it's represented by the split buttons.
      if (parent && /pop\s*\/\s*rock/i.test(g.title)) continue;
      cards.push({ label: g.title, genre: g.title });
    }

    // Target an even 12 buttons so the grid rows are balanced on every screen.
    // If we have more, keep the first 12 (biggest, Rock/Metal + Pop first); if
    // fewer, drop the last one when the count is odd.
    const MAX_CARDS = 12;
    if (cards.length > MAX_CARDS) cards.length = MAX_CARDS;
    if (cards.length % 2 === 1) cards.length -= 1;

    if (cards.length) {
      renderHomeGenres(cards);
      homeSectionsLoaded = true;   // populated — stop retrying on future visits
      saveHomeCache({ genres: cards });
    } else if (!rowHasContent(homeGenres)) {
      // Empty 200 (index still building after a restart) — keep the hydrated
      // cards if we have them; only show "No genres found." when nothing is
      // cached, rather than blanking a good cached row.
      renderHomeGenres([]);
    }
  } catch (e) {
    if (!rowHasContent(homeGenres)) homeGenres.innerHTML = '<div class="home-carousel-empty">Couldn’t load genres.</div>';
  }
}

// Instant open: repaint the last persisted Home rows immediately, before we've
// even reconnected to Roon. Returns true if it painted the main content, so
// the boot path can reveal Home right away instead of a blank "Connecting…".
// The live loaders (called by showHome once paired) then revalidate silently,
// swapping fresh data in without a "Loading…" flash. Seeding homeRowsLoadedAt
// lets the existing 5-minute TTL skip the unplayed/random refetch entirely on
// a quick reopen — but only when BOTH rows are recent: it's seeded from the
// OLDER of the two per-row timestamps, so a stale sibling (e.g. unplayed kept
// an old cache while random refreshed) forces a silent revalidation instead
// of riding the fresh row's freshness.
function hydrateHomeFromCache() {
  // Offline the saved Home is the server's: its albums aren't on the phone.
  // Only what the app answers (the phone's music and downloads) is shown.
  if (window.__musicdOffline) return false;
  const c = readHomeCache();
  if (!c) return false;
  // Order and enablement first: painting into the default order and then
  // reordering is a visible flash on every cold open.
  applyHomeLayout();
  let painted = false;
  // The strip: Random Album always; Album of the day only on its own day,
  // so a saved one from yesterday isn't painted.
  if (homeToday) { renderHomeToday(c.today && c.today.day === todayKey() ? c.today.aotd : null); }
  if (c.unplayed && homeUnplayed) { renderHomeUnplayed(c.unplayed.albums); homeUnplayedLoaded = true; painted = rowHasContent(homeUnplayed) || painted; }
  if (c.random   && homeRandom)   { renderHomeRandom(c.random);                              painted = rowHasContent(homeRandom)   || painted; }
  // Only when it was cached in the order that is current NOW. The other rows
  // hydrate stale-then-revalidate, but "stale" here means the wrong ORDER —
  // painting it would flash the previous sort on every cold open, which is
  // the very thing the row is supposed to be reflecting. A cache written
  // before this field existed has no librarySort, so it does not match and
  // the row simply loads fresh: no cache-key bump needed for that.
  // Painted, and still read again (v0.8.43): before, the copy kept from
  // last time counted as loaded, and albums added since stayed off the row
  // until the sort was changed.
  if (c.library && homeLibrary && c.librarySort === libSortKey()) {
    renderHomeLibrary(c.library);
  }
  if (c.lotw     && homeLotw)     { renderHomeLotw(c.lotw.label, c.lotw.albums); }
  if (c.history  && homeHistory)  { renderHomeHistory(c.history); }
  if (c.genres   && homeGenres)   { renderHomeGenres(c.genres); }
  if (!painted) return false;
  if (typeof c.unplayedAt === "number" && typeof c.randomAt === "number") {
    homeRowsLoadedAt = Math.min(c.unplayedAt, c.randomAt);   // honour the TTL across reopens
  }
  // Reveal Home so the cached content is actually on screen while we reconnect.
  if (homeView)     homeView.classList.remove("hidden");
  if (homeSections) homeSections.classList.remove("hidden");
  grid.classList.add("hidden");
  setTopbarNav(false, false, true);   // Home chrome: search box, no Back/Refresh
  return true;
}
