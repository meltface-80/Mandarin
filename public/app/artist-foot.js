/* The page's core: the foot of an artist's page and what it last had (bug list item 140; artist-about.js draws the head). */
// Under all their albums: similar artists (item 137), a row of round
// pictures each opening their page, then similar albums, Home's row of album tiles each
// opening the album, the library's alone (the server's). And the answers an
// artist's page was drawn from, kept a quarter of an hour, so a page opened
// again is drawn at once as it was, its picture with it (the browser keeps the
// pictures). Decorative, as the head is: a failure leaves the albums as they are.
(function artistFoot() {
  "use strict";
  const w = /** @type {any} */ (window);
  const KEEP_MS = 15 * 60 * 1000, KEPT_MAX = 150;
  /** @type {Map<string, { at: number, answer: Promise<any> }>} */
  const kept = new Map();

  /**
   * [url]'s JSON, as last answered when that was under a quarter of an hour ago; else asked for, and kept once it
   * answers (a failure isn't kept: the next opening asks again). Rejects with "HTTP n" or the network's error.
   * @param {string} url @returns {Promise<any>}
   */
  function artistJson(url) {
    const k = kept.get(url);
    if (k && Date.now() - k.at < KEEP_MS) { kept.delete(url); kept.set(url, k); return k.answer; }
    const answer = fetch(url).then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    kept.delete(url);
    kept.set(url, { at: Date.now(), answer });
    while (kept.size > KEPT_MAX) kept.delete(/** @type {string} */ (kept.keys().next().value));
    answer.catch(() => { const now = kept.get(url); if (now && now.answer === answer) kept.delete(url); });
    return answer;
  }

  /** A section's small heading. @param {string} text */
  function header(text) {
    const hdr = document.createElement("div");
    hdr.className = "artist-section-header"; hdr.dataset.parity = "artist.section"; hdr.textContent = text;
    return hdr;
  }

  /** A similar act: their picture (or first letter) in a circle over the name. @param {any} x */
  function act(x) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "artist-stint"; btn.dataset.parity = "artist.similar";
    btn.setAttribute("aria-label", x.name);
    const art = document.createElement("div");
    art.className = "artist-stint-art"; art.dataset.parity = "artist.similar-art";
    const letter = () => { const l = document.createElement("span"); l.textContent = String(x.name).trim().charAt(0).toUpperCase(); art.appendChild(l); };
    if (x.photo_key) loadArt(art, x.photo_key, 300, (img) => { img.remove(); letter(); }); else letter();
    const nm = document.createElement("div"); nm.className = "artist-stint-name"; nm.dataset.parity = "artist.similar-name"; nm.textContent = x.name;
    btn.append(art, nm);
    btn.addEventListener("click", () => { if (w.__showArtistAlbums) w.__showArtistAlbums(x.name); });
    return btn;
  }

  /**
   * A similar album, the library's (the server sends no other), as an album tile (buildAlbumTile: the grid's and
   * Home's cover, badges, title and artist), who by under the title. A tap opens the album.
   * @param {any} al
   */
  function album(al) {
    const own = al.album;
    const shown = { ...own, subtitle: own.subtitle || al.artist || "" };
    const open = () => openAlbum(own, { filter: null });
    // Keyed as the grid's tiles (their badges' keys), then as a similar album's.
    const btn = /** @type {HTMLElement} */ (w.__keyArtistTile(w.__buildAlbumTile(shown, open, { selectable: false })));
    btn.classList.add("artist-similar-album"); btn.dataset.parity = "artist.similar-album";
    btn.setAttribute("aria-label", shown.title);
    const keys = { ".album-art-wrap": "artist.similar-album-art", ".album-title": "artist.similar-album-title", ".album-artist": "artist.similar-album-artist" };
    for (const [sel, key] of Object.entries(keys)) { const el = /** @type {HTMLElement|null} */ (btn.querySelector(sel)); if (el) el.dataset.parity = key; }
    return btn;
  }

  /** A row under its heading, put in [slot]: [tiles], Home's row of album tiles. @param {HTMLElement} slot @param {string} title @param {HTMLElement[]} items @param {boolean=} tiles */
  function fill(slot, title, items, tiles) {
    const row = document.createElement("div");
    row.className = tiles ? "home-carousel home-carousel-1row artist-overview-row" : "artist-stint-row";
    row.append(...items);
    slot.replaceChildren(header(title), row);
    slot.classList.remove("hidden");
  }

  /**
   * Similar artists and similar albums for [name], into [tail] (the last thing in the album grid), in that order
   * whichever answers first; [alive] false once the page has been left or another artist's opened.
   * @param {string} name @param {HTMLElement} tail @param {() => boolean} alive
   */
  function renderArtistFoot(name, tail, alive) {
    const acts = document.createElement("div"), albums = document.createElement("div");
    acts.className = "artist-stints artist-similar hidden";
    albums.className = "artist-stints artist-similar-albums hidden";
    tail.append(acts, albums);
    const q = encodeURIComponent(name);
    artistJson("/api/artist/similar?name=" + q).then(j => {
      const list = (j && Array.isArray(j.artists) ? j.artists : []).filter((/** @type {any} */ x) => x && x.name);
      if (list.length && alive()) fill(acts, "Similar artists", list.map(act));
    }).catch(() => { /* decorative */ });
    artistJson("/api/artist/similar-albums?name=" + q).then(j => {
      const list = (j && Array.isArray(j.albums) ? j.albums : []).filter((/** @type {any} */ x) => x && x.album);
      if (list.length && alive()) fill(albums, "Similar albums", list.map(album), true);
    }).catch(() => { /* decorative */ });
  }

  /** The library changed (item 357, library-mark.js): an artist's albums and who they are asked afresh when their page
      next opens, an album deleted from the folders no longer on it; what other services said of them is kept. */
  function artistKeptStale() {
    for (const url of [...kept.keys()]) if (url.startsWith("/api/artist-albums?") || url.startsWith("/api/artist?")) kept.delete(url);
  }

  w.__artistJson = artistJson;
  w.__artistKeptStale = artistKeptStale;
  w.__renderArtistFoot = renderArtistFoot;
})();
