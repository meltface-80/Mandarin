/* ------------------------------------------------------------------ */
/*  Check for updates button in settings                               */
/* ------------------------------------------------------------------ */
(function initCheckUpdate() {
  const btn      = document.getElementById("check-update-btn");
  const notesDiv = document.getElementById("settings-release-notes");
  if (!btn) return;
  // After a check finds an update, the button itself becomes the install
  // action (the old copy said "tap Update below", but the update banner sits
  // BEHIND the Settings sheet — there was no visible button to tap).
  let pendingUpdate = false;
  const appUpd = window.__musicdAppUpd;
  // Shared with the update banner (v0.7.3).
  const verNewer = window.__verNewer;
  let pendingWhat = null;          // { server, app } in the Android app

  btn.addEventListener("click", async () => {
    if (btn.disabled) return;

    if (pendingUpdate) {
      // Second tap: install. Close Settings so the update banner (which owns
      // the download/unpack/restart progress UI) is visible, then hand off.
      pendingUpdate = false;
      btn.classList.remove("is-update-ready");
      const closer = document.querySelector("#settings-overlay [data-settings-close]");
      if (closer) closer.click();
      if (window.__applyUpdateNow) window.__applyUpdateNow(pendingWhat);
      // The banner owns all progress/error/retry state from here — reset this
      // button so a reopened Settings offers a fresh check (on success the
      // page reloads anyway; on failure the banner shows the retry, and a
      // disabled "Updating…" here would strand with no reset path).
      btn.textContent = "Check for updates";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Checking…";
    if (notesDiv) notesDiv.classList.add("hidden");
    try {
      // In the Android app, the app looks for its own update at the same time.
      const appLook = appUpd ? appUpd.look(true) : Promise.resolve(null);
      await fetch("/api/update/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const r = await fetch("/api/update/status", { cache: "no-store" });
      const s = await r.json();
      const a = await appLook;
      const server = !!(s && s.available && s.latest);
      const app = !!(a && a.available && a.latest);
      if (server || app) {
        pendingUpdate = true;
        pendingWhat = { server, app };
        btn.disabled = false;
        btn.classList.add("is-update-ready");
        btn.textContent = server && app
          ? (s.latest === a.latest ? "Update server and app to v" + s.latest : "Update server and app")
          : app ? "Update app to v" + a.latest
          : s.isDowngrade ? "Roll back to v" + s.latest
          : "Update to v" + s.latest;
        if (notesDiv && server && s.notes) {
          notesDiv.textContent = s.notes;
          notesDiv.classList.remove("hidden");
        }
      } else if (a && s && s.current && a.current && verNewer(s.current, a.current)) {
        // The server is ahead of the app, and GitHub doesn't have the app yet:
        // it's built after the server's release, a few minutes later. Not a
        // test build's (dev's 1.1.9-tN, item 178): the app updates from main's
        // dist/, which never has one, so that is said rather than promised. The
        // Android app's own Settings says the same (core UpdateCheck.kt).
        btn.textContent = /-t\d+$/i.test(String(s.current).trim())
          ? "Server v" + s.current + " is a test build — the app's test builds are installed from the test-android page"
          : "App v" + s.current + " is on its way — try again in a few minutes";
        setTimeout(() => { btn.disabled = false; btn.textContent = "Check for updates"; }, 6000);
      } else {
        btn.textContent = a
          ? "Up to date (server v" + (s && s.current || "?") + ", app v" + (a.current || "?") + ")"
          : "Up to date (v" + (s && s.current || "?") + ")";
        setTimeout(() => { btn.disabled = false; btn.textContent = "Check for updates"; }, 4000);
      }
    } catch (e) {
      btn.textContent = "Check failed";
      setTimeout(() => { btn.disabled = false; btn.textContent = "Check for updates"; }, 3000);
    }
  });
})();
