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

/* Held at the top, the tabs have the page itself behind them, full width (item 375): no bar painted, which never
   matches the cover's glow, but what scrolls up past the line under them cut off there, so the tracks don't show
   through the tabs and nothing else does either. Each part of the page that reaches above the line is clipped to below
   it; back in their place, nothing is. */
const albumBody = /** @type {HTMLElement|null} */ (document.querySelector("#album-modal .modal-body"));
let tabsFrame = 0;

/** The parts of the album's page that scroll past the tabs: the page's own, and the album pane's but the tabs. */
function underTabs() {
  if (!albumBody || !albumTabsEl) return [];
  const pane = albumTabsEl.parentElement;
  return [...albumBody.children, ...(pane ? pane.children : [])].filter(e => e !== pane && e !== albumTabsEl);
}

/** Each part clipped at the line under the tabs while they are held at the top, none otherwise. */
function clipUnderTabs() {
  tabsFrame = 0;
  if (!albumBody || !albumTabsEl) return;
  const tabs = albumTabsEl.getBoundingClientRect();
  // Held where the page's padding ends (room for Back at the corner), the sticky tabs' top.
  const top = albumBody.getBoundingClientRect().top + (parseFloat(getComputedStyle(albumBody).paddingTop) || 0);
  const held = tabs.height > 0 && albumBody.scrollTop > 0 && tabs.top <= top + 1;
  for (const el of underTabs()) {
    const e = /** @type {HTMLElement} */ (el);
    const cut = held ? tabs.bottom - e.getBoundingClientRect().top : 0;
    if (cut > 0) e.style.clipPath = `inset(${Math.ceil(cut)}px 0 0 0)`;
    else if (e.style.clipPath) e.style.clipPath = "";
  }
}

/** Clipped again before the next frame is drawn. */
function clipSoon() { if (!tabsFrame) tabsFrame = requestAnimationFrame(clipUnderTabs); }

if (albumBody) albumBody.addEventListener("scroll", clipSoon, { passive: true });
window.addEventListener("resize", clipSoon);
if (albumTabsEl) albumTabsEl.addEventListener("click", clipSoon);
