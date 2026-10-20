/* The Settings sheet (app/settings.js), 3 of 4: the share card's services, the list and its pages, Smart Picks. */
// ----- Share card: services and reviews -----
//
// Both lists are BUILT FROM THE SERVER'S ANSWER rather than from markup, for
// the same reason the theme picker is built from the THEMES table: the list
// of what can be linked to lives in lib/share-links.js, and a hand-written
// copy here would be a second place for it to be wrong. The screen shows
// what CAN be shown, which is why the endpoint serves the full table
// alongside the enabled set and not just the set.
//
// Saving sends the whole array, never a delta. An empty array is a real
// answer — "all of them off" — and the server tells the two apart by
// Array.isArray, so a user who switches everything off gets what they asked
// for instead of the defaults back.
const shareServicesList = document.getElementById("share-services-list");
const shareReviewsList  = document.getElementById("share-reviews-list");
let shareLinkState = null;   // { services: {all, enabled}, reviews: {...} }

function renderShareToggles(listEl, group, onSave) {
  if (!listEl || !group) return;
  listEl.innerHTML = "";
  const on = new Set(group.enabled || []);
  for (const item of group.all || []) {
    const row = document.createElement("div");
    row.className = "settings-row";

    const label = document.createElement("span");
    label.className = "settings-label";
    // The chip label where there is one, so this screen reads the same as
    // the row it controls — "AllMusic artist", not "AllMusic" twice.
    label.textContent = item.chip || item.name;

    const sw = document.createElement("label");
    sw.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = on.has(item.id);
    input.setAttribute("aria-label", item.chip || item.name);
    input.dataset.id = item.id;
    const track = document.createElement("span");
    track.className = "switch-track";
    const thumb = document.createElement("span");
    thumb.className = "switch-thumb";
    track.appendChild(thumb);
    sw.appendChild(input); sw.appendChild(track);

    input.addEventListener("change", () => {
      // Read the whole list off the DOM rather than tracking a set: what is
      // on screen IS the answer being saved, so the two cannot drift.
      const ids = Array.prototype.filter
        .call(listEl.querySelectorAll('input[type="checkbox"]'), c => c.checked)
        .map(c => c.dataset.id);
      group.enabled = ids;
      onSave(ids);
      // Switching a service off can invalidate the default, so the list of
      // candidates is rebuilt from what is left.
      if (listEl === shareServicesList) renderShareDefault(group);
    });

    row.appendChild(label); row.appendChild(sw);
    listEl.appendChild(row);
  }
}

