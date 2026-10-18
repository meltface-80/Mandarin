/* The page's core (app.js until v1.0.5), 20 of 33: the device picker on Now playing, and the album view's frame. */
// ----- Device picker (now-playing screen) -----
// Replaces the old share button. Lists available zones and switches the
// active zone by driving the existing topbar selector, so playback, the
// mini-transport, and the now-playing screen all stay in sync.
const npDeviceBtn     = document.getElementById("np-device");
const npDevicePopover = document.getElementById("np-device-popover");
const npDeviceList    = document.getElementById("np-device-list");

async function renderDeviceList() {
  if (!npDeviceList) return;
  let list = zones;
  try {
    const r = await fetch("/api/zones", { cache: "no-store" });
    if (r.ok) { const j = await r.json(); if (Array.isArray(j.zones)) { zones = j.zones; list = j.zones; } }
  } catch (e) { /* fall back to cached zones */ }

  npDeviceList.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "np-device-empty";
    empty.textContent = "No zones available";
    npDeviceList.appendChild(empty);
    return;
  }
  for (const z of list) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "np-device-item" + (z.zone_id === selectedZoneId ? " is-current" : "");
    item.dataset.zone = z.zone_id;
    fillZoneRow(item, z);
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      npDevicePopover.classList.add("hidden");
      npDeviceBtn.setAttribute("aria-expanded", "false");
      if (z.zone_id === selectedZoneId) return;
      zoneSel.value = z.zone_id;
      zoneSel.dispatchEvent(new Event("change"));   // reuse the existing switch flow
      if (typeof window.__refreshTransport === "function") window.__refreshTransport();
    });
    npDeviceList.appendChild(item);
  }
}

if (npDeviceBtn && npDevicePopover) {
  npDeviceBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const vp = document.getElementById("np-vol-popover");
    const vb = document.getElementById("np-volbtn");
    if (vp) vp.classList.add("hidden");
    if (vb) vb.setAttribute("aria-expanded", "false");
    const willShow = npDevicePopover.classList.contains("hidden");
    if (willShow) await renderDeviceList();
    npDevicePopover.classList.toggle("hidden", !willShow);
    npDeviceBtn.setAttribute("aria-expanded", String(willShow));
  });
}

const npGroupOpen = document.getElementById("np-group-open");
if (npGroupOpen) {
  npGroupOpen.addEventListener("click", (e) => {
    e.stopPropagation();
    if (npDevicePopover) npDevicePopover.classList.add("hidden");
    if (npDeviceBtn) npDeviceBtn.setAttribute("aria-expanded", "false");
    openGroupSheet();
  });
}

const npPowerOpen = document.getElementById("np-power-open");
if (npPowerOpen) {
  npPowerOpen.addEventListener("click", (e) => {
    e.stopPropagation();
    if (npDevicePopover) npDevicePopover.classList.add("hidden");
    if (npDeviceBtn) npDeviceBtn.setAttribute("aria-expanded", "false");
    openDevicePowerSheet();
  });
}

// Roon's all-zone actions, in the sheet that is already about which zones.
// Looked up at click time rather than at wiring time: the side menu's
// closure defines __allZoneActions, and the two run in either order.
for (const act of ["pause-all", "mute-all", "unmute-all"]) {
  const btn = document.getElementById("np-" + act);
  if (!btn) continue;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (npDevicePopover) npDevicePopover.classList.add("hidden");
    if (npDeviceBtn) npDeviceBtn.setAttribute("aria-expanded", "false");
    const fn = window.__allZoneActions && window.__allZoneActions[act];
    if (fn) fn();
  });
}

// ----- Modal -----
let currentSource = "random";
let currentSourceZoneId = null;

