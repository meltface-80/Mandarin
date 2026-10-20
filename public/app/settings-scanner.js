/* Settings → Library Scanner (v0.6.0-RC7; "Identify albums" before): the
 * identification scan's switch and its night window, how far it has got, what
 * it proposes, what it applied (undo), what it couldn't place (edit by hand)
 * — and Measure ReplayGain, the loudness of files without ReplayGain tags. */
const scanBody = document.getElementById("identify-pane-body");
let cleanup = null;   // Clean up: what could go (v0.6.23)
const scanPane = document.querySelector('.settings-pane[data-pane="identify"]');
const scanNavItem = document.querySelector('.settings-nav-item[data-pane="identify"]');
const scanEsc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const scanToast = (m, kind) => { if (window.__showToast) window.__showToast(m, kind); };
const num = n => Number(n || 0).toLocaleString();
const SHOW = 60;
let st = null, loud = null, scanBusy = false, scanErr = "", more = { proposed: false, unidentified: false, applied: false, rejected: false };
let lists = null;      // the albums in each state, the first of each (v0.8.17): { proposed, …, counts, at }
let cpu = null;        // how the processor is shared out (v0.8.13)
let pack = null;       // the MusicBrainz pack (v0.6.4)
let packBrowse = null, packPlaces = [];   // choosing the pack's folder: { path, parent, dirs }
let matching = null, matchDraft = "";   // the row whose barcode box is open, and what's typed in it
// What the page showed last time (v0.8.17), on this device: drawn at once
// when it opens, then brought up to date block by block.
const KEPT = "mandarin.scanner.v1";
try {
  const k = JSON.parse(localStorage.getItem(KEPT) || "null");
  if (k) { st = k.st || null; loud = k.loud || null; cleanup = k.cleanup || null; cpu = k.cpu || null; pack = k.pack || null; }
} catch (e) { /* none kept */ }
let keepTimer = null;
const keep = () => {
  clearTimeout(keepTimer);
  keepTimer = setTimeout(() => {
    try { localStorage.setItem(KEPT, JSON.stringify({ st, loud, cleanup, cpu, pack: pack && Object.assign({}, pack, { job: null }) })); } catch (e) { /* not kept */ }
  }, 1000);
};

