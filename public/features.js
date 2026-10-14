// @ts-check
/*
 * features.js — the parts of Mandarin that switch off whole (v1.0.2), on the
 * page: Shelf's switch in Settings → Setup → Shelf, and the side menu's
 * Shelf, offered only while it is on. (The wall display's switch, on its own
 * Setup page, is app.js's as before.)
 *
 * The server keeps the switch (/api/settings/shelf, on by default) and does
 * the rest: off, /shelf is a page saying so and the shelf's list is never
 * made (Features.cs). Unreachable (the Android app offline), the menu is left
 * as it is.
 */
(function features() {
  "use strict";
  const toggle = /** @type {HTMLInputElement | null} */ (document.getElementById("shelf-toggle"));

  /**
   * The side menu's Shelf, offered while Shelf is on. A class of its own,
   * so the Offline switch's showing and hiding of it (app.js) is left alone.
   * @param {boolean} on
   */
  function paint(on) {
    const item = document.querySelector('.menu-item[data-action="shelf"]');
    if (item) item.classList.toggle("feature-off", !on);
    if (toggle) toggle.checked = on;
  }

  /** @returns {Promise<void>} */
  async function read() {
    try {
      const r = await fetch("/api/settings/shelf", { cache: "no-store" });
      if (!r.ok) return;
      paint(!!(await r.json()).enabled);
    } catch (e) { /* unreachable (offline): the menu as it is */ }
  }

  if (toggle) toggle.addEventListener("change", async () => {
    const want = toggle.checked;
    try {
      const r = await fetch("/api/settings/shelf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: want }) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      paint(!!(await r.json()).enabled);
    } catch (e) {
      toggle.checked = !want;   // not saved: the switch back as it was
      const toast = /** @type {any} */ (window).__showToast;
      if (typeof toast === "function") toast("Couldn't change Shelf: " + (e instanceof Error ? e.message : String(e)));
    }
  });
  read();
})();
