/* The page's core (app.js until v1.0.5), 21 of 33: an album opened, and the queue's history. */
function openAlbum(album, opts) {
  opts = opts || {};
  // The Android app's own album page (always, since item 47; an older app says no): one of the library's, not this phone's.
  const app = window.MusicdApp;
  if (opts.source !== "now-playing" && album && typeof album.offset === "number" && app && typeof app.nativeAlbum === "function" && app.nativeAlbum()) {
    // Which of the row's buttons is lit under it (touchnav.js's classes on <html>): Home, or the Library wall. An older app takes two arguments.
    const html = document.documentElement.classList;
    const lit = html.contains("tn-home") && !html.contains("tn-search") ? "home" : html.contains("tn-lib") ? "library" : "";
    // The list it was opened from (the tile's row or wall), for the app's previous and next; taken, as the page's own view would take it.
    const nav = albumNav.take();
    if (typeof app.openAlbumIn === "function") {
      const list = nav ? JSON.stringify({ items: nav.items.map(i => ({ offset: i.album.offset, title: i.album.title || "" })), index: nav.index }) : "";
      app.openAlbumIn(album.offset, selectedZoneId || "", lit, list);
      return;
    }
    try { app.openAlbum(album.offset, selectedZoneId || "", lit); } catch (e) { app.openAlbum(album.offset, selectedZoneId || ""); }
    return;
  }
  if (opts.source === "now-playing") {
    const albumOpen = !modal.classList.contains("hidden") && !modal.classList.contains("np-mode");
    // Re-opened while already on Now playing: keep what it is to go back to.
    if (albumOpen) {
      // Where the album was opened from (its prev/next) and how far down it
      // was scrolled go with it, so Back puts back the screen as it was.
      const bodyEl = modal.querySelector(".modal-body");
      npReturn = currentAlbum
        ? { album: currentAlbum, opts: { source: currentSource, zoneId: currentSourceZoneId, filter: currentDetailFilter },
            nav: albumNav.current, scrollTop: bodyEl ? bodyEl.scrollTop : 0 }
        : null;
    } else if (modal.classList.contains("hidden")) {
      npReturn = null;
    }
  } else {
    npReturn = null;
  }
  albumNav.current = albumNav.take();
  // Album select mode and track select mode both drive the one top-bar menu,
  // so they must never be live together. Opening an album ends the grid
  // selection rather than leaving a count behind that the menu would then
  // act on with the wrong list.
  if (albumSelectMode) exitAlbumSelectMode();
  exitTrackSelectMode();
  currentAlbum = album;
  window.__currentAlbum = album;
  // Its big cover fetched now, so the share card is ready the moment it's asked for.
  if (album && album.image_key && window.__prewarmShareCard) window.__prewarmShareCard(album.image_key);
  currentSource = opts.source || "random";
  currentSourceZoneId = opts.zoneId || null;
  // An explicit opts.filter (incl. null) wins over the active filter — Home
  // tiles carry full-library offsets and must resolve unfiltered even if a
  // genre filter is still active.
  currentDetailFilter = ("filter" in opts) ? opts.filter : activeFilter;

  // Persist so the modal survives a Safari reload after tapping an external link
  try {
    sessionStorage.setItem("rra-modal",
      JSON.stringify({ album, source: currentSource, zoneId: currentSourceZoneId,
                       filter: currentDetailFilter }));
  } catch (e) { /* ignore */ }

  const isNP = currentSource === "now-playing";
  if (isNP) albumNav.current = null;
  albumNav.paint();
  resetModalScroll();   // a reopened modal must never start mid-scroll

  // Tabs visible only in now-playing mode
  const tabsEl = document.getElementById("modal-tabs");
  tabsEl.classList.toggle("hidden", !isNP);
  modal.classList.toggle("np-mode", isNP);
  showTab("album");

  modalTitle.textContent = album.title || "Untitled";
  setModalArtist(album.subtitle);
  modalActs.innerHTML    = isNP ? "" : `<div class="modal-loading" data-parity="album.notice">Loading…</div>`;
  modalTracks.innerHTML  = "";
  { const tt = document.getElementById("modal-total"); if (tt) tt.textContent = ""; }
  { const dl = document.getElementById("modal-date"); if (dl) dl.innerHTML = ""; }

  // Reset bio sections, and the sections under them (cleared before any
  // answer for this album can arrive)
  resetMoreSections();
  if (window.__resetAlbumCredits) window.__resetAlbumCredits();   // and its credits (item 132)
  document.getElementById("album-bio-section").classList.add("hidden");
  document.getElementById("album-bio-toggle").classList.add("hidden");
  document.getElementById("album-bio-source").classList.add("hidden");
  document.getElementById("album-bio-text").dataset.clipped = "true";
  setModalSource(album);   // tile data may already carry it; refreshed below from the detail response
  resetBooklets();         // a previous album's book never lingers; asked for once its offset is sure
  if (album.image_key) {
    modalImg.src = `/api/image/${encodeURIComponent(album.image_key)}?size=800`;
    modalImg.style.display = "";
    setModalAmbient(modalImg.src);
  } else {
    modalImg.removeAttribute("src");
    modalImg.style.display = "none";
    setModalAmbient(null);
  }
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  if (isNP) {
    // The now-playing screen is driven live by the transport poll loop;
    // refresh it immediately from the latest zone state.
    if (typeof window.__refreshTransport === "function") window.__refreshTransport();
  } else {
    fetchAlbumDetail(album).catch(err => {
      // An album of the phone's own music that has left the folder since
      // its tile was drawn (moved to the server, say): say so, take the
      // tile off Home and the wall, and go back to where you were.
      if (err.gone && isPhoneAlbum(album)) {
        showToast(err.message, "error");
        if (window.__musicdLocalChanged) window.__musicdLocalChanged();
        const back = modal.querySelector(".modal-close[data-close]");
        if (album === currentAlbum) { if (back) back.click(); else closeModal(); }
        return;
      }
      modalActs.innerHTML = `<div class="modal-error" data-parity="album.notice">${escapeHtml(err.message)}</div>`;
    });
    fetchAlbumExtras(album).catch(() => { /* extras are non-critical — modal still opens */ });
  }
}