async function scanApi(url, payload) {
  const r = await fetch(url, payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}
/*
 * Each block's answer asked for on its own and drawn as it comes (v0.8.17):
 * nothing waits for another, nor for GitHub (the pack is asked about in the
 * server's own time). [opening]: the page has just been opened — the pack
 * and the clean-up too, and the lists; otherwise only what moves, and the
 * lists only when their counts did.
 */
let listsAsked = null;
function scanLoad(opening) {
  if (scanBusy) return;
  const get = (url, set) => scanApi(url).then(v => { set(v); keep(); }, e => { if (url.startsWith("/api/identify?")) scanErr = e.message; })
    .then(() => { if (!scanBusy) render(); });
  get("/api/identify?lists=0", v => { st = v; scanErr = ""; if (opening || listsMoved()) loadLists(); });
  get("/api/loudness", v => { loud = v; });
  get("/api/cpu", v => { cpu = v; });
  if (opening || ++quiet % 6 === 0) get("/api/library/cleanup", v => { cleanup = v; });
  if (opening || (pack && pack.checking)) get("/api/identify/pack" + (opening ? "?check=1" : ""), v => {
    pack = v;
    if (pack && pack.job && !pack.job.error && pack.job.phase !== "done") followPack();
  });
}
let quiet = 0;
// The counts the lists were last asked for at: when the server's move, the lists are asked for again.
const countsOf = (x) => x && x.progress ? [x.progress.checked, x.progress.applied, x.progress.proposed, x.progress.unidentified, x.progress.rejected].join() : "";
const listsMoved = () => !lists || countsOf(st) !== listsAsked;
function loadLists() {
  const wanted = countsOf(st);
  const all = Object.values(more).some(Boolean);
  scanApi("/api/identify?lists=" + (all ? 500 : SHOW)).then(v => {
    lists = { proposed: v.proposed || [], unidentified: v.unidentified || [], applied: v.applied || [], rejected: v.rejected || [], counts: v.counts || null, all };
    listsAsked = countsOf(v) || wanted;
    if (!scanBusy) render();
  }, () => {});
}
async function setMeasure(on) {
  if (scanBusy) return;
  scanBusy = true;
  try { loud = await scanApi("/api/loudness", { measure: on }); scanErr = ""; } catch (e) { scanErr = e.message; }
  scanBusy = false;
  render();
}
async function packAct(what) {
  if (scanBusy) return;
  scanBusy = true;
  try { pack = await scanApi("/api/identify/pack/" + what, {}); scanErr = ""; } catch (e) { scanErr = e.message; }
  scanBusy = false;
  render();
  if (what === "download") followPack();
}
// The download's progress, once a second until it's done.
let following = false;
async function followPack() {
  if (following) return;
  following = true;
  while (pack && pack.job && !pack.job.error && pack.job.phase !== "done") {
    await new Promise(r => setTimeout(r, 1000));
    try { pack = await scanApi("/api/identify/pack"); } catch (e) { break; }
    if (!scanBusy) render();
  }
  following = false;
  if (pack && pack.job && pack.job.phase === "done") scanToast("MusicBrainz pack ready");
}
const mbs = n => (Number(n || 0) / 1048576).toLocaleString(undefined, { maximumFractionDigits: 0 }) + " MB";
const day = iso => { const d = new Date(iso || ""); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); };
async function packGo(p) {
  try {
    if (!packPlaces.length) packPlaces = ((await scanApi("/api/library/folders").catch(() => ({}))).mounts || []);
    packBrowse = await scanApi("/api/library/browse?path=" + encodeURIComponent(p || "/")); scanErr = "";
  } catch (e) { scanErr = e.message; if (!packBrowse) packBrowse = { path: "/", parent: null, dirs: [] }; }
  render();
}
async function packFolder(dir) {
  if (scanBusy) return;
  scanBusy = true;
  // A pack already here is moved: it can take a minute between drives.
  if (pack && pack.installed) { pack = Object.assign({}, pack, { job: { phase: "moving" } }); render(); }
  try { pack = await scanApi("/api/identify/pack/folder", { dir }); packBrowse = null; scanErr = ""; scanToast("The pack’s folder is set"); }
  catch (e) { scanErr = e.message; try { pack = await scanApi("/api/identify/pack"); } catch (x) { /* the pack's state stays as it was */ } }
  scanBusy = false;
  render();
}
const folderSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
function packBrowser() {
  const b = packBrowse;
  let html = '<div class="mf-browse-head"><button type="button" class="settings-update-btn" data-parity="settings-scanner.browse-cancel" data-pack-cancel>Cancel</button>' +
    '<span class="mf-browse-path" data-parity="settings-scanner.browse-path">' + scanEsc(b.path) + "</span></div>";
  if (packPlaces.length) {
    html += '<div class="mf-places"><span class="mf-places-label" data-parity="settings-scanner.browse-places">Mounted drives and shares</span>' +
      packPlaces.map(m => '<button type="button" data-parity="settings-scanner.place" class="mf-place' + (m.path === b.path ? " is-on" : "") + '" data-pack-go="' + scanEsc(m.path) + '">' + scanEsc(m.path) + "</button>").join("") + "</div>";
  }
  html += '<div class="mf-browse-list">';
  if (b.parent) html += '<button type="button" data-parity="settings-scanner.dir" class="mf-dir mf-up" data-pack-go="' + scanEsc(b.parent) + '"><span class="mf-ico">↰</span><span class="mf-name">Up</span></button>';
  for (const d of b.dirs) html += '<button type="button" data-parity="settings-scanner.dir" class="mf-dir" data-pack-go="' + scanEsc(d.path) + '"><span class="mf-ico">' + folderSvg + '</span><span class="mf-name">' + scanEsc(d.name) + "</span></button>";
  if (!b.dirs.length) html += '<div class="settings-note" data-parity="settings-scanner.note">No folders in here.</div>';
  html += '</div><div class="mf-browse-foot"><button type="button" class="settings-update-btn mf-choose" data-parity="settings-scanner.browse-choose" data-pack-choose' + (scanBusy || b.path === "/" ? " disabled" : "") + ">Keep the pack in “" + scanEsc(b.path.split("/").pop() || b.path) + "”</button></div>";
  // Why it couldn't be kept there, by the button, not at the foot of the page.
  if (scanErr) html += '<div class="settings-note away-error" data-parity="settings-scanner.note">' + scanEsc(scanErr) + "</div>";
  return html;
}
function packBlock() {
  if (!pack) return '<div class="settings-divider"></div><div class="settings-block">' +
    row("MusicBrainz pack" + info("Every MusicBrainz release with a barcode, with its tracks, kept on the server and refreshed weekly. Barcodes are matched here first, without asking musicbrainz.org; anything the pack lacks is asked for as before."), "") +
    '<div class="settings-note id-wait" data-parity="settings-scanner.note">…</div></div>';
  if (packBrowse) return '<div class="settings-divider"></div><div class="settings-block"><div class="settings-block-title" data-parity="settings-scanner.title">Where to keep the MusicBrainz pack</div>' + packBrowser() + "</div>";
  const have = pack.installed, job = pack.job, latest = pack.latest;
  let state, buttons = "";
  if (job && !job.error && job.phase === "moving") {
    state = "Moving the pack… between drives this takes a minute or two.";
  } else if (job && !job.error && job.phase !== "done") {
    const pc = job.total ? Math.floor(job.done / job.total * 100) : 0;
    state = job.phase === "checking" ? "Asking GitHub…" : "Downloading… " + pc + " % (" + mbs(job.done) + " of " + mbs(job.total) + ")";
  } else if (have) {
    state = num(have.releases) + " releases · from " + day(have.built) + " · " + mbs(have.size) + (pack.newer ? " · a newer one is out" : "");
    buttons = (pack.newer ? '<button type="button" data-parity="settings-scanner.pack" class="id-btn is-primary" data-pack="download"' + (scanBusy ? " disabled" : "") + ">Update</button>" : "") +
      '<button type="button" data-parity="settings-scanner.pack" class="id-btn" data-pack="remove"' + (scanBusy ? " disabled" : "") + ">Remove</button>";
  } else {
    const tight = latest && pack.free != null && pack.free < latest.size + 200 * 1048576;
    state = latest ? "Not downloaded. A " + mbs(latest.gz_size) + " download that unpacks to " + mbs(latest.size) + " in the folder below." +
      (tight ? ' <span class="away-error">Not enough room in this folder: choose another below.</span>' : "")
      : pack.checking ? "Not downloaded. Asking GitHub what’s published…" : "Not downloaded." + (pack.check_error ? " (" + scanEsc(pack.check_error) + ")" : "");
    buttons = '<button type="button" data-parity="settings-scanner.pack" class="id-btn is-primary" data-pack="download"' + (scanBusy || !latest ? " disabled" : "") + ">Download</button>";
  }
  return '<div class="settings-divider"></div><div class="settings-block">' +
    row("MusicBrainz pack" + info("Every MusicBrainz release with a barcode, with its tracks, kept on the server and refreshed weekly. Barcodes are matched here first, without asking musicbrainz.org; anything the pack lacks is asked for as before."),
      '<span class="id-actions">' + buttons + "</span>") +
    '<div class="settings-note" data-parity="settings-scanner.note">' + state + (job && job.error ? ' <span class="away-error">' + scanEsc(job.error) + "</span>" : "") + "</div>" +
    // Where it's kept (v0.6.4): any folder the server can write to, on any drive.
    row("Folder" + info("The pack can live on any drive the server can write to. In Docker, mount the drive into the container first (for example -v /mnt/ssd/mandarin:/packs). A pack already downloaded is moved there."),
      pack.dir_fixed ? '<span class="away-value" data-parity="settings-scanner.pack-fixed">Set by MBPACK_DIR</span>'
        : '<span class="id-actions">' + (pack.dir !== pack.data_dir ? '<button type="button" data-parity="settings-scanner.pack-folder-reset" class="id-btn" data-pack-folder-reset' + (scanBusy ? " disabled" : "") + ">Data folder</button>" : "") +
          '<button type="button" data-parity="settings-scanner.pack-folder" class="id-btn" data-pack-folder' + (scanBusy ? " disabled" : "") + ">Change…</button></span>") +
    '<div class="settings-note" data-parity="settings-scanner.note">' + scanEsc(pack.dir) + (pack.dir === pack.data_dir ? " (the data folder)" : "") + (pack.free != null ? " · " + mbs(pack.free) + " free" : "") +
      (pack.dir_problem && !(job && job.error === pack.dir_problem) ? ' <span class="away-error">' + scanEsc(pack.dir_problem) + "</span>" : "") + "</div></div>";
}
async function act(url, payload, done) {
  if (scanBusy) return;
  scanBusy = true;
  render();
  try {
    st = await scanApi(url, payload || {}); scanErr = ""; if (done) scanToast(done);
    if (st.proposed) { lists = { proposed: st.proposed, unidentified: st.unidentified, applied: st.applied, rejected: st.rejected, counts: st.counts || null, all: true }; listsAsked = countsOf(st); }
    keep();
  }
  catch (e) { scanErr = e.message; }
  scanBusy = false;
  render();
}

