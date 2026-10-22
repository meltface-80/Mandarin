/* The page's core: who an artist is, at the head of their page (bug list item 131; artist-view.js opens the page). */
// Over their albums: their picture, round and centred (their own once the
// server has found one, item 129, else the biography's portrait); what they
// are, where from and when; their links as pills; the biography clipped with
// Show more and where it is from (/api/artist-bio, as before); then a band's
// members or a person's bands, a row of round pictures that scrolls sideways,
// each opening their own page. Under their albums, those of the library's
// they are credited on beyond their own, saying as what. Decorative, as the
// biography always was: a failure leaves the album grid as it is, and a page
// left before an answer comes ([alive] false) draws nothing.
(function artistAbout() {
  "use strict";
  const w = /** @type {any} */ (window);
  const LINKS = [["official", "Official site"], ["wikipedia", "Wikipedia"], ["wikidata", "Wikidata"], ["discogs", "Discogs"], ["allmusic", "AllMusic"],
    ["bandcamp", "Bandcamp"], ["lastfm", "Last.fm"], ["soundcloud", "SoundCloud"], ["youtube", "YouTube"]];

  /** Their years: "1982–1987"; a person's "born 1946"; a band "since 1982", or "1982–" ended unsaid (ArtistAbout.kt's years). @param {any} b @param {any} e @param {boolean} ended @param {any} type */
  function years(b, e, ended, type) {
    const from = b ? String(b).slice(0, 4) : null, to = e ? String(e).slice(0, 4) : null;
    if (from && to) return from + "–" + to;
    if (from && type === "Person") return ended ? from + "–" : "born " + from;
    if (from) return ended ? from + "–" : "since " + from;
    if (to) return "until " + to;
    return null;
  }
  /** What they are, where from, when ("Band · Manchester · 1982–1987"). @param {any} a */
  function facts(a) {
    const kind = { Group: "Band", Orchestra: "Orchestra", Choir: "Choir" }[a.type] || null;
    return [kind, a.area, years(a.begin, a.end, !!a.ended, a.type)].filter(Boolean).join(" · ");
  }

  /** One of a band's members or a person's bands. @param {any} m */
  function stint(m) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "artist-stint"; btn.dataset.parity = "artist.member";
    btn.setAttribute("aria-label", m.name);
    const art = document.createElement("div");
    art.className = "artist-stint-art"; art.dataset.parity = "artist.member-art";
    const letter = () => { const l = document.createElement("span"); l.textContent = String(m.name || "?").trim().charAt(0).toUpperCase(); art.appendChild(l); };
    if (m.photo_key) loadArt(art, m.photo_key, 300, (img) => { img.remove(); letter(); }); else letter();
    const name = document.createElement("div"); name.className = "artist-stint-name"; name.dataset.parity = "artist.member-name"; name.textContent = m.name;
    btn.appendChild(art); btn.appendChild(name);
    const said = [(m.roles || []).join(", "), years(m.begin, m.end, !!m.ended, null)].filter(Boolean).join(" · ");
    if (said) { const l = document.createElement("div"); l.className = "artist-stint-line"; l.dataset.parity = "artist.member-line"; l.textContent = said; btn.appendChild(l); }
    btn.addEventListener("click", () => { if (w.__showArtistAlbums) w.__showArtistAlbums(m.name); });
    return btn;
  }
  /** @param {string} title @param {any[]} list */
  function stints(title, list) {
    const box = document.createElement("div");
    box.className = "artist-stints";
    const hdr = document.createElement("div");
    hdr.className = "artist-section-header"; hdr.dataset.parity = "artist.section"; hdr.textContent = title;
    const row = document.createElement("div");
    row.className = "artist-stint-row";
    for (const m of list) row.appendChild(stint(m));
    box.appendChild(hdr); box.appendChild(row);
    return box;
  }

  /**
   * The head over [grid]'s albums, and what they are credited on under them. [pin] is one of their own album
   * titles, for the biography's lookup; [shown] the albums already on the page (offsets); [alive] false once the
   * page has been left or another artist's opened.
   * @param {string} name @param {string} pin @param {HTMLElement} grid @param {() => boolean} alive @param {Set<number>} shown
   */
  function renderArtistHead(name, pin, grid, alive, shown) {
    const head = document.createElement("div");
    head.className = "artist-bio-head";
    const top = document.createElement("div");
    top.className = "artist-hero";
    head.appendChild(top);
    grid.prepend(head);
    let avatar = /** @type {HTMLImageElement | null} */ (null), own = false;
    /** @param {string} src @param {boolean} theirs */
    const picture = (src, theirs) => {
      if (!src || (own && !theirs)) return;
      if (!avatar) {
        avatar = document.createElement("img");
        avatar.className = "artist-bio-avatar"; avatar.dataset.parity = "artist.avatar"; avatar.alt = "";
        avatar.onerror = () => { if (avatar) avatar.remove(); };
        top.prepend(avatar);
      }
      if (theirs) own = true;
      avatar.src = src;
    };

    // Who they are: the server may look them up there and then, for a few seconds.
    fetch("/api/artist?name=" + encodeURIComponent(name)).then(r => r.ok ? r.json() : null).then(a => {
      if (!a || !alive()) return;
      if (a.photo_key) picture("/api/image/" + encodeURIComponent(a.photo_key) + "?size=600", true);
      const said = facts(a);
      if (said) { const f = document.createElement("div"); f.className = "artist-facts"; f.dataset.parity = "artist.facts"; f.textContent = said; top.appendChild(f); }
      const links = (a.mbid ? [["MusicBrainz", "https://musicbrainz.org/artist/" + a.mbid]] : [])
        .concat(LINKS.filter(([k]) => a.links && a.links[k]).map(([k, label]) => [label, a.links[k]]));
      if (links.length) {
        const row = document.createElement("div");
        row.className = "artist-links";
        for (const [label, url] of links) {
          const l = document.createElement("a");
          l.className = "artist-link"; l.dataset.parity = "artist.link";
          l.href = url; l.target = "_blank"; l.rel = "noopener noreferrer"; l.textContent = label;
          row.appendChild(l);
        }
        top.appendChild(row);
      }
      let after = head;
      for (const [title, list] of [["Members", a.members], ["Member of", a.member_of]]) {
        if (!list || !list.length) continue;
        const box = stints(title, list);
        after.after(box); after = box;
      }
      const credited = (a.credited_on || []).filter((/** @type {any} */ al) => !shown.has(al.offset));
      if (credited.length) {
        const hdr = document.createElement("div");
        hdr.className = "artist-section-header"; hdr.dataset.parity = "artist.section"; hdr.textContent = "Credited on";
        grid.appendChild(hdr);
        for (const al of credited) {
          const tile = w.__keyArtistTile(w.__buildAlbumTile(al));
          const by = tile.querySelector(".album-artist");
          const as = (al.roles || []).join(", ");
          if (by && as) by.textContent = [by.textContent, as].filter(Boolean).join(" · ");
          grid.appendChild(tile);
        }
      }
    }).catch(() => { /* decorative: the albums stand alone */ });

    // The biography, as before: one of their own albums pins who they are.
    fetch("/api/artist-bio?artist=" + encodeURIComponent(name) + "&album=" + encodeURIComponent(pin || "")).then(r => r.ok ? r.json() : null).then(j => {
      const b = j && j.bio;
      if (!b || !b.text || !alive()) return;
      if (b.image) picture(b.image, false);
      const body = document.createElement("div");
      body.className = "artist-bio-body";
      const text = document.createElement("div");
      text.className = "bio-text"; text.dataset.parity = "artist.bio";
      text.dataset.clipped = "true";
      text.textContent = b.text;
      const foot = document.createElement("div");
      foot.className = "artist-bio-foot";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "bio-toggle hidden"; toggle.dataset.parity = "artist.bio-more";
      toggle.textContent = "Show more";
      const src = document.createElement("span");
      src.className = "artist-bio-src"; src.dataset.parity = "artist.bio-source";
      src.textContent = b.source ? "Bio: " + b.source : "";
      foot.appendChild(toggle); foot.appendChild(src);
      body.appendChild(text); body.appendChild(foot);
      head.appendChild(body);
      if (w.__setupBioToggle) w.__setupBioToggle(text, toggle);
    }).catch(() => { /* decorative: the albums stand alone */ });
  }
  w.__renderArtistHead = renderArtistHead;
})();
