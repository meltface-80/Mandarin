/* ------------------------------------------------------------------ */
/*  Settings sheet: theme toggle (lives here now), version, repo link  */
/* ------------------------------------------------------------------ */
// The Settings sheet's toasts go through window.__showToast, the bridge the
// core (app.js) sets beside its own showToast. When the sheet was a block of
// its own, showToast was not in scope here, and bare showToast() calls threw
// ReferenceError instead of showing a message: token saves, display
// settings, and the Qobuz/TIDAL connect flows all failed silently. An alias
// fixed them all at once (v1.0.5: named settingsToast, as the page's parts
// share one top and the core's showToast is a name of its own).
const settingsToast = (msg, kind) => {
  if (window.__showToast) window.__showToast(msg, kind);
};
const openBtn    = document.getElementById("settings-toggle");
const settingsOverlay    = document.getElementById("settings-overlay");
// While Settings covers the page, the page behind it doesn't scroll — so its
// scrollbar isn't drawn beside a Settings page that has nothing to scroll.
const markOpen = () => document.body.classList.toggle("settings-open", !settingsOverlay.classList.contains("hidden"));
new MutationObserver(markOpen).observe(settingsOverlay, { attributes: true, attributeFilter: ["class"] });
markOpen();
const versionEl  = document.getElementById("settings-version");
const labelOrderSelect = document.getElementById("label-order-select");
const labelMinSelect   = document.getElementById("label-min-select");

// Label album order (alphabetical default). Persisted in localStorage and
// read by the labels browser when it loads a label's albums.
if (labelOrderSelect) {
  labelOrderSelect.value =
    localStorage.getItem("rra-label-order") === "random" ? "random" : "alpha";
  labelOrderSelect.addEventListener("change", () => {
    const v = labelOrderSelect.value === "random" ? "random" : "alpha";
    localStorage.setItem("rra-label-order", v);
  });
}

// Minimum albums per label — hides one-off outliers from the labels grid.
if (labelMinSelect) {
  const stored = localStorage.getItem("rra-label-min");
  // "Show all" until chosen otherwise — what labelMin() in the labels browser assumes.
  labelMinSelect.value = (stored === "2" || stored === "5" || stored === "10") ? stored : "1";
  labelMinSelect.addEventListener("change", () => {
    localStorage.setItem("rra-label-min", labelMinSelect.value);
  });
}

let versionLoaded = false;
async function loadVersion() {
  if (versionLoaded || !versionEl) return;
  try {
    const r = await fetch("/api/update/status", { cache: "no-store" });
    if (r.ok) {
      const s = await r.json();
      if (s && s.current) {
        const parts = (s.current || "").split(".");
        versionEl.textContent = parts.length >= 3
          ? "Mandarin v" + parts[0] + "." + parts[1] + " (Build " + parts[2] + ")"
          : "Mandarin v" + s.current;
        versionLoaded = true;
      }
    }
  } catch (e) { /* network error loading version — settings panel shows without version, non-critical */ }
}