async function saveShareLinks(patch) {
  try {
    const r = await fetch("/api/settings/share-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
  } catch (e) {
    if (window.__showToast) window.__showToast("Couldn't save that", "err");
  }
}

/*
 * The default service, in Settings as well as on the chip.
 *
 * THE SAME localStorage KEY the share sheet uses — one preference, two ways
 * in. It is per device and not a server setting (see the note beside
 * preferredService in the share module), which is why this reads and writes
 * storage directly rather than posting anything.
 *
 * The list is the ENABLED services only: offering a default that is switched
 * off would send a tap somewhere the user has already said they do not want.
 * Turning off the current default therefore changes it, so the select is
 * rebuilt whenever the toggles are.
 */
const shareDefaultSel = document.getElementById("share-default-service");
const SHARE_PREF_KEY_SETTINGS = "musicd-share-service";

function renderShareDefault(group) {
  if (!shareDefaultSel || !group) return;
  const all = group.all || [];
  const on  = new Set(group.enabled || []);
  const enabled = all.filter(s => on.has(s.id));
  shareDefaultSel.innerHTML = "";
  if (!enabled.length) {
    const o = document.createElement("option");
    o.textContent = "No services switched on";
    o.value = "";
    shareDefaultSel.appendChild(o);
    shareDefaultSel.disabled = true;
    return;
  }
  shareDefaultSel.disabled = false;
  let stored = null;
  try { stored = localStorage.getItem(SHARE_PREF_KEY_SETTINGS); }
  catch (e) { /* private browsing */ }
  const chosen = (stored && enabled.some(s => s.id === stored)) ? stored : enabled[0].id;
  for (const svc of enabled) {
    const o = document.createElement("option");
    o.value = svc.id;
    o.textContent = svc.name;
    o.selected = svc.id === chosen;
    shareDefaultSel.appendChild(o);
  }
}

if (shareDefaultSel) {
  shareDefaultSel.addEventListener("change", () => {
    const id = shareDefaultSel.value;
    if (!id) return;
    try { localStorage.setItem(SHARE_PREF_KEY_SETTINGS, id); }
    catch (e) { /* the choice lasts this session */ }
  });
}

async function loadShareLinkSettings() {
  if (!shareServicesList && !shareReviewsList) return;
  try {
    const r = await fetch("/api/settings/share-links");
    if (!r.ok) return;
    shareLinkState = await r.json();
    renderShareToggles(shareServicesList, shareLinkState.services,
      ids => saveShareLinks({ services: ids }));
    renderShareToggles(shareReviewsList, shareLinkState.reviews,
      ids => saveShareLinks({ reviews: ids }));
    renderShareDefault(shareLinkState.services);
    renderCardReview(!(shareLinkState.card && shareLinkState.card.review === false));
  } catch (e) { /* the panes stay empty; nothing else depends on them */ }
}

const cardReviewInput = document.getElementById("share-card-review");
const cardReviewNote  = document.getElementById("share-card-review-note");
function renderCardReview(on) {
  if (!cardReviewInput) return;
  cardReviewInput.checked = on;
  if (cardReviewNote) {
    cardReviewNote.textContent = on
      ? "On. The card carries the write-up about the album under the cover."
      : "Off. The card shows the cover, title, artist and year — no write-up.";
  }
}
if (cardReviewInput) {
  cardReviewInput.addEventListener("change", () => {
    renderCardReview(cardReviewInput.checked);
    saveShareLinks({ card_review: cardReviewInput.checked });
  });
}
window.__afterStart(loadShareLinkSettings);   // Settings panes only

// Settings is a two-level view: a category home list and one pane per
// category. Only one .settings-view is visible at a time. The controls and
// their IDs are unchanged — they just live inside panes now — so all the
// load*/save* wiring above still resolves against the same elements.
const sheet = settingsOverlay.querySelector(".settings-sheet");
// Looked up each time: the Android app adds a pane of its own (Downloads).
const showView = (name) => {
  const views = sheet ? sheet.querySelectorAll(".settings-view") : [];
  let matched = false;
  views.forEach(v => {
    const isHome = v.getAttribute("data-view") === "home";
    const key    = isHome ? "home" : v.getAttribute("data-pane");
    const on     = key === name;
    v.classList.toggle("hidden", !on);
    if (on) matched = true;
  });
  // Fall back to home if an unknown pane was requested.
  if (!matched) views.forEach(v => v.classList.toggle("hidden", v.getAttribute("data-view") !== "home"));
  // On a tablet or desktop the list is a drawer the side menu's width and a page is as
  // wide as it needs (style.css, v0.6.6); the sheet says which it holds.
  if (sheet) sheet.classList.toggle("is-pane", matched && name !== "home");
  // Each level starts scrolled to the top, like a pushed page.
  if (sheet) sheet.scrollTop = 0;
};
const atHome = () => {
  const home = sheet && sheet.querySelector('.settings-view[data-view="home"]');
  return !home || !home.classList.contains("hidden");
};
// One level up: a pane that names its parent (data-parent) goes there —
// Setup's pages back to Setup (v0.6.21) — anything else to the Settings list.
// The page the Android app's own Settings asked for (item 76): its Back closes Settings, back to the app's list.
let settingsAppPane = null;
const stepBack = () => {
  const open = sheet && sheet.querySelector('.settings-view[data-view="pane"]:not(.hidden)');
  if (open && settingsAppPane && open.getAttribute("data-pane") === settingsAppPane) { settingsAppPane = null; settingsOverlay.classList.add("hidden"); return; }
  const parent = open && open.getAttribute("data-parent");
  showView(parent || "home");
};
// For panes filled elsewhere (a device's page, opened from a list row).
window.__settingsShowView = showView;

if (sheet) {
  sheet.addEventListener("click", (e) => {
    const nav = e.target.closest(".settings-nav-item");
    if (nav) { showView(nav.getAttribute("data-pane")); return; }
    if (e.target.closest("[data-settings-back]")) { stepBack(); return; }
  });
}

// ----- Smart Picks -----------------------------------------------------
// The build reaches three external services and then hands Roon a batch of
// albums to import, so WHEN it runs is a real setting rather than a nicety:
// 4am costs nothing, the same work at 8pm competes with whatever Roon is
// doing while somebody is listening.
const picksHour    = document.getElementById("picks-hour");
const picksAutoAdd = document.getElementById("picks-autoadd");
const picksRebuild = document.getElementById("picks-rebuild");
const picksNote    = document.getElementById("picks-service-note");

if (picksHour && !picksHour.options.length) {
  for (let h = 0; h < 24; h++) {
    const o = document.createElement("option");
    o.value = String(h);
    o.textContent = (h < 10 ? "0" + h : String(h)) + ":00";
    picksHour.appendChild(o);
  }
}

async function saveSmartPicksSettings(patch) {
  try {
    const r = await fetch("/api/settings/smart-picks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    const j = await r.json();
    if (!r.ok || j.error) { settingsToast(j.error || "Couldn't save", "error"); return false; }
    return true;
  } catch (e) {
    settingsToast("Couldn't save: " + e.message, "error");
    return false;
  }
}

const picksEnabled = document.getElementById("picks-enabled");

async function loadSmartPicksSettings() {
  if (!picksHour && !picksAutoAdd && !picksEnabled) return;
  try {
    const r = await fetch("/api/settings/smart-picks");
    if (!r.ok) return;
    const j = await r.json();
    if (picksEnabled) picksEnabled.checked = !!j.enabled;
    // A device that was not the one that flipped the switch catches up here.
    if (window.__applyFeatureMenu) window.__applyFeatureMenu({ picks: !!j.enabled });
    if (picksHour && Number.isFinite(j.hour)) picksHour.value = String(j.hour);
    if (picksAutoAdd) picksAutoAdd.checked = !!j.auto_add;
    if (picksNote) {
      picksNote.textContent = j.service_ready
        ? "Picks you were not offered automatically are always yours to accept or reject."
        : "Picks can be shown but not added to a streaming library.";
    }
  } catch (e) {
    // Settings simply show their last values; the pane is not the place to
    // report a transient fetch failure.
  }
}

if (picksEnabled) {
  picksEnabled.addEventListener("change", async () => {
    const on = picksEnabled.checked;
    if (await saveSmartPicksSettings({ enabled: on })) {
      settingsToast(on ? "Smart Picks on — the first set builds at the scheduled hour"
                   : "Smart Picks off — nothing runs in the background");
      if (window.__applyFeatureMenu) window.__applyFeatureMenu({ picks: on });
    } else {
      picksEnabled.checked = !on;   // the server refused — do not lie about it
    }
  });
}

if (picksHour) {
  picksHour.addEventListener("change", async () => {
    const h = parseInt(picksHour.value, 10);
    if (await saveSmartPicksSettings({ hour: h })) {
      settingsToast("Smart Picks will build at " + (h < 10 ? "0" + h : h) + ":00");
    }
  });
}
if (picksAutoAdd) {
  picksAutoAdd.addEventListener("change", async () => {
    const on = picksAutoAdd.checked;
    if (await saveSmartPicksSettings({ auto_add: on })) {
      settingsToast(on ? "Picks will be added automatically"
                   : "Every pick will ask before adding");
    } else {
      picksAutoAdd.checked = !on;   // the server refused — do not lie about it
    }
  });
}
if (picksRebuild) {
  picksRebuild.addEventListener("click", async () => {
    picksRebuild.disabled = true;
    const orig = picksRebuild.textContent;
    picksRebuild.textContent = "…";
    try {
      const r = await fetch("/api/smart-picks/rebuild", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      settingsToast(r.ok ? "Rebuilding today's picks — check back in a minute"
                     : (j.error || "Couldn't rebuild"), r.ok ? "ok" : "error");
    } catch (e) {
      settingsToast("Couldn't rebuild: " + e.message, "error");
    } finally {
      picksRebuild.disabled = false;
      picksRebuild.textContent = orig;
    }
  });
}
