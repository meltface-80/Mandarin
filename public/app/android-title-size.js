/* ------------------------------------------------------------------ */
/*  Android app only: Settings' buttons are one column (android.css),  */
/*  every title one size — the largest at which the longest title      */
/*  still fits on one line.                                            */
/* ------------------------------------------------------------------ */
(function androidSettingsTitleSize() {
  if (!/MusicDAndroid/.test(navigator.userAgent)) return;
  // The main list and Setup's: each sized by its own longest title.
  const navs = [...document.querySelectorAll("#settings-overlay .settings-nav")];
  if (!navs.length || typeof ResizeObserver !== "function") return;
  const MAX = 20, MIN = 13, PROBE = 20;
  let busy = false;
  function fitOne(nav) {
    const items = [...nav.querySelectorAll(".settings-nav-item:not(.hidden)")];
    if (!items.length || !nav.offsetWidth) return;      // not on screen yet
    nav.style.setProperty("--settings-nav-fs", PROBE + "px");
    let scale = Infinity;
    for (const it of items) {
      const title = it.querySelector(".settings-nav-title");
      const box = it.querySelector(".settings-nav-txt");
      if (!title || !box) continue;
      const room = box.clientWidth, need = title.scrollWidth;
      if (room > 0 && need > 0) scale = Math.min(scale, room / need);
    }
    const fs = scale === Infinity ? 16 : Math.max(MIN, Math.min(MAX, Math.floor(PROBE * scale * 10) / 10));
    nav.style.setProperty("--settings-nav-fs", fs + "px");
    // Setup's buttons take the main list's height.
    if (nav === navs[0] && items[0].offsetHeight) {
      document.getElementById("settings-overlay").style.setProperty("--settings-row-h", items[0].offsetHeight + "px");
    }
  }
  function fit() {
    if (busy) return;
    busy = true;
    navs.forEach(fitOne);
    busy = false;
  }
  // Measured whenever a list is laid out: opened, rotated, or a button shown or hidden.
  const ro = new ResizeObserver(fit), mo = new MutationObserver(fit);
  for (const nav of navs) {
    ro.observe(nav);
    mo.observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }
})();
