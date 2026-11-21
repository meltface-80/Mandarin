/* The streaming-service browsers, one for each service: Qobuz's, Tidal's and Spotify's (app/service-browser.js). */
initServiceBrowser({
  service:     "qobuz",
  serviceName: "Qobuz",
  idPrefix:    "qobuz",
  apiBase:     "/api/qobuz",
  historyKey:  "qz", // pre-factory key — kept so existing Qobuz history entries behave identically
  closeAttr:   "data-qobuz-close",
  notConnectedMsg: "Connect your Qobuz account in Settings to browse Qobuz.",
  tabs: [
    { id: "new-releases",  label: "New Releases",  kind: "new-releases" },
    { id: "best-sellers",  label: "Best Sellers",  kind: "featured" },
    { id: "most-streamed", label: "Most Streamed", kind: "featured" },
    { id: "press-awards",  label: "Press Awards",  kind: "featured" },
    { id: "editor-picks",  label: "Editor's Picks", kind: "featured" }
  ]
});

initServiceBrowser({
  service:     "tidal",
  serviceName: "Tidal",
  idPrefix:    "tidal",
  apiBase:     "/api/tidal",
  historyKey:  "td",
  closeAttr:   "data-tidal-close",
  notConnectedMsg: "Sign in to Tidal in Settings → Services to browse Tidal.",
  dynamicTabs: true,   // the lists Tidal features, from /api/tidal/lists, after New Releases
  tabs: [
    { id: "new-releases", label: "New Releases", kind: "new-releases" }
  ]
});

initServiceBrowser({
  service:     "spotify",
  serviceName: "Spotify",
  idPrefix:    "spotify",
  apiBase:     "/api/spotify",
  historyKey:  "sp",
  closeAttr:   "data-spotify-close",
  notConnectedMsg: "Sign in to Spotify in Settings → Services to browse Spotify.",
  // Spotify has no New Releases for apps like this since February 2026: the albums and singles of the artists you
  // follow, from the last three months, made by the server (item 498).
  tabs: [
    { id: "new-releases", label: "New from artists you follow", kind: "new-releases", days: 90 },
    { id: "your-albums",  label: "Your albums", kind: "featured" }
  ]
});
