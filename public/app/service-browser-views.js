/* The streaming-service browser (app/service-browser.js), 3 of 3: an album's own view, a list
   drawn, the next page of it. Installed by initServiceBrowser, one per service; what the parts
   share is on its sb. */
function serviceBrowserViews(sb) {
  const { PAGE_SIZE, artistHeadEl, artistsEl, cfg, clearDetail, clearSearchTimer, currentView, detailEl, esc, goBack, listEl, loadMoreEl, resetListContainers, searchRowEl, setFavState, statusEl, tabsEl, toast, toggleFavourite } = sb;
  // Isolated detail view for a service album: artwork, editorial review
  // (fetched by title+artist via the service-independent /api/album/extras —
  // no Roon needed, works for any catalogue), and a favourite toggle kept in
  // sync with the originating list row's button.
  async function renderDetail(album, rowFavBtn) {
    if (!detailEl) return;
    detailEl.innerHTML = "";
    detailEl.dataset.albumId = album.id;

    const back = document.createElement("button");
    back.type = "button";
    back.className = "qobuz-nr-back";
    back.textContent = "‹ Back";
    back.addEventListener("click", goBack);

    const head = document.createElement("div");
    head.className = "qobuz-nr-detail-head";
    head.innerHTML =
      (album.image
        ? '<img class="qobuz-nr-detail-art" alt="" src="' + esc(album.image) + '">'
        : '<div class="qobuz-nr-detail-art"></div>') +
      '<div class="qobuz-nr-detail-meta">' +
        '<div class="qobuz-nr-detail-title">' + esc(album.title) + sb.versionHtml(album) + '</div>' +
        '<div class="qobuz-nr-detail-artist">' + esc(album.artist) + '</div>' +
        (album.release_date ? '<div class="qobuz-nr-date">' + esc(album.release_date) + '</div>' : '') +
      '</div>';

    const favBtn = document.createElement("button");
    favBtn.type = "button";
    favBtn.className = "qobuz-nr-fav";
    setFavState(favBtn, rowFavBtn && rowFavBtn.dataset.fav === "1");
    favBtn.addEventListener("click", () => toggleFavourite(album.id, [favBtn, rowFavBtn]));

    const review = document.createElement("div");
    review.className = "qobuz-nr-review";
    review.textContent = "Loading review…";

    detailEl.appendChild(back);
    detailEl.appendChild(head);
    detailEl.appendChild(favBtn);
    // Playing from here (v0.6.23): to the zone chosen, like an album of your own.
    const acts = document.createElement("div");
    acts.className = "qobuz-nr-actions";
    const tracksEl = document.createElement("div");
    tracksEl.className = "qobuz-nr-tracks";
    if (cfg.service === "qobuz") {
      const play = async (kind, btn, track) => {
        const zone = window.__selectedZoneId ? window.__selectedZoneId() : null;
        if (!zone) { toast("Pick a zone first", "error"); return; }
        const was = btn.textContent; btn.disabled = true; btn.textContent = "…";
        try {
          const r = await fetch(cfg.apiBase + "/play", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.assign({ album_id: album.id, zone_or_output_id: zone, kind }, track == null ? {} : { track })) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || j.error) throw new Error(j.error || "Couldn't play");
          toast((kind === "queue" ? "Queued" : kind === "play_next" ? "Playing next" : "Playing") + ": " + album.title);
        } catch (e) { toast(e.message, "error"); }
        finally { btn.disabled = false; btn.textContent = was; }
      };
      for (const [label, kind, primary] of [["Play now", "play_now", true], ["Play next", "play_next", false], ["Queue", "queue", false]]) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "action-btn" + (primary ? " primary" : ""); b.textContent = label;
        b.addEventListener("click", () => play(kind, b, null));
        acts.appendChild(b);
      }
      detailEl.appendChild(acts);
      detailEl.appendChild(tracksEl);
      tracksEl.textContent = "Loading tracks…";
      sb.qFetch(cfg.apiBase + "/album?id=" + encodeURIComponent(album.id)).then(j => {
        if (detailEl.dataset.albumId !== String(album.id)) return;
        tracksEl.innerHTML = "";
        (j.tracks || []).forEach((t, i) => {
          const row = document.createElement("button");
          row.type = "button"; row.className = "qobuz-nr-track";
          const m = Math.floor(t.duration / 60), sec = String(Math.round(t.duration % 60)).padStart(2, "0");
          row.innerHTML = '<span class="qobuz-nr-track-no">' + (t.track_no || i + 1) + '</span><span class="qobuz-nr-track-title">' + esc(t.title) + '</span>' +
            '<span class="qobuz-nr-track-len">' + m + ":" + sec + '</span>';
          row.title = "Play from here";
          row.addEventListener("click", () => play("play_now", row, i));
          tracksEl.appendChild(row);
        });
        if (j.album && j.album.quality) {
          const q = document.createElement("div"); q.className = "qobuz-nr-date"; q.textContent = "FLAC " + j.album.quality + (j.album.label ? " · " + j.album.label : "");
          head.querySelector(".qobuz-nr-detail-meta").appendChild(q);
        }
      }).catch(e => { if (detailEl.dataset.albumId === String(album.id)) tracksEl.textContent = e.message; });
    }
    detailEl.appendChild(review);
    detailEl.classList.remove("hidden");

    try {
      const params = new URLSearchParams({ title: album.title || "", artist: album.artist || "" });
      const r = await fetch("/api/album/extras?" + params.toString());
      const j = await r.json().catch(() => ({}));
      // Guard against a fast back→open switching the detail to another album.
      if (detailEl.dataset.albumId !== String(album.id)) return;
      const alb = j && j.album;
      const desc = alb && alb.description;
      review.innerHTML = "";
      if (desc) {
        // desc is only ever Qobuz/Wikipedia editorial now — Pitchfork review
        // text is stripped server-side (UK-law compliance).
        const p = document.createElement("div");
        p.className = "qobuz-nr-review-text";
        p.textContent = desc;
        review.appendChild(p);
      } else if (alb && alb.source === "Pitchfork" && alb.url) {
        review.textContent = "Pitchfork reviewed this release — read it on pitchfork.com.";
      } else {
        review.textContent = "No review available for this release.";
      }
      // The source link renders with OR without text — with Pitchfork the
      // link IS the review access, so it must not hide behind if(desc).
      if (alb && alb.url && alb.source) {
        const link = document.createElement("a");
        link.className = "qobuz-nr-review-src";
        link.href = alb.url; link.target = "_blank"; link.rel = "noopener";
        link.textContent = alb.source === "Pitchfork"
          ? "Read the review on Pitchfork"
          : "View on " + alb.source;
        review.appendChild(link);
      }
    } catch (e) {
      if (detailEl.dataset.albumId === String(album.id)) review.textContent = "Couldn't load review.";
    }
  }

  // Single dispatcher: renders whatever view is on top of the stack.
  async function render(view) {
    const seq = ++sb.reqSeq;
    // Any view change invalidates a pending debounced search — without this, a
    // timer set while typing could fire after the user navigated (e.g. into a
    // detail view) and replace what they're looking at with search results.
    clearSearchTimer();
    sb.syncChrome(view);

    if (view.kind === "detail") {
      // Detail takes over the sheet: hide the list chrome but leave its DOM
      // intact so back is instant (see restoreListAfterDetail).
      [searchRowEl, tabsEl, statusEl, artistHeadEl, artistsEl, listEl, loadMoreEl]
        .forEach(el => { if (el) el.classList.add("hidden"); });
      renderDetail(view.album, view.rowFavBtn);
      return;
    }

    // Common chrome for list-type views (tab / search / artist). The list
    // containers are deliberately NOT cleared here: the previous rows stay
    // visible under the "Searching…"/"Loading…" status while the request is in
    // flight, and resetListContainers() swaps them out only once the outcome
    // (results, empty, or error) is known. The full-screen sheet plus this
    // deferred clear is what stops the overlay collapsing/jumping during a
    // search. The reqSeq guard already drops stale responses, so an old view's
    // rows can never be appended into the new view.
    clearDetail();
    if (searchRowEl) searchRowEl.classList.remove("hidden");
    if (tabsEl) tabsEl.classList.remove("hidden");
    if (statusEl) statusEl.classList.remove("hidden");
    if (listEl) listEl.classList.remove("hidden");
    // Chrome that ACTS on the outgoing view must not stay live while the
    // replacement view's request is in flight: the artist header's ‹ Back
    // would pop a level below the view just selected, and Load more would
    // page a list that's about to be replaced. Rows and artist chips stay —
    // taps on them push views that self-heal (see restoreListAfterDetail).
    if (artistHeadEl) artistHeadEl.classList.add("hidden");
    if (loadMoreEl) loadMoreEl.classList.add("hidden");

    try {
      // Tab endpoints come from cfg.tabs: the "new-releases" kind has its own
      // endpoint + status wording; every other tab is a /featured?type=<id>.
      const tabDef = view.kind === "tab" ? cfg.tabs.find(t => t.id === view.tab) : null;
      if (view.kind === "tab" && tabDef && tabDef.kind === "new-releases") {
        if (statusEl) statusEl.textContent = "Loading new releases…";
        const j = await sb.qFetch(cfg.apiBase + "/new-releases?days=30");
        if (seq !== sb.reqSeq) return; // a newer view/request superseded this one
        resetListContainers();
        const albums = j.albums || [];
        view.loaded = true;
        if (statusEl) statusEl.textContent = albums.length
          ? (albums.length + " releases in the last " + (j.days || 30) + " days")
          : ("No new releases found in the last " + (j.days || 30) + " days.");
        sb.appendAlbumRows(albums);
      } else if (view.kind === "tab") {
        if (statusEl) statusEl.textContent = "Loading…";
        const j = await sb.qFetch(cfg.apiBase + "/featured?type=" + encodeURIComponent(view.tab));
        if (seq !== sb.reqSeq) return; // superseded
        resetListContainers();
        const albums = j.albums || [];
        view.loaded = true;
        if (statusEl) statusEl.textContent = albums.length
          ? (albums.length + " albums")
          : "No albums found.";
        sb.appendAlbumRows(albums);
      } else if (view.kind === "search") {
        if (statusEl) statusEl.textContent = "Searching…";
        const j = await sb.qFetch(cfg.apiBase + "/search?q=" + encodeURIComponent(view.query) + "&offset=0");
        if (seq !== sb.reqSeq) return; // superseded (e.g. user kept typing)
        resetListContainers();
        const albums = j.albums || [];
        const artists = j.artists || [];
        view.offset = 0;
        view.hasMore = !!j.has_more;
        view.limit = j.limit || PAGE_SIZE;
        view.loaded = true;
        sb.renderArtistStrip(artists);
        if (statusEl) statusEl.textContent = albums.length
          ? ((j.total || albums.length) + " albums for “" + view.query + "”")
          : (artists.length
              ? ("No album matches for “" + view.query + "” — artists below")
              : ("No results for “" + view.query + "”"));
        sb.appendAlbumRows(albums);
        if (loadMoreEl) loadMoreEl.classList.toggle("hidden", !view.hasMore);
      } else if (view.kind === "artist") {
        if (statusEl) statusEl.textContent = "Loading…";
        const j = await sb.qFetch(cfg.apiBase + "/artist-albums?artist_id=" +
          encodeURIComponent(view.artistId) + "&offset=0");
        if (seq !== sb.reqSeq) return; // superseded
        resetListContainers();
        const albums = j.albums || [];
        view.offset = 0;
        view.hasMore = !!j.has_more;
        view.limit = j.limit || PAGE_SIZE;
        view.loaded = true;
        const artist = j.artist || {};
        sb.renderArtistHead(artist.image || null, artist.name || view.artistName || "");
        // Qobuz's editorial bio (same clamp/expand as the library artist view).
        if (j.biography && artistHeadEl) {
          const bio = document.createElement("div");
          bio.className = "artist-bio-body qobuz-artist-bio";
          const text = document.createElement("div");
          text.className = "bio-text";
          text.dataset.clipped = "true";
          text.textContent = j.biography;
          const foot = document.createElement("div");
          foot.className = "artist-bio-foot";
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "bio-toggle hidden";
          toggle.textContent = "Show more";
          const src = document.createElement("span");
          src.className = "artist-bio-src";
          src.textContent = "Bio: Qobuz";
          foot.appendChild(toggle); foot.appendChild(src);
          bio.appendChild(text); bio.appendChild(foot);
          artistHeadEl.appendChild(bio);
          if (window.__setupBioToggle) window.__setupBioToggle(text, toggle);
        }
        if (statusEl) statusEl.textContent = albums.length
          ? ((j.total || albums.length) + " albums")
          : "No albums found.";
        sb.appendAlbumRows(albums);
        if (loadMoreEl) loadMoreEl.classList.toggle("hidden", !view.hasMore);
      }
    } catch (e) {
      if (seq !== sb.reqSeq) return; // superseded — a newer render owns the status line
      // The failed view owns the content area now — stale rows from the
      // previous view would be misleading under an error message, so clear.
      resetListContainers();
      const notConnected = /not connected/i.test(e.message);
      if (statusEl) statusEl.textContent = notConnected
        ? cfg.notConnectedMsg
        : ("Couldn't load: " + e.message);
    }
  }

  // Append the next page of a paged view (search / artist). offset advances by
  // the server's page limit; the server says whether more pages exist
  // (has_more) — it knows the raw page length, which the client cannot infer
  // once malformed items have been filtered out.
  async function loadMore() {
    const view = currentView();
    if (!view || (view.kind !== "search" && view.kind !== "artist") || !view.hasMore) return;
    if (!loadMoreEl || loadMoreEl.disabled) return;
    const seq = ++sb.reqSeq;
    const nextOffset = (view.offset || 0) + (view.limit || PAGE_SIZE);
    loadMoreEl.disabled = true;
    loadMoreEl.textContent = "Loading…";
    try {
      const url = view.kind === "search"
        ? cfg.apiBase + "/search?q=" + encodeURIComponent(view.query) + "&offset=" + nextOffset
        : cfg.apiBase + "/artist-albums?artist_id=" + encodeURIComponent(view.artistId) + "&offset=" + nextOffset;
      const j = await sb.qFetch(url);
      if (seq !== sb.reqSeq) return; // superseded — the view was replaced meanwhile
      view.offset = nextOffset;
      view.hasMore = !!j.has_more;
      view.limit = j.limit || view.limit || PAGE_SIZE;
      sb.appendAlbumRows(j.albums || []);
      loadMoreEl.classList.toggle("hidden", !view.hasMore);
    } catch (e) {
      if (seq === sb.reqSeq) toast("Couldn't load more: " + e.message, "error");
    } finally {
      loadMoreEl.disabled = false;
      loadMoreEl.textContent = "Load more";
    }
  }
  Object.assign(sb, { render, loadMore });
}
