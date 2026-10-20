/* ------------------------------------------------------------------ */
/*  Android app only: your playlists drawn by the app itself (bug list */
/*  item 65; docs/specs/native-parity.md). The Playlists screen and a   */
/*  playlist of yours, wherever the page would open its own (the side  */
/*  menu, Home's row and heading, a playlist's Back), are the app's     */
/*  (MusicdApp.openPlaylists, openPlaylist), with the UI Settings and   */
/*  the room. Offline the page's own stay: the app's ask the server.   */
/* ------------------------------------------------------------------ */
(function nativePlaylists() {
  const app = window.MusicdApp;
  if (!app || typeof app.openPlaylists !== "function" || typeof app.openPlaylist !== "function") return;
  const live = () => !window.__musicdOffline;
  const pageList = window.showPlaylists, pageOne = window.openUserPlaylist;
  const list = function () {
    if (!live()) return pageList.apply(this, arguments);
    app.openPlaylists(nativePrefsJson(), selectedZoneId || "");
    return Promise.resolve();
  };
  // The page's own calls (by name) and the menu's (window.__showPlaylists) both reach the app's.
  window.showPlaylists = list;
  window.__showPlaylists = list;
  window.openUserPlaylist = function (p) {
    if (!live() || !p || p.id == null) return pageOne.apply(this, arguments);
    app.openPlaylist(String(p.id), nativePrefsJson(), selectedZoneId || "");
    return Promise.resolve();
  };
})();
