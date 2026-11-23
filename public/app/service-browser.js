/* ------------------------------------------------------------------ */
/*  Streaming-service browser factory — self-contained overlay (tabs,  */
/*  search, artists, album detail + favourite). Instantiated once per  */
/*  service (Qobuz, Tidal) below; each instance owns its closure state */
/*  (viewStack, reqSeq, timers) so the two overlays never interact.    */
/*  Isolated from the album grid / labels / filters; uses only the     */
/*  service's API endpoints and window.__showToast.                    */
/*                                                                     */
/*  cfg: {                                                             */
/*    service          "qobuz" | "tidal" (internal identifier)         */
/*    serviceName      display name for toasts ("Qobuz" / "Tidal")     */
/*    idPrefix         element-id prefix ("qobuz-…" / "tidal-…")       */
/*    apiBase          "/api/qobuz" | "/api/tidal"                     */
/*    historyKey       key used in history.pushState state objects —   */
/*                     "qz" (pre-factory value, kept so Qobuz behaves  */
/*                     byte-identically) | "td"                        */
/*    closeAttr        data attribute on the overlay's close targets   */
/*    notConnectedMsg  status text when the API says "not connected"   */
/*    tabs             [{ id, label, kind }] — kind "new-releases"     */
/*                     hits /new-releases?days=30, kind "featured"     */
/*                     hits /featured?type=<id>. tabs[0] is the        */
/*                     default tab shown when the overlay opens.       */
/*  }                                                                  */
/* ------------------------------------------------------------------ */
function initServiceBrowser(cfg) {
  const sb = {};   // what the parts of initServiceBrowser share (app/service-browser-rows.js, app/service-browser-views.js)
  const byId = (suffix) => document.getElementById(cfg.idPrefix + suffix);
  const btn          = byId("-toggle");
  const overlay      = byId("-overlay");
  const listEl       = byId("-nr-list");
  const statusEl     = byId("-nr-status");
  const detailEl     = byId("-nr-detail");
  const searchInput  = byId("-search-input");
  const searchClear  = byId("-search-clear");
  const tabsEl       = byId("-tabs");
  const artistHeadEl = byId("-artist-head");
  const artistsEl    = byId("-artists");
  const loadMoreEl   = byId("-load-more");
  // Both overlays share the .qobuz-* CSS classes (only ids differ), so the
  // class-based lookups below work for every instance.
  const searchRowEl  = overlay ? overlay.querySelector(".qobuz-search-row") : null;
  if (!btn || !overlay) return;

  const defaultTab = cfg.tabs[0].id;

  const PAGE_SIZE = 50;

  const toast = (msg, kind) => { if (window.__showToast) window.__showToast(msg, kind); };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const overlayVisible = () => !overlay.classList.contains("hidden");

  // View stack — one entry per history level pushed while the overlay is open.
  // Each entry: { kind: 'tab', tab } | { kind: 'search', query }
  //           | { kind: 'artist', artistId, artistName } | { kind: 'detail', album, rowFavBtn }
  // plus bookkeeping set while shown: loaded (fetch completed), offset/hasMore/
  // limit (paged views), snapshot (rendered list DOM saved when an artist view
  // covers this one — see snapshotListInto/restoreSnapshot).
  // Invariant: entry N was created by the history.pushState carrying
  // {[cfg.historyKey]: N+1…}, so history.state[historyKey] always equals the
  // stack depth for the current entry.
  // The popstate handler RECONCILES against that depth rather than blindly
  // popping once, which keeps the stack correct across Forward presses and
  // multi-step history jumps. Tab switches and new searches REPLACE the top
  // entry (no push) — they are siblings, not depth.
  sb.viewStack = [];
  const currentView = () => sb.viewStack[sb.viewStack.length - 1] || null;

  // Last tab the user explicitly selected — where clearing the search returns to.
  let activeTab = defaultTab;

  // Monotonic request counter: every render/loadMore bumps it and any response
  // arriving after a newer request started is dropped (out-of-order guard).
  sb.reqSeq = 0;

  let searchTimer = null;

  function clearSearchTimer() {
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
  }

  function clearDetail() {
    if (detailEl) { detailEl.classList.add("hidden"); detailEl.innerHTML = ""; detailEl.dataset.albumId = ""; }
  }

  // Empty the shared list containers (rows, artist strip/header, load-more).
  // During a view change this runs only once the fetch outcome (results, empty,
  // or error) is ready — never before the fetch — so the previous rows stay on
  // screen under the "Searching…"/"Loading…" status instead of the content area
  // blanking while a request is in flight.
  function resetListContainers() {
    if (listEl) listEl.innerHTML = "";
    if (artistHeadEl) { artistHeadEl.classList.add("hidden"); artistHeadEl.innerHTML = ""; }
    if (artistsEl) { artistsEl.classList.add("hidden"); artistsEl.innerHTML = ""; }
    if (loadMoreEl) loadMoreEl.classList.add("hidden");
  }

  // Reset the search box UI (text, × visibility, pending debounce) WITHOUT
  // navigating — for callers about to render a view of their own (tab click,
  // overlay open). clearSearch() adds the return-to-tab navigation on top.
  function resetSearchBox() {
    if (searchInput) searchInput.value = "";
    if (searchClear) searchClear.classList.add("hidden");
    clearSearchTimer();
  }

  // Cancel the search: empty the box, drop any pending debounce, and return to
  // the last active tab. Shared by the × clear button and the Escape key.
  function clearSearch() {
    resetSearchBox();
    applySearch("");
  }

  // Fully hide the overlay (and any open detail). Called only from the popstate
  // handler when the view stack empties — never directly from a close affordance,
  // so viewStack and the history stack can never get out of step.
  function hideOverlay() {
    overlay.classList.add("hidden");
    sb.leaveUnder(false);
    sb.viewStack = [];
    sb.reqSeq++; // orphan any in-flight fetch — a late response must not repopulate the hidden overlay
    clearSearchTimer();
    clearDetail();
    // Drop this session's rows/status now — the deferred-clear render path
    // would otherwise show them again on the next open while its first
    // request is still in flight.
    resetListContainers();
    if (statusEl) statusEl.textContent = "";
  }

  // All back/close affordances (× button, backdrop, ‹ Back, Esc) step back one
  // history level via history.back(), which the popstate handler turns into
  // detail → list → … → closed. This also makes the Android/browser back button
  // behave naturally instead of leaving the page.
  const goBack = () => history.back();

  overlay.querySelectorAll("[" + cfg.closeAttr + "]").forEach(el => el.addEventListener("click", goBack));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !overlayVisible()) return;
    // Escape while typing must never navigate the overlay away. Staged:
    // 1st press (text present) clears the box — same action as the × button —
    // keeping focus so the user can retype; 2nd press (box empty) just blurs;
    // only with the input unfocused does Escape step back / close.
    if (searchInput && document.activeElement === searchInput) {
      if (searchInput.value) clearSearch();
      else searchInput.blur();
      return;
    }
    goBack();
  });

  // Browser / Android back (and Forward): while the overlay is open, reconcile
  // the view stack against the depth stored in history.state instead of blindly
  // popping once — Forward presses and multi-step jumps then self-heal rather
  // than corrupting the stack. No-op when the overlay isn't open, so the rest
  // of the app (which uses no history state) — including the OTHER service's
  // browser — is unaffected. Each instance reads only its own historyKey: a
  // state carrying just the other service's key (or no state at all) counts as
  // depth 0 for this instance, and depth 0 while this overlay is visible means
  // "backed out past this overlay's root" — close it. That is exactly the
  // pre-factory close-on-back behaviour, and it is safe cross-service because
  // every history entry pushed while this overlay is open carries this
  // instance's key (pushState truncates any forward entries the other overlay
  // left behind, so a foreign-key state can only ever sit BELOW this overlay's
  // root — where closing is the correct response).
  window.addEventListener("popstate", (e) => {
    if (!overlayVisible()) return;
    if (sb.backClosesAlbumPage()) return;
    const depth = (e.state && Number.isFinite(e.state[cfg.historyKey])) ? e.state[cfg.historyKey] : 0;
    if (depth >= sb.viewStack.length) {
      // Forward into a history entry whose view we already discarded — bounce
      // back to the deepest view we still have. The resulting popstate lands
      // exactly on depth === viewStack.length and no-ops.
      if (depth > sb.viewStack.length) history.go(sb.viewStack.length - depth);
      return;
    }
    const popped = currentView();
    sb.viewStack.length = depth;
    if (!sb.viewStack.length) { hideOverlay(); return; }
    const top = currentView();
    // A view covered by an artist push had its rendered list saved — restore
    // it without refetching (keeps loaded pages + scroll position).
    if (top.snapshot) { sb.restoreSnapshot(top); return; }
    // Leaving a detail view: the list underneath is still intact in the DOM
    // (detail only hides it), so just restore visibility — no refetch.
    if (popped && popped.kind === "detail") { sb.restoreListAfterDetail(top); return; }
    sb.render(top);
  });

  // Push a deeper view (detail or artist): one viewStack entry + one history entry.
  function pushView(view) {
    const covered = currentView();
    // An artist view re-renders the shared list DOM, so save the covered list
    // view's rendered state first for an instant, fetch-free back. (Detail
    // views only hide the list — no snapshot needed. Views that never finished
    // loading have nothing worth saving; back will refetch them instead.)
    if (view.kind === "artist" && covered && covered.kind !== "detail" && covered.loaded) {
      sb.snapshotListInto(covered);
    }
    sb.viewStack.push(view);
    history.pushState({ [cfg.historyKey]: sb.viewStack.length }, "");
    sb.render(view);
  }

  // Replace the top view (tab switch, new search): no history entry, so the
  // 1:1 viewStack ↔ history invariant is preserved.
  function replaceTop(view) {
    if (!sb.viewStack.length) return;
    sb.viewStack[sb.viewStack.length - 1] = view;
    sb.render(view);
  }

  // Reflect favourite state on a button (added = in the user's service library).
  // The service's own favourite — a plus that becomes a tick — not Mandarin's
  // heart, which an album keeps for itself once it is in the library.
  function setFavState(button, added) {
    button.dataset.fav = added ? "1" : "0";
    const words = added ? ("✓ In " + cfg.serviceName + " favourites") : ("+ " + cfg.serviceName + " favourite");
    // On a tile only the sign fits; the words are its label.
    if (button.classList.contains("qobuz-tile-fav")) {
      button.textContent = added ? "✓" : "+";
      button.title = words.slice(2);
      button.setAttribute("aria-label", words.slice(2));
    } else button.textContent = words;
    button.classList.toggle("is-done", added);
  }

  // Toggle favourite/un-favourite against the service, updating every button
  // that represents this album (the list row and, if open, the detail view) so
  // they stay in sync. `buttons` may be a single button or an array.
  async function toggleFavourite(albumId, buttons) {
    const btns = (Array.isArray(buttons) ? buttons : [buttons]).filter(Boolean);
    if (!btns.length) return;
    const wasAdded = btns[0].dataset.fav === "1";
    const prev = btns.map(b => b.textContent);
    btns.forEach(b => { b.disabled = true; b.textContent = "…"; });
    try {
      const r = await fetch(cfg.apiBase + (wasAdded ? "/unfavorite" : "/favorite"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ album_id: albumId })
      });
      const j = await r.json();
      if (j.ok) {
        btns.forEach(b => setFavState(b, !wasAdded));
        toast(wasAdded
          ? ("Removed from " + cfg.serviceName + " favourites")
          : ("Added to " + cfg.serviceName + " favourites"), "ok");
        // The walls under the browser follow (v0.7.3).
        if (window.__libraryChanged) window.__libraryChanged({});
      } else {
        btns.forEach((b, i) => { b.textContent = prev[i]; });
        toast(j.error || "Couldn't update favourite", "error");
      }
    } catch (e) {
      btns.forEach((b, i) => { b.textContent = prev[i]; });
      toast("Failed: " + e.message, "error");
    } finally {
      btns.forEach(b => { b.disabled = false; });
    }
  }

  // Highlight the active tab chip. While a search / artist / detail view is on
  // top, no chip is highlighted.
  function updateTabActive() {
    if (!tabsEl) return;
    const top = currentView();
    const active = top && top.kind === "tab" ? top.tab : null;
    tabsEl.querySelectorAll(".qobuz-tab").forEach(t =>
      t.classList.toggle("is-active", t.dataset.qtab === active));
  }
  Object.assign(sb, { cfg, overlay, listEl, statusEl, detailEl, searchInput, searchClear, tabsEl, artistHeadEl, artistsEl, loadMoreEl, searchRowEl, PAGE_SIZE, toast, esc, overlayVisible, currentView, clearSearchTimer, clearDetail, resetListContainers, goBack, pushView, setFavState, toggleFavourite, updateTabActive });
  serviceBrowserRows(sb);
  serviceBrowserViews(sb);
  if (loadMoreEl) loadMoreEl.addEventListener("click", sb.loadMore);

  // Apply the current search box value: ≥2 chars starts/updates a search view;
  // an empty box returns from search to the last active tab. Always REPLACES
  // the top view (search is a sibling of the tabs, not a deeper level).
  function applySearch(q, explicit) {
    if (!overlayVisible() || !sb.viewStack.length) return;
    const top = currentView();
    if (!q) {
      if (top.kind === "search") replaceTop({ kind: "tab", tab: activeTab });
      return;
    }
    if (q.length < 2) {
      // Too short for a useful catalog query. The debounce path just waits for
      // more input, but an explicit Enter deserves feedback, not silence.
      if (explicit && statusEl) statusEl.textContent = "Type at least 2 characters to search.";
      return;
    }
    if (top.kind === "search" && top.query === q) return; // unchanged
    replaceTop({ kind: "search", query: q });
  }

  if (searchInput) {
    // Debounced live search: 450 ms after the last keystroke.
    searchInput.addEventListener("input", () => {
      if (searchClear) searchClear.classList.toggle("hidden", !searchInput.value);
      clearSearchTimer();
      const q = searchInput.value.trim();
      if (!q) { applySearch(""); return; } // clearing reverts immediately
      searchTimer = setTimeout(() => { searchTimer = null; applySearch(q); }, 450);
    });
    // Enter searches immediately (and dismisses the mobile keyboard).
    searchInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      clearSearchTimer();
      applySearch(searchInput.value.trim(), true);
      searchInput.blur();
    });
  }

  if (searchClear) {
    searchClear.addEventListener("click", clearSearch);
  }

  function bindTab(t) {
    t.addEventListener("click", () => {
      const tab = t.dataset.qtab;
      if (!tab || !sb.viewStack.length) return;
      activeTab = tab;
      resetSearchBox();
      const top = currentView();
      if (top.kind === "tab" && top.tab === tab) { updateTabActive(); return; }
      replaceTop({ kind: "tab", tab });
    });
  }
  if (tabsEl) tabsEl.querySelectorAll(".qobuz-tab").forEach(bindTab);

  // The tabs after the first from the service itself (cfg.dynamicTabs: Tidal
  // says which lists it features, and they change), asked for once per
  // page load; the static ones stay if it can't be asked.
  let tabsLoaded = false;
  async function loadTabs() {
    if (!cfg.dynamicTabs || tabsLoaded || !tabsEl) return;
    try {
      const j = await sb.qFetch(cfg.apiBase + "/lists");
      const lists = (j.lists || []).filter(l => l && l.id && l.label);
      if (!lists.length) return;
      tabsLoaded = true;
      cfg.tabs = [cfg.tabs[0]].concat(lists.map(l => ({ id: l.id, label: l.label, kind: "featured" })));
      tabsEl.querySelectorAll(".qobuz-tab").forEach((t, i) => { if (i) t.remove(); });
      for (const l of lists) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "qobuz-tab"; b.setAttribute("role", "tab"); b.dataset.qtab = l.id; b.textContent = l.label; b.dataset.parity = "service-browser.tab";
        bindTab(b);
        tabsEl.appendChild(b);
      }
      updateTabActive();
    } catch (e) { /* the static tabs */ }
  }

  function openOverlay() {
    if (overlayVisible()) return;
    activeTab = defaultTab;
    resetSearchBox();
    sb.viewStack = [{ kind: "tab", tab: defaultTab }];
    history.pushState({ [cfg.historyKey]: 1 }, ""); // a back press from the root view closes the overlay
    overlay.classList.remove("hidden");
    sb.render(currentView());
    loadTabs();
  }
  btn.addEventListener("click", openOverlay);

  // For the search screen (v0.6.24): this service's album tile, and an
  // artist's albums in this browser (‹ Back goes to its first tab, × closes
  // it, the search still there beneath).
  window.__serviceBrowsers = window.__serviceBrowsers || {};
  window.__serviceBrowsers[cfg.service] = {
    tile: (a) => sb.buildAlbumRow(a, { outside: true }),
    openArtist: (ar) => { openOverlay(); pushView({ kind: "artist", artistId: ar.id, artistName: ar.name }); }
  };
}
