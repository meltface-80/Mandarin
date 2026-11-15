/* Settings → Library Scanner (app/settings-scanner.js): a folder opened (bug list item 411) — the albums identification
 * couldn't place (Unidentified), or found but wasn't sure enough to apply unasked (To confirm). Each album with what the
 * scan found for it, and since item 414b how sure it is and why: To confirm's Apply and Not this, and the other
 * releases or editions it kept, a tap each; Find… opens Edit album's match search for it (Unidentified's Check again
 * too). Back closes it. */
// The pressing you have, as MusicBrainz sets it apart from the album:
// "2015 remaster · released 2015" under a 1988 record.
const version = c => {
  if (!c) return "";
  const bits = [];
  if (c.edition) bits.push(c.edition);
  if (c.release_year && c.year && c.release_year !== c.year) bits.push("released " + c.release_year);
  const p = c.parts || {};
  if (p.edition) bits.push("the same record; this pressing has " + (p.missing_tracks === 1 ? "1 more track" : p.missing_tracks + " more tracks"));
  else if (p.missing_tracks) bits.push(p.missing_tracks === 1 ? "1 track of the release missing here" : p.missing_tracks + " tracks of the release missing here");
  if (p.extra_tracks) bits.push(p.extra_tracks === 1 ? "1 track the release hasn't" : p.extra_tracks + " tracks the release hasn't");
  return bits.length ? " · " + scanEsc(bits.join(", ")) : "";
};
const names = a => (a.artist ? scanEsc(a.artist) + " — " : "") + scanEsc(a.title);
// [key]: its screens-contract key, written out where it is called (npm run parity reads them there).
const btn = (act, off, label, primary, key) => '<button type="button" data-parity="' + key + '" class="id-btn' + (primary ? " is-primary" : "") + '" data-id-act="' + act + '" data-id-off="' + off + '"' + (scanBusy ? " disabled" : "") + ">" + label + "</button>";
/* The releases To confirm offers in place of the one proposed (item 414b): the record's other editions, then the other releases near enough. */
const choices = c => !c ? [] : (c.editions || []).map(e => ({ mbid: e.mbid, how: "edition", name: aeEditionName(e) }))
  .concat((c.others || []).map(o => ({ mbid: o.mbid, how: "pick", name: scanOtherName(o) })));
function albumRow(it, kind) {
  const a = it.album, c = it.candidate;
  const from = c && c.source === "itunes" ? " · from iTunes" : "";
  // How sure, and why (item 414b); an older verdict's reasons are worked out by the server from what it kept.
  const sure = it.confidence != null ? " · " + it.confidence + " % sure" : " · " + it.similarity + " % alike";
  const line2 = kind === "proposed" ? "→ " + names(c) + (c.year ? " (" + c.year + ")" : "") + version(c) + sure + from
    : c ? "nearest: " + names(c) + " · " + it.similarity + " %" + from : "nothing with this title on MusicBrainz or iTunes";
  const reasons = (it.reasons || []).length ? '<span class="id-why" data-parity="settings-scanner.reasons">' + scanEsc(scanReasons(it.reasons)) + "</span>" : "";
  // Find…: Edit album's own match search, for this album.
  const find = '<button type="button" data-parity="settings-scanner.find" class="id-btn" data-id-find="' + a.offset + '"' + (scanBusy ? " disabled" : "") + ">Find…</button>";
  const actions = kind === "proposed" ? btn("accept", a.offset, "Apply", true, "settings-scanner.accept") + btn("reject", a.offset, "Not this", false, "settings-scanner.reject") + find
    : find + btn("recheck", a.offset, "Check again", false, "settings-scanner.recheck");
  const others = kind === "proposed" ? choices(c) : [];
  return '<div class="id-row"><button type="button" data-parity="settings-scanner.album" class="id-open" data-id-open="' + a.offset + '">' +
    '<span class="id-name">' + names(a) + '</span><span class="id-sub">' + line2 + "</span>" + reasons + "</button>" +
    '<span class="id-actions">' + actions + "</span>" +
    (others.length ? '<div class="id-choices">' + others.map(o => '<button type="button" data-parity="settings-scanner.choice" class="id-btn id-choice" data-id-pick="' +
      scanEsc(o.mbid) + '" data-id-how="' + o.how + '" data-id-off="' + a.offset + '"' + (scanBusy ? " disabled" : "") + ">" + scanEsc(o.name) + "</button>").join("") + "</div>" : "") +
    "</div>";
}

// Each folder: its title, its note, and its own back key (npm run parity reads them here).
const FOLDERS = {
  unidentified: { title: "Unidentified", close: "settings-scanner.unidentified-close",
    note: "Nothing near enough was found on MusicBrainz or iTunes. Find… searches for it as Edit album does, where a barcode or a MusicBrainz link places it too; or Check again." },
  proposed: { title: "To confirm", close: "settings-scanner.to-confirm-close",
    note: "Close, but not sure enough to apply unasked: how sure, and why. Apply writes the names shown; Not this turns it down for good; or tap another release." }
};

/* The folder open: Back, its title and count, its note, Check them all again, and its albums (the first 60 until Show all). */
function folderView(kind) {
  const f = FOLDERS[kind];
  const count = lists && lists.counts && lists.counts[kind] != null ? lists.counts[kind] : scan ? scan[kind] : 0;
  const list = (lists && lists[kind]) || [];
  const shown = more[kind] ? list : list.slice(0, SHOW);
  const all = Math.min(count, 500);
  return '<div class="scan-folder-view"><button type="button" class="scan-back" data-scan-folder-close data-parity="' + f.close + '" aria-label="Back to Library Scanner">‹ Library Scanner</button>' +
    '<div class="settings-block-title" data-parity="settings-scanner.title">' + f.title + " (" + num(count) + ")</div>" +
    '<div class="settings-note" data-parity="settings-scanner.note">' + f.note + "</div>" +
    (count ? '<button type="button" data-parity="settings-scanner.recheck-all" class="settings-update-btn scan-recheck" data-id-recheck-all' + (scanBusy ? " disabled" : "") + ">Check the proposed and unidentified again</button>" : "") +
    (!lists ? '<div class="settings-note" data-parity="settings-scanner.note">' + scanWaitNote + "</div>"
      : '<div class="id-list">' + shown.map(it => albumRow(it, kind)).join("") + "</div>" +
        (shown.length < all ? '<button type="button" data-parity="settings-scanner.more" class="dev-link id-more" data-id-more="' + kind + '">Show all ' + num(count) + "</button>" : "")) + "</div>";
}
