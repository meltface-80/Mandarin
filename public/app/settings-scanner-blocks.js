/* Settings → Library Scanner's sections (bug list item 411; app/settings-scanner.js draws them): the Album Scanner's
 * switch and its note, then while it is on Progress, the albums to place by hand as folders, Schedule, Library
 * clean-up and the Processor (the MusicBrainz pack between them is settings-scanner-pack.js). Each is drawn from its
 * own answer, "…" where it hasn't come yet. */
const SCANNER_INFO = "Each album is matched first by what its files carry — a MusicBrainz release ID, a barcode, a catalogue number with its label, the tracks’ ISRCs — then looked up on MusicBrainz, and on Apple’s iTunes catalogue for what MusicBrainz can’t place. 85 % alike or better is applied (artist, title, year and track titles, kept in the database like an edit); the rest are left for you. Tracks without ReplayGain tags are measured (EBU R128 loudness and true peak), so Volume Levelling can level them. Albums with no cover of their own are looked up on Apple Music, Deezer and MusicBrainz and given one only when title, artist and tracks all agree. Your files are never changed, nor albums you edited by hand. It works album by album, newest first, on the cores playback doesn’t keep, and waits while music plays or the library is scanned.";
const CLEANUP_INFO = "Albums the library still lists but can’t play: ones whose files are gone from the server (a folder the scanner found missing, empty or unreadable, kept in case it comes back), and Qobuz or Tidal albums no longer in your favourites or purchases — every one while you’re signed out. Nothing goes until you press. Plays stay in history; an album’s edits, heart and Listen later go with it.";
const CPU_INFO = "Playback keeps cores of its own: one, or two while DSP is in use. While a track is upsampled or made DSD as it plays, and for half a minute after, playback keeps all the cores but two (but one on a machine of two or three), or as many as Cores for upsampling and DSD says. The Album Scanner and the phone’s downloads run on the other cores, at the lowest priority, so playback comes first. Set PLAYBACK_CORES to 1 or 2 to fix how many playback keeps, or 0 to share every core.";
const SCAN_NOTE = "Identifies albums, measures ReplayGain and finds missing covers, while nothing plays.";
const scanWaitNote = '<span class="id-wait">…</span>';
const scanSw = (attr, on, label, key, dis) => '<label class="switch" data-parity="' + key + '"><input type="checkbox" ' + attr + (on ? " checked" : "") + (scanBusy || dis ? " disabled" : "") +
  ' aria-label="' + scanEsc(label) + '"><span class="switch-track"><span class="switch-thumb"></span></span></label>';

/* The switch, and what it does; off, that none of it is done. */
function scannerSwitchBlock() {
  const on = !!(scan && scan.on);
  return '<div class="scan-top"><div class="scan-row"><span class="scan-title" data-parity="settings-scanner.name">Album Scanner' + info(SCANNER_INFO) + "</span>" +
    scanSw("data-scan-on", on, "Album Scanner", "settings-scanner.scanner", !scan) + "</div>" +
    '<div class="settings-note" data-parity="settings-scanner.note">' + SCAN_NOTE + (scan && !on ? " Off: none of this is done." : "") + "</div></div>";
}

/* Progress: the albums with every step done, a bar, and what it is doing now. */
function scannerProgressBlock() {
  const pc = scanPercent(scan);
  const away = coversUnreachable(scan);
  return '<div class="scan-sec"><div class="scan-row"><span class="scan-lab" data-parity="settings-scanner.name">Progress</span>' +
    '<span class="id-progress scan-count" data-parity="settings-scanner.progress"><b>' + num(scan.done) + "</b>" + scanEsc(scanProgressWords(scan).slice(num(scan.done).length)) + "</span></div>" +
    '<div class="scan-bar" data-parity="settings-scanner.bar" role="presentation"><i style="width:' + pc + '%"></i></div>' +
    '<div class="settings-note" data-parity="settings-scanner.now">' + scanEsc(scanNowWords(scan)) + "</div>" +
    (away ? '<div class="settings-note" data-parity="settings-scanner.note">' + scanEsc(away) + "</div>" : "") + "</div>";
}

/* The albums to place by hand as folders: Unidentified always; To confirm only while there are proposals. */
function scannerFolder(kind, key, name, count, sub) {
  return '<button type="button" class="scan-folder" data-scan-folder="' + kind + '" data-parity="' + key + '" aria-label="' + name + '"' + (scanBusy ? " disabled" : "") + ">" +
    '<span class="scan-fico" aria-hidden="true"><span class="scan-fico-n">' + num(count) + "</span></span>" +
    '<span class="scan-ftxt"><span class="scan-lab">' + name + '</span><span class="scan-sub">' + sub + "</span></span>" +
    '<span class="scan-chev" aria-hidden="true">›</span></button>';
}
function scannerFoldersBlock() {
  return '<div class="scan-sec scan-folders">' +
    scannerFolder("unidentified", "settings-scanner.unidentified", "Unidentified", scan.unidentified, scan.unidentified ? "Tap to place them by hand" : "None to place by hand") +
    (scan.proposed ? scannerFolder("proposed", "settings-scanner.to-confirm", "To confirm", scan.proposed, "Found, but not sure enough to apply unasked") : "") + "</div>";
}

