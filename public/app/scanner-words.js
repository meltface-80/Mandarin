/* Settings → Library Scanner's words for the Album Scanner (bug list item 411), from GET /api/album-scanner: its one
 * Progress readout and what it is doing now. Plain text (the page escapes it where it puts it); the app says the same
 * (Scanner.kt: progressCount, nowLine). Tested on their own (test/scanner-words.test.js). */
const scanCount = n => Number(n || 0).toLocaleString();

/* The share of the library's albums with every step done, rounded down: 100 % is every one of them. */
function scanPercent(a) {
  const all = Number(a && a.albums) || 0;
  return all > 0 ? Math.floor((Number(a.done) || 0) / all * 100) : 0;
}

/* "9,960 of 14,119 albums · 71%". */
function scanProgressWords(a) {
  const all = Number(a && a.albums) || 0;
  return scanCount(a && a.done) + " of " + scanCount(all) + (all === 1 ? " album · " : " albums · ") + scanPercent(a) + "%";
}

/* "Now: U2 — Pop · measuring loudness" while it works; else what it waits for, or that it is done. */
function scanNowWords(a) {
  const now = (a && a.now) || {};
  const start = (a && a.schedule && a.schedule.start) || "";
  switch (now.reason) {
    case "working": return now.album ? "Now: " + (now.album.artist ? now.album.artist + " — " : "") + now.album.title + " · " + now.step : "Now: on to the next album";
    case "waiting": return "Waiting for " + start;
    case "playing": return "Paused while music plays";
    case "scanning": return "Paused while the library is scanned";
    case "unreachable": return "MusicBrainz isn't answering; trying again in a few minutes";
    case "done": return "All done";
    case "later": return "The rest are looked at again after the next library scan, or at night";
    default: return "Off";
  }
}
