/* The Settings sheet (app/settings.js), 4 of 4: waveforms, labels, Home's rows, and Settings opened and closed. */
// ----- Waveform on/off -----
const waveEnabledEl = document.getElementById("waveform-enabled");
const waveEnabledNote = document.getElementById("waveform-enabled-note");
async function loadWaveformEnabled() {
  if (!waveEnabledEl) return;
  try {
    const r = await fetch("/api/settings/waveform");
    if (!r.ok) return;
    const j = await r.json();
    waveEnabledEl.checked = !!j.enabled;
    window.__waveformOn = !!j.enabled;
    showQobuzSecretState(j);
    if (waveEnabledNote) {
      waveEnabledNote.textContent = j.enabled
        ? "On. Each track is analysed the first time it plays and kept, " +
          "so it is instant after that."
        : "Off. The progress bar stays a plain line.";
    }
  } catch (e) { /* keep the last shown value */ }
}
// ----- Qobuz app secret (streaming waveforms) -----
// Blank is the default and the off switch: with no secret the server never
// asks Qobuz for audio and streaming tracks keep the plain bar.
const qSecStatus = document.getElementById("qobuz-secret-status");

// No controls of its own any more: one Qobuz sign-in under Streaming accounts
// covers browsing, favourites and waveforms alike, so this only reports what
// that sign-in means for waveforms.
function showQobuzSecretState(j) {
  if (!qSecStatus) return;
  if (j && j.qobuz_connected) {
    qSecStatus.textContent = "Using your Qobuz sign-in. Qobuz tracks will show a " +
      "waveform once analysed.";
    return;
  }
  if (j && j.qobuz_secret_set) {
    qSecStatus.textContent = "Using saved credentials from an earlier version. " +
      "Reconnect Qobuz under Streaming accounts to replace them.";
    return;
  }
  qSecStatus.textContent = "Connect Qobuz under Streaming accounts to enable this. " +
    "Qobuz tracks keep the plain bar until then.";
}

if (waveEnabledEl) {
  waveEnabledEl.addEventListener("change", async () => {
    const on = waveEnabledEl.checked;
    try {
      const r = await fetch("/api/settings/waveform", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: on })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || "Couldn't save");
      window.__waveformOn = on;
      settingsToast(on ? "Waveform on \u2014 local files show the track's shape"
                   : "Waveform off");
      loadWaveformEnabled();
      // Repaint now rather than at the next track change, so the switch is
      // seen to do something.
      if (window.__repaintWaveform) window.__repaintWaveform();
    } catch (e) {
      waveEnabledEl.checked = !on;   // the server refused — do not lie about it
      settingsToast(e.message, "error");
    }
  });
}

// ----- Labels on/off -----
const labelsEnabledEl = document.getElementById("labels-enabled");
const labelsEnabledNote = document.getElementById("labels-enabled-note");
async function loadLabelsEnabled() {
  if (!labelsEnabledEl) return;
  try {
    const r = await fetch("/api/settings/labels");
    if (!r.ok) return;
    const j = await r.json();
    labelsEnabledEl.checked = !!j.enabled;
    if (window.__applyFeatureMenu) window.__applyFeatureMenu({ labels: !!j.enabled });
    if (labelsEnabledNote) {
      const tagged = j.tagged || 0, untagged = j.untagged || 0, lookedUp = j.looked_up || 0;
      const have = tagged + " album" + (tagged === 1 ? "" : "s") + " name" + (tagged === 1 ? "s" : "") + " a label in " + (tagged === 1 ? "its" : "their") + " tags" +
        (lookedUp ? ", " + lookedUp + " " + (lookedUp === 1 ? "has" : "have") + " one looked up" : "") + "; " +
        untagged + " " + (untagged === 1 ? "has" : "have") + " none" + (j.enabled && untagged && !j.scanning && !lookedUp ? " (MusicBrainz and Discogs didn't know them)" : "") + ".";
      const logos = j.count
        ? (j.scanning ? " Looking up labels and logos now…"
           : (j.discogs || j.fanart) ? " " + (j.logos || 0) + " logo" + (j.logos === 1 ? "" : "s") + "."
           : " Logos need a Discogs token or a FanArt.tv key (Settings → Setup → API Keys).")
        : "";
      labelsEnabledNote.textContent = j.enabled
        ? (j.count ? j.count + " label" + (j.count === 1 ? "" : "s") + ". " + have + logos
                   : "No labels yet: none of the albums' files carry a LABEL tag.")
        : "Off. " + have;
    }
  } catch (e) { /* keep the last shown value */ }
}
if (labelsEnabledEl) {
  labelsEnabledEl.addEventListener("change", async () => {
    const on = labelsEnabledEl.checked;
    try {
      const r = await fetch("/api/settings/labels", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: on })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || "Couldn't save");
      settingsToast(on ? "Labels on" : "Labels off");
      if (window.__applyFeatureMenu) window.__applyFeatureMenu({ labels: on });
      loadLabelsEnabled();
    } catch (e) {
      labelsEnabledEl.checked = !on;   // the server refused — do not lie about it
      settingsToast(e.message, "error");
    }
  });
}

