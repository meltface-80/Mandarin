/* The page's core (app.js until v1.0.5), 14 of 33: smart playlists: the list, and one saved. */
// ----- Smart playlists ---------------------------------------------------
//
// A smart playlist is just a saved library view (sort + focus), re-evaluated
// every time it's opened. It runs entirely on the extension's own album
// snapshot — the same engine as the Library screen — so it makes NO Roon calls
// and adds nothing to the Core's memory. Opening one applies its view and
// shows the library wall; there is no separate screen to maintain.
// Derived from LIB_FACET_IDS rather than listed again: a facet added to that
// array is savable immediately, instead of working on the Library screen and
// silently vanishing the moment somebody saves the view as a playlist.
const SMART_VIEW_KEYS = ["sort", "dir", "seed", "played"].concat(LIB_FACET_IDS);

function currentLibViewSnapshot() {
  const out = {};
  for (const k of SMART_VIEW_KEYS) {
    out[k] = Array.isArray(libView[k]) ? libView[k].slice() : libView[k];
  }
  return out;
}

// A one-line human description, so the picker says what a saved view DOES
// rather than only what it was named.
function describeLibView(v) {
  const bits = [];
  const sortOpt = LIB_SORT_OPTIONS.find(o => o.id === v.sort);
  if (sortOpt) bits.push(sortOpt.label + (v.dir === "desc" ? " ↓" : " ↑"));
  // Decades read as "1980s"; everything else is already a display name, and
  // an excluded value says so rather than reading as if it were included.
  const shown = (id, val) => (val.charAt(0) === "!" ? "not " : "") +
    (id === "decade" ? val.replace("!", "") + "s" : val.replace(/^!/, ""));
  for (const id of LIB_FACET_IDS) {
    const sel = v[id];
    if (Array.isArray(sel) && sel.length) bits.push(sel.map(x => shown(id, x)).join(", "));
  }
  if (v.played && v.played !== "any") {
    const opt = LIB_PLAYED_OPTIONS.find(p => p.id === v.played);
    bits.push(opt ? opt.label.toLowerCase() : "not played in " + v.played + " months");
  }
  return bits.join(" · ");
}

// Returns null on failure, [] for a genuinely empty list. The caller must tell
// them apart: rendering "No Dynamic Playlists yet" after a network blip reads as
// "your saved playlists are gone".
async function fetchSmartPlaylists() {
  try {
    const r = await fetch("/api/smart-playlists", { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j.playlists) ? j.playlists : null;
  } catch (e) {
    return null;
  }
}

function saveSmartPlaylistPrompt(existing) {
  // NOT describeLibView(): using the description as the default name printed
  // the same string as both the row's title and its subtitle.
  const suggested = (existing && existing.name) || "My Dynamic Playlist";
  (async () => {
    const name = await askName("Name this Dynamic Playlist", suggested);
    if (name === null) return;                 // cancelled
    const trimmed = String(name).trim();
    if (!trimmed) { showToast("Give it a name", "error"); return; }
    try {
      const r = await fetch("/api/smart-playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: existing && existing.id, name: trimmed,
                               view: currentLibViewSnapshot(),
                               // Editing keeps whatever the playlist already
                               // had; a new one takes the server's default.
                               limit: existing && existing.limit,
                               // Set by the create sheet before the focus
                               // screen opens, and preserved through an edit.
                               mode:  existing && existing.mode,
                               // Set in the focus sheet's Order section.
                               order: existing && existing.order })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(j.error || "Couldn't save that", "error"); return; }
      if (window.__playlistsChanged) window.__playlistsChanged();
      const lim = j.playlist && j.playlist.limit;
      const matched = j.playlist && j.playlist.album_matched;
      showToast(Number.isFinite(matched) && Number.isFinite(lim) && matched > lim
        ? `Saved "${trimmed}" — it plays ${lim} of the ${matched} albums that match. ` +
          "Change that with Edit."
        : `Saved "${trimmed}"`, null, TOAST_REPORT_MS);
      // Editing an existing one lands back on it so the change is visible
      // immediately; a brand new one goes to the list.
      if (j.playlist && existing) openSmartPlaylist(j.playlist);
      else showSmartPlaylists();
    } catch (e) {
      showToast("Couldn't save that", "error");
    }
  })();
}

// Smart playlists get the same shape as Roon playlists: a wall of tiles, and a
// detail screen listing TRACKS with each track's album artwork. They used to
// open the library wall with the view applied, which was the query working
// correctly but reading as "it just took me to the library".
// "New Dynamic Playlist", as the first tile of the wall. Built on .album so it
// sizes with the grid at every width — the same approach as Home's unheard
// tile, and for the same reason: no breakpoints of its own to get wrong.
function buildNewSmartTile() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "album home-unheard-tile";
  btn.id = "new-smart-tile"; btn.dataset.parity = "smart-playlists.new";
  btn.setAttribute("aria-label", "Create a Dynamic Playlist");

  const art = document.createElement("div");
  art.className = "album-art-wrap unheard-art";
  const glyph = document.createElement("span");
  glyph.className = "unheard-glyph";
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = "＋";
  art.appendChild(glyph);
  btn.appendChild(art);

  const meta = document.createElement("div");
  meta.className = "album-meta";
  const t = document.createElement("div");
  t.className = "album-title";
  t.textContent = "New Dynamic Playlist";
  const sub = document.createElement("div");
  sub.className = "album-artist";
  sub.textContent = "Albums or tracks, then a focus";
  meta.appendChild(t); meta.appendChild(sub);
  btn.appendChild(meta);

  btn.addEventListener("click", createSmartPlaylist);
  return btn;
}