/* Schedule: its own switch; on, the hours it keeps to. */
function scannerScheduleBlock() {
  const s = scan.schedule || {};
  // Each with its key written out (npm run parity reads them here).
  const time = (which, label) => '<input type="time" data-parity="' + { start: "settings-scanner.start", end: "settings-scanner.end" }[which] + '" class="id-time" data-scan-time="' + which + '" value="' + scanEsc(s[which]) + '"' +
    (scanBusy ? " disabled" : "") + ' aria-label="' + label + '">';
  return '<div class="scan-sec"><div class="scan-row"><span class="scan-ftxt"><span class="scan-lab" data-parity="settings-scanner.name">Schedule</span>' +
    '<span class="scan-sub" data-parity="settings-scanner.note">' + (s.on ? "Runs only between these times" : "Off: runs any time, day and night") + "</span></span>" +
    scanSw("data-scan-sched", s.on, "Schedule", "settings-scanner.schedule") + "</div>" +
    (s.on ? '<div class="scan-row scan-times"><span class="scan-sub" data-parity="settings-scanner.name">From</span>' + time("start", "From") +
      '<span class="scan-sub" data-parity="settings-scanner.name">to</span>' + time("end", "To") + "</div>" : "") + "</div>";
}

/* Library clean-up (v0.6.23): what could go, counted; only what is pressed goes. */
function scannerCleanupBlock() {
  const head = '<div class="scan-row"><span class="scan-lab" data-parity="settings-scanner.name">Library clean-up' + info(CLEANUP_INFO) + "</span></div>";
  if (!cleanup) return '<div class="scan-sec">' + head + '<div class="settings-note" data-parity="settings-scanner.note">' + scanWaitNote + "</div></div>";
  const albums = (n, what) => num(n) + " " + what + (n === 1 ? "" : "s");
  const f = cleanup.files || {}, qz = cleanup.qobuz || {}, td = cleanup.tidal || {};
  const kinds = [["files", f, albums(f.albums, "album") + " whose files are gone"],
    ["qobuz", qz, albums(qz.albums, "Qobuz album") + (qz.signed_in ? " no longer wanted" : " (signed out of Qobuz)")],
    ["tidal", td, albums(td.albums, "Tidal album") + " no longer wanted"]].filter(k => k[1].albums);
  const rows = kinds.map(([kind, , words]) => '<div class="scan-row"><span class="scan-sub" data-parity="settings-scanner.note">' + words + "</span>" +
    '<button type="button" data-parity="settings-scanner.cleanup" class="id-btn scan-danger" data-cleanup="' + kind + '"' + (scanBusy ? " disabled" : "") + ">Remove</button></div>").join("");
  return '<div class="scan-sec">' + head + (rows || '<div class="settings-note" data-parity="settings-scanner.note">Nothing to remove.</div>') + "</div>";
}

/* The processor (v0.8.13): how its cores are shared out, and the cores a track made as it plays has (item 260). */
function scannerCpuBlock() {
  const cores = k => k + " core" + (k === 1 ? "" : "s");
  const known = cpu && Array.isArray(cpu.cores);
  const line = !known ? scanWaitNote : cpu.split
    ? cores(cpu.cores.length) + " · " + cpu.playback.length + " kept for playback" + (cpu.making ? " (making as it plays)" : cpu.dsp ? " (DSP in use)" : "") + " · " + cpu.background.length + " for the rest"
    : cores(cpu.cores.length) + ", shared; playback comes first by priority";
  const most = known && cpu.split ? Math.min(3, cpu.cores.length - 1) : 0;
  const making = most < 1 ? "" : '<div class="scan-row"><span class="scan-sub" data-parity="settings-scanner.name">Cores for upsampling and DSD</span><div class="seg scan-seg" data-cpu-making>' +
    ["auto", 1, 2, 3].filter(v => v === "auto" || v <= most).map(v =>
      '<button type="button" data-parity="settings-scanner.making" class="seg-btn' + ((cpu.making_cores || 0) === (v === "auto" ? 0 : v) ? " is-on" : "") + '" data-making="' + v + '"' + (scanBusy ? " disabled" : "") + ">" + (v === "auto" ? "Auto" : v) + "</button>").join("") + "</div></div>";
  // Playback at a higher priority too, or how to have it: said behind ⓘ, the page kept to one screen.
  const hint = !known || !cpu.split ? "" : cpu.raised ? " Playback also runs at a higher priority here." : " To run playback at a higher priority too, give the server the SYS_NICE capability.";
  return '<div class="scan-sec"><div class="scan-row"><span class="scan-ftxt"><span class="scan-lab" data-parity="settings-scanner.name">Processor' + info(CPU_INFO + hint) + "</span>" +
    '<span class="scan-sub" data-parity="settings-scanner.progress">' + line + "</span></span></div>" + making + "</div>";
}
