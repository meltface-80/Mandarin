/* The page's core: the album view in three columns on a landscape screen beyond a phone's (item 214). */
// A desktop, a TV or a tablet held sideways (1000px wide and 600 tall at
// least, wider than tall; never a phone, either way round) has the album view
// over the whole screen in three columns, each scrolling on its own (the
// owner's, after LMS's Material skin): on the left the cover, the album's
// head and its buttons, its credits, more by the artist, what they appear on,
// similar artists and similar albums; in the middle About this album and
// about its artist, sized to fit it (each its own height, shortened together
// when they don't both fit) with Read more for the rest, which opens the
// whole of both in the column; on the right the tracks. The parts are moved
// into the columns while it applies, each leaving a mark where it was, and
// put back on the marks when it doesn't (a narrower window, a tablet turned
// upright, Now playing, the album closed), so the rest of the page finds them
// by their ids as before. The columns end above the mini player.
(function albumWide() {
  "use strict";
  const w = /** @type {any} */ (window);
  const modal = document.getElementById("album-modal");
  const body = modal && modal.querySelector(".modal-body");
  const bar = document.getElementById("mini-transport");
  if (!modal || !body || !window.matchMedia) return;
  const wideQ = window.matchMedia("(min-width: 1000px) and (min-height: 600px) and (orientation: landscape)");
  /** @type {[string, string[]][]} */
  const COLUMNS = [
    ["aw-left", [".modal-art", ".modal-head", "#modal-genres", "#modal-actions", "#album-credits", "#album-more-by",
      "#album-more-appears", "#album-lastfm-artists", "#album-lastfm-albums"]],
    ["aw-mid", ["#album-bio-section", "#album-artist-bio"]],
    ["aw-right", [".track-list-wrap"]],
  ];
  const cols = COLUMNS.map(([cls]) => {
    const c = document.createElement("div");
    c.className = "aw-col " + cls;
    return c;
  });
  /** @type {{ el: Element, mark: Comment }[]} */
  let moved = [];

  function into() {
    COLUMNS.forEach(([, sels], i) => {
      for (const sel of sels) {
        const el = body.querySelector(sel);
        if (!el) continue;
        const mark = document.createComment("album-wide: " + sel);
        el.replaceWith(mark);
        cols[i].appendChild(el);
        moved.push({ el, mark });
      }
    });
    for (const c of cols) body.appendChild(c);
  }
  function back() {
    for (const { el, mark } of moved) mark.replaceWith(el);
    moved = [];
    for (const c of cols) c.remove();
  }

  /* The columns' foot clear of the mini player, wherever it is: docked over a tablet's row, or a desktop's corner. */
  function foot() {
    if (!modal.classList.contains("album-wide")) { modal.style.removeProperty("--aw-foot"); return; }
    const shown = !!bar && !bar.classList.contains("hidden") && bar.offsetWidth > 0;
    const top = shown && bar ? bar.getBoundingClientRect().top : window.innerHeight;
    modal.style.setProperty("--aw-foot", Math.max(0, Math.round(window.innerHeight - top + 12)) + "px");
  }

  function apply() {
    const wide = wideQ.matches && !modal.classList.contains("hidden") && !modal.classList.contains("np-mode");
    if (wide && !moved.length) into();
    else if (!wide && moved.length) back();
    modal.classList.toggle("album-wide", wide);
    if (!wide) words.reset();
    foot();
    if (wide) { readBio(); fit(); }
  }

  // ---- The middle column fitted to the screen, Read more for the rest (the owner's; wide-words.js) ----
  const mid = cols[1];
  const words = fitWords(mid, ["#album-bio-section", "#album-artist-bio"].map((sel) => /** @type {HTMLElement} */ (document.querySelector(sel))).filter(Boolean),
    () => modal.classList.contains("album-wide"), "album.read-more");
  const fit = words.fit;

  // ---- About the album's artist (the middle column's second part) ----
  const bio = document.getElementById("album-artist-bio");
  const bioTitle = document.getElementById("album-artist-bio-title");
  const bioText = document.getElementById("album-artist-bio-text");
  const bioSrc = document.getElementById("album-artist-bio-source");
  /** @type {{ artist: string, album: string } | null} */
  let want = null;
  let had = "", seq = 0;
  /** The album opened (album-detail.js): its artist's biography read when the columns are shown. @param {string} artist @param {string} album */
  function albumArtistBio(artist, album) {
    want = { artist, album };
    had = ""; seq++;
    words.reset();
    if (bio) bio.classList.add("hidden");
    if (modal && modal.classList.contains("album-wide")) readBio();
  }
  function readBio() {
    if (!want || !want.artist || !bio || !bioText) return;
    const key = want.artist + "\u0000" + want.album;
    if (had === key) return;
    had = key;
    const mine = seq, artist = want.artist;
    const url = "/api/artist-bio?artist=" + encodeURIComponent(artist) + "&album=" + encodeURIComponent(want.album);
    const json = w.__artistJson ? w.__artistJson(url) : fetch(url).then((r) => (r.ok ? r.json() : null));
    json.then((/** @type {any} */ j) => {
      const b = j && j.bio;
      if (mine !== seq || !b || !b.text) return;
      if (bioTitle) bioTitle.textContent = "About " + artist;
      bioText.textContent = b.text;
      if (bioSrc) bioSrc.textContent = b.source ? "Bio: " + b.source : "";
      bio.classList.remove("hidden");
    }).catch(() => { /* decorative: the album view stands without it */ });
  }
  w.__albumArtistBio = albumArtistBio;

  // The album opened or closed, Now playing in and out, the window resized or turned, the player moved.
  new MutationObserver(apply).observe(modal, { attributes: true, attributeFilter: ["class"] });
  if (bar) new MutationObserver(foot).observe(bar, { attributes: true, attributeFilter: ["class", "style"] });
  window.addEventListener("resize", apply);
  if (wideQ.addEventListener) wideQ.addEventListener("change", apply); else if (wideQ.addListener) wideQ.addListener(apply);
  apply();
})();
