/* The page's core (app.js until v1.0.5), 26 of 33: an album's tracks selected and played, and what is below the review. */
// ----- Track multi-select (album view) ------------------------------------
// Scoped to one album: every selected track shares `currentAlbum`, so the
// album identity travels once rather than per track.
function enterTrackSelectMode() {
  trackSelectMode = true;
  parkSelectMenu(true);
  modalTracks.classList.add("is-selecting");
  // An open action row and a selection are two different intents; leaving
  // the row expanded under a set of circles reads as both at once.
  modalTracks.querySelectorAll(".t-row.is-open").forEach(closeTrackRow);
  updateTrackSelection();
}

function exitTrackSelectMode() {
  trackSelectMode = false;
  trackSelected = [];
  parkSelectMenu(false);
  if (modalTracks) {
    modalTracks.classList.remove("is-selecting");
    modalTracks.querySelectorAll(".t-row.is-picked").forEach(li => {
      li.classList.remove("is-picked");
      const m = li.querySelector(".t-mark");
      if (m) m.setAttribute("aria-pressed", "false");
    });
  }
  refreshSelectMenu("tracks", 0);
}

function toggleTrackSelected(li, track, index) {
  const at = trackSelected.findIndex(x => x.index === index);
  if (at === -1) trackSelected.push({ index, title: track.title || "" });
  else           trackSelected.splice(at, 1);
  const on = at === -1;
  li.classList.toggle("is-picked", on);
  const m = li.querySelector(".t-mark");
  if (m) m.setAttribute("aria-pressed", String(on));
  updateTrackSelection();
}

function updateTrackSelection() {
  refreshSelectMenu("tracks", trackSelected.length);
}

// Play or queue the selected tracks, in the order they appear on the ALBUM —
// not the order they were tapped. Someone ticking four tracks expects the
// record's running order, not a record of their own clicking.
//
// These go one at a time on purpose: /api/play-track has no batch form, and
// firing them in parallel would interleave into an arbitrary queue order.
// [given]: a set of tracks handed in (a work's movements, album-works.js) rather than the selection; the selection is left as it is.
async function invokeTrackMulti(kind, given) {
  const zone = selectedZoneId;
  if (!currentAlbum) { showToast("No album open", "error"); return; }
  const picks = (given || trackSelected).slice().sort((a, b) => a.index - b.index);
  if (!picks.length) return;
  // Play next, several at once (v0.6.22): each goes in straight after the
  // track playing, so they are sent last to first and end up in order.
  if (kind === "play_next") picks.reverse();
  if (isPhoneAlbum(currentAlbum)) {
    picks.forEach((p, i) => invokePhone(currentAlbum, p.index, kind === "play_next" ? kind : i === 0 ? kind : "queue"));
    if (!given) exitTrackSelectMode();
    return;
  }
  if (!zone) { showToast("Pick a zone first", "error"); return; }

  let queued = 0, failed = 0, firstError = "";
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    if (picks.length > 3) showToast(`Adding track ${i + 1} of ${picks.length}…`);
    try {
      const r = await fetch("/api/play-track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset: currentAlbum.offset,
          track: p.index,
          title: p.title,
          zone_or_output_id: zone,
          // Only the FIRST track honours Play now; the rest queue behind it
          // (play_now for each would leave the last track playing alone,
          // having wiped the ones before it). Play next is every one, last
          // to first (above).
          kind: (kind === "play_next" || i === 0 ? kind : "queue"),
          album_title: currentAlbum.title || "",
          album_subtitle: currentAlbum.subtitle || "",
          filter_type:   currentDetailFilter ? currentDetailFilter.type   : "",
          filter_value:  currentDetailFilter ? currentDetailFilter.value  : "",
          filter_parent: currentDetailFilter && currentDetailFilter.parent ? currentDetailFilter.parent : ""
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { failed++; if (!firstError) firstError = j.error || `HTTP ${r.status}`; }
      else queued++;
    } catch (e) {
      failed++;
      if (!firstError) firstError = "Couldn't reach the extension";
    }
  }

  if (!queued) {
    showToast(firstError || "Sonos refused those tracks", "error", TOAST_REPORT_MS);
    return;
  }
  const verb = kind === "queue" ? "Queued" : kind === "play_next" ? "Playing next:" : "Playing";
  let msg = `${verb} ${queued} track${queued === 1 ? "" : "s"}`;
  if (failed) msg += ` (${failed} failed: ${firstError})`;
  showToast(msg, failed ? "error" : null, TOAST_REPORT_MS);
  if (!given) exitTrackSelectMode();
}

