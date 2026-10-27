// @ts-check
/*
 * shelf-facets.js — the Shelf's Format and Favourites choices (item 208, a
 * user's request), beside Genres, Artists, Years, Labels and Types
 * (shelf-pick.js): each album is under one Format tile, as the server names it
 * ("16/44.1", "24/96 Multichannel", "DSD64 2CH", "MP3"; ShelfFormats.cs), the
 * tiles in the server's order; and one Favourites tile, a fan of their covers,
 * for the albums hearted.
 * Copyright (c) 2026 Lewis Menzies (Music Duck / MusicD)
 * Released under the MIT License. See the LICENSE file for details.
 *
 * Loaded before shelf-pick.js, which makes it with the page's hub:
 *
 *   const facets = ShelfFacets.create(h);
 *   facets.read(j, albums)          the list as the server sent it
 *   facets.passes(a, sel, skip)     whether an album is left by the choices made here
 *   facets.tiles(tab)               a tab's tiles (null: not one of these)
 *   facets.counts(tab, albums, passes), facets.labelOf(cat, id), facets.note(tab, n)
 *   facets.have(cat)                the ids the library has now, to let go of one that has gone
 *   facets.fanOf(name, keys)        three covers for a tile, spread through its albums (a genre's and a label's too)
 */
(() => {
  "use strict";

  /** @param {any} h */
  function create(h) {
    const { esc, imageUrl, hash, TICK } = h;
    /** @type {string[]} */
    let formats = [];         // the Format tiles' names, in their order
    /** @type {string[]} */
    let favFan = [];          // up to three image keys for the Favourites tile
    let favCount = 0;

    /** @param {string} name @param {string[]} keys */
    function fanOf(name, keys) {
      const out = [], step = Math.max(1, Math.floor(keys.length / 3)), start = hash(name) % Math.max(1, keys.length);
      for (let n = 0; n < Math.min(3, keys.length); n++) out.push(keys[(start + n * step) % keys.length]);
      return out;
    }

    /** @param {any} j @param {any[]} albums */
    function read(j, albums) {
      formats = Array.isArray(j.formats) ? j.formats : [];
      favCount = albums.filter((a) => a.fv).length;
      favFan = fanOf("Favourites", albums.filter((a) => a.fv && a.k).map((a) => a.k));
    }

    /** @param {any} a @param {any} sel @param {string} [skip] */
    function passes(a, sel, skip) {
      if (skip !== "format" && sel.format.size && !sel.format.has(a.q)) return false;
      if (skip !== "favourite" && sel.favourite.size && !a.fv) return false;
      return true;
    }

    /** @param {string} tab */
    function tiles(tab) {
      if (tab === "format") {
        return formats.length ? formats.map((f) => `<button class="tile t-decade t-format" type="button" data-cat="format" data-id="${esc(f)}" aria-pressed="false" data-parity="shelf-choices.format">
          <span class="ch">${esc(f)}</span><span class="t-count"></span><span class="tick">${TICK}</span></button>`).join("")
          : '<p class="tiles-msg" data-parity="shelf-choices.message">Nothing is known yet of your albums’ files, so there are no formats to choose from.</p>';
      }
      if (tab === "favourite") {
        return favCount ? `<button class="tile t-genre t-favourite" type="button" data-cat="favourite" data-id="yes" aria-pressed="false" aria-label="Favourites" data-parity="shelf-choices.favourite">
            <span class="fan" aria-hidden="true">${favFan.map((k, n) => `<span class="m m${n}"><img src="${imageUrl(k, 500)}" alt="" loading="lazy" decoding="async"></span>`).join("")}</span>
            <span class="t-row"><span class="t-name">Favourites</span><span class="t-count"></span></span><span class="tick">${TICK}</span></button>`
          : '<p class="tiles-msg" data-parity="shelf-choices.message">No favourites yet: tap the heart on an album’s page and it is here.</p>';
      }
      return null;
    }

    /** How many albums each tile would bring, the other choices kept. @param {string} tab @param {any[]} albums @param {(a: any, skip: string) => boolean} pass */
    function counts(tab, albums, pass) {
      /** @type {Record<string, number>} */
      const n = {};
      for (const a of albums) {
        if (!pass(a, tab)) continue;
        const id = tab === "format" ? a.q : a.fv ? "yes" : null;
        if (id) n[id] = (n[id] || 0) + 1;
      }
      return n;
    }

    /** @param {string} cat @param {string} id */
    const labelOf = (cat, id) => (cat === "favourite" ? "Favourites" : id);

    /** The line on the tab: how many chosen, or what to do. @param {string} tab @param {number} n */
    const note = (tab, n) => (tab === "favourite" ? (n ? "Only your favourites" : "Tap to show only the albums you have hearted.")
      : n ? `${n} format${n === 1 ? "" : "s"} chosen` : "Tap formats. Choose as many as you like.");

    /** @param {string} cat */
    const have = (cat) => new Set(cat === "format" ? formats : favCount ? ["yes"] : []);

    return { read, passes, tiles, counts, labelOf, note, have, fanOf };
  }

  /** @type {any} */ (window).ShelfFacets = { create };
})();