// ----- Home Screen: which rows show, and in what order -----
//
// Rendered from the same HOME_ROWS table the Home screen itself loops, via
// the globals below, so a row can never appear in one and not the other.
const homeRowsList = document.getElementById("home-rows-list");
let homeRowsDraft = [];

function renderHomeRowsList() {
  if (!homeRowsList) return;
  homeRowsList.innerHTML = "";
  const titles = window.__homeRowTitles ? window.__homeRowTitles() : {};
  const downloaded = window.__downloadedCount ? window.__downloadedCount() : 0;
  for (const row of homeRowsDraft) {
    // Rows this device doesn't have (Downloaded albums, outside the Android
    // app) stay in the saved order but aren't listed.
    if (!titles[row.id]) continue;
    // Downloaded albums can't be switched off while there are any.
    const held = row.id === "downloads" && downloaded > 0;
    const li = document.createElement("li");
    li.className = "home-row-item";
    li.dataset.row = row.id;

    const grip = document.createElement("span");
    grip.className = "home-row-grip";
    grip.setAttribute("aria-hidden", "true");
    grip.textContent = "⠿";

    // A row whose FEATURE is off is not a layout choice. It reads as off and
    // cannot be switched on here, because switching it on would do nothing —
    // the row has no data to show. `row.on` is deliberately left ALONE, so
    // turning Smart Picks or Labels back on restores the Home screen the user
    // had rather than one this screen quietly rewrote.
    const off = row.unavailable || null;
    if (off) li.classList.add("is-unavailable");
    if (held) li.classList.add("is-held");

    const name = document.createElement("span");
    name.className = "home-row-name";
    name.textContent = titles[row.id] || row.id;
    if (off || held) {
      const why = document.createElement("span");
      why.className = "home-row-why";
      why.textContent = off || "On while albums are downloaded to this phone";
      name.appendChild(why);
    }

    const sw = document.createElement("label");
    sw.className = "switch";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = held || (!off && row.on !== false);
    cb.disabled = !!off || held;
    cb.setAttribute("aria-label", (titles[row.id] || row.id) + " row");
    cb.addEventListener("change", () => {
      row.on = cb.checked;
      saveHomeRows();
    });
    const track = document.createElement("span");
    track.className = "switch-track";
    const thumb = document.createElement("span");
    thumb.className = "switch-thumb";
    track.appendChild(thumb);
    sw.appendChild(cb); sw.appendChild(track);

    li.appendChild(grip); li.appendChild(name); li.appendChild(sw);
    attachRowDrag(li, grip);
    homeRowsList.appendChild(li);
  }
}

