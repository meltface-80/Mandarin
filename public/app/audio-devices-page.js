/* Settings → Audio Devices (app/audio-devices.js), 2 of 3: a device's page — Volume Levelling, the phone's USB DAC. */
/*
 * Volume Levelling (v0.6.0-RC7): ReplayGain for this device — Off, Track,
 * Album or Auto; with it on, the target level and the adjustment for a
 * track whose loudness isn't known. Saved as soon as it's chosen.
 */
const LV_MODES = [["off", "Off"], ["track", "Track"], ["album", "Album"], ["auto", "Auto"]];
const LV_NAMES = { mode: "Volume levelling", target: "Target volume level", unknown: "Volume adjustment when loudness is unknown" };
// Each select's key in the screens contract (docs/specs/screens.json, settings-device; item 89).
const LV_KEYS = { mode: ' data-parity="settings-device.lv-mode"', target: ' data-parity="settings-device.lv-target"', unknown: ' data-parity="settings-device.lv-unknown"' };
const infoBtn = t => ' <button class="settings-info-btn"' + ' data-parity="settings-device.info"' + ' type="button" data-info="' + esc(t) + '" aria-label="Info">ⓘ</button>';
function renderLevelling(d) {
  const lv = d.levelling;
  const sel = (key, opts, cur) => '<div class="settings-select-wrap"><select class="settings-select"' + LV_KEYS[key] + ' aria-label="' + LV_NAMES[key] + '" data-lv="' + key + '"' + (busy ? " disabled" : "") + ">" +
    opts.map(([v, label]) => '<option value="' + v + '"' + (String(v) === String(cur) ? " selected" : "") + ">" + esc(label) + "</option>").join("") + "</select></div>";
  const where = d.kind === "phone" ? "The app applies the gain itself, to streams and downloads alike."
    : "The gain goes into the stream: each track is sent as FLAC with it applied. Off sends every file as it is.";
  let html = '<div class="settings-divider"></div><div class="settings-block">' +
    '<div class="settings-row"><span class="settings-label"' + ' data-parity="settings-device.name"' + '>Volume levelling' + infoBtn("ReplayGain. Track plays every track at the same level. Album plays every record at the same level, its quiet and loud songs as they were made. Auto is Album while a record plays in order and Track when tracks from different records follow one another — a shuffle, a playlist, radio. Gains come from the files’ ReplayGain tags, or from Measure ReplayGain (Settings → Library Scanner); a track’s peak keeps it from being turned up into clipping. " + where + " A change is heard straight away, from where the music is.") +
    "</span>" + sel("mode", LV_MODES, lv.mode) + "</div>";
  if (lv.mode !== "off") {
    const targets = [];
    for (let n = -14; n >= -25; n--) targets.push([n, n + " LUFS" + (n === -14 ? " (Default)" : "")]);
    const unknown = [];
    for (let n = 0; n >= -12; n--) unknown.push([n, n + " dB" + (n === -5 ? " (Default)" : "")]);
    html += '<div class="settings-row"><span class="settings-label"' + ' data-parity="settings-device.name"' + '>Target volume level' + infoBtn("How loud every track is brought to. −14 LUFS is about the level streaming services play at; lower numbers play quieter and leave more room for loud peaks.") + "</span>" + sel("target", targets, lv.target) + "</div>" +
      '<div class="settings-row"><span class="settings-label"' + ' data-parity="settings-device.name"' + '>Volume adjustment when loudness is unknown' + infoBtn("For a track with no ReplayGain tags that hasn’t been measured: a fixed change instead, so it doesn’t jump out louder than the levelled tracks around it.") + "</span>" + sel("unknown", unknown, lv.unknown) + "</div>";
  }
  return html + "</div>";
}

/*
 * The USB DAC (Stage 9.1): only in the app, only on the page of the phone
 * the app is on. What the port holds, the permission for it, and what the
 * DAC's descriptors say it takes. Playing through it comes in 9.2, so the
 * switch is shown but not yet offered.
 */
