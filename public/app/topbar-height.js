/* ------------------------------------------------------------------ */
/*  Top bar height -> --topbar-h                                       */
/* ------------------------------------------------------------------ */
/* v1.7.88. The top bar overlays the scroller now, so album art passes under
   it and shows through the veil. The cost of taking it out of the flow is that
   <main> has to reserve its height itself, and that height is not a constant:
   it grows with the status-bar inset, with the scan-progress strip appearing,
   and with the search row opening.
   So it is MEASURED rather than guessed. style.css carries a fallback for the
   frame before this runs (and for no-JS); this replaces it with the real
   number and keeps it current. .filter-bar sticks to the same variable, which
   until now hard-coded 56px and had to be kept in step by hand. */
(() => {
  const bar = document.querySelector(".topbar");
  const app = document.querySelector(".app");
  if (!bar || !app) return;

  let last = -1;
  const publish = () => {
    // Rounded UP: half a pixel short leaves a hairline of album art peeking
    // above the first row, which reads as a rendering fault rather than a
    // design. A pixel of extra reserve is invisible.
    const h = Math.ceil(bar.getBoundingClientRect().height);
    if (h > 0 && h !== last) {
      last = h;
      app.style.setProperty("--topbar-h", h + "px");
    }
  };
  publish();

  if (typeof ResizeObserver === "function") {
    /*
     * BORDER BOX, NOT THE DEFAULT CONTENT BOX — and the difference is the
     * whole bug this line fixes.
     *
     * What is published is `getBoundingClientRect().height`, which INCLUDES
     * padding. The bar's padding is `calc(12px + env(safe-area-inset-top))`,
     * so the inset is inside it. A ResizeObserver with default options
     * watches the CONTENT box, which the inset is not part of — so a change
     * to the safe area could move the bar's real height without the observer
     * ever firing, and `--topbar-h` would keep a value from the orientation
     * before. `main` reserves that number as padding, so the Home screen
     * opened one whole inset too far down, with an empty band above the first
     * row. Reported after rotating, which is the one thing that changes an
     * inset.
     */
    new ResizeObserver(publish).observe(bar, { box: "border-box" });
  }
  /*
   * AND the viewport events as well, not as a fallback.
   *
   * The observer is the right primary — it catches the search row opening,
   * which fires nothing else — but an inset can change with no box change at
   * all, and a rotation is not an instant: iOS fires orientationchange before
   * the web view has finished resizing, so a value read on the event can be
   * from mid-transition. Sampled again as it settles, the same way the window
   * pin and the diagnostic panel sample a turn, and `h !== last` means the
   * extra reads cost a comparison and nothing else.
   */
  const republish = () => { publish(); setTimeout(publish, 300); setTimeout(publish, 1000); };
  window.addEventListener("resize", republish, { passive: true });
  window.addEventListener("orientationchange", republish, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", republish, { passive: true });
  }
})();
