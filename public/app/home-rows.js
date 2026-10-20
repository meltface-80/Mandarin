/* The page's core (app.js until v1.0.5), 5 of 33: Home's Library, History, Favourites, Listen later and Playlists rows, and the Smart Picks cards. */
async function loadHomeLibrary() {
  if (!homeLibrary) return;
  if (!rowHasContent(homeLibrary)) homeLibrary.innerHTML = emptyRow("Loading…");
  // Captured BEFORE the request: the answer describes the order that was
  // current when it was asked for, and the user can change Sort while it is
  // in the air.
  const key = libSortKey();
  try {
    const r = await fetch("/api/library/albums?offset=0&count=30&" + key);
    // Any non-OK response (503 while the index builds, 500 on a transient
    // server error) keeps the cached tiles — a built index never legitimately
    // returns zero albums, so blanking the row to "No albums." would only
    // ever be showing an error as an empty state.
    if (!r.ok) {
      if (!rowHasContent(homeLibrary)) homeLibrary.innerHTML = emptyRow("Reading your music library…");
      return;   // retried on the next Home visit (homeLibraryKey stays unset)
    }
    const j = await r.json();
    const albums = (j && j.albums) || [];
    // The order changed while this was in flight. Painting it would put the
    // previous order on screen and, worse, record it as the current one — so
    // the row would look settled on an order the user had already replaced.
    if (key !== libSortKey()) return;
    if (albums.length) {
      renderHomeLibrary(albums);
      homeLibraryKey = key;   // this order is loaded — don't refetch it
      saveHomeCache({ library: albums, librarySort: key });
    } else if (!rowHasContent(homeLibrary)) {
      renderHomeLibrary([]);   // genuinely empty and nothing cached — show the empty state
    }
  } catch (e) {
    if (!rowHasContent(homeLibrary)) homeLibrary.innerHTML = emptyRow("Couldn’t load.");
  }
}

