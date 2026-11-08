/* ------------------------------------------------------------------ */
/*  Albums added or taken away show up by themselves (v0.8.43). Every  */
/*  answer from the server carries which albums there are              */
/*  (X-Mandarin-Library, from the C# server); when that moves (a scan  */
/*  has added some, a folder was let go) the page reads its rows again */
/*  (window.__libraryChanged): Home's Library row at once, the Library */
/*  wall when it is at its top. Before, the Library row was read once  */
/*  and kept until the sort changed. The page also waits on the mark   */
/*  itself (item 232): asked with the mark it has, the server answers  */
/*  the moment the albums move, or after twenty seconds, so a scan's   */
/*  albums reach a screen left alone at once. Until then it asked only */
/*  every ten seconds, once it had heard nothing for twenty.           */
/* ------------------------------------------------------------------ */
(function libraryMark() {
  const real = window.fetch;
  let mark = "", timer = 0, following = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const see = (r) => {
    let m;
    try { m = r && r.headers && r.headers.get("x-mandarin-library"); } catch (e) { return; }
    if (!m) return;
    if (mark && m !== mark) {
      // Gathered: a scan adds folder after folder.
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Artists' pages kept asked afresh (item 357): a deleted album's tile isn't drawn from a page kept before.
        if (window.__artistKeptStale) window.__artistKeptStale();
        if (window.__libraryChanged) window.__libraryChanged({ live: true });
      }, 1000);
    }
    mark = m;
    // Only once the server has shown it carries the mark (an older one, or the
    // app's own copy offline, never does), and ten seconds on: the wait holds
    // one of the browser's few connections to the server, which the page's
    // first asks (its rows, the rooms) need while it starts.
    if (!following) { following = true; setTimeout(follow, 10000); }
  };
  window.fetch = function () {
    return real.apply(this, arguments).then((r) => { see(r); return r; });
  };
  // The mark waited on while the page is shown and the server reached: the
  // answer's own mark is seen as any other. Not answered, or answered at once
  // with nothing moved, asked again in ten seconds rather than in a loop.
  async function follow() {
    for (;;) {
      if (document.hidden || window.__musicdOffline) { await wait(2000); continue; }
      const had = mark, t0 = Date.now();
      let ok = false;
      try { ok = (await window.fetch("/api/library/mark?wait_for=" + encodeURIComponent(had), { cache: "no-store" })).ok; }
      catch (e) { /* the server away: asked again in a while */ }
      if (!ok || (mark === had && Date.now() - t0 < 1000)) await wait(10000);
    }
  }
})();
