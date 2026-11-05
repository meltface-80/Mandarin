/* ------------------------------------------------------------------ */
/*  Settings → Updates: the Mandarin Bridges' rows (item 291)          */
/* ------------------------------------------------------------------ */
// Every Mandarin Bridge Mandarin knows (Android, Linux, a Raspberry Pi), a
// row each under the server's: its name and version, and its button, Update
// available where a newer build is published for it (a tap asks it to update
// itself: GET /api/update/bridges, POST /api/update/bridges/apply,
// Admin/BridgeUpdates.cs), else how it stands. While one updates, the rows
// are asked for again until it is done. The Android app's rows are its own
// (SettingsUpdates.kt, core's BridgeUpdates.kt), worded the same.
(function initBridgeUpdates() {
  const box = document.getElementById("update-bridges");
  if (!box) return;
  const AVAILABLE = "Update available", UPDATING = "Updating…", ON_DEVICE = "Finish on the device", RETRY = "Try the update again";
  let timer = null;

  // A Bridge's button as it stands ([b], the server's word on it): its words, and whether a tap updates it.
  function words(b) {
    const state = (b.update && b.update.state) || "";
    if (state === "downloading" || state === "installing" || state === "restarting") return UPDATING;
    if (state === "needs-you") return ON_DEVICE;
    if (!b.reachable) return "Not answering";
    if (!b.updates) return "Update by hand once";
    if (state === "failed" && b.available) return RETRY;
    if (b.available) return AVAILABLE;
    if (!b.latest) return "Nothing published";
    return "Up to date";
  }

  function row(b) {
    const r = document.createElement("div");
    r.className = "settings-row";
    const name = document.createElement("span");
    name.className = "settings-label"; name.setAttribute("data-parity", "settings-system.name");
    name.textContent = b.name + " · Bridge" + (b.version ? " v" + b.version : "");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-update-btn"; btn.setAttribute("data-parity", "settings-system.bridge-update");
    const w = words(b), tap = w === AVAILABLE || w === RETRY;
    btn.textContent = w;
    btn.classList.toggle("is-update-ready", tap);
    btn.disabled = !tap;
    if (b.update && b.update.says && (w === ON_DEVICE || w === RETRY)) btn.title = b.update.says;
    btn.addEventListener("click", async () => {
      btn.disabled = true; btn.textContent = UPDATING; btn.classList.remove("is-update-ready");
      try {
        const res = await fetch("/api/update/bridges/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: b.id }) });
        if (!res.ok) { const e = await res.json().catch(() => ({})); btn.textContent = e.error || "Update failed"; }
      } catch (e) { btn.textContent = "Update failed"; }
      soon(2000);
    });
    r.appendChild(name); r.appendChild(btn);
    return r;
  }

  // The rows as the server says they stand; asked again in a few seconds while one is under way.
  async function look() {
    clearTimeout(timer);
    let list;
    try { list = ((await (await fetch("/api/update/bridges", { cache: "no-store" })).json()) || {}).bridges || []; } catch (e) { return; }
    box.textContent = "";
    box.classList.toggle("hidden", !list.length);
    list.forEach(b => box.appendChild(row(b)));
    if (list.some(b => { const w = words(b); return w === UPDATING || w === ON_DEVICE; })) soon(3000);
  }
  function soon(ms) { clearTimeout(timer); timer = setTimeout(look, ms); }

  look();
  document.querySelectorAll('.settings-nav-item[data-pane="system"]').forEach(b => b.addEventListener("click", look));
  window.__bridgeUpdatesLook = look;
})();