// Recently played — one tile per album, newest first, 30 days.
//
// The section stays hidden until there is something in it: a fresh install
// has no history, and an empty shelf labelled "Recently played" reads like a
// fault rather than an absence.
function renderHomeHistory(albums) {
  if (!homeHistory) return;
  renderAlbumRow(homeHistory, albums);
  const sec = homeHistory.closest(".home-section");
  if (sec) sec.classList.toggle("hidden", !albums.length || !homeRowOn("history"));
}
// ----- Favourites: the hearted albums, newest first -----
function renderHomeFavourites(albums) {
  if (!homeFavourites) return;
  renderAlbumRow(homeFavourites, albums);
  const sec = homeFavourites.closest(".home-section");
  if (sec) sec.classList.toggle("hidden", !albums.length || !homeRowOn("favourites"));
}
async function loadHomeFavourites() {
  if (!homeFavourites) return;
  try {
    const r = await fetch("/api/favourites", { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    renderHomeFavourites((j && j.albums) || []);
    homeFavouritesLoaded = true;
  } catch (e) { /* next visit tries again */ }
}
// A heart tapped anywhere: the row shows it at once.
window.__favouritesChanged = () => { homeFavouritesLoaded = false; loadHomeFavourites(); };

// ----- Listen later: albums put aside, newest first -----
function renderHomeLater(albums) {
  if (!homeLater) return;
  renderAlbumRow(homeLater, albums);
  const sec = homeLater.closest(".home-section");
  if (sec) sec.classList.toggle("hidden", !albums.length || !homeRowOn("later"));
}
async function loadHomeLater() {
  if (!homeLater) return;
  try {
    const r = await fetch("/api/listen-later", { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    renderHomeLater((j && j.albums) || []);
    homeLaterLoaded = true;
  } catch (e) { /* the row keeps what it had */ }
}
window.__listenLaterChanged = () => { homeLaterLoaded = false; loadHomeLater(); };
// On or off the list, for one album or several; the row and the wall follow.
async function setListenLater(offsets, on) {
  const ids = (Array.isArray(offsets) ? offsets : [offsets]).filter(o => typeof o === "number");
  if (!ids.length) { showToast("Only the library's albums can be put aside", "error"); return false; }
  try {
    const r = await fetch("/api/listen-later", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offsets: ids, on }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    showToast(on ? (ids.length === 1 ? "Put aside to listen later" : ids.length + " albums put aside to listen later") : "Taken off Listen later");
    if (window.__listenLaterChanged) window.__listenLaterChanged();
    if (laterWallActive) showLaterWall();
    return true;
  } catch (e) { showToast(e.message, "error"); return false; }
}
window.__setListenLater = setListenLater;

// ----- Playlists: yours and the Dynamic ones, one row -----
// The side menu keeps the two apart (different screens); on Home they are
// one shelf, your own first, then the Dynamic ones. The title opens the
// Playlists wall; a Dynamic tile opens that playlist.
function renderHomePlaylists(mine, smart) {
  if (!homePlaylists) return;
  homePlaylists.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const p of mine) {
    const n = p.track_total;
    frag.appendChild(keyPlaylistTile(buildAlbumTile({ title: p.name, subtitle: `${n} track${n === 1 ? "" : "s"}`, image_key: null, art_keys: p.art_keys || [] },
      () => openUserPlaylist(p), { selectable: false })));
  }
  for (const p of smart) {
    const n = Number.isFinite(p.count) ? p.count : p.album_total;
    frag.appendChild(keyPlaylistTile(buildAlbumTile({ title: p.name, subtitle: "Dynamic · " + (Number.isFinite(n) ? `${n} album${n === 1 ? "" : "s"}` : describeLibView(p.view)), image_key: null, art_keys: p.art_keys || [] },
      () => openSmartPlaylist(p), { selectable: false })));
  }
  homePlaylists.appendChild(frag);
  const sec = homePlaylists.closest(".home-section");
  if (sec) sec.classList.toggle("hidden", !(mine.length + smart.length) || !homeRowOn("playlists"));
}
async function loadHomePlaylists() {
  if (!homePlaylists) return;
  const read = async (url) => { try { const r = await fetch(url, { cache: "no-store" }); return r.ok ? await r.json() : null; } catch (e) { return null; } };
  const [mine, smart] = await Promise.all([read("/api/user-playlists"), read("/api/smart-playlists")]);
  if (mine === null && smart === null) return;   // the row keeps what it had
  const my = ((mine && mine.playlists) || []).slice().sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  renderHomePlaylists(my, (smart && smart.playlists) || []);
  homePlaylistsLoaded = true;
}
// A playlist made, changed or deleted anywhere: the row follows.
window.__playlistsChanged = () => { homePlaylistsLoaded = false; loadHomePlaylists(); };

async function loadHomeHistory() {
  if (!homeHistory) return;
  try {
    const r = await fetch("/api/home/history?count=30");
    if (!r.ok) return;   // retried next visit — homeHistoryLoaded stays false
    const j = await r.json();
    const albums = (j && j.albums) || [];
    renderHomeHistory(albums);
    // Marked loaded even when empty: an empty history is a real answer, and
    // retrying it on every Home visit would query the plays table forever on
    // a box nobody has played anything from.
    homeHistoryLoaded = true;
    if (albums.length) saveHomeCache({ history: albums });
  } catch (e) {
    // Offline or the server went away. The row keeps whatever it had; the
    // next visit tries again.
  }
}

// -------------------------------------------------------------------------
// Smart Picks — five albums a day by artists NOT in the library.
//
// These albums are NOT in Roon, so they have no offset and cannot be played
// or queued. The only action is Add, which favourites the album on the
// connected streaming service; Roon imports it and it becomes playable on the
// next sync. That is why this uses its own card rather than homeTile(), whose
// tap handlers all assume an offset into the albums hierarchy.
// -------------------------------------------------------------------------

// Today, in the viewer's own timezone.
//
// This is deliberately NOT compared against the server's `day`. The container
// sets no TZ and runs UTC, so for anyone east or west of Greenwich the two
// strings differ for part of every day — and the guard below would then be
// permanently true, refetching and re-rendering the row on every Back tap.
// "Has the day rolled over" is a question about the VIEWER's midnight, so the
// client answers it with its own clock and stores its own key.
function localDayKey() {
  const d = new Date();
  const p = (n) => (n < 10 ? "0" + n : String(n));
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function smartPickAddLabel(added) { return added ? "✓ Added" : "＋ Add"; }

// Favourite a pick's album on whichever service it came from. On success the
// button latches to Added rather than toggling back off: this is a one-way
// "put it in my library" action, and an accidental second tap that silently
// un-favourited it would be much worse than a no-op.
async function addSmartPick(pick, button) {
  if (!pick.album_id || !pick.service) {
    showToast("No streaming album to add", "error");
    return;
  }
  const before = button.textContent;
  button.disabled = true;
  button.textContent = "…";
  try {
    const r = await fetch("/api/" + pick.service + "/favorite", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ album_id: pick.album_id })
    });
    const j = await r.json();
    if (j && j.ok) {
      // Deliberately not just "Added": the album is in the streaming library
      // now, but Roon imports on its own schedule, and the first version's
      // bare "Added" left people wondering why they still could not play it.
      button.textContent = "✓ Added";
      button.classList.add("is-done");
      button.disabled = true;
      button.dataset.added = "1";
      showToast("Added to your Qobuz favourites", "ok");
    } else {
      button.textContent = before;
      button.disabled = false;
      showToast((j && j.error) || "Couldn't add that album", "error");
    }
  } catch (e) {
    button.textContent = before;
    button.disabled = false;
    showToast("Failed: " + e.message, "error");
  }
}

// "Not for me" — permanent, and only ever from an explicit tap. Silence is
// never treated as rejection: the whole premise is albums the user would not
// otherwise reach for, so a pick they simply ignored has to be allowed back.
async function blockSmartPick(pick, card) {
  try {
    const r = await fetch("/api/smart-picks/block", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artist: pick.artist })
    });
    const j = await r.json();
    if (j && j.ok) {
      if (card && card.parentNode) card.parentNode.removeChild(card);
      showToast("Won't suggest " + pick.artist + " again", "ok");
    } else {
      showToast((j && j.error) || "Couldn't save that", "error");
    }
  } catch (e) {
    showToast("Failed: " + e.message, "error");
  }
}

