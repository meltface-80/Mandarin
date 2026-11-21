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

// One API key's box, status line and Save: Last.fm's key; [onPaint]
// with the server's answer, for a line of the key's own.
function wireKey({ route, field, inputId, saveId, statusId, checkId, service, noun, onSaved, onPaint }) {
  const input  = document.getElementById(inputId);
  const save   = document.getElementById(saveId);
  const status = document.getElementById(statusId);
  const badge  = document.getElementById(checkId);
  const hint   = input ? input.placeholder : "";
  const paint = (j) => {
    paintKeyCheck(input, badge, j, hint);
    if (status) status.textContent = keyStatusText(j);
    if (onPaint) onPaint(j);
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
const loadLastfmKey = wireKey({ route: "lastfm-key", field: "key", inputId: "lastfm-key-input", saveId: "lastfm-key-save",
  statusId: "lastfm-key-status", checkId: "lastfm-key-check", service: "Last.fm", noun: "key" });
