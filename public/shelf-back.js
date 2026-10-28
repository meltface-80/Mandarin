// @ts-check
/*
 * shelf-back.js — the album opened on the Shelf. A tap on the case in front
 * turns it over (v1.9.1) and the turn unfolds into the album view, over the
 * whole screen above the bar (v1.9.67-t5). Since item 218 (the owner: the
 * Shelf's album view and the library's are the same screen) that view is the
 * library's own: Mandarin's page held in a frame over the shelf
 * (/?embed=album, app/album-embed.js), its album view alone — the cover, its
 * heart and ⋯, Play now and Queue, credits, More by and the similar, About
 * this album and about the artist, every track with its time, and three
 * columns on a screen held sideways beyond a phone's. The frame is made the
 * first time an album is opened and kept, so the next opens at once; it plays
 * in the Shelf's room. Its Back (or ×, or Escape) turns the case back; an
 * artist, a label or a genre it asks for opens as the whole page. The back of
 * the case itself keeps the album's name and its barcode — the moment of the
 * turn.
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 * Loaded before shelf.js, which creates it with the page's hub (h):
 *
 *   const back = ShelfBack.create(h);
 *   back.backHTML(a), back.setOpen(a, el), back.zoneIs(zone)
 */
(() => {
  "use strict";

  /** @param {any} h */
  function create(h) {
    const { $, esc, hash, rng } = h;
    const ov = $("#open"), body = $("#open-body");

    function barcode(seed) {
      const r = rng(seed); const stops = []; let x = 0, k = 0;
      while (x < 100) { const w = 0.8 + r() * 2.6; stops.push(`${k++ % 2 ? "#fff" : "#111"} ${x.toFixed(1)}% ${(x + w).toFixed(1)}%`); x += w; }
      return `linear-gradient(90deg, ${stops.join(",")})`;
    }
    /** The album the view shows, or null while it is closed. @type {any} */
    let openA = null;
    /** @type {any} */
    let hideTimer = 0;
    // its label, catalogue number and kinds (v1.9.67), and its year (t5)
    const lineOf = (a) => [h.pick ? h.pick.lineOf(a) : "", a.y].filter(Boolean).join(" · ");

    // The back of the case: the album's name, its facts and a barcode — what
    // the turn shows for a moment.
    function backHTML(a) {
      const line = lineOf(a);
      return `<div class="bk"><div class="bk-ar">${esc(a.a)}</div><div class="bk-ti">${esc(a.t)}</div>${line ? `<div class="bk-lab">${esc(line)}</div>` : ""}
        <div class="bk-foot"><span class="bk-bar" style="background:${barcode(hash(a.t + a.a))}"></span><span class="bk-cat">Tap to turn back</span></div></div>`;
    }

    // ---- The library's album view, in its frame (item 218) ----------------------
    /** @type {HTMLIFrameElement | null} */
    let frame = null;
    let ready = false;
    /** The album still to be sent to the frame (it opens it once up), or null. @type {any} */
    let pending = null;
    function send() {
      if (!frame || !ready || !pending || !frame.contentWindow) return;
      const zone = h.player ? h.player.zoneId() : null;
      frame.contentWindow.postMessage({ type: "musicd-album", album: pending, zone }, location.origin);
      pending = null;
    }
    /** @param {any} a */
    function show(a) {
      pending = { offset: a.o, title: a.t, subtitle: a.a, image_key: a.k || null };
      if (!frame) {
        frame = document.createElement("iframe");
        frame.className = "ov-frame";
        frame.title = "Album";
        frame.dataset.parity = "shelf.album";
        frame.src = "/?embed=album";
        body.appendChild(frame);
        ov.classList.add("loading");
      }
      send();
    }
    window.addEventListener("message", (e) => {
      if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
      const m = e.data || {};
      if (m.type === "musicd-album-ready") { ready = true; ov.classList.remove("loading"); send(); }
      else if (m.type === "musicd-album-closed") { if (openA) close(); }
      // An artist, a label or a genre: the whole page, opened there (app/album-embed.js reads it).
      else if (m.type === "musicd-go" && typeof m.what === "string" && typeof m.arg === "string") {
        location.href = "/?go=" + encodeURIComponent(m.what) + "&arg=" + encodeURIComponent(m.arg);
      }
    });

    // ---- The view, opened and closed (v1.9.67-t5) ----------------------------------
    // The view is open exactly while a case is turned over at the front
    // (shelf.js render says which album, every frame, and its case where it
    // is drawn): it grows out of that case — scaled up from where the case
    // stands, a moment into the turn (shelf-open.css) — and shrinks back into
    // it when the case turns back. Another album at the front while open (a
    // key's step) is opened in its place.
    function setOpen(a, el) {
      if (a) {
        if (openA === a) return;
        const fresh = !openA;
        openA = a;
        show(a);
        if (!fresh) return;
        clearTimeout(hideTimer);
        ov.classList.remove("hidden", "on");
        const o = ov.getBoundingClientRect(), r = el ? el.getBoundingClientRect() : o;
        ov.style.transformOrigin = `${(r.left + r.width / 2 - o.left).toFixed(1)}px ${(r.top + r.height / 2 - o.top).toFixed(1)}px`;
        void ov.offsetWidth;   // the start of the transition seen, not skipped
        ov.classList.add("on");
      } else if (openA) {
        openA = null;
        ov.classList.remove("on");
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => { if (!openA) ov.classList.add("hidden"); }, 420);
      }
    }
    // Closed from the view (its Back): the case turns back, and the keys are the shelf's again.
    const close = () => { if (h.flippedV !== null) { h.flippedV = null; h.kick(); } h.stage.focus({ preventScroll: true }); };

    /** The Shelf's room changed: the album view's too, if it is up. @param {string | null} zone */
    function zoneIs(zone) {
      if (frame && ready && zone && frame.contentWindow) frame.contentWindow.postMessage({ type: "musicd-zone", zone }, location.origin);
    }

    return { backHTML, setOpen, zoneIs };
  }

  /** @type {any} */ (window).ShelfBack = { create };
})();
