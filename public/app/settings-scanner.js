/* Settings → Library Scanner (bug list item 411; v0.6.0-RC7 "Identify albums" before it): the Album Scanner's one
 * switch over identification, ReplayGain and the cover finder (GET/POST /api/album-scanner), and while it is on, its
 * sections in order — Progress, the albums to place by hand as folders, Schedule, the MusicBrainz pack, Library
 * clean-up and the Processor — each drawn from its own answer; a folder opened shows its albums. The sections are
 * settings-scanner-blocks.js, the pack settings-scanner-pack.js, a folder settings-scanner-albums.js and the
 * readout's words scanner-words.js. */
const scanBody = document.getElementById("identify-pane-body");
const scanPane = document.querySelector('.settings-pane[data-pane="identify"]');
const scanNavItem = document.querySelector('.settings-nav-item[data-pane="identify"]');
const scanEsc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const scanToast = (m, kind) => { if (window.__showToast) window.__showToast(m, kind); };
const num = n => Number(n || 0).toLocaleString();
const SHOW = 60;
let scan = null;        // the Album Scanner: GET /api/album-scanner
let cleanup = null;     // Clean up: what could go (v0.6.23)
let cpu = null;         // how the processor is shared out (v0.8.13)
let pack = null;        // the MusicBrainz pack (v0.6.4)
let scanBusy = false, scanErr = "";
let folder = null;      // the folder open: "unidentified" or "proposed"
let lists = null;       // its albums (GET /api/identify?lists=), while it is open
let more = { proposed: false, unidentified: false };
let packBrowse = null, packPlaces = [];   // choosing the pack's folder: { path, parent, dirs }
let matching = null, matchDraft = "";     // the row whose barcode box is open, and what's typed in it
// What the page showed last time (v0.8.17), on this device: drawn at once when it opens, then brought up to date.
const KEPT = "mandarin.scanner.v2";
try {
  const k = JSON.parse(localStorage.getItem(KEPT) || "null");
  if (k) { scan = k.scan || null; cleanup = k.cleanup || null; cpu = k.cpu || null; pack = k.pack || null; }
} catch (e) { /* none kept */ }
let keepTimer = null;
const keep = () => {
  clearTimeout(keepTimer);
  keepTimer = setTimeout(() => {
    try { localStorage.setItem(KEPT, JSON.stringify({ scan, cleanup, cpu, pack: pack && Object.assign({}, pack, { job: null }) })); } catch (e) { /* not kept */ }
  }, 1000);
};

