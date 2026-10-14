/* The page's core (app.js until v1.0.5), 32 of 33: the labels list, and a label's logo. */
// Park / unpark for views that BORROW the shared grid and hand it back
// (the artist view). exitLabels() is a real teardown — it forgets which
// label was open, so Back would land on a label grid the browser no longer
// believes it owns (no labels bar, no way back to the list). Parking hides
// the chrome and closes the sheets but remembers the mode/label, so the
// artist view's Back restores the labels browser whole.
function parkLabels() {
  if (!labelsActive) return null;
  const state = {
    mode,
    currentLabelName,
    currentLabelLogoUrl,
    barHidden: labelsBar ? labelsBar.classList.contains("hidden") : true
  };
  closeLabelLogoSheet();
  exitLabelSelectMode();
  exitAlbumSelectMode();
  if (labelUnmergeSheet) labelUnmergeSheet.classList.add("hidden");
  if (labelsBar) labelsBar.classList.add("hidden");
  labelsBtn.classList.remove("is-active");
  // Stops the list re-poll (guarded on mode === "list") from repainting
  // label tiles over the borrowing view.
  mode = null;
  labelsActive = false;
  paintTools();
  return state;
}
function unparkLabels(state) {
  if (!state) return;
  mode                = state.mode;
  currentLabelName    = state.currentLabelName;
  currentLabelLogoUrl = state.currentLabelLogoUrl;
  labelsActive        = true;
  labelsBtn.classList.add("is-active");
  if (labelsBar) labelsBar.classList.toggle("hidden", state.barHidden);
  paintTools();
}
window.__parkLabels   = parkLabels;
window.__unparkLabels = unparkLabels;

// ----- Logo picker sheet -----

async function saveLogo(url) {
  if (!currentLabelName) return;
  try {
    const r = await fetch("/api/labels/logo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: currentLabelName, url })
    });
    const j = await r.json();
    if (j.ok) {
      currentLabelLogoUrl = j.storedUrl || url; // keep current URL in sync with what the server persisted
      closeLabelLogoSheet();
      showToast("Logo saved", "ok");
    } else {
      showToast(j.error || "Failed to save logo", "error");
    }
  } catch (e) {
    showToast("Failed: " + e.message, "error");
  }
}

async function loadLogoCandidates(labelName) {
  if (!logoCandidatesEl) return;
  logoCandidatesEl.innerHTML = '<span class="logo-candidates-hint">Searching Discogs…</span>';
  try {
    const r = await fetch("/api/labels/logo-candidates?label=" + encodeURIComponent(labelName));
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    const candidates = (j && j.candidates) || [];
    logoCandidatesEl.innerHTML = "";
    if (!candidates.length) {
      logoCandidatesEl.innerHTML = '<span class="logo-candidates-hint">No logos found on Discogs</span>';
      return;
    }
    for (const c of candidates) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "logo-candidate-btn";
      btn.title = c.title || "";
      const img = document.createElement("img");
      img.src = c.img;
      img.alt = c.title || "";
      img.loading = "lazy";
      img.onerror = () => btn.remove();
      btn.appendChild(img);
      btn.addEventListener("click", () => saveLogo(c.img));
      logoCandidatesEl.appendChild(btn);
    }
  } catch (e) {
    logoCandidatesEl.innerHTML = '<span class="logo-candidates-hint">' + (e.message || "Discogs search failed") + '</span>';
  }
}

if (labelsLogoBtn) {
  labelsLogoBtn.addEventListener("click", () => {
    if (!logoUrlSheet) return;
    const opening = logoUrlSheet.classList.contains("hidden");
    logoUrlSheet.classList.toggle("hidden");
    if (opening) {
      loadLogoCandidates(currentLabelName || "");
      if (logoUrlInput) {
        if (currentLabelLogoUrl) logoUrlInput.value = currentLabelLogoUrl; // pre-fill existing logo URL
        logoUrlInput.focus();
      }
    }
  });
}
if (logoUrlCancel) {
  logoUrlCancel.addEventListener("click", closeLabelLogoSheet);
}
if (logoUrlSave) {
  logoUrlSave.addEventListener("click", async () => {
    const url = logoUrlInput ? logoUrlInput.value.trim() : "";
    if (!url || !currentLabelName) return;
    logoUrlSave.disabled = true;
    try {
      await saveLogo(url);
    } finally {
      logoUrlSave.disabled = false;
    }
  });
}

