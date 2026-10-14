/* The page's core (app.js until v1.0.5), 31 of 33: the labels browser: its elements, its search and sort. */
// ----- Labels browser (record labels → their albums) -----
// Tapping the tag button shows every record label as a grid tile
// (alphabetical). Tapping a label shows its albums — alphabetical by
// default, or shuffled per the "Label album order" setting. Each album
// opens carrying a { type:"label" } filter so detail + play resolve the
// offset against that label's album list (reusing all existing machinery).
const labelsBtn          = document.getElementById("labels-toggle");
const labelsBar          = document.getElementById("labels-bar");
const labelsBack         = document.getElementById("labels-back");
const labelsTitle        = document.getElementById("labels-title");
const labelMergeBar      = document.getElementById("label-merge-bar");
const labelMergeInfo     = document.getElementById("label-merge-info");
const labelMergeBtn      = document.getElementById("label-merge-btn");
const labelMergeCancelBtn = document.getElementById("label-merge-cancel-btn");
const labelUnmergeSheet  = document.getElementById("label-unmerge-sheet");
const labelUnmergeName   = document.getElementById("label-unmerge-name");
const labelUnmergeList   = document.getElementById("label-unmerge-list");
const labelUnmergeClose  = document.getElementById("label-unmerge-close");
const labelsLogoBtn      = document.getElementById("labels-logo-btn");
const logoUrlSheet       = document.getElementById("logo-url-sheet");
const logoCandidatesEl   = document.getElementById("logo-candidates");
const logoUrlInput       = document.getElementById("logo-url-input");
const logoUrlSave        = document.getElementById("logo-url-save");
const logoUrlCancel      = document.getElementById("logo-url-cancel");

// The labels' own controls, in the top bar's right corner (v0.6.5): find a
// label and turn the order round (# to Z, Z to #) on the list; the logo
// button on one label's albums. The bar under it that held "‹ All labels"
// and the label's name again is gone — the top bar's ‹ and title say both.
const labelsTools = document.createElement("div");
labelsTools.id = "labels-tools";
labelsTools.className = "labels-tools hidden";
labelsTools.innerHTML =
  '<div class="search-box labels-search hidden">' +
    '<svg class="search-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
    '<input id="labels-search-input" type="search" inputmode="search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" placeholder="Find a label…" aria-label="Find a label">' +
    '<button id="labels-search-clear" class="search-clear" type="button" aria-label="Clear">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
  '</div>' +
  '<button id="labels-sort-btn" class="icon-btn labels-sort-btn" type="button"></button>' +
  '<button id="labels-search-btn" class="icon-btn" type="button" aria-label="Find a label" title="Find a label">' +
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>';
{
  const row = document.querySelector(".topbar-row");
  const before = document.getElementById("topbar-refresh");
  if (row) row.insertBefore(labelsTools, before && before.parentNode === row ? before : null);
  if (labelsLogoBtn) labelsTools.appendChild(labelsLogoBtn);
}
const labelsSearchBox   = labelsTools.querySelector(".labels-search");
const labelsSearchInput = labelsTools.querySelector("#labels-search-input");
const labelsSearchClear = labelsTools.querySelector("#labels-search-clear");
const labelsSearchBtn   = labelsTools.querySelector("#labels-search-btn");
const labelsSortBtn     = labelsTools.querySelector("#labels-sort-btn");
let labelsReversed = false;
try { labelsReversed = localStorage.getItem("rra-labels-reversed") === "1"; } catch (e) { /* localStorage optional */ }
let lastLabels = null;   // the list as the server sent it, for re-ordering without a fetch

