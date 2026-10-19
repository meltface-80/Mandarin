/* The page's core (app.js until v1.0.5), 23 of 33: the album view closed, and the album editor. */
function closeModal() {
  // Track selection belongs to the album that is closing. Leaving it set
  // would arm the next album's rows with someone else's picks.
  exitTrackSelectMode();
  modal.classList.add("hidden");
  modal.classList.remove("np-mode", "tab-album", "tab-queue");
  document.body.style.overflow = "";
  currentAlbum = null;
  window.__currentAlbum = null;
  try { sessionStorage.removeItem("rra-modal"); } catch (e) { /* sessionStorage optional */ }
  if (typeof window.__refreshTransport === "function") window.__refreshTransport();
}
modal.addEventListener("click", (e) => {
  if (!(e.target.closest && e.target.closest("[data-close]"))) return;
  // On Now playing a close — the backdrop round a reduced card, say — is the
  // same as its Back: it returns to the album it replaced, if there was one.
  if (modal.classList.contains("np-mode")) leaveNowPlaying();
  else closeModal();
});

// np-mode's top-left Back (v0.6.1; it was Home, which always went Home):
// back to the screen before the mini player was tapped — the album that was
// open, or the screen under the modal, which closing leaves exactly as it was.
function leaveNowPlaying() {
  const back = npReturn;
  npReturn = null;
  closeModal();
  if (!back) return;
  // Reopened as if from its tile, so previous / next, the swipe and the
  // arrow keys still walk the list it came from.
  albumNav.pending = back.nav || null;
  try { openAlbum(back.album, back.opts); }
  finally { albumNav.pending = null; }
  // And scrolled back to where it was, once the track list is long enough
  // to hold that position again (it loads after the panel opens).
  const want = back.scrollTop || 0;
  if (want > 0) {
    const bodyEl = modal.querySelector(".modal-body");
    let tries = 0;
    const settle = () => {
      // Stop if the panel was closed or something else was opened meanwhile.
      if (!bodyEl || modal.classList.contains("hidden") || currentAlbum !== back.album) return;
      if (bodyEl.scrollHeight - bodyEl.clientHeight >= want) { bodyEl.scrollTop = want; return; }
      if (++tries < 20) setTimeout(settle, 100);
    };
    setTimeout(settle, 50);
  }
}

// THE PHONE'S BACK BUTTON (Android app): one step back, the way the page's
// own buttons go — a dialog, a pop-up, the menu, the share sheet, the album
// or Now playing, then from any wall to Home (which is how the Random row
// turns over, as the PWA's Back does). Only on Home does the app leave.
// Overlays that keep their own history (Qobuz, Tidal, Pitchfork…) are
// stepped back through it. Returns true when it did something.
const visibleEl = (sel) => { const el = document.querySelector(sel); return el && !el.classList.contains("hidden") ? el : null; };
window.__pageBack = () => {
  const confirmOv = visibleEl("#confirm-overlay");
  if (confirmOv) { const no = document.getElementById("confirm-no"); if (no) no.click(); return true; }
  // The sheets with a close of their own, topmost first: the name prompt, the album editor, a lib sheet (Focus, Sort,
  // Group zones, Device power, Add to playlist). Without this, Back on Home with one open answered "nothing to close",
  // and the Android app left the screen (bug list item 54, the sheets opened over a native screen).
  const prompt = visibleEl("#prompt-overlay");
  if (prompt) { const c = document.getElementById("prompt-cancel"); if (c) c.click(); else prompt.classList.add("hidden"); return true; }
  const editor = visibleEl("#album-edit-overlay");
  if (editor) { const c = editor.querySelector("[data-ae-close]"); if (c) c.click(); else editor.classList.add("hidden"); return true; }
  const sheet = document.querySelector(".lib-sheet-backdrop");
  if (sheet) { const c = sheet.querySelector(".lib-sheet-head .icon-btn"); if (c) c.click(); else sheet.remove(); return true; }
  const st = history.state;
  if (st && typeof st === "object" && Object.keys(st).length) { history.back(); return true; }
  for (const sel of ["#mt-zone-popover", "#mt-vol-popover"]) {
    const pop = visibleEl(sel);
    if (pop) { pop.classList.add("hidden"); return true; }
  }
  const menu = visibleEl("#menu-overlay");
  if (menu) { const c = menu.querySelector("[data-menu-close]"); if (c) c.click(); else menu.classList.add("hidden"); return true; }
  const share = visibleEl("#share-overlay");
  if (share) { const c = share.querySelector("[data-share-close]"); if (c) c.click(); return true; }
  if (!modal.classList.contains("hidden")) {
    if (modal.classList.contains("np-mode")) leaveNowPlaying(); else closeModal();
    return true;
  }
  // The artist view: back to the album it was opened from (v0.6.0-RC11).
  if (window.__artistViewActive && window.__artistViewActive()) { window.__exitArtistView(); return true; }
  if ((homeView && homeView.classList.contains("hidden")) || !grid.classList.contains("hidden")) { showHome(); return true; }
  return false;
};
const modalHomeBtn = document.getElementById("modal-home-btn");
if (modalHomeBtn) modalHomeBtn.addEventListener("click", leaveNowPlaying);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || modal.classList.contains("hidden")) return;
  if (modal.classList.contains("np-mode")) leaveNowPlaying();
  else closeModal();
});

