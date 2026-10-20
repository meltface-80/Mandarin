/* The page's core (app.js until v1.0.5), 18 of 33: toasts, the banner, the scan bar, skeletons, long-press, badges and an album's tile. */
// ----- Toast / banner -----
let toastTimer = null;
// `ms` overrides the 2.4s default. Anything that lands at the END of a
// multi-minute operation needs longer: the user has usually looked away, and
// 2.4s of "queued 400 of 1179" is the same as never having said it.
function showToast(msg, kind, ms) {
  toast.textContent = msg;
  toast.classList.remove("hidden", "error");
  if (kind === "error") toast.classList.add("error");
  requestAnimationFrame(() => toast.classList.add("show"));
  clearTimeout(toastTimer);
  // 2.4s is right for "Queued 12 albums" and nowhere near enough for the
  // library-changed messages, which explain the cause, what happens next and
  // the manual way out — roughly 330 characters, gone before they could be
  // read. Scaled by length so short toasts are unchanged.
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.classList.add("hidden"), 250);
  }, ms || (String(msg).length > 120 ? 11000 : 2400));
}
// One sentence describing what actually reached the queue: how many albums,
// how many the cap left behind, and how many Roon refused. `pj` is
// /api/play-multi's body, `asked` the albums we sent, `total` the size of the
// whole playlist. Shared so Play now, Queue and Send to Roon cannot drift.
// How many albums the playlist's query MATCHED, as opposed to how many it
// delivers. Older responses carried only the delivered count; falling back to
// it makes the comparison a no-op rather than a wrong number.
function smartMatched(j) {
  return Number.isFinite(j.matched) ? j.matched : j.total;
}
function multiOutcome(verb, pj, asked, total) {
  const queued = Number.isFinite(pj.queued) ? pj.queued : asked;
  const failed = Number.isFinite(pj.failed) ? pj.failed : 0;
  const capped = Number.isFinite(total) && asked < total;
  let msg = `${verb} ${queued}`;
  if (capped) msg += ` of ${total}`;
  // Pluralise off whichever number the noun follows.
  msg += ` album${(capped ? total : queued) === 1 ? "" : "s"}`;
  if (failed > 0) msg += ` (Sonos refused ${failed})`;
  if (capped) msg += " — that's the limit per go";
  return msg;
}
function setBanner(msg, isError) {
  if (!msg) { banner.classList.add("hidden"); banner.textContent = ""; return; }
  banner.textContent = msg;
  banner.classList.toggle("error", !!isError);
  banner.classList.remove("hidden");
}

// ----- Scan progress bar -----
function updateScanBar(progress) {
  const bar  = document.getElementById("scan-progress-bar");
  const fill = document.getElementById("scan-progress-fill");
  if (!bar || !fill) return;
  if (progress === null || progress === undefined) {
    bar.classList.add("hidden");
    fill.style.width = "0%";
  } else {
    bar.classList.remove("hidden");
    fill.style.width = Math.round((progress || 0) * 100) + "%";
  }
}

// ----- Skeletons -----
function renderSkeletons(n) {
  grid.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const el = document.createElement("div");
    el.className = "album skeleton";
    el.innerHTML = `
        <div class="album-art-wrap"></div>
        <div class="album-meta">
          <div class="album-title">&nbsp;</div>
          <div class="album-artist">&nbsp;</div>
        </div>`;
    grid.appendChild(el);
  }
}