// Creating is editing a playlist that doesn't exist yet: same sheet, same
// sections, same Playlist size control. Passing a target with no id is what
// makes the save create rather than overwrite, so there is one editor rather
// than two that have to be kept in step.
function createSmartPlaylist() {
  openLibSheet("New Dynamic Playlist", (body, close) => {
    const intro = document.createElement("div");
    intro.className = "lib-facet-note"; intro.dataset.parity = "smart-new.intro";
    intro.textContent = "What should this playlist be made of?";
    body.appendChild(intro);

    for (const m of SMART_MODES) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "lib-sort-row";
      row.dataset.mode = m.id; row.dataset.parity = "smart-new.mode"; row.setAttribute("aria-label", m.label);

      const text = document.createElement("span");
      text.className = "lib-sort-text";
      const main = document.createElement("span");
      main.className = "lib-sort-label";
      main.textContent = m.label;
      const sub = document.createElement("span");
      sub.className = "lib-sort-note";
      sub.textContent = m.note;
      text.appendChild(main); text.appendChild(sub);
      row.appendChild(text);

      row.addEventListener("click", () => {
        close();
        // Straight into the focus screen, whose options are what fuel the
        // playlist. A target with no id makes the save create rather than
        // overwrite.
        openLibFocusSheet({ id: null, name: "", view: currentLibViewSnapshot(),
                            limit: SMART_LIMIT_DEFAULT, mode: m.id,
                            order: SMART_ORDER_DEFAULT });
      });
      body.appendChild(row);
    }

    const note = document.createElement("div");
    note.className = "lib-sheet-note"; note.dataset.parity = "smart-new.note";
    note.textContent =
      "Either way the playlist follows the same focus, and re-runs it every time " +
      "you open it — it isn't a fixed list. The focus works at album level, " +
      "so Tracks means the tracks OF the albums that match.";
    body.appendChild(note);
  }, null, null, { title: "smart-new.title", close: "smart-new.close" });
}

async function showSmartPlaylists() {
  enterFullWall("Dynamic Playlists");
  smartWallActive = true;
  const mySeq = ++smartSeq;
  const list = await fetchSmartPlaylists();
  if (!smartWallActive || mySeq !== smartSeq) return;
  grid.innerHTML = "";
  if (list === null) {
    setBanner("Couldn't read your Dynamic Playlists — the extension didn't answer. " +
              "They're still saved; try again.", true);
    return;
  }
  setBanner(list.length ? null
    : "No Dynamic Playlists yet — start one with New, or set a sort and focus on the " +
      "Library screen and use Focus → Save as…", false);
  const frag = document.createDocumentFragment();
  // Leads the wall so an empty one still has something to do. Creating opens
  // the SAME editor Edit does, rather than sending the user off to the
  // Library screen to discover Focus → Save as… for themselves.
  frag.appendChild(buildNewSmartTile());
  for (const p of list) {
    const n = p.album_total;
    const matched = p.album_matched;
    const tile = buildAlbumTile({
      title: p.name,
      subtitle: (n === undefined || n === null)
        ? describeLibView(p.view)
        // Says what it PLAYS, and — when the query found more — what it left
        // out. Showing only the match count while playing a capped subset is
        // what made the number misleading.
        : (Number.isFinite(matched) && matched > n
            ? `${n} of ${matched} Albums`
            : `${n} Album${n === 1 ? "" : "s"}`),
      image_key: null,
      // A smart playlist has no cover either — the mosaic comes from the first
      // few albums it resolves to, which the server reads straight out of the
      // snapshot at no cost.
      art_keys: p.art_keys || []
    }, () => openSmartPlaylist(p), { selectable: false });
    // The screens contract's keys, each written whole; the tile called by its name.
    tile.dataset.parity = "smart-playlists.playlist"; tile.setAttribute("aria-label", p.name);
    for (const [sel, key] of [[".album-art-wrap", "smart-playlists.playlist-art"], [".album-title", "smart-playlists.playlist-title"], [".album-artist", "smart-playlists.playlist-subtitle"]]) { const el = tile.querySelector(sel); if (el) el.dataset.parity = key; }
    frag.appendChild(tile);
  }
  grid.appendChild(frag);
}
window.__showSmartPlaylists = showSmartPlaylists;
window.__showSmartPicks = showSmartPicks;
