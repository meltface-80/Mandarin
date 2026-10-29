/* ------------------------------------------------------------------ */
/*  Settings → Updates: the server's row (item 223)                    */
/* ------------------------------------------------------------------ */
// The server's name with its version and its own button: Check for update,
// which looks for the server's update alone and becomes Update available
// once one is found (installing it on the next tap), or says how things
// stand for a few seconds. Opened, it says what the last check found. Under
// it, what the update brings: the release's short lines ("• Fixed - …"),
// which the server takes from its notes (Admin/ReleaseNotes.cs). The Android
// app has a row of its own beside it, natively (SettingsUpdates.kt).
(function initCheckUpdate() {
  const btn  = document.getElementById("check-update-btn");
  const name = document.getElementById("update-server-name");
  const box  = document.getElementById("settings-whats-new");
  if (!btn) return;
  const CHECK = "Check for update", AVAILABLE = "Update available";
  let found = null;          // { latest, notes } once an update is on offer

  // What's new under the row: its heading and its short lines, or nothing.
  function whatsNew(f) {
    if (!box) return;
    box.textContent = "";
    box.classList.toggle("hidden", !(f && f.notes));
    if (!(f && f.notes)) return;
    const head = document.createElement("div");
    head.className = "settings-release-head"; head.setAttribute("data-parity", "settings-system.notes-head");
    head.textContent = "What's new in v" + f.latest;
    const notes = document.createElement("div");
    notes.className = "settings-release-notes"; notes.setAttribute("data-parity", "settings-system.notes");
    notes.textContent = f.notes;
    box.appendChild(head); box.appendChild(notes);
  }

  // The server's status ([s]) as it stands: its version in the name, and its update on offer, if any.
  function show(s) {
    if (s && s.current && name) name.textContent = "Server v" + s.current;
    found = s && s.available && s.latest ? { latest: s.latest, notes: s.notes || null } : null;
    btn.classList.toggle("is-update-ready", !!found);
    btn.textContent = found ? AVAILABLE : CHECK;
    whatsNew(found);
  }

  const status = async () => (await fetch("/api/update/status", { cache: "no-store" })).json();
  const look = () => { if (!btn.disabled) status().then(show).catch(() => {}); };
  look();
  document.querySelectorAll('.settings-nav-item[data-pane="system"]').forEach(b => b.addEventListener("click", look));

  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    if (found) {
      // Update available, tapped: Settings closes so the update banner (which owns
      // the download/unpack/restart progress) is seen, and installs the server's.
      found = null;
      btn.classList.remove("is-update-ready");
      btn.textContent = CHECK;
      whatsNew(null);
      const closer = document.querySelector("#settings-overlay [data-settings-close]");
      if (closer) closer.click();
      if (window.__applyUpdateNow) window.__applyUpdateNow({ server: true, app: false });
      return;
    }
    btn.disabled = true;
    btn.textContent = "Checking…";
    whatsNew(null);
    let said = "Check failed";
    try {
      await fetch("/api/update/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const s = await status();
      if (s && s.available && s.latest) { btn.disabled = false; show(s); return; }
      if (s && s.current && name) name.textContent = "Server v" + s.current;
      said = s && !s.error ? "Up to date" : "Check failed";
    } catch (e) { /* said: Check failed */ }
    btn.textContent = said;
    setTimeout(() => { btn.disabled = false; btn.textContent = CHECK; }, 4000);
  });
})();
