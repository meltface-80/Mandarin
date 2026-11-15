/* Settings → Library Scanner → Library clean-up's albums that look like two copies merged (bug list item 424): a track
 * number twice on one disc, or tracks in more than one folder (a disc folder is its album's; a folder joined back by
 * hand isn't counted), from GET /api/library/merged, asked as the page opens. A line says how many, with Show; shown,
 * each album with why and Split…, which opens its Edit album at Folders and copies (its ways open). Back closes it. */
let merged = null;   // { albums: [{ offset, title, artist, tracks, folders, repeats }], count }

/* Why an album is listed: "2 folders", "a track number twice", or both. */
const mergedWhy = a => [a.folders > 1 ? a.folders + " folders" : "", a.repeats ? "a track number twice on a disc" : ""].filter(Boolean).join(" · ") + " · " + num(a.tracks) + " tracks";

/* The clean-up's line for them, where there are any. */
function scannerMergedRow() {
  const n = merged && merged.count ? merged.count : 0;
  if (!n) return "";
  return '<div class="scan-row"><span class="scan-sub" data-parity="settings-scanner.note">' + num(n) + " album" + (n === 1 ? " looks" : "s look") + " like two copies merged</span>" +
    '<button type="button" data-parity="settings-scanner.merged" class="id-btn" data-scan-folder="merged"' + (scanBusy ? " disabled" : "") + ">Show</button></div>";
}

/* The list open: Back, its title, its note, and each album with why and Split…. */
function mergedView() {
  const list = (merged && merged.albums) || [];
  return '<div class="scan-folder-view"><button type="button" class="scan-back" data-scan-folder-close data-parity="settings-scanner.merged-close" aria-label="Back to Library Scanner">‹ Library Scanner</button>' +
    '<div class="settings-block-title" data-parity="settings-scanner.title">Look like two copies merged (' + num(merged ? merged.count : 0) + ")</div>" +
    '<div class="settings-note" data-parity="settings-scanner.note">Two releases in one album: their tracks in two folders, or a track number twice on one disc. Split… opens the album\'s Edit album to split it; nothing on your drive is moved.</div>' +
    '<div class="id-list">' + list.map(a => '<div class="id-row"><button type="button" data-parity="settings-scanner.album" class="id-open" data-merged-open="' + a.offset + '">' +
      '<span class="id-name">' + (a.artist ? scanEsc(a.artist) + " — " : "") + scanEsc(a.title) + '</span><span class="id-sub">' + scanEsc(mergedWhy(a)) + "</span></button>" +
      '<span class="id-actions"><button type="button" data-parity="settings-scanner.split" class="id-btn" data-merged-split="' + a.offset + '"' + (scanBusy ? " disabled" : "") + ">Split…</button></span></div>").join("") +
    "</div></div>";
}

/* A tap in the list: the album opened, or its Edit album at Folders and copies; true when it was one. */
function mergedClick(e) {
  const t = e.target.closest("[data-merged-open], [data-merged-split]");
  if (!t) return false;
  const off = Number(t.getAttribute("data-merged-open") || t.getAttribute("data-merged-split"));
  const a = ((merged && merged.albums) || []).find(x => x.offset === off);
  if (!a) return true;
  const album = { offset: a.offset, title: a.title, subtitle: a.artist };
  if (t.hasAttribute("data-merged-open")) {
    if (!window.__openAlbum) return true;
    const closer = document.querySelector("#settings-overlay [data-settings-close]");
    if (closer) closer.click();
    window.__openAlbum(album, { source: "home", filter: null });
    return true;
  }
  openAlbumEditor(album).then(() => {
    if (!aeState || aeState.album !== album || !aeSplit || !aeSplit.box) return;
    if (!aeSplit.open.classList.contains("hidden")) aeSplitWays();
    aeSplit.box.scrollIntoView({ block: "start" });
  });
  return true;
}
