/* The page's core (app.js until v1.0.5), 33 of 33: a label's albums, the album multi-select's actions, and the select menu wired. */
// Where ‹ goes from one label's albums when they were opened from an
// album's page: back to that page, not to the list of all labels (v0.6.24).
let _labelsReturn = null;
async function showLabelAlbums(name, fromLabelsList = false, returnTo = null) {
  if (window.__leavePlaylistScreens) window.__leavePlaylistScreens();
  if (window.__clearSearchIfActive) window.__clearSearchIfActive();  // drop stale search results
  _labelsReturn = returnTo && returnTo.album ? returnTo : null;
  if (fromLabelsList) {
    // Came from a tap on the Labels grid — remember the grid scroll position.
    _labelsScrollSaved = mainEl ? mainEl.scrollTop : 0;
    _labelsScrollTarget = null;
  } else {
    // Deep-linked from an album view or search chip — there's no Labels-grid
    // scroll position to restore, so remember which label to scroll to on back.
    _labelsScrollSaved = 0;
    _labelsScrollTarget = name;
  }
  exitAlbumSelectMode();
  closeLabelLogoSheet();
  currentLabelName = name;
  mode = "albums";
  labelsActive = true;
  leaveLibraryWall();   // label albums own the shared grid now — stop the wall's infinite scroll
  { const _hv = document.getElementById("home-view"); if (_hv) _hv.classList.add("hidden"); }
  grid.classList.remove("hidden");
  if (window.__setTopbarNav) window.__setTopbarNav(true, false, false);   // Back (to Home), no Refresh, no search
  labelsBtn.classList.add("is-active");
  // The name is the top bar's title and its ‹ goes back to all labels.
  if (labelsBar)   labelsBar.classList.add("hidden");
  if (labelsTitle) labelsTitle.textContent = name;
  paintTools();
  setBanner(null);
  setCountText(name);
  renderSkeletons(computeAlbumCount());
  try {
    const r = await fetch("/api/label-albums?label=" + encodeURIComponent(name) +
                          "&order=" + encodeURIComponent(labelOrder()));
    const j = await r.json();
    // ‹ (or Home) while this was on its way: it no longer belongs on screen.
    if (!stillOnLabel()) return;
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    currentLabelLogoUrl = j.logo_url || null; // expose to logo picker
    const albums = j.albums || [];
    if (!albums.length) {
      grid.innerHTML = "";
      setBanner("No albums found for this label.", false);
      return;
    }
    setCountText(name);
    grid.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const a of albums) {
      // Label albums carry FULL-LIBRARY offsets; without the explicit
      // filter:null override a lingering genre/tag filter would resolve
      // them against the wrong (filtered) list — the offset misses, and
      // the stale-offset defense correctly refuses with "library changed"
      // even though nothing did. (Same override Home rows use.)
      frag.appendChild(buildAlbumTile(a, () => openAlbum(a, { filter: null })));
    }
    grid.appendChild(frag);
  } catch (e) {
    if (!stillOnLabel()) return;
    grid.innerHTML = "";
    setBanner("Couldn't load albums: " + e.message, true);
  }
  function stillOnLabel() { return labelsActive && mode === "albums" && currentLabelName === name; }
}

if (labelsBack) labelsBack.addEventListener("click", () => showLabelsList());
// The top bar's ‹ on one label's albums goes back to all labels, ahead of
// its usual "go Home" (v0.6.5; the "‹ All labels" pill it replaces is gone).
{
  const tb = document.getElementById("topbar-back");
  if (tb) tb.addEventListener("click", (e) => {
    if (!(labelsActive && mode === "albums")) return;
    if (window.__artistViewActive && window.__artistViewActive()) return;
    // Opened from an album's page: the usual ‹ (Home) runs, and the album's
    // page comes back over it.
    if (_labelsReturn) {
      const r = _labelsReturn; _labelsReturn = null;
      if (window.__openAlbum) setTimeout(() => window.__openAlbum(r.album, r.opts), 0);
      return;
    }
    e.stopImmediatePropagation();
    showLabelsList();
  }, true);
}

