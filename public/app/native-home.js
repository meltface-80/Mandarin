/* ------------------------------------------------------------------ */
/*  Android app only: Home drawn by the app itself (bug list item 57, a */
/*  preview: Native Home in UI Settings; docs/specs/native-parity.md).  */
/*  The page keeps Home as it is, its state and its Back (the app asks  */
/*  the page first); the app's own Home is laid over it, and this tells */
/*  the app when its Home should be in front (MusicdApp.homeShown):     */
/*  true as the page comes to Home with nothing of its own over it,     */
/*  false as something of the page's comes over it that the app doesn't */
/*  draw: a wall or another screen in Home's place, the search (its     */
/*  field open, or its results in the rows' place), the side menu, a    */
/*  settings page, the album view. The sheets the app asks for over its */
/*  screens (the Share card, Add to playlist; native-handoff.js) are    */
/*  not among them. With it go the UI Settings as JSON and the room, as */
/*  a wall is opened with them (device-power.js, nativePrefsJson).      */
/* ------------------------------------------------------------------ */
(function nativeHome() {
  const app = window.MusicdApp;
  if (!app || typeof app.nativeHome !== "function" || typeof app.homeShown !== "function") return;
  const home = document.getElementById("home-view"), sections = document.getElementById("home-sections"), search = document.getElementById("topbar-search");
  if (!home) return;
  const shown = el => !!el && !el.classList.contains("hidden") && el.getClientRects().length > 0;
  const OVER = ["menu-overlay", "settings-overlay", "qobuz-overlay", "tidal-overlay", "pitchfork-overlay", "filter-overlay", "offline-overlay", "album-modal"];
  const front = () => !home.classList.contains("hidden") && !(sections && sections.classList.contains("hidden")) &&
    !(search && search.classList.contains("is-open")) && !OVER.some(id => shown(document.getElementById(id)));
  let was = false;
  // Said only as it changes (the page's classes change all the time), and only while the app's Home is on.
  const tell = () => {
    const now = front();
    if (now === was) return;
    was = now;
    if (!app.nativeHome()) return;
    app.homeShown(now, nativePrefsJson(), selectedZoneId || "");
  };
  new MutationObserver(tell).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  tell();
})();
