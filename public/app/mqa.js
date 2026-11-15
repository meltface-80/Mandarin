/*
 * MQA (item 418): what a track's or album's signalling says, as the server found it in its samples (mqa: { studio,
 * original_rate, bits }), and the words for it, the Android app's too (core Mqa.kt): "MQA · 24/352.8 original",
 * "MQA Studio · 24/192 original"; a room that sends it untouched to a DAC that decodes MQA, "MQA: sent untouched to
 * the DAC". Its badge on the album's tracks, beside Now playing's format, its words on the Versions tab's rate line;
 * and Audio Devices' This DAC decodes MQA (an Output's switch, off by default). Mandarin decodes no MQA itself.
 */

/** "352.8" from 352800, "192" from 192000. @param {number} hz */
function mqaKhz(hz) {
  return String(Math.round(hz / 100) / 10);
}

/** "MQA Studio · 24/352.8 original"; "" for none. @param {any} m */
function mqaLabel(m) {
  if (!m) return "";
  const rate = Number(m.original_rate) || 0;
  const bits = Number(m.bits) || 0;
  return (m.studio ? "MQA Studio" : "MQA") + (rate ? " · " + (bits ? bits + "/" : "") + mqaKhz(rate) + " original" : "");
}

/** Said in Now playing where the room sends the track untouched to its MQA DAC. */
function mqaUntouchedWords() {
  return "MQA: sent untouched to the DAC";
}

/** A track's badge (its key in the screens contract [key]); null where it isn't MQA. @param {any} m @param {string} key */
function mqaBadge(m, key) {
  if (!m) return null;
  const b = document.createElement("span");
  b.className = "mqa-badge" + (m.studio ? " is-studio" : "");
  b.dataset.parity = key;
  b.textContent = mqaLabel(m);
  return b;
}

/** Audio Devices' This DAC decodes MQA, for the device's Output [o]: its switch and what it does. @param {any} o */
function mqaGroup(o) {
  const note = o.mqa_dac
    ? "An MQA track goes to this DAC untouched, for it to decode: no upsampling, DSD, DSP, ReplayGain or dither, and Mandarin’s volume fixed at 100% for it. Set the level on the DAC or amplifier. Other tracks are played as set above."
    : "Off, an MQA track plays as the PCM it is, undecoded, with this device’s processing as set above. Turn on for a DAC that decodes MQA itself.";
  return '<div class="cap-group"><span class="cap-label" data-parity="settings-device.cap-label">MQA</span>' +
    '<div class="settings-row" style="margin-top:8px"><span class="settings-label" data-parity="settings-device.name">This DAC decodes MQA</span>' +
    '<label class="switch" data-parity="settings-device.mqa-dac"><input type="checkbox" data-dev-mqa' + (o.mqa_dac ? " checked" : "") + ' aria-label="This DAC decodes MQA">' +
    '<span class="switch-track"><span class="switch-thumb"></span></span></label></div>' +
    '<div class="settings-note" data-parity="settings-device.note">' + esc(note) + "</div></div>";
}

/** Now playing's MQA lines, from now_playing [np]: its badge, and "sent untouched" where this room does. @param {any} np */
function paintNpMqa(np) {
  const badge = document.getElementById("np-mqa"), note = document.getElementById("np-mqa-untouched");
  if (!badge || !note) return;
  const m = np && np.mqa;
  badge.textContent = mqaLabel(m);
  badge.className = "np-mqa" + (m ? (m.studio ? " is-studio" : "") : " hidden");
  note.textContent = m && m.untouched ? mqaUntouchedWords() : "";
  note.classList.toggle("hidden", !(m && m.untouched));
}
