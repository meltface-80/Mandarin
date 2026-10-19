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
// Settings → Setup → UI Settings: the Android app's native screens, each a preview, on this phone (the app keeps
// each choice): Now playing, and (an app that has it) the album page.
(function initNativeScreens() {
  const app = window.MusicdApp;
  const block = document.getElementById("native-screens");
  const sw = document.getElementById("native-np-on"), album = document.getElementById("native-album-on");
  if (!app || typeof app.nativeNowPlaying !== "function" || !block || !sw) return;
  block.classList.remove("hidden");
  const hasAlbum = typeof app.nativeAlbum === "function" && !!album;
  if (hasAlbum) for (const id of ["native-album-row", "native-album-note"]) document.getElementById(id).classList.remove("hidden");
  const paint = () => { sw.checked = !!app.nativeNowPlaying(); if (hasAlbum) album.checked = !!app.nativeAlbum(); };
  sw.addEventListener("change", () => app.setNativeNowPlaying(sw.checked));
  if (hasAlbum) album.addEventListener("change", () => app.setNativeAlbum(album.checked));
  const navItem = document.querySelector('.settings-nav-item[data-pane="ui"]');
  if (navItem) navItem.addEventListener("click", paint);
  paint();
})();
