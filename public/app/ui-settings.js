/* ------------------------------------------------------------------ */
/*  UI Settings (v0.6.5, as Rouen v1.8.77 has them): text size, grid   */
/*  layout and tile size — per device, in localStorage, painted as     */
/*  custom properties on <html> so every screen reads the same numbers */
/*  without being told. Nothing here rebuilds a tile.                  */
/*    --ui-text   album and artist text, a multiplier on each size     */
/*    --ui-title  a grid screen's title in the top bar, a playlist name*/
/*    --ui-tile   the Home carousels' tile width (150px × this)        */
/*    --grid-cols every .album-grid's columns, when not the screen's   */
/* ------------------------------------------------------------------ */
(function uiSettings() {
  const OPTS = {
    // +75% and +100% are a desktop's (v0.6.6): elsewhere they read as +50%.
    text:   { key: "rra-ui-text",  def: "1",    allowed: ["1", "1.1", "1.25", "1.5", "1.75", "2"] },
    title:  { key: "rra-ui-title", def: "1",    allowed: ["1", "1.1", "1.25", "1.5", "1.75", "2"] },
    // Every other piece of text: the side menu, Home's headings, Settings, the
    // album and Now playing views, the player bar (v0.6.6).
    menu:   { key: "rra-ui-menu",  def: "1",    allowed: ["1", "1.1", "1.25", "1.5", "1.75", "2"] },
    layout: { key: "rra-ui-cols",  def: "auto", allowed: ["auto", "3", "2", "list"] },
    tile:   { key: "rra-ui-tile",  def: "1",    allowed: ["0.5", "0.75", "0.9", "1", "1.1", "1.25", "1.5"] }
  };
  const mem = {};
  // A desktop: a large screen with a mouse (the test Now playing's corner
  // button uses). Only there do the text sizes go past +50%.
  const desktopQ = window.matchMedia ? window.matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)") : null;
  const isDesktop = () => !!(desktopQ && desktopQ.matches);
  const BIG = ["1.75", "2"];
  const TEXT = ["text", "title", "menu"];
  // Text sizes only: "2" is also the Grid layout's 2 columns.
  function get(k) {
    const v = stored(k);
    return (TEXT.indexOf(k) > -1 && BIG.indexOf(v) > -1 && !isDesktop()) ? "1.5" : v;
  }
  function stored(k) {
    if (k in mem) return mem[k];
    const o = OPTS[k];
    let v = null;
    try {
      v = localStorage.getItem(o.key);
      // List was the top bar's grid ⇄ list button until v0.6.5.
      if (v === null && k === "layout" && localStorage.getItem("rra-album-view") === "list") v = "list";
    } catch (e) { /* localStorage optional — the default stands */ }
    return (mem[k] = o.allowed.indexOf(v) > -1 ? v : o.def);
  }
  // The screen's own column count, by the SAME breakpoints style.css uses for
  // .album-grid (keep the two in step).
  function baseCols() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w >= 1200) return 9;
    if (w >= 768) return h >= w ? 5 : 7;
    return 3;
  }
  // "3" or "2" fixes the count; Auto (and List, for the count a wall asks for)
  // is the screen's own count divided by the tile size: bigger tiles, fewer columns.
  function cols() {
    const l = get("layout");
    if (l === "3" || l === "2") return Number(l);
    return Math.max(1, Math.round(baseCols() / parseFloat(get("tile"))));
  }
  function apply() {
    const root = document.documentElement.style;
    const put = (prop, v, def) => { if (v === def) root.removeProperty(prop); else root.setProperty(prop, v); };
    put("--ui-text", get("text"), "1");
    put("--ui-title", get("title"), "1");
    put("--ui-menu", get("menu"), "1");
    put("--ui-tile", get("tile"), "1");
    const c = cols();
    if (c === baseCols()) root.removeProperty("--grid-cols"); else root.setProperty("--grid-cols", String(c));
    const grid = document.getElementById("album-grid");
    if (grid) grid.classList.toggle("as-list", get("layout") === "list");
  }
  function set(k, v) {
    const o = OPTS[k];
    if (!o || o.allowed.indexOf(v) < 0) return;
    try { localStorage.setItem(o.key, v); } catch (e) { /* localStorage optional — applied for this session regardless */ }
    mem[k] = v;
    apply();
    // The columns moved at once (CSS); the random wall's COUNT was a screenful
    // at the old columns, so it asks again when that is now a different number.
    if ((k === "layout" || k === "tile") && window.__refreshWallCount) window.__refreshWallCount();
  }
  window.addEventListener("resize", apply);
  if (desktopQ && desktopQ.addEventListener) desktopQ.addEventListener("change", apply);
  window.__uiPrefs = { get, set, cols, apply, OPTS, isDesktop };
  apply();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply);
})();