window.__exitLabelSelectMode = exitLabelSelectMode;

if (labelMergeBtn) {
  labelMergeBtn.addEventListener("click", async () => {
    if (labelsSelected.length < 2) return;
    labelMergeBtn.disabled = true;
    try {
      const r = await fetch("/api/labels/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: labelsSelected.map(s => ({ key: s.key, display: s.display })) })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Merge failed");
      exitLabelSelectMode();
      _lastLabelCount = -1;
      showLabelsList(false);
    } catch(e) {
      labelMergeBtn.disabled = false;
      if (window.__showToast) window.__showToast("Merge failed: " + e.message, "error");
    }
  });
}

if (labelMergeCancelBtn) labelMergeCancelBtn.addEventListener("click", exitLabelSelectMode);

if (labelUnmergeClose) {
  labelUnmergeClose.addEventListener("click", () => {
    if (labelUnmergeSheet) labelUnmergeSheet.classList.add("hidden");
  });
}

labelsBtn.addEventListener("click", () => {
  if (mode) { exitLabels(); loadRandom(); }
  else      { showLabelsList(); }
});

// Refresh always returns to the random wall.
if (refreshBtn) refreshBtn.addEventListener("click", exitLabels);



// A selection of albums from anywhere (v0.7.4): the server's — your files,
// Qobuz, Tidal — go to the zone in one ask; the phone's own go to the
// phone's player when that is the zone (one queue of everything), and are
// left out, with a word, when a room or a device is. Before, the phone's
// were sent to the server with the rest, which knows nothing of them and
// refused the lot ("offsets required").
// The zone chosen is this phone's own player ("This phone", as the server
// names it to the app that owns it).
const playingOnThisPhone = () => { const z = zones.find(z => z.zone_id === selectedZoneId); return !!(z && z.is_phone && z.display_name === "This phone"); };
async function invokeAlbumMulti(kind) {
  if (!albumSelected.length) return;
  const phone = albumSelected.filter(isPhoneAlbum);
  const server = albumSelected.filter(a => !isPhoneAlbum(a));
  if (server.length && !selectedZoneId) { showToast("Pick a zone first", "error"); return; }
  const verb = kind === "play_now" ? "Playing" : kind === "play_next" ? "Playing next:" : "Queued";
  const said = [];
  try {
    if (server.length) {
      const r = await fetch("/api/play-multi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offsets: server.map(a => a.offset),
          // Identity per album so a mid-scan stale offset is relocated or
          // refused server-side instead of queueing the wrong records.
          items: server.map(a => ({ offset: a.offset, title: a.title || "", subtitle: a.subtitle || "" })),
          zone_or_output_id: selectedZoneId,
          kind,
          filter_type:   activeFilter ? activeFilter.type   : "",
          filter_value:  activeFilter ? activeFilter.value  : "",
          filter_parent: activeFilter && activeFilter.parent ? activeFilter.parent : ""
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      // play-multi now answers 200 with counts when some albums failed, so the
      // count reported has to come from the response, not from what was asked.
      // `total` is omitted — a hand-picked selection is never capped.
      said.push(multiOutcome(verb, j, server.length, null) + " → " + zoneName(selectedZoneId));
    }
    if (phone.length && server.length && !playingOnThisPhone()) {
      // A room or a device is the zone: the server's albums went there, and
      // the phone's can't follow (the server has no copy of them). Said, and
      // left out, rather than played on the phone beside the room.
      said.push("Unable to add music on this phone to queue");
    } else if (phone.length) {
      const dl = window.MusicdDownloads;
      if (!dl || typeof dl.playLocal !== "function") throw new Error("Only the Mandarin app plays music on this phone");
      // Play now: the first plays now and the rest follow it; Queue: at the
      // end, in order; Play next: the app puts each one straight after the
      // playing track, so they are sent last to first and land in order.
      const want = kind === "play_next" || kind === "add_next" ? "play_next" : kind === "play_now" ? "play_now" : "queue";
      const order = want === "play_next" ? phone.slice().reverse() : phone;
      order.forEach((a, i) => {
        const k = want === "play_now" ? (i === 0 && !server.length ? "play_now" : "queue") : want;
        dl.playLocal(phoneKey(a), -1, k);
      });
      said.push(`${server.length ? "Queued" : verb} ${phone.length} album${phone.length === 1 ? "" : "s"} on this phone → This phone`);
    }
    showToast(said.join(" · "));
    exitAlbumSelectMode();
  } catch (e) {
    showToast(e.message, "error");
    updateAlbumActionBar();
  }
}

if (albumActionCancelBtn) albumActionCancelBtn.addEventListener("click", exitAlbumSelectMode);

// ----- Select-menu wiring -------------------------------------------------
if (selMenuBtn) {
  selMenuBtn.addEventListener("click", (e) => {
    // The document-level dismisser below would otherwise see this very click
    // and shut the menu in the same tick it opened.
    e.stopPropagation();
    const willShow = selMenu.classList.contains("hidden");
    selMenu.classList.toggle("hidden", !willShow);
    selMenuBtn.setAttribute("aria-expanded", String(willShow));
  });
}
if (selMenu) {
  selMenu.addEventListener("click", (e) => {
    const item = e.target.closest("[data-sel-act]");
    if (!item) return;
    e.stopPropagation();
    closeSelectMenu();
    const act = item.dataset.selAct;
    if (act === "clear") {
      if (selMenuKind === "tracks") exitTrackSelectMode();
      else exitAlbumSelectMode();
      return;
    }
    if (act === "add") { addSelectionToPlaylist(); return; }
    if (act === "later") {
      if (selMenuKind === "tracks") { if (currentAlbum) setListenLater(currentAlbum.offset, true); exitTrackSelectMode(); }
      else { setListenLater(albumSelected.map(a => a.offset), true); exitAlbumSelectMode(); }
      return;
    }
    if (selMenuKind === "tracks") invokeTrackMulti(act);
    else invokeAlbumMulti(act);
  });
  // Contains-checks rather than a scoped closest(): there are already four
  // document-level click listeners in this file and every popover trigger
  // stops propagation on its own button, so a shared container selector
  // would fight them.
  document.addEventListener("click", (e) => {
    if (selMenu.classList.contains("hidden")) return;
    if (selMenu.contains(e.target)) return;
    if (selMenuBtn && selMenuBtn.contains(e.target)) return;
    closeSelectMenu();
  });
}

window.__openAlbum = openAlbum;
// The Home Screen settings page renders its list from these, so the row
// vocabulary has exactly one definition (HOME_ROWS) and the settings list
// cannot describe a row that does not exist.
window.__downloadedCount = () => downloadList().length;
window.__homeRowTitles = () => {
  const out = {};
  for (const r of HOME_ROWS) out[r.id] = r.title;
  return out;
};
window.__applyHomeLayout = (rows) => {
  if (Array.isArray(rows) && rows.length) homeLayout = rows;
  applyHomeLayout();
  // A row switched back on has never been loaded this session, so give it a
  // chance to fill before the user goes looking for it.
  for (const row of HOME_ROWS) {
    if (!homeRowOn(row.id)) continue;
    if (row.isFresh()) continue;
    row.load();
  }
};

// Reflect the opt-in features into the side menu.
//
// A menu entry for a feature that is switched off leads to a screen that can
// only ever be empty — the Labels browser with no scan behind it, Smart Picks
// with no build. Hiding the entry is part of "off", not decoration.
//
// Exported because the settings pane flips these switches and the menu lives
// elsewhere; both call this rather than reaching into each other's DOM.
// A key absent from `state` leaves that entry alone, so one failed lookup
// cannot hide the other feature's entry.
window.__applyFeatureMenu = (state) => {
  const labelsItem = document.getElementById("menu-item-labels");
  const picksItem  = document.getElementById("menu-item-picks");
  if (labelsItem && typeof state.labels === "boolean") {
    labelsItem.classList.toggle("hidden", !state.labels);
    // The same switch decides whether the Library Focus vocabulary still
    // contains "Record label", and the count badge has to agree with the
    // sheet from the first paint, not from the first time it is opened.
    if (window.__setLabelsFacetAvailable) window.__setLabelsFacetAvailable(state.labels);
  }
  if (picksItem && typeof state.picks === "boolean") {
    picksItem.classList.toggle("hidden", !state.picks);
  }
};

// Ask at boot. Two independent calls, so an older server or a transient
// error on one endpoint does not decide the other entry's visibility.
// The three side by side (v0.6.10), not one after another.
async function applyFeatureMenuFromServer() {
  const state = {};
  const ask = async (url) => { try { const r = await fetch(url); return r.ok ? !!(await r.json()).enabled : null; } catch (e) { return null; } };
  const [labels, picks] = await Promise.all([ask("/api/settings/labels"), ask("/api/settings/smart-picks")]);
  // A failed lookup leaves the entry as the markup has it.
  if (labels !== null) state.labels = labels;
  if (picks !== null) state.picks = picks;
  window.__applyFeatureMenu(state);
}

window.__buildAlbumTile = (a) => buildAlbumTile(a);
window.__loadRandom = loadRandom;
window.__showLibraryWall = showLibraryWall;

// The library changed under the page (v0.7.3): a streamed album favourited
// or removed — here, or in the service's own app and found by the watch.
// Whatever is on screen is redrawn, within the moment: the tile of an
// album gone (`gone`, its offset) is taken off every wall and row at once,
// the Home rows are marked stale and reloaded if Home is showing, and the
// Library wall or the random wall is read again.
window.__libraryChanged = (opts) => {
  // Albums added or taken away under the page (v0.8.43, the server's mark
  // moved): the Library row read again, on Home now; the Library wall read
  // again if it is at its top and no album is open over it (further down,
  // or under an album, it stays put, and is read again when next opened).
  // Nothing else is reshuffled.
  if (opts && opts.live) {
    homeLibraryKey = "";
    if (homeView && !homeView.classList.contains("hidden")) { if (homeRowOn("library")) loadHomeLibrary(); return; }
    if (libraryWallActive && !labelsActive && (!modal || modal.classList.contains("hidden"))) {
      const m = document.querySelector("main");
      if (m && m.scrollTop < m.clientHeight) showLibraryWall();
    }
    return;
  }
  const gone = opts && opts.gone != null ? String(opts.gone) : null;
  if (gone) for (const el of document.querySelectorAll('.album[data-offset="' + gone + '"]')) el.remove();
  homeRowsLoadedAt = 0; homeUnplayedLoaded = false; homeFavouritesLoaded = false; homeLaterLoaded = false;
  homeHistoryLoaded = false; homeLibraryKey = ""; homePlaylistsLoaded = false;
  if (homeView && !homeView.classList.contains("hidden")) { refreshHomeRows(); return; }
  if (window.__searchActive && window.__searchActive()) return;
  if (window.__artistViewActive && window.__artistViewActive()) return;
  if (labelsActive || favouritesWallActive || laterWallActive || historyWallActive) return;
  if (libraryWallActive) { showLibraryWall(); return; }
  if (unplayedWallActive) return;   // a fixed wall: the tile is gone, the rest stands
  if (!grid.classList.contains("hidden") && !gone) loadRandom();
};

// The services' favourites checked when the page comes back to Home or to
// the Library wall (v0.7.3), not only on the server's two-minute clock:
// an album favourited in the Qobuz or Tidal app on the way home is on the
// wall by the time it is looked at. Not more than once a half-minute.
let servicesWatchedAt = 0;
window.__watchServices = async () => {
  if (window.__musicdOffline || Date.now() - servicesWatchedAt < 30000) return;
  servicesWatchedAt = Date.now();
  try {
    const r = await fetch("/api/services/watch", { method: "POST" });
    const j = r.ok ? await r.json() : null;
    if (j && j.changed) window.__libraryChanged();
  } catch (e) { /* next time */ }
};
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") window.__watchServices(); });
window.__showToast = (msg, kind) => showToast(msg, kind);