async function scanApi(url, payload) {
  const r = await fetch(url, payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}
// The help behind ⓘ, as on every other settings page.
const info = t => ' <button class="settings-info-btn" type="button" data-parity="settings-scanner.info" data-info="' + scanEsc(t) + '" aria-label="Info">ⓘ</button>';

/*
 * Each answer asked for on its own and drawn as it comes (v0.8.17): nothing waits for another, nor for GitHub.
 * [opening]: the page has just been opened — the pack and the clean-up too; otherwise only what moves.
 */
let quiet = 0;
function scanLoad(opening) {
  if (scanBusy) return;
  const get = (url, set) => scanApi(url).then(v => { set(v); keep(); }, e => { if (url === "/api/album-scanner") scanErr = e.message; })
    .then(() => { if (!scanBusy) render(); });
  get("/api/album-scanner", v => { scan = v; scanErr = ""; if (folder && listsMoved()) loadLists(); });
  get("/api/cpu", v => { cpu = v; });
  if (opening || ++quiet % 6 === 0) get("/api/library/cleanup", v => { cleanup = v; });
  if (opening || (pack && pack.checking)) get("/api/identify/pack" + (opening ? "?check=1" : ""), v => {
    pack = v;
    if (pack && pack.job && !pack.job.error && pack.job.phase !== "done") followPack();
  });
}
// The counts the folder's albums were last asked for at: when the server's move, they are asked for again.
let listsAsked = null;
const countsOf = x => x ? [x.done, x.unidentified, x.proposed].join() : "";
const listsMoved = () => !lists || countsOf(scan) !== listsAsked;
function loadLists() {
  const wanted = countsOf(scan);
  scanApi("/api/identify?lists=" + (more[folder] ? 500 : SHOW)).then(v => {
    lists = { proposed: v.proposed || [], unidentified: v.unidentified || [], counts: v.counts || null };
    listsAsked = wanted;
    if (!scanBusy) render();
  }, () => {});
}

/* The switch, Scheduling's or its hours ([patch]): moved as it is tapped, held until the server has kept it. */
async function setScanner(patch) {
  if (scanBusy) return;
  scanBusy = true;
  const before = scan;
  if (scan) {
    const sch = Object.assign({}, scan.schedule);
    if ("schedule" in patch) sch.on = patch.schedule;
    for (const k of ["start", "end"]) if (k in patch) sch[k] = patch[k];
    scan = Object.assign({}, scan, "on" in patch ? { on: patch.on } : {}, { schedule: sch });
  }
  render();
  try { scan = await scanApi("/api/album-scanner", patch); scanErr = ""; keep(); } catch (e) { scan = before; scanErr = e.message; }
  scanBusy = false;
  render();
}
// The cores a track made as it plays has (item 260): "auto", or 1 to 3.
async function setMaking(v) {
  if (scanBusy) return;
  try { cpu = await scanApi("/api/cpu", { making_cores: v === "auto" ? "auto" : Number(v) }); scanErr = ""; } catch (e) { scanErr = e.message; }
  render();
}
/* An album's action, or Check them all again: the answer is identification's, with the lists; the readout asked again. */
async function act(url, payload, done) {
  if (scanBusy) return;
  scanBusy = true;
  render();
  try {
    const v = await scanApi(url, payload || {}); scanErr = ""; if (done) scanToast(done);
    if (v.proposed) lists = { proposed: v.proposed, unidentified: v.unidentified, counts: v.counts || null };
  } catch (e) { scanErr = e.message; }
  scanBusy = false;
  scanLoad();
  render();
}
async function cleanUp(kind) {
  if (scanBusy) return;
  scanBusy = true;
  render();
  try { const r = await scanApi("/api/library/cleanup", { kind }); if (r.count) cleanup = r.count; scanErr = ""; scanToast("Removed"); keep(); } catch (e) { scanErr = e.message; }
  scanBusy = false;
  render();
}

/*
 * The page as blocks (v0.8.17), laid out once for the view it is in: each drawn from its own answer and redrawn only
 * when what it shows changed, so the page doesn't flicker or jump. Off (item 411): the switch and its note alone.
 */
const MAIN = ["switch", "progress", "folders", "schedule", "pack", "cleanup", "cpu", "error"];
const drawn = {};
function blocks() {
  const out = { switch: scannerSwitchBlock() };
  const on = scan && scan.on;
  if (folder) out.folder = folderView(folder);
  else {
    out.progress = on ? scannerProgressBlock() : "";
    out.folders = on ? scannerFoldersBlock() : "";
    out.schedule = on ? scannerScheduleBlock() : "";
    out.pack = on ? packBlock() : "";
    out.cleanup = on ? scannerCleanupBlock() : "";
    out.cpu = on ? scannerCpuBlock() : "";
  }
  out.error = scanErr && !packBrowse ? '<div class="settings-note away-error" data-parity="settings-scanner.note">' + scanEsc(scanErr) + "</div>" : "";
  return out;
}
function render() {
  const which = folder ? ["folder", "error"] : MAIN;
  const view = folder ? "folder" : "main";
  if (scanBody.dataset.view !== view || !scanBody.querySelector("[data-blk]")) {
    scanBody.dataset.view = view;
    scanBody.innerHTML = which.map(b => '<div data-blk="' + b + '"></div>').join("");
    for (const k of Object.keys(drawn)) delete drawn[k];
  }
  const html = blocks();
  const typing = document.activeElement && document.activeElement.matches("input:not([type=checkbox]), textarea") ? document.activeElement : null;
  for (const b of which) {
    if (drawn[b] === html[b]) continue;
    const el = scanBody.querySelector('[data-blk="' + b + '"]');
    if (!el) continue;
    // Never under the box you're typing in: that block is redrawn once you've left it.
    if (typing && el.contains(typing)) continue;
    el.innerHTML = html[b];
    drawn[b] = html[b];
  }
}
function openFolder(kind) {
  folder = kind; lists = null; listsAsked = null; matching = null; matchDraft = "";
  render();
  loadLists();
  const pane = scanBody.closest(".settings-view");
  if (pane) pane.scrollTop = 0;
}

scanBody.addEventListener("change", (e) => {
  if (e.target.closest("[data-scan-on]")) return setScanner({ on: e.target.checked });
  if (e.target.closest("[data-scan-sched]")) return setScanner({ schedule: e.target.checked });
  const t = e.target.closest("[data-scan-time]");
  if (t && /^\d{1,2}:\d{2}$/.test(t.value)) return setScanner({ [t.getAttribute("data-scan-time")]: t.value });
});
scanBody.addEventListener("click", (e) => {
  const fo = e.target.closest("[data-scan-folder]");
  if (fo) return openFolder(fo.getAttribute("data-scan-folder"));
  if (e.target.closest("[data-scan-folder-close]")) { folder = null; lists = null; matching = null; return render(); }
  const b = e.target.closest("[data-id-act]");
  if (b) {
    const what = b.getAttribute("data-id-act");
    const said = { accept: "Applied", reject: "Declined", recheck: "It will be looked at again" }[what];
    return act("/api/identify/" + what, { offset: Number(b.getAttribute("data-id-off")) }, said);
  }
  if (e.target.closest("[data-pack-folder]")) { scanErr = ""; return packGo((pack && pack.dir) || "/"); }
  if (e.target.closest("[data-pack-folder-reset]")) return packFolder(null);
  if (e.target.closest("[data-pack-cancel]")) { packBrowse = null; scanErr = ""; return render(); }
  const pg = e.target.closest("[data-pack-go]");
  if (pg) { scanErr = ""; return packGo(pg.getAttribute("data-pack-go")); }
  if (e.target.closest("[data-pack-choose]")) return packFolder(packBrowse.path);
  const pk = e.target.closest("[data-pack]");
  if (pk) return packAct(pk.getAttribute("data-pack"));
  const mk = e.target.closest("[data-making]");
  if (mk) return setMaking(mk.getAttribute("data-making"));
  if (e.target.closest("[data-id-recheck-all]")) return act("/api/identify/recheck-all", {}, "They will be looked at again");
  const cu = e.target.closest("[data-cleanup]");
  if (cu) {
    const kind = cu.getAttribute("data-cleanup");
    const n = (cleanup[kind] || {}).albums || 0;
    (async () => {
      const q = kind === "files" ? "Remove " + num(n) + " album" + (n === 1 ? "" : "s") + " whose files are gone from the server?\n\nPlays stay in history; their edits, hearts and Listen later go. If the files come back, a scan adds the albums afresh."
        : "Remove " + num(n) + " " + (kind === "tidal" ? "Tidal" : "Qobuz") + " album" + (n === 1 ? "" : "s") + " from the database?\n\nPlays stay in history. Signing in and favouriting again brings an album back.";
      if (!(await (window.__confirmDialog ? window.__confirmDialog(q) : Promise.resolve(confirm(q))))) return;
      cleanUp(kind);
    })();
    return;
  }
  const mb = e.target.closest("[data-id-match]");
  if (mb) {
    const off = Number(mb.getAttribute("data-id-match"));
    matching = matching === off ? null : off; matchDraft = "";
    render();
    const inp = scanBody.querySelector(".id-match-input");
    if (inp) inp.focus();
    return;
  }
  const m = e.target.closest("[data-id-more]");
  if (m) { more[m.getAttribute("data-id-more")] = true; loadLists(); return render(); }
  const o = e.target.closest("[data-id-open]");
  if (o && window.__openAlbum) {
    const off = Number(o.getAttribute("data-id-open"));
    const it = ["proposed", "unidentified"].flatMap(k => (lists && lists[k]) || []).find(x => x.album.offset === off);
    if (!it) return;
    const closer = document.querySelector("#settings-overlay [data-settings-close]");
    if (closer) closer.click();
    window.__openAlbum(it.album, { source: "home", filter: null });
  }
});
scanBody.addEventListener("input", (e) => { if (e.target.closest(".id-match-input")) matchDraft = e.target.value; });
scanBody.addEventListener("submit", async (e) => {
  const f = e.target.closest("[data-id-match-form]");
  if (!f) return;
  e.preventDefault();
  const q = matchDraft.trim();
  if (!q) return;
  const off = Number(f.getAttribute("data-id-match-form"));
  await act("/api/identify/match", { offset: off, query: q }, "Matched and applied");
  if (!scanErr) { matching = null; matchDraft = ""; render(); }
});
// Opened: drawn at once from what it showed last, then each block brought up to date (v0.8.17).
scanNavItem.addEventListener("click", () => {
  packBrowse = null; folder = null; lists = null; more = { proposed: false, unidentified: false }; matching = null; matchDraft = "";
  render(); scanLoad(true);
});
// Progress moves while the pane is open (not while you're typing in it).
setInterval(() => {
  if (scanPane.classList.contains("hidden") || scanBusy || matching !== null || packBrowse) return;
  if (document.activeElement && document.activeElement.closest(".id-time")) return;
  scanLoad();
}, 5000);
