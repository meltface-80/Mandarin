/* The streaming-service browser (app/service-browser.js), 2 of 3: an album as a tile and its page,
   the artists, and a list kept and put back. Installed by initServiceBrowser, one per service; what
   the parts share is on its sb. */
function serviceBrowserRows(sb) {
  const { artistHeadEl, artistsEl, cfg, clearDetail, esc, goBack, listEl, loadMoreEl, overlay, overlayVisible, pushView, searchClear, searchInput, searchRowEl, setFavState, statusEl, tabsEl, toast, toggleFavourite, updateTabActive } = sb;
  // Muted edition/version suffix ("Deluxe Edition" …) shown after a title.
  const versionHtml = (a) =>
    a.version ? ' <span class="qobuz-nr-version">' + esc(a.version) + '</span>' : '';

  // One album as a tile of the same album grid the rest of the UI draws
  // (.album / .album-art-wrap / .album-meta, so the columns, text sizes and
  // the Grid columns setting all apply), the service favourite as a + / ✓
  // in the corner of the cover. A tap opens the album's own page, as any
  // album here. Shared by every list-type view.
  function buildAlbumRow(a, opts) {
    const outside = !!(opts && opts.outside);   // on the search screen, not in this overlay
    const tile = document.createElement("div");
    tile.className = "album qobuz-tile";
    tile.setAttribute("role", "button");
    tile.tabIndex = 0;
    tile.setAttribute("aria-label", a.title + (a.artist ? " by " + a.artist : ""));
    const art = document.createElement("div");
    art.className = "album-art-wrap" + (a.image ? "" : " no-image");
    if (a.image) {
      const img = document.createElement("img");
      img.loading = "lazy"; img.alt = ""; img.src = a.image;
      img.addEventListener("error", () => { art.classList.add("no-image"); img.remove(); });
      art.appendChild(img);
    }
    const fav = document.createElement("button");
    fav.type = "button";
    fav.className = "qobuz-nr-fav qobuz-tile-fav";
    // + ⇄ ✓: the user's service favourites as they are now (added here or elsewhere).
    setFavState(fav, !!a.favourited);
    fav.addEventListener("click", (e) => { e.stopPropagation(); toggleFavourite(a.id, fav); });
    art.appendChild(fav);
    const meta = document.createElement("div");
    meta.className = "album-meta";
    meta.innerHTML = '<div class="album-title">' + esc(a.title) + versionHtml(a) + '</div>' +
      '<div class="album-artist">' + esc(a.artist) + '</div>';
    tile.appendChild(art);
    tile.appendChild(meta);
    // Its keys for the screens contract (service-browser); the search screen keys it as its own (search-external.js).
    tile.dataset.parity = "service-browser.album";
    const parts = { ".album-art-wrap": "service-browser.album-art", ".album-title": "service-browser.album-title", ".album-artist": "service-browser.album-artist", ".qobuz-tile-fav": "service-browser.fav" };
    for (const [sel, key] of Object.entries(parts)) { const el = tile.querySelector(sel); if (el) el.dataset.parity = key; }
    const open = () => outside ? openAlbumOutside(a, fav) : openAlbumPage(a, fav);
    tile.addEventListener("click", open);
    tile.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    return tile;
  }

  // The album's own page — the one every album here has, with Play now, Play
  // next, Queue, the tracks, and the service favourite above the ⋯ — instead
  // of a page of this overlay's own. The server makes the album library rows
  // first (/open; transient until favourited), then the page opens over this
  // overlay, which drops beneath it until the page closes. The browse list is
  // kept as it was, so closing the page lands back on it.
  const albumModal = document.getElementById("album-modal");
  let under = null;   // { favBtn, albumId, observer } while the album page is over the overlay
  async function openAlbumPage(a, favBtn) {
    if (typeof window.__openAlbum !== "function" || !albumModal) { pushView({ kind: "detail", album: a, rowFavBtn: favBtn }); return; }
    try {
      const { album } = await askOpen(a.id);
      if (!overlayVisible()) return;   // closed while the server was asked
      showUnder(a.id, favBtn);
      window.__openAlbum(album, { source: cfg.service, filter: null });
    } catch (e) {
      toast(e.message || "Couldn't open that album", "error");
    }
  }
  function showUnder(albumId, favBtn) {
    leaveUnder(false);
    overlay.classList.add("is-under");
    const observer = new MutationObserver(() => { if (albumModal.classList.contains("hidden")) leaveUnder(true); });
    observer.observe(albumModal, { attributes: true, attributeFilter: ["class"] });
    under = { favBtn, albumId, observer };
  }
  // The page has closed: the overlay comes back on top, and the tile's + / ✓
  // is read again, since the page has the same favourite above its ⋯.
  function leaveUnder(refresh) {
    if (!under) return;
    const u = under; under = null;
    u.observer.disconnect();
    overlay.classList.remove("is-under");
    if (!refresh || !u.favBtn || !overlayVisible()) return;
    fetch(cfg.apiBase + "/state?album_id=" + encodeURIComponent(u.albumId)).then(r => r.json())
      .then(j => { if (j && j.connected && u.favBtn.isConnected) setFavState(u.favBtn, !!j.favourite); })
      .catch(() => {});
  }
  // The album page is closed by the back button too (Android's, the browser's):
  // the page goes, the overlay's history entry is put back, the list stays.
  function backClosesAlbumPage() {
    if (!under) return false;
    const closer = albumModal.querySelector("[data-close]");
    if (closer) closer.click(); else leaveUnder(true);
    history.pushState({ [cfg.historyKey]: sb.viewStack.length }, "");
    return true;
  }

  // The album's rows made and its page opened from the search screen
  // (v0.6.24), where this overlay is not showing: the page opens over the
  // results, and the tile's + / ✓ is read again once it closes.
  async function openAlbumOutside(a, favBtn) {
    try {
      const j = await askOpen(a.id);
      if (typeof window.__openAlbum !== "function") throw new Error("Couldn't open that album");
      const observer = new MutationObserver(() => {
        if (!albumModal.classList.contains("hidden")) return;
        observer.disconnect();
        if (!favBtn || !favBtn.isConnected) return;
        fetch(cfg.apiBase + "/state?album_id=" + encodeURIComponent(a.id)).then(r => r.json())
          .then(st => { if (st && st.connected && favBtn.isConnected) setFavState(favBtn, !!st.favourite); }).catch(() => {});
      });
      window.__openAlbum(j.album, { source: cfg.service, filter: null });
      if (albumModal) observer.observe(albumModal, { attributes: true, attributeFilter: ["class"] });
    } catch (e) {
      toast(e.message || "Couldn't open that album", "error");
    }
  }
  // /open: the album's library rows (transient until favourited) and the
  // album as the page's tiles carry it; an older server is asked once more.
  async function askOpen(albumId) {
    const r = await fetch(cfg.apiBase + "/open", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ album_id: albumId })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Couldn't open that album");
    const album = j.album || (await (await fetch("/api/album?offset=" + encodeURIComponent(j.offset))).json()).album;
    if (!album) throw new Error("Couldn't open that album");
    return { offset: j.offset, album };
  }

  function appendAlbumRows(albums) {
    if (!listEl) return;
    const frag = document.createDocumentFragment();
    for (const a of albums) frag.appendChild(buildAlbumRow(a));
    listEl.appendChild(frag);
  }

  // Artist matches strip shown above search results (offset 0 only).
  function renderArtistStrip(artists) {
    if (!artistsEl) return;
    artistsEl.innerHTML = "";
    if (!artists.length) { artistsEl.classList.add("hidden"); return; }
    for (const ar of artists) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "qobuz-artist-chip"; chip.dataset.parity = "service-browser.artist";
      chip.innerHTML =
        (ar.image
          ? '<img class="qobuz-artist-thumb" loading="lazy" alt="" src="' + esc(ar.image) + '">'
          : '<div class="qobuz-artist-thumb"></div>') +
        '<span class="qobuz-artist-name">' + esc(ar.name) + '</span>';
      chip.addEventListener("click", () =>
        pushView({ kind: "artist", artistId: ar.id, artistName: ar.name }));
      artistsEl.appendChild(chip);
    }
    artistsEl.classList.remove("hidden");
  }

  // Artist discography header: ‹ Back affordance (same as detail) + round thumb + name.
  function renderArtistHead(image, name) {
    if (!artistHeadEl) return;
    artistHeadEl.innerHTML = "";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "qobuz-nr-back"; back.dataset.parity = "service-artist.back";
    back.textContent = "‹ Back";
    back.addEventListener("click", goBack);
    const head = document.createElement("div");
    head.className = "qobuz-artist-head-row";
    head.innerHTML =
      (image
        ? '<img class="qobuz-artist-head-art" data-parity="service-artist.art" alt="" src="' + esc(image) + '">'
        : '<div class="qobuz-artist-head-art" data-parity="service-artist.art"></div>') +
      '<div class="qobuz-artist-head-name" data-parity="service-artist.name">' + esc(name) + '</div>';
    artistHeadEl.appendChild(back);
    artistHeadEl.appendChild(head);
    artistHeadEl.classList.remove("hidden");
  }

  // Restore the list chrome after popping a detail view. The underlying list
  // DOM (rows, artist strip/header, load-more state) was only hidden, never
  // cleared, so this is pure visibility work — no refetch.
  function restoreListAfterDetail(top) {
    // Exception: with deferred clearing, stale rows stay clickable while a
    // request is in flight, so a detail can be opened from a view whose fetch
    // was then orphaned (reqSeq bumped) before it ever loaded. Restoring
    // visibility would present the PREVIOUS view's rows under a stuck
    // "Searching…"/"Loading…" status — refetch the view instead.
    if (!top.loaded) { sb.render(top); return; }
    clearDetail();
    if (searchRowEl) searchRowEl.classList.remove("hidden");
    if (tabsEl) tabsEl.classList.remove("hidden");
    if (statusEl) statusEl.classList.remove("hidden");
    if (listEl) listEl.classList.remove("hidden");
    if (artistHeadEl) artistHeadEl.classList.toggle("hidden", top.kind !== "artist");
    if (artistsEl) artistsEl.classList.toggle("hidden",
      !(top.kind === "search" && artistsEl.childElementCount > 0));
    if (loadMoreEl) loadMoreEl.classList.toggle("hidden", !top.hasMore);
    syncChrome(top);
  }

  // Save a rendered list view's DOM (rows, artist strip/header, status,
  // load-more state) onto its stack entry before an artist view takes over the
  // shared containers. Moving nodes into fragments keeps their listeners alive.
  function snapshotListInto(view) {
    const snap = {
      list:          document.createDocumentFragment(),
      artists:       document.createDocumentFragment(),
      head:          document.createDocumentFragment(),
      artistsHidden: artistsEl ? artistsEl.classList.contains("hidden") : true,
      headHidden:    artistHeadEl ? artistHeadEl.classList.contains("hidden") : true,
      status:        statusEl ? statusEl.textContent : "",
      loadMoreHidden: loadMoreEl ? loadMoreEl.classList.contains("hidden") : true
    };
    if (listEl) while (listEl.firstChild) snap.list.appendChild(listEl.firstChild);
    if (artistsEl) while (artistsEl.firstChild) snap.artists.appendChild(artistsEl.firstChild);
    if (artistHeadEl) while (artistHeadEl.firstChild) snap.head.appendChild(artistHeadEl.firstChild);
    view.snapshot = snap;
  }

  // Put a snapshotted list view back on screen — no refetch, loaded pages and
  // favourite-button state (live nodes) survive intact.
  function restoreSnapshot(view) {
    const snap = view.snapshot;
    view.snapshot = null;
    sb.reqSeq++; // orphan any in-flight fetch owned by the view being discarded
    clearDetail();
    if (searchRowEl) searchRowEl.classList.remove("hidden");
    if (tabsEl) tabsEl.classList.remove("hidden");
    if (statusEl) { statusEl.classList.remove("hidden"); statusEl.textContent = snap.status; }
    if (listEl) { listEl.innerHTML = ""; listEl.appendChild(snap.list); listEl.classList.remove("hidden"); }
    if (artistHeadEl) {
      artistHeadEl.innerHTML = "";
      artistHeadEl.appendChild(snap.head);
      artistHeadEl.classList.toggle("hidden", snap.headHidden);
    }
    if (artistsEl) {
      artistsEl.innerHTML = "";
      artistsEl.appendChild(snap.artists);
      artistsEl.classList.toggle("hidden", snap.artistsHidden);
    }
    if (loadMoreEl) loadMoreEl.classList.toggle("hidden", snap.loadMoreHidden);
    syncChrome(view);
  }

  // Keep the search box, its clear button, and the tab chips consistent with
  // the view being shown — a popstate can resurface a search whose text a tab
  // switch cleared, and vice versa. Never fight live typing: the input is left
  // alone while focused.
  function syncChrome(view) {
    updateTabActive();
    if (!searchInput) return;
    if (document.activeElement !== searchInput) {
      if (view.kind === "search") searchInput.value = view.query;
      else if (view.kind === "tab") searchInput.value = "";
    }
    if (searchClear) searchClear.classList.toggle("hidden", !searchInput.value);
  }

  // fetch + JSON with a clean error path: non-JSON bodies (proxy or maintenance
  // HTML pages) surface as "HTTP nnn" instead of a JSON SyntaxError message.
  async function qFetch(url) {
    const r = await fetch(url);
    let j = null;
    try { j = await r.json(); } catch (e) { /* non-JSON body — handled below via r.ok/status */ }
    if (!r.ok) throw new Error((j && j.error) || ("HTTP " + r.status));
    return j || {};
  }
  Object.assign(sb, { versionHtml, buildAlbumRow, leaveUnder, backClosesAlbumPage, appendAlbumRows, renderArtistStrip, renderArtistHead, restoreListAfterDetail, snapshotListInto, restoreSnapshot, syncChrome, qFetch });
}
