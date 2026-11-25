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

// Why a streamed album is in the library (album-detail.js's note): a favourite or a purchase there and since when, or
// only played; and when it comes out, if not yet.
function serviceWhyText(w) {
  const when = w.since ? " since " + new Date(w.since).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
  let text = w.kept === "purchase" ? "In your library as a " + w.name + " purchase" + when
    : w.kept ? "In your library as a " + w.name + " favourite" + when
    : "Played from " + w.name + " — not in your favourites";
  if (w.releases) text += " · not out until " + formatReleaseDate(w.releases);
  return text;
}

// The album added to its service's favourites (by the + or ⋯'s Add to): the heart in the +'s place, ⋯ says Remove from,
// and the note under the artists says it is a favourite from now (item 540: it went on saying "not in your favourites").
function serviceFavourited(a) {
  a.service_favourite = true;
  if (a.service_why && !a.service_why.kept) {
    a.service_why = Object.assign({}, a.service_why, { kept: "favourite", since: Date.now() });
    const note = document.getElementById("modal-why-note");
    if (note) note.textContent = serviceWhyText(a.service_why);
  }
  const add = modalActs.querySelector('[data-parity="album.service-add"]');
  if (add && albumHeartNow) add.replaceWith(albumHeartNow());
  const item = modalActs.querySelector('[data-parity="album.service-favourite"]');
  if (item) item.textContent = "Remove from " + SOURCE_LABEL[a.source] + " favourites";
}
