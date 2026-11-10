/* The page's core: who an artist is, at the head of their page (bug list item 131; artist-view.js opens the page). */
// Over the tabs (artist-tabs.js): their picture, round and centred
// (their own once the server has found one, item 129, else the biography's
// portrait); what they are, where from and when; their genres; Play and
// Shuffle. No links (the owner never used them). About's: the
// biography clipped with Show more and where it is from (/api/artist-bio),
// asked for only when About is opened or for a portrait the server hasn't;
// then a band's members or a person's bands, a row of round pictures that
// scrolls sideways under its heading (a tap on it folds them), each opening
// their own page. Discography's, after their albums: their bands' albums from
// their years in them (item 133), then those of the library's they are
// credited on beyond these, saying as what. Overview's: similar artists and
// albums (artist-foot.js), always last. Answers come through __artistJson, so
// a page opened again is drawn at once from what it last had. Decorative, as
// the biography always was: a failure leaves the albums as they are, and a
// page left before an answer comes ([alive] false) draws nothing.
(function artistAbout() {
  "use strict";
  const w = /** @type {any} */ (window);

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

  /** A section's small heading. @param {string} text */
  function header(text) {
    const hdr = document.createElement("div");
    hdr.className = "artist-section-header"; hdr.dataset.parity = "artist.section"; hdr.textContent = text;
    return hdr;
  }
  /** [el], Discography's (style.css shows it on that tab alone). @param {HTMLElement} el */
  function disc(el) { el.classList.add("artist-disc"); return el; }

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
  /** Under the heading, which says how many; a tap on it folds or opens them (item 140; open on About). @param {string} title @param {any[]} list */
  function stints(title, list) {
    const box = document.createElement("div");
    box.className = "artist-stints";
    const hdr = document.createElement("button");
    hdr.type = "button"; hdr.className = "artist-section-header artist-stints-toggle"; hdr.dataset.parity = "artist.stints-toggle";
    hdr.setAttribute("aria-label", title); hdr.setAttribute("aria-expanded", "true");
    hdr.innerHTML = '<span></span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    /** @type {HTMLElement} */ (hdr.firstChild).textContent = title + " · " + list.length;
    const row = document.createElement("div");
    row.className = "artist-stint-row";
    for (const m of list) row.appendChild(stint(m));
    hdr.addEventListener("click", () => {
      const open = box.classList.toggle("artist-stints-folded") === false;
      hdr.setAttribute("aria-expanded", String(open));
    });
    box.appendChild(hdr); box.appendChild(row);
    return box;
  }

  /**
   * The head over [grid]'s albums, the tabs under it (artist-tabs.js), and what they are credited on among
   * Discography's albums. [pin] is one of their own album titles, for the biography's lookup; [shown] the albums
   * already on the page (offsets); [alive] false once the page has been left or another artist's opened.
   * [onCount] is told how many albums of their bands came, for the heading's count. [ownAlbums] and [featured] their
   * albums and those they appear on, for Play and Shuffle (item 138) and Overview's row; [phone] this phone's albums of
   * theirs, Overview's too (the server can't play them).
   * @param {string} name @param {string} pin @param {HTMLElement} grid @param {() => boolean} alive @param {Set<number>} shown
   * @param {((n: number) => void)=} onCount @param {any[]=} ownAlbums @param {any[]=} featured @param {(number|string|null)=} actId
   * @param {any[]=} phone
   */
  function renderArtistHead(name, pin, grid, alive, shown, onCount, ownAlbums, featured, actId, phone) {
    const head = document.createElement("div");
    head.className = "artist-bio-head";
    const top = document.createElement("div");
    top.className = "artist-hero";
    head.appendChild(top);
    // Play and Shuffle (item 138): their own albums and their bands', else those they appear on; under the genres.
    /** @type {any[]} */ const bandAlbums = [];
    const playable = () => { const a = (ownAlbums || []).concat(bandAlbums); return a.length ? a : (featured || []); };
    const overviewRow = () => { const a = (ownAlbums || []).concat(bandAlbums, phone || []); return a.length ? a : (featured || []); };
    const plays = document.createElement("div");
    plays.className = "artist-play hidden";
    plays.innerHTML =
      '<button type="button" class="artist-play-btn" data-parity="artist.play" aria-label="Play">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg><span>Play</span></button>' +
      '<button type="button" class="artist-shuffle-btn" data-parity="artist.shuffle" aria-label="Shuffle">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg><span>Shuffle</span></button>';
    head.appendChild(plays);
    /** @param {string} kind */
    async function play(kind) {
      const albums = playable();
      if (!albums.length) return;
      if (!selectedZoneId) { showToast("Pick a zone first", "error"); return; }
      try {
        const r = await fetch("/api/play-multi", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offsets: albums.map(a => a.offset), items: albums.map(a => ({ offset: a.offset, title: a.title || "", subtitle: a.subtitle || "" })),
            zone_or_output_id: selectedZoneId, kind }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
        showToast(multiOutcome(kind === "shuffle" ? "Shuffling" : "Playing", j, albums.length, null) + " → " + zoneName(selectedZoneId), "ok");
      } catch (e) { showToast("Couldn't play: " + (e && e.message ? e.message : "no answer"), "error"); }
    }
    /** @type {HTMLElement} */ (plays.querySelector(".artist-play-btn")).addEventListener("click", () => play("play_now"));
    /** @type {HTMLElement} */ (plays.querySelector(".artist-shuffle-btn")).addEventListener("click", () => play("shuffle"));
    grid.prepend(head);
    // The foot, last in the grid whatever answers first: Overview's (style.css); their bands' and credited albums,
    // Discography's, go in before it.
    const tail = document.createElement("div");
    tail.className = "artist-tail";
    grid.appendChild(tail);
    if (w.__renderArtistFoot) w.__renderArtistFoot(name, tail, alive);
    const json = (/** @type {string} */ url) => (w.__artistJson ? w.__artistJson(url) : fetch(url).then(r => r.ok ? r.json() : null));
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

    // About's: the biography over their members or bands, or a line saying nothing is known of them.
    const bioSlot = document.createElement("div"), stintSlot = document.createElement("div");
    const none = document.createElement("div");
    none.className = "artist-about-empty hidden"; none.dataset.parity = "artist.about-empty"; none.textContent = "Nothing more is known of them yet";
    let bioAsked = false, bioDone = false;
    // Said once the biography has answered with none, until their members or bands come.
    const paintNone = () => none.classList.toggle("hidden", !(bioDone && !bioSlot.firstChild && !stintSlot.firstChild));
    // The biography is asked for only when About is opened, or for its portrait when the server has no picture of
    // their own (the page drawn without waiting on Wikipedia and Last.fm).
    const tabs = w.__renderArtistTabs(grid, head, (/** @type {string} */ t) => { if (t === "about") askBio(); });
    tabs.about.append(bioSlot, stintSlot, none);
    const paintPlays = () => { plays.classList.toggle("hidden", !playable().length); tabs.showAlbums(overviewRow()); };
    paintPlays();

    // Who they are: the server may look them up there and then, for a few seconds.
    // One act of a shared name: looked up as that act (item 340).
    // Asked again in a few seconds while the server is still looking them up as the act their albums are by (item 341).
    const about = (/** @type {number} */ n) => json("/api/artist?name=" + encodeURIComponent(name) + (actId != null ? "&artist_id=" + encodeURIComponent(actId) : ""))
      .then((/** @type {any} */ a) => a && a.pending && n < 4 && alive() ? new Promise(r => setTimeout(r, 3000)).then(() => about(n + 1)) : a);
    about(0).then((/** @type {any} */ a) => {
      if (!a || !alive()) return;
      if (a.photo_key) picture("/api/image/" + encodeURIComponent(a.photo_key) + "?size=600", true);
      else askBio();
      const said = facts(a);
      if (said) { const f = document.createElement("div"); f.className = "artist-facts"; f.dataset.parity = "artist.facts"; f.textContent = said; top.appendChild(f); }
      // Their genres (item 139), as their own albums are tagged, each opening the genre's wall.
      if (Array.isArray(a.genres) && a.genres.length) {
        const chips = document.createElement("div");
        chips.className = "genre-chips artist-genres";
        fillGenreChips(chips, a.genres, "artist.genre", (g) => { if (w.__applyFilter) w.__applyFilter({ type: "genre", value: g }); });
        top.appendChild(chips);
      }
      for (const [title, list] of [["Members", a.members], ["Member of", a.member_of]]) {
        if (list && list.length) stintSlot.appendChild(stints(title, list));
      }
      paintNone();
      // Their bands' albums from their years in them (item 133: a member's page said "0 albums"), each band its own section.
      let added = 0;
      for (const g of a.band_albums || []) {
        const albums = (g && Array.isArray(g.albums) ? g.albums : []).filter((/** @type {any} */ al) => !shown.has(al.offset));
        if (!g || !g.band || !albums.length) continue;
        tail.before(disc(header("With " + g.band)));
        for (const al of albums) { shown.add(al.offset); bandAlbums.push(al); tail.before(disc(w.__keyArtistTile(w.__buildAlbumTile(al)))); }
        added += albums.length;
      }
      if (added && onCount) onCount(added);
      paintPlays();
      const credited = (a.credited_on || []).filter((/** @type {any} */ al) => !shown.has(al.offset));
      // Something of theirs after all: not "No albums found".
      if (added || credited.length) { const empty = grid.querySelector(".artist-view-empty"); if (empty) empty.remove(); }
      if (credited.length) {
        tail.before(disc(header("Credited on")));
        for (const al of credited) {
          const tile = disc(w.__keyArtistTile(w.__buildAlbumTile(al)));
          const by = tile.querySelector(".album-artist");
          const as = (al.roles || []).join(", ");
          if (by && as) by.textContent = [by.textContent, as].filter(Boolean).join(" · ");
          tail.before(tile);
        }
      }
    }).catch(() => { askBio(); /* decorative: the albums stand alone */ });

    // The biography, as before: one of their own albums pins who they are.
    function askBio() {
      if (bioAsked) return;
      bioAsked = true;
      json("/api/artist-bio?artist=" + encodeURIComponent(name) + "&album=" + encodeURIComponent(pin || "")).then((/** @type {any} */ j) => {
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
        bioSlot.replaceChildren(body);
        if (w.__setupBioToggle) w.__setupBioToggle(text, toggle);
      }).catch(() => { /* decorative: the albums stand alone */ })
        .finally(() => { bioDone = true; paintNone(); });
    }
  }
  w.__renderArtistHead = renderArtistHead;
})();
