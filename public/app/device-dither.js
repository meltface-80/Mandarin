/*
 * Settings → Audio Devices (app/audio-devices.js): when Mandarin makes the PCM (upsampled), how its last bit is rounded
 * (item 301, the server's Upsample/Dither.cs). Two rows under Bit depth: the DAC's real bits (as sent, or 23 to 20: the
 * dither put in at that bit), and the dither, a row opening its list over the device's page, each with what it
 * measured. Shaped is made at 88.2 kHz and up; below, flat. The words are the Android app's too (core
 * DeviceDither.kt). Loaded after app/device-filters.js, whose list it opens (its taps, its close and its pick: the pick
 * sends {output: {dither}}).
 */
// Each dither: its value, its name, what it measured (a 997 Hz tone at half scale, at 705.6 kHz and 20 bits).
const DEVICE_DITHERS = [
  ["flat", "Flat", "Mandarin’s default: triangular dither, its noise even at every frequency. −130 dB in the audio band; −117 dB in all."],
  ["ns3", "Shaped, 3rd order", "Its noise moved above the audio band: −192 dB in the band, 62 dB under Flat; −104 dB in all, 13 dB more than Flat."],
  ["ns5", "Shaped, 5th order", "More moved: −233 dB in the band, 103 dB under Flat; −93 dB in all, 24 dB more than Flat."]
];
const DITHER_NOTE = "How the last bit is rounded when Mandarin makes the PCM. Measured with a tone at half scale at 705.6 kHz and 20 bits. Shaped is made at 88.2 kHz and up; at 44.1 and 48 kHz there is no room above the band to move the noise to, so Flat.";
const REAL_BITS_NOTE = "How many bits the DAC itself resolves, above its own noise: from its measured dynamic range, (dB − 1.76) ÷ 6.02. The dither goes in at that bit; the bits below it are left at zero. As sent: at the word’s own depth.";
const ditherName = v => (DEVICE_DITHERS.find(d => d[0] === v) || DEVICE_DITHERS[0])[1];

/** The DAC's real bits and the Dither's groups, for the device's Output [o] where Mandarin makes the PCM. */
function ditherGroups(o, seg) {
  return '<div class="cap-group"><span class="cap-label" data-parity="settings-device.cap-label">DAC’s real bits</span>' +
    seg("real_bits", [{ v: "sent", label: "As sent" }, { v: 23, label: "23" }, { v: 22, label: "22" }, { v: 21, label: "21" }, { v: 20, label: "20" }], o.real_bits || "sent") +
    '<div class="settings-note" data-parity="settings-device.note">' + esc(REAL_BITS_NOTE) + "</div></div>" +
    '<div class="cap-group"><span class="cap-label" data-parity="settings-device.cap-label">Dither</span>' +
    '<button type="button" class="filter-row" data-parity="settings-device.dither" data-dither-row aria-label="Dither">' +
    '<span class="filter-row-text"><span class="filter-row-label">Dither</span><span class="filter-row-sub">' + (o.real_bits ? "At " + o.real_bits + " bits" : "At the word’s depth") + "</span></span>" +
    '<span class="filter-row-value">' + esc(ditherName(o.dither || "flat")) + "</span>" + FILTER_CHEVRON + "</button>" +
    '<div class="settings-note" data-parity="settings-device.note">' + esc(DITHER_NOTE) + "</div></div>";
}

/** The list of dithers over the device's page (the Filter's list, app/device-filters.js), the one in use ticked. */
function openDitherSheet() {
  closeFilterSheet();
  const o = (current && current.output) || {};
  const cur = o.dither || "flat";
  const el = document.createElement("div");
  el.id = "filter-sheet";
  el.className = "filter-sheet";
  el.setAttribute("data-which", "dither");
  el.innerHTML = '<div class="filter-sheet-back" role="button" tabindex="0" aria-label="Close" data-parity="settings-device.dither-close" data-filter-close></div>' +
    '<div class="filter-sheet-panel" role="dialog" aria-modal="true"><div class="filter-sheet-grip" aria-hidden="true"></div>' +
    '<div class="filter-sheet-title" data-parity="settings-device.dither-sheet-title">Dither</div>' +
    DEVICE_DITHERS.map(([v, name, what]) => '<button type="button" class="filter-choice' + (v === cur ? " is-on" : "") + '" data-parity="settings-device.dither-choice" data-filter-pick="' + v + '" aria-label="' + name + '">' +
      '<span class="filter-choice-text"><span class="filter-choice-name">' + name + '</span><span class="filter-choice-note">' + what + "</span></span>" +
      (v === cur ? FILTER_TICK : "") + "</button>").join("") + "</div>";
  body.appendChild(el);
}

/** A tap on the Dither's row [t]: true where it was its. */
function ditherTap(t) {
  if (!t.closest("[data-dither-row]")) return false;
  openDitherSheet();
  return true;
}
