/* ------------------------------------------------------------------ */
/*  Settings → Updates: the Mandarin Bridges' rows (item 291)          */
/* ------------------------------------------------------------------ */
// Every Mandarin Bridge Mandarin knows (Android, Linux, a Raspberry Pi), a
// row each under the server's: its name and version, and its button, Update
// available where a newer build is published for it (a tap asks it to update
// itself: GET /api/update/bridges, POST /api/update/bridges/apply,
// Admin/BridgeUpdates.cs), else how it stands; where nothing is to be done,
// Check for update, as the server's row (item 293): a tap asks GitHub again
// (?fresh=1) and says what it found for a few seconds. While one updates, the
// rows are asked for again until it is done. Where its update failed or waits
// on the device, what the Bridge said is under its row (item 327). The Android
// app's rows are its own (SettingsUpdates.kt, core's BridgeUpdates.kt), worded
// the same.
(function initBridgeUpdates() {
  const box = document.getElementById("update-bridges");
  if (!box) return;
  const AVAILABLE = "Update available", UPDATING = "Updating…", ON_DEVICE = "Finish on the device", RETRY = "Try the update again";
  const CHECK = "Check for update", UP_TO_DATE = "Up to date", NONE = "Nothing published";
  let held = null;   // a Bridge whose check's answer is on its button, for its few seconds
  let timer = null;

  // A Bridge's button as it stands ([b], the server's word on it): Check for update where nothing is to be done, else how it stands.
  const words = b => { const w = said(b); return w === UP_TO_DATE || w === NONE ? CHECK : w; };

  // How a Bridge stands ([b]), as a check of it says.
  function said(b) {
    const state = (b.update && b.update.state) || "";
    if (state === "downloading" || state === "installing" || state === "restarting") return UPDATING;
    if (state === "needs-you") return ON_DEVICE;
    if (!b.reachable) return "Not answering";
    if (!b.updates) return "Update by hand once";
    if (state === "failed" && b.available) return RETRY;
    if (b.available) return AVAILABLE;
    if (!b.latest) return NONE;
    return UP_TO_DATE;
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
    btn.textContent = held && held.id === b.id ? held.words : w;
    btn.classList.toggle("is-update-ready", tap);
    btn.disabled = !(tap || w === CHECK) || !!(held && held.id === b.id);
    btn.addEventListener("click", async () => {
      if (!tap) return check(b, btn);
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

  // Check for update on Bridge [b]'s row ([btn]): GitHub asked again, then its update, or what it found for a few seconds.
  async function check(b, btn) {
    btn.disabled = true; btn.textContent = "Checking…";
    const list = await look(true);
    const fresh = list && list.find(x => x.id === b.id);
    if (fresh && words(fresh) === AVAILABLE) return;
    held = { id: b.id, words: fresh ? said(fresh) : "Check failed" };
    if (list) draw(list); else btn.textContent = held.words;
    setTimeout(() => { held = null; look(); }, 4000);
  }

  // What Bridge [b] said of its update, under its row, where it failed or waits on the device; else null.
  function why(b) {
    const w = words(b), says = b.update && b.update.says;
    if (!says || (w !== RETRY && w !== ON_DEVICE)) return null;
    const p = document.createElement("p");
    p.className = "settings-bridge-why"; p.setAttribute("data-parity", "settings-system.bridge-why");
    p.textContent = says;
    return p;
  }

  function draw(list) {
    box.textContent = "";
    box.classList.toggle("hidden", !list.length);
    list.forEach(b => { box.appendChild(row(b)); const w = why(b); if (w) box.appendChild(w); });
  }

  // The rows as the server says they stand ([fresh]: GitHub asked again); asked again in a few seconds while one is under way.
  async function look(fresh) {
    clearTimeout(timer);
    let list;
    try { list = ((await (await fetch("/api/update/bridges" + (fresh === true ? "?fresh=1" : ""), { cache: "no-store" })).json()) || {}).bridges || []; } catch (e) { return null; }
    draw(list);
    if (list.some(b => { const w = words(b); return w === UPDATING || w === ON_DEVICE; })) soon(3000);
    return list;
  }
  function soon(ms) { clearTimeout(timer); timer = setTimeout(look, ms); }

  look();
  document.querySelectorAll('.settings-nav-item[data-pane="system"]').forEach(b => b.addEventListener("click", () => look()));
})();
