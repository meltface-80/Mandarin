/* Settings → Library Scanner's words for the Album Scanner (bug list item 411), from GET /api/album-scanner: its one
 * Progress readout and what it is doing now. Plain text (the page escapes it where it puts it); the app says the same
 * (Scanner.kt: progressCount, nowLine); since item 414b a verdict's reasons and the other releases To confirm offers
 * (Scanner.kt: reasons, otherName); since item 414c why the albums left unsure aren't matched by sound (Scanner.kt:
 * soundNote); since item 417b what holds it while music plays, by name (Scanner.kt: heldLine). Tested on their own
 * (test/scanner-words.test.js). */
const scanCount = n => Number(n || 0).toLocaleString();

/* A verdict's reasons (item 414b), as its row says them: "found by its barcode · 12 of 12 tracks' lengths agree". */
function scanReasons(list) {
  return (list || []).filter(Boolean).join(" · ");
}

/* Another release To confirm offers in place of the one proposed (item 414b): "Someone Else — Near Miss (1980) · 40 %". */
function scanOtherName(o) {
  return (o.artist ? o.artist + " — " : "") + (o.title || "—") + (o.year ? " (" + o.year + ")" : "") + (o.edition ? " · " + o.edition : "") +
    (o.source === "itunes" ? " · iTunes" : "") + (o.similarity != null ? " · " + o.similarity + " %" : "");
}

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

/* "Living room", "Living room and Kitchen", "Den, Kitchen and Living room". */
function scanNames(names) {
  return names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

/* Paused while music plays, and where (item 417b, the server's now.holding): the rooms and phones playing by name;
 * else a track made as it plays, for the room it is made for where that is known. */
function scanHeldWords(holding) {
  const list = holding || [];
  const rooms = list.filter(h => h.kind !== "making" && h.name).map(h => h.name);
  if (rooms.length) return "Paused while music plays in " + scanNames(rooms);
  const making = list.find(h => h.kind === "making");
  if (making) return making.name ? "Paused while a track is made for " + making.name : "Paused while a track is made as it plays";
  return "Paused while music plays";
}

/* "Now: U2 — Pop · measuring loudness" while it works; else what it waits for, or that it is done. */
function scanNowWords(a) {
  const now = (a && a.now) || {};
  const start = (a && a.schedule && a.schedule.start) || "";
  switch (now.reason) {
    case "working": return now.album ? "Now: " + (now.album.artist ? now.album.artist + " — " : "") + now.album.title + " · " + now.step : "Now: on to the next album";
    case "waiting": return "Waiting for " + start;
    case "playing": return scanHeldWords(now.holding);
    case "scanning": return "Paused while the library is scanned";
    case "unreachable": return "MusicBrainz isn't answering; trying again in a few minutes";
    case "done": return "All done";
    case "later": return "The rest are looked at again after the next library scan, or at night";
    default: return "Off";
  }
}

/*
 * How far matching by sound has got (item 419; GET /api/album-scanner's sound_tally): the albums matched so far, those
 * still to look at, and when it will (the Album Scanner off, or outside its hours). On API Keys until its key became
 * Mandarin's own (item 491).
 */
function scanSoundTally(t) {
  if (!t) return "";
  const when = !t.waiting ? "" : t.held === "off" ? ", when the Album Scanner is on" : t.held === "hours" ? ", in the Album Scanner's hours" : "";
  return "By sound: " + t.matched + (t.matched === 1 ? " album" : " albums") + " matched so far, " + t.waiting + " still to look at" + when + ".";
}

/* Why the albums left unsure aren't matched by sound (item 414c, GET /api/album-scanner's sound); "" when they are. */
function scanSoundNote(a) {
  switch (a && a.sound) {
    case "needs-key": return "This build of Mandarin carries no AcoustID key, so albums aren't matched by sound.";
    case "refused": return "AcoustID refused Mandarin's key, so albums aren't matched by sound for now.";
    case "limited": return "AcoustID asked to wait: matching by sound rests a few minutes.";
    case "unreachable": return "AcoustID can't be reached: matching by sound rests a few minutes.";
    default: return "";
  }
}