// ----- Long-press utility -----
//
// The callback fires at 500ms while the finger is STILL DOWN, so the browser
// goes on to dispatch a click on release. Without suppression that click ran
// the element's normal handler straight after the long-press handler — on an
// album tile it selected the album and then immediately deselected it, so a
// long press opened select mode with nothing in it. `longPressAte` is set by
// the callback and consumed by the very next click, in the capture phase so
// it lands before any listener the element itself carries.
function addLongPress(el, callback) {
  let timer = null;
  let moved = false;
  const onStart = () => {
    moved = false;
    timer = setTimeout(() => {
      if (moved) return;
      if (navigator.vibrate) navigator.vibrate(25);
      longPressAte = true;
      callback();
    }, 500);
  };
  const onMove  = () => { moved = true; clearTimeout(timer); timer = null; };
  const onEnd   = () => { clearTimeout(timer); timer = null; };
  el.addEventListener("touchstart",  onStart,  { passive: true });
  el.addEventListener("touchmove",   onMove,   { passive: true });
  el.addEventListener("touchend",    onEnd);
  el.addEventListener("touchcancel", onEnd);
  el.addEventListener("mousedown",   onStart);
  el.addEventListener("mousemove",   onMove);
  el.addEventListener("mouseup",     onEnd);
  el.addEventListener("contextmenu", e => e.preventDefault());
  el.addEventListener("click", (e) => {
    if (!longPressAte) return;
    longPressAte = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}

// ----- Render -----
// Tile art size matched to the display: tiles render at ~150-220px CSS, so
// 500px covers were ~2.8× oversized on DPR-2 iPads — each one an on-demand
// rescale by the Roon Core. Rounded to coarse steps so the whole session
// shares a handful of cache keys (server LRU + browser cache); the 300px
// floor keeps DPR-1 desktops sharp on wide walls where tiles exceed 200px.
// Sized from the tile actually drawn (v0.6.5: UI Settings can make a tile
// two or three times its old width), in device pixels, and held inside the
// 300–500 band the server keeps cached.
// The artwork size to ask for: the larger of the two tiles it may fill (a
// grid column, a Home carousel tile), in device pixels, to the next 100.
// v0.6.10: no 190px floor (a phone's 3-across tile is ~130px, so it was
// fetching and decoding 500px covers for it), and the density counted up to
// 2x only — a 3x phone draws a 150px tile from 300px, not 450-500px, which
// is under half the pixels to fetch, decode and hold while scrolling. A
// quarter of a four-cover mosaic asks for half.
function tileImgSize(quarter) {
  const p = window.__uiPrefs;
  const gridTile = window.innerWidth / (p ? p.cols() : 3);
  const carouselTile = 150 * parseFloat(p ? p.get("tile") : "1");
  const css = Math.max(Math.min(gridTile, 600), carouselTile) / (quarter ? 2 : 1);
  const px = css * Math.min(2, window.devicePixelRatio || 1);
  return Math.min(500, Math.max(quarter ? 100 : 200, Math.ceil(px / 100) * 100));
}

// Source badge for an album payload: "local" | "qobuz" | "tidal", or null
// when the server couldn't determine it. `a.local` is still honoured so a
// tile built from an older cached payload keeps its badge.
// ----- Quality badge -----------------------------------------------------
//
// "24/96" on the artwork, always (the switch in Settings went in v0.5.19).
// It is read from your own files, so a streamed album simply has none — the
// server sends the field only when it knows, and no badge is drawn
// otherwise. A question mark or a guess would be worse than silence.
function qualityBadge(a) {
  if (!a.quality) return null;
  const el = document.createElement("span");
  el.className = "album-quality" + (a.hires ? " is-hires" : "");
  el.textContent = a.quality;
  // The badge is two characters of shorthand; the accessible name says what
  // they mean, and the tooltip does the same for a mouse.
  const words = /\//.test(a.quality)
    ? a.quality.split("/")[0] + "-bit, " + a.quality.split("/")[1] + " kHz"
    : a.quality;
  el.title = words;
  el.setAttribute("aria-label", words);
  return el;
}

const SOURCE_LABEL = { local: "Local albums", qobuz: "Qobuz", tidal: "Tidal" };
function sourceBadge(a) {
  const kind = a.source || (a.local ? "local" : null);
  if (!kind || !SOURCE_LABEL[kind]) return null;
  const el = document.createElement("span");
  el.className = "album-source " + kind;
  el.title = SOURCE_LABEL[kind];
  el.setAttribute("aria-label", SOURCE_LABEL[kind]);
  return el;
}

// ARTWORK, WITH A RETRY. `/api/image` answers 503 whenever the extension is
// still connecting to the Core and the art is not already in the disk store —
//
//     if (!core) return res.status(503).end();
//
// and a cold app open lands squarely in that window, because Home repaints
// from its saved copy immediately while pairing takes a second or two. Every
// <img> that lost the race fired onerror, and onerror did this:
//
//     img.onerror = () => { wrap.classList.add("no-image"); img.remove(); };
//
// — one failure, a music note for the life of the page, even though the art
// became available moments later and nothing ever asked again. Which rows
// were affected came down to which requests happened to be in flight, so the
// same screen would show covers on some carousels and notes on others.
//
// Retries with a widening gap, then gives up. `r` is not read by the server
// (it keys on the path and ?size); it is there so a retry is a genuinely new
// request rather than anything a cache could answer from the failure.
function loadArt(container, key, size, onGiveUp) {
  // Inside the function on purpose. This is declared 3000 lines below two of
  // its callers — hoisting makes the FUNCTION reachable from them, but a
  // module-level `const` would not be, and CLAUDE.md's declaration-before-use
  // rule exists because that distinction has bitten this file before.
  const RETRY_MS = [1200, 3500, 8000];
  const img = document.createElement("img");
  img.loading = "lazy"; img.alt = "";
  const url = `/api/image/${encodeURIComponent(key)}?size=${size}`;
  let tries = 0;
  img.onerror = () => {
    if (tries >= RETRY_MS.length) {
      if (onGiveUp) onGiveUp(img); else img.remove();
      return;
    }
    const wait = RETRY_MS[tries++];
    setTimeout(() => {
      // The tile may have been replaced by a re-render in the meantime;
      // retrying a detached <img> is a request nobody will ever see.
      if (img.isConnected) img.src = url + "&r=" + tries;
    }, wait);
  };
  // The cover's own colour, for the glow under it (Late-Night Hi-Fi):
  // averaged from a few pixels once it has loaded.
  img.addEventListener("load", () => {
    try {
      // Kept on the function, not a module-level let: loadArt runs before
      // its own position in the file is reached (hoisting; see RETRY_MS).
      const c = loadArt.glowCanvas || (loadArt.glowCanvas = document.createElement("canvas"));
      c.width = c.height = 6;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0, 6, 6);
      const d = g.getImageData(0, 0, 6, 6).data;
      let r = 0, gr = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4;
      container.style.setProperty("--glow", Math.round(r / n) + "," + Math.round(gr / n) + "," + Math.round(b / n));
    } catch (e) { /* a cover from elsewhere: the theme's own glow */ }
  }, { once: true });
  img.src = url;
  container.appendChild(img);
  return img;
}

// The tile's keys for the screens contract (docs/specs/native-parity.md) on
// the Library wall: the tile, and each part of it, each key written whole
// (the gate reads them from the source).
function keyLibraryTile(tile) {
  tile.dataset.parity = "library.album";
  const parts = { ".album-art-wrap": "library.album-art", ".album-quality": "library.album-quality", ".album-source": "library.album-source",
                  ".album-discs": "library.album-discs", ".album-title": "library.album-title", ".album-artist": "library.album-artist" };
  for (const [sel, key] of Object.entries(parts)) { const el = tile.querySelector(sel); if (el) el.dataset.parity = key; }
  return tile;
}

// The same on a wall Home links to (walls.js, the random wall), and on an artist's page.
function keyWallTile(tile) {
  tile.dataset.parity = "wall.album";
  const parts = { ".album-art-wrap": "wall.album-art", ".album-quality": "wall.album-quality", ".album-source": "wall.album-source",
                  ".album-discs": "wall.album-discs", ".album-title": "wall.album-title", ".album-artist": "wall.album-artist" };
  for (const [sel, key] of Object.entries(parts)) { const el = tile.querySelector(sel); if (el) el.dataset.parity = key; }
  return tile;
}
function keyArtistTile(tile) {
  tile.dataset.parity = "artist.album";
  const parts = { ".album-art-wrap": "artist.album-art", ".album-quality": "artist.album-quality", ".album-source": "artist.album-source",
                  ".album-discs": "artist.album-discs", ".album-title": "artist.album-title", ".album-artist": "artist.album-artist" };
  for (const [sel, key] of Object.entries(parts)) { const el = tile.querySelector(sel); if (el) el.dataset.parity = key; }
  return tile;
}
window.__keyArtistTile = keyArtistTile;
// The same in the search's results (search.js).
function keySearchTile(tile) {
  tile.dataset.parity = "search.album";
  const parts = { ".album-art-wrap": "search.album-art", ".album-quality": "search.album-quality", ".album-source": "search.album-source",
                  ".album-discs": "search.album-discs", ".album-title": "search.album-title", ".album-artist": "search.album-artist" };
  for (const [sel, key] of Object.entries(parts)) { const el = tile.querySelector(sel); if (el) el.dataset.parity = key; }
  return tile;
}
// The same on Home's rows (home-render.js, homeTile), and for a playlist's tile there (its mosaic, its name, its count).
function keyHomeTile(tile) {
  tile.dataset.parity = "home.album";
  const parts = { ".album-art-wrap": "home.album-art", ".album-quality": "home.album-quality", ".album-source": "home.album-source",
                  ".album-discs": "home.album-discs", ".album-title": "home.album-title", ".album-artist": "home.album-artist" };
  for (const [sel, key] of Object.entries(parts)) { const el = tile.querySelector(sel); if (el) el.dataset.parity = key; }
  return tile;
}
function keyPlaylistTile(tile) {
  tile.dataset.parity = "home.playlist";
  const parts = { ".album-art-wrap": "home.playlist-art", ".album-title": "home.playlist-title", ".album-artist": "home.playlist-subtitle" };
  for (const [sel, key] of Object.entries(parts)) { const el = tile.querySelector(sel); if (el) el.dataset.parity = key; }
  return tile;
}

// Build a single album tile. onClick defaults to opening the album modal,
// but callers (e.g. the label browser) can override it to carry a filter.
function buildAlbumTile(a, onClick, opts) {
  const btn = document.createElement("button");
  btn.className = "album";
  btn.type = "button";
  btn.setAttribute("aria-label",
    `${a.title || "Untitled"}${a.subtitle ? " by " + a.subtitle : ""}`);
  btn.dataset.albumKey = (a.title || "").toLowerCase().trim();

  const artWrap = document.createElement("div");
  artWrap.className = "album-art-wrap";
  // Source badge — only shown when the server is confident: local files, or
  // an album matched in your Qobuz/Tidal favourites. No badge means the
  // source couldn't be determined, not that it's missing.
  const srcBadge = sourceBadge(a);
  if (srcBadge) artWrap.appendChild(srcBadge);
  // Always built, shown or hidden by one class on <body>. Rendering it
  // conditionally would mean every tile already on screen kept its old state
  // until something rebuilt it, so the toggle would look like it had done
  // nothing until you navigated away and back.
  const qBadge = qualityBadge(a);
  if (qBadge) artWrap.appendChild(qBadge);
  // More than one disc (v0.6.0): two discs, bottom right, opposite the quality.
  if (a.discs > 1) {
    const d = document.createElement("span");
    d.className = "album-discs";
    d.title = a.discs + " discs";
    d.setAttribute("aria-label", a.discs + " discs");
    artWrap.appendChild(d);
  }
  // A playlist has no cover of its own, so it gets a mosaic of the artwork
  // from the first few tracks — the way Roon draws them. Two or more distinct
  // covers make a 2x2; a single one just fills the tile, because a lone
  // quarter-sized sleeve in an empty square looks broken.
  const mosaic = Array.isArray(a.art_keys) ? a.art_keys.filter(Boolean) : [];
  if (mosaic.length >= 2) {
    artWrap.classList.add("album-art-mosaic");
    artWrap.dataset.mosaic = String(Math.min(mosaic.length, 4));
    // Keys recorded on the element so "what artwork was this tile given" is
    // answerable even after a failed <img> removes itself.
    artWrap.dataset.artKeys = mosaic.slice(0, 4).join(",");
    for (const k of mosaic.slice(0, 4)) loadArt(artWrap, k, tileImgSize(mosaic.length >= 4));
  } else if (mosaic.length === 1 || a.image_key) {
    const key = mosaic[0] || a.image_key;
    // The key stays on the tile even after a failed <img> removes itself, so
    // "what artwork was this tile given" is answerable after the fact.
    artWrap.dataset.artKey = key;
    loadArt(artWrap, key, tileImgSize(),
      (img) => { artWrap.classList.add("no-image"); img.remove(); });
  } else {
    artWrap.classList.add("no-image");
  }

  const meta = document.createElement("div");
  meta.className = "album-meta";
  meta.innerHTML = `<div class="album-title"></div><div class="album-artist"></div>`;
  meta.querySelector(".album-title").textContent  = a.title    || "Untitled";
  meta.querySelector(".album-artist").textContent = a.subtitle || "";

  btn.appendChild(artWrap);
  btn.appendChild(meta);

  // Whether long-press can multi-select this tile. It used to be inferred
  // from "was a custom opener passed", which quietly disabled selection on
  // seven of the eleven tile screens — the Library A-Z wall, Not-played,
  // label albums and the Home carousels all pass an opener for the sole
  // purpose of forcing `filter: null`, and paid for it with no select mode.
  // Stating it outright separates "how do I open" from "can I select".
  // Playlist tiles pass false: a playlist is not an album and cannot be
  // queued as one.
  const selectable = opts && "selectable" in opts ? !!opts.selectable : true;
  if (selectable) btn.dataset.offset = String(a.offset);

  // The tile knows its album and how it opens, so the album page can step to
  // the tile beside it (albumNav, below).
  btn.__album = a;
  btn.__open = onClick || (() => openAlbum(a));
  btn.__isAlbum = selectable && a.offset != null;
  btn.addEventListener("click", () => {
    if (selectable && albumSelectMode) { handleAlbumTileSelect(btn, a); return; }
    albumNav.from(btn);
    btn.__open();
  });
  if (selectable) {
    // A long press starts selecting, with the tile under the finger the
    // first pick (v0.6.24: as the labels grid and the queue; the release
    // click is eaten, so it stays picked).
    addLongPress(btn, () => {
      if (albumSelectMode) return;
      enterAlbumSelectMode();
      handleAlbumTileSelect(btn, a);
    });
  }
  return btn;
}