// One pick. `full` adds the reason line and the action buttons — the Home
// carousel stays a plain tile so it reads like the rows around it.
function smartPickCard(pick, full) {
  // The screens contract's keys (docs/specs/screens.json): the card on the Smart Picks screen (`picks`) and on Home (`home`), each written whole.
  const K = full ? { art: "picks.pick-art", artist: "picks.pick-artist", album: "picks.pick-album", reason: "picks.pick-reason", open: "picks.open", added: "picks.added", add: "picks.add", block: "picks.block" }
                 : { card: "home.pick", art: "home.pick-art", artist: "home.pick-artist", album: "home.pick-album" };
  const card = document.createElement("div");
  card.className = "pick-card" + (full ? " pick-card-full" : "");
  const art = document.createElement("div");
  art.className = "pick-art"; art.dataset.parity = K.art;
  if (pick.image) {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "";
    img.src = pick.image;
    art.appendChild(img);
  }
  card.appendChild(art);

  const meta = document.createElement("div");
  meta.className = "pick-meta";
  const artist = document.createElement("div");
  artist.className = "pick-artist"; artist.dataset.parity = K.artist;
  artist.textContent = pick.artist;
  meta.appendChild(artist);
  const album = document.createElement("div");
  album.className = "pick-album"; album.dataset.parity = K.album;
  album.textContent = pick.album || "";
  meta.appendChild(album);
  // The reason is on the Smart Picks page only; the Home tile stays a
  // plain tile like the rows around it.
  if (pick.reason && full) {
    const why = document.createElement("div");
    why.className = "pick-reason"; why.dataset.parity = K.reason;
    why.textContent = pick.reason;
    meta.appendChild(why);
  }
  card.appendChild(meta);

  if (full) {
    const actions = document.createElement("div");
    actions.className = "pick-actions";

    // Three states, and which one a pick is in is entirely about whether Roon
    // has it yet:
    //
    //   OPEN     — the library has it, so it has an offset and opens as any
    //              album does (Play Now and the rest are on its page). This
    //              is where the picks should be by morning when adding
    //              automatically is on.
    //   WAITING  — favourited on the service but not imported yet. Roon
    //              decides when, so there is nothing to press.
    //   ADD      — not in the streaming library. Where every pick sits when
    //              automatic adding is off.
    if (pick.offset !== null && pick.offset !== undefined) {
      const play = document.createElement("button");
      play.type = "button";
      play.className = "pick-add pick-play"; play.dataset.parity = K.open;
      play.textContent = "Open";
      play.addEventListener("click", () => openAlbum({
        offset:    pick.offset,
        // Roon's OWN strings for the album, not Qobuz's — the play routes
        // check identity against the snapshot, and an edition suffix that
        // differs would be refused as a stale offset.
        title:     pick.library_title || pick.album || "",
        subtitle:  pick.library_subtitle || pick.artist || "",
        image_key: pick.image_key || null
      }, { filter: null }));
      actions.appendChild(play);
    } else if (pick.added) {
      const wait = document.createElement("button");
      wait.type = "button";
      wait.className = "pick-add is-done"; wait.dataset.parity = K.added;
      wait.disabled = true;
      wait.textContent = "✓ Added";
      actions.appendChild(wait);
    } else {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "pick-add"; add.dataset.parity = K.add;
      add.textContent = smartPickAddLabel(false);
      add.addEventListener("click", () => addSmartPick(pick, add));
      actions.appendChild(add);
    }

    const nope = document.createElement("button");
    nope.type = "button";
    nope.className = "pick-block"; nope.dataset.parity = K.block;
    nope.textContent = "Not for me";
    nope.addEventListener("click", () => blockSmartPick(pick, card));
    actions.appendChild(nope);
    card.appendChild(actions);
  } else {
    // On Home the whole tile opens the full screen, where the reason and the
    // actions live. A tile that did nothing on tap would read as broken.
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.dataset.parity = K.card;
    card.setAttribute("aria-label", pick.artist + " — " + (pick.album || ""));
    // A pick Roon already has behaves like any other album tile; one it does
    // not opens the Smart Picks screen, where Add and the reason live.
    const open = () => {
      if (pick.offset !== null && pick.offset !== undefined) {
        openAlbum({
          offset:    pick.offset,
          title:     pick.library_title || pick.album || "",
          subtitle:  pick.library_subtitle || pick.artist || "",
          image_key: pick.image_key || null
        }, { filter: null });
      } else {
        showSmartPicks();
      }
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  }
  return card;
}

function renderHomePicks(picks) {
  if (!homePicks) return false;
  const sec = homePicks.closest(".home-section");
  if (!picks || !picks.length) {
    // Nothing built yet. Hide the section rather than show an empty row —
    // the first build runs in the background and may take a minute.
    if (sec) sec.classList.add("hidden");
    return false;
  }
  if (sec) sec.classList.toggle("hidden", !homeRowOn("picks"));   // never un-hide a row the layout switched off
  homePicks.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const p of picks) frag.appendChild(smartPickCard(p, false));
  homePicks.appendChild(frag);
  return true;
}
