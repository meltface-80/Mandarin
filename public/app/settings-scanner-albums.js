/* Settings → Library Scanner (app/settings-scanner.js), 2 of 2: the pressing, the pack, the lists of albums, and the pane drawn. */
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
function albumRow(it, kind) {
  const a = it.album, c = it.candidate;
  let line2;
  const from = c && c.source === "itunes" ? " · from iTunes" : "";
  // Why it's short of 100 % (v0.6.3): the score's own reasons.
  const why = it.why && it.why.length ? " — " + scanEsc(it.why.join(", ")) : "";
  if (kind === "proposed") line2 = "→ " + names(c) + (c.year ? " (" + c.year + ")" : "") + version(c) + " · " + it.similarity + " % alike" + why + (it.ambiguous ? " · two releases fit" : "") + from;
  else if (kind === "applied") line2 = "was " + names({ artist: it.scanned.artist, title: it.scanned.title }) + (c && c.year ? " · " + c.year : "") + version(c) + from;
  else if (kind === "unidentified") line2 = c ? "nearest: " + names(c) + " · " + it.similarity + " %" + why + from : "nothing with this title on MusicBrainz" + (st.settings.itunes ? " or iTunes" : "");
  else line2 = c ? "declined: " + names(c) : "";
  if (kind === "applied" && c && c.manual) line2 += " · matched by " + (c.manual === "barcode" ? "barcode" : c.manual === "pick" ? "you" : "link");
  // Found by what the files carry (v0.6.0-RC5).
  else if (kind === "applied" && c && c.matched_by) line2 += " · matched by " + (({ "musicbrainz-id": "the files' MusicBrainz ID", barcode: "barcode", "catalogue-number": "catalogue number", isrc: "ISRCs" }[c.matched_by] || c.matched_by) + (c.from_pack ? " (pack)" : ""));
  const actions = kind === "proposed" ? btn("accept", a.offset, "Accept", true, "settings-scanner.accept") + btn("reject", a.offset, "Reject", false, "settings-scanner.reject")
    : kind === "applied" ? btn("undo", a.offset, "Undo", false, "settings-scanner.undo")
    : btn("recheck", a.offset, "Check again", false, "settings-scanner.recheck");
  // Everything but an applied album can be matched by hand: a barcode, or a link.
  const manual = kind === "applied" ? "" : '<button type="button" data-parity="settings-scanner.barcode" class="id-btn" data-id-match="' + a.offset + '" title="Match by barcode or MusicBrainz link"' + (scanBusy ? " disabled" : "") + ">Barcode…</button>";
  const open = matching === a.offset;
  return '<div class="id-row' + (open ? " is-matching" : "") + '"><button type="button" data-parity="settings-scanner.album" class="id-open" data-id-open="' + a.offset + '">' +
    '<span class="id-name">' + names(a) + "</span>" + (line2 ? '<span class="id-sub">' + line2 + "</span>" : "") + "</button>" +
    '<span class="id-actions">' + actions + manual + "</span>" +
    (open ? '<form class="id-match" data-id-match-form="' + a.offset + '">' +
      '<input data-parity="settings-scanner.match-input" class="id-match-input" type="text" inputmode="numeric" autocomplete="off" placeholder="Barcode, or a MusicBrainz release link" aria-label="Barcode or MusicBrainz link" value="' + scanEsc(matchDraft) + '">' +
      '<button type="submit" data-parity="settings-scanner.match" class="id-btn is-primary"' + (scanBusy ? " disabled" : "") + ">Match</button></form>" +
      '<div class="settings-note id-match-note" data-parity="settings-scanner.note">The digits under the bars on the sleeve, or the address of the release (or album) on musicbrainz.org. That release is written to the album whatever the scan thought.</div>' : "") +
    "</div>";
}