// The album view's corner button names what it does at each size: a back
// chevron while the album view fills the screen, an × from 720px up, where it
// is a card over the page (the glyph swaps in CSS at the same width).
// Now playing's corner button: on a desktop — a large screen driven by a
// mouse — it CLOSES the screen (×), full size or reduced; on a phone or a
// tablet it goes BACK (‹). The same tests as the CSS that swaps the glyphs,
// and the same action either way.
{
  const watch = (mq, fn) => {
    fn();
    if (!mq) return;
    if (mq.addEventListener) mq.addEventListener("change", fn);
    else if (mq.addListener) mq.addListener(fn);   // older Safari
  };
  const name = (btn, word) => { if (btn) { btn.setAttribute("aria-label", word); btn.title = word; } };
  const closeBtn = document.getElementById("modal-close-btn");
  const card = window.matchMedia ? window.matchMedia("(min-width: 720px)") : null;
  watch(card, () => name(closeBtn, card && card.matches ? "Close" : "Back"));
  const desktop = window.matchMedia
    ? window.matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)") : null;
  watch(desktop, () => name(modalHomeBtn, desktop && desktop.matches ? "Close" : "Back"));
}

// ---------------------------------------------------------------------------
// NOW PLAYING, REDUCED (v0.6.1) — large screens only.
//
// On a big desktop the full-screen Now playing hides everything. Reduce size
// turns it into a card the size of the album view's; the same button then
// reads "Full size". The card is dragged by its top strip (not by its
// buttons, its tabs or anything inside the body). The choice is remembered
// on this device; the position is not — every opening starts centred.
// ---------------------------------------------------------------------------
{
  const sizeBtn = document.getElementById("modal-np-size-btn");
  const panel = modal.querySelector(".modal-panel");
  const SIZE_KEY = "rra-np-reduced";
  const large = window.matchMedia ? window.matchMedia("(min-width: 1200px) and (min-height: 700px)") : null;
  let reduced = false;
  try { reduced = localStorage.getItem(SIZE_KEY) === "1"; }
  catch (e) { /* storage blocked — full size, the default */ }
  let dx = 0, dy = 0;

  const place = () => { if (panel) panel.style.transform = (dx || dy) ? "translate(" + dx + "px," + dy + "px)" : ""; };
  function paintSize() {
    const on = reduced && !!(large && large.matches) && modal.classList.contains("np-mode");
    if (modal.classList.contains("np-reduced") !== on) modal.classList.toggle("np-reduced", on);
    if (!on) { dx = 0; dy = 0; place(); }
    if (sizeBtn) {
      sizeBtn.setAttribute("aria-pressed", on ? "true" : "false");
      sizeBtn.setAttribute("aria-label", on ? "Full size" : "Reduce size");
      sizeBtn.title = on ? "Full size" : "Reduce size";
    }
  }
  if (sizeBtn) sizeBtn.addEventListener("click", () => {
    reduced = !modal.classList.contains("np-reduced");
    try { localStorage.setItem(SIZE_KEY, reduced ? "1" : "0"); }
    catch (e) { /* storage blocked — it still applies for this visit */ }
    dx = 0; dy = 0;
    paintSize();
  });
  if (large) {
    if (large.addEventListener) large.addEventListener("change", paintSize);
    else if (large.addListener) large.addListener(paintSize);
  }
  // Opening and closing come and go through the classes on the modal, so the
  // state follows them: a fresh opening is centred.
  // Every write below is guarded by a check that it CHANGES something:
  // classList.remove() rewrites the class attribute even when the token is
  // absent, and that write would wake this observer again, for ever.
  new MutationObserver(() => {
    if (modal.classList.contains("hidden") || !modal.classList.contains("np-mode")) {
      if (modal.classList.contains("np-reduced")) modal.classList.remove("np-reduced");
      if (dx || dy) { dx = 0; dy = 0; place(); }
      if (sizeBtn && sizeBtn.getAttribute("aria-pressed") !== "false") paintSize();
    } else if (reduced && !modal.classList.contains("np-reduced") && large && large.matches) {
      paintSize();
    }
  }).observe(modal, { attributes: true, attributeFilter: ["class"] });

  // Drag by the top strip: a press on the panel above its body's content —
  // never on a button, a tab or anything that is itself interactive.
  const STRIP = 56;
  let drag = null;
  if (panel) panel.addEventListener("pointerdown", (e) => {
    if (!modal.classList.contains("np-reduced") || e.button !== 0) return;
    if (e.target.closest("button, a, input, select, .modal-tabs, [role='button']")) return;
    const box = panel.getBoundingClientRect();
    if (e.clientY - box.top > STRIP) return;
    drag = { id: e.pointerId, x: e.clientX - dx, y: e.clientY - dy,
             baseLeft: box.left - dx, baseTop: box.top - dy, w: box.width, h: box.height };
    panel.classList.add("is-dragging");
    try { panel.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety; the move handler still works */ }
    e.preventDefault();
  });
  if (panel) panel.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    // Kept wholly on screen, so its corner buttons can never be dragged out
    // of reach.
    const minX = -drag.baseLeft, maxX = Math.max(minX, window.innerWidth - drag.baseLeft - drag.w);
    const minY = -drag.baseTop,  maxY = Math.max(minY, window.innerHeight - drag.baseTop - drag.h);
    dx = Math.max(minX, Math.min(maxX, e.clientX - drag.x));
    dy = Math.max(minY, Math.min(maxY, e.clientY - drag.y));
    place();
  });
  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    drag = null;
    if (panel) panel.classList.remove("is-dragging");
  };
  if (panel) {
    panel.addEventListener("pointerup", endDrag);
    panel.addEventListener("pointercancel", endDrag);
  }
  paintSize();
}

