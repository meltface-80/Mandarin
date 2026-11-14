/* Settings → Library Scanner (app/settings-scanner.js): a folder opened (bug list item 411) — the albums identification
 * couldn't place (Unidentified), or found but wasn't sure enough to apply unasked (To confirm), each with what the
 * scan found for it and its actions: Check again, or Accept and Reject; Barcode… to match it by a barcode or a
 * MusicBrainz link. Back closes it. */
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
function albumRow(it, kind) {
  const a = it.album, c = it.candidate;
  const from = c && c.source === "itunes" ? " · from iTunes" : "";
  // Why it's short of 100 % (v0.6.3): the score's own reasons.
  const why = it.why && it.why.length ? " — " + scanEsc(it.why.join(", ")) : "";
  const line2 = kind === "proposed" ? "→ " + names(c) + (c.year ? " (" + c.year + ")" : "") + version(c) + " · " + it.similarity + " % alike" + why + (it.ambiguous ? " · two releases fit" : "") + from
    : c ? "nearest: " + names(c) + " · " + it.similarity + " %" + why + from : "nothing with this title on MusicBrainz or iTunes";
  const actions = kind === "proposed" ? btn("accept", a.offset, "Accept", true, "settings-scanner.accept") + btn("reject", a.offset, "Reject", false, "settings-scanner.reject")
    : btn("recheck", a.offset, "Check again", false, "settings-scanner.recheck");
  // Matched by hand: a barcode, or a link.
  const manual = '<button type="button" data-parity="settings-scanner.barcode" class="id-btn" data-id-match="' + a.offset + '" title="Match by barcode or MusicBrainz link"' + (scanBusy ? " disabled" : "") + ">Barcode…</button>";
  const open = matching === a.offset;
  return '<div class="id-row' + (open ? " is-matching" : "") + '"><button type="button" data-parity="settings-scanner.album" class="id-open" data-id-open="' + a.offset + '">' +
    '<span class="id-name">' + names(a) + '</span><span class="id-sub">' + line2 + "</span></button>" +
    '<span class="id-actions">' + actions + manual + "</span>" +
    (open ? '<form class="id-match" data-id-match-form="' + a.offset + '">' +
      '<input data-parity="settings-scanner.match-input" class="id-match-input" type="text" inputmode="numeric" autocomplete="off" placeholder="Barcode, or a MusicBrainz release link" aria-label="Barcode or MusicBrainz link" value="' + scanEsc(matchDraft) + '">' +
      '<button type="submit" data-parity="settings-scanner.match" class="id-btn is-primary"' + (scanBusy ? " disabled" : "") + ">Match</button></form>" +
      '<div class="settings-note id-match-note" data-parity="settings-scanner.note">The digits under the bars on the sleeve, or the address of the release (or album) on musicbrainz.org. That release is written to the album whatever the scan thought.</div>' : "") +
    "</div>";
}

// Each folder: its title, its note, and its own back key (npm run parity reads them here).
const FOLDERS = {
  unidentified: { title: "Unidentified", close: "settings-scanner.unidentified-close",
    note: "Nothing near enough was found on MusicBrainz or iTunes. Tap the name to see the album (⋯ → Edit album to name it yourself), Barcode… to match it by its barcode or a MusicBrainz link, or Check again." },
  proposed: { title: "To confirm", close: "settings-scanner.to-confirm-close",
    note: "Close, but not close enough to apply unasked. Tap the name to see the album; Accept writes the names shown." }
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