const usbApp = window.MusicdUsb || null;
function isThisPhone(d) { try { return !!usbApp && usbApp.phoneZone() === d.id; } catch (e) { return false; } }
function usbInfo() { try { return JSON.parse(usbApp.info()); } catch (e) { return { attached: false, error: e.message }; } }
function renderUsb() {
  const u = usbInfo();
  let html = '<div class="settings-divider"></div><div class="settings-block"><div class="settings-block-title"' + ' data-parity="settings-device.title"' + '>USB DAC</div>';
  if (!u.attached) {
    html += '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>Nothing on the USB port. Plug a DAC in and it shows here.</div></div>';
    return html;
  }
  const dev = u.device || {};
  const name = [dev.manufacturer, dev.name].filter(Boolean).join(" ");
  html += '<div class="settings-row"><span class="settings-label"' + ' data-parity="settings-device.name"' + '>' + esc(name || "USB audio device") + "</span>";
  if (!u.permission) html += '<button type="button" class="settings-update-btn"' + ' data-parity="settings-device.usb-allow"' + ' data-usb-allow>Allow</button>';
  html += "</div>";
  if (!u.permission) {
    html += '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>Android asks once whether Mandarin may use this device; a yes is remembered for it.</div>';
    if (u.error) html += '<div class="settings-note away-error"' + ' data-parity="settings-device.note"' + '>' + esc(u.error) + "</div>";
    return html + "</div>";
  }
  const i = u.info;
  if (!i) return html + '<div class="settings-note away-error"' + ' data-parity="settings-device.note"' + '>' + esc(u.error || "Reading the DAC…") + "</div></div>";
  const rates = (i.rates || []).map(hz => chip("rate", hz, fmtRate(hz), true, "confirmed", false)).join("");
  const bits = (i.bits || []).map(n => chip("bits", n, n + "-bit", true, "confirmed", false)).join("");
  html += '<div class="cap-group"><span class="cap-label"' + ' data-parity="settings-device.cap-label"' + '>Class</span><div class="dev-v"' + ' data-parity="settings-device.value"' + '>USB Audio Class ' + (i.uac === 2 ? "2" : "1") +
    (i.speed && i.speed !== "unknown" ? " · " + esc(i.speed) + " speed" : "") + " · " + esc(i.sync || "") + "</div></div>";
  html += '<div class="cap-group"><span class="cap-label"' + ' data-parity="settings-device.cap-label"' + '>Sample rates (kHz)</span><div class="cap-chips">' + (rates || '<span class="dev-v"' + ' data-parity="settings-device.value"' + '>not stated</span>') + "</div></div>";
  html += '<div class="cap-group"><span class="cap-label"' + ' data-parity="settings-device.cap-label"' + '>Bit depth</span><div class="cap-chips">' + (bits || '<span class="dev-v"' + ' data-parity="settings-device.value"' + '>not stated</span>') + "</div></div>";
  html += '<div class="cap-group"><span class="cap-label"' + ' data-parity="settings-device.cap-label"' + '>DSD</span><div class="dev-v"' + ' data-parity="settings-device.value"' + '>' + (i.dsd ? "Native DSD offered" : "No native DSD in its descriptors (DoP may still work)") + "</div></div>";
  html += '<div class="cap-group"><span class="cap-label"' + ' data-parity="settings-device.cap-label"' + '>Volume</span><div class="dev-v"' + ' data-parity="settings-device.value"' + '>' + (i.volume_control ? "The DAC has a USB volume control" : "No USB volume control (fixed at full)") + "</div></div>";
  if (i.current_rate) html += '<div class="cap-group"><span class="cap-label"' + ' data-parity="settings-device.cap-label"' + '>Clock now</span><div class="dev-v"' + ' data-parity="settings-device.value"' + '>' + esc(fmtRate(i.current_rate)) + " kHz</div></div>";
  const st = u.stream;
  html += '<div class="settings-row" style="margin-top:14px"><span class="settings-label"' + ' data-parity="settings-device.name"' + '>USB direct' + settingsInfo("The app plays through its own USB driver: the DAC is fed the track at its own rate and the DAC’s depth, Android’s mixer out of the way — bit-perfect with the DSP off. A rate the DAC doesn’t take goes through Android as before. Off, the phone plays through Android’s mixer, at the mixer’s rate.", "settings-device.info") + "</span>" +
    '<label class="switch"' + ' data-parity="settings-device.usb-direct"' + '><input type="checkbox" data-usb-direct' + (u.direct ? " checked" : "") + ' aria-label="USB direct">' +
    '<span class="switch-track"><span class="switch-thumb"></span></span></label></div>' +
    '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>' + (u.direct
      ? "On. Through the app’s own USB driver, at the track’s own rate."
      : "Off. The phone plays through Android’s mixer, at the mixer’s rate.") + "</div>";
  if (u.direct) {
    const fixed = !!u.fixed;
    const limit = Number(u.limit) || 80;
    html += '<div class="settings-row" style="margin-top:14px"><span class="settings-label"' + ' data-parity="settings-device.name"' + '>Fixed volume</span>' +
      '<label class="switch"' + ' data-parity="settings-device.usb-fixed"' + '><input type="checkbox" data-usb-fixed' + (fixed ? " checked" : "") + ' aria-label="Fixed volume">' +
      '<span class="switch-track"><span class="switch-thumb"></span></span></label></div>' +
      '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>' + (fixed
        ? "On. The DAC is driven at full and the amplifier sets the level — for a DAC into a preamp. Not for headphones on a DAC with its own volume control."
        : (i.volume_control
          ? "Off. The volume slider and the phone’s volume buttons drive the DAC’s own control. It starts at 10% whenever USB direct goes on or the DAC is plugged in — never at the DAC’s own level."
          : "Off. This DAC has no USB volume control, so the slider and the phone’s volume buttons scale the samples before they go out — no longer bit-perfect. Switch on for bit-perfect at full.")) + "</div>";
    if (!fixed) {
      html += '<div class="settings-row" style="margin-top:10px"><span class="settings-label"' + ' data-parity="settings-device.name"' + '>Volume limit</span>' +
        '<span class="dev-v"' + ' data-parity="settings-device.value"' + ' data-usb-limit-value>' + limit + '%</span></div>' +
        '<input type="range"' + ' data-parity="settings-device.usb-limit"' + ' min="10" max="100" step="5" value="' + limit + '" data-usb-limit aria-label="Volume limit" style="width:100%">' +
        '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>The most the volume can be set to through USB — the slider stops here, so the DAC is never driven to full by mistake.</div>';
    }
  }
  if (u.direct && ((u.dsd_native || []).length || (u.dsd_dop || []).length)) {
    // DSD (Stage 9.3): natively where the DAC has a DSD alternate setting, as DoP where it takes 24-bit PCM at the rate, or PCM from the server.
    const nat = (u.dsd_native || []).map(n => "DSD" + n).join(", "), dop = (u.dsd_dop || []).map(n => "DSD" + n).join(", ");
    const mode = u.dsd_mode || "native";
    const opt = (v, label) => '<option value="' + v + '"' + (mode === v ? " selected" : "") + ">" + label + "</option>";
    html += '<div class="settings-row" style="margin-top:14px"><span class="settings-label"' + ' data-parity="settings-device.name"' + '>DSD</span><div class="settings-select-wrap"><select class="settings-select"' + ' data-parity="settings-device.usb-dsd"' + ' aria-label="DSD" data-usb-dsd>' +
      (nat ? opt("native", "Native") + opt("native_le", "Native, words reversed") : "") + (dop ? opt("dop", "DoP") : "") + opt("pcm", "PCM from the server") + "</select></div></div>" +
      '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>' + (nat ? "Natively: " + nat + ". " : "") + (dop ? "As DoP: " + dop + ". " : "") +
      (mode === "pcm" ? "DSD files are converted to PCM on the server, as before." : mode === "dop" ? "DSD files go to the DAC as DoP (DSD over PCM), bit-perfect." :
        "DSD files go to the DAC as DSD, bit-perfect" + (mode === "native_le" ? ", each 32-bit word the other way round — for a DAC that plays noise with the usual order" : "") + (dop ? "; DoP where the rate isn’t native." : ".")) + "</div>";
  }
  if (st) {
    const s = st.stats || {};
    html += '<div class="cap-group"><span class="cap-label"' + ' data-parity="settings-device.cap-label"' + '>Streaming now</span><div class="dev-v"' + ' data-parity="settings-device.value"' + '>' + (st.dsd ? "DSD" + st.dsd + (st.kind === "dop" ? " as DoP" : " native") : esc(fmtRate(st.rate)) + " kHz · " + esc(st.bits) + "-bit") +
      (u.fixed ? " · fixed volume" : (typeof st.level === "number" ? " · volume " + st.level + "%" + (st.software_volume ? " in software" : "") +
        (st.volume_db ? " (DAC range " + Number(st.volume_db.min).toFixed(1) + " to " + Number(st.volume_db.max).toFixed(1) + " dB)" : "") : "")) +
      (s.running === false ? " · paused" : "") +
      (s.feedback ? " · feedback " + Number(s.feedback).toFixed(3) + " frames/packet" : "") +
      (s.underruns ? " · " + s.underruns + " underrun" + (s.underruns === 1 ? "" : "s") : "") + (s.errors ? " · " + s.errors + " error" + (s.errors === 1 ? "" : "s") : "") + "</div></div>";
  }
  if (u.stream_error) html += '<div class="settings-note away-error"' + ' data-parity="settings-device.note"' + '>' + esc(u.stream_error) + "</div>";
  html += '<div class="settings-row" style="margin-top:10px"><span class="settings-label"' + ' data-parity="settings-device.name"' + '>Diagnostics</span><button type="button" class="settings-update-btn"' + ' data-parity="settings-device.usb-copy"' + ' data-usb-copy>Copy</button></div>' +
    '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>Everything the DAC said about itself, as text — what a report needs.</div>';
  if (u.error) html += '<div class="settings-note away-error"' + ' data-parity="settings-device.note"' + '>' + esc(u.error) + "</div>";
  return html + "</div>";
}
window.__musicdUsbChanged = () => { if (current && current.kind === "phone" && isThisPhone(current)) renderDetail(true); };