const sw = (attr, on, label, key) => '<label class="switch" data-parity="' + key + '"><input type="checkbox" ' + attr + (on ? " checked" : "") + (scanBusy ? " disabled" : "") +
  ' aria-label="' + scanEsc(label) + '"><span class="switch-track"><span class="switch-thumb"></span></span></label>';
const row = (label, right) => '<div class="settings-row"><span class="settings-label" data-parity="settings-scanner.name">' + label + "</span>" + right + "</div>";
// The help behind ⓘ, as on every other settings page.
const info = t => ' <button class="settings-info-btn" type="button" data-parity="settings-scanner.info" data-info="' + scanEsc(t) + '" aria-label="Info">ⓘ</button>';
const names = a => (a.artist ? scanEsc(a.artist) + " — " : "") + scanEsc(a.title);
// [key]: its screens-contract key, written out where it is called (npm run parity reads them there).
const btn = (act, off, label, primary, key) => '<button type="button" data-parity="' + key + '" class="id-btn' + (primary ? " is-primary" : "") + '" data-id-act="' + act + '" data-id-off="' + off + '"' + (scanBusy ? " disabled" : "") + ">" + label + "</button>";

function scanStatus() {
  const s = st.settings;
  switch (st.reason) {
    case "off": return "Off.";
    case "waiting": return "Waits for " + scanEsc(s.start) + " (the server's clock).";
    case "scanning": return "Paused while the library is being scanned.";
    case "unreachable": return "MusicBrainz isn't answering; trying again in a few minutes.";
    case "pack": return "MusicBrainz isn't answering, so the albums the MusicBrainz pack can answer are being matched from it: " + (st.current ? names(st.current) : "…");
    case "checking": return "Checking: " + (st.current ? names(st.current) : "…");
    case "starting": return "Starting…";
    default: return "Every album has been looked at. New ones are checked as they arrive.";
  }
}

