/* ------------------------------------------------------------------ */
/*  Settings → UI Settings (v0.6.5): text sizes, the walls' columns or */
/*  list, and the tile size — on this device (window.__uiPrefs).        */
/* ------------------------------------------------------------------ */
(function initUiPane() {
  const pane = document.querySelector('.settings-pane[data-pane="ui"]');
  if (!pane || !window.__uiPrefs) return;
  const sels = { text: "ui-text-select", title: "ui-title-select", menu: "ui-menu-select", layout: "ui-layout-select", tile: "ui-tile-select" };
  function paint() {
    const desk = window.__uiPrefs.isDesktop();
    for (const [k, id] of Object.entries(sels)) {
      const el = document.getElementById(id);
      if (!el) continue;
      // +75% and +100% are offered on a desktop only.
      el.querySelectorAll("option[data-desktop]").forEach(o => { o.hidden = !desk; o.disabled = !desk; });
      el.value = window.__uiPrefs.get(k);
    }
  }
  for (const [k, id] of Object.entries(sels)) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => { window.__uiPrefs.set(k, el.value); paint(); });
  }
  const navItem = document.querySelector('.settings-nav-item[data-pane="ui"]');
  if (navItem) navItem.addEventListener("click", paint);
  paint();
})();
