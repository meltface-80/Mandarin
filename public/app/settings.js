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
