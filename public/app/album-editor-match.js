/* The page's core (app.js until v1.0.5), 24 of 33: the album editor's matches, and an album's menu items. */
// ---- names from MusicBrainz (the identification scan, by hand) ----------
// Find match lists the releases the scan would weigh, best first, to tap;
// the box under them takes a barcode or a MusicBrainz link for an exact
// match. Either is applied at once — artist, title, year, track titles —
// and the page behind follows; Undo is on the Identify albums page.
function aeMatchLineFor(c) {
  const bits = [];
  if (c.source === "itunes") bits.push("iTunes");
  if (c.year) bits.push(String(c.year));
  if (c.release_year && c.year && c.release_year !== c.year) bits.push("this pressing " + c.release_year);
  if (c.edition) bits.push(c.edition);
  if (c.country) bits.push(c.country);
  if (c.track_count) bits.push(c.track_count + " tracks");
  if (c.missing_tracks) bits.push(c.missing_tracks + " missing here");
  if (c.extra_tracks) bits.push(c.extra_tracks + " not on it");
  return bits.join(" · ");
}

function aeRenderMatches(list, verdict) {
  ae.mCands.innerHTML = "";
  list.forEach((c, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "ae-mcand"; b.setAttribute("data-parity", "album-edit.release");
    const top = document.createElement("div"); top.className = "ae-mcand-top";
    const t1 = document.createElement("span"); t1.className = "ae-mcand-t"; t1.textContent = (c.artist ? c.artist + " — " : "") + (c.title || "—");
    const pc = document.createElement("span"); pc.className = "ae-mcand-pc" + (c.similarity >= 96 ? " is-sure" : ""); pc.textContent = c.similarity + " %";
    top.append(t1, pc);
    const t2 = document.createElement("div"); t2.className = "ae-cand-s"; t2.textContent = aeMatchLineFor(c);
    b.append(top, t2);
    if (i === 0 && (verdict === "applied" || verdict === "proposed")) { const m = document.createElement("span"); m.className = "ae-cand-best ae-mcand-best"; m.textContent = verdict === "applied" ? "Match" : "Likely"; top.prepend(m); }
    b.addEventListener("click", () => aeMatch(c.mbid, "pick", b));
    ae.mCands.appendChild(b);
  });
}