/*
 * DSP (v0.5.23): the switch, the parametric bands with their curve, the
 * headroom. Edits live in dspDraft until Save; the switch saves at once,
 * the draft with it. public/biquad.js draws the curve the server runs.
 */
function renderDsp(d) {
  const dr = dspOf(d);
  const on = !!d.dsp.enabled;
  const B = window.Biquad;
  const peak = B ? B.peakDb(allBands(dr), 48000) : 0;
  const auto = autoHeadroom(dr);
  let html = '<div class="settings-divider"></div><div class="settings-block" data-dsp-block>' +
    '<div class="settings-row"><span class="settings-label"' + ' data-parity="settings-device.name"' + '>DSP' + settingsInfo(d.kind === "phone"
      ? "The app runs the headphone profile and the bands on everything this phone plays — the server's stream, Opus away from home, downloads — in 64-bit float, out through Bluetooth, USB or the speaker as float."
      : "Every track is decoded to 64-bit float, the headroom taken, upsampled if set, the bands run, then dithered to " + (d.output && d.output.flac32 && d.bits.some(b => b.n === 32 && b.on) && d.output.bits !== 24 ? "32" : "24") + " bits. Off, the device gets the file as stored (or the conversion the Output settings ask for).", "settings-device.info") + "</span>" +
    '<label class="switch"' + ' data-parity="settings-device.dsp"' + '><input type="checkbox" data-dsp-on' + (on ? " checked" : "") + ' aria-label="DSP"><span class="switch-track"><span class="switch-thumb"></span></span></label></div>' +
    '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>' + (on ? "On. A headphone profile and up to ten bands, on everything it plays."
      : d.kind === "phone" ? "Off. The app plays what it is given as it is." : "Off. The device gets the file as stored.") + "</div>";
  html += renderHeadphones(dr);
  html += '<div class="cap-group"><span class="cap-label"' + ' data-parity="settings-device.cap-label"' + '>Parametric EQ · ' + dr.bands.length + ' of 10 bands</span>' +
    '<canvas class="dsp-curve"' + ' data-parity="settings-device.curve"' + ' data-dsp-curve height="150" aria-label="The bands’ response"></canvas>';
  if (!dr.bands.length) html += '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>No bands yet. Add one for each correction: a peak at a frequency, a shelf below or above one, or a pass filter.</div>';
  html += '<div class="dsp-bands">';
  dr.bands.forEach((b, i) => {
    html += '<div class="dsp-band" data-dsp-band="' + i + '">' +
      '<select class="dsp-type"' + ' data-parity="settings-device.band-type"' + ' data-dsp-f="type" aria-label="Type">' + BAND_TYPES.map(t => '<option value="' + t[0] + '"' + (t[0] === b.type ? " selected" : "") + ">" + t[1] + "</option>").join("") + "</select>" +
      '<label class="dsp-field"' + ' data-parity="settings-device.band-freq"' + '><span>Hz</span><input aria-label="Hz" type="number" inputmode="decimal" min="10" max="24000" step="1" data-dsp-f="freq" value="' + esc(b.freq) + '"></label>' +
      '<label class="dsp-field' + (isPass(b.type) ? " is-off" : "") + '"' + ' data-parity="settings-device.band-gain"' + '><span>dB</span><input aria-label="dB" type="number" inputmode="decimal" min="-20" max="20" step="0.1" data-dsp-f="gain" value="' + esc(isPass(b.type) ? 0 : b.gain) + '"' + (isPass(b.type) ? " disabled" : "") + "></label>" +
      '<label class="dsp-field"' + ' data-parity="settings-device.band-q"' + '><span>Q</span><input aria-label="Q" type="number" inputmode="decimal" min="0.1" max="20" step="0.01" data-dsp-f="q" value="' + esc(Math.round(b.q * 100) / 100) + '"></label>' +
      '<button type="button" class="dsp-remove"' + ' data-parity="settings-device.band-remove"' + ' data-dsp-remove="' + i + '" aria-label="Remove band">×</button></div>';
  });
  html += "</div>";
  if (dr.bands.length < 10) html += '<button type="button" class="settings-update-btn dsp-add"' + ' data-parity="settings-device.band-add"' + ' data-dsp-add>Add band</button>';
  html += "</div>";
  const manual = typeof dr.headroom === "number";
  html += '<div class="cap-group"><span class="cap-label"' + ' data-parity="settings-device.cap-label"' + '>Headroom</span>' +
    '<div class="seg" data-dsp-seg><button type="button"' + ' data-parity="settings-device.headroom"' + ' class="seg-btn' + (!manual ? " is-on" : "") + '" data-dsp-headroom="auto">Auto</button>' +
    '<button type="button"' + ' data-parity="settings-device.headroom"' + ' class="seg-btn' + (manual ? " is-on" : "") + '" data-dsp-headroom="set">Set</button></div>' +
    (manual ? '<label class="dsp-field dsp-headroom-set"' + ' data-parity="settings-device.headroom-db"' + '><span>dB</span><input aria-label="Headroom in dB" type="number" inputmode="decimal" min="-30" max="0" step="0.1" data-dsp-f="headroom" value="' + esc(dr.headroom) + '"></label>' : "") +
    '<div class="settings-note"' + ' data-parity="settings-device.note"' + ' data-dsp-headroom-note>' + esc(headroomNote(dr, peak, auto)) + "</div></div>";
  html += '<div class="dsp-actions"><span class="dsp-dirty"' + ' data-parity="settings-device.dirty"' + ' data-dsp-dirty>' + (dr.dirty ? "Not saved yet" : "") + '</span>' +
    '<button type="button" class="action-btn primary"' + ' data-parity="settings-device.save"' + ' data-dsp-save' + (dr.dirty ? "" : " disabled") + ">Save</button></div>";
  html += "</div>";
  return html;
}
function headroomNote(dr, peak, auto) {
  if (typeof dr.headroom === "number") return "Set by hand: " + fmtDb(dr.headroom) + " before the bands. Auto would take " + fmtDb(auto) + ".";
  if (!allBands(dr).length) return "Auto: nothing to take yet.";
  const own = dr.headphone && typeof dr.headphone.preamp === "number" ? dr.headphone.preamp : null;
  if (own != null && own === auto) return "Auto: " + fmtDb(auto) + " — the headphone profile's own preamp, which covers the bands' peak of " + fmtDb(peak) + ".";
  return "Auto: " + fmtDb(auto) + " before the bands — their peak together is " + fmtDb(peak) + ", and half a dB is kept under it so nothing clips." +
    (own != null ? " The profile's own " + fmtDb(own) + " would not cover it." : "");
}
