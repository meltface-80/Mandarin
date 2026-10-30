/* ------------------------------------------------------------------ */
/*  Android app only: Settings → System shows the app's own version    */
/*  and looks for a newer app (the server's updater doesn't touch it). */
/* ------------------------------------------------------------------ */
(function androidAppUpdateRow() {
  const app = window.MusicdApp;
  const pane = document.querySelector('.settings-pane[data-pane="system"] .settings-block');
  if (!app || !pane) return;
  const row = document.createElement("div");
  row.className = "settings-row";
  const label = document.createElement("span");
  label.className = "settings-label"; label.setAttribute("data-parity", "settings-system.name");
  let v = "";
  try { v = app.version(); } catch (e) { /* an app without this call (older than the page): nothing to do */ }
  label.textContent = "Android app" + (v ? " v" + v : "");
  // Its own row and its own button (item 223), above what's new, which is under both rows.
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "settings-update-btn"; btn.setAttribute("data-parity", "settings-system.app-check");
  btn.textContent = "Check for update";
  btn.addEventListener("click", () => { try { app.checkUpdate(); } catch (e) { /* an app without this call (older than the page): nothing to do */ } });
  row.appendChild(label); row.appendChild(btn);
  pane.insertBefore(row, document.getElementById("settings-whats-new"));
  // This phone's own Tailscale (the app's): in Settings → Away from home,
  // beside the server's — one place for getting at the library away.
  const awayPane = document.querySelector('.settings-pane[data-pane="away"]');
  if (typeof app.tailscaleTest === "function" && awayPane) {
    const blk = document.createElement("div");
    blk.className = "settings-block away-phone";
    blk.innerHTML = '<div class="settings-divider"></div><div class="settings-subhead" data-parity="settings-away.phone-title">This phone</div>' +
      '<div class="settings-row"><span class="settings-label" data-parity="settings-away.name">Tailscale on this phone' + settingsInfo("The app has its own Tailscale — no Tailscale app needed. Sign it in once, with the same account as the server; away from home the app then reaches the server by itself.", "settings-away.info") + "</span>" +
      '<button type="button" class="settings-update-btn away-phone-open" data-parity="settings-away.phone-open">Tailscale</button></div>' +
      '<div class="settings-note" data-parity="settings-away.note">Built into the app; sign in with the server’s account.</div>';
    // The Tailscale button itself: the first button in the row is the ⓘ (v0.6.15 — until
    // then the tap went to the ⓘ, and Tailscale did nothing).
    blk.querySelector(".away-phone-open").addEventListener("click", () => { try { app.tailscaleTest(); } catch (e) { /* an app without this call (older than the page): nothing to do */ } });
    awayPane.appendChild(blk);
  }
})();