// Hold the grip, then drag. Pointer events so one code path covers touch and
// mouse; the list reorders live under the finger and the draft array is
// rewritten from the DOM on drop, so the two can never disagree.
//
// The dragged row itself is never moved in the DOM — its NEIGHBOURS are,
// past it. Moving the row that holds the pointer capture (insertBefore is a
// remove and an insert) makes the browser drop the capture: the drag
// stopped after one place, and the drop that saves the order never came, so
// a row seen moved went back on the next visit. Swapping neighbours one at a
// time also lets a fast drag pass several rows in one move.
function attachRowDrag(li, grip) {
  let dragging = false;
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dragging = true;
    li.classList.add("is-dragging");
    try { grip.setPointerCapture(e.pointerId); } catch (err) { /* moves still arrive while over the grip */ }
  });
  const mid = el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
  grip.addEventListener("pointermove", (e) => {
    if (!dragging || !homeRowsList) return;
    let prev = li.previousElementSibling, next = li.nextElementSibling;
    while (prev && prev.classList.contains("home-row-item") && e.clientY < mid(prev)) {
      homeRowsList.insertBefore(prev, li.nextSibling);   // the row above drops below
      prev = li.previousElementSibling;
    }
    while (next && next.classList.contains("home-row-item") && e.clientY > mid(next)) {
      homeRowsList.insertBefore(next, li);               // the row below rises above
      next = li.nextElementSibling;
    }
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    li.classList.remove("is-dragging");
    // The DOM is the truth now — read the order back out of it rather than
    // trying to mirror every move into the array as it happened.
    if (homeRowsList) {
      const order = [...homeRowsList.querySelectorAll(".home-row-item")].map(x => x.dataset.row);
      homeRowsDraft.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    }
    saveHomeRows();
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
  // However the drag ends, the order it left is saved.
  grip.addEventListener("lostpointercapture", end);
}

window.__renderHomeRowsList = () => { if (homeRowsList && homeRowsList.offsetParent) renderHomeRowsList(); };

async function saveHomeRows() {
  try {
    const r = await fetch("/api/settings/home-rows", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: homeRowsDraft })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || "Couldn't save");
    if (Array.isArray(j.rows)) {
      homeRowsDraft = j.rows;
      // REDRAW. The server answers with freshly built {id,on} objects, so
      // replacing the array orphaned every checkbox handler still closing
      // over the previous one — after one save, every further toggle
      // mutated a discarded object and was silently dropped, and after a
      // drag the whole list went dead. The list is cheap; rebuild it.
      renderHomeRowsList();
    }
    // Apply immediately — the Home screen is behind this sheet, and a layout
    // that only takes effect on the next launch reads as a broken control.
    if (window.__applyHomeLayout) window.__applyHomeLayout(homeRowsDraft);
  } catch (e) {
    settingsToast(e.message, "error");
    loadHomeRowsSettings();   // resync from the server rather than keep a lie
  }
}

async function loadHomeRowsSettings() {
  if (!homeRowsList) return;
  try {
    const r = await fetch("/api/settings/home-rows");
    if (!r.ok) return;
    const j = await r.json();
    if (j && Array.isArray(j.rows)) homeRowsDraft = j.rows;
  } catch (e) { /* keep whatever is drawn */ }
  renderHomeRowsList();
}

const openSettings = () => { showView("home"); loadRadio(); loadVersion(); loadDiscogsToken(); loadFanartKey(); loadLastfmKey(); loadDisplaySettings(); loadLabelFolderDepth(); loadQobuzStatus(); loadTidalStatus(); loadSmartPicksSettings(); loadLabelsEnabled(); loadWaveformEnabled(); loadHomeRowsSettings(); settingsOverlay.classList.remove("hidden"); };
const closeSettings = () => { settingsOverlay.classList.add("hidden"); };

openBtn.addEventListener("click", openSettings);
settingsOverlay.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-settings-close")) closeSettings();
});
// Settings fills the screen (as the Android app has always had it), so
// there's no backdrop to tap: a close button in its head, everywhere.
{
  const head = settingsOverlay.querySelector('.settings-view[data-view="home"] .settings-head');
  if (head) {
    const x = document.createElement("button");
    x.type = "button";
    x.className = "settings-app-close";
    x.setAttribute("aria-label", "Close settings");
    x.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener("click", closeSettings);
    // On the left, before the title, where every page's Back is.
    head.prepend(x);
  }
}
// The Android app's Back steps out of Settings — a pane to the list, the
// list to Home.
if (window.MusicdDownloads) {
  window.__musicdBack = () => {
    if (settingsOverlay.classList.contains("hidden")) return window.__pageBack ? window.__pageBack() : false;
    if (atHome()) closeSettings(); else stepBack();
    return true;
  };
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || settingsOverlay.classList.contains("hidden")) return;
  // Escape steps back one level: pane → home, home → closed.
  if (atHome()) closeSettings();
  else stepBack();
});
