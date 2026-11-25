/* The page's core (item 539): an album's first button, before Play Now. A Qobuz or Tidal album not among your favourites
   there is a + in the heart's place: a tap adds it there, and the heart (Mandarin's own: hollow, red once liked) takes
   its place. Otherwise the heart as ever (buildFavButton). As the Android app's AlbumHeart. ⋯ keeps Add to and Remove
   from the service's favourites; adding there swaps the + for the heart too. */
const PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M12 5v14M5 12h14"/></svg>';
// The heart for the album on the page, once the + gives way to it.
let albumHeartNow = null;

// The first button on the album's row: the + for a streamed album not in your favourites there, else the heart.
function buildAlbumHeart(album, page) {
  const a = page && page.album;
  albumHeartNow = () => buildFavButton(album, a, "album.favourite");
  if (!(a && a.service_id && a.service_favourite === false && (a.source === "qobuz" || a.source === "tidal"))) return albumHeartNow();
  const name = SOURCE_LABEL[a.source];
  const b = document.createElement("button");
  b.type = "button";
  b.className = "overflow-btn fav-btn service-add";
  b.dataset.parity = "album.service-add";
  b.setAttribute("aria-label", "Add to " + name + " favourites");
  b.title = "Add to " + name + " favourites";
  b.innerHTML = PLUS_SVG;
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      const r = await fetch("/api/" + a.source + "/favorite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ album_id: a.service_id }) });
      const s = await r.json().catch(() => ({}));
      if (!r.ok || s.error) throw new Error(s.error || "Couldn't add it");
      showToast("Added to your " + name + " favourites");
      serviceFavourited(a);
      if (window.__libraryChanged) window.__libraryChanged({});
    } catch (e) { showToast(e.message, "error"); b.disabled = false; }
  });
  return b;
}

// The album added to its service's favourites (by the + or ⋯'s Add to): the heart in the +'s place, and ⋯ says Remove from.
function serviceFavourited(a) {
  a.service_favourite = true;
  const add = modalActs.querySelector('[data-parity="album.service-add"]');
  if (add && albumHeartNow) add.replaceWith(albumHeartNow());
  const item = modalActs.querySelector('[data-parity="album.service-favourite"]');
  if (item) item.textContent = "Remove from " + SOURCE_LABEL[a.source] + " favourites";
}