function paintSortBtn() {
  labelsSortBtn.innerHTML = '<span class="labels-order-txt">' + (labelsReversed ? "Z–#" : "#–Z") + "</span>";
  const say = labelsReversed ? "Z to # — tap for # to Z" : "# to Z — tap for Z to #";
  labelsSortBtn.setAttribute("aria-label", "Order: " + say);
  labelsSortBtn.setAttribute("title", say);
}
paintSortBtn();
// Which of the tools show: the list's, one label's, or none.
function paintTools() {
  const list = labelsActive && mode === "list", one = labelsActive && mode === "albums";
  labelsTools.classList.toggle("hidden", !list && !one);
  labelsSortBtn.classList.toggle("hidden", !list);
  const open = list && !labelsSearchBox.classList.contains("hidden");
  labelsSearchBtn.classList.toggle("hidden", !list || open);
  if (!list) labelsSearchBox.classList.add("hidden");
  labelsTools.classList.toggle("is-searching", open);
  if (labelsLogoBtn) labelsLogoBtn.classList.toggle("hidden", !one);
  // The title gives the open field its room on a phone.
  const title = document.getElementById("album-count");
  if (title) title.classList.toggle("is-hidden-by-search", open);
}
const fold = v => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function applyLabelFilter() {
  const q = fold(labelsSearchInput.value);
  let shown = 0;
  grid.querySelectorAll(".album.label-tile").forEach(t => {
    const hit = !q || fold(t.getAttribute("aria-label")).includes(q);
    t.classList.toggle("hidden", !hit);
    if (hit) shown++;
  });
  let none = grid.querySelector(".labels-none");
  if (q && !shown) {
    if (!none) { none = document.createElement("div"); none.className = "labels-none artist-view-empty"; grid.appendChild(none); }
    none.textContent = "No label matches “" + labelsSearchInput.value.trim() + "”";
  } else if (none) none.remove();
}
function closeLabelsSearch() {
  labelsSearchInput.value = "";
  labelsSearchBox.classList.add("hidden");
  applyLabelFilter();
  paintTools();
}
labelsSearchBtn.addEventListener("click", () => {
  labelsSearchBox.classList.remove("hidden");
  paintTools();
  labelsSearchInput.focus();
});
labelsSearchInput.addEventListener("input", applyLabelFilter);
labelsSearchInput.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLabelsSearch(); });
// × as on Home: the first tap clears the words, the next closes the field.
labelsSearchClear.addEventListener("click", () => {
  if (labelsSearchInput.value) { labelsSearchInput.value = ""; applyLabelFilter(); labelsSearchInput.focus(); }
  else closeLabelsSearch();
});
labelsSortBtn.addEventListener("click", () => {
  labelsReversed = !labelsReversed;
  try { localStorage.setItem("rra-labels-reversed", labelsReversed ? "1" : "0"); } catch (e) { /* localStorage optional */ }
  paintSortBtn();
  if (lastLabels) { _lastLabelCount = -1; renderLabelTiles(lastLabels); }
  if (mainEl) mainEl.scrollTop = 0;
});

let currentLabelName = null;
let currentLabelLogoUrl = null; // set when showLabelAlbums loads — used by logo picker
let _labelsScrollSaved = 0;    // restores position when returning from a label's album view
let _labelsScrollTarget = null; // label name to scroll into view when arriving via a deep-link (album/search)
const mainEl = document.querySelector("main");

let mode = null;           // null | "list" | "albums"
let _lastLabelCount = -1;  // track last rendered count to avoid flicker on re-poll
let labelsSelectMode = false;
let labelsSelected   = [];  // [{key, display, mergedFrom}] — first item is merge target