// ---- Edit album ---------------------------------------------------------
// Title, artist and year corrections plus a cover for an album without one.
// Nothing is written to the music (it's mounted read-only): the server keeps
// the edits in its database and lays them over the scan. An album with no
// cover of its own is searched for straight away; a sure match (same tracks,
// artist and title) is picked for you, anything less is offered to choose
// from, with a box for pasting an image address found elsewhere.
const aeEl = document.getElementById("album-edit-overlay");
const ae = aeEl && {
  img: document.getElementById("ae-cover-img"),
  status: document.getElementById("ae-cover-status"),
  find: document.getElementById("ae-find"),
  remove: document.getElementById("ae-art-remove"),
  undo: document.getElementById("ae-art-undo"),
  search: document.getElementById("ae-search"),
  sStatus: document.getElementById("ae-search-status"),
  cands: document.getElementById("ae-candidates"),
  url: document.getElementById("ae-url"),
  urlUse: document.getElementById("ae-url-use"),
  urlErr: document.getElementById("ae-url-err"),
  title: document.getElementById("ae-title"),
  artist: document.getElementById("ae-artist"),
  year: document.getElementById("ae-year"),
  err: document.getElementById("ae-err"),
  save: document.getElementById("ae-save"),
  reset: document.getElementById("ae-reset"),
  mStatus: document.getElementById("ae-match-status"),
  mFind: document.getElementById("ae-match-find"),
  folder: document.getElementById("ae-folder"),
  mBox: document.getElementById("ae-match"),
  mSearchStatus: document.getElementById("ae-match-search-status"),
  mCands: document.getElementById("ae-match-cands"),
  barcode: document.getElementById("ae-barcode"),
  barcodeUse: document.getElementById("ae-barcode-use"),
  barcodeErr: document.getElementById("ae-barcode-err")
};
let aeState = null;   // { album, data, pick: {url, source, label} | "remove" | null, searchSeq }

// Every picture on screen that still shows an album's old cover address
// takes the new one — tiles in other rows included.
function swapAlbumArt(oldKey, newKey) {
  if (!oldKey || !newKey || oldKey === newKey) return;
  const from = encodeURIComponent(oldKey), to = encodeURIComponent(newKey);
  document.querySelectorAll("img").forEach(im => {
    const src = im.getAttribute("src") || "";
    if (src.indexOf(from) >= 0) im.src = src.replace(from, to);
  });
}

function aeImageSrc(key, size) { return `/api/image/${encodeURIComponent(key)}?size=${size || 300}`; }

