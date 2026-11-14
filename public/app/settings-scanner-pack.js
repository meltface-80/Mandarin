/* Settings → Library Scanner's MusicBrainz pack (v0.6.4; out of settings-scanner.js in item 411): what is downloaded
 * and from when, Download, Update or Remove, the download's progress asked for every second, and where the pack is
 * kept, chosen among the server's folders (its mounted drives and shares, and each folder's own). */
const PACK_INFO = "Every MusicBrainz release with a barcode, with its tracks, kept on the server and refreshed weekly. Barcodes are matched here first, without asking musicbrainz.org; anything the pack lacks is asked for as before. It can live on any drive the server can write to (Folder…); a pack already downloaded is moved there.";
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
  try { pack = await scanApi("/api/identify/pack/folder", { dir }); packBrowse = null; scanErr = ""; }
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
/* The pack as a section of the Album Scanner's (item 411): its name with Download, Update or Remove and Folder…, what is
 * there (or how far the download has got), and where it is kept. */
function packBlock() {
  const head = buttons => '<div class="scan-sec"><div class="scan-row scan-wrap"><span class="scan-lab" data-parity="settings-scanner.name">MusicBrainz pack' + info(PACK_INFO) + "</span>" + buttons + "</div>";
  if (!pack) return head("") + '<div class="settings-note id-wait" data-parity="settings-scanner.note">…</div></div>';
  if (packBrowse) return '<div class="scan-sec"><div class="settings-block-title" data-parity="settings-scanner.title">Where to keep the MusicBrainz pack</div>' + packBrowser() + "</div>";
  const have = pack.installed, job = pack.job, latest = pack.latest;
  const off = scanBusy ? " disabled" : "";
  let state, buttons = "";
  if (job && !job.error && job.phase === "moving") {
    state = "Moving the pack… between drives this takes a minute or two.";
  } else if (job && !job.error && job.phase !== "done") {
    const pc = job.total ? Math.floor(job.done / job.total * 100) : 0;
    state = job.phase === "checking" ? "Asking GitHub…" : "Downloading… " + pc + " % (" + mbs(job.done) + " of " + mbs(job.total) + ")";
  } else if (have) {
    state = num(have.releases) + " releases · from " + day(have.built) + " · " + mbs(have.size) + (pack.newer ? " · a newer one is out" : "");
    buttons = (pack.newer ? '<button type="button" data-parity="settings-scanner.pack" class="id-btn is-primary" data-pack="download"' + off + ">Update</button>" : "") +
      '<button type="button" data-parity="settings-scanner.pack" class="id-btn" data-pack="remove"' + off + ">Remove</button>";
  } else {
    const tight = latest && pack.free != null && pack.free < latest.size + 200 * 1048576;
    state = latest ? "Not downloaded. A " + mbs(latest.gz_size) + " download that unpacks to " + mbs(latest.size) + " in the folder below." +
      (tight ? ' <span class="away-error">Not enough room in this folder: choose another.</span>' : "")
      : pack.checking ? "Not downloaded. Asking GitHub what’s published…" : "Not downloaded." + (pack.check_error ? " (" + scanEsc(pack.check_error) + ")" : "");
    buttons = '<button type="button" data-parity="settings-scanner.pack" class="id-btn is-primary" data-pack="download"' + (scanBusy || !latest ? " disabled" : "") + ">Download</button>";
  }
  // Where it's kept (v0.6.4): any folder the server can write to, on any drive.
  const where = pack.dir_fixed ? '<span class="settings-note" data-parity="settings-scanner.pack-fixed">Set by MBPACK_DIR</span>'
    : (pack.dir !== pack.data_dir ? '<button type="button" data-parity="settings-scanner.pack-folder-reset" class="id-btn" data-pack-folder-reset' + off + ">Data folder</button>" : "") +
      '<button type="button" data-parity="settings-scanner.pack-folder" class="id-btn" data-pack-folder' + off + ">Folder…</button>";
  return head('<span class="id-actions">' + buttons + where + "</span>") +
    '<div class="settings-note" data-parity="settings-scanner.note">' + state + (job && job.error ? ' <span class="away-error">' + scanEsc(job.error) + "</span>" : "") +
      " · " + scanEsc(pack.dir) + (pack.dir === pack.data_dir ? " (the data folder)" : "") + (pack.free != null ? " · " + mbs(pack.free) + " free" : "") +
      (pack.dir_problem && !(job && job.error === pack.dir_problem) ? ' <span class="away-error">' + scanEsc(pack.dir_problem) + "</span>" : "") + "</div></div>";
}
