/* The Settings sheet (app/settings.js), 3 of 4: the list and its pages, Smart Picks. */
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
    // A row that is a page of its own (SQ-tool, item 288, at /sq-tool/): opened beside Mandarin, as it opens standalone.
    if (nav && nav.hasAttribute("data-open")) { window.open(nav.getAttribute("data-open"), "_blank", "noopener"); return; }
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
