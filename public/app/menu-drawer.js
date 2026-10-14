/* ------------------------------------------------------------------ */
/*  Side menu (hamburger drawer)                                        */
/*  Items with data-target trigger the hidden top-bar button of that   */
/*  id; data-action items switch the main view (home / random wall).   */
/* ------------------------------------------------------------------ */
(function initMenuDrawer() {
  const overlay = document.getElementById("menu-overlay");
  const toggle  = document.getElementById("menu-toggle");
  if (!overlay || !toggle) return;

  // Manual library rescan: rebuilds the album snapshot, but the server refuses
  // (status "importing") while Roon is still adding albums, so a deliberate
  // press never fights an active import.
  // What a finished scan found, as the toast says it. The server's own
  // words ("updated"/"unchanged") are read the same as the page's.
  function scanDoneText(j) {
    const albums = j.count != null ? j.count : j.albums;
    const added = Number(j.added) || 0;
    if (j.status === "fresh" || j.status === "unchanged") return "Library already up to date" + (albums ? " — " + albums + " albums" : "") + servicesNext(j);
    return "Library rescanned — " + (albums || 0) + " albums" + (added ? " (" + added + " new " + (added === 1 ? "track" : "tracks") + ")" : "") + servicesNext(j);
  }
  // The streaming services the server goes on to, in order: "· now Qobuz, then Tidal".
  function servicesNext(j) {
    const s = Array.isArray(j.services) ? j.services : [];
    return s.length ? " · now " + s[0] + s.slice(1).map(n => ", then " + n).join("") : "";
  }

  // A scan still going when the server answered: wait for it here, then say
  // how it ended — rather than leave "scanning in the background" as the last word.
  async function waitForScan() {
    const toast = window.__showToast || (() => {});
    const until = Date.now() + 60 * 60 * 1000;
    while (Date.now() < until) {
      await new Promise(r => setTimeout(r, 2500));
      let s;
      try { s = await (await fetch("/api/status", { cache: "no-store" })).json(); } catch (e) { continue; }
      const scan = s && s.scan;
      if (!scan || scan.running) continue;
      const last = scan.last || {};
      if (last.status === "no-music") toast("The music folder isn't there — check the /music mount", "error");
      else toast(scanDoneText(Object.assign({ count: s.index_count }, last)));
      refreshRescanSub();
      return;
    }
  }

  async function rescanLibrary() {
    const toast = window.__showToast || (() => {});
    toast("Scanning your music folder…");
    try {
      const r = await fetch("/api/library/rescan", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      const st = j.status;
      const done = ["rebuilt", "updated", "fresh", "unchanged"].includes(st);
      const going = ["scanning", "running", "busy"].includes(st);
      const msg =
        done                     ? scanDoneText(j) :
        st === "scanning"        ? "Scanning in the background — new albums appear as it goes" :
        st === "running" || st === "busy" ? "A scan is already running — you'll hear when it's done" :
        st === "no-music"        ? "The music folder isn't there — check the /music mount" :
                                   (j.error || "Rescan failed");
      toast(msg, done || going ? undefined : "error");
      refreshRescanSub();   // the row's sub-line is now stale whatever happened
      if (going) waitForScan();
    } catch (e) {
      toast("Rescan failed", "error");
    }
  }

  // Roon's all-zone actions. They live in the zone picker — the sheet that is
  // already about "which zones", which is what these act on — and the popover
  // is closed by the time they run, so a toast is the only feedback channel.
  // Mute and unmute are separate rows rather than one toggle: the popover is
  // shut when the state changes, so a single "Mute all" would be wrong half
  // the time.
  async function allZones(url, body, pending, okMsg, failMsg) {
    const toast = window.__showToast || (() => {});
    toast(pending);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return toast(j.error || failMsg, "error");
      toast(okMsg);
    } catch (e) {
      toast(failMsg, "error");
    }
  }

  // Exposed for the two zone pickers (now-playing and mini-transport), which
  // are built in different closures. One implementation, three named actions,
  // so the two pickers cannot drift apart on wording or endpoint.
  window.__allZoneActions = {
    "pause-all":  () => allZones("/api/pause-all", null, "Pausing every zone…",
                                 "All zones paused", "Could not pause all zones"),
    "mute-all":   () => allZones("/api/mute-all", { how: "mute" }, "Muting every zone…",
                                 "All zones muted", "Could not mute all zones"),
    "unmute-all": () => allZones("/api/mute-all", { how: "unmute" }, "Unmuting every zone…",
                                 "All zones unmuted", "Could not unmute all zones"),
  };

  // What the snapshot is right now, under the Rescan row. Every phrase here is
  // deliberately PAST tense or explicitly a schedule, because none of it can be
  // a claim about this instant: `library_importing` is set at the last check
  // and cleared at the next clean one, and Roon publishes no import-finished
  // event to make it live. Saying "Roon is importing" would be a confident lie
  // dressed up as a status line.
  function libraryAgeText(ms) {
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 2)    return "just now";
    if (mins < 60)   return mins + " min ago";
    const hrs = Math.round(mins / 60);
    if (hrs < 48)    return hrs + (hrs === 1 ? " hour ago" : " hours ago");
    return Math.round(hrs / 24) + " days ago";
  }
  async function refreshRescanSub() {
    const el = document.getElementById("rescan-sub");
    if (!el) return;
    try {
      const r = await fetch("/api/status");
      const j = await r.json();
      if (!j.paired) { el.textContent = "Server not ready"; return; }
      const albums = (j.index_count || 0).toLocaleString() + " albums";
      if (j.library_importing) {
        el.textContent = albums + " · scanning the music folder now";
      } else if (j.library_recheck_pending) {
        el.textContent = albums + " · the library moved, checking again shortly";
      } else if (j.index_built_at) {
        el.textContent = albums + " · checked " + libraryAgeText(j.index_built_at);
      } else {
        el.textContent = "No snapshot yet";
      }
    } catch (e) {
      // The drawer must open regardless. An empty sub-line reads as "no
      // information", which is exactly what a failed status call means.
      el.textContent = "";
    }
  }

  // Offline mode (v0.5.58): only in the app, which keeps the setting.
  function offlineModeOn() {
    try { return !!JSON.parse(window.MusicdDownloads.settings()).offlineMode; } catch (e) { return false; }
  }
  function paintOfflineItem() {
    const item = document.getElementById("menu-item-offline");
    if (!item) return;
    let has = false;
    try { has = "offlineMode" in JSON.parse(window.MusicdDownloads.settings()); } catch (e) { /* an older app's settings: no offline switch */ }
    item.classList.toggle("hidden", !has);
    if (!has) return;
    const on = offlineModeOn();
    // Shelf is the server's whole library, a page of its own: not offline.
    const shelfItem = overlay.querySelector('.menu-item[data-action="shelf"]');
    if (shelfItem) shelfItem.classList.toggle("hidden", on);
    item.classList.toggle("is-on", on);
    item.setAttribute("aria-checked", String(on));
    const sub = document.getElementById("offline-sub");
    if (sub) sub.textContent = on ? "On · only the music on this phone" : "Off";
  }
  paintOfflineItem();

  const openMenu  = () => { overlay.classList.remove("hidden"); refreshRescanSub(); paintOfflineItem(); };
  const closeMenu = () => overlay.classList.add("hidden");
  // The menu open again on the page the Offline switch reloads to (v0.6.20).
  const REOPEN_KEY = "rra-menu-reopen";
  try {
    const at = Number(localStorage.getItem(REOPEN_KEY) || 0);
    localStorage.removeItem(REOPEN_KEY);
    if (at && Date.now() - at < 30000) openMenu();
  } catch (e) { /* storage refused */ }

  toggle.addEventListener("click", openMenu);
  // Closed by a tap on the page beside it (the backdrop), Escape, or an
  // item chosen (v0.6.19) — not by a blank part of the menu, and not by
  // the Offline switch, which stays open to show what it did.
  overlay.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest(".menu-drawer")) return;
    if (e.target.closest && e.target.closest("[data-menu-close]")) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeMenu();
  });

  overlay.querySelectorAll(".menu-item").forEach((item) => {
    item.addEventListener("click", () => {
      const action = item.dataset.action;
      const target = item.dataset.target;
      if (action !== "offline-mode") closeMenu();

      if (action === "offline-mode") {
        // The app reloads the page onto the phone's music, or back onto the
        // server — which would take the menu with it. It is reopened on the
        // page that follows (v0.6.20): the switch is the only thing that moved.
        try { localStorage.setItem(REOPEN_KEY, String(Date.now())); } catch (e) { /* storage is optional (private browsing, over quota) */ }
        try { window.MusicdDownloads.set("offlineMode", String(!offlineModeOn())); } catch (e) { /* an app without this call (older than the page): nothing to do */ }
        return;
      }
      if (action === "home") {
        if (window.__showHome) window.__showHome();
        return;
      }
      if (action === "later") {
        if (window.__showListenLater) window.__showListenLater();
        return;
      }
      if (action === "shelf") {
        // A page of its own. Marked as opened from here, so its "‹ Remote"
        // goes back to this page as it was left rather than loading it again.
        try { sessionStorage.setItem("rra-display-from-remote", "1"); } catch (e) { /* storage is optional (private browsing, over quota) */ }
        location.assign("/shelf");
        return;
      }
      if (action === "shuffle") {
        // Clear any active filter/labels so "Random albums" is a fresh wall.
        // applyFilter(null) reveals the wall and loads it.
        if (window.__applyFilter) window.__applyFilter(null);
        else if (window.__loadRandom) window.__loadRandom();
        return;
      }
      if (action === "rescan-library") {
        rescanLibrary();
        return;
      }
      if (action === "smart-picks") {
        if (window.__showSmartPicks) window.__showSmartPicks();
        return;
      }
      if (action === "smart-playlists") {
        if (window.__showSmartPlaylists) window.__showSmartPlaylists();
        return;
      }
      if (action === "playlists") {
        if (window.__showPlaylists) window.__showPlaylists();
        return;
      }
      if (action === "import-playlist") {
        if (window.__openImportSheet) window.__openImportSheet();
        return;
      }

      // Everything else just triggers the original control; each one manages
      // its own view — Filter/Labels reveal the wall when they render, Qobuz/
      // Tidal/Settings open an overlay over Home, Play-unheard just plays.
      if (target) {
        const btn = document.getElementById(target);
        if (btn) btn.click();
      }
    });
  });
})();
