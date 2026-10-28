/* The page's core: Now playing in three columns on a landscape screen beyond a phone's (item 216). */
// As the album view's (album-wide.js, item 214; the owner chose "the same"):
// a desktop, a TV or a tablet held sideways has Now playing in three columns.
// On the left the cover over the playing track, its progress and transport,
// where they were; in the middle About this album and about its artist,
// fitted to the screen with Read more (wide-words.js); on the right the
// playing album's tracks, the one playing lit, a tap playing from it in the
// zone. The album is the zone's (/api/album/now-playing), read again when what
// plays moves on to another; its review and its artist's biography as the
// album view has them. Not on the Queue tab, a tablet upright or a phone.
(function npWide() {
  "use strict";
  const w = /** @type {any} */ (window);
  const modal = document.getElementById("album-modal");
  const body = modal && modal.querySelector(".modal-body");
  const bar = document.getElementById("mini-transport");
  if (!modal || !body || !window.matchMedia) return;
  const wideQ = window.matchMedia("(min-width: 1000px) and (min-height: 600px) and (orientation: landscape)");

  const mid = document.createElement("div");
  mid.className = "np-col np-mid";
  mid.innerHTML =
    '<div class="bio-section hidden" id="np-about" data-parity="now-playing.review"><h3 class="section-label">About this album</h3>' +
      '<div class="bio-text"></div><div class="artist-bio-src"></div></div>' +
    '<div class="bio-section hidden" id="np-artist" data-parity="now-playing.artist-bio"><h3 class="section-label">About the artist</h3>' +
      '<div class="bio-text"></div><div class="artist-bio-src"></div></div>';
  const right = document.createElement("div");
  right.className = "np-col np-right";
  right.innerHTML = '<h3 class="section-label" id="np-tracks-head" data-parity="now-playing.tracks-head"></h3><ol class="track-list" id="np-tracks"></ol>';
  const about = /** @type {HTMLElement} */ (mid.children[0]), artistBio = /** @type {HTMLElement} */ (mid.children[1]);
  const head = /** @type {HTMLElement} */ (right.children[0]), list = /** @type {HTMLElement} */ (right.children[1]);
  const isWide = () => modal.classList.contains("np-wide");
  const words = fitWords(mid, [about, artistBio], isWide, "now-playing.read-more");

  /** @param {HTMLElement} section @param {string} text @param {string} from */
  function say(section, text, from) {
    /** @type {HTMLElement} */ (section.querySelector(".bio-text")).textContent = text;
    /** @type {HTMLElement} */ (section.querySelector(".artist-bio-src")).textContent = from;
    section.classList.toggle("hidden", !text);
  }

  // ---- The playing album: read when it changes ----
  /** @type {any} */
  let album = null;
  let key = "", seq = 0;
  const zoneId = () => (typeof selectedZoneId === "string" ? selectedZoneId : "");
  function readAlbum() {
    const np = w.__getCurrentNp ? w.__getCurrentNp() : null;
    const k = np ? zoneId() + "\u0000" + (np.line3 || "") + "\u0000" + (np.line2 || "") : "";
    if (k === key) { light(); return; }
    key = k; seq++;
    const mine = seq;
    album = null; head.textContent = ""; list.innerHTML = "";
    say(about, "", ""); say(artistBio, "", ""); words.reset();
    if (!np || !zoneId()) return;
    fetch("/api/album/now-playing?zone=" + encodeURIComponent(zoneId()), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const a = j && j.album;
        if (mine !== seq || !a || typeof a.offset !== "number") return null;
        album = a;
        head.textContent = a.title || "";
        const id = "&title=" + encodeURIComponent(a.title || "") + "&subtitle=" + encodeURIComponent(a.subtitle || "");
        readWords(a, mine);
        return fetch("/api/album?offset=" + a.offset + id).then((r) => (r.ok ? r.json() : null));
      })
      .then((j) => { if (j && mine === seq) drawTracks(j.tracks || []); })
      .catch(() => { /* the left column stands alone */ });
  }
  /** Its review and its artist's biography, as the album view asks for them. @param {any} a @param {number} mine */
  function readWords(a, mine) {
    const q = new URLSearchParams({ title: a.title || "", artist: a.subtitle || "" });
    fetch("/api/album/extras?" + q).then((r) => (r.ok ? r.json() : null)).then((j) => {
      const d = j && j.album;
      if (mine === seq && d && d.description) say(about, d.description, d.source ? "Review: " + d.source : "");
    }).catch(() => { /* decorative */ });
    const artist = a.subtitle || "";
    if (!artist) return;
    const url = "/api/artist-bio?artist=" + encodeURIComponent(artist) + "&album=" + encodeURIComponent(a.title || "");
    const json = w.__artistJson ? w.__artistJson(url) : fetch(url).then((r) => (r.ok ? r.json() : null));
    json.then((/** @type {any} */ j) => {
      const b = j && j.bio;
      if (mine !== seq || !b || !b.text) return;
      /** @type {HTMLElement} */ (artistBio.querySelector(".section-label")).textContent = "About " + artist;
      say(artistBio, b.text, b.source ? "Bio: " + b.source : "");
    }).catch(() => { /* decorative */ });
  }
  /** @param {any[]} tracks */
  function drawTracks(tracks) {
    list.innerHTML = "";
    tracks.forEach((t, i) => {
      const li = document.createElement("li");
      li.className = "t-row"; li.dataset.parity = "now-playing.album-track";
      li.dataset.trackId = t.track_id == null ? "" : String(t.track_id);
      li.dataset.title = t.title || "";
      const tx = document.createElement("div"); tx.className = "t-text";
      const ti = document.createElement("span"); ti.className = "t-title"; ti.textContent = t.title || "";
      tx.appendChild(ti); li.appendChild(tx);
      const [, len] = splitTrackLength(t.subtitle);
      if (len) { const ln = document.createElement("span"); ln.className = "t-len"; ln.textContent = len; li.appendChild(ln); }
      li.addEventListener("click", () => play(t, i));
      list.appendChild(li);
    });
    light();
  }
  /** The track playing lit: by its id, else by its name. */
  function light() {
    const np = w.__getCurrentNp ? w.__getCurrentNp() : null;
    const id = np && np.track_id != null ? String(np.track_id) : "";
    const name = np ? String(np.line1 || "").trim().toLowerCase() : "";
    const rows = /** @type {HTMLElement[]} */ ([...list.children]);
    const byId = id !== "" && rows.some((li) => li.dataset.trackId === id);
    for (const li of rows) li.classList.toggle("is-now-track", byId ? li.dataset.trackId === id : name !== "" && (li.dataset.title || "").trim().toLowerCase() === name);
  }
  /** A track tapped: played from it, now, in the zone. @param {any} t @param {number} i */
  async function play(t, i) {
    if (!album || !zoneId()) return;
    try {
      const r = await fetch("/api/play-track", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offset: album.offset, track: i, title: t.title || "", zone_or_output_id: zoneId(), kind: "play_now",
          album_title: album.title || "", album_subtitle: album.subtitle || "" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "HTTP " + r.status);
    } catch (e) {
      if (w.__showToast) w.__showToast(e && e.message ? e.message : "Couldn't play it", "error");
    }
  }

  // ---- In and out: Now playing's own tab on a wide screen ----
  function apply() {
    const wide = wideQ.matches && !modal.classList.contains("hidden") && modal.classList.contains("np-mode") && modal.classList.contains("tab-album");
    if (wide && !mid.parentNode) { body.appendChild(mid); body.appendChild(right); }
    else if (!wide && mid.parentNode) { mid.remove(); right.remove(); key = ""; words.reset(); }
    if (modal.classList.contains("np-wide") !== wide) modal.classList.toggle("np-wide", wide);
    if (wide) { readAlbum(); words.fit(); }
  }
  new MutationObserver(apply).observe(modal, { attributes: true, attributeFilter: ["class"] });
  // What plays moved on (the mini player's title or its Play/Pause): the album read again, or the lit track moved.
  if (bar) new MutationObserver(() => { if (isWide()) readAlbum(); })
    .observe(bar, { subtree: true, childList: true, characterData: true });
  if (wideQ.addEventListener) wideQ.addEventListener("change", apply); else if (wideQ.addListener) wideQ.addListener(apply);
  apply();
})();
