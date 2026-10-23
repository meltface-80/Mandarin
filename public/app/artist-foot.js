/* The page's core: the foot of an artist's page and what it last had (bug list item 140; artist-about.js draws the head). */
// Under all their albums: similar artists (item 137), a row of round
// pictures each opening their page, then similar albums, a row of covers each
// opening the album (the library's) or its Last.fm page. And the answers an
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

  /** A similar album: its cover, the title and who by; "Last.fm ↗" under one the library hasn't. @param {any} al */
  function album(al) {
    const own = al.album || null;
    const title = (own && own.title) || al.title || "";
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "artist-similar-album"; btn.dataset.parity = "artist.similar-album";
    btn.setAttribute("aria-label", title);
    const art = document.createElement("div");
    art.className = "artist-similar-album-art"; art.dataset.parity = "artist.similar-album-art";
    const key = (own && own.image_key) || al.image_key;
    if (key) loadArt(art, key, 300, (img) => { img.remove(); });
    const t = document.createElement("div"); t.className = "artist-similar-album-title"; t.dataset.parity = "artist.similar-album-title"; t.textContent = title;
    const by = document.createElement("div"); by.className = "artist-similar-album-artist"; by.dataset.parity = "artist.similar-album-artist"; by.textContent = al.artist || "";
    btn.append(art, t, by);
    if (!own && al.url) { const fm = document.createElement("div"); fm.className = "artist-similar-album-artist artist-similar-album-site"; fm.dataset.parity = "artist.similar-album-artist"; fm.textContent = "Last.fm ↗"; btn.appendChild(fm); }
    btn.addEventListener("click", () => {
      if (own) openAlbum(own, { filter: null });
      else if (al.url) window.open(al.url, "_blank", "noopener");
    });
    return btn;
  }

  /** A row under its heading, put in [slot]. @param {HTMLElement} slot @param {string} title @param {HTMLElement[]} items */
  function fill(slot, title, items) {
    const row = document.createElement("div");
    row.className = "artist-stint-row";
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
      const list = (j && Array.isArray(j.albums) ? j.albums : []).filter((/** @type {any} */ x) => x && (x.title || x.album));
      if (list.length && alive()) fill(albums, "Similar albums", list.map(album));
    }).catch(() => { /* decorative */ });
  }

  w.__artistJson = artistJson;
  w.__renderArtistFoot = renderArtistFoot;
})();