// Measure ReplayGain's own line (v0.8.24): why it is or isn't measuring.
const albumNames = c => (c ? names({ artist: c.subtitle, title: c.title }) : "…");
function loudStatus() {
  const start = st && st.settings ? scanEsc(st.settings.start) : "the start time";
  switch (loud && loud.reason) {
    case "waiting": return "Waits for " + start + " (the server's clock).";
    case "scanning": return "Paused while the library is being scanned.";
    case "identifying": return "Waits for identification to look at the next albums.";
    case "measuring": return "Measuring: " + albumNames(loud.current);
    case "done": return "Every track is known. New ones are measured as they arrive.";
    default: return "";
  }
}

// The schedule's "now": what is running, or why nothing is.
function nowLine() {
  const parts = [];
  if (st.reason === "checking") parts.push("Identifying " + (st.current ? names(st.current) : "…"));
  else if (st.reason === "starting") parts.push("Identifying the next album");
  else if (st.reason === "pack") parts.push("Matching from the MusicBrainz pack");
  if (loud && loud.reason === "measuring") parts.push("Measuring " + albumNames(loud.current));
  if (parts.length) return "Now: " + parts.join(" · ");
  if (st.reason === "waiting" || (loud && loud.reason === "waiting")) return "Now: waiting for " + scanEsc(st.settings.start) + ".";
  if (st.reason === "scanning" || (loud && loud.reason === "scanning")) return "Now: waiting while the library is scanned.";
  if (st.reason === "unreachable") return "Now: MusicBrainz isn't answering; trying again in a few minutes.";
  return "Now: nothing to do.";
}
