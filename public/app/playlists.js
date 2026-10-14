/* The page's core (app.js until v1.0.5), 10 of 33: a selection added to a playlist, and the playlists kept here. */
// ----- Add a selection to a playlist --------------------------------------
// Tracks go in as themselves. ALBUMS cannot: a stored entry names a specific
// track, and the album's tracklist only exists on the Core. Rather than
// opening every selected album — seconds of Roon calls behind a menu tap —
// this says so plainly and leaves the album selection intact.
async function addSelectionToPlaylist() {
  if (selMenuKind === "albums") {
    if (!albumSelected.length) return;
    // Every track of every selected album. The album's tracklist only exists
    // on the Core, so this is the one add that costs Roon calls — bounded
    // server-side and reported per album.
    openAddToPlaylistSheet(null, albumSelected.map(a => ({
      offset: a.offset, title: a.title || "", subtitle: a.subtitle || "",
      image_key: a.image_key || null,
    })));
    return;
  }
  if (!currentAlbum) { showToast("No album open", "error"); return; }
  const picks = trackSelected.slice().sort((a, b) => a.index - b.index);
  if (!picks.length) return;
  const entries = picks.map(p => ({
    album_offset:   currentAlbum.offset,
    album_title:    currentAlbum.title || "",
    album_subtitle: currentAlbum.subtitle || "",
    track_index:    p.index,
    title:          p.title,
    subtitle:       currentAlbum.subtitle || "",
    image_key:      currentAlbum.image_key || null,
  }));
  openAddToPlaylistSheet(entries, null);
}

// Exactly one of `entries` (tracks) and `albums` is supplied. They land on
// different routes because only the album one has to talk to Roon.
async function openAddToPlaylistSheet(entries, albums) {
  const n = entries ? entries.length : (albums || []).length;
  if (!n) { showToast("Nothing to add", "error"); return; }
  let list = [];
  try {
    const r = await fetch("/api/user-playlists", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast("Couldn't read your playlists", "error"); return; }
    list = j.playlists || [];
  } catch (e) {
    showToast("Couldn't reach the extension", "error");
    return;
  }

  const what = entries
    ? `${n} track${n === 1 ? "" : "s"}`
    : `${n} album${n === 1 ? "" : "s"}`;
  openLibSheet(`Add ${what} to…`,
    (body, close) => {
      const row = (label, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "action-btn sheet-row";
        // textContent, never a template: a playlist name is user text and
        // this sheet has no business interpreting it as markup.
        b.textContent = label;
        b.addEventListener("click", () => { close(); fn(); });
        body.appendChild(b);
      };
      row("＋ New playlist…", async () => {
        const name = await askName("Name this playlist", "My playlist");
        if (name === null) return;
        const trimmed = String(name).trim();
        if (!trimmed) { showToast("Give it a name", "error"); return; }
        addToUserPlaylist({ name: trimmed }, entries, albums).then(ok => {
          if (ok) clearAfterAdd();
        });
      });
      for (const p of list) {
        row(`${p.name} · ${p.track_total} track${p.track_total === 1 ? "" : "s"}`, () => {
          addToUserPlaylist({ id: p.id }, entries, albums).then(ok => {
            if (ok) clearAfterAdd();
          });
        });
      }
    });
}

// ----- Playlists stored by this extension ---------------------------------
// These share the Playlists wall with Roon's own (see showPlaylists) — there
// is no separate screen, so there is no separate list renderer either.

async function openUserPlaylist(p) {
  enterFullWall("");   // the stored playlist prints its own full-width heading
  userPlDetailActive = true;
  const mySeq = ++userPlSeq;
  setBanner(null);
  grid.innerHTML = "";

  let j = null;
  try {
    const r = await fetch(`/api/user-playlist?id=${encodeURIComponent(p.id)}`, { cache: "no-store" });
    j = await r.json().catch(() => ({}));
    if (!userPlDetailActive || mySeq !== userPlSeq) return;
    if (!r.ok) { setBanner(j.error || "Couldn't open that playlist.", true); return; }
  } catch (e) {
    if (!userPlDetailActive || mySeq !== userPlSeq) return;
    setBanner("Couldn't reach the extension.", true);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "playlist-detail";

  const back = document.createElement("button");
  back.type = "button"; back.className = "action-btn playlist-back";
  back.textContent = "← Playlists";
  back.addEventListener("click", () => { userPlDetailActive = false; showPlaylists(); });
  wrap.appendChild(back);

  const head = document.createElement("div");
  head.className = "playlist-head";
  const h = document.createElement("h2");
  h.className = "playlist-title";
  h.textContent = j.name || "Playlist";
  head.appendChild(h);
  const sub = document.createElement("div");
  sub.className = "playlist-sub";
  sub.textContent = `${j.track_total} track${j.track_total === 1 ? "" : "s"}`;
  head.appendChild(sub);
  wrap.appendChild(head);

  const tracks = j.tracks || [];
  const actions = document.createElement("div");
  actions.className = "playlist-actions";
  const mkBtn = (label, cls, fn) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = cls; b.textContent = label;
    b.addEventListener("click", () => fn(b));
    actions.appendChild(b);
    return b;
  };
  mkBtn("Play now", "action-btn primary", (b) => playUserPlaylist(tracks, "play_now", b));
  mkBtn("Queue",    "action-btn",         (b) => playUserPlaylist(tracks, "queue", b));
  const shareThisPlaylist = (b) => shareTracks(j.name || "Playlist",
    tracks.map(t => ({
      title: t.title, artist: t.subtitle,
      album: t.album_title, track_no: t.track_no
    })), b, {});
  const deleteThisPlaylist = async () => {
    const ok = await confirmDialog(`Delete "${j.name}"? This can't be undone.`);
    if (!ok) return;
    try {
      const r = await fetch("/api/user-playlists/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id })
      });
      if (!r.ok) { showToast("Couldn't delete that", "error"); return; }
      showToast("Playlist deleted");
      if (window.__playlistsChanged) window.__playlistsChanged();
      userPlDetailActive = false;
      showPlaylists();
    } catch (e) { showToast("Couldn't reach the extension", "error"); }
  };
  actions.appendChild(buildOverflowMenu([
    { label: "Share",  onClick: (b) => shareThisPlaylist(b) },
    { label: "Delete", onClick: () => deleteThisPlaylist(), danger: true },
  ], { title: j.name || "Playlist" }));
  wrap.appendChild(actions);

  const ol = document.createElement("ol");
  ol.className = "track-list playlist-tracks";
  for (const t of tracks) ol.appendChild(userTrackRow(t));
  wrap.appendChild(ol);

  if (!tracks.length) {
    const empty = document.createElement("div");
    empty.className = "playlist-empty";
    empty.textContent = "Nothing in this playlist yet.";
    wrap.appendChild(empty);
  }
  grid.appendChild(wrap);
}

