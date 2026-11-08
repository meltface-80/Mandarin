/* An album's page on a phone held upright (item 349): its tabs under Play Now and Queue, Tracks, Credits, About and,
   where it has them, Versions (album-versions.js), held at the top as the page scrolls; the one open shows, the rest
   wait (style.css hides them by the album view's data-album-tab). The album's genres, label and score are About's; a
   tab with nothing in it says so. From 720px up there are no tabs: everything shows at once, as before. The words are
   the Android app's (AlbumPhone.kt). */
const albumTabsEl = document.getElementById("album-tabs");

/** Tab [t] open: "tracks", "credits", "about" or "versions". @param {string} t */
function setAlbumTab(t) {
  const modal = document.getElementById("album-modal");
  if (!modal || !albumTabsEl) return;
  modal.dataset.albumTab = t;
  for (const b of albumTabsEl.querySelectorAll(".album-tab")) {
    const on = b.getAttribute("data-album-tab") === t;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  }
}

/** The Versions tab, with how many [n]: there only where it has two or more. @param {number} n */
function setVersionsTab(n) {
  if (!albumTabsEl) return;
  const b = albumTabsEl.querySelector('[data-album-tab="versions"]');
  if (!b) return;
  b.classList.toggle("hidden", n < 2);
  const count = b.querySelector(".album-tab-count");
  if (count) count.textContent = n >= 2 ? String(n) : "";
  if (n < 2 && document.getElementById("album-modal").dataset.albumTab === "versions") setAlbumTab("tracks");
}

if (albumTabsEl) albumTabsEl.addEventListener("click", (e) => {
  const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest(".album-tab"));
  if (b) setAlbumTab(b.getAttribute("data-album-tab") || "tracks");
});
