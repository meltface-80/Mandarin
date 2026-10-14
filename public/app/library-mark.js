/* ------------------------------------------------------------------ */
/*  Albums added or taken away show up by themselves (v0.8.43). Every  */
/*  answer from the server carries which albums there are              */
/*  (X-Mandarin-Library, from the C# server); when that moves (a scan  */
/*  has added some, a folder was let go) the page reads its rows again */
/*  (window.__libraryChanged): Home's Library row at once, the Library */
/*  wall when it is at its top. Before, the Library row was read once  */
/*  and kept until the sort changed. When nothing has been asked for a */
/*  while (no room playing, say), the page asks for the mark itself.   */
/* ------------------------------------------------------------------ */
(function libraryMark() {
  const real = window.fetch;
  let mark = "", seenAt = 0, timer = 0, asking = false;
  const see = (r) => {
    let m;
    try { m = r && r.headers && r.headers.get("x-mandarin-library"); } catch (e) { return; }
    if (!m) return;
    seenAt = Date.now();
    if (mark && m !== mark) {
      // Gathered: a scan adds folder after folder.
      clearTimeout(timer);
      timer = setTimeout(() => { if (window.__libraryChanged) window.__libraryChanged({ live: true }); }, 1000);
    }
    mark = m;
  };
  window.fetch = function () {
    return real.apply(this, arguments).then((r) => { see(r); return r; });
  };
  // Only once the server has shown it carries the mark (an older one, or the
  // app's own copy offline, never does).
  setInterval(() => {
    if (!mark || asking || document.hidden || window.__musicdOffline || Date.now() - seenAt < 20000) return;
    asking = true;
    window.fetch("/api/library/mark", { cache: "no-store" }).catch(() => {}).then(() => { asking = false; });
  }, 10000);
})();