// Put the modal's scroller back to the top.
//
// .modal-body is a LONG-LIVED node — the modal is hidden and shown, never
// rebuilt — so its scrollTop outlives everything drawn inside it. An album
// opened after another one was scrolled halfway down therefore started
// halfway down, and switching back from the Queue tab kept the queue's
// offset. No caller ever wants to open a screen already scrolled.
//
// NOT the fix for "now playing is stretched too high above the top of the
// screen" — that was the missing status-bar inset (style.css, np-mode
// padding-top), and the Now playing tab is `overflow: hidden` anyway, so its
// scrollTop cannot be anything but 0 on a phone-sized viewport.
function resetModalScroll() {
  const body = modal ? modal.querySelector(".modal-body") : null;
  if (body) body.scrollTop = 0;
}

function showTab(name) {
  document.querySelectorAll(".modal-tab").forEach(b => {
    b.classList.toggle("is-active", b.dataset.tab === name);
  });
  document.getElementById("tab-album").classList.toggle("hidden", name !== "album");
  document.getElementById("tab-queue").classList.toggle("hidden", name !== "queue");

  // Track the active tab on the modal so the transport bar / now-playing
  // screen can react: bar hidden on the Now playing tab, shown on Queue.
  modal.classList.toggle("tab-album", name === "album");
  modal.classList.toggle("tab-queue", name === "queue");

  // The Roon-style now-playing block only shows on the Now playing tab while
  // in now-playing mode.
  const npScreen = document.getElementById("np-screen");
  if (npScreen) {
    npScreen.classList.toggle("hidden",
      !(name === "album" && modal.classList.contains("np-mode")));
  }
  resetModalScroll();

  if (name === "queue") loadQueue();
  if (typeof window.__refreshTransport === "function") window.__refreshTransport();
}
// Switching zones with the Queue tab already open has to repaint it — the
// fix above makes the FETCH follow the live zone, but nothing was asking it
// to fetch again, so the stale list stayed on screen until you left the tab
// and came back.
{
  const zs = document.getElementById("zone-select");
  if (zs) zs.addEventListener("change", () => {
    if (modal && !modal.classList.contains("hidden") && modal.classList.contains("tab-queue")) {
      loadQueue();
    }
  });
}

document.querySelectorAll(".modal-tab").forEach(b => {
  b.addEventListener("click", () => showTab(b.dataset.tab));
});

