/* ------------------------------------------------------------------ */
/*  Android app only: what its native screens hand back to the page    */
/*  (docs/specs/native-parity.md). A native screen that has an item     */
/*  the page does with its own sheet or its own room asks for it here,  */
/*  by name, rather than reaching into the page: Group zones and Device */
/*  power open the page's own sheets; Share card, the album and an      */
/*  artist open as the page's Now playing opens them, for the track     */
/*  playing; a room chosen on Play on becomes the page's room too, so   */
/*  its mini player follows; the native mini player opens the page's    */
/*  Now playing when this phone's native one is off; the native row at   */
/*  the foot of the screen taps the page's own Menu, Home, Library,      */
/*  Search or Offline sign; the app's side menu, its items the page's.  */
/*  An album's own (its Share card, Add to playlist, Edit album) are    */
/*  asked by its offset; a label by its name.                           */
/*  True when done.                                                     */
/* ------------------------------------------------------------------ */
window.__musicdNative = function (what, arg) {
  if (what === "group") { openGroupSheet(); return true; }
  // The native row along the foot of the screen (Menu, Home, Library, Search, the Offline sign): the page's own button, tapped.
  if (what === "nav") {
    const b = arg && /^(menu|home|offline|library|search)$/.test(arg) ? document.getElementById("tnav-" + arg) : null;
    if (!b) return false;
    b.click();
    return true;
  }
  // The native mini player's tap on what is playing, this phone's native Now playing off: the page's own opens.
  if (what === "now-playing") {
    const info = document.querySelector("#mini-transport .mt-info");
    if (!info) return false;
    info.click();
    return true;
  }
  if (what === "power") { openDevicePowerSheet(); return true; }
  if (what === "share" || what === "album") {
    const np = window.__getCurrentNp && window.__getCurrentNp();
    if (!np) return false;
    if (what === "share") openShare({ title: np.line3 || "", artist: np.line2 || "", image_key: np.image_key });
    else npAlbum.click();
    return true;
  }
  // A page of Settings the app's own Settings doesn't draw (item 76): the page's, alone.
  if (what === "settings-pane") return !!(arg && window.__openSettingsPane && window.__openSettingsPane(arg));
  // The native share card's default service, held on its chip (item 75): kept where the page's chips keep it.
  if (what === "share-service") {
    try { localStorage.setItem("musicd-share-service", String(arg || "")); } catch (e) { /* storage blocked: the app keeps it this visit */ }
    return true;
  }
  if (what === "artist") {
    if (!arg || !window.__showArtistAlbums) return false;
    window.__showArtistAlbums(arg, {});
    return true;
  }
  if (what === "label") {
    if (!arg || !window.__showLabelAlbums) return false;
    window.__showLabelAlbums(arg, false, null);
    return true;
  }
  // A streamed album's favourite changed on its native page: the walls take it in, or, removed, drop it (as the page's own ⋯ does).
  if (what === "library-changed") {
    if (typeof window.__libraryChanged !== "function") return false;
    const gone = Number(arg);
    window.__libraryChanged(Number.isInteger(gone) && gone >= 0 ? { gone } : {});
    return true;
  }
  // Tracks picked on the native album page, for a playlist: the page's sheet, with the same entries its own selection makes.
  if (what === "album-playlist-tracks") {
    let ask = null;
    try { ask = JSON.parse(arg); } catch (e) { return false; }
    if (!ask || !Number.isInteger(ask.offset) || !Array.isArray(ask.tracks) || !ask.tracks.length) return false;
    fetch("/api/album?offset=" + ask.offset).then(r => r.json()).then(j => {
      const a = j && j.album, tracks = (j && j.tracks) || [];
      if (!a) return;
      const entries = ask.tracks.filter(i => tracks[i]).map(i => ({
        album_offset: a.offset, album_title: a.title || "", album_subtitle: a.subtitle || "",
        track_index: i, title: tracks[i].title || "", subtitle: a.subtitle || "", image_key: a.image_key || null
      }));
      if (entries.length) openAddToPlaylistSheet(entries, null);
    }).catch(() => { /* the album gone: nothing to open */ });
    return true;
  }
  if (what === "album-share" || what === "album-playlist" || what === "album-edit") {
    const offset = Number(arg);
    if (!Number.isInteger(offset) || offset < 0) return false;
    fetch("/api/album?offset=" + offset).then(r => r.json()).then(j => {
      const a = j && j.album;
      if (!a) return;
      if (what === "album-share") openShare({ title: a.title || "", artist: a.subtitle || "", image_key: a.image_key });
      else if (what === "album-playlist") openAddToPlaylistSheet(null, [{ offset: a.offset, title: a.title || "", subtitle: a.subtitle || "", image_key: a.image_key || null }]);
      else openAlbumEditor(a);
    }).catch(() => { /* the album gone: nothing to open */ });
    return true;
  }
  // The app's native Library wall (item 52): its view changed there (the same query string this page's wall asks
  // with), so this wall and Home's Library row follow; Save as… from its Focus, the page's own prompt over the view;
  // albums picked there, for a playlist: the page's sheet.
  if (what === "library-view") { applyLibViewQuery(arg || ""); return true; }
  if (what === "smart-save") { applyLibViewQuery(arg || ""); saveSmartPlaylistPrompt(null); return true; }
  if (what === "albums-playlist") {
    let albums;
    try { albums = JSON.parse(arg); } catch (e) { return false; }
    if (!Array.isArray(albums) || !albums.length) return false;
    openAddToPlaylistSheet(null, albums.map(a => ({ offset: a.offset, title: a.title || "", subtitle: a.subtitle || "", image_key: a.image_key || null })));
    return true;
  }
  // Home's rows natively (item 57): the Playlists heading opens the page's Playlists; a playlist's tile the page's own
  // page of it, by its id (yours, or a Dynamic one's).
  if (what === "playlists") { showPlaylists(); return true; }
  // An album of the phone's own music, by its key: the page's own album page of it (the server never sees these albums).
  if (what === "phone-album") {
    const a = localList().find(x => x.key === arg);
    if (!a) return false;
    openAlbum(a, { source: "home", filter: null });
    return true;
  }
  if (what === "playlist" || what === "smart-playlist") {
    if (!arg) return false;
    fetch(what === "playlist" ? "/api/user-playlists" : "/api/smart-playlists", { cache: "no-store" }).then(r => r.json()).then(j => {
      const p = ((j && j.playlists) || []).find(x => String(x.id) === String(arg));
      if (!p) return;
      if (what === "playlist") openUserPlaylist(p); else openSmartPlaylist(p);
    }).catch(() => { /* the playlist gone: nothing to open */ });
    return true;
  }
  // The native Playlists' (item 65): Import, the page's sheet for a pasted playlist; a playlist of yours shared, by its id.
  if (what === "playlist-import") { openImportSheet(); return true; }
  if (what === "playlist-share") {
    if (!arg) return false;
    fetch("/api/user-playlist?id=" + encodeURIComponent(arg), { cache: "no-store" }).then(r => r.json()).then(j => {
      if (!j || !Array.isArray(j.tracks)) return;
      shareTracks(j.name || "Playlist", j.tracks.map(t => ({ title: t.title, artist: t.subtitle, album: t.album_title, track_no: t.track_no })), null, {});
    }).catch(() => { /* the playlist gone: nothing to share */ });
    return true;
  }
  // The native Dynamic Playlists' (item 66): New (the page's sheet, then its Focus); Edit (its Focus with the playlist as the
  // save target); Share (every album read first, as the page's own Share does, then its sheet with the file).
  if (what === "smart-new") { createSmartPlaylist(); return true; }
  if (what === "smart-edit" || what === "smart-share") {
    if (!arg) return false;
    fetchSmartPlaylists().then(list => {
      const sp = (list || []).find(p => String(p.id) === String(arg));
      if (!sp) return;
      if (what === "smart-edit") { editSmartPlaylist(sp); return; }
      shareSmartTracks(sp);
    });
    return true;
  }
  // The native Search's (item 61): a service's artist, their albums in that service's browser; a Pitchfork review, its page in the magazine.
  if (what === "service-artist") {
    let ar;
    try { ar = JSON.parse(arg); } catch (e) { return false; }
    const sb = ar && window.__serviceBrowsers && window.__serviceBrowsers[ar.service];
    if (!sb || !ar.id) return false;
    sb.openArtist({ id: ar.id, name: ar.name || "" });
    return true;
  }
  // The app's own Pitchfork's Find on Qobuz (item 70): the page's Qobuz browser, its search seeded, as pitchfork.js's own button does.
  if (what === "qobuz-search") {
    const b = document.getElementById("qobuz-toggle");
    if (!b || !arg) return false;
    b.click();
    const input = document.getElementById("qobuz-search-input");
    if (input) { input.value = arg; input.dispatchEvent(new Event("input", { bubbles: true })); }
    return true;
  }
  if (what === "review") {
    let it;
    try { it = JSON.parse(arg); } catch (e) { return false; }
    if (!it || !it.url || typeof window.__openPitchforkReview !== "function") return false;
    window.__openPitchforkReview(it);
    return true;
  }
  // The app's own side menu (item 67): an item it leaves to the page, the page's own item in its menu, tapped (Pitchfork,
  // Labels, Qobuz, Tidal, Shelf, Settings, Restart, Shut down); "reopen", the page's menu open again on the page the
  // Offline switch loads (menu-drawer.js, its REOPEN_KEY), so only the switch is seen to move.
  if (what === "menu") {
    if (arg === "reopen") {
      try { localStorage.setItem("rra-menu-reopen", String(Date.now())); } catch (e) { /* storage refused: the menu stays shut */ }
      return true;
    }
    const b = /^(pitchfork|labels|qobuz|tidal|shelf|settings|power-restart|power-shutdown)$/.test(arg || "") ? document.querySelector('[data-parity="menu.' + arg + '"]') : null;
    if (!b) return false;
    b.click();
    return true;
  }
  // A room chosen on a native screen: the page's room too, without the page's question (the app asks whether to move
  // what's playing, item 68); a room the app grouped, a new one, kept and the list read again so it is there to choose.
  if (what === "zone") {
    if (!zoneSel || !arg || ![...zoneSel.options].some(o => o.value === arg)) return false;
    if (zoneSel.value !== arg) {
      zoneSel.value = arg;
      window.__zoneFromApp = true;
      try { zoneSel.dispatchEvent(new Event("change")); } finally { window.__zoneFromApp = false; }
    }
    return true;
  }
  // The page's notices drawn by the app (item 69, native-notices.js): a button of the server's notice, by its place
  // (Forget a folder: the page's question, then its work); the update offer's Update or Later.
  if (what === "notice-button") {
    const b = document.querySelectorAll("#server-notice .server-notice-btn")[Number(arg)];
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }
  if (what === "update") {
    const b = arg === "now" || arg === "later" ? document.getElementById("update-" + arg) : null;
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }
  if (what === "group-settled") {
    if (!arg) return false;
    try { localStorage.setItem("rra-zone", arg); } catch (e) { /* private mode: the list still picks a room */ }
    loadZones().then(() => { if (typeof window.__refreshTransport === "function") window.__refreshTransport(); });
    return true;
  }
  return false;
};

