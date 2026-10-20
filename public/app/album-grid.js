/* The page's core (app.js until v1.0.5), 19 of 33: the multi-select menu, the album grid drawn, the rooms read, and the dialogs. */
// ----- The multi-select actions menu -------------------------------------
// One menu serves both selections: albums on a grid screen, and tracks inside
// the album view. They can never both be live — opening the album view exits
// album select mode — so `selMenuKind` says which one the menu is acting on
// rather than two menus racing for the same corner of the screen.
let selMenuKind = null;   // "albums" | "tracks" | null

function closeSelectMenu() {
  if (!selMenu) return;
  selMenu.classList.add("hidden");
  if (selMenuBtn) selMenuBtn.setAttribute("aria-expanded", "false");
}

// The album view is a full-viewport modal painted OVER the top bar, so a menu
// that lives in the top bar is invisible and untappable while an album is
// open — selecting tracks produced ticks and no way to act on them.
//
// The live node is MOVED rather than duplicated. A second copy in the modal
// would need its own listeners and its own count, and the two would drift.
let selMenuHome = null;
function parkSelectMenu(intoModal) {
  if (!selMenuWrap) return;
  if (intoModal) {
    const panel = modal && modal.querySelector(".modal-panel");
    if (!panel || selMenuWrap.parentNode === panel) return;
    // Remember exactly where it came from, so it goes back to the same slot
    // rather than to the end of the row.
    selMenuHome = { parent: selMenuWrap.parentNode, next: selMenuWrap.nextSibling };
    selMenuWrap.classList.add("in-modal");
    panel.appendChild(selMenuWrap);
  } else {
    if (!selMenuHome) return;
    selMenuWrap.classList.remove("in-modal");
    selMenuHome.parent.insertBefore(selMenuWrap, selMenuHome.next);
    selMenuHome = null;
  }
}

// Show/hide the whole control and keep its count honest. Called after every
// change to either selection.
function refreshSelectMenu(kind, n) {
  selMenuKind = n > 0 ? kind : null;
  if (!selMenuWrap) return;
  selMenuWrap.classList.toggle("hidden", n === 0);
  if (n === 0) { closeSelectMenu(); return; }
  if (selCount) selCount.textContent = String(n);
  const noun = kind === "tracks" ? "track" : "album";
  if (selMenuTitle) selMenuTitle.textContent = `${n} ${noun}${n === 1 ? "" : "s"} selected`;
  const addItem = selMenu && selMenu.querySelector('[data-sel-act="add"]');
  // Albums are allowed. Adding one stores its tracks, which means reading the
  // album on the Core first — see /api/user-playlists/add-albums.
  if (addItem) addItem.classList.remove("hidden");
  if (selMenuBtn) {
    selMenuBtn.setAttribute("aria-label",
      `Actions for ${n} selected ${noun}${n === 1 ? "" : "s"}`);
  }
}

function enterAlbumSelectMode() {
  albumSelectMode = true;
  updateAlbumActionBar();
}

function exitAlbumSelectMode() {
  albumSelectMode = false;
  albumSelected = [];
  if (albumActionBar) albumActionBar.classList.add("hidden");
  // Hides the whole control, not just the open dropdown — closeSelectMenu()
  // alone left a "0" badge sitting in the top bar with nothing behind it.
  refreshSelectMenu("albums", 0);
  // Document-wide, not just #album-grid: Home's carousels live outside the
  // grid and are selectable now, so a grid-scoped clear would leave ticks
  // behind on rows the user had already scrolled past.
  document.querySelectorAll(".album.is-selected")
          .forEach(b => b.classList.remove("is-selected"));
}
window.__exitAlbumSelectMode = exitAlbumSelectMode;
window.__enterAlbumSelectMode = enterAlbumSelectMode;   // the tests' long press

// The bottom bar is kept as the "you are in select mode, nothing chosen yet"
// hint — without it, long-pressing produces no visible change at all until
// the first tap. Once something IS selected the top-bar menu carries the
// actions, so the bar's own buttons are gone.
function updateAlbumActionBar() {
  const n = albumSelected.length;
  if (albumActionBar) albumActionBar.classList.toggle("hidden", !albumSelectMode || n > 0);
  if (albumActionInfo) albumActionInfo.textContent = "Tap albums to select";
  refreshSelectMenu("albums", n);
}

function handleAlbumTileSelect(btn, a) {
  const idx = albumSelected.findIndex(x => x.offset === a.offset);
  if (idx === -1) { albumSelected.push(a); btn.classList.add("is-selected"); }
  else            { albumSelected.splice(idx, 1); btn.classList.remove("is-selected"); }
  updateAlbumActionBar();
}

// Builds the album tiles into the grid. Shared by the random wall and search.
function renderAlbumGrid(albums) {
  grid.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const a of albums) frag.appendChild(keyWallTile(buildAlbumTile(a)));   // the random wall is the contract's `wall`
  grid.appendChild(frag);
}

function renderAlbums(albums) {
  if (!albums.length) {
    grid.innerHTML = "";
    setBanner("No albums were returned. Is your library indexed?", true);
    return;
  }
  setBanner(null);
  renderAlbumGrid(albums);
}

