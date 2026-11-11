/* What goes wrong in the page itself, into the server's logs (logs, item 389: DiagnosticsMore.cs). An error thrown
   and caught by no one, and a promise refused with no one to hear it, were in this browser's console alone, which no
   one opens; they are now sent to the server, a few at a time, and kept there in Logs/Web beside its own log.
   The same error is sent once a minute at most, and at most 20 a minute in all, so a page in a loop can't flood it;
   a failure to send is let go, never retried, so this can't loop on itself. */
(() => {
  const queue = [];
  const seen = new Map();
  let sentThisMinute = 0, minuteAt = Date.now(), timer = 0;
  const send = () => {
    timer = 0;
    if (!queue.length) return;
    const lines = queue.splice(0, 20);
    try {
      fetch("/api/diagnostics/page", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }), keepalive: true }).catch(() => {});
    } catch (e) { /* let go */ }
  };
  const add = (text) => {
    const now = Date.now();
    if (now - minuteAt > 60000) { minuteAt = now; sentThisMinute = 0; }
    const key = text.slice(0, 300);
    if (now - (seen.get(key) || 0) < 60000 || sentThisMinute >= 20) return;
    seen.set(key, now);
    if (seen.size > 200) seen.clear();
    sentThisMinute++;
    queue.push({ level: "ERROR", text: text + " (at " + location.pathname + location.hash + ")" });
    if (!timer) timer = setTimeout(send, 3000);
  };
  const what = (e) => e && e.stack ? String(e.stack) : String(e && e.message ? e.message : e);
  window.addEventListener("error", (ev) => {
    if (!ev) return;
    // A picture or a script that didn't load is the network's, said where it is shown; only the page's own errors here.
    if (!ev.error && !ev.message) return;
    add("[page] " + (ev.error ? what(ev.error) : ev.message + " " + (ev.filename || "") + ":" + (ev.lineno || 0)));
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev && ev.reason;
    // A request let go (a page closed mid-fetch, a newer search) is no fault.
    if (r && (r.name === "AbortError")) return;
    add("[page] a promise refused with no one to hear it: " + what(r));
  });
  window.addEventListener("pagehide", send);
  // For the tests: what is waiting, sent now.
  window.__sendPageErrors = send;
})();