// Expand/collapse the per-track action row. Only one row is open at a time.
function closeTrackRow(li) {
  li.classList.remove("is-open");
  const row = li.querySelector(".t-actions");
  if (row) row.remove();
}
function toggleTrackActions(li, track, index) {
  const wasOpen = li.classList.contains("is-open");
  const open = modalTracks.querySelector("li.is-open");
  if (open) closeTrackRow(open);
  if (wasOpen) return;

  li.classList.add("is-open");
  const row = document.createElement("div");
  row.className = "t-actions";
  const mk = (label, kind, primary, key) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "action-btn t-act" + (primary ? " primary" : "");
    b.textContent = label;
    b.dataset.parity = key;
    b.addEventListener("click", () => invokeTrack(kind, b, track, index, li));
    return b;
  };
  row.appendChild(mk("Play now", "play_now", true, "album.track-play-now"));
  // Play next (v0.6.22): after the track playing, the rest of the queue moved down.
  row.appendChild(mk("Play next", "play_next", false, "album.track-play-next"));
  row.appendChild(mk("Queue", "queue", false, "album.track-queue"));
  li.appendChild(row);
}

// Mirrors invoke() for a single track (same zone + filter handling).
async function invokeTrack(kind, btn, track, index, li) {
  if (!currentAlbum) return;
  if (isPhoneAlbum(currentAlbum)) { if (invokePhone(currentAlbum, index, kind)) closeTrackRow(li); return; }
  if (!selectedZoneId) { showToast("Pick a zone first", "error"); return; }
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "…";
  try {
    const r = await fetch("/api/play-track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offset: currentAlbum.offset,
        track:  index,
        title:  track.title || "",
        zone_or_output_id: selectedZoneId,
        kind,
        // The album's own identity, so a drifted offset is relocated rather
        // than playing whatever record now sits at that position.
        album_title:    currentAlbum.title || "",
        album_subtitle: currentAlbum.subtitle || "",
        filter_type:   currentDetailFilter ? currentDetailFilter.type   : "",
        filter_value:  currentDetailFilter ? currentDetailFilter.value  : "",
        filter_parent: currentDetailFilter && currentDetailFilter.parent ? currentDetailFilter.parent : ""
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    const said = { play_now: "Playing", play_next: "Playing next", queue: "Queued" }[j.action || kind] || orig;
    showToast(`${said}: ${track.title} → ${zoneName(selectedZoneId)}`);
    // Success — collapse the action row; the user stays on the album.
    closeTrackRow(li);
  } catch (e) {
    showToast(e.message, "error");
    btn.disabled = false; btn.textContent = orig;
  }
}

// ----- Below the review (from Rouen v1.9.3) -------------------------------
// The library's other albums by this album's lead artist and the albums
// they appear on (/api/artist-albums: the library in memory, nothing asked
// outside), then Last.fm's similar artists and similar albums. Three of
// each; More shows the rest. A section stays hidden until it has something
// to show, and an answer for an album that is no longer open is dropped.
//
// What a tile does is visible before it is tapped: one in the library looks
// like every other album or artist here and opens in Mandarin; one only
// Last.fm knows carries "Last.fm ↗" and opens its Last.fm page.
//
// State is kept on the functions, not in module-level lets: openAlbum can
// run before this point in the file is reached (a page restored).
function moreSectionIds() {
  return ["album-more-by", "album-more-appears", "album-lastfm-artists", "album-lastfm-albums"];
}
function resetMoreSections() {
  // The previous album's requests, abandoned: the server stops asking
  // Last.fm for an answer nobody will read.
  if (resetMoreSections.abort) { try { resetMoreSections.abort.abort(); } catch (e) { /* already done */ } resetMoreSections.abort = null; }
  for (const id of moreSectionIds()) {
    const sec = document.getElementById(id);
    if (!sec) continue;
    sec.classList.add("hidden");
    const grid = sec.querySelector(".more-grid");
    if (grid) grid.textContent = "";
    const note = sec.querySelector(".more-note");
    if (note) note.remove();
    const toggle = sec.querySelector(".more-toggle");
    if (toggle) { toggle.classList.add("hidden"); toggle.setAttribute("aria-expanded", "false"); toggle.textContent = "More"; }
    const site = sec.querySelector(".more-site");
    if (site) { site.classList.add("hidden"); site.removeAttribute("href"); }
    if (!sec.__wired && toggle) {
      sec.__wired = true;
      toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") !== "true";
        for (const el of sec.querySelectorAll(".more-extra")) el.classList.toggle("hidden", !open);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.textContent = open ? "Less" : "More";
      });
    }
  }
}
// Fill one section: the first three shown, the rest behind More.
function fillMoreSection(id, items, build, title) {
  const SHOWN = 3;
  const sec = document.getElementById(id);
  if (!sec) return;
  const grid = sec.querySelector(".more-grid");
  const toggle = sec.querySelector(".more-toggle");
  if (title) { const t = sec.querySelector(".more-title"); if (t) t.textContent = title; }
  grid.textContent = "";
  if (!Array.isArray(items) || !items.length) { sec.classList.add("hidden"); return; }
  items.forEach((it, i) => {
    const el = build(it);
    if (sec.dataset.parityItem) el.dataset.parity = sec.dataset.parityItem;   // its key in the screens contract
    if (i >= SHOWN) el.classList.add("more-extra", "hidden");
    grid.appendChild(el);
  });
  toggle.classList.toggle("hidden", items.length <= SHOWN);
  toggle.setAttribute("aria-expanded", "false");
  toggle.textContent = "More";
  sec.classList.remove("hidden");
}
// A Last.fm section that cannot answer because of the key says so — the one
// failure the user can fix. Anything else (Last.fm slow, an artist it does
// not know) leaves the section out.
function moreNote(id, text) {
  const sec = document.getElementById(id);
  if (!sec) return;
  const note = document.createElement("p");
  note.className = "more-note";
  note.textContent = text;
  sec.querySelector(".more-grid").after(note);
  sec.classList.remove("hidden");
}
function openLastfmPage(url) {
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
function lastfmTag() {
  const tag = document.createElement("div");
  tag.className = "more-ext";
  tag.textContent = "Last.fm \u2197";
  return tag;
}
// An album in the library: the album view.
function moreAlbumTile(a) {
  return buildAlbumTile(a, () => openAlbum(a, { filter: null }), { selectable: false });
}
// A Last.fm album: the library's own when it has it, else its Last.fm page.
function lastfmAlbumTile(al) {
  if (al.album) return moreAlbumTile(al.album);
  const tile = buildAlbumTile({ title: al.title, subtitle: al.artist, image_key: al.image_key || null },
                              () => openLastfmPage(al.url), { selectable: false });
  tile.classList.add("is-external");
  tile.setAttribute("aria-label", tile.getAttribute("aria-label") + " on Last.fm");
  (tile.querySelector(".album-meta") || tile).appendChild(lastfmTag());
  return tile;
}
// A similar artist: their page here when the library has them (with one of
// their covers to stand for them), else their Last.fm page.
function lastfmArtistTile(a) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "more-artist" + (a.in_library ? "" : " is-external");
  btn.setAttribute("aria-label", a.in_library ? a.name : a.name + " on Last.fm");
  const pic = document.createElement("div");
  pic.className = "more-artist-pic";
  const initial = document.createElement("span");
  initial.className = "more-artist-initial";
  initial.textContent = (String(a.name || "").trim().charAt(0) || "?").toUpperCase();
  pic.appendChild(initial);
  if (a.image_key) loadArt(pic, a.image_key, tileImgSize());
  const name = document.createElement("div");
  name.className = "more-artist-name";
  name.textContent = a.name;
  btn.append(pic, name);
  if (!a.in_library) btn.appendChild(lastfmTag());
  btn.addEventListener("click", () => {
    if (!a.in_library) { openLastfmPage(a.url); return; }
    // As the album view's own artist links: its Back comes back here.
    const fromAlbum = currentAlbum ? { album: currentAlbum, opts: { source: currentSource, zoneId: currentSourceZoneId, filter: currentDetailFilter } } : null;
    closeModal();
    if (window.__showArtistAlbums) window.__showArtistAlbums(a.name, { fromAlbum });
  });
  return btn;
}

