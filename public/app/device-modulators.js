/*
 * Settings → Audio Devices (app/audio-devices.js): with PCM as DSD on, the modulator a track is made DSD with (item
 * 303, the server's Upsample/DsdOut.cs). One row, opening the list of modulators over the device's page, each with
 * what it measured; one not made at the DSD rate set is greyed out, and the seventh order is used there instead. The
 * words are the Android app's too (core DeviceModulators.kt). Loaded after app/device-filters.js, whose list it opens
 * (its taps, its close and its pick: the pick sends {output: {dsd_mod}}).
 */
// Each modulator: its value, its name, what it measured, and the DSD multiples it is made at (DsdOut.Offered).
const DEVICE_MODS = [
  ["7", "7th order", "Mandarin’s default. Its noise held down through the audio band (−207 dB at DSD256), rising above 20 kHz (−124 dB from 20 to 50 kHz).", [64, 128, 256]],
  ["7w", "7th order wide", "DSD128 and DSD256. Its noise held down to 50 kHz: from 20 to 50 kHz −151 dB at DSD256, 27 dB under the 7th’s; in the band −151 dB, below what 24 bits carry.", [128, 256]],
  ["9", "9th order", "DSD64 and DSD128. Quieter in the band (−136 dB at DSD64, 9 dB under the 7th’s; −181 dB at DSD128); a little more above 20 kHz; a fifth more work.", [64, 128]]
];
const MOD_NOTE = "How the PCM is made one bit a sample: where its noise goes. Each measured with a tone at SACD’s level; each holds to 75% modulation with no reset.";
// The modulator used at DSD[n] for the setting [v]: the one set where it is made there, else the seventh order.
const modUsed = (v, n) => (DEVICE_MODS.find(m => m[0] === v && m[3].includes(n)) || DEVICE_MODS[0]);

/** The Modulator's group, for the device's Output [o] with PCM as DSD on. */
function modulatorGroup(o) {
  const n = o.dsd_out;
  return '<div class="cap-group"><span class="cap-label" data-parity="settings-device.cap-label">Modulator</span>' +
    '<button type="button" class="filter-row" data-parity="settings-device.modulator" data-mod-row aria-label="Modulator">' +
    '<span class="filter-row-text"><span class="filter-row-label">Modulator</span><span class="filter-row-sub">PCM made DSD' + n + "</span></span>" +
    '<span class="filter-row-value">' + esc(modUsed(o.dsd_mod, n)[1]) + "</span>" + FILTER_CHEVRON + "</button>" +
    '<div class="settings-note" data-parity="settings-device.note">' + esc(MOD_NOTE) + "</div></div>";
}

/** The list of modulators over the device's page (the Filter's list, app/device-filters.js), the one in use ticked. */
function openModSheet() {
  closeFilterSheet();
  const o = (current && current.output) || {};
  const n = o.dsd_out;
  const cur = modUsed(o.dsd_mod, n)[0];
  const el = document.createElement("div");
  el.id = "filter-sheet";
  el.className = "filter-sheet";
  el.setAttribute("data-which", "dsd_mod");
  el.innerHTML = '<div class="filter-sheet-back" role="button" tabindex="0" aria-label="Close" data-parity="settings-device.modulator-close" data-filter-close></div>' +
    '<div class="filter-sheet-panel" role="dialog" aria-modal="true"><div class="filter-sheet-grip" aria-hidden="true"></div>' +
    '<div class="filter-sheet-title" data-parity="settings-device.modulator-sheet-title">Modulator for DSD' + n + "</div>" +
    DEVICE_MODS.map(([v, name, what, at]) => {
      const off = !at.includes(n);
      return '<button type="button" class="filter-choice' + (v === cur ? " is-on" : "") + (off ? " is-off" : "") + '" data-parity="settings-device.modulator-choice"' +
        (off ? " disabled" : ' data-filter-pick="' + v + '"') + ' aria-label="' + name + '">' +
        '<span class="filter-choice-text"><span class="filter-choice-name">' + name + (off ? " — not at DSD" + n : "") + '</span><span class="filter-choice-note">' + what + "</span></span>" +
        (v === cur ? FILTER_TICK : "") + "</button>";
    }).join("") + "</div>";
  body.appendChild(el);
}

/** A tap on the Modulator's row [t]: true where it was its. */
function modTap(t) {
  if (!t.closest("[data-mod-row]")) return false;
  openModSheet();
  return true;
}