// Ambient glow layer behind the modal header — mirrors the cover image so
// the blur always matches the art shown. Same URL as #modal-img, so the
// browser serves it from cache (no second fetch). Pass null to hide.
const modalAmbient = document.getElementById("modal-ambient");
function setModalAmbient(url) {
  if (!modalAmbient) return;
  if (url) {
    // The glow is blurred anyway, so feed it a TINY cover (96px) instead of
    // the 800px big art: Safari otherwise keeps a full-size blurred layer
    // composited behind the scrolling modal body. Upscaling the small image
    // does most of the smoothing (the CSS blur radius is tuned to match).
    // Only /api/image URLs carry a size param; anything else passes through.
    modalAmbient.src = url.includes("/api/image/")
      ? url.replace(/([?&])size=\d+/, "$1size=96")
      : url;
    modalAmbient.classList.remove("hidden");
  } else {
    modalAmbient.removeAttribute("src");
    modalAmbient.classList.add("hidden");
  }
}
// The transport poll (separate closure) re-points the big art when the
// playing track changes album; it uses this bridge to keep the Queue tab's
// ambient glow on the same album.
window.__setModalAmbient = setModalAmbient;

function setModalArtist(subtitle, names) {
  // `names` is the server's library-validated split (/api/album `artists`):
  // it also breaks on comma/&/+/and, but only when a fragment is a known
  // library artist — so "Panda Bear, Sonic Boom & Adrian Sherwood" becomes
  // three links while "Earth, Wind & Fire" stays one. Until the detail
  // response lands (or for legacy callers) the conservative client split
  // applies: " / " is Roon's standard separator; feat/featuring/ft handle
  // featured artists; " & " and comma are NOT split here because they are
  // often part of a band name ("Simon & Garfunkel").
  //
  // The links live in their own container as modalSub's first child so the
  // late validated re-render can't wipe the year/label/score spans that
  // renderExtras appends after them. A call WITHOUT `names` is an album
  // (re)open: full reset, and the previous album's extras go with it.
  const validated = Array.isArray(names) && names.length > 0;
  let box = document.getElementById("modal-artist-names");
  if (!validated || !box) {
    modalSub.innerHTML = "";
    box = document.createElement("span");
    box.id = "modal-artist-names";
    modalSub.appendChild(box);
  }
  box.innerHTML = "";
  if (!subtitle) return;
  const parts = validated
    ? names
    : subtitle.split(/ \/ | feat\.? | featuring | ft\.? /i).map(s => s.trim()).filter(Boolean);
  // Album credits are always linkable: the credit came from a library album,
  // so at minimum that album is on the artist's screen.
  renderArtistLinks(box, parts.map(name => ({ name, linkable: true })), {
    separator: validated ? " · " : " / ",
    linkClass: "modal-artist-link",
    sepClass:  "modal-subtitle-year",
  });
}