// A queue belongs to a ZONE, and the zone the user is pointed at can change
// while this screen stays open. currentSourceZoneId is a snapshot taken in
// openAlbum(), so reading it here showed the queue of whichever zone happened
// to be selected when the screen was opened — switch from Sonos to WPP
// without moving playback and you kept looking at the Sonos queue, and
// "Play from here" acted on it too.
//
// The live zone selector is the single source of truth every other control
// already follows (the transport bar and now-playing screen both read it), so
// the queue follows it as well. The snapshot stays as a last-resort fallback
// for the case where the selector isn't populated yet.
function queueZoneId() {
  const sel = document.getElementById("zone-select");
  return (sel && sel.value) || selectedZoneId || currentSourceZoneId || null;
}

// Collapsed by default, remembered for the session. Every play action on this
// screen re-pulls the queue, and a fold-out that shut itself on each of those
// would be unusable.
let queueHistoryOpen = false;
// Select mode, and the picks in the order they were MADE — which is the order
// they will be queued in, and is not the order they are shown in. Both are
// reset whenever the list is rebuilt: the rows are new nodes then, and a
// selection pointing at rows that no longer exist is worse than none.
let historySelectMode = false;
let historySelected = [];
// The queue's own selection (v0.6.24): a long press on a row starts it with
// that row picked; taps pick more, in order; the ⋯ beside the remaining
// time plays them now or next, or removes them. Reset with the rows.
let queueSelectMode = false;
let queueSelected = [];
let repaintQueueSelection = () => {};   // the bar and rows repainted after an action
// Mirrors lib/queue-history.js. Each track is a full browse navigation, so a
// large selection is minutes of Core traffic; the server enforces the same
// number and this is only here to say so before the request is made.
const HISTORY_MULTI_MAX = 20;
// Repaints the fold-out from the state above. Held here because the send
// finishes OUTSIDE the render that drew the rows, and without it the Select
// button stayed lit and the action bar stayed open over an empty selection
// until the queue reload landed 600ms later.
let repaintHistory = () => {};

