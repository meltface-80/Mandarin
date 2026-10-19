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
/*  Search or Offline sign. An album's own (its Share card, Add to     */
/*  playlist, Edit album) are asked by its offset; a label by its name. */
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
  if (what === "zone") {
    if (!zoneSel || !arg || ![...zoneSel.options].some(o => o.value === arg)) return false;
    if (zoneSel.value !== arg) { zoneSel.value = arg; zoneSel.dispatchEvent(new Event("change")); }
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
/*  page's own. When the sheet has gone the class comes off and the    */
/*  app is told (MusicdApp.overlayClosed), so the screen is in front   */
/*  again. A sheet that never opens (the album gone) is waited for a    */
/*  few seconds, then given up on the same way.                        */
/* ------------------------------------------------------------------ */
const OVER_SHEETS = "#share-overlay:not(.hidden), .lib-sheet-backdrop, #album-edit-overlay:not(.hidden), #prompt-overlay:not(.hidden), #confirm-overlay:not(.hidden)";
window.__musicdNativeOver = function (what, arg) {
  const html = document.documentElement;
  const app = window.MusicdApp;
  const done = () => { html.classList.remove("native-over"); if (app && typeof app.overlayClosed === "function") app.overlayClosed(); };
  html.classList.add("native-over");
  if (!window.__musicdNative(what, arg)) { done(); return false; }
  const up = () => [...document.querySelectorAll(OVER_SHEETS)].some(e => e.getClientRects().length > 0);
  const t0 = Date.now();
  let seen = false;
  const watch = () => {
    if (up()) seen = true;
    else if (seen || Date.now() - t0 > 6000) { done(); return; }
    setTimeout(watch, 150);
  };
  setTimeout(watch, 150);
  return true;
};