async function fetchAlbumMore(album, lead) {
  lead = String(lead || "").trim();
  // The phone's own music has no place in the server's library.
  if (!lead || isPhoneAlbum(album) || album.offset == null) return;
  const json = (r) => (r.ok ? r.json() : null);
  const mine = () => album === currentAlbum && !modal.classList.contains("hidden") && !modal.classList.contains("np-mode");
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  resetMoreSections.abort = ctl;
  const opt = ctl ? { signal: ctl.signal } : {};
  const byTitle = (a, b) => String(a.title || "").localeCompare(String(b.title || ""));
  const library = fetch("/api/artist-albums?" + new URLSearchParams({ artist: lead }), opt)
    .then(json).then((j) => {
      if (!j || !mine()) return;
      // Not the album being looked at — by its id, so another pressing of
      // the same title by the same act stays.
      const by = (j.primary || []).filter(a => a.offset !== album.offset).sort(byTitle);
      const appears = (j.featured || []).filter(a => a.offset !== album.offset).sort(byTitle);
      fillMoreSection("album-more-by", by, moreAlbumTile, "More by " + lead);
      fillMoreSection("album-more-appears", appears, moreAlbumTile, lead + " appears on");
    });
  const q = new URLSearchParams({ artist: lead });
  const lastfm = fetch("/api/lastfm/similar-artists?" + q, opt).then(json).then((j) => {
    // No key: Last.fm is simply not here, and the albums are not asked for.
    if (!j || !j.enabled || !mine()) return;
    if (j.error) { if (/key/i.test(j.error)) moreNote("album-lastfm-artists", j.error + " — Settings → Setup → API Keys."); return; }
    fillMoreSection("album-lastfm-artists", j.artists, lastfmArtistTile);
    const site = document.querySelector("#album-lastfm-artists .more-site");
    if (site && j.url && j.artists && j.artists.length) { site.href = j.url; site.classList.remove("hidden"); }
    return fetch("/api/lastfm/similar-albums?" + q, opt).then(json).then((k) => {
      if (!k || !k.enabled || k.error || !mine()) return;
      fillMoreSection("album-lastfm-albums", k.albums, lastfmAlbumTile);
    });
  });
  await Promise.allSettled([library, lastfm]);
}