/* ------------------------------------------------------------------ */
/*  The same, for one of the page's sheets over a native screen (bug   */
/*  list item 54): the Share card, Add to playlist, the album editor,  */
/*  Group zones, Device power or a Dynamic Playlist's name, asked for  */
/*  from Now playing or an album's native page. The screen stays; the  */
/*  app puts this page over it with its ground clear, and `native-over`*/
/*  on <html> keeps everything but the sheet out of sight (style.css), */
/*  so the sheet opens over the native screen as it opens over the     */
/*  page's own. The sheet is watched (a sheet that fetches first opens  */
/*  a moment later); when it has gone the class comes off and the app  */
/*  is told (MusicdApp.overlayClosed), so the screen is in front again. */
/*  A sheet that never opens (the album gone) is waited for a few       */
/*  seconds, then given up on the same way. Each way is a handshake,    */
/*  so no frame of Home shows (bug list item 55): the page comes in     */
/*  front only once it has painted itself clear (MusicdApp.overlayShown,*/
/*  two frames on), and the class comes off only once the app says the */
/*  screen is in front again (the app takes it off itself).            */
/* ------------------------------------------------------------------ */
const OVER_SHEETS = "#settings-overlay:not(.hidden), #share-overlay:not(.hidden), .lib-sheet-backdrop, #album-edit-overlay:not(.hidden), #prompt-overlay:not(.hidden), #confirm-overlay:not(.hidden)";
window.__musicdNativeOver = function (what, arg) {
  const html = document.documentElement;
  const app = window.MusicdApp;
  let watcher = null, giveUp = null;
  const done = () => {
    if (watcher) watcher.disconnect();
    clearTimeout(giveUp);
    if (app && typeof app.overlayClosed === "function") app.overlayClosed();
    else html.classList.remove("native-over");
  };
  html.classList.add("native-over");
  if (!window.__musicdNative(what, arg)) { done(); return false; }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (html.classList.contains("native-over") && app && typeof app.overlayShown === "function") app.overlayShown();
  }));
  const up = () => [...document.querySelectorAll(OVER_SHEETS)].some(e => e.getClientRects().length > 0);
  // Every change to the page looked at: the sheet seen once it is up, done once it has gone again. Watched, not polled:
  // a sheet opened and closed between two polls was never seen, and the page stayed over the screen until the give-up.
  let seen = up();
  watcher = new MutationObserver(() => { if (up()) seen = true; else if (seen) done(); });
  watcher.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
  giveUp = setTimeout(() => { if (!seen) done(); }, 6000);
  return true;
};

/* A Dynamic Playlist's tracks read album by album (to SHARE_ALBUM_MAX), then the page's share sheet with them: what its own
   Share does from its page (smart-playlist.js), for the app's native one, whose page isn't this page's. */
async function shareSmartTracks(sp) {
  const loaded = [];
  let offset = 0, done = false, failed = false;
  while (!done && offset < SHARE_ALBUM_MAX) {
    let j;
    try { const r = await fetch("/api/smart-playlist?id=" + encodeURIComponent(sp.id) + "&offset=" + offset, { cache: "no-store" }); j = r.ok ? await r.json() : null; } catch (e) { j = null; }
    if (!j) { failed = true; break; }
    for (const t of (j.tracks || [])) loaded.push(t);
    if (!(j.albums_expanded > 0)) break;
    offset += j.albums_expanded;
    done = !!j.done;
  }
  if (!loaded.length) { showToast("Nothing in this playlist to share", "error"); return; }
  await shareTracks(sp.name || "Dynamic Playlist", loaded.map(t => ({ title: t.title, artist: t.subtitle, album: t.album_title, track_no: t.track_no })), null,
    { incomplete: failed, albumsCapped: !done && offset >= SHARE_ALBUM_MAX });
}