// ----- Random albums fetch -----
// ----- Library album count -----
// The topbar no longer shows a persistent "N albums" readout — it crowded
// the controls on phones. The library total now lives in Settings; the
// topbar element is reused only for transient CONTEXT (the active filter
// value and the labels-browser breadcrumb) and is hidden on the plain wall.
// Set the topbar context text directly (used by the labels browser).
function setCountText(text) {
  const el = document.getElementById("album-count");
  if (!el) return;
  el.textContent = text || "";
  // An empty label HIDES the readout rather than showing a blank one. The
  // playlist detail screens pass "" because they already print the full name
  // as a heading; the topbar copy only repeated it, truncated to fit
  // ("My Dynamic Playlist - Electroni…" above "My Dynamic Playlist -
  // Electronic 100").
  el.classList.toggle("hidden", !text);
}
// Topbar context label: the active filter's value (genre/tag name) with NO
// count, or "Random albums" on the plain wall (v0.6.24: a title, as every
// other grid screen has); hidden on Home (`hide`). Counts were removed
// from all screens.
function updateCountReadout(filteredTotal, hide) {
  const el = document.getElementById("album-count");
  if (!el) return;
  if (labelsActive) return;   // labels browser manages its own header text
  if (activeFilter) {
    el.textContent = activeFilter.label || activeFilter.value;   // group label (e.g. "Rock/Metal") if set
    el.classList.remove("hidden");
  } else if (!hide && !libraryWallActive && !unplayedWallActive && !grid.classList.contains("hidden")) {
    el.textContent = "Random albums";
    el.classList.remove("hidden");
  } else {
    el.textContent = "";
    el.classList.add("hidden");
  }
}

async function loadRandom() {
  refreshBtn.disabled = true;
  albumCount = computeAlbumCount();
  renderSkeletons(albumCount);
  try {
    const r = await fetch(`/api/random-albums?count=${albumCount}${filterQS()}`);
    if (r.status === 503) {
      const j = await r.json().catch(() => ({}));
      setBanner(j.error || "Reading your music library…", true);
      grid.innerHTML = ""; return;
    }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${r.status}`);
    }
    const j = await r.json();
    renderAlbums(j.albums || []);
    updateCountReadout(j.filtered ? j.total : null);
  } catch (e) {
    setBanner(`Couldn't load albums: ${e.message}`, true);
    grid.innerHTML = "";
  } finally {
    refreshBtn.disabled = false;
  }
}

// ----- Zones -----
// One ask at a time (v0.8.36): a slow answer isn't joined by another every 15 s.
let zonesAsked = null;
function loadZones() {
  return zonesAsked || (zonesAsked = loadZonesNow().finally(() => { zonesAsked = null; }));
}
async function loadZonesNow() {
  try {
    const r = await fetch("/api/zones");
    const j = await r.json();
    zones = j.zones || [];
    let prev = localStorage.getItem("rra-zone");
    zoneSel.innerHTML = "";
    if (!zones.length) {
      const opt = document.createElement("option");
      // Away from home (over Tailscale) the rooms aren't offered at all.
      opt.textContent = j.away ? "Away from home — no rooms" : "No Sonos rooms found yet"; opt.value = "";
      zoneSel.appendChild(opt);
      selectedZoneId = null;
      return;
    }
    // Nothing is picked for you: until you choose a zone (the mini
    // transport's speaker button, or here) there is no zone selected, and
    // the bar says so. A zone chosen before is remembered.
    let known = prev && zones.some(z => z.zone_id === prev);
    // The phone alone (no network, or away from home): it's the zone, picked already.
    const only = zones.length === 1 && zones[0].is_phone ? zones[0].zone_id : null;
    if (!known && only) { known = true; prev = only; }
    if (!known) {
      const opt = document.createElement("option");
      opt.value = ""; opt.textContent = "Choose a zone…";
      zoneSel.appendChild(opt);
    }
    for (const z of zones) {
      const opt = document.createElement("option");
      opt.value = z.zone_id; opt.textContent = z.display_name;
      zoneSel.appendChild(opt);
    }
    selectedZoneId = known ? prev : null;
    zoneSel.value = selectedZoneId || "";
  } catch (e) { /* status banner handles */ }
}
// Styled yes/no confirm. Resolves true/false. Falls back to native confirm.
// A notice with one OK (v0.7.2): the confirm box with its No put away.
function noticeDialog(message, okLabel) {
  return new Promise((resolve) => {
    const ov  = document.getElementById("confirm-overlay");
    const msg = document.getElementById("confirm-msg");
    const yes = document.getElementById("confirm-yes");
    const no  = document.getElementById("confirm-no");
    if (!ov || !msg || !yes || !no) { window.alert(message); resolve(); return; }
    msg.textContent = message;
    msg.classList.add("is-notice");
    no.classList.add("hidden");
    const was = yes.textContent; yes.textContent = okLabel || "OK";
    let done = false;
    const close = () => {
      if (done) return; done = true;
      ov.classList.add("hidden");
      no.classList.remove("hidden"); msg.classList.remove("is-notice"); yes.textContent = was;
      yes.removeEventListener("click", close);
      ov.removeEventListener("click", onBackdrop);
      resolve();
    };
    const onBackdrop = (e) => { if (e.target.classList.contains("confirm-backdrop")) close(); };
    yes.addEventListener("click", close);
    ov.addEventListener("click", onBackdrop);
    ov.classList.remove("hidden");
    yes.focus();
  });
}
window.__noticeDialog = noticeDialog;
function confirmDialog(message) {
  return new Promise((resolve) => {
    const ov  = document.getElementById("confirm-overlay");
    const msg = document.getElementById("confirm-msg");
    const yes = document.getElementById("confirm-yes");
    const no  = document.getElementById("confirm-no");
    if (!ov || !msg || !yes || !no) { resolve(window.confirm(message)); return; }
    msg.textContent = message;
    let done = false;
    const close = (val) => {
      if (done) return; done = true;
      ov.classList.add("hidden");
      yes.removeEventListener("click", onYes);
      no.removeEventListener("click", onNo);
      ov.removeEventListener("click", onBackdrop);
      resolve(val);
    };
    const onYes = () => close(true);
    const onNo  = () => close(false);
    const onBackdrop = (e) => { if (e.target.classList.contains("confirm-backdrop")) close(false); };
    yes.addEventListener("click", onYes);
    no.addEventListener("click", onNo);
    ov.addEventListener("click", onBackdrop);
    ov.classList.remove("hidden");
  });
}
// For the other parts of the page. The Android app's WebView answers the
// browser's own confirm() with "no" (it has no dialog for it), so a
// yes/no anywhere in the page is asked with this one.
window.__confirmDialog = confirmDialog;