// What already played, above the live queue.
//
// Roon's queue reports the current track and what is coming; anything played
// or skipped past is gone from it, and there is no queue-history call in the
// extension API. These rows are what the extension watched leave the zone.
//
// They are a RECORD, not a rewindable queue, and the UI has to be honest
// about that: tapping one adds it after the current track. Restoring the
// queue around it would mean rebuilding every track after it through the
// browse hierarchy — roughly eight Core round trips each, behind a play_now
// that wipes the live queue first.
function renderQueueHistory(list, history) {
  if (!history.length) return;
  // The server sends newest first ("the last N"); on screen it reads
  // oldest-at-the-top so the most recent sits against the Now playing
  // divider, the way a queue is read.
  const rows = history.slice().reverse();

  // The disclosure and the actions are ONE element, and it is the element
  // that sticks. Two sticky rows would each need to know the other's height
  // to stack without overlapping; one wrapper just works, at any text size.
  //
  // Still inside the list rather than floating over it — a bar positioned
  // above the queue would be a new stacking context on a screen that already
  // has the transport bar in it, which is how v1.6.58's sheets ended up
  // underneath something.
  const head = document.createElement("li");
  head.className = "q-history-head";

  const bar = document.createElement("div");
  bar.className = "q-history-bar";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "q-history-toggle"; btn.dataset.parity = "queue.history-toggle";
  const selBtn = document.createElement("button");
  selBtn.type = "button";
  selBtn.className = "q-history-select"; selBtn.dataset.parity = "queue.history-select";
  bar.appendChild(btn);
  bar.appendChild(selBtn);

  const actions = document.createElement("div");
  actions.className = "q-hist-actions hidden";
  const count = document.createElement("span");
  count.className = "q-hist-count"; count.dataset.parity = "queue.history-count";
  // [key]: the screens contract's (docs/specs/screens.json); the Android app's Queue has each.
  const mkAct = (label, cls, key) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "q-hist-act" + (cls ? " " + cls : "");
    b.textContent = label;
    b.dataset.parity = key;
    return b;
  };
  const actNext  = mkAct("Play next", "primary", "queue.history-play-next");
  const actQueue = mkAct("Add to queue", "", "queue.history-add");
  const actClear = mkAct("Clear", "", "queue.history-clear");
  actions.append(count, actNext, actQueue, actClear);
  head.append(bar, actions);

  const rowEls = rows.map((h) => {
    const li = document.createElement("li");
    li.className = "q-hist-row is-tappable"; li.dataset.parity = "queue.history-track";

    // The pick number. Selection order is not display order, so without a
    // number on the row there is no way to see what order you chose — and
    // the order is the entire point of selecting more than one.
    const num = document.createElement("span");
    num.className = "q-hist-num hidden";

    const art = document.createElement("img");
    art.className = "q-art";
    if (h.image_key) art.src = `/api/image/${encodeURIComponent(h.image_key)}?size=120`;
    else art.style.visibility = "hidden";

    const tx = document.createElement("div"); tx.className = "q-text";
    const tt = document.createElement("div"); tt.className = "q-title";
    tt.textContent = h.track || "";
    const ts = document.createElement("div"); ts.className = "q-sub";
    ts.textContent = [h.artist, h.album].filter(Boolean).join(" · ");
    tx.appendChild(tt); tx.appendChild(ts);

    const len = document.createElement("span");
    len.className = "q-len";
    // A skip is only legible next to how long the track was — "0:12" alone
    // reads as a very short track. Anything that counted as played just
    // shows its length, like every other row.
    if (!h.played && h.elapsed > 0 && h.duration) {
      len.textContent = `${fmtDuration(h.elapsed)} / ${fmtDuration(h.duration)}`;
      len.classList.add("is-skipped");
      li.classList.add("was-skipped");
    } else if (h.duration) {
      len.textContent = fmtDuration(h.duration);
    }

    li.append(num, art, tx, len);
    return li;
  });

  // Which rows are picked, and where each sits in the pick order. Rerun on
  // every toggle because removing a pick renumbers everything after it.
  const paintSelection = () => {
    rowEls.forEach((el, i) => {
      const at = historySelected.indexOf(i);
      el.classList.toggle("is-picked", at !== -1);
      const n = el.querySelector(".q-hist-num");
      n.textContent = at === -1 ? "" : String(at + 1);
      n.classList.toggle("hidden", at === -1 || !historySelectMode);
    });
    const n = historySelected.length;
    count.textContent = n ? `${n} selected` : "Tap tracks in play order";
    for (const b of [actNext, actQueue]) b.disabled = n === 0;
  };

  const paint = () => {
    btn.setAttribute("aria-expanded", String(queueHistoryOpen));
    btn.textContent = (queueHistoryOpen ? "▾ " : "▸ ") +
      `${rows.length} played earlier`;
    for (const el of rowEls) el.classList.toggle("hidden", !queueHistoryOpen);
    // Selecting is only offered while the rows are on screen — a Select
    // button above a collapsed list acts on things you cannot see.
    selBtn.classList.toggle("hidden", !queueHistoryOpen);
    selBtn.textContent = historySelectMode ? "Done" : "Select";
    selBtn.setAttribute("aria-pressed", String(historySelectMode));
    actions.classList.toggle("hidden", !queueHistoryOpen || !historySelectMode);
    // Only pinned while the rows are showing. Collapsed, it is one line above
    // the Now playing divider and pinning it would park a bar over the live
    // queue for the whole scroll of it.
    head.classList.toggle("is-open", queueHistoryOpen);
    for (const el of rowEls) el.classList.toggle("is-selecting", historySelectMode);
    paintSelection();
  };

  btn.addEventListener("click", () => {
    queueHistoryOpen = !queueHistoryOpen;
    // Closing the fold-out ends the selection with it: picks that cannot be
    // seen cannot be checked before acting on them.
    if (!queueHistoryOpen) { historySelectMode = false; historySelected = []; }
    paint();
  });
  selBtn.addEventListener("click", () => {
    historySelectMode = !historySelectMode;
    if (!historySelectMode) historySelected = [];
    paint();
  });
  actClear.addEventListener("click", () => { historySelected = []; paintSelection(); });
  actNext.addEventListener("click",  () => runHistoryMulti("play_next", rows));
  actQueue.addEventListener("click", () => runHistoryMulti("queue", rows));

  rowEls.forEach((el, i) => {
    el.addEventListener("click", () => {
      if (!historySelectMode) { playHistoryNext(rows[i]); return; }
      const at = historySelected.indexOf(i);
      if (at === -1) {
        if (historySelected.length >= HISTORY_MULTI_MAX) {
          showToast(`Up to ${HISTORY_MULTI_MAX} tracks at a time`, "error");
          return;
        }
        historySelected.push(i);          // pushed, so the array IS the order
      } else {
        historySelected.splice(at, 1);
      }
      paintSelection();
    });
  });

  // The control first, then what it discloses: collapsed it sits alone at the
  // top of the list, and expanded the rows run down from it to finish against
  // the Now playing divider — the order they were played in.
  list.appendChild(head);
  for (const el of rowEls) list.appendChild(el);
  repaintHistory = paint;
  paint();
}
