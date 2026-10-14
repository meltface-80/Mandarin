/* ------------------------------------------------------------------ */
/*  Later, once the first screen is up (v0.6.10): what the page asks   */
/*  for at start but nothing on that screen shows waits until the page */
/*  has loaded and settled, so the rows and covers go first.           */
/* ------------------------------------------------------------------ */
window.__afterStart = (fn) => {
  const go = () => setTimeout(() => {
    if (window.requestIdleCallback) requestIdleCallback(() => fn(), { timeout: 2000 }); else fn();
  }, 1500);
  if (document.readyState === "complete") go(); else window.addEventListener("load", go, { once: true });
};