// The per-artist link row, shared by the album view and the now-playing
// screen so both behave identically — one implementation, one set of
// listeners, one navigation rule.
//
// `parts` is [{ name, linkable }]. A non-linkable name renders as plain text
// rather than a button: the library has no screen for it, and a link that
// opens an empty page is worse than no link. The album view marks everything
// linkable (see above); the now-playing screen doesn't, because its credit is
// the track artist.
function renderArtistLinks(box, parts, opts) {
  opts = opts || {};
  const sep        = opts.separator || " · ";
  const linkClass  = opts.linkClass || "modal-artist-link";
  const sepClass   = opts.sepClass  || "modal-subtitle-year";
  // Non-linkable names default to the separator's muted tone, but the
  // now-playing screen overrides it: on a compilation EVERY track artist can
  // be unlinkable, and dimming the whole line reads as a rendering fault
  // rather than as information.
  const plainClass = opts.plainClass || sepClass;
  box.innerHTML = "";
  parts.forEach((part, i) => {
    if (i > 0) {
      const s = document.createElement("span");
      s.className = sepClass;
      s.textContent = sep;
      box.appendChild(s);
    }
    if (!part.linkable) {
      const span = document.createElement("span");
      span.className = plainClass;
      span.textContent = part.name;
      box.appendChild(span);
      return;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = linkClass;
    btn.textContent = part.name;
    btn.addEventListener("click", () => {
      // Close FIRST. showArtistAlbums parks the grid/topbar/labels but knows
      // nothing about the album modal, so with the modal still open the
      // artist grid renders behind it and body scroll stays locked.
      // The album it was opened from (v0.6.0-RC11): Back on the artist page
      // comes back to it, not to Home.
      const fromAlbum = currentAlbum ? { album: currentAlbum, opts: { source: currentSource, zoneId: currentSourceZoneId, filter: currentDetailFilter } } : null;
      closeModal();
      // The artist view PARKS the labels browser itself (see showArtistAlbums)
      // so its Back can restore it — tearing it down here would lose the open
      // label and leave the restored grid without its labels bar.
      window.__showArtistAlbums && window.__showArtistAlbums(part.name, { fromAlbum });
    });
    box.appendChild(btn);
  });
}
// The now-playing screen lives inside this modal but is rendered by the
// transport IIFE, which has no access to closeModal or this renderer.
window.__renderArtistLinks = renderArtistLinks;

/*
 * Previous and next on the album page (v0.5.44): an album opened from a
 * list — a Home row, an artist's albums, a label's, the Library wall,
 * search — remembers the tiles beside it, and the page steps to them with
 * the two discs at the top, a swipe, or the arrow keys, each opening the
 * way its own tile would (the same source and filter). Back still returns
 * to the list. An album opened any other way (a search match, a link, the
 * page restored) has no list, and the discs stay hidden.
 */
const albumNav = {
  pending: null,   // set by a tile's click, read once by openAlbum
  current: null,   // { items: [{ album, open }], index }
  from(btn) {
    const parent = btn.parentElement;
    if (!parent) { this.pending = null; return; }
    const tiles = [...parent.children].filter(el => el.__isAlbum && el.__album);
    const index = tiles.indexOf(btn);
    this.pending = tiles.length > 1 && index >= 0
      ? { items: tiles.map(el => ({ album: el.__album, open: el.__open })), index }
      : null;
  },
  take() { const n = this.pending; this.pending = null; return n; },
  step(dir) {
    const nav = this.current;
    if (!nav || modal.classList.contains("np-mode")) return false;
    const i = nav.index + dir;
    if (i < 0 || i >= nav.items.length) return false;
    this.pending = { items: nav.items, index: i };
    nav.items[i].open();
    return true;
  },
  paint() {
    const wrap = document.getElementById("modal-nav");
    if (!wrap) return;
    const nav = this.current;
    wrap.classList.toggle("hidden", !nav);
    const prev = document.getElementById("modal-prev"), next = document.getElementById("modal-next");
    if (prev) prev.disabled = !nav || nav.index <= 0;
    if (next) next.disabled = !nav || nav.index >= nav.items.length - 1;
    if (nav) {
      const at = n => nav.items[n] && nav.items[n].album.title ? ": " + nav.items[n].album.title : "";
      if (prev) prev.setAttribute("aria-label", "Previous album" + at(nav.index - 1));
      if (next) next.setAttribute("aria-label", "Next album" + at(nav.index + 1));
    }
  }
};
{
  const prev = document.getElementById("modal-prev"), next = document.getElementById("modal-next");
  if (prev) prev.addEventListener("click", () => albumNav.step(-1));
  if (next) next.addEventListener("click", () => albumNav.step(1));
  // A swipe across the page: left for the next album, right for the one before.
  const panel = modal ? modal.querySelector(".modal-panel") : null;
  if (panel) {
    let sx = 0, sy = 0, st = 0, live = false;
    panel.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) { live = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); live = true;
    }, { passive: true });
    panel.addEventListener("touchend", (e) => {
      if (!live) return;
      live = false;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Date.now() - st > 800 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) / 2) return;
      albumNav.step(dx < 0 ? 1 : -1);
    }, { passive: true });
  }
  document.addEventListener("keydown", (e) => {
    if (!modal || modal.classList.contains("hidden") || e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === "ArrowRight" && albumNav.step(1)) e.preventDefault();
    else if (e.key === "ArrowLeft" && albumNav.step(-1)) e.preventDefault();
  });
}

// The screen Now playing was opened over (v0.6.1). Now playing is this same
// modal, so tapping the mini player while an album is open REPLACES that
// album — and the only way out was Home. Its Back puts back what it
// replaced: the album that was open, or (none) whatever screen is under the
// modal, which closing reveals as it was.
let npReturn = null;

/* An album's length: 52:41, or 1:02:15 past the hour. */
function fmtTotal(secs) {
  const s = Math.round(secs), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = n => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}