// A name, asked the same way. Resolves the text, or null when cancelled —
// what prompt() would give, which the WebView answers with null every time
// (so "New playlist…" and "Save as…" used to close and do nothing in the app).
function promptDialog(message, initial, okLabel) {
  return new Promise((resolve) => {
    const ov = document.getElementById("prompt-overlay");
    const form = document.getElementById("prompt-form");
    const msg = document.getElementById("prompt-msg");
    const input = document.getElementById("prompt-input");
    const ok = document.getElementById("prompt-ok");
    const cancel = document.getElementById("prompt-cancel");
    if (!ov || !form || !msg || !input || !ok || !cancel) { resolve(window.prompt(message, initial || "")); return; }
    msg.textContent = message;
    input.value = initial || "";
    ok.textContent = okLabel || "Save";
    let done = false;
    const close = (val) => {
      if (done) return; done = true;
      ov.classList.add("hidden");
      form.removeEventListener("submit", onSubmit);
      cancel.removeEventListener("click", onCancel);
      ov.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      resolve(val);
    };
    const onSubmit = (e) => { e.preventDefault(); close(input.value); };
    const onCancel = () => close(null);
    const onBackdrop = (e) => { if (e.target.classList.contains("confirm-backdrop")) close(null); };
    const onKey = (e) => { if (e.key === "Escape") close(null); };
    form.addEventListener("submit", onSubmit);
    cancel.addEventListener("click", onCancel);
    ov.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
    ov.classList.remove("hidden");
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}
window.__promptDialog = promptDialog;

zoneSel.addEventListener("change", async () => {
  const newZoneId  = zoneSel.value;
  const prevZoneId = selectedZoneId;

  // Switch the active zone right away — this is what play actions and the
  // mini-transport target. Changing zones no longer moves the queue on its
  // own; we ask first (and only when the old zone is actually playing).
  selectedZoneId = newZoneId || null;
  if (selectedZoneId) {
    localStorage.setItem("rra-zone", selectedZoneId);
    const blank = zoneSel.querySelector('option[value=""]');
    if (blank) blank.remove();
  }

  if (!prevZoneId || !newZoneId || prevZoneId === newZoneId) return;
  // A room the Android app's native screens chose (native-handoff.js "zone"): the app asks this itself, over its own screen.
  if (window.__zoneFromApp) return;

  let playing = false;
  try {
    const r = await fetch(`/api/album/now-playing?zone=${encodeURIComponent(prevZoneId)}`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      playing = !!(j && j.album && j.album.title);
    }
  } catch (e) { /* treat as nothing playing */ }
  if (!playing) return;

  const nameOf = (id, fb) => (zones.find(z => z.zone_id === id) || {}).display_name || fb;
  const move = await confirmDialog(
    `Move what's playing in ${nameOf(prevZoneId, "the other zone")} to ${nameOf(newZoneId, "this zone")}?`
  );
  if (!move) return;

  try {
    const r = await fetch("/api/transfer-zone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: prevZoneId, to: newZoneId })
    });
    const toast = (m, kind) => { if (window.__showToast) window.__showToast(m, kind); };
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast((j.error || "Couldn't move the music").toString(), "error");
    } else {
      toast(`Moved to ${nameOf(newZoneId, "this zone")}`);
    }
    loadZones();
  } catch (e) {
    if (window.__showToast) window.__showToast("Couldn't reach the server to move the music", "error");
  }
});