function section(kind, title, note) {
  if (!lists || !st) return "";
  const list = lists[kind] || [];
  if (!list.length) return "";
  const count = lists.counts && lists.counts[kind] != null ? lists.counts[kind] : list.length;
  const shown = more[kind] ? list : list.slice(0, SHOW);
  // All of them kept to 500 (100 applied or declined), as before.
  const all = Math.min(count, kind === "applied" || kind === "rejected" ? 100 : 500);
  return '<div class="settings-divider"></div><div class="settings-block"><div class="settings-block-title" data-parity="settings-scanner.title">' + title + " (" + num(count) + ")</div>" +
    (note ? '<div class="settings-note" data-parity="settings-scanner.note" style="margin:0 0 10px">' + note + "</div>" : "") +
    '<div class="id-list">' + shown.map(it => albumRow(it, kind)).join("") + "</div>" +
    (shown.length < all ? '<button type="button" data-parity="settings-scanner.more" class="dev-link id-more" data-id-more="' + kind + '">Show all ' + num(count) + "</button>" : "") + "</div>";
}

/*
 * The page as blocks (v0.8.17), laid out once: each is drawn from its own
 * answer — or, until that comes, as it was last time, or as its fixed words
 * with "…" for what moves — and redrawn only when what it shows changed, so
 * the page doesn't flicker or jump, and a list keeps its place.
 */
