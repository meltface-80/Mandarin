/* ------------------------------------------------------------------ */
/*  Pitchfork magazine — full-page overlay (side menu → Pitchfork)     */
/*                                                                     */
/*  A self-contained module (does NOT reuse initServiceBrowser, so it  */
/*  can't regress Qobuz/Tidal). It mirrors that factory's proven       */
/*  history-aware back mechanics — every close/back goes through       */
/*  history.back(), and a popstate handler reconciles the view stack   */
/*  against history.state[HKEY] — so the Android/browser back button   */
/*  behaves naturally. Two views deep: a magazine list (tab) → a       */
/*  review detail. Handler no-ops while the overlay is closed, so the  */
/*  rest of the app is unaffected.                                     */
/* ------------------------------------------------------------------ */
(function initPitchfork() {
  const overlay  = document.getElementById("pitchfork-overlay");
  const trigger  = document.getElementById("pitchfork-toggle");
  const tabsEl   = document.getElementById("pitchfork-tabs");
  const statusEl = document.getElementById("pitchfork-status");
  const listEl   = document.getElementById("pitchfork-list");
  const detailEl = document.getElementById("pitchfork-detail");
  if (!overlay || !trigger || !listEl || !detailEl) return;

  const HKEY = "pf";
  let viewStack = [];          // [{kind:'tab',tab}] then optionally {kind:'detail',item}
  let reqSeq = 0;              // monotonic guard so a late fetch can't repaint a newer view
  let activeTab = "latest";
  const listCache = { latest: null, best: null };  // per-tab items, cached for the session

  const visible     = () => !overlay.classList.contains("hidden");
  const currentView = () => viewStack[viewStack.length - 1];
  const setStatus   = (m) => { if (statusEl) statusEl.textContent = m || ""; };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g,
      c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtScore(n) { return Number(n).toFixed(1); }   // toFixed already rounds to 1 dp

  function hideOverlay() {
    overlay.classList.add("hidden");
    viewStack = [];
    reqSeq++;                 // orphan any in-flight fetch
    listEl.innerHTML = "";
    detailEl.classList.add("hidden");
    detailEl.innerHTML = "";
    if (tabsEl) tabsEl.classList.remove("hidden");
    setStatus("");
  }

  const goBack = () => history.back();
  overlay.querySelectorAll("[data-pitchfork-close]").forEach(el => el.addEventListener("click", goBack));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && visible()) goBack();
  });

  window.addEventListener("popstate", (e) => {
    if (!visible()) return;
    const depth = (e.state && Number.isFinite(e.state[HKEY])) ? e.state[HKEY] : 0;
    if (depth >= viewStack.length) {
      if (depth > viewStack.length) history.go(viewStack.length - depth);
      return;
    }
    const popped = currentView();
    viewStack.length = depth;
    if (!viewStack.length) { hideOverlay(); return; }
    // Leaving the detail: the list underneath is still in the DOM (detail only
    // hid it), so just restore it — no refetch. Exception: a detail opened as a
    // DEEP LINK (global search result) never rendered its list, so the grid is
    // empty — render it now instead of unhiding a blank page.
    if (popped && popped.kind === "detail") {
      reqSeq++;                          // orphan the detail's in-flight fetch, if any
      detailEl.classList.add("hidden");
      detailEl.innerHTML = "";
      if (!listEl.children.length) { render(currentView()); return; }
      listEl.classList.remove("hidden");
      if (tabsEl) tabsEl.classList.remove("hidden");   // tabs return with the list
      updateTabActive();
      return;
    }
    render(currentView());
  });

  function pushView(view) {
    viewStack.push(view);
    history.pushState({ [HKEY]: viewStack.length }, "");
    render(view);
  }

  // Leave the overlay entirely (unwinding its history entries) and then run a
  // follow-up — used by the detail's "open in library" / "find on <service>"
  // actions. history.go(-n) fires a single popstate that the handler above
  // turns into hideOverlay(). The follow-up must run only AFTER that close has
  // actually happened, otherwise a follow-up that opens ANOTHER history-managed
  // overlay (Qobuz/Tidal) would race the pending unwind and get torn down by
  // the stray popstate. A bare setTimeout doesn't guarantee that ordering
  // (flaky on iOS Safari), so we run fn from a one-shot popstate listener once
  // the overlay is confirmed hidden.
  function closeAndThen(fn) {
    const n = viewStack.length;
    if (!visible() || n <= 0) { hideOverlay(); fn(); return; }
    const once = () => {
      if (visible()) return;                       // not fully closed yet — wait for the next
      window.removeEventListener("popstate", once);
      fn();
    };
    window.addEventListener("popstate", once);
    history.go(-n);
  }

  function updateTabActive() {
    if (!tabsEl) return;
    const top = currentView();
    const tab = top && top.kind === "tab" ? top.tab : activeTab;
    tabsEl.querySelectorAll(".qobuz-tab").forEach(t =>
      t.classList.toggle("is-active", t.dataset.pftab === tab));
  }

  if (tabsEl) {
    tabsEl.querySelectorAll(".qobuz-tab").forEach(t => t.addEventListener("click", () => {
      const tab = t.dataset.pftab;
      if (!tab || !viewStack.length) return;
      activeTab = tab;
      const top = currentView();
      if (top.kind === "tab" && top.tab === tab) { updateTabActive(); return; }
      // Replace the top view (tab siblings never push history, keeping the
      // viewStack ↔ history 1:1 invariant).
      viewStack[viewStack.length - 1] = { kind: "tab", tab };
      render(currentView());
    }));
  }

  trigger.addEventListener("click", () => {
    if (visible()) return;
    activeTab = "latest";
    viewStack = [{ kind: "tab", tab: "latest" }];
    history.pushState({ [HKEY]: 1 }, "");   // a back press from the root closes the overlay
    overlay.classList.remove("hidden");
    render(currentView());
  });

  // Deep link from the global search: open the overlay straight to one review's
  // detail. Seeds the root list frame WITHOUT rendering it (rendering would be
  // orphaned by the detail's reqSeq bump anyway); the popstate leaving-detail
  // branch self-heals the empty list by rendering it on Back.
  window.__openPitchforkReview = (item) => {
    if (!item || !item.url) return;
    if (!visible()) {
      activeTab = "latest";
      viewStack = [{ kind: "tab", tab: "latest" }];
      history.pushState({ [HKEY]: 1 }, "");
      overlay.classList.remove("hidden");
    }
    pushView({ kind: "detail", item });
  };

  function render(view) {
    if (!view) return;
    if (view.kind === "detail") renderDetail(view.item);
    else renderList(view.tab);
  }

  async function renderList(tab) {
    const mySeq = ++reqSeq;
    detailEl.classList.add("hidden");
    detailEl.innerHTML = "";
    listEl.classList.remove("hidden");
    if (tabsEl) tabsEl.classList.remove("hidden");
    updateTabActive();
    if (listCache[tab]) { paintList(listCache[tab]); return; }
    listEl.innerHTML = "";
    setStatus("Loading…");
    let data;
    try {
      const r = await fetch("/api/pitchfork/reviews?type=" + encodeURIComponent(tab));
      if (mySeq !== reqSeq) return;
      data = await r.json();
      if (!r.ok) throw new Error(data.error || ("HTTP " + r.status));
    } catch (e) {
      if (mySeq !== reqSeq) return;
      setStatus("");
      listEl.innerHTML = '<div class="pf-empty">Couldn’t load Pitchfork right now. Try again in a little while.</div>';
      return;
    }
    if (mySeq !== reqSeq) return;
    const items = data.items || [];
    // Session-cache only a NON-EMPTY success (mirrors the backend's rule):
    // an empty response is a parse miss upstream — retry it next visit rather
    // than pinning "No reviews" for the whole session.
    if (items.length) listCache[tab] = items;
    paintList(items);
  }

  function paintList(items) {
    setStatus("");
    listEl.innerHTML = "";
    if (!items.length) {
      listEl.innerHTML = '<div class="pf-empty">No reviews to show right now.</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    for (const it of items) frag.appendChild(buildCard(it));
    listEl.appendChild(frag);
  }

  function buildCard(it) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "pf-card";

    const art = document.createElement("div");
    art.className = "pf-card-art";
    if (it.cover) {
      const img = document.createElement("img");
      img.loading = "lazy"; img.alt = ""; img.src = it.cover;
      img.addEventListener("error", () => { art.classList.add("pf-art-fallback"); img.remove(); });
      art.appendChild(img);
    } else {
      art.classList.add("pf-art-fallback");
    }
    if (it.score != null) {
      const s = document.createElement("span");
      s.className = "pf-score" + (it.isBestNewMusic ? " pf-score-bnm" : "");
      s.textContent = fmtScore(it.score);
      art.appendChild(s);
    }
    if (it.isBestNewMusic) {
      const b = document.createElement("span");
      b.className = "pf-bnm";
      b.textContent = "BNM";
      art.appendChild(b);
    }
    // Album/artist overlaid on the bottom of the cover so tiles stay square and
    // pack cleanly in the woven mosaic (no below-tile text breaking the grid).
    const meta = document.createElement("div");
    meta.className = "pf-card-meta";
    const al = document.createElement("div"); al.className = "pf-card-album";  al.textContent = it.album || "";
    const ar = document.createElement("div"); ar.className = "pf-card-artist"; ar.textContent = it.artist || "";
    meta.appendChild(al);
    meta.appendChild(ar);
    art.appendChild(meta);
    card.appendChild(art);

    card.addEventListener("click", () => pushView({ kind: "detail", item: it }));
    return card;
  }

  async function renderDetail(it) {
    const mySeq = ++reqSeq;
    listEl.classList.add("hidden");
    // Hide the tab chips while reading a review — switching tabs from within a
    // detail would leave a phantom stack entry (back would land on the wrong
    // list). You return to the list (tabs reappear) via Back first.
    if (tabsEl) tabsEl.classList.add("hidden");
    detailEl.classList.remove("hidden");
    detailEl.scrollTop = 0;
    detailEl.innerHTML =
      '<button class="pf-back" type="button">‹ Back</button>' +
      '<div class="pf-detail-head">' +
        (it.cover ? '<img class="pf-detail-art" src="' + esc(it.cover) + '" alt="">'
                  : '<div class="pf-detail-art pf-art-fallback"></div>') +
        '<div class="pf-detail-headmeta">' +
          '<div class="pf-detail-album">' + esc(it.album) + '</div>' +
          '<div class="pf-detail-artist">' + esc(it.artist) + '</div>' +
          '<div class="pf-detail-scorerow">' +
            (it.score != null ? '<span class="pf-score' + (it.isBestNewMusic ? ' pf-score-bnm' : '') + '">' + fmtScore(it.score) + '</span>' : '') +
            (it.isBestNewMusic ? '<span class="pf-bnm">Best New Music</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="pf-detail-body"><div class="pf-loading">Loading review…</div></div>' +
      '<div class="pf-detail-actions"></div>';
    detailEl.querySelector(".pf-back").addEventListener("click", goBack);
    // Match the card behaviour: a dead cover URL falls back to the ♪ tile
    // instead of the browser's broken-image glyph. (::after doesn't render on a
    // replaced <img>, so swap in a div that does.)
    const headImg = detailEl.querySelector("img.pf-detail-art");
    if (headImg) headImg.addEventListener("error", () => {
      const ph = document.createElement("div");
      ph.className = "pf-detail-art pf-art-fallback";
      headImg.replaceWith(ph);
    });
    const bodyEl = detailEl.querySelector(".pf-detail-body");
    const actEl  = detailEl.querySelector(".pf-detail-actions");

    // COMPLIANCE (UK law): the written review is never displayed in-app.
    // Paint the note and the actions (led by "Read on Pitchfork") IMMEDIATELY
    // — nothing they need is remote. The only async piece is the library
    // match, fetched after, which just upgrades the actions with an
    // "Open in your library" button when it lands.
    bodyEl.innerHTML =
      '<p class="pf-detail-note">The written review can’t be shown here — ' +
      'tap <strong>Read on Pitchfork</strong> to read it on pitchfork.com.</p>';
    buildActions(actEl, it, null);

    try {
      const qs = "?url=" + encodeURIComponent(it.url) +
                 "&album="  + encodeURIComponent(it.album  || "") +
                 "&artist=" + encodeURIComponent(it.artist || "");
      const r = await fetch("/api/pitchfork/review" + qs);
      if (mySeq !== reqSeq) return;
      const data = await r.json();
      if (r.ok && data.match) buildActions(actEl, it, data.match);
    } catch (e) { /* library match is optional — the actions already shown work */ }
  }

  function buildActions(container, it, match) {
    container.innerHTML = "";

    // Reading happens on pitchfork.com now — make that the first action.
    const link = document.createElement("a");
    link.className = "pf-action pf-action-link";
    link.href = it.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Read on Pitchfork ↗";
    container.appendChild(link);

    // Owned? → open the existing album modal (play/queue live there).
    if (match) {
      const play = document.createElement("button");
      play.type = "button";
      play.className = "pf-action pf-action-primary";
      play.textContent = "▶ Open in your library";
      play.addEventListener("click", () => {
        closeAndThen(() => {
          if (window.__openAlbum) window.__openAlbum(match, { source: "pitchfork", filter: null });
        });
      });
      container.appendChild(play);
    }

    // Not-owned path: hop to the streaming browsers, pre-seeding their search.
    const query = ((it.artist || "") + " " + (it.album || "")).trim();
    const qBtn = document.getElementById("qobuz-toggle");
    if (qBtn) container.appendChild(makeFindBtn("Find on Qobuz", qBtn, "qobuz-search-input", query));
  }

  function makeFindBtn(label, toggleBtn, searchInputId, query) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pf-action";
    b.textContent = label;
    b.addEventListener("click", () => {
      closeAndThen(() => {
        toggleBtn.click();                       // open that service's overlay
        const input = document.getElementById(searchInputId);
        if (input && query) {
          input.value = query;
          input.dispatchEvent(new Event("input", { bubbles: true }));   // its debounced search listens on 'input'
        }
      });
    });
    return b;
  }
})();
