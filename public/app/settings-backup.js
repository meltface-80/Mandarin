/* ------------------------------------------------------------------ */
/*  Backup & restore (v0.6.14): Settings → Backup & restore. Backups   */
/*  are kept on the server (a browser's), or saved to and restored     */
/*  from a file on the phone (the Android app, window.MusicDBackup).   */
/*  A restore puts back the ticked parts, then the server restarts and */
/*  the page reloads; this device's screen settings are put back here. */
/* ------------------------------------------------------------------ */
(() => {
  const pane = document.querySelector('.settings-pane[data-pane="backup"]');
  if (!pane) return;
  const partsEl  = document.getElementById("backup-parts");
  const listEl   = document.getElementById("backup-list");
  const noteEl   = document.getElementById("backup-note");
  const toServer = document.getElementById("backup-to-server");
  const toFile   = document.getElementById("backup-to-file");
  const fromFile = document.getElementById("restore-from-file");
  const passEl   = document.getElementById("backup-pass");   // v0.9.0: seals the keys (Admin/Backup.Seal.cs)
  const APP = window.MusicDBackup && typeof window.MusicDBackup.available === "function" ? window.MusicDBackup : null;
  const ask = (q) => window.__confirmDialog ? window.__confirmDialog(q) : Promise.resolve(confirm(q));
  const toast = (m, kind) => { if (window.__showToast) window.__showToast(m, kind); };
  // This device's screen settings: what a person sets, never caches.
  const PAGE_KEYS = ["rra-ui-text", "rra-ui-title", "rra-ui-menu", "rra-ui-cols", "rra-ui-tile", "rra-ui-greeting", "rra-ui-random", "rra-zone", "rra-library-view",
    "rra-label-order", "rra-labels-reversed", "rra-label-min", "rra-album-view", "rra-filter", "rra-np-reduced"];
  const NAMES = {
    settings: "Settings", devices: "Players", collection: "Your collection", keys: "API keys",
    database: "The whole database", page: "This device's screen settings", app: "This app's settings"
  };
  const HINT = {
    settings: "Only the ones you changed",
    devices: "Sonos rooms, renderers and phones: names, output, DSP, levelling",
    collection: "Playlists, favourites, Listen later, album edits",
    keys: "Discogs, FanArt.tv, the Qobuz and Tidal sign-ins, and the server's Tailscale identity",
    database: "Everything Mandarin knows, play history included",
    page: "Text sizes, layout, the chosen room",
    app: "Downloads, USB DAC, this phone's DSP and levelling"
  };
  let info = null;
  const SEALED = "Its passphrase (for the keys and the whole database)";
  const fmtBytes = n => n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : n >= 1e6 ? Math.round(n / 1e6) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB";
  const fmtDate = t => new Date(t).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function pageSettings() {
    const out = {};
    for (const k of PAGE_KEYS) { try { const v = localStorage.getItem(k); if (v !== null) out[k] = v; } catch (e) { /* none */ } }
    return out;
  }
  function applyPage(page) {
    if (!page || typeof page !== "object") return;
    for (const k of PAGE_KEYS) {
      try { if (Object.prototype.hasOwnProperty.call(page, k)) localStorage.setItem(k, String(page[k])); else localStorage.removeItem(k); } catch (e) { /* storage refused */ }
    }
  }

  // The app's own Backup & restore (item 92) asks for this screen's settings, and hands back a restored set.
  window.__backupPageSettings = pageSettings;
  window.__backupApplyPage = applyPage;

  function tickBoxes(container, parts, prefix) {
    container.innerHTML = parts.map(p =>
      '<label class="backup-part" data-parity="settings-backup.part"><input type="checkbox" data-part="' + p + '" aria-label="' + esc(NAMES[p]) + '" checked>' +
      '<span><b data-parity="settings-backup.part-name">' + esc(NAMES[p]) + (p === "database" && info ? " (" + fmtBytes(info.db_bytes) + ")" : "") + '</b>' +
      '<small data-parity="settings-backup.part-hint">' + esc(HINT[p] || "") + '</small></span></label>').join("");
  }
  const ticked = container => [...container.querySelectorAll("input[data-part]:checked")].map(i => i.dataset.part);

  function backupParts() { return ["settings", "devices", "collection", "keys", "database", "page"].concat(APP ? ["app"] : []); }

  async function load() {
    try {
      const r = await fetch("/api/backup", { cache: "no-store" });
      if (!r.ok) return;
      info = await r.json();
    } catch (e) { return; }
    if (!partsEl.childElementCount) tickBoxes(partsEl, backupParts());
    toFile.hidden = fromFile.hidden = !APP;
    renderList();
  }
  document.querySelectorAll('.settings-nav-item[data-pane="backup"]').forEach(b => b.addEventListener("click", load));

  // The backup files this phone has saved (the app remembers them), v0.6.18.
  function phoneFiles() {
    if (!APP || typeof APP.files !== "function") return [];
    try { return JSON.parse(APP.files()).map(f => Object.assign({ where: "phone" }, f)); } catch (e) { return []; }
  }

  /*
   * One list, newest first: backups on the server and the files on this
   * phone, each card saying where it is — what you want to know — with the
   * device it was made from on the line below.
   */
  function renderList() {
    const items = ((info && info.backups) || []).map(b => Object.assign({ where: "server" }, b)).concat(phoneFiles())
      .sort((a, b) => (b.created || 0) - (a.created || 0));
    if (!items.length) { listEl.innerHTML = '<div class="settings-note" data-parity="settings-backup.empty">' + (APP ? "No backups yet." : "No backups on the server yet.") + "</div>"; return; }
    listEl.innerHTML = items.map(b => {
      const title = b.where === "phone" ? "On this phone" : b.kind === "auto" ? "Before restore · on the server" : "On the server";
      const meta = [fmtDate(b.created), "v" + (b.version || "?"), fmtBytes(b.bytes || 0)].concat(b.sealed ? ["sealed"] : []);
      if (b.where === "phone") meta.push(b.name || ""); else if (b.label) meta.push("from " + b.label);
      const ref = b.where === "phone" ? ' data-uri="' + esc(b.uri) + '"' : ' data-id="' + esc(b.id) + '"';
      return '<div class="backup-item" data-where="' + b.where + '"' + ref + '>' +
        '<div class="backup-item-head"><b data-parity="settings-backup.item-title">' + esc(title) + '</b><span data-parity="settings-backup.item-meta">' + esc(meta.filter(Boolean).join(" · ")) + '</span>' +
        '<small data-parity="settings-backup.item-parts">' + esc((b.parts || []).map(p => NAMES[p] || p).join(", ")) + '</small></div>' +
        '<div class="backup-item-actions">' +
          '<button data-parity="settings-backup.restore" class="settings-update-btn" type="button" data-act="restore">Restore…</button>' +
          (b.where === "server" ? '<a data-parity="settings-backup.download" class="settings-update-btn" href="/api/backup/download/' + encodeURIComponent(b.id) + '" download>Download</a>' : "") +
          '<button data-parity="settings-backup.delete" class="settings-update-btn" type="button" data-act="delete">Delete</button>' +
        '</div>' +
        '<div class="backup-restore hidden"></div>' +
      '</div>';
    }).join("");
  }

  // A restore panel: the ticks for what's in it (on the phone, everything), a sealed one's passphrase (askPass, its placeholder), and Restore.
  function openRestorePanel(panel, parts, onGo, label, askPass) {
    panel.classList.remove("hidden");
    const pass = askPass ? '<input type="password" data-parity="settings-backup.restore-pass" aria-label="Passphrase" class="settings-token-input backup-pass-in" autocomplete="off" placeholder="' + esc(askPass) + '">' : "";
    panel.innerHTML = '<div class="backup-parts"></div>' + pass + '<button data-parity="settings-backup.go" class="settings-update-btn" type="button" data-act="go">' + esc(label) + '</button>';
    tickBoxes(panel.querySelector(".backup-parts"), parts);
    panel.querySelector('[data-act="go"]').addEventListener("click", async () => {
      const want = ticked(panel);
      if (!want.length) { toast("Tick something to restore", "error"); return; }
      const server = want.filter(p => p !== "page" && p !== "app");
      const q = "Restore " + want.map(p => NAMES[p]).join(", ") + "?" +
        (server.length ? " This puts them back for every device, and Mandarin restarts. A backup of how things are now is kept first." : "") +
        (want.includes("database") ? " The whole database replaces everything Mandarin knows; your account and sign-ins stay." : "");
      if (!(await ask(q))) return;
      onGo(want, askPass ? panel.querySelector(".backup-pass-in").value : "");
    });
  }

  async function finishRestore(j) {
    if (!j || !j.ok) { if (!(j && j.cancelled)) toast((j && j.error) || "Restore failed", "error"); return; }
    if (j.page) applyPage(j.page);
    if (j.app && APP) { try { APP.applyApp(JSON.stringify(j.app)); } catch (e) { /* the app said no */ } }
    const again = j.app_result && j.app_result.choose_again && j.app_result.choose_again.length
      ? " Choose the music and download folders again in Settings: Android asks once per install." : "";
    if (j.restarting && window.__serverAwayScreen) window.__serverAwayScreen("Restoring…", "Mandarin is restarting with the restored settings. This page reloads when it's back." + again, 1000);
    else { if (again) toast(again.trim()); setTimeout(() => location.reload(), again ? 2500 : 300); }
  }

  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const item = btn.closest(".backup-item");
    // A file on this phone: the app restores or deletes it.
    if (item && item.dataset.where === "phone") {
      const uri = item.dataset.uri;
      const f = phoneFiles().find(x => x.uri === uri);
      if (!f) return;
      if (btn.dataset.act === "delete") {
        if (!(await ask("Delete the backup file " + (f.name || "") + " of " + fmtDate(f.created) + " from this phone?"))) return;
        try { APP.deleteFile(uri); } catch (e) { /* off the list anyway */ }
        renderList();
        return;
      }
      if (btn.dataset.act === "restore") openRestorePanel(item.querySelector(".backup-restore"), f.parts || backupParts(), (want, pass) => pass ? APP.restoreFileAt(uri, want.join(","), pass) : APP.restoreFileAt(uri, want.join(",")), "Restore now", f.sealed && SEALED);
      return;
    }
    const id = item && item.dataset.id;
    const b = ((info && info.backups) || []).find(x => x.id === id);
    if (!b) return;
    if (btn.dataset.act === "delete") {
      if (!(await ask("Delete the backup on the server of " + fmtDate(b.created) + "?"))) return;
      await fetch("/api/backup/" + encodeURIComponent(id), { method: "DELETE" }).catch(() => {});
      load();
      return;
    }
    if (btn.dataset.act === "restore") {
      const parts = (b.parts || []).filter(p => p !== "app" || APP);
      openRestorePanel(item.querySelector(".backup-restore"), parts, async (want, pass) => {
        try {
          const r = await fetch("/api/backup/restore/" + encodeURIComponent(id), { method: "POST",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ include: want, passphrase: pass || undefined }) });
          finishRestore(await r.json());
        } catch (err) { toast("Couldn't reach the server", "error"); }
      }, "Restore now", b.sealed && SEALED);
    }
  });

  toServer.addEventListener("click", async () => {
    const want = ticked(partsEl);
    if (!want.length) { toast("Tick something to back up", "error"); return; }
    toServer.disabled = true;
    noteEl.textContent = "Backing up…";
    try {
      const body = { include: want.filter(p => p !== "page" && p !== "app"), passphrase: passEl.value || undefined };
      if (want.includes("page")) body.page = pageSettings();
      if (want.includes("app") && APP) body.app = JSON.parse(APP.appSettings());
      const r = await fetch("/api/backup/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Backup failed");
      noteEl.textContent = "Backed up: " + fmtBytes(j.backup.bytes) + ", " + fmtDate(j.backup.created) + ".";
      load();
    } catch (err) { noteEl.textContent = ""; toast(err.message, "error"); }
    finally { toServer.disabled = false; }
  });

  // The Android app: Android's "save as", then the server's backup into the file.
  window.__backupFileChosen = () => { noteEl.textContent = "Backing up…"; };
  window.__backupFileDone = (json) => {
    toFile.disabled = false;
    let j = {}; try { j = JSON.parse(json); } catch (e) { /* none */ }
    if (j.ok) { noteEl.textContent = "Backed up: " + fmtBytes(j.bytes || 0) + ", " + fmtDate(j.created || Date.now()) + "."; renderList(); }
    else { noteEl.textContent = ""; if (!j.cancelled) toast(j.error || "Backup failed", "error"); }
  };
  toFile.addEventListener("click", () => {
    if (!APP) return;
    const want = ticked(partsEl);
    if (!want.length) { toast("Tick something to back up", "error"); return; }
    const req = { include: want.filter(p => p !== "page" && p !== "app"), passphrase: passEl.value || undefined,
      page: want.includes("page") ? pageSettings() : undefined, noApp: !want.includes("app") };
    toFile.disabled = true;
    noteEl.textContent = "Choose where to save the backup…";
    APP.toFile(JSON.stringify(req));
  });

  window.__backupRestoreDone = (json) => {
    let j = {}; try { j = JSON.parse(json); } catch (e) { /* none */ }
    finishRestore(j);
  };
  fromFile.addEventListener("click", () => {
    if (!APP) return;
    let panel = pane.querySelector(".backup-file-restore");
    if (!panel) { panel = document.createElement("div"); panel.className = "backup-restore backup-file-restore"; fromFile.after(panel); }
    openRestorePanel(panel, backupParts(), (want, pass) => pass ? APP.fromFile(want.join(","), pass) : APP.fromFile(want.join(",")), "Choose the file…", "Its passphrase, if it was sealed with one");
  });
})();
