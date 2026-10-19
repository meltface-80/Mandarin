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
// Settings → Setup → Home Screen (v1.0.7): the greeting and Random Album, each on or off, on this device.
(function initHomeTopSwitches() {
  if (!window.__uiPrefs) return;
  const sws = { greeting: "home-greeting-on", random: "home-random-on" };
  const paint = () => { for (const [k, id] of Object.entries(sws)) { const el = document.getElementById(id); if (el) el.checked = window.__uiPrefs.get(k) !== "off"; } };
  for (const [k, id] of Object.entries(sws)) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => window.__uiPrefs.set(k, el.checked ? "on" : "off"));
  }
  const navItem = document.querySelector('.settings-nav-item[data-pane="homescreen"]');
  if (navItem) navItem.addEventListener("click", paint);
  paint();
})();
// Settings → Setup → UI Settings: the Android app's native Library wall, a preview, on this phone (the app keeps the
// choice; bug list item 51).
(function initNativeLibrary() {
  const app = window.MusicdApp;
  const block = document.getElementById("native-screens"), sw = document.getElementById("native-library-on");
  if (!app || typeof app.nativeLibrary !== "function" || !block || !sw) return;
  block.classList.remove("hidden");
  const paint = () => { sw.checked = !!app.nativeLibrary(); };
  sw.addEventListener("change", () => app.setNativeLibrary(sw.checked));
  // Native Home (item 57), the same way; an app from before it has no switch for it.
  const home = document.getElementById("native-home-on");
  const homeOn = () => typeof app.nativeHome === "function" && app.nativeHome();
  if (home) { home.closest(".settings-row").classList.toggle("hidden", typeof app.nativeHome !== "function"); home.addEventListener("change", () => app.setNativeHome(home.checked)); }
  const paintAll = () => { paint(); if (home) home.checked = !!homeOn(); };
  const navItem = document.querySelector('.settings-nav-item[data-pane="ui"]');
  if (navItem) navItem.addEventListener("click", paintAll);
  paintAll();
})();
