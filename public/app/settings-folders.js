/* ------------------------------------------------------------------ */
/*  Settings → Music folders: where the library is read from, chosen    */
/*  here (as in Roon) — any number of folders, anywhere the server can  */
/*  see. From home only.                                                */
/* ------------------------------------------------------------------ */
(function initFoldersPane() {
  const body = document.getElementById("folders-pane-body");
  const pane = document.querySelector('.settings-pane[data-pane="folders"]');
  const navItem = document.querySelector('.settings-nav-item[data-pane="folders"]');
  if (!body || !pane || !navItem) return;
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ask = (q) => window.__confirmDialog ? window.__confirmDialog(q) : Promise.resolve(confirm(q));
  const toast = (m, kind) => { if (window.__showToast) window.__showToast(m, kind); };
  const folderSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  let st = null, err = "", busy = false;
  let browsing = null;   // { path, parent, dirs } while choosing a folder

  async function api(url, payload) {
    const r = await fetch(url, payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  }
  async function load() {
    try { st = await api("/api/library/folders"); err = ""; } catch (e) { st = null; err = e.message; }
    render();
  }
  async function browse(p) {
    try { browsing = await api("/api/library/browse?path=" + encodeURIComponent(p || "/")); err = ""; }
    catch (e) { err = e.message; if (!browsing) browsing = { path: "/", parent: null, dirs: [] }; }
    render();
    const list = body.querySelector(".mf-browse-list");
    if (list) list.scrollTop = 0;
  }

  function render() {
    if (browsing) return renderBrowser();
    if (!st) { body.innerHTML = '<div class="settings-note">' + esc(err || "Couldn’t ask the server.") + "</div>"; return; }
    let html = '<div class="mf-list">';
    for (const f of st.folders) {
      const state = !f.exists ? "Not there — its albums are kept" : !f.readable ? "Can’t be read — its albums are kept" : (f.tracks || 0).toLocaleString() + " tracks";
      html += '<div class="mf-row">' +
        '<span class="mf-ico">' + folderSvg + "</span>" +
        '<span class="mf-txt"><span class="mf-name">' + esc(f.name) + '</span><span class="mf-path">' + esc(f.path) + '</span>' +
        '<span class="mf-state' + (f.exists && f.readable ? "" : " is-bad") + '">' + esc(state) + "</span>" +
        (f.hint ? '<span class="mf-state is-bad">' + esc(f.hint) + "</span>" : "") + "</span>" +
        (st.folders.length > 1 ? '<button type="button" class="settings-update-btn mf-remove" data-mf-remove="' + esc(f.path) + '"' + (busy ? " disabled" : "") + ">Remove</button>" : "") +
        "</div>";
    }
    html += "</div>";
    html += '<div class="settings-row"><span class="settings-label"></span><button type="button" class="settings-update-btn" data-mf-add' + (busy ? " disabled" : "") + ">Add a folder</button></div>";
    if (st.scanning) html += '<div class="settings-note">Reading your music… new albums appear as they’re found.</div>';
    html += '<div class="settings-note">' + (st.docker
      ? "The server sees only what its container has mounted. Mount your drives and shares once — e.g. <b>-v /mnt:/mnt:ro,rslave</b> (on DietPi, everything in Drive Manager is under /mnt; <b>rslave</b> lets shares the machine mounts later show up) — and add any folders in them here. A folder that’s missing for a while (a drive asleep, a share that dropped) keeps its albums."
      : "Any folder on the machine the server runs on. A folder that’s missing for a while (a drive asleep, a share that dropped) keeps its albums.") + "</div>";
    if (err) html += '<div class="settings-note away-error">' + esc(err) + "</div>";
    // Music on this phone (the app): its folder is a watched folder too, so it lives here (v0.5.41).
    if (window.MusicdDownloads && typeof window.MusicdDownloads.localFolder === "function" && window.__localFolderBlock) {
      html += '<div class="settings-divider"></div>' + window.__localFolderBlock();
    }
    body.innerHTML = html;
  }
  window.__renderMusicFoldersPane = () => { if (!pane.classList.contains("hidden") && !browsing) render(); };

  function renderBrowser() {
    const b = browsing;
    const watched = new Set((st && st.folders || []).map(f => f.path));
    const inside = [...watched].find(w => b.path === w || b.path.startsWith(w + "/"));
    let html = '<div class="mf-browse-head"><button type="button" class="settings-update-btn" data-mf-cancel>Cancel</button>' +
      '<span class="mf-browse-path">' + esc(b.path) + "</span></div>";
    // The drives and shares the server can see, one tap away.
    const places = (st && st.mounts) || [];
    if (places.length) {
      html += '<div class="mf-places"><span class="mf-places-label">Mounted drives and shares</span>' +
        places.map(m => '<button type="button" class="mf-place' + (m.waiting ? " is-bad" : "") + (m.path === b.path ? " is-on" : "") +
          '" data-mf-go="' + esc(m.path) + '">' + esc(m.path) + "</button>").join("") + "</div>";
    }
    if (b.hint) html += '<div class="settings-note away-error mf-hint">' + esc(b.hint) + "</div>";
    html += '<div class="mf-browse-list">';
    if (b.parent) html += '<button type="button" class="mf-dir mf-up" data-mf-go="' + esc(b.parent) + '"><span class="mf-ico">↰</span><span class="mf-name">Up</span></button>';
    for (const d of b.dirs) {
      html += '<button type="button" class="mf-dir" data-mf-go="' + esc(d.path) + '"><span class="mf-ico">' + folderSvg + '</span><span class="mf-name">' + esc(d.name) + "</span>" +
        (watched.has(d.path) ? '<span class="mf-tag">In the library</span>' : "") + "</button>";
    }
    if (!b.dirs.length) html += '<div class="settings-note">No folders in here.</div>';
    html += "</div>";
    html += '<div class="mf-browse-foot">' + (inside
      ? '<span class="settings-note">Already in the library (' + esc(inside) + ")</span>"
      : '<button type="button" class="settings-update-btn mf-choose" data-mf-choose' + (busy || b.path === "/" ? " disabled" : "") + ">Add “" + esc(b.path.split("/").pop() || b.path) + "”</button>") + "</div>";
    if (err) html += '<div class="settings-note away-error">' + esc(err) + "</div>";
    body.innerHTML = html;
  }

  body.addEventListener("click", async (e) => {
    const t = e.target.closest("button");
    if (!t || busy) return;
    const dl = window.MusicdDownloads;
    if (t.hasAttribute("data-local-choose")) { try { dl.chooseLocalFolder(); } catch (x) { /* an app without this call (older than the page): nothing to do */ } return; }
    if (t.hasAttribute("data-local-rescan")) { try { dl.rescanLocal(); } catch (x) { /* an app without this call (older than the page): nothing to do */ } render(); return; }
    if (t.hasAttribute("data-local-forget")) {
      if (!(await ask("Forget this folder?\n\nMandarin stops reading it. Nothing in it is deleted."))) return;
      try { dl.forgetLocalFolder(); } catch (x) { /* an app without this call (older than the page): nothing to do */ }
      render(); return;
    }
    if (t.hasAttribute("data-mf-add")) { err = ""; return browse("/"); }
    if (t.hasAttribute("data-mf-cancel")) { browsing = null; err = ""; return render(); }
    if (t.hasAttribute("data-mf-go")) { err = ""; return browse(t.getAttribute("data-mf-go")); }
    if (t.hasAttribute("data-mf-choose")) {
      busy = true; render();
      try {
        st = Object.assign({}, st, await api("/api/library/folders", { add: browsing.path }));
        browsing = null; err = "";
        toast("Added — reading its music now");
      } catch (x) { err = x.message; }
      busy = false; render();
      return;
    }
    const rm = t.getAttribute("data-mf-remove");
    if (rm) {
      const f = st.folders.find(x => x.path === rm) || { name: rm, tracks: 0 };
      if (!(await ask("Remove “" + f.name + "” from the library?\n\nIts " + (f.tracks || 0).toLocaleString() + " tracks and their albums leave Mandarin. The files themselves aren’t touched."))) return;
      busy = true; render();
      try {
        const j = await api("/api/library/folders", { remove: rm });
        st = Object.assign({}, st, j); err = "";
        toast("Removed “" + f.name + "” — " + (j.removed || 0).toLocaleString() + " tracks");
      } catch (x) { err = x.message; }
      busy = false; render();
    }
  });
  navItem.addEventListener("click", () => { browsing = null; load(); });
  // While open and a scan is going: the counts follow.
  setInterval(() => { if (!pane.classList.contains("hidden") && !busy && !browsing && st && st.scanning) load(); }, 4000);
  // Back (the phone's, or the pane's) while choosing: back to the list first.
  pane.addEventListener("click", (e) => {
    if (browsing && e.target.closest("[data-settings-back]")) { e.stopImmediatePropagation(); e.preventDefault(); browsing = null; render(); }
  }, true);
})();
