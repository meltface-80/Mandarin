/* The page's core: an album's credits under its tracks (bug list item 132). */
// Who played, sang, wrote and made it (/api/album/credits, item 129), in the
// server's order: those who play first, then who wrote it, who made the
// record, its art. Each a row: a round picture (theirs once found, else
// their first letter), the name, and their parts with which tracks when
// they aren't on every one. Eight at first, More for the rest; a tap opens
// their page, whose Back comes back here. Hidden until there is something to
// show; an answer for an album no longer open is dropped. The phone's own
// music has none.
(function albumCredits() {
  "use strict";
  const SHOWN = 8;
  const w = /** @type {any} */ (window);
  const sec = document.getElementById("album-credits");
  if (!sec) return;
  const list = /** @type {HTMLElement} */ (sec.querySelector(".credits-list"));
  const toggle = /** @type {HTMLElement} */ (sec.querySelector(".more-toggle"));
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    for (const el of list.querySelectorAll(".more-extra")) el.classList.toggle("hidden", !open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.textContent = open ? "Less" : "More";
  });

  /** Which tracks, runs of three or more as a range: "track 4", "tracks 1, 2", "tracks 1–3, 5" (core's AlbumCredits.trackList). @param {number[]} tracks */
  function trackList(tracks) {
    const t = [...new Set(tracks)].sort((a, b) => a - b);
    if (!t.length) return "";
    const parts = [];
    for (let i = 0; i < t.length;) {
      let j = i;
      while (j + 1 < t.length && t[j + 1] === t[j] + 1) j++;
      if (j - i >= 2) parts.push(t[i] + "–" + t[j]); else for (let k = i; k <= j; k++) parts.push(String(t[k]));
      i = j + 1;
    }
    return (t.length === 1 ? "track " : "tracks ") + parts.join(", ");
  }

  /** One of them: the picture, the name over their parts. @param {any} c */
  function row(c) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "credit"; btn.dataset.parity = "album.credit";
    btn.setAttribute("aria-label", c.name);
    const pic = document.createElement("div");
    pic.className = "credit-pic"; pic.dataset.parity = "album.credit-art";
    const initial = document.createElement("span");
    initial.textContent = (String(c.name || "").trim().charAt(0) || "?").toUpperCase();
    pic.appendChild(initial);
    if (c.photo_key) loadArt(pic, c.photo_key, 120, (img) => img.remove());
    const text = document.createElement("div");
    text.className = "credit-text";
    const name = document.createElement("div");
    name.className = "credit-name"; name.dataset.parity = "album.credit-name"; name.textContent = c.name;
    text.appendChild(name);
    const said = [(c.roles || []).join(", "), Array.isArray(c.tracks) ? trackList(c.tracks) : ""].filter(Boolean).join(" · ");
    if (said) { const r = document.createElement("div"); r.className = "credit-roles"; r.dataset.parity = "album.credit-roles"; r.textContent = said; text.appendChild(r); }
    btn.append(pic, text);
    btn.addEventListener("click", () => {
      // As the album view's own artist links: its Back comes back here.
      const fromAlbum = currentAlbum ? { album: currentAlbum, opts: { source: currentSource, zoneId: currentSourceZoneId, filter: currentDetailFilter } } : null;
      closeModal();
      if (w.__showArtistAlbums) w.__showArtistAlbums(c.name, { fromAlbum });
    });
    return btn;
  }

  function reset() {
    sec.classList.add("hidden");
    list.textContent = "";
    toggle.classList.add("hidden"); toggle.setAttribute("aria-expanded", "false"); toggle.textContent = "More";
  }

  /** The credits of [album], asked once its page is up. @param {any} album */
  async function show(album) {
    if (!album || album.offset == null || isPhoneAlbum(album)) return;
    const modal = document.getElementById("album-modal");
    const mine = () => album === currentAlbum && !!modal && !modal.classList.contains("hidden") && !modal.classList.contains("np-mode");
    let j;
    try { const r = await fetch("/api/album/credits?offset=" + encodeURIComponent(album.offset)); j = r.ok ? await r.json() : null; }
    catch (e) { return; /* the credits are extra: the page stands without them */ }
    const credits = (j && Array.isArray(j.credits) ? j.credits : []).filter((/** @type {any} */ c) => c && c.name);
    if (!mine() || !credits.length) return;
    list.textContent = "";
    credits.forEach((c, i) => {
      const el = row(c);
      if (i >= SHOWN) el.classList.add("more-extra", "hidden");
      list.appendChild(el);
    });
    toggle.classList.toggle("hidden", credits.length <= SHOWN);
    sec.classList.remove("hidden");
  }

  w.__albumCredits = show;
  w.__resetAlbumCredits = reset;
})();