// Same row shape as the smart-playlist screen — artwork, two lines, tap to
// play from its album.
function userTrackRow(t) {
  const li = document.createElement("li");
  li.className = "track-row track-row-art";
  li.dataset.albumOffset = String(t.album_offset);

  const art = document.createElement("span");
  art.className = "track-art";
  if (t.image_key) {
    art.dataset.artKey = t.image_key;
    const img = document.createElement("img");
    img.loading = "lazy"; img.alt = "";
    img.src = `/api/image/${encodeURIComponent(t.image_key)}?size=80`;
    img.onerror = () => { art.classList.add("no-image"); img.remove(); };
    art.appendChild(img);
  } else {
    art.classList.add("no-image");
  }
  li.appendChild(art);

  const text = document.createElement("div");
  text.className = "track-text";
  const tt = document.createElement("div");
  tt.className = "track-title";
  tt.textContent = t.title || "";
  text.appendChild(tt);
  const ta = document.createElement("div");
  ta.className = "track-artist";
  ta.textContent = [t.subtitle, t.album_title].filter(Boolean).join(" · ");
  text.appendChild(ta);
  li.appendChild(text);

  li.addEventListener("click", async () => {
    const zsel = document.getElementById("zone-select");
    const zone = (zsel && zsel.value) || selectedZoneId;
    if (!zone) { showToast("Choose a zone first", "error"); return; }
    try {
      const r = await fetch("/api/play-track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset: t.album_offset, track: t.track_index, title: t.title,
          zone_or_output_id: zone, kind: "play_now",
          // A stored entry can be months old, so the album identity matters
          // far more here than it does from a modal opened seconds ago.
          album_title: t.album_title, album_subtitle: t.album_subtitle
        })
      });
      const j2 = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(j2.error || "Couldn't play that track", "error"); return; }
      showToast(`Playing ${t.title}`);
    } catch (e) { showToast("Couldn't reach the extension", "error"); }
  });
  return li;
}

// Sequential by necessity: /api/play-track has no batch form, and firing
// these in parallel would interleave into an arbitrary queue order.
async function playUserPlaylist(tracks, kind, btn) {
  const zsel = document.getElementById("zone-select");
  const zone = (zsel && zsel.value) || selectedZoneId;
  if (!zone) { showToast("Choose a zone first", "error"); return; }
  if (!tracks.length) { showToast("Nothing in this playlist", "error"); return; }
  btn.disabled = true;
  let queued = 0, failed = 0, firstError = "";
  try {
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (tracks.length > 3) showToast(`Adding track ${i + 1} of ${tracks.length}…`);
      try {
        const r = await fetch("/api/play-track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offset: t.album_offset, track: t.track_index, title: t.title,
            zone_or_output_id: zone,
            // Only the first honours the kind; the rest queue behind it.
            kind: (i === 0 ? kind : "queue"),
            album_title: t.album_title, album_subtitle: t.album_subtitle
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
  } finally {
    btn.disabled = false;
  }
  if (!queued) { showToast(firstError || "Sonos refused those tracks", "error", TOAST_REPORT_MS); return; }
  const verb = kind === "queue" ? "Queued" : kind === "play_next" ? "Playing next:" : "Playing";
  let msg = `${verb} ${queued} track${queued === 1 ? "" : "s"}`;
  if (failed) msg += ` (${failed} couldn't be found: ${firstError})`;
  showToast(msg, failed ? "error" : null, TOAST_REPORT_MS);
}
