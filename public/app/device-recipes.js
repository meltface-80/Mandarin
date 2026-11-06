/*
 * Settings → Audio Devices (app/audio-devices.js): a device's Output as recipes (item 320). A short list of named
 * settings, each with what it does for this device in words (its highest rate, its real bits, its DSD rate), as cards
 * under Sound, the one its settings are now marked with its words; Custom where they are none of them. A tap sends a
 * recipe's settings ({output: …}) and nothing else: the bit depth, the highest rate and the DAC's real bits stay. An
 * upsampled recipe is offered only above 48 kHz, a DSD one only where DSD is on. Custom opens Advanced, where every row
 * of the Output is, as before; Advanced stays open where it was opened, and is open while Custom is in use. The
 * recipes and their words are the Android app's too (core DeviceRecipes.kt); the figures are the measured ones
 * (DitherTests, LongFilterTests, DsdModulatorTests). Loaded before app/audio-devices.js, whose page it draws into;
 * its taps are app/audio-devices-dsp.js's.
 */
// The upsampled recipes' settings: what a pick sends, and what the Output must be for it to be the one in use.
const RECIPE_UPSAMPLED = [
  ["standard", { mode: "max", filter: "standard", filter_hires: "same", phase: "linear", dither: "flat", dsd_out: "off" }],
  ["gaussian", { mode: "max", filter: "gaussian", filter_hires: "gaussian-hires", phase: "linear", dither: "flat", dsd_out: "off" }],
  ["gaussian-min", { mode: "max", filter: "gaussian", filter_hires: "gaussian-hires", phase: "minimum", dither: "flat", dsd_out: "off" }],
  ["very-long", { mode: "max", filter: "very-long", filter_hires: "same", phase: "linear", dither: "ns5", dsd_out: "off" }]
];
// A setting's value by its absence (the server's defaults).
const RECIPE_DEFAULTS = { mode: "original", filter: "standard", filter_hires: "same", phase: "linear", dither: "flat", dsd_out: "off", dsd_mod: "7" };
const khz = hz => String(Math.round(hz) / 1000);
// Advanced opened by a tap, by device: kept across the page's redraws.
const advancedOpen = new Set();

/** Whether the Output [o] is a recipe's settings [sets]: each as the device has it, its absence its default; minphase the standard filter. */
function recipeMatches(sets, o) {
  return Object.keys(sets).every(k => {
    let have = o[k] == null || o[k] === "" ? RECIPE_DEFAULTS[k] : o[k];
    if (k === "filter" && have === "minphase") have = "standard";
    return String(sets[k]) === String(have);
  });
}

/** The highest rate on of 44.1 kHz's family, held to the owner's highest rate [cap] by 48 kHz's (item 240): what a CD is upsampled to. */
function recipeTopCd(rates, cap) {
  return (rates || []).filter(r => r.on && r.hz % 44100 === 0 && (!cap || r.hz <= cap / 48000 * 44100)).reduce((t, r) => Math.max(t, r.hz), 0);
}