function makeScanLogLink() {
  const wrap = document.createElement("div");
  wrap.className = "scan-log-link";
  wrap.style.cssText = "text-align:center;margin:8px 0 4px;font-size:0.8em;opacity:0.7;";
  const a = document.createElement("a");
  a.href = "/api/labels-scan-log";
  a.download = "labels-scan.log";
  a.textContent = "Download scan log";
  a.style.cssText = "color:inherit;text-decoration:underline;cursor:pointer;margin-right:12px;";
  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copy log";
  copyBtn.style.cssText = "background:none;border:none;color:inherit;text-decoration:underline;cursor:pointer;font-size:inherit;padding:0;";
  copyBtn.addEventListener("click", async () => {
    try {
      const r = await fetch("/api/labels-scan-log");
      const text = await r.text();
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy log"; }, 2000);
    } catch (e) { copyBtn.textContent = "Failed"; setTimeout(() => { copyBtn.textContent = "Copy log"; }, 2000); }
  });
  wrap.appendChild(a);
  wrap.appendChild(copyBtn);
  return wrap;
}

async function showLabelsList(isRepoll = false) {
  if (window.__leavePlaylistScreens) window.__leavePlaylistScreens();
  if (!isRepoll) {
    if (window.__clearSearchIfActive) window.__clearSearchIfActive();  // drop stale search results
    exitAlbumSelectMode(); closeLabelLogoSheet(); currentLabelName = null; currentLabelLogoUrl = null;
  }
  const restoreScroll = !isRepoll && _labelsScrollSaved > 0;
  mode = "list";
  labelsActive = true;
  leaveLibraryWall();   // labels own the shared grid now — stop the wall's infinite scroll
  { const _hv = document.getElementById("home-view"); if (_hv) _hv.classList.add("hidden"); }
  grid.classList.remove("hidden");
  if (window.__setTopbarNav) window.__setTopbarNav(true, false, false);   // Back (to Home), no Refresh, no search
  labelsBtn.classList.add("is-active");
  if (labelsBar) labelsBar.classList.add("hidden");
  if (!isRepoll) { labelsSearchInput.value = ""; labelsSearchBox.classList.add("hidden"); }
  paintTools();
  setBanner(null);
  setCountText("Labels");
  if (!isRepoll) { renderSkeletons(computeAlbumCount()); _lastLabelCount = -1; }
  try {
    const r = await fetch("/api/filters/labels");
    const j = await r.json();
    if (!(labelsActive && mode === "list")) return;
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    const minAlbums = labelMin();
    const labels = (j.labels || []).filter(lb => (lb.albumCount || 1) >= minAlbums);
    const pct = Math.round((j.progress || 0) * 100);
    if (!labels.length) {
      if (!isRepoll) grid.innerHTML = "";
      if (j.scanning) {
        const msg = pct > 0
          ? "Scanning for record labels… " + pct + "% complete."
          : "Building library index…";
        setBanner(msg, false);
        updateScanBar(j.scanning ? (j.progress || 0) : null);
        // Re-poll every 4 s while the scan is running
        setTimeout(() => { if (mode === "list") showLabelsList(true); }, 4000);
      } else {
        setBanner(j.lookups
          ? "No labels found yet — the background scan is looking them up. This can take a few minutes for large libraries."
          : "No labels yet: none of the albums' files carry a LABEL tag.", false);
        if (!j.lookups) return;
        // Show a rescan button so the user can retry without restarting the server.
        const rescanBtn = document.createElement("button");
        rescanBtn.className = "action-btn primary";
        rescanBtn.style.cssText = "margin:16px auto;";
        rescanBtn.textContent = "Rescan now";
        rescanBtn.addEventListener("click", async () => {
          rescanBtn.disabled = true;
          rescanBtn.textContent = "Starting…";
          try {
            await fetch("/api/labels/rescan", { method: "POST",
              headers: { "Content-Type": "application/json" }, body: "{}" });
            _lastLabelCount = -1;
            setTimeout(() => { if (mode === "list") showLabelsList(false); }, 1000);
          } catch (e) { rescanBtn.disabled = false; rescanBtn.textContent = "Rescan now"; }
        });
        grid.appendChild(rescanBtn);
        grid.appendChild(makeScanLogLink());
      }
      return;
    }
    setCountText("Labels");
    updateScanBar(j.scanning ? (j.progress || 0) : null);
    // Only re-render tiles on first load or when the scan finishes.
    // During an active scan, just update the count text so the grid stays
    // stable — no flash every 5 s as new labels trickle in.
    if (_lastLabelCount <= 0 || !j.scanning) {
      renderLabelTiles(labels);
      const oldLink = grid.querySelector(".scan-log-link");
      if (oldLink) oldLink.remove();
      if (!j.scanning && j.lookups) grid.appendChild(makeScanLogLink());   // nothing to log when the tags are all there is
      if (_labelsScrollTarget && mainEl) {
        // Arrived via a deep-link (album view / search chip). Scroll the grid
        // to that label's tile so "back" lands on it instead of the top.
        const want = _labelsScrollTarget.trim().toLowerCase();
        _labelsScrollTarget = null;
        requestAnimationFrame(() => {
          let found = null;
          grid.querySelectorAll(".label-tile").forEach(t => {
            if (found) return;
            const tt = t.querySelector(".album-title");
            if (tt && tt.textContent.trim().toLowerCase() === want) found = t;
          });
          if (found) found.scrollIntoView({ block: "center" });
        });
      } else if (restoreScroll && mainEl) {
        requestAnimationFrame(() => { mainEl.scrollTop = _labelsScrollSaved; _labelsScrollSaved = 0; });
      }
    }
    // Keep polling while the scan is running
    if (j.scanning) {
      setTimeout(() => { if (mode === "list") showLabelsList(true); }, 5000);
    }
  } catch (e) {
    if (!isRepoll) grid.innerHTML = "";
    setBanner("Couldn't load labels: " + e.message, true);
    // Retry after 10 s so a transient network error doesn't stop updates permanently.
    setTimeout(() => { if (mode === "list") showLabelsList(true); }, 10000);
  }
}

