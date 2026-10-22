/* The page's core (app.js until v1.0.5), 25 of 33: an album's detail, read and drawn. */
async function fetchAlbumDetail(album) {
  // Send the album's identity so the server can detect a stale offset
  // (library changed since the tile rendered) and relocate — or 409 —
  // instead of returning whatever album now sits at that position.
  const idQS = `&title=${encodeURIComponent(album.title || "")}` +
               `&subtitle=${encodeURIComponent(album.subtitle || "")}`;
  const r = await fetch(`/api/album?offset=${album.offset}${idQS}${filterQSOf(currentDetailFilter)}`);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { gone: r.status === 409 });
  }
  const j = await r.json();

  // Modal may have been closed/reopened on a different album while we
  // waited — bail rather than render album A's rows (whose tap handlers
  // would fire against album B's offset). Same guard as fetchAlbumExtras.
  if (album !== currentAlbum) return;

  // The server corrects the offset when the stale-offset defense relocated
  // the album — adopt it so Play/Queue and per-track actions use the fresh
  // position instead of re-tripping the same relocation on every call.
  if (typeof j.offset === "number" && j.offset >= 0) album.offset = j.offset;
  // Its booklets, by that id (v0.8.33): the book on the cover when it has any.
  loadBooklets(album);

  // The offset is the album's permanent id on this server, so what comes
  // back IS this album — and its title, artist, year and cover are the
  // current ones. The tile that opened the page may have been drawn before
  // an edit (another row, a screen loaded earlier, a page restored after an
  // update); take the server's word and bring the page up to date, rather
  // than keeping the old names on screen.
  if (j.album && j.album.title) {
    modalTitle.textContent = j.album.title;
    const stale = album.title !== j.album.title || album.subtitle !== j.album.subtitle ||
                  (j.album.image_key && album.image_key !== j.album.image_key) ||
                  (j.album.year && album.year !== j.album.year);
    if (stale) {
      album.title = j.album.title;
      album.subtitle = j.album.subtitle;
      if (j.album.year) album.year = j.album.year;
      if (j.album.image_key && album.image_key !== j.album.image_key) {
        swapAlbumArt(album.image_key, j.album.image_key);
        album.image_key = j.album.image_key;
        modalImg.src = `/api/image/${encodeURIComponent(album.image_key)}?size=800`;
        modalImg.style.display = "";
        setModalAmbient(modalImg.src);
      }
      if (!(Array.isArray(j.artists) && j.artists.length)) setModalArtist(album.subtitle);
      try {
        sessionStorage.setItem("rra-modal", JSON.stringify({ album, source: currentSource, zoneId: currentSourceZoneId, filter: currentDetailFilter }));
      } catch (e) { /* ignore */ }
      // The write-ups/year were asked for under the old names: ask again.
      fetchAlbumExtras(album).catch(() => {});
    }
  }
  // Re-render the artist line with the server's library-validated split so
  // each collaborator becomes their own link (openAlbum rendered the
  // conservative client split as a placeholder).
  if (Array.isArray(j.artists) && j.artists.length) {
    setModalArtist((j.album && j.album.subtitle) || album.subtitle || "", j.artists);
  }
  // A classical album (item 49): its composers in the artists' place, and who performs it under them.
  setClassicalHead(j);
  // Below the review: more by the album's lead artist (the name its first
  // artist link shows), what they appear on, and Last.fm's suggestions.
  fetchAlbumMore(album, (Array.isArray(j.artists) && j.artists[0]) || album.subtitle || "")
    .catch(() => { /* extras: the album page stands without them */ });
  // Over them, who played, wrote and made it (item 132).
  if (window.__albumCredits) window.__albumCredits(album);
  // The notes below go at the foot of the album's head, after its date and
  // its rate and length (bug list item 28), not between its lines.
  const headEnd = document.getElementById("modal-facts") || modalSub;
  // Named from its folders, its files carrying no tags (v0.6.0-RC10): said
  // under the names, so they read as the best guess they are.
  {
    let note = document.getElementById("modal-names-note");
    if (j.names_from_folders) {
      if (!note && headEnd && headEnd.parentNode) {
        note = document.createElement("div");
        note.id = "modal-names-note";
        note.className = "modal-names-note"; note.dataset.parity = "album.names-note";
        headEnd.parentNode.insertBefore(note, headEnd.nextSibling);
      }
      if (note) note.textContent = "Names from its folders — the files carry no tags";
    } else if (note) note.remove();
  }
  // A streamed album, signed in (v0.7.3): why it is in the library — a
  // favourite or a purchase on the service, and since when; held by a
  // playlist or favourite track; or only played — and, for one not out
  // yet, its release date. So an album that appeared unasked explains
  // itself on its page.
  {
    let why = document.getElementById("modal-why-note");
    const w = j.album && j.album.service_why;
    if (w && headEnd && headEnd.parentNode) {
      if (!why) {
        why = document.createElement("div");
        why.id = "modal-why-note";
        why.className = "modal-names-note"; why.dataset.parity = "album.why-note";
      }
      const anchor = document.getElementById("modal-names-note") || headEnd;
      anchor.parentNode.insertBefore(why, anchor.nextSibling);
      const when = w.since ? " since " + new Date(w.since).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
      let text = w.kept === "purchase" ? "In your library as a " + w.name + " purchase" + when
        : w.kept ? "In your library as a " + w.name + " favourite" + when
        : w.held ? "Here for a " + w.name + " playlist or favourite track — not in your favourites"
        : "Played from " + w.name + " — not in your favourites";
      if (w.releases) text += " · not out until " + formatReleaseDate(w.releases);
      why.textContent = text;
    } else if (why) why.remove();
  }

  // A disc of a box set filed as albums of their own (v0.6.3): which box,
  // which disc, and the other discs a tap away — stepping through the box
  // with previous / next once one is opened from here.
  {
    let box = document.getElementById("modal-box-note");
    const b = j.album && j.album.box;
    if (b && headEnd && headEnd.parentNode) {
      if (!box) {
        box = document.createElement("div");
        box.id = "modal-box-note";
        box.className = "modal-box-note"; box.dataset.parity = "album.box-note";
      }
      const anchor = document.getElementById("modal-names-note") || headEnd;
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
      box.innerHTML = "";
      const line = document.createElement("div");
      line.textContent = "From " + b.name + " · disc " + b.disc + " of " + b.of;
      box.appendChild(line);
      const all = [Object.assign({}, album, { disc: b.disc })].concat(j.box_albums || []).sort((x, y) => (x.disc || 0) - (y.disc || 0));
      const others = document.createElement("div");
      others.className = "modal-box-discs";
      all.forEach((x, i) => {
        if (x.offset === album.offset) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "modal-box-disc"; btn.dataset.parity = "album.box-disc";
        btn.textContent = "Disc " + x.disc + " · " + x.title;
        btn.addEventListener("click", () => {
          albumNav.pending = { items: all.map(a => ({ album: a, open: () => openAlbum(a, { source: "home", filter: null }) })), index: i };
          openAlbum(x, { source: "home", filter: null });
        });
        others.appendChild(btn);
      });
      box.appendChild(others);
    } else if (box) box.remove();
  }

  // Build action buttons in preferred order
  const order  = ["play_now", "queue", "play_next", "shuffle", "radio"];
  // Each one's key in the screens contract (docs/specs/screens.json).
  const keys = { play_now: "album.play-now", queue: "album.queue", play_next: "album.play-next", shuffle: "album.shuffle", radio: "album.radio" };
  const labels = {
    play_now:  "Play Now",
    queue:     "Queue",
    play_next: "Play Next",
    shuffle:   "Shuffle",
    radio:     "Radio"
  };
  const map = new Map();
  for (const a of (j.actions || [])) {
    if (!map.has(a.kind)) map.set(a.kind, a);
  }

  // Play Now and Queue stay on the row; Next / Shuffle / Radio go behind the
  // overflow menu. Five pills hit the same wall the playlist screens did —
  // .action-btn is `flex: 1 1 0`, so they shrink together instead of
  // wrapping, and on a phone the labels start clipping.
  const ROW_ACTIONS = 2;
  modalActs.innerHTML = "";
  // The heart, first: the same size as the ⋯ button at the other end.
  modalActs.appendChild(buildFavButton(album, j.album, "album.favourite"));
  const available = order.filter(k => map.has(k));
  let first = true;
  for (const k of available.slice(0, ROW_ACTIONS)) {
    const btn = document.createElement("button");
    btn.className = "action-btn" + (first ? " primary" : "");
    btn.type = "button";
    btn.textContent = labels[k];
    btn.dataset.parity = keys[k];
    btn.addEventListener("click", () => invoke(k, btn));
    modalActs.appendChild(btn);
    first = false;
  }
  const overflow = available.slice(ROW_ACTIONS);
  if (overflow.length) {
    const more = buildOverflowMenu(
      overflow.map(k => ({ label: labels[k], key: keys[k], onClick: (b) => invoke(k, b) }))
        .concat(serviceMenuItem(j))
        .concat(laterMenuItem(album, j))
        .concat(playlistMenuItem(album))
        .concat(album.source && album.source !== "local" ? [] : [{ label: "Edit album", key: "album.edit", onClick: () => openAlbumEditor(album) }])
        .concat(downloadMenuItem(album)),
      { label: "More actions", key: "album.more" });
    modalActs.appendChild(more);
  }
  if (!available.length) {
    // "No playback actions available" was true and useless — it described
    // our own empty array rather than anything the user could act on. When
    // Roon's live album count no longer matches the snapshot we can say why,
    // and that a re-check is already running.
    modalActs.innerHTML = "";
    const err = document.createElement("div");
    err.className = "modal-error"; err.dataset.parity = "album.notice";
    // BOTH branches explain themselves now. The second one — the plain
    // sentence with no explanation at all — is the red line users actually
    // reported, and it was composed here in the client, so the server-side
    // builder never touched it.
    err.textContent = "No playback options for this album." +
                      libraryChangingAdvice(!!j.library_moved);
    modalActs.appendChild(err);
  }

  // Its genres (item 139), each opening the genre's wall.
  fillGenreChips(document.getElementById("modal-genres"), (j.album && j.album.genres) || [], "album.genre", (g) => {
    closeModal();
    if (window.__applyFilter) window.__applyFilter({ type: "genre", value: g });
  });
  // Tracks — each row is tappable and reveals Play now / Queue for that
  // track (one open row at a time; tapping again collapses it).
  const trackWrap = document.querySelector(".track-list-wrap");
  modalTracks.innerHTML = "";
  const trackList = j.tracks || [];
  // The album's total time (v0.7.10), beside the Tracks heading.
  const totalEl = document.getElementById("modal-total");
  if (totalEl) {
    const secs = trackList.reduce((s, t) => s + (Number(t.length) || 0), 0);
    totalEl.textContent = secs > 0 ? fmtTotal(secs) : "";
  }
  // A thin or empty answer is now distinguishable from an album that really
  // has no tracks: Roon declares how many rows the level holds, so we know
  // when it sent fewer. Previously the whole section was hidden and an album
  // mid-reindex looked identical to one with nothing on it.
  if (j.partial) {
    const note = document.createElement("div");
    note.className = "modal-error"; note.dataset.parity = "album.notice";
    note.textContent = (j.declared_tracks
      ? "Only " + trackList.length + " of " + j.declared_tracks + " tracks were readable."
      : "Some tracks couldn't be read.") +
      libraryChangingAdvice(!!j.library_moved);
    modalActs.appendChild(note);
  }
  if (trackList.length === 0) {
    if (!j.partial && j.library_moved) {
      const note = document.createElement("div");
      note.className = "modal-error"; note.dataset.parity = "album.notice";
      note.textContent = "No playable tracks were found for this album." +
                         libraryChangingAdvice(!!j.library_moved);
      modalActs.appendChild(note);
    }
    trackWrap.classList.add("hidden");
  } else {
    trackWrap.classList.remove("hidden");
    // The rows (album-works.js): the plain list, or the album's works and movements.
    renderTrackList(j, trackList);
  }
}

// Genres as small chips (item 139): an album's, or an artist's (artist-about.js); [key] their key in the screens
// contract, [onTap] a genre tapped. Hidden when there are none.
function fillGenreChips(el, genres, key, onTap) {
  if (!el) return;
  el.textContent = "";
  const list = (Array.isArray(genres) ? genres : []).filter(g => typeof g === "string" && g.trim());
  for (const g of list) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "genre-chip"; b.dataset.parity = key;
    b.textContent = g;
    b.addEventListener("click", () => onTap(g));
    el.appendChild(b);
  }
  el.classList.toggle("hidden", !list.length);
}