function aeCoverStatus() {
  const d = aeState.data, pick = aeState.pick;
  ae.undo.classList.toggle("hidden", !pick);
  ae.remove.classList.toggle("hidden", !(d.art.found && !pick));
  if (pick === "remove") {
    ae.img.src = aeImageSrc(d.image_key, 300);
    ae.status.innerHTML = "The found cover will be removed when you save.";
    return;
  }
  if (pick) {
    ae.img.src = pick.thumb || pick.url;
    ae.status.innerHTML = `<strong>New cover</strong> from ${escapeHtml(pick.source)} — save to use it.`;
    return;
  }
  ae.img.src = aeImageSrc(d.image_key, 300);
  if (d.art.found) ae.status.innerHTML = `<strong>Found cover</strong>${d.art.source && !/^https?:/.test(d.art.source) ? " from " + escapeHtml(d.art.source) : ""}.`;
  else if (d.art.own) ae.status.textContent = "Cover from the album's files.";
  else ae.status.innerHTML = "<strong>No cover.</strong> This album's folder and tracks have no artwork.";
}

function aeWas(field) {
  const box = aeEl.querySelector(`[data-ae-was="${field}"]`);
  const d = aeState.data;
  const scanned = d.scanned[field] == null ? "" : String(d.scanned[field]);
  const now = ae[field].value.trim();
  box.innerHTML = "";
  if (now === scanned) return;
  box.appendChild(document.createTextNode(`From the files: ${scanned || "(none)"} · `));
  const b = document.createElement("button");
  b.type = "button"; b.textContent = "Put back";
  b.addEventListener("click", () => { ae[field].value = scanned; aeWas(field); });
  box.appendChild(b);
}

function aePick(c, el) {
  aeState.pick = c;
  ae.cands.querySelectorAll(".ae-cand").forEach(x => x.classList.toggle("is-picked", x === el));
  aeCoverStatus();
}

function aeMatchLine(c) {
  const m = c.match || {};
  if (m.tracks != null) {
    return m.tracks >= 0.999 ? "All tracks match" : `${Math.round(m.tracks * 100)}% tracks match`;
  }
  return [c.year, c.tracks ? c.tracks + " tracks" : ""].filter(Boolean).join(" · ");
}

function aeRenderCandidates(list, sure) {
  ae.cands.innerHTML = "";
  for (const c of list) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "ae-cand";
    b.title = `${c.title} — ${c.artist} (${c.source})`;
    const box = document.createElement("div"); box.className = "ae-cand-img";
    const im = document.createElement("img"); im.loading = "lazy"; im.alt = ""; im.src = c.thumb || c.url;
    // A dead image (the archive sometimes has none after all) drops out.
    im.addEventListener("error", () => b.remove());
    box.appendChild(im);
    if (sure && c === sure) { const t = document.createElement("span"); t.className = "ae-cand-best"; t.textContent = "Match"; box.appendChild(t); }
    const t1 = document.createElement("div"); t1.className = "ae-cand-t"; t1.textContent = c.title || "—";
    const t2 = document.createElement("div"); t2.className = "ae-cand-s"; t2.textContent = c.source;
    const t3 = document.createElement("div"); t3.className = "ae-cand-s"; t3.textContent = aeMatchLine(c);
    b.append(box, t1, t2, t3);
    b.addEventListener("click", () => aePick(c, b));
    ae.cands.appendChild(b);
    if (sure && c === sure) aePick(c, b);
  }
}

async function aeSearch(auto) {
  const seq = aeState.searchSeq = (aeState.searchSeq || 0) + 1;
  ae.search.classList.remove("hidden");
  ae.cands.innerHTML = "";
  ae.sStatus.textContent = "Searching Apple Music, Deezer and MusicBrainz…";
  ae.find.disabled = true;
  try {
    const r = await fetch(`/api/album/art-search?offset=${aeState.album.offset}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    if (!aeState || seq !== aeState.searchSeq) return;
    const list = j.candidates || [];
    if (j.sure) {
      ae.sStatus.innerHTML = `<strong>Found it</strong> on ${escapeHtml(j.sure.source)} — same tracks, artist and title. Save to use it, or pick another.`;
    } else if (list.length) {
      ae.sStatus.innerHTML = "<strong>Not sure which one is right.</strong> Pick the cover that matches, or paste an image address below.";
    } else {
      ae.sStatus.innerHTML = "<strong>Nothing found.</strong> Paste an image address below — from a record shop, Discogs or a search engine (copy image address).";
    }
    aeRenderCandidates(list, j.sure || null);
  } catch (e) {
    if (!aeState || seq !== aeState.searchSeq) return;
    ae.sStatus.textContent = `The search didn't work (${e.message}). You can still paste an image address below.`;
  } finally {
    if (aeState && seq === aeState.searchSeq) ae.find.disabled = false;
  }
}