// The schedule first (v0.8.24), then what it runs, in the order it runs it:
// identification (with the pack and its progress), then ReplayGain.
const BLOCKS = ["schedule", "identify", "pack", "progress", "loudness", "cleanup", "cpu", "proposed", "unidentified", "applied", "rejected", "error"];
const drawn = {};
const wait = '<span class="id-wait">…</span>';
function blocks() {
  const s = st ? st.settings : null, p = st ? st.progress : null;
  const out = {};
  out.identify = '<div class="settings-divider"></div><div class="settings-block">' + row("Identify albums" + info("Each album is matched first by what its files carry — a MusicBrainz release ID, a barcode, a catalogue number with its label, the tracks’ ISRCs — then looked up on MusicBrainz by its title, track count and (where the tag can be trusted) its artist, scored against the tracks and their lengths. 85 % alike or better is applied: artist, title, year and track titles, kept in the database like an edit; your files are never touched. The rest are left for you to match. Albums you edited by hand are left alone."),
      sw("data-id-set=\"enabled\"" + (s ? "" : " disabled"), s && s.enabled, "Identify albums", "settings-scanner.identify")) +
    '<div class="settings-note" data-parity="settings-scanner.note">The right names for each album, from its files and MusicBrainz.</div>' +
    row("Ask iTunes too" + info("An album MusicBrainz can’t place is looked up in Apple’s iTunes catalogue too — by barcode first, then by name; no account or key, a request every few seconds. Applied at 85 % alike or better, as a MusicBrainz match is; anything less is left for you. The album keeps the year its files carry, since Apple’s date is often a reissue’s."),
      sw("data-id-set=\"itunes\"" + (s ? "" : " disabled"), s && s.itunes !== false, "Ask iTunes too", "settings-scanner.itunes")) +
    '<div class="settings-note" data-parity="settings-scanner.note">A second opinion for what MusicBrainz can’t place.</div></div>';
  out.pack = packBlock();
  // Measure ReplayGain: the server's loudness measuring (lib/loudness.js),
  // in the schedule's hours, after identification (v0.8.24).
  {
    const m = (loud && loud.settings) || {};
    out.loudness = '<div class="settings-divider"></div><div class="settings-block">' +
      row("Measure ReplayGain" + info("Tracks without ReplayGain tags are measured on the server — EBU R128 loudness and true peak — so Volume Levelling (Settings → Audio Devices → a device) can level them too. It keeps to the schedule above: album by album, newest first, each once identification has looked at it, on the cores playback doesn’t keep. An album’s gain is worked out once all of its tracks are known. Qobuz and Tidal tracks aren’t measured. Your files are never changed."),
        '<label class="switch" data-parity="settings-scanner.measure"><input type="checkbox" data-ld-measure' + (m.measure ? " checked" : "") + (scanBusy || !loud ? " disabled" : "") + ' aria-label="Measure ReplayGain"><span class="switch-track"><span class="switch-thumb"></span></span></label>') +
      '<div class="settings-note" data-parity="settings-scanner.note">Loudness for your files without ReplayGain tags.</div>' +
      '<div class="id-progress" data-parity="settings-scanner.progress">' + (loud ? num(loud.tagged) + " tagged · " + num(loud.measured) + " measured · " + num(loud.left) + " to measure" +
        (loud.failed ? " · " + num(loud.failed) + " couldn’t be read" : "") : wait) + "</div>" +
      (loud && loud.streamed ? '<div class="settings-note" data-parity="settings-scanner.note">' + num(loud.streamed) + " Qobuz and Tidal track" + (loud.streamed === 1 ? "" : "s") + " aren’t measured.</div>" : "") +
      (loud && m.measure ? '<div class="settings-note" data-parity="settings-scanner.note">' + loudStatus() + "</div>" : "") + "</div>";
  }
  // The schedule (v0.8.24): when identification and ReplayGain run, and
  // what is happening now. The library scan itself isn't scheduled.
  out.schedule = '<div class="settings-block"><div class="settings-block-title" data-parity="settings-scanner.title">Schedule</div>' + row("Scheduling" + info("When identification and Measure ReplayGain run, in that order: an album is measured once identification has looked at it. On: between the start and end times each night, on the server’s clock, and not at all outside them. Off: whenever the library isn’t being scanned, until every album is done. Either way both wait while the library scan runs; the scan itself isn’t scheduled, so new music shows up as it arrives. Identification looks at about twelve albums a minute, one MusicBrainz request a second."),
    sw("data-id-set=\"schedule\"" + (s ? "" : " disabled"), s && s.schedule, "Scheduling", "settings-scanner.schedule"));
  if (s && s.schedule) {
    out.schedule += row("Start", '<input type="time" data-parity="settings-scanner.start" class="id-time" data-id-time="start" value="' + scanEsc(s.start) + '"' + (scanBusy ? " disabled" : "") + ' aria-label="Start">') +
      row("End", '<input type="time" data-parity="settings-scanner.end" class="id-time" data-id-time="end" value="' + scanEsc(s.end) + '"' + (scanBusy ? " disabled" : "") + ' aria-label="End">') +
      '<div class="settings-note" data-parity="settings-scanner.note">Each night, on the server’s clock: identification, then ReplayGain.</div>';
  } else {
    out.schedule += '<div class="settings-note" data-parity="settings-scanner.note">' + (s ? "Identification, then ReplayGain, whenever the library isn’t being scanned, until done." : "…") + "</div>";
  }
  out.schedule += '<div class="id-progress" data-parity="settings-scanner.progress" data-sched-now>' + (st ? nowLine() : wait) + "</div></div>";
  out.progress = '<div class="settings-divider"></div><div class="settings-block"><div class="settings-block-title" data-parity="settings-scanner.title">Identification progress</div>' +
    '<div class="id-progress" data-parity="settings-scanner.progress">' + (p ? num(p.checked) + " of " + num(p.eligible) + " albums checked · " + num(p.applied) + " applied · " + num(p.proposed) + " proposed · " + num(p.unidentified) + " unidentified" : wait) + "</div>" +
    '<div class="settings-note" data-parity="settings-scanner.note">' + (st ? scanStatus() : "…") + "</div>" +
    (p && (p.proposed || p.unidentified) ? '<div class="settings-row" style="margin-top:12px"><span class="settings-label"></span><button type="button" data-parity="settings-scanner.recheck-all" class="settings-update-btn" data-id-recheck-all' + (scanBusy ? " disabled" : "") + ">Check the proposed and unidentified again</button></div>" : "") +
    "</div>";
  // Clean up (v0.6.23): what could go, counted; only what you press goes.
  {
    const f = (cleanup && cleanup.files) || {}, qz = (cleanup && cleanup.qobuz) || {}, td = (cleanup && cleanup.tidal) || {}, sp = (cleanup && cleanup.spotify) || {};
    const gone = (x, kind) => !cleanup ? wait : x.albums ? '<button type="button" data-parity="settings-scanner.cleanup" class="settings-update-btn" data-cleanup="' + kind + '"' + (scanBusy ? " disabled" : "") + ">Remove " + num(x.albums) + " album" + (x.albums === 1 ? "" : "s") + "</button>" : '<span class="settings-note" data-parity="settings-scanner.note">Nothing to remove</span>';
    out.cleanup = '<div class="settings-divider"></div><div class="settings-block"><div class="settings-block-title" data-parity="settings-scanner.title">Clean up' +
      info("Albums the library still lists but can’t play: ones whose files are gone from the server (a folder the scanner found missing, empty or unreadable, kept in case it comes back), and Qobuz albums no longer in your favourites, purchases or playlists — every Qobuz album while you’re signed out. Nothing goes until you press. Plays stay in history; an album’s edits, heart and Listen later go with it.") + "</div>" +
      row("Files gone from the server", gone(f, "files")) +
      '<div class="settings-note" data-parity="settings-scanner.note">' + (!cleanup ? "…" : f.albums ? num(f.albums) + " album" + (f.albums === 1 ? "" : "s") + " (" + num(f.tracks) + " tracks) in " + num(f.folders) + " folder" + (f.folders === 1 ? "" : "s") + " the scanner couldn’t find." : "Every album’s files are where the scanner last found them.") + "</div>" +
      row("Qobuz albums no longer wanted", gone(qz, "qobuz")) +
      row("Tidal albums no longer wanted", gone(td, "tidal")) +
      (cleanup && cleanup.spotify ? row("Spotify albums no longer wanted", gone(sp, "spotify")) : "") +
      '<div class="settings-note" data-parity="settings-scanner.note">' + (!cleanup ? "…" : qz.signed_in ? "Qobuz albums neither in your favourites or purchases nor needed by a playlist." : "Signed out of Qobuz: every Qobuz album the database still holds.") + "</div></div>";
  }
  // How the processor is shared out (v0.8.13, lib/cpu.js): playback first.
  {
    const cores = k => k + " core" + (k === 1 ? "" : "s");
    const known = cpu && Array.isArray(cpu.cores);
    out.cpu = '<div class="settings-divider"></div><div class="settings-block"><div class="settings-block-title" data-parity="settings-scanner.title">Processor' +
      info("Playback keeps cores of its own: one, or two while DSP is in use. Scanning, measuring ReplayGain and the phone’s downloads run on the other cores, at the lowest priority, so playback comes first. Set PLAYBACK_CORES to 1 or 2 to fix how many playback keeps, or 0 to share every core.") + "</div>" +
      '<div class="id-progress" data-parity="settings-scanner.progress">' + (!known ? wait : cpu.split
        ? cores(cpu.cores.length) + " · " + cpu.playback.length + " kept for playback" + (cpu.dsp ? " (DSP in use)" : "") + " · " + cpu.background.length + " for scanning and everything else"
        : cores(cpu.cores.length) + ", shared") + "</div>" +
      '<div class="settings-note" data-parity="settings-scanner.note">' + (!known ? "…" : !cpu.split ? "Playback comes first by priority."
        : cpu.raised ? "Playback also runs at a higher priority."
        : "To run playback at a higher priority too, start the container with --cap-add SYS_NICE.") + "</div></div>";
  }
  out.proposed = section("proposed", "Proposed", "Close, but not close enough to apply unasked. Tap the name to see the album; Accept writes the names shown.");
  out.unidentified = section("unidentified", "Unidentified", "Nothing near enough was found. Tap the name, then ⋯ → Edit album to name it yourself.");
  out.applied = section("applied", "Applied", "Names written by the scan. Undo puts back what the album had.");
  out.rejected = section("rejected", "Declined");
  out.error = scanErr && !packBrowse ? '<div class="settings-note away-error" data-parity="settings-scanner.note">' + scanEsc(scanErr) + "</div>" : "";
  return out;
}