async function fetchAlbumExtras(album) {
  if (!album) return;
  const params = new URLSearchParams({
    title:  album.title    || "",
    artist: album.subtitle || "",
    // This screen shows the full release date, so it asks the server to look
    // the day up if it has only the year (the other callers do not wait).
    day:    "1"
  });
  const askedAs = (album.title || "") + "\u0001" + (album.subtitle || "");
  const r = await fetch(`/api/album/extras?${params}`);
  if (!r.ok) return;
  const j = await r.json();
  // Modal may have been closed/reopened while we waited; bail if so.
  if (album !== currentAlbum) return;
  // Or renamed meanwhile (the page caught up with an edit): a newer ask
  // under the new names is on its way, and this answer is for the old ones.
  if ((album.title || "") + "\u0001" + (album.subtitle || "") !== askedAs) return;
  renderExtras(j, album);
}

// "2026-09-25" as the device writes a date ("25 September 2026" or
// "September 25, 2026"), "2026-09" as a month, "2026" as it is. Read as UTC,
// because a bare date parsed in a timezone west of Greenwich is the evening
// before. "" for anything else.
function formatReleaseDate(s) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(String(s || ""));
  if (!m) return "";
  if (!m[2]) return m[1];
  const opts = { year: "numeric", month: "long", timeZone: "UTC" };
  if (m[3]) opts.day = "numeric";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1));
  // "2026-13-40" would roll over into another month rather than fail.
  if (isNaN(d.getTime()) || d.getUTCMonth() !== Number(m[2]) - 1 ||
      (m[3] && d.getUTCDate() !== Number(m[3]))) return m[1];
  try { return d.toLocaleDateString(undefined, opts); }
  catch (e) { return m[1]; /* no Intl on this device: the year is still right */ }
}
