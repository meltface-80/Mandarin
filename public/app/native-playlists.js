/* ------------------------------------------------------------------ */
/*  Android app only: your playlists and the Dynamic Playlists drawn by */
/*  the app itself (bug list items 65 and 66; native-parity.md). Each   */
/*  list and each playlist, wherever the page would open its own (the   */
/*  side menu, Home's row and heading, a playlist's Back, a Dynamic     */
/*  Playlist saved from its Focus), is the app's (MusicdApp.            */
/*  openPlaylists, openPlaylist, openSmartPlaylists, openSmartPlaylist), */
/*  with the UI Settings and the room. Offline the page's own stay.    */
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
  // The Dynamic Playlists (item 66) likewise: the list, and one of them (after Save from its Focus too).
  if (typeof app.openSmartPlaylists === "function" && typeof app.openSmartPlaylist === "function") {
    const pageSmart = window.showSmartPlaylists, pageSmartOne = window.openSmartPlaylist;
    const smart = function () {
      if (!live()) return pageSmart.apply(this, arguments);
      app.openSmartPlaylists(nativePrefsJson(), selectedZoneId || "");
      return Promise.resolve();
    };
    window.showSmartPlaylists = smart;
    window.__showSmartPlaylists = smart;
    const smartOne = function (sp) {
      if (!live() || !sp || sp.id == null) return pageSmartOne.apply(this, arguments);
      app.openSmartPlaylist(String(sp.id), nativePrefsJson(), selectedZoneId || "");
      return Promise.resolve();
    };
    window.openSmartPlaylist = smartOne;
    window.__openSmartPlaylist = smartOne;
  }
  window.openUserPlaylist = function (p) {
    if (!live() || !p || p.id == null) return pageOne.apply(this, arguments);
    app.openPlaylist(String(p.id), nativePrefsJson(), selectedZoneId || "");
    return Promise.resolve();
  };
})();