function render() {
  if (!scanBody.querySelector("[data-blk]")) {
    scanBody.innerHTML = BLOCKS.map(b => '<div data-blk="' + b + '"></div>').join("");
    for (const k of Object.keys(drawn)) delete drawn[k];
  }
  const html = blocks();
  const typing = document.activeElement && document.activeElement.matches("input:not([type=checkbox]), textarea") ? document.activeElement : null;
  for (const b of BLOCKS) {
    if (drawn[b] === html[b]) continue;
    const el = scanBody.querySelector('[data-blk="' + b + '"]');
    if (!el) continue;
    // Never under the box you're typing in: that block is redrawn once you've left it.
    if (typing && el.contains(typing)) continue;
    el.innerHTML = html[b];
    drawn[b] = html[b];
  }
}

scanBody.addEventListener("change", (e) => {
  if (e.target.closest("[data-ld-measure]")) return setMeasure(e.target.checked);
  const s = e.target.closest("[data-id-set]");
  if (s) return act("/api/identify/settings", { [s.getAttribute("data-id-set")]: s.checked });
  const t = e.target.closest("[data-id-time]");
  if (t && /^\d{1,2}:\d{2}$/.test(t.value)) return act("/api/identify/settings", { [t.getAttribute("data-id-time")]: t.value });
});
scanBody.addEventListener("click", (e) => {
  const b = e.target.closest("[data-id-act]");
  if (b) {
    const what = b.getAttribute("data-id-act");
    const said = { accept: "Applied", reject: "Declined", undo: "Put back", recheck: "It will be looked at again" }[what];
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
  if (e.target.closest("[data-id-recheck-all]")) return act("/api/identify/recheck-all", {}, "They will be looked at again");
  const cu = e.target.closest("[data-cleanup]");
  if (cu) {
    const kind = cu.getAttribute("data-cleanup");
    const n = (cleanup[kind] || {}).albums || 0;
    (async () => {
      const q = kind === "files" ? "Remove " + num(n) + " album" + (n === 1 ? "" : "s") + " whose files are gone from the server?\n\nPlays stay in history; their edits, hearts and Listen later go. If the files come back, a scan adds the albums afresh."
        : "Remove " + num(n) + " Qobuz album" + (n === 1 ? "" : "s") + " from the database?\n\nPlays stay in history. Signing in and favouriting again brings an album back.";
      if (!(await (window.__confirmDialog ? window.__confirmDialog(q) : Promise.resolve(confirm(q))))) return;
      act("/api/library/cleanup", { kind }, "Removed");
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
  if (m) { more[m.getAttribute("data-id-more")] = true; if (lists && !lists.all) loadLists(); return render(); }
  const o = e.target.closest("[data-id-open]");
  if (o && window.__openAlbum) {
    const off = Number(o.getAttribute("data-id-open"));
    const it = ["proposed", "unidentified", "applied", "rejected"].flatMap(k => (lists && lists[k]) || []).find(x => x.album.offset === off);
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
scanNavItem.addEventListener("click", () => { packBrowse = null; more = { proposed: false, unidentified: false, applied: false, rejected: false }; matching = null; matchDraft = ""; render(); scanLoad(true); });
// Progress moves while the pane is open (not while you're typing in it).
setInterval(() => {
  if (scanPane.classList.contains("hidden") || scanBusy || matching !== null || packBrowse) return;
  if (document.activeElement && document.activeElement.closest(".id-time")) return;
  scanLoad();
}, 5000);
