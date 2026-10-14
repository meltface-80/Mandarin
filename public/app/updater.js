/* ------------------------------------------------------------------ */
/*  Self-update: poll status, show a toast, install on tap            */
/*  (in the Android app, the app's update rides along: one offer, one  */
/*  Update, the server's and the app's started together)              */
/* ------------------------------------------------------------------ */
(function initUpdater() {
  const toast    = document.getElementById("update-toast");
  const textEl   = document.getElementById("update-text");
  const actions  = document.getElementById("update-actions");
  const btnNow   = document.getElementById("update-now");
  const btnLater = document.getElementById("update-later");
  const notesEl  = document.getElementById("update-notes");
  if (!toast || !btnNow) return;

  const PHASE = {
    checking:   "Preparing\u2026",
    downloading:"Downloading\u2026",
    extracting: "Unpacking\u2026",
    preparing:  "Fetching the C# server\u2026",
    restarting: "Restarting\u2026"
  };
  const DISMISS_KEY = "rra-update-dismissed";
  // Set before the page reloads on a new server (v0.7.3): the app is asked
  // afresh on the next check, in case its build landed meanwhile.
  const RESTARTED_KEY = "rra-update-restarted";
  const appUpd = window.__musicdAppUpd;
  let applying = false;
  let pollTimer = null;
  // What the banner is offering right now.
  let offer = { server: false, app: false, sig: "" };
  // The app's update, held back while the server's runs (v0.7.3): installing
  // the app replaces this page, so it goes last, once the server is back —
  // the server's outcome is seen, and a failure is shown and retryable.
  let appAfterServer = false;
  // The app last asked afresh (not its hour's cache) for this server version.
  let appForcedFor = "";

  // "0.3.20" newer than "0.3.19", part by part; a pre-release before its
  // release, and RC2 before RC10 (0.6.0-RC1 < 0.6.0-RC2 < 0.6.0).
  window.__verNewer = (x, y) => {
    const parse = v => {
      const s = String(v).trim().replace(/^v/i, "");
      const i = s.indexOf("-");
      return { core: (i < 0 ? s : s.slice(0, i)).split(".").map(n => parseInt(n, 10) || 0), pre: i < 0 ? null : s.slice(i + 1).toLowerCase() };
    };
    const a = parse(x), b = parse(y);
    for (let i = 0; i < Math.max(a.core.length, b.core.length); i++) {
      if ((a.core[i] || 0) !== (b.core[i] || 0)) return (a.core[i] || 0) > (b.core[i] || 0);
    }
    if (!a.pre || !b.pre) return !a.pre && !!b.pre;
    const pa = a.pre.match(/\d+|\D+/g) || [], pb = b.pre.match(/\d+|\D+/g) || [];
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if (pa[i] === undefined || pb[i] === undefined) return pb[i] === undefined && pa[i] !== undefined;
      const na = /^\d+$/.test(pa[i]) && /^\d+$/.test(pb[i]);
      if (pa[i] !== pb[i]) return na ? Number(pa[i]) > Number(pb[i]) : pa[i] > pb[i];
    }
    return false;
  };
  const verNewer = window.__verNewer;

  const dismissedVer = () => { try { return sessionStorage.getItem(DISMISS_KEY) || ""; } catch (e) { return ""; } };
  const setDismissed = (v) => { try { sessionStorage.setItem(DISMISS_KEY, v); } catch (e) { /* storage is optional (private browsing, over quota) */ } };
  const show = (msg) => { textEl.textContent = msg; toast.classList.add("open"); };
  const hide = () => { toast.classList.remove("open"); if (notesEl) notesEl.classList.add("hidden"); };

  function showNotes(notes) {
    if (!notesEl || !notes) { if (notesEl) notesEl.classList.add("hidden"); return; }
    notesEl.textContent = notes;
    notesEl.classList.remove("hidden");
  }

  function showProgress(phase) {
    applying = true;
    window.__musicdUpdating = true;   // the empty-screen notice keeps quiet meanwhile
    actions.classList.add("busy");
    toast.classList.remove("is-error");
    if (notesEl) notesEl.classList.add("hidden");
    show(PHASE[phase] || "Updating\u2026");
  }

  // The banner's line for what's on offer: the server, this app, or both.
  function offerText(s, a, server, app) {
    if (server && app) {
      return s.latest === a.latest
        ? "v" + s.latest + " available for the server and this app (you have v" + s.current + ")"
        : "Server v" + s.latest + " and app v" + a.latest + " available";
    }
    if (app) return "App v" + a.latest + " available (you have v" + a.current + ")";
    let line = (s.isDowngrade ? "Rollback to v" : "v") + s.latest + " available (you have v" + s.current + ")";
    // In the Android app, the server ahead of the app with no newer app on
    // GitHub yet: its build follows the release by a few minutes.
    if (a && a.current && verNewer(s.latest, a.current) && !(a.latest && verNewer(a.latest, a.current))) line += " · the app's v" + s.latest + " follows in a few minutes";
    return line;
  }

  async function check() {
    if (applying) return;
    let s = null;
    try {
      const r = await fetch("/api/update/status", { cache: "no-store" });
      if (r.ok) s = await r.json();
    } catch (e) { /* offline; try again next tick */ }
    if (s) {
      const ph = s.apply && s.apply.phase;
      if (ph === "downloading" || ph === "extracting" || ph === "preparing" || ph === "restarting") {
        showProgress(ph); startPoll(s.latest); return;
      }
    }
    const server = !!(s && s.available && s.latest);
    // The app asked afresh, not from its hour's cache (v0.7.3), once per
    // server version on offer and once after a restart on a new server: the
    // app's build lands minutes after the server's release, and the cache
    // was what kept the banner saying "server only" for up to an hour.
    let restarted = false;
    try { restarted = sessionStorage.getItem(RESTARTED_KEY) === "1"; if (restarted) sessionStorage.removeItem(RESTARTED_KEY); } catch (e) { /* storage is optional (private browsing, over quota) */ }
    const want = server ? "s" + s.latest : restarted ? "r" + (s && s.current) : "";
    const force = !!want && want !== appForcedFor;
    if (force) appForcedFor = want;
    const a = appUpd ? await appUpd.look(force) : null;
    if (applying) return;
    const app = !!(a && a.available && a.latest && !a.installing);
    const sig = (server ? "s" + s.latest : "") + (app ? "a" + a.latest : "");
    if ((server || app) && sig !== dismissedVer()) {
      offer = { server, app, sig };
      actions.classList.remove("busy"); btnNow.disabled = false;
      toast.classList.remove("is-error");
      show(offerText(s, a, server, app));
      showNotes(server ? s.notes : null);
      btnNow.querySelector("span").textContent = server && s.isDowngrade && !app ? "Roll back" : "Update";
    } else {
      hide();
    }
  }

  function startPoll(targetVer) {
    if (pollTimer) clearInterval(pollTimer);
    let wasDown = false;
    pollTimer = setInterval(async () => {
      try {
        const r = await fetch("/api/update/status", { cache: "no-store" });
        if (!r.ok) throw new Error("bad");
        const s = await r.json();
        // Back on the new version — seen as the version itself, not only as a
        // failed fetch while it restarted (a quick restart can fall between
        // two polls, which left the banner on "Restarting…" for good).
        if ((targetVer && s.current === targetVer) || (wasDown && !s.available)) {
          clearInterval(pollTimer);
          // The server is back on the new version: now the app's turn (its
          // download, then Android's installer), and the page reloaded
          // under it, to ask the app afresh if its build was not there yet.
          try { sessionStorage.setItem(RESTARTED_KEY, "1"); } catch (e) { /* storage is optional (private browsing, over quota) */ }
          if (appAfterServer && appUpd) { appAfterServer = false; appUpd.install(); }
          location.reload(); return;
        }
        const ph = s.apply && s.apply.phase;
        if (ph === "error") {
          clearInterval(pollTimer); applying = false;
          actions.classList.remove("busy"); btnNow.disabled = false;
          toast.classList.add("is-error");
          show("Update failed: " + ((s.apply && s.apply.error) || "unknown") + ". Tap Update to retry" + (appAfterServer ? " (the app's update waits for it)" : "") + ".");
          return;
        }
        if (PHASE[ph]) show(PHASE[ph]);
      } catch (e) {
        wasDown = true;                 // server is restarting
        show(PHASE.restarting);
      }
    }, 1500);
    setTimeout(() => {
      if (pollTimer && applying) {
        clearInterval(pollTimer);
        show("Update is taking a while \u2014 if the app doesn't come back on its own, restart the container (docker restart musicd-server).");
      }
    }, 180000);
  }

  btnNow.addEventListener("click", async () => {
    if (applying) return;
    // The server first, the app after (v0.7.3). Installing the app replaces
    // this page, so started together the server's update ran unseen — a
    // failure never shown, the offer back on the next open. Now the app's
    // download and Android's installer (an app not from a store always
    // asks) follow once the server is back; the app alone goes at once.
    if (offer.app && appUpd && !offer.server) { appUpd.install(); hide(); return; }
    appAfterServer = !!(offer.app && appUpd);
    if (!offer.server) { hide(); return; }
    btnNow.disabled = true;
    showProgress("checking");
    try {
      const r = await fetch("/api/update/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const s = await r.json().catch(() => null);
      if (!r.ok) {
        applying = false; actions.classList.remove("busy"); btnNow.disabled = false;
        toast.classList.add("is-error");
        show("Couldn't start update: " + ((s && s.error) || ("HTTP " + r.status)));
        return;
      }
      startPoll(s && s.status && s.status.latest);
    } catch (e) {
      startPoll(null);                  // request cut off by restart — keep polling
    }
  });

  btnLater.addEventListener("click", () => {
    if (offer.sig) setDismissed(offer.sig);
    hide();
  });

  // Settings' "Check for updates" flow hands off here after its own check:
  // applying through the banner keeps a single implementation of the
  // download/unpack/restart progress UI (the banner sits behind the Settings
  // sheet, so the caller closes Settings first). Clearing the "Later"
  // dismissal lets the banner's error/retry states show normally afterwards.
  // In the Android app it says which: { server, app } (both by default).
  window.__applyUpdateNow = (what) => {
    setDismissed("");
    if (what) offer = { server: !!what.server, app: !!what.app, sig: "" };
    else if (!offer.server && !offer.app) offer = { server: true, app: false, sig: "" };
    btnNow.click();
  };

  window.__afterStart(check);   // a notice, not the first screen
  setInterval(() => { if (!document.hidden) check(); }, 15 * 60 * 1000);
})();