const forceRescanBtn    = document.getElementById("force-rescan-btn");
const forceRescanStatus = document.getElementById("force-rescan-status");
if (forceRescanBtn) {
  forceRescanBtn.addEventListener("click", async () => {
    if (forceRescanBtn.disabled) return;
    forceRescanBtn.disabled = true;
    forceRescanBtn.textContent = "Starting…";
    if (forceRescanStatus) forceRescanStatus.classList.add("hidden");
    try {
      const r = await fetch("/api/labels/rescan-force", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
      forceRescanBtn.textContent = j.started === false ? "Done" : "Rescan started";
      if (forceRescanStatus) {
        forceRescanStatus.textContent = j.started === false
          ? "Labels re-read from the library's tags and folders" + (j.count != null ? ": " + j.count + " label" + (j.count === 1 ? "" : "s") + "." : ".")
          : "Full rescan started — this may take several minutes. Label data will update as results come in.";
        forceRescanStatus.classList.remove("hidden");
      }
      setTimeout(() => {
        forceRescanBtn.disabled = false;
        forceRescanBtn.textContent = "Force rescan";
      }, 5000);
    } catch (e) {
      forceRescanBtn.disabled = false;
      forceRescanBtn.textContent = "Force rescan";
      if (forceRescanStatus) { forceRescanStatus.textContent = "Error: " + e.message; forceRescanStatus.classList.remove("hidden"); }
    }
  });
}

// Whether each API key works (v0.6.1): the server asks the service, and the
// box says so — a brass ✓ and "Checked and working", or a red ✕ and "Not
// accepted". No answer (offline, the service down) is not shown as bad.
function paintKeyCheck(input, badge, j, emptyHint) {
  const state = j && j.set ? j.check : null;
  if (badge) {
    badge.classList.toggle("hidden", state !== "ok" && state !== "invalid");
    badge.classList.toggle("is-ok", state === "ok");
    badge.classList.toggle("is-bad", state === "invalid");
    badge.textContent = state === "ok" ? "✓" : state === "invalid" ? "✕" : "";
    badge.setAttribute("aria-label", state === "ok" ? "Key checked and working"
      : state === "invalid" ? "Key refused by the service" : "");
    badge.title = badge.getAttribute("aria-label");
  }
  if (input) {
    input.classList.toggle("is-ok", state === "ok");
    input.classList.toggle("is-bad", state === "invalid");
    input.placeholder = !(j && j.set) ? emptyHint
      : state === "ok" ? "Checked and working — " + j.masked
      : state === "invalid" ? "Not accepted — paste a new one"
      : "Saved — " + j.masked;
  }
}
function keyStatusText(j) {
  if (!j.set) return "Not set";
  if (j.check === "ok") return "✓ Checked and working: " + j.masked;
  if (j.check === "invalid") return "The service refused this key (" + j.masked + "). Check it was copied in full.";
  return "Current: " + j.masked + " — couldn’t reach the service to check it.";
}

// One API key's box, status line and Save: Discogs' token and FanArt.tv's key.
function wireKey({ route, field, inputId, saveId, statusId, checkId, service, noun, onSaved }) {
  const input  = document.getElementById(inputId);
  const save   = document.getElementById(saveId);
  const status = document.getElementById(statusId);
  const badge  = document.getElementById(checkId);
  const hint   = input ? input.placeholder : "";
  const paint = (j) => {
    paintKeyCheck(input, badge, j, hint);
    if (status) status.textContent = keyStatusText(j);
  };
  async function load() {
    try {
      const r = await fetch("/api/settings/" + route);
      paint(await r.json());
    } catch (_) { /* display-only status — if the fetch fails, silence is fine; status just stays stale */ }
  }
  if (save) save.addEventListener("click", async () => {
    const value = input ? input.value.trim() : "";
    if (!value) return;
    save.disabled = true;
    try {
      const r = await fetch("/api/settings/" + route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value })
      });
      const j = await r.json();
      if (j.ok) {
        if (input) input.value = "";
        paint(j);
        if (j.check === "invalid") settingsToast("Saved, but " + service + " refused this " + noun, "error");
        else settingsToast(service + " " + noun + " saved" + (j.check === "ok" ? " — checked and working" : ""), "ok");
        if (onSaved) onSaved();
      } else {
        settingsToast(j.error || "Failed to save " + noun, "error");
      }
    } catch (e) {
      settingsToast("Failed: " + e.message, "error");
    } finally {
      save.disabled = false;
    }
  });
  return load;
}
const loadDiscogsToken = wireKey({ route: "discogs-token", field: "token", inputId: "discogs-token-input", saveId: "discogs-token-save",
  statusId: "discogs-token-status", checkId: "discogs-token-check", service: "Discogs", noun: "token" });
const loadFanartKey = wireKey({ route: "fanart-key", field: "key", inputId: "fanart-key-input", saveId: "fanart-key-save",
  statusId: "fanart-key-status", checkId: "fanart-key-check", service: "FanArt.tv", noun: "key" });
const loadLastfmKey = wireKey({ route: "lastfm-key", field: "key", inputId: "lastfm-key-input", saveId: "lastfm-key-save",
  statusId: "lastfm-key-status", checkId: "lastfm-key-check", service: "Last.fm", noun: "key", onSaved: () => loadScrobbling() });
// Scrobbling's (settings-lastfm.js): saving it again leaves the account to connect again.
const loadLastfmSecret = wireKey({ route: "lastfm-secret", field: "secret", inputId: "lastfm-secret-input", saveId: "lastfm-secret-save",
  statusId: "lastfm-secret-status", checkId: "lastfm-secret-check", service: "Last.fm", noun: "shared secret", onSaved: () => loadScrobbling() });
