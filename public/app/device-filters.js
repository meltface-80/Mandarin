/*
 * Settings → Audio Devices (app/audio-devices.js): a device's upsampling filters (items 248, 259, 298). Two rows, the
 * filter for CD-rate sources (44.1 and 48 kHz) and the one for hi-res sources (88.2 kHz and up, or the same), each
 * opening the list of filters over the device's page, each with what it does; a tap chooses it and the list closes.
 * The words are the Android app's too (core DeviceFilters.kt). Loaded before app/audio-devices.js, whose page it draws
 * into; the taps are app/audio-devices-dsp.js's.
 */
// Each filter: its value, its name, what it does (the Gaussian ones measured, item 298: Upsample/Gaussian.cs).
const DEVICE_FILTERS = [
  ["standard", "Standard", "Linear phase, steep: flat to 21 kHz for a CD. SoX’s filter for PCM; Mandarin’s own on the way to DSD."],
  ["minphase", "Minimum phase", "Standard’s response with all its ringing after a sound, none before. Mandarin’s own, made as it plays."],
  ["gentle", "Gentle", "Linear phase, rolling off from 19.8 kHz for a CD: its ringing half as long; −6 dB at 21 kHz."],
  ["gaussian", "Gaussian", "A smooth roll-off: flat to 19.75 kHz for a CD (−0.5 dB at 20 kHz), 100 dB down by 22.05 kHz; 1.8 ms of ringing before a sound."],
  ["gaussian-steep", "Gaussian steep", "Flat to 21.8 kHz for a CD and half down at 22.05 kHz, every sample of the file kept as it is (not apodizing); 5.9 ms of ringing before a sound."],
  ["gaussian-hires", "Gaussian hi-res", "For 88.2 kHz and up: flat to 25.9 kHz from 96 kHz, 0.2 ms of ringing. For a CD it rolls off from 12 kHz."]
];
const FILTER_SAME = ["same", "Same as CD-rate sources", "The filter for CD-rate sources, for every track."];
const filterName = v => (DEVICE_FILTERS.find(f => f[0] === v) || DEVICE_FILTERS[0])[1];
// The rows' note, and how fast the making goes (item 259): with PCM as DSD on, said under PCM as DSD instead.
const filterNotes = (o) => [o.dsd_out
  ? "With PCM as DSD" + o.dsd_out + " on, these are the filters each track is upsampled with on its way to DSD" + o.dsd_out + ": by its own rate, the first or the second."
  : "Each track is upsampled in the filter for its own rate: 44.1 and 48 kHz in the first, 88.2 kHz and up in the second.",
  !o.dsd_out && ((o.filter && o.filter !== "standard") || (o.filter_hires && o.filter_hires !== "standard")) && o.making ? o.making : null];
const FILTER_CHEVRON = '<svg class="filter-row-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const FILTER_TICK = '<svg class="filter-choice-tick" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

/** The Filter's group: its two rows and the note, for the device's Output [o]. */
function filterGroup(o) {
  const row = (key, which, label, sub, value) => '<button type="button" class="filter-row" data-parity="' + key + '" data-filter-row="' + which + '" aria-label="' + label + '">' +
    '<span class="filter-row-text"><span class="filter-row-label">' + label + '</span><span class="filter-row-sub">' + sub + "</span></span>" +
    '<span class="filter-row-value">' + esc(value) + "</span>" + FILTER_CHEVRON + "</button>";
  const [note, making] = filterNotes(o);
  return '<div class="cap-group"><span class="cap-label" data-parity="settings-device.cap-label">Filter</span>' +
    row("settings-device.filter", "filter", "CD-rate sources", "44.1 and 48 kHz", filterName(o.filter || "standard")) +
    row("settings-device.filter-hires", "filter_hires", "Hi-res sources", "88.2 kHz and up", o.filter_hires ? filterName(o.filter_hires) : "Same as CD-rate") +
    '<div class="settings-note" data-parity="settings-device.note">' + esc(note) + "</div>" +
    (making ? '<div class="settings-note" data-parity="settings-device.note">' + esc(making) + "</div>" : "") + "</div>";
}

/** The list of filters for [which] ("filter" or "filter_hires") over the device's page, the one in use ticked. */
function openFilterSheet(which) {
  closeFilterSheet();
  const o = (current && current.output) || {};
  const cur = which === "filter" ? (o.filter || "standard") : (o.filter_hires || "same");
  const choices = (which === "filter_hires" ? [FILTER_SAME] : []).concat(DEVICE_FILTERS);
  const el = document.createElement("div");
  el.id = "filter-sheet";
  el.className = "filter-sheet";
  el.setAttribute("data-which", which);
  el.innerHTML = '<div class="filter-sheet-back" role="button" tabindex="0" aria-label="Close" data-parity="settings-device.filter-close" data-filter-close></div>' +
    '<div class="filter-sheet-panel" role="dialog" aria-modal="true"><div class="filter-sheet-grip" aria-hidden="true"></div>' +
    '<div class="filter-sheet-title" data-parity="settings-device.filter-sheet-title">' + (which === "filter" ? "Filter for CD-rate sources" : "Filter for hi-res sources") + "</div>" +
    choices.map(([v, name, what]) => '<button type="button" class="filter-choice' + (v === cur ? " is-on" : "") + '" data-parity="settings-device.filter-choice" data-filter-pick="' + v + '" aria-label="' + name + '">' +
      '<span class="filter-choice-text"><span class="filter-choice-name">' + name + '</span><span class="filter-choice-note">' + what + "</span></span>" +
      (v === cur ? FILTER_TICK : "") + "</button>").join("") + "</div>";
  body.appendChild(el);
}

/** The list closed, where it is open. */
function closeFilterSheet() {
  const el = document.getElementById("filter-sheet");
  if (el) el.remove();
}

/** A tap on the page's Filter rows or their list [t]: true where it was theirs. */
function filterTap(t) {
  const r = t.closest("[data-filter-row]");
  if (r) { openFilterSheet(r.getAttribute("data-filter-row")); return true; }
  if (t.closest("[data-filter-close]")) { closeFilterSheet(); return true; }
  const p = t.closest("[data-filter-pick]");
  if (p) {
    const which = p.closest("#filter-sheet").getAttribute("data-which");
    closeFilterSheet();
    patch({ output: { [which]: p.getAttribute("data-filter-pick") } });
    return true;
  }
  return false;
}
