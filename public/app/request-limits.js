/* ------------------------------------------------------------------ */
/*  No request waits for ever (v0.8.36). A phone that slept, or moved  */
/*  from Wi-Fi to mobile data, can leave a request on a connection     */
/*  that will never answer, and the browser keeps only six to the      */
/*  server: six such and everything after them waits too — the screen  */
/*  goes stale and nothing tapped does anything. So each request the   */
/*  page makes of the server is given up after a while (a read 30 s,   */
/*  anything else 90 s; the long jobs — Reindex, backups, an update,   */
/*  an import, the MusicBrainz pack — not), and when the page comes    */
/*  back (shown again, or woken: its clock jumped) every read still    */
/*  waiting from before is let go at once, before it asks afresh. (Not */
/*  a write: its answer may be in already, and it has its own limit.)  */
/*                                                                     */
/*  And the Android app asks the page now and then how it is           */
/*  (window.__musicdPageCheck, v0.8.42): a page whose script has       */
/*  stopped never answers, and one that has been asking the server a   */
/*  long while with no answer, while the app reaches the server        */
/*  itself, has stuck connections. The app puts either right itself    */
/*  (MainActivity) rather than leaving the screen stale until it is    */
/*  swiped away.                                                       */
/* ------------------------------------------------------------------ */
(function requestLimits() {
  const real = window.fetch;
  const LONG = /^\/api\/(reindex|backup|update\/apply|settings\/(qobuz|tidal)\/import|identify\/pack)/;
  const live = new Set();
  // The first ask since the server last answered (0: none waiting), and the latest ask.
  let askingSince = 0, askedAt = 0;
  const limits = () => Object.assign({ read: 30000, other: 90000 }, window.__musicdRequestLimits || {});
  window.fetch = function (input, init) {
    let u;
    try { u = new URL(typeof input === "string" ? input : (input && input.url) || "", location.href); } catch (e) { return real.apply(this, arguments); }
    if (u.origin !== location.origin || !u.pathname.startsWith("/api/") || LONG.test(u.pathname) || typeof AbortController !== "function") {
      return real.apply(this, arguments);
    }
    const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    const ms = method === "GET" || method === "HEAD" ? limits().read : limits().other;
    const ctl = new AbortController();
    const own = init && init.signal;
    if (own) {
      if (own.aborted) ctl.abort(own.reason);
      else own.addEventListener("abort", () => ctl.abort(own.reason), { once: true });
    }
    const entry = { ctl, at: Date.now(), read: method === "GET" || method === "HEAD" };
    live.add(entry);
    askedAt = entry.at;
    if (!askingSince) askingSince = entry.at;
    // Still running when the time is up (its answer, or its body, never came): given up.
    const timer = setTimeout(() => {
      live.delete(entry);
      ctl.abort(typeof DOMException === "function" ? new DOMException("No answer from the server", "TimeoutError") : undefined);
    }, ms);
    const done = () => { live.delete(entry); };
    return real.call(this, input, Object.assign({}, init, { signal: ctl.signal })).then(
      (r) => { done(); askingSince = 0; return r; },
      (e) => { clearTimeout(timer); done(); throw e; });
  };
  // Back (shown again, or woken): the reads still waiting from before are let go.
  const letGo = (before) => {
    for (const e of [...live]) {
      if (e.at > before || !e.read) continue;
      live.delete(e);
      e.ctl.abort(typeof DOMException === "function" ? new DOMException("The page was away", "AbortError") : undefined);
    }
  };
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt) { letGo(Date.now()); askingSince = 0; }
    hiddenAt = 0;
  });
  // A page on screen that slept without being told (its timers stopped): its
  // clock jumps. (A hidden one's timers are slowed anyway, and it lets go on coming back.)
  let tick = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (now - tick > 15000 && !document.hidden) { letGo(tick); askingSince = 0; }
    tick = now;
  }, 5000);
  // For the app: how long the page has been asking the server with no answer
  // at all (any answer, an error status included, ends it; so does coming
  // back, which starts afresh), how long since it last asked, and how many
  // asks are waiting now. Answering at all says the page's script is running.
  window.__musicdPageCheck = () => {
    const now = Date.now();
    return { v: 1, hidden: !!document.hidden, asking: askingSince ? now - askingSince : 0,
      asked: askedAt ? now - askedAt : -1, waiting: live.size };
  };
})();
