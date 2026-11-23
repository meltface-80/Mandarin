/* Settings → Services → Default service (item 522): the service whose albums an artist's page shows after the
 * library's (artist-view.js, /api/artist-discography). None, Qobuz or Tidal, each saying when it isn't signed
 * in. The app's is its own (SettingsServices.kt), worded the same. */
(() => {
  const pick = /** @type {HTMLSelectElement|null} */ (document.getElementById("default-service"));
  if (!pick) return;
  /** @param {{ service?: string, choices?: { id: string, name: string, connected: boolean }[] }} j */
  const paint = (j) => {
    const opts = [["", "None"]].concat((j.choices || []).map(c => [c.id, c.name + (c.connected ? "" : " (not signed in)")]));
    pick.replaceChildren(...opts.map(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; return o; }));
    pick.value = j.service || "";
  };
  const load = async () => {
    try { paint(await (await fetch("/api/settings/default-service", { cache: "no-store" })).json()); }
    catch (_) { /* the server not there a moment: read again when Services opens */ }
  };
  pick.addEventListener("change", async () => {
    try {
      const r = await fetch("/api/settings/default-service", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service: pick.value }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't save");
      paint(j);
    } catch (e) { settingsToast(e instanceof Error ? e.message : String(e), "error"); load(); }
  });
  // Read when Services opens (a service signed in or out meanwhile is said as it is now).
  document.addEventListener("click", (e) => {
    const t = /** @type {HTMLElement|null} */ (e.target instanceof HTMLElement ? e.target.closest("[data-pane='streaming']") : null);
    if (t) load();
  });
  if (!EMBED) load();
})();