async function aeFindMatch() {
  if (!aeState || !aeState.data) return;
  const mine = aeState;
  const seq = mine.matchSeq = (mine.matchSeq || 0) + 1;
  ae.mBox.classList.remove("hidden");
  ae.mCands.innerHTML = "";
  ae.barcodeErr.textContent = "";
  ae.mSearchStatus.textContent = "Asking MusicBrainz… (a few seconds: one request a second)";
  ae.mFind.disabled = true;
  try {
    const r = await fetch(`/api/identify/candidates?offset=${mine.album.offset}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    if (aeState !== mine || seq !== mine.matchSeq) return;
    const list = j.candidates || [];
    if (!list.length) ae.mSearchStatus.innerHTML = "<strong>Nothing with this title on MusicBrainz.</strong> Try the barcode below, or a link to the release.";
    else if (j.verdict === "applied") ae.mSearchStatus.innerHTML = "<strong>This is it</strong> — the same tracks and lengths. Tap to apply, or choose another.";
    else if (j.verdict === "proposed") ae.mSearchStatus.innerHTML = "<strong>Close</strong>" + (j.ambiguous ? ", but two releases fit" : "") + ". Tap the right one to apply.";
    else ae.mSearchStatus.innerHTML = "<strong>Not sure which.</strong> Tap one to apply it, or use the barcode below.";
    aeRenderMatches(list, j.verdict);
  } catch (e) {
    if (aeState !== mine || seq !== mine.matchSeq) return;
    ae.mSearchStatus.textContent = `The search didn't work (${e.message}). You can still enter a barcode below.`;
  } finally {
    if (aeState === mine && seq === mine.matchSeq) ae.mFind.disabled = false;
  }
}

async function aeMatch(query, how, btn) {
  if (!aeState || !aeState.data) return;
  const mine = aeState;
  ae.barcodeErr.textContent = ""; ae.err.textContent = "";
  const orig = btn && btn.textContent;
  if (btn) { btn.disabled = true; if (btn === ae.barcodeUse) btn.textContent = "Matching…"; }
  ae.mCands.querySelectorAll(".ae-mcand").forEach(x => { x.disabled = true; });
  try {
    const r = await fetch("/api/identify/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offset: mine.album.offset, query, how }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    if (aeState !== mine) return;
    // The editor and the page behind take the new names.
    const r2 = await fetch(`/api/album/edit?offset=${mine.album.offset}`);
    const d = await r2.json().catch(() => ({}));
    if (aeState !== mine) return;
    if (r2.ok) {
      mine.data = d;
      ae.title.value = d.title || ""; ae.artist.value = d.artist || ""; ae.year.value = d.year || "";
      ["title", "artist", "year"].forEach(aeWas);
      ae.reset.classList.toggle("hidden", !d.edited);
      aeApplyToScreen(Object.assign({}, d, { album: { year: d.year } }));
      if (mine.album === currentAlbum) fetchAlbumDetail(currentAlbum).catch(() => {});
    }
    const done = (j.applied || []).find(x => x.album && x.album.offset === mine.album.offset);
    const c = done && done.candidate;
    ae.mStatus.innerHTML = c ? `<strong>Matched:</strong> ${escapeHtml((c.artist ? c.artist + " — " : "") + c.title)}${c.year ? " (" + c.year + ")" : ""}. Undo is under Settings → Library Scanner.` : "<strong>Matched.</strong>";
    ae.mCands.querySelectorAll(".ae-mcand").forEach(x => x.classList.toggle("is-picked", x === btn));
    showToast("Matched — names applied");
  } catch (e) {
    if (aeState !== mine) return;
    (how === "pick" ? ae.err : ae.barcodeErr).textContent = e.message;
  } finally {
    if (aeState === mine) {
      if (btn) { btn.disabled = false; if (orig && btn === ae.barcodeUse) btn.textContent = orig; }
      ae.mCands.querySelectorAll(".ae-mcand").forEach(x => { x.disabled = false; });
    }
  }
}

function aeClose() {
  if (!aeEl) return;
  aeEl.classList.add("hidden");
  aeState = null;
}

async function openAlbumEditor(album) {
  if (!aeEl || !album) return;
  aeState = { album, data: null, pick: null };
  const mine = aeState;
  ae.err.textContent = ""; ae.urlErr.textContent = ""; ae.url.value = "";
  ae.search.classList.add("hidden"); ae.cands.innerHTML = "";
  if (ae.mBox) {
    ae.mBox.classList.add("hidden"); ae.mCands.innerHTML = ""; ae.barcode.value = ""; ae.barcodeErr.textContent = "";
    ae.mStatus.textContent = "Names from MusicBrainz — artist, title, year and every track.";
    ae.mFind.disabled = false;
  }
  ae.title.value = album.title || ""; ae.artist.value = album.subtitle || ""; ae.year.value = "";
  if (ae.folder) { ae.folder.classList.add("hidden"); ae.folder.textContent = ""; }
  ae.status.textContent = "Loading…";
  ae.img.removeAttribute("src");
  ae.save.disabled = true;
  aeEl.querySelectorAll(".ae-was").forEach(x => { x.innerHTML = ""; });
  aeEl.classList.remove("hidden");
  try {
    const r = await fetch(`/api/album/edit?offset=${album.offset}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    if (aeState !== mine) return;
    mine.data = d;
    // The album's folder (v0.6.3), for telling a remix or a box set apart
    // when matching by hand.
    if (ae.folder && d.folder) {
      ae.folder.innerHTML = '<span class="ae-folder-label">Folder</span>';
      ae.folder.appendChild(document.createTextNode(d.folder));
      // Part of a box set (v0.6.3): said here too, for choosing the release.
      if (d.box) {
        const b = document.createElement("span");
        b.className = "ae-folder-box";
        b.textContent = "From " + d.box.name + " · disc " + d.box.disc + " of " + d.box.of;
        ae.folder.appendChild(b);
      }
      ae.folder.classList.remove("hidden");
    }
    ae.title.value = d.title || ""; ae.artist.value = d.artist || ""; ae.year.value = d.year || "";
    ["title", "artist", "year"].forEach(aeWas);
    ae.reset.classList.toggle("hidden", !d.edited);
    ae.save.disabled = false;
    aeCoverStatus();
    // Auto first: an album with no cover at all is searched for at once.
    if (!d.art.own) aeSearch(true);
  } catch (e) {
    if (aeState === mine) ae.err.textContent = e.message;
  }
}

function aeApplyToScreen(d) {
  const album = aeState && aeState.album;
  if (!album) return;
  const oldKey = album.image_key;
  album.title = d.title; album.subtitle = d.artist; album.image_key = d.image_key;
  if (d.album && d.album.year) album.year = d.album.year;
  // Tiles already on screen for this album take the new cover.
  swapAlbumArt(oldKey, d.image_key);
  if (album === currentAlbum) {
    modalTitle.textContent = d.title || "Untitled";
    setModalArtist(d.artist);
    modalImg.src = aeImageSrc(d.image_key, 800);
    modalImg.style.display = "";
    setModalAmbient(modalImg.src);
    try {
      sessionStorage.setItem("rra-modal", JSON.stringify({ album, source: currentSource, zoneId: currentSourceZoneId, filter: currentDetailFilter }));
    } catch (e) { /* ignore */ }
    fetchAlbumExtras(album).catch(() => {});
  }
}

async function aePost(path, body, btn) {
  ae.err.textContent = "";
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    aeApplyToScreen(j);
    aeClose();
    showToast("Album saved");
  } catch (e) {
    ae.err.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

if (aeEl) {
  aeEl.querySelectorAll("[data-ae-close]").forEach(b => b.addEventListener("click", aeClose));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && aeState) aeClose(); });
  ["title", "artist", "year"].forEach(f => ae[f].addEventListener("input", () => { if (aeState && aeState.data) aeWas(f); }));
  ae.find.addEventListener("click", () => { if (aeState && aeState.data) aeSearch(false); });
  ae.remove.addEventListener("click", () => { if (aeState) { aeState.pick = "remove"; aeCoverStatus(); } });
  ae.undo.addEventListener("click", () => {
    if (!aeState) return;
    aeState.pick = null;
    ae.cands.querySelectorAll(".ae-cand").forEach(x => x.classList.remove("is-picked"));
    aeCoverStatus();
  });
  const useUrl = () => {
    if (!aeState) return;
    const u = ae.url.value.trim();
    ae.urlErr.textContent = "";
    if (!/^https?:\/\/\S+$/i.test(u)) { ae.urlErr.textContent = "That doesn't look like a web address (it should start with http)."; return; }
    // Previewed in the page first; the server downloads and checks it on Save.
    const probe = new Image();
    probe.onload = () => { if (aeState) { ae.cands.querySelectorAll(".ae-cand").forEach(x => x.classList.remove("is-picked")); aeState.pick = { url: u, thumb: u, source: "a pasted address" }; aeCoverStatus(); } };
    probe.onerror = () => { ae.urlErr.textContent = "No picture loaded from that address. Make sure it's the image itself (“Copy image address”), not the page it's on."; };
    probe.src = u;
  };
  ae.urlUse.addEventListener("click", useUrl);
  ae.url.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); useUrl(); } });
  if (ae.mFind) {
    ae.mFind.addEventListener("click", aeFindMatch);
    const useBarcode = () => {
      const q = ae.barcode.value.trim();
      if (!q) { ae.barcodeErr.textContent = "Type the digits under the bars, or paste a musicbrainz.org release link."; return; }
      aeMatch(q, "barcode", ae.barcodeUse);
    };
    ae.barcodeUse.addEventListener("click", useBarcode);
    ae.barcode.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); useBarcode(); } });
  }
  ae.save.addEventListener("click", () => {
    if (!aeState || !aeState.data) return;
    const y = ae.year.value.trim();
    if (y && !/^\d{4}$/.test(y)) { ae.err.textContent = "The year should be four digits, like 2002."; return; }
    const body = { offset: aeState.album.offset, title: ae.title.value, artist: ae.artist.value, year: y };
    const pick = aeState.pick;
    if (pick === "remove") body.art = "remove";
    else if (pick) { body.art_url = pick.url; body.art_source = pick.source === "a pasted address" ? pick.url : pick.source; }
    aePost("/api/album/edit", body, ae.save);
  });
  ae.reset.addEventListener("click", () => {
    if (!aeState) return;
    aePost("/api/album/edit/reset", { offset: aeState.album.offset }, ae.reset);
  });
}

// Listen later: put the album aside, or take it off the list.
function laterMenuItem(album, page) {
  if (!album || typeof album.offset !== "number") return [];
  const on = !!((page && page.album && page.album.later) || album.later);
  return [{ label: on ? "Remove from Listen later" : "Listen later", key: "album.later", onClick: async () => { if (await setListenLater(album.offset, !on)) album.later = !on; } }];
}

// Add to playlist (v0.8.34): the whole album, into one of your playlists or a
// new one, through the same sheet as a selection of albums.
function playlistMenuItem(album) {
  if (!album || typeof album.offset !== "number") return [];
  return [{ label: "Add to playlist", key: "album.playlist", onClick: () => openAddToPlaylistSheet(null, [{
    offset: album.offset, title: album.title || "", subtitle: album.subtitle || "", image_key: album.image_key || null
  }]) }];
}

// Inside the Android app only (its MusicdDownloads bridge): keep this album
// on the phone, or take it off. Browsers and the iPhone app never see it.
function downloadMenuItem(album) {
  const dl = window.MusicdDownloads;
  if (!dl || !album || typeof album.offset !== "number") return [];
  // A streamed album (Qobuz, Tidal) is never kept on the phone (v0.6.23).
  if (album.source && album.source !== "local") return [];
  let st = {};
  try { st = JSON.parse(dl.status(album.offset)) || {}; } catch (e) { /* treat as not downloaded */ }
  if (st.state === "done") return [{ label: "Remove from this phone", key: "album.download", onClick: () => dl.remove(album.offset) }];
  if (st.state === "downloading" || st.state === "queued" || st.state === "waiting") {
    return [{ label: `Downloading… ${st.done || 0}/${st.total || "?"}`, key: "album.download", onClick: () => dl.open() }];
  }
  if (isPhoneAlbum(album)) return [];
  return [{ label: "Download to this phone", key: "album.download", onClick: () => dl.download(album.offset, album.title || "", album.subtitle || "") }];
}
