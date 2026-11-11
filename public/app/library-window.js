// @ts-check
/* The page's core: the Library wall drawn a window at a time (audit W-M7, stage 3). */
// The Library wall added 60 tiles a page as it was scrolled and never took one
// away, so at Z a library of 15,000 albums was 15,000 tiles in the page. The
// albums are data now (libWall.items, as the pages bring them), and only the
// whole rows near the view are tiles: those on screen and two screens above
// and below. A spacer before them and one after stand in for the rows not
// drawn, the height those rows were when last drawn (or, never drawn, the
// average of the rows that were), so the scrollbar is the whole wall's and
// paging (device-power.js) still asks for the next 60 near the end.
//
//   - The columns are the grid's own (its computed grid-template-columns: the
//     screen's 3/5/7/9, or UI Settings' --grid-cols); list mode is one a row.
//   - A tile drawn again is drawn as it was: picked if the selection has it.
//   - Rows on screen are never redrawn as the window moves, and the first one
//     seen stays where it was (any error in an estimate is taken up out of view).
//   - The row holding the keyboard's focus is never dropped.
//   - The services' results (libWall.ext) stay last, after the lower spacer.
//   - A change of columns, of list mode, of the screen's width or of UI
//     Settings' sizes draws the wall afresh around the first album seen, which
//     stays in view; so does coming back from an artist's page.
// The other walls are a fixed few dozen albums and are drawn whole, as before.

/**
 * What the window needs of the page, whose names a checked part can't see (library-wall.js gives it).
 * @typedef {object} LibWindowPage
 * @property {HTMLElement} grid the shared album grid (#album-grid)
 * @property {HTMLElement} scroller what scrolls it (<main>)
 * @property {() => any[]} items the wall's albums as far as they are loaded, in order (libWall.items)
 * @property {() => boolean} live whether the Library wall owns the grid now
 * @property {(a: any) => HTMLElement} tile an album's tile, as the wall draws it
 * @property {(a: any) => boolean} picked whether the selection holds the album
 * @property {(a: any) => () => void} opener how an album opens from the wall (its tile's own way)
 * @property {() => (Node|null)} ext the services' results under the wall, if any
 */

/**
 * The window, as the wall uses it.
 * @typedef {object} LibWindow
 * @property {() => void} reset a fresh wall: nothing drawn, nothing measured (the grid has just been emptied)
 * @property {() => void} draw draws, now, what is near the view (the albums grew, or the view moved)
 * @property {() => void} later the same at the next frame
 * @property {(offset: any) => void} drop an album gone from the library: out of the albums and, if drawn, off the wall
 * @property {(tile: any) => ({ items: { album: any, open: () => void }[], index: number } | null | undefined)} beside
 *   for one of the wall's tiles, the wall's albums to step through from it on the album page (undefined: not the wall's)
 */

/**
 * Makes the Library wall's window, once, as the page starts (library-wall.js).
 * @param {LibWindowPage} page @returns {LibWindow}
 */
