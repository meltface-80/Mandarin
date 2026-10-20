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
/*  a wall is opened with them (device-power.js, nativePrefsJson), and  */
/*  the Library's view; the room is said again whenever it changes.    */
/* ------------------------------------------------------------------ */
(function nativeHome() {
  const app = window.MusicdApp;
  if (!app || typeof app.nativeHome !== "function" || typeof app.homeShown !== "function") return;
  const home = document.getElementById("home-view"), sections = document.getElementById("home-sections"), search = document.getElementById("topbar-search");
  if (!home) return;
  const shown = el => !!el && !el.classList.contains("hidden") && el.getClientRects().length > 0;
  // The page's own dialogs too (the "move the music?" a room change asks, a name asked for): over Home they need the page in front (item 63).
  const OVER = ["menu-overlay", "settings-overlay", "qobuz-overlay", "tidal-overlay", "pitchfork-overlay", "filter-overlay", "offline-overlay", "album-modal",
    "confirm-overlay", "prompt-overlay"];
  // Offline the page's Home is the one in front: its rows come from the phone (the app's OfflineApi), which the native Home doesn't ask yet.
  const front = () => !window.__musicdOffline && !home.classList.contains("hidden") && !(sections && sections.classList.contains("hidden")) &&
    !(search && search.classList.contains("is-open")) && !OVER.some(id => shown(document.getElementById(id)));
  // With the UI Settings goes the Library's view (the sort, the focus), for the native Home's Library row and heading.
  const prefs = () => { const o = JSON.parse(nativePrefsJson()); o.view = libViewQuery(); return JSON.stringify(o); };
  // Offline, said once at the start (null: nothing said yet), so a Home the app had in front before the reload goes.
  let was = window.__musicdOffline ? null : false, wasZone = "";
  // Said only as it changes (the page's classes change all the time): Home in front or not, or the room (item 63: the room
  // was said only with a change of front, so Home started with none and kept a room since changed); only while the app's Home is on.
  const tell = () => {
    const now = front(), zone = selectedZoneId || "";
    if (now === was && zone === wasZone) return;
    was = now; wasZone = zone;
    if (!app.nativeHome()) return;
    app.homeShown(now, prefs(), zone);
  };
  new MutationObserver(tell).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  // The room changes without a class changing: chosen (the select's change), or read in when the rooms load.
  if (zoneSel) zoneSel.addEventListener("change", () => setTimeout(tell, 0));
  setInterval(() => { if (document.visibilityState === "visible") tell(); }, 1000);
  tell();
})();