function setLabelTextArt(artEl, title) {
  artEl.className = "album-art-wrap is-label-text";
  artEl.innerHTML = "";
  artEl.style.fontSize = "";
  const words = (title || "").trim().split(/\s+/).filter(Boolean);
  (words.length ? words : ["?"]).forEach(word => {
    const span = document.createElement("span");
    span.textContent = word;
    artEl.appendChild(span);
  });
}

function renderLabelTiles(labels) {
  lastLabels = labels;
  if (labels.length === _lastLabelCount && !labelsSelectMode) return; // no change — skip re-render
  if (labelsSelectMode) exitLabelSelectMode(); // re-render clears tile selection state
  _lastLabelCount = labels.length;
  grid.innerHTML = "";
  const frag = document.createDocumentFragment();
  // The server sends them # to Z; Z to # is the same list turned round.
  for (const lb of (labelsReversed ? labels.slice().reverse() : labels)) {
    const btn = document.createElement("button");
    btn.className = "album label-tile";
    btn.type = "button";
    btn.setAttribute("aria-label", lb.title || "Label");
    btn.dataset.labelKey = lb.key || "";
    const art = document.createElement("div");
    if (lb.logo_url) {
      art.className = "album-art-wrap is-label-logo";
      const img = document.createElement("img");
      img.loading = "lazy"; img.alt = "";
      img.src = lb.logo_url;
      img.onerror = () => { img.remove(); setLabelTextArt(art, lb.title); };
      art.appendChild(img);
    } else {
      setLabelTextArt(art, lb.title);
    }
    const meta = document.createElement("div");
    meta.className = "album-meta";
    const titleEl  = document.createElement("div"); titleEl.className  = "album-title";  titleEl.textContent  = lb.title || "";
    const artistEl = document.createElement("div"); artistEl.className = "album-artist"; artistEl.textContent = lb.subtitle || "";
    meta.appendChild(titleEl);
    meta.appendChild(artistEl);
    if (lb.mergedFrom && lb.mergedFrom.length > 0) {
      const mergedEl = document.createElement("div");
      mergedEl.className = "album-merged-info";
      mergedEl.textContent = lb.mergedFrom.length + " merged";
      mergedEl.title = "Tap to manage merged labels";
      mergedEl.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!labelsSelectMode) showUnmergeSheet(lb.title, lb.mergedFrom);
      });
      meta.appendChild(mergedEl);
    }
    btn.appendChild(art);
    btn.appendChild(meta);
    btn.addEventListener("click", () => {
      if (labelsSelectMode) handleLabelTileSelect(btn, lb);
      else showLabelAlbums(lb.title, true);
    });
    addLongPress(btn, () => {
      if (!labelsSelectMode) enterLabelSelectMode();
      handleLabelTileSelect(btn, lb);
    });
    frag.appendChild(btn);
  }
  grid.appendChild(frag);
  applyLabelFilter();   // a search under way still holds after a re-poll
}

function closeLabelLogoSheet() {
  if (logoUrlSheet) logoUrlSheet.classList.add("hidden");
  if (logoUrlInput) logoUrlInput.value = "";
  if (logoCandidatesEl) logoCandidatesEl.innerHTML = "";
}