/** The recipes of the device [d], each {id, name, words, output, on}, the one in use marked; Custom last. */
function recipesFor(d) {
  const o = d.output || {};
  const name = d.name || "the device";
  const top = recipeTopCd(d.rates, o.max_rate || 0);
  const bits = o.bits === 32 && o.flac32 ? 32 : 24;
  const dsd = Math.max(0, ...(d.dsd || []).filter(x => x.on && [64, 128, 256].includes(x.n)).map(x => x.n));
  const list = [];
  const add = (id, label, words, output) => list.push({ id, name: label, words, output, on: false });
  add("bitperfect", "Bit-perfect", "The file as it is, wherever " + name + " takes its rate and depth: nothing done to the samples. A rate it doesn’t take, the nearest it does, made by SoX.",
    { mode: "original", dsd_out: "off" });
  if (top > 48000) {
    const k = khz(top);
    const at = o.real_bits >= 20 ? "at " + name + "’s " + o.real_bits + " real bits" : "at " + bits + " bits";
    const words = {
      standard: ["Upsampled, Standard filter", "Each track to the highest rate " + name + " takes (" + k + " kHz for a CD), " + bits + "-bit, in SoX’s steep filter: flat to 21 kHz for a CD. ffmpeg’s flat dither."],
      gaussian: ["Upsampled, Gaussian", "To " + k + " kHz in the Gaussian filters, Mandarin’s own as it plays: a CD’s 100 dB down by 22.05 kHz, 1.8 ms of ringing either side of a sound; hi-res in Gaussian hi-res. Flat dither."],
      "gaussian-min": ["Upsampled, Gaussian, minimum phase", "As Gaussian, to " + k + " kHz, in minimum phase: the same levels at every frequency, all the ringing after a sound. Flat dither."],
      "very-long": ["Upsampled, Very long, shaped dither", "To " + k + " kHz in the Very long filter (1,048,577 taps: flat to 21.9 kHz for a CD, 284 dB down from 22.1 kHz), its last bit dithered " + at + ", shaped of the 5th order: its noise moved above the audio band."]
    };
    for (const [id, sets] of RECIPE_UPSAMPLED) add(id, words[id][0], words[id][1], sets);
  }
  if (dsd > 0) {
    const [mhz, band] = dsd === 64 ? ["2.8224", "−127"] : dsd === 128 ? ["5.6448", "−163"] : ["11.2896", "−207"];
    add("dsd", "DSD" + dsd + ", 7th order", "Each track made DSD" + dsd + " (" + mhz + " MHz) as it plays: upsampled in Gaussian steep, then the 7th-order modulator, " + band + " dB in the audio band.",
      { dsd_out: dsd, dsd_mod: "7", filter: "gaussian-steep", filter_hires: "same", phase: "linear" });
  }
  const on = list.find(r => recipeMatches(r.output, o));
  if (on) on.on = true;
  list.push({ id: "custom", name: "Custom", words: "Set each of the rows under Advanced yourself.", output: null, on: !on });
  return list;
}

/** The Sound group, for the device [d]: its recipes as cards, the one in use with its words. */
function recipesGroup(d) {
  return '<div class="cap-group"><span class="cap-label" data-parity="settings-device.cap-label">Sound</span>' +
    recipesFor(d).map(r => '<button type="button" class="recipe-card' + (r.on ? " is-on" : "") + '" data-parity="settings-device.recipe" data-recipe-pick="' + esc(r.id) + '" aria-label="' + esc(r.name) + '" aria-pressed="' + (r.on ? "true" : "false") + '">' +
      '<span class="recipe-card-name">' + esc(r.name) + "</span>" +
      (r.on ? '<span class="recipe-card-words">' + esc(r.words) + "</span>" : "") + "</button>").join("") + "</div>";
}

/** Whether the Advanced fold is open for [d]: opened by a tap, or Custom in use. */
function advancedIsOpen(d) {
  return advancedOpen.has(d.id) || recipesFor(d).some(r => r.id === "custom" && r.on);
}

/** The Advanced fold, for [d]; [inner] its rows. */
function advancedFold(d, inner) {
  const open = advancedIsOpen(d);
  return '<details class="recipe-advanced" data-dev-advanced' + (open ? " open" : "") + '><summary class="recipe-advanced-head" data-parity="settings-device.advanced">Advanced' +
    '<span class="recipe-advanced-sub">' + (open ? "Each row of the Output" : "Set by the one above") + "</span></summary>" + inner + "</details>";
}

/** A tap on a recipe card or the Advanced head [t], for the device [d]: true where it was theirs. */
function recipeTap(t, d) {
  const head = t.closest("[data-dev-advanced] > summary");
  if (head) {
    // The fold opens or closes as the browser has it; what it is now is kept for the redraws.
    if (head.parentElement.open) advancedOpen.delete(d.id); else advancedOpen.add(d.id);
    return false;
  }
  const c = t.closest("[data-recipe-pick]");
  if (!c) return false;
  const r = recipesFor(d).find(x => x.id === c.getAttribute("data-recipe-pick"));
  if (!r) return true;
  if (!r.output) { advancedOpen.add(d.id); const f = c.closest(".settings-block").querySelector("[data-dev-advanced]"); if (f) f.open = true; return true; }
  if (!r.on) patch({ output: r.output });
  return true;
}
