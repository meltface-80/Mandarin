/* ------------------------------------------------------------------ */
/*  Toasts above the mini transport bar (v0.6.0): --toast-lift is how   */
/*  far its top edge is from the bottom of the screen, plus a gap, kept */
/*  current as the bar shows, hides or changes size; 0 without it.      */
/* ------------------------------------------------------------------ */
(function keepToastsAboveTransport() {
  const bar = document.getElementById("mini-transport");
  if (!bar) return;
  const root = document.documentElement;
  const update = () => {
    const r = bar.getBoundingClientRect();
    const shown = !bar.classList.contains("hidden") && r.height > 0 && getComputedStyle(bar).display !== "none";
    root.style.setProperty("--toast-lift", shown ? Math.ceil(window.innerHeight - r.top + 10) + "px" : "0px");
  };
  update();
  new MutationObserver(update).observe(bar, { attributes: true, attributeFilter: ["class", "style"] });
  if (window.ResizeObserver) new ResizeObserver(update).observe(bar);
  window.addEventListener("resize", update);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", update);
})();