function labelOrder() {
  return localStorage.getItem("rra-label-order") === "random" ? "random" : "alpha";
}
function labelMin() {
  const v = parseInt(localStorage.getItem("rra-label-min") || "1", 10);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

function enterLabelSelectMode() {
  labelsSelectMode = true;
  if (labelMergeBar) { labelMergeBar.classList.remove("hidden"); updateMergeBar(); }
}

function exitLabelSelectMode() {
  labelsSelectMode = false;
  labelsSelected = [];
  if (labelMergeBar) labelMergeBar.classList.add("hidden");
  grid.querySelectorAll(".album.label-tile.is-selected,.album.label-tile.is-first-selected")
    .forEach(b => b.classList.remove("is-selected", "is-first-selected"));
}

function updateMergeBar() {
  if (!labelMergeInfo || !labelMergeBtn) return;
  const n = labelsSelected.length;
  while (labelMergeInfo.firstChild) labelMergeInfo.removeChild(labelMergeInfo.firstChild);
  if (n === 0) {
    labelMergeInfo.textContent = "Tap labels to select";
    labelMergeBtn.textContent = "Merge";
    labelMergeBtn.disabled = true;
  } else if (n === 1) {
    const s = document.createElement("strong"); s.textContent = labelsSelected[0].display;
    labelMergeInfo.appendChild(s);
    labelMergeInfo.appendChild(document.createTextNode(" — select more to merge"));
    labelMergeBtn.textContent = "Merge";
    labelMergeBtn.disabled = true;
  } else {
    labelMergeInfo.appendChild(document.createTextNode("Merge " + n + " into "));
    const s = document.createElement("strong"); s.textContent = labelsSelected[0].display;
    labelMergeInfo.appendChild(s);
    labelMergeBtn.textContent = "Merge";
    labelMergeBtn.disabled = false;
  }
}

function handleLabelTileSelect(btn, lb) {
  const idx = labelsSelected.findIndex(s => s.key === lb.key);
  if (idx >= 0) {
    labelsSelected.splice(idx, 1);
    btn.classList.remove("is-selected", "is-first-selected");
  } else {
    labelsSelected.push({ key: lb.key, display: lb.title, mergedFrom: lb.mergedFrom || [] });
    btn.classList.add("is-selected");
  }
  // Re-apply first-selected only to the first item in the array.
  grid.querySelectorAll(".album.label-tile").forEach(b => b.classList.remove("is-first-selected"));
  if (labelsSelected.length > 0) {
    const fk = labelsSelected[0].key;
    const fb = grid.querySelector(`.album.label-tile[data-label-key="${CSS.escape(fk)}"]`);
    if (fb) fb.classList.add("is-first-selected");
  }
  updateMergeBar();
}

function showUnmergeSheet(targetDisplay, sources) {
  if (!labelUnmergeSheet || !labelUnmergeName || !labelUnmergeList) return;
  labelUnmergeName.textContent = targetDisplay;
  labelUnmergeList.innerHTML = "";
  for (const src of sources) {
    const row = document.createElement("div");
    row.className = "label-unmerge-row";
    const nameEl = document.createElement("span");
    nameEl.className = "label-unmerge-source";
    nameEl.textContent = src.display;
    const xBtn = document.createElement("button");
    xBtn.type = "button";
    xBtn.className = "icon-btn label-unmerge-remove";
    xBtn.setAttribute("aria-label", "Remove " + src.display);
    xBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    xBtn.addEventListener("click", async () => {
      xBtn.disabled = true;
      try {
        const r = await fetch("/api/labels/merge/" + encodeURIComponent(src.key), { method: "DELETE" });
        if (!r.ok) throw new Error((await r.json()).error || "Failed");
        row.remove();
        if (!labelUnmergeList.children.length) labelUnmergeSheet.classList.add("hidden");
        _lastLabelCount = -1;
        showLabelsList(false);
      } catch(e) {
        xBtn.disabled = false;
        if (window.__showToast) window.__showToast("Unmerge failed: " + e.message, "error");
      }
    });
    row.appendChild(nameEl);
    row.appendChild(xBtn);
    labelUnmergeList.appendChild(row);
  }
  labelUnmergeSheet.classList.remove("hidden");
}

function exitLabels() {
  mode = null;
  labelsActive = false;
  _lastLabelCount = -1;
  labelsBtn.classList.remove("is-active");
  if (labelsBar) labelsBar.classList.add("hidden");
  closeLabelLogoSheet();
  exitLabelSelectMode();
  exitAlbumSelectMode();
  updateScanBar(null);
  labelsSearchInput.value = "";
  labelsSearchBox.classList.add("hidden");
  paintTools();
  if (labelUnmergeSheet) labelUnmergeSheet.classList.add("hidden");
}
window.__exitLabels       = exitLabels;
window.__showLabelAlbums  = showLabelAlbums;
