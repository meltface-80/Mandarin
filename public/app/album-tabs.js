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

/** How far under the buttons' row (Play Now, Queue) the tabs sit in their own place, measured with the page at its top. */
let tabsRestGap = NaN;

/* Whether the tabs are held at the top of the page as it scrolls (item 358): their row is filled only then. Held: further
   under the buttons' row than in their own place, the page scrolled on and the buttons gone up past them. */
function markTabsHeld() {
  const above = albumTabsEl && albumTabsEl.previousElementSibling;
  const body = albumTabsEl && albumTabsEl.closest(".modal-body");
  if (!albumTabsEl || !above || !body) return;
  const gap = albumTabsEl.getBoundingClientRect().top - above.getBoundingClientRect().bottom;
  if (body.scrollTop <= 0) tabsRestGap = gap;
  albumTabsEl.classList.toggle("is-held", body.scrollTop > 0 && gap > (Number.isNaN(tabsRestGap) ? 18 : tabsRestGap) + 0.5);
}

if (albumTabsEl) {
  const body = albumTabsEl.closest(".modal-body");
  if (body) body.addEventListener("scroll", markTabsHeld, { passive: true });
  requestAnimationFrame(markTabsHeld);
}

if (albumTabsEl) albumTabsEl.addEventListener("click", (e) => {
  const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest(".album-tab"));
  if (b) setAlbumTab(b.getAttribute("data-album-tab") || "tracks");
});
