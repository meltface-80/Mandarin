/* ------------------------------------------------------------------ */
/*  Android app only: what its native screens hand back to the page    */
/*  (docs/specs/native-parity.md). A native screen that has an item     */
/*  the page does with its own sheet or its own room asks for it here,  */
/*  by name, rather than reaching into the page: Group zones and Device */
/*  power open the page's own sheets; Share card, the album and an      */
/*  artist open as the page's Now playing opens them, for the track     */
/*  playing; a room chosen on Play on becomes the page's room too, so   */
/*  its mini player follows; the native mini player opens the page's    */
/*  Now playing when this phone's native one is off. An album's own (its Share card, Add to     */
/*  playlist, Edit album) are asked by its offset; a label by its name. */
/*  True when done.                                                     */
/* ------------------------------------------------------------------ */
window.__musicdNative = function (what, arg) {
  if (what === "group") { openGroupSheet(); return true; }
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
  if (what === "zone") {
    if (!zoneSel || !arg || ![...zoneSel.options].some(o => o.value === arg)) return false;
    if (zoneSel.value !== arg) { zoneSel.value = arg; zoneSel.dispatchEvent(new Event("change")); }
    return true;
  }
  return false;
};
