// @ts-check
/* The page's core: an album tile's tap and long press, for every tile at once (audit W-M7). */
// Each tile carried eleven listeners of its own: its tap, nine for the long
// press (addLongPress, album-tiles.js) and its cover's. A wall of a thousand
// albums was eleven thousand closures. Now the tile carries only what it is
// (buildAlbumTile: __album, __open, __selectable) and these few listeners on
// the document act for all of them, on every screen with album tiles: the
// walls, a label's albums, an artist's page, search, Home's rows.
//
// Behaviour is addLongPress's and the tile's old click handler's, unchanged:
//   - a tap opens the album (the album page remembers the tiles beside it);
//   - held 500 ms without moving, a selectable tile starts selecting with
//     itself the first pick, and the click its release makes is eaten, so it
//     stays picked (`longPressAte`, page-state.js; shared with the other long
//     presses, as before);
//   - in selection, a tap on a selectable tile picks or unpicks it;
//   - a selectable tile has no context menu.
// Captured at the document, so each runs ahead of the document's own click
// listeners (the popovers' "a click elsewhere closes me"), as the tile's did.

/**
 * What the listeners need of the page, whose names a checked part can't see (album-tiles.js gives it).
 * @typedef {object} AlbumTilePage
 * @property {() => boolean} selecting whether albums are being selected (albumSelectMode)
 * @property {() => void} startSelecting enterAlbumSelectMode
 * @property {(tile: any) => void} pick a tile picked or unpicked (handleAlbumTileSelect)
 * @property {(tile: any) => void} beside the tiles beside the one tapped, for the album page's previous and next (albumNav.from)
 * @property {() => boolean} eaten whether a long press has just fired, so the click its release makes is eaten (longPressAte)
 * @property {(on: boolean) => void} eat sets that
 */

/**
 * Puts the listeners on the document for every album tile, once, as the page starts (album-tiles.js).
 * @param {AlbumTilePage} page
 */
function watchAlbumTiles(page) {
  /** The long press's hold, in ms (addLongPress's). */
  const HOLD_MS = 500;
  /**
   * A tile's long press under way: its timer, and whether it moved. Per tile, as each tile's own closure had it.
   * @type {WeakMap<HTMLElement, { timer: any, moved: boolean }>}
   */
  const presses = new WeakMap();

  /**
   * The album tile [e] landed in (one buildAlbumTile drew: it carries __open), or null.
   * @param {Event} e @returns {any}
   */
  function tileOf(e) {
    const t = /** @type {any} */ (e.target);
    const tile = t && typeof t.closest === "function" ? t.closest(".album") : null;
    return tile && typeof tile.__open === "function" ? tile : null;
  }

  /** The selectable tile [e] landed in, or null: only those have a long press. @param {Event} e @returns {any} */
  function selectableTileOf(e) {
    const tile = tileOf(e);
    return tile && tile.__selectable ? tile : null;
  }

  /** A finger or a button down on a tile: the hold begins. @param {Event} e */
  function onStart(e) {
    const tile = selectableTileOf(e);
    if (!tile) return;
    let press = presses.get(tile);
    if (!press) { press = { timer: null, moved: false }; presses.set(tile, press); }
    const p = press;
    p.moved = false;
    p.timer = setTimeout(() => {
      if (p.moved) return;
      if (navigator.vibrate) navigator.vibrate(25);
      page.eat(true);
      if (page.selecting()) return;
      page.startSelecting();
      page.pick(tile);
    }, HOLD_MS);
  }
  /** Moved over the tile: no long press. @param {Event} e */
  function onMove(e) {
    const tile = selectableTileOf(e);
    const p = tile && presses.get(tile);
    if (!p) return;
    p.moved = true; clearTimeout(p.timer); p.timer = null;
  }
  /** Let go on the tile (or the touch cancelled): no long press. @param {Event} e */
  function onEnd(e) {
    const tile = selectableTileOf(e);
    const p = tile && presses.get(tile);
    if (!p) return;
    clearTimeout(p.timer); p.timer = null;
  }

  /** A tap: eaten after a long press; a pick in selection; else the album opened. @param {Event} e */
  function onClick(e) {
    const tile = tileOf(e);
    if (!tile) return;
    if (tile.__selectable && page.eaten()) {
      page.eat(false);
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (tile.__selectable && page.selecting()) { page.pick(tile); return; }
    page.beside(tile);
    tile.__open();
  }

  const opts = { capture: true };
  const passive = { capture: true, passive: true };
  document.addEventListener("touchstart",  onStart, passive);
  document.addEventListener("touchmove",   onMove,  passive);
  document.addEventListener("touchend",    onEnd,   opts);
  document.addEventListener("touchcancel", onEnd,   opts);
  document.addEventListener("mousedown",   onStart, opts);
  document.addEventListener("mousemove",   onMove,  opts);
  document.addEventListener("mouseup",     onEnd,   opts);
  document.addEventListener("contextmenu", (e) => { if (selectableTileOf(e)) e.preventDefault(); }, opts);
  document.addEventListener("click",       onClick, opts);
}