function libraryWindow(page) {
  const { grid, scroller } = page;
  /** Screens drawn above and below the view; it is drawn again once less than half of that is left. */
  const SCREENS = 2;
  /** Never drawn: a row this short or shorter is taken for this height. */
  const MIN_ROW = 20;
  const st = {
    on: false,
    /** The index (in the albums) of the first tile drawn; always the start of a row. */
    from: 0,
    /** @type {HTMLElement[]} the tiles drawn, in order, for the albums from `from` on */
    tiles: [],
    /** What the rows were measured under (columns, list, width, UI Settings); a change draws afresh. */
    key: "",
    /** @type {Map<number, number>} a row's height and the gap under it, by row, as last drawn */
    pitch: new Map(),
    sum: 0,
    /** @type {{ index: number, top: number } | null} the first album seen, and where it was, at the last draw */
    anchor: null,
  };
  let frame = 0;
  const spacer = () => {
    const el = document.createElement("div");
    el.className = "lib-spacer";
    el.setAttribute("aria-hidden", "true");
    el.style.gridColumn = "1 / -1";
    return el;
  };
  const above = spacer(), below = spacer();

  /** The grid as laid out now: its columns, the gap between its rows, and what its rows' heights depend on. */
  function layout() {
    const cs = getComputedStyle(grid);
    const list = cs.display !== "grid";
    const cols = list ? 1 : Math.max(1, cs.gridTemplateColumns.split(" ").filter(Boolean).length);
    const gap = list ? 0 : (parseFloat(cs.rowGap) || 0);
    const root = getComputedStyle(document.documentElement);
    const sizes = ["--grid-cols", "--ui-tile", "--ui-text", "--ui-title"].map(p => root.getPropertyValue(p).trim());
    const key = [String(cols), String(list), String(grid.clientWidth)].concat(sizes).join("|");
    return { cols, gap, list, key };
  }
  /** @typedef {ReturnType<typeof layout>} Layout */

  /** The average row (its height and the gap under it) of those measured, or a guess from the columns. @param {Layout} L */
  function average(L) {
    if (st.pitch.size) return Math.max(MIN_ROW, st.sum / st.pitch.size);
    return Math.max(MIN_ROW, L.list ? 64 : grid.clientWidth / L.cols + 44 + L.gap);
  }
  /** A row's height and gap: as measured, else the average. @param {number} r @param {number} avg */
  const pitchOf = (r, avg) => { const p = st.pitch.get(r); return p === undefined ? avg : p; };
  /** @param {number} r @param {number} p */
  function setPitch(r, p) {
    const old = st.pitch.get(r);
    if (old !== undefined) st.sum -= old;
    st.pitch.set(r, p); st.sum += p;
  }

  /** The services' results, when they are in the grid (they stay last). */
  function tail() {
    const ext = page.ext();
    return ext && ext.parentNode === grid ? ext : null;
  }
  /** The top of the view below the bar (the scroller's own padding), on screen. */
  function viewTop() {
    return scroller.getBoundingClientRect().top + (parseFloat(getComputedStyle(scroller).paddingTop) || 0);
  }
  /** Whether the grid is laid out to be measured. */
  const measurable = () => grid.getClientRects().length > 0 && scroller.clientHeight > 0;
  /** Whether what is drawn is still in the grid (another screen may have emptied it). */
  const ours = () => !st.tiles.length || st.tiles[0].parentNode === grid;

  /**
   * An album's tile, picked if the selection holds it. Laid out whatever its
   * place: a touch screen's `content-visibility: auto` (style.css) gives a
   * tile off screen a stand-in size, a third of the screen wide whatever the
   * columns, and forgets its real one when it leaves the page (an artist's
   * page and back), which would be measured as the row's height. The window
   * keeps the tiles to a few screens, which is what that rule was for.
   * @param {any} a
   */
  function make(a) {
    const t = page.tile(a);
    t.style.contentVisibility = "visible";
    if (page.picked(a)) t.classList.add("is-selected");
    return t;
  }

  /** The first album seen (the first tile whose bottom is below the bar) and its top on screen, or null. */
  function seen() {
    const top = viewTop();
    for (let k = 0; k < st.tiles.length; k++) {
      const r = st.tiles[k].getBoundingClientRect();
      if (r.bottom > top) return { index: st.from + k, top: r.top };
    }
    return null;
  }

  /**
   * Draws the albums [from, to) and takes away the rest, leaving every tile
   * that stays where it is in the page (so the focus, and a cover loaded, stay).
   * @param {number} from @param {number} to
   */
  function render(from, to) {
    const items = page.items();
    const oldFrom = st.from, oldTo = st.from + st.tiles.length;
    const keepFrom = Math.max(from, oldFrom), keepTo = Math.min(to, oldTo);
    const overlap = keepFrom < keepTo;
    /** @type {HTMLElement[]} */
    const kept = [];
    st.tiles.forEach((t, k) => {
      const i = oldFrom + k;
      if (overlap && i >= keepFrom && i < keepTo) kept.push(t); else t.remove();
    });
    const before = [], after = [];
    if (overlap) for (let i = from; i < keepFrom; i++) before.push(make(items[i]));
    for (let i = overlap ? keepTo : from; i < to; i++) after.push(make(items[i]));
    const place = (/** @type {HTMLElement[]} */ list, /** @type {Node|null} */ ref) => {
      if (!list.length) return;
      const f = document.createDocumentFragment();
      for (const t of list) f.appendChild(t);
      grid.insertBefore(f, ref);
    };
    place(before, kept[0] || null);
    place(after, below.parentNode === grid ? below : tail());
    st.from = from;
    st.tiles = before.concat(kept, after);
  }

  /** Measures the rows drawn, and sizes the spacers for those not drawn. @param {Layout} L */
  function measure(L) {
    const rows = [];
    for (let k = 0; k < st.tiles.length; k += L.cols) rows.push(st.tiles[k].getBoundingClientRect());
    const first = Math.floor(st.from / L.cols);
    rows.forEach((r, j) => {
      const p = j + 1 < rows.length ? rows[j + 1].top - r.top : r.height + L.gap;
      if (p > 0) setPitch(first + j, p);
    });
    spacers(L);
  }
  /** @param {Layout} L */
  function spacers(L) {
    const n = page.items().length, avg = average(L);
    const rows = Math.ceil(n / L.cols);
    const first = Math.floor(st.from / L.cols), last = Math.ceil((st.from + st.tiles.length) / L.cols);
    let up = 0, down = 0;
    for (let r = 0; r < first; r++) up += pitchOf(r, avg);
    for (let r = last; r < rows; r++) down += pitchOf(r, avg);
    size(above, up - L.gap, true);
    size(below, down - L.gap, false);
  }
  /** A spacer at its height, or out of the grid when there is nothing for it to stand for. @param {HTMLElement} el @param {number} h @param {boolean} first */
  function size(el, h, first) {
    if (h <= 0.5) { el.remove(); return; }
    el.style.height = h.toFixed(1) + "px";
    if (el.parentNode !== grid) grid.insertBefore(el, first ? grid.firstChild : tail());
  }

  /** The row of the tile holding the keyboard's focus, or -1. @param {Layout} L */
  function focusRow(L) {
    const el = document.activeElement;
    if (!el || el === document.body) return -1;
    const k = st.tiles.findIndex(t => t === el || t.contains(el));
    if (k < 0) return -1;
    let keyboard = true;
    try { keyboard = el.matches(":focus-visible"); } catch (e) { /* an engine without :focus-visible: kept */ }
    return keyboard ? Math.floor((st.from + k) / L.cols) : -1;
  }

  /**
   * The rows [first, last) that cover the band [a, b] (from the grid's top), at the heights known.
   * @param {number} a @param {number} b @param {number} rows @param {number} avg @returns {[number, number]}
   */
  function rowsFor(a, b, rows, avg) {
    let y = 0, r = 0;
    while (r < rows && y + pitchOf(r, avg) <= a) { y += pitchOf(r, avg); r++; }
    const first = r;
    while (r < rows && y < b) { y += pitchOf(r, avg); r++; }
    return [first, Math.max(r, Math.min(rows, first + 1))];
  }

  /**
   * Keeps the album [a] (seen before a change) where it was on screen; with [seenStill], below the bar
   * if at its new size it would be hidden under it (a tile shorter in more columns).
   * @param {{ index: number, top: number } | null} a @param {boolean} [seenStill]
   */
  function hold(a, seenStill) {
    if (!a) return;
    const t = st.tiles[a.index - st.from];
    if (!t) return;
    const r = t.getBoundingClientRect(), top = viewTop();
    let want = a.top;
    if (seenStill && want + r.height <= top) want = top;
    const d = r.top - want;
    if (Math.abs(d) > 0.5) scroller.scrollTop += d;
  }

  /** The columns, the list or the width changed: drawn afresh around the first album seen. @param {Layout} L */
  function relayout(L) {
    const n = page.items().length;
    const a = st.anchor;
    st.key = L.key; st.pitch.clear(); st.sum = 0;
    if (!n) { render(0, 0); spacers(L); return; }
    const index = a ? Math.min(a.index, n - 1) : Math.min(st.from, n - 1);
    const rows = Math.ceil(n / L.cols), row = Math.floor(index / L.cols);
    const perScreen = Math.ceil(scroller.clientHeight / average(L)) + 1;
    let first = Math.max(0, row - SCREENS * perScreen), last = Math.min(rows, row + (SCREENS + 1) * perScreen);
    const fr = focusRow(L);
    if (fr >= 0) { first = Math.min(first, fr); last = Math.max(last, fr + 1); }
    render(first * L.cols, Math.min(last * L.cols, n));
    measure(L);
    hold(a ? { index, top: a.top } : null, true);
  }

  function draw() {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    if (!st.on || !page.live() || !ours()) return;
    const items = page.items(), n = items.length;
    if (!measurable()) {
      // Not laid out (hidden): the first albums drawn, measured when it shows.
      if (!st.tiles.length && n) { render(0, Math.min(n, 120)); st.key = ""; }
      return;
    }
    let L = layout();
    if (L.key !== st.key) { relayout(L); L = layout(); st.key = L.key; }
    const rows = Math.ceil(n / L.cols), avg = average(L);
    const vh = scroller.clientHeight;
    const gridTop = grid.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const vTop = scroller.scrollTop - gridTop, vBot = vTop + vh;
    const curFirst = Math.floor(st.from / L.cols), curLast = Math.ceil((st.from + st.tiles.length) / L.cols);
    const [needFirst, needLast] = rowsFor(vTop - (SCREENS / 2) * vh, vBot + (SCREENS / 2) * vh, rows, avg);
    const whole = st.from === curFirst * L.cols && st.from + st.tiles.length === Math.min(curLast * L.cols, n);
    const fr = focusRow(L);
    if (!st.tiles.length || !whole || needFirst < curFirst || needLast > curLast || (fr < 0 && curLast - curFirst > 4 * (needLast - needFirst) + 8)) {
      let [first, last] = rowsFor(vTop - SCREENS * vh, vBot + SCREENS * vh, rows, avg);
      if (fr >= 0) { first = Math.min(first, fr); last = Math.max(last, fr + 1); }
      const a = seen();
      render(first * L.cols, Math.min(last * L.cols, n));
      measure(L);
      hold(a);
    } else {
      measure(L);
    }
    const s = seen();
    st.anchor = s || st.anchor;
  }
  function later() { if (!frame) frame = requestAnimationFrame(draw); }

  scroller.addEventListener("scroll", later, { passive: true });
  window.addEventListener("resize", later);
  // UI Settings' columns and sizes (on <html>), and list mode or the grid shown (its class).
  const watch = new MutationObserver(later);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
  watch.observe(grid, { attributes: true, attributeFilter: ["class"] });

  return {
    reset() {
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      for (const t of st.tiles) t.remove();
      above.remove(); below.remove();
      Object.assign(st, { on: true, from: 0, tiles: [], key: "", anchor: null, sum: 0 });
      st.pitch.clear();
    },
    draw,
    later,
    drop(offset) {
      const items = page.items();
      const i = items.findIndex(a => a && a.offset != null && String(a.offset) === String(offset));
      if (i < 0) return;
      items.splice(i, 1);
      const k = i - st.from;
      if (k >= 0 && k < st.tiles.length) { st.tiles[k].remove(); st.tiles.splice(k, 1); }
      else if (k < 0 && st.tiles.length) st.from--;   // an album above the drawn ones: theirs move up one
      if (st.from < 0) st.from = 0;
      later();
    },
    beside(tile) {
      if (!st.on || !tile || tile.parentNode !== grid) return undefined;
      const k = st.tiles.indexOf(tile);
      if (k < 0) return undefined;
      const at = st.from + k, items = page.items();
      /** @type {{ album: any, open: () => void }[]} */
      const list = [];
      let index = -1;
      items.forEach((a, i) => {
        if (!a || a.offset == null) return;
        if (i === at) index = list.length;
        list.push({ album: a, open: page.opener(a) });
      });
      return list.length > 1 && index >= 0 ? { items: list, index } : null;
    },
  };
}
