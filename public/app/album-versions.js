/* An album's versions (items 345, 349): the tile says how many there are; the album's page lists them on its Versions
   tab (a phone held upright; from 720px up, at the head of the column beside the tracks), a row each, the main first:
   its cover, its edition, its rate, its tracks, length and year, the main one's and the one open's tags. A tap shows that
   version in the page's place: only its tracks, its length and its rate change, nothing the album's own is asked for
   again, the title its title without its version's words. Its ⋯ plays it, or makes it the main version (the one the
   lists show: POST /api/album/versions/main), as the album's own ⋯ does for the one open. The words are the Android
   app's (core AlbumVersions.kt). */

/** The tile's line under the artist, "2 versions"; null for an album of one. @param {any} a */
function versionsMark(a) {
  if (!(a && a.versions > 1)) return null;
  const el = document.createElement("div");
  el.className = "album-versions";
  el.textContent = a.versions + " versions";
  return el;
}

/** "24-bit / 96 kHz" from "24/96"; the quality as it is where it isn't bits over a rate. @param {string} q */
function versionFormat(q) {
  const m = /^(\d+)\/([\d.]+)$/.exec(q || "");
  return m ? m[1] + "-bit / " + m[2] + " kHz" : (q || "");
}

/** "12 tracks · 43:45 · 2015", each where known. @param {any} v */
function versionFacts(v) {
  const s = Number(v.seconds) || 0;
  const len = s > 0 ? (s >= 3600 ? Math.floor(s / 3600) + ":" + String(Math.floor(s / 60) % 60).padStart(2, "0") : Math.floor(s / 60)) + ":" + String(Math.round(s) % 60).padStart(2, "0") : "";
  return [v.tracks ? v.tracks + (v.tracks === 1 ? " track" : " tracks") : "", len, String(v.release_year || v.year || "")].filter(Boolean).join(" · ");
}

/** Version [offset] made the main of its album: said as it goes; its versions read again. @param {number} offset */
async function makeMainVersion(offset) {
  showToast("Saving…");
  try {
    const r = await fetch("/api/album/versions/main", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offset }) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    showToast("The main version");
    if (currentAlbum) fetchAlbumDetail(currentAlbum, { version: true }).catch(() => {});
  } catch (e) {
    showToast("Couldn't save that — try again", "error");
  }
}

/** The album's ⋯ item for the one open where it isn't the main (Make this the main version); none otherwise. @param {any} j */
function versionMainItem(j) {
  const cur = j && Array.isArray(j.versions) ? j.versions.find(v => v.current) : null;
  return cur && !cur.main ? [{ label: "Make this the main version", key: "album.version-main", onClick: () => makeMainVersion(cur.offset) }] : [];
}

/** Version [v] shown in the page's place (item 349): the album object kept, its offset and cover the version's. @param {any} v */
function showVersion(v) {
  if (!currentAlbum) return;
  const next = Object.assign({}, currentAlbum, { offset: v.offset, image_key: v.image_key || currentAlbum.image_key, quality: v.quality, hires: v.hires });
  currentAlbum = next;
  setModalSource(next);
  if (typeof setAlbumTab === "function") setAlbumTab("tracks");
  document.getElementById("album-modal").classList.add("is-switching");
  fetchAlbumDetail(next, { version: true })
    .catch(() => showToast("Couldn't load that version", "error"))
    .finally(() => document.getElementById("album-modal").classList.remove("is-switching"));
}

/** The album page's versions, from its answer [j]: the list, and the Versions tab's count; gone where it has none. @param {any} j */
function renderVersions(j) {
  const pane = document.getElementById("album-versions-pane");
  const list = j && Array.isArray(j.versions) ? j.versions : [];
  if (typeof setVersionsTab === "function") setVersionsTab(list.length);
  if (!pane) return;
  pane.innerHTML = "";
  pane.classList.toggle("hidden", list.length < 2);
  if (list.length < 2) return;
  const head = document.createElement("div");
  head.className = "album-versions-head";
  head.innerHTML = '<span class="album-versions-count"></span><span class="album-versions-note">The library shows the main one</span>';
  head.firstElementChild.textContent = list.length + " versions";
  pane.appendChild(head);
  for (const v of list) {
    const row = document.createElement("div");
    row.className = "album-version-row" + (v.current ? " is-current" : ""); row.dataset.parity = "album.version";
    row.setAttribute("role", "button"); row.tabIndex = v.current ? -1 : 0;
    row.setAttribute("aria-current", v.current ? "true" : "false");
    const art = document.createElement("img");
    art.className = "album-version-art"; art.alt = ""; art.loading = "lazy"; art.decoding = "async";
    if (v.image_key) art.src = "/api/image/" + encodeURIComponent(v.image_key) + "?size=240";
    const words = document.createElement("div");
    words.className = "album-version-words";
    const name = document.createElement("div");
    name.className = "album-version-name";
    name.textContent = v.edition || v.title;
    words.appendChild(name);
    for (const [cls, text] of [["album-version-format", versionFormat(v.quality)], ["album-version-facts", versionFacts(v)]]) {
      if (!text) continue;
      const d = document.createElement("div");
      d.className = cls; d.textContent = text;
      words.appendChild(d);
    }
    if (v.main || v.current) {
      const tags = document.createElement("div");
      tags.className = "album-version-tags";
      if (v.main) tags.insertAdjacentHTML("beforeend", '<span class="album-version-tag is-main">Main</span>');
      if (v.current) tags.insertAdjacentHTML("beforeend", '<span class="album-version-tag is-viewing">Viewing</span>');
      words.appendChild(tags);
    }
    row.append(art, words, buildOverflowMenu([
      { label: "Play Now", key: "album.version-play", onClick: () => invokeVersion(v) },
      v.main ? null : { label: "Make this the main version", key: "album.version-make-main", onClick: () => makeMainVersion(v.offset) }
    ], { label: "Version actions", key: "album.version-more" }));
    if (!v.current) row.addEventListener("click", (e) => { if (!e.target.closest(".overflow-wrap")) showVersion(v); });
    pane.appendChild(row);
  }
}

/** Version [v] played now in the room the page plays in, as Play Now plays the one open. @param {any} v */
async function invokeVersion(v) {
  if (!selectedZoneId) { showToast("Pick a zone first", "error"); return; }
  try {
    const r = await fetch("/api/play", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offset: v.offset, title: v.title || "", subtitle: v.subtitle || "", zone_or_output_id: selectedZoneId, kind: "play_now" }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "HTTP " + r.status);
  } catch (e) { showToast(e.message, "error"); }
}
