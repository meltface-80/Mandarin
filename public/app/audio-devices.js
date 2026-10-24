/* ------------------------------------------------------------------ */
/*  Settings → Audio Devices: every player Mandarin can see — Sonos     */
/*  rooms, phones, UPnP renderers — its name (yours, stored on the      */
/*  server) and what it can take. From home only. Playing to the UPnP   */
/*  renderers comes in a later version.                                 */
/* ------------------------------------------------------------------ */
const list = document.getElementById("devices-list");
const pane = document.querySelector('.settings-pane[data-pane="playback"]');
const navItem = document.querySelector('.settings-nav-item[data-pane="playback"]');
const detail = document.querySelector('.settings-pane[data-pane="device"]');
const body = document.getElementById("device-pane-body");
const title = document.getElementById("device-pane-title");
const rescan = document.getElementById("devices-rescan");
const hideBtn = document.getElementById("devices-hide");
const hideNote = document.getElementById("devices-hide-note");
// Hide / unhide (v0.7.2): a select mode over the list, every row with a
// tick circle; hidden devices listed again under Hidden, where a tick
// brings one back. OK applies both ways; Cancel (no ticks) leaves it.
let hideMode = false;
let picks = new Set();
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ask = (q) => window.__confirmDialog ? window.__confirmDialog(q) : Promise.resolve(confirm(q));
const deviceToast = (m, kind) => { if (window.__showToast) window.__showToast(m, kind); };
const svg = (paths) => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
const ICONS = {
  sonos: svg('<rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><circle cx="12" cy="6" r="1"/>'),
  phone: svg('<rect x="7" y="2" width="10" height="20" rx="2"/><circle cx="12" cy="18" r="1"/>'),
  upnp: svg('<rect x="2" y="7" width="20" height="10" rx="2"/><circle cx="17" cy="12" r="2"/><path d="M5 12h7"/>'),
  // A sound device on the computer Mandarin runs on: a DAC on its cable.
  local: svg('<rect x="9" y="11" width="11" height="9" rx="2"/><circle cx="14.5" cy="15.5" r="1.5"/><path d="M4 3v6a3 3 0 0 0 3 3h2"/><path d="M2.5 3h3"/>')
};
const MARK = { verified: "✓", user: "✎", profile: "◆", advertised: "◆" };
const SOURCE = {
  verified: "Confirmed by the device", user: "You set it", profile: "Known for this model",
  advertised: "The device advertises it", floor: "Every renderer takes this", sonos: "Sonos plays this",
  phone: "The phone plays this", later: "Not sent as DSD", off: "Not offered"
};
let devices = [], away = false, err = "", current = null, busy = false, local = null;
// The DSP block's unsaved edits (bands, headroom) for the device open now.
// Save sends them; opening another device drops them.
let dspDraft = null;
const BAND_TYPES = [["peak", "Peak"], ["low_shelf", "Low shelf"], ["high_shelf", "High shelf"], ["low_pass", "Low-pass"], ["high_pass", "High-pass"]];
const isPass = t => t === "low_pass" || t === "high_pass";
function dspOf(d) {
  if (dspDraft && dspDraft.id === d.id) return dspDraft;
  const cur = d.dsp || { enabled: false, peq: null, headroom: "auto" };
  dspDraft = { id: d.id, dirty: false, bands: ((cur.peq && cur.peq.bands) || []).map(b => Object.assign({}, b)), headroom: cur.headroom == null ? "auto" : cur.headroom,
    headphone: cur.headphone || null };
  return dspDraft;
}
function dspSetting(draft, enabled) {
  return { enabled, headphone: draft.headphone, peq: { bands: draft.bands }, headroom: draft.headroom };
}
// Every band the draft runs: the headphone profile's, then the PEQ's.
const allBands = dr => (dr.headphone && dr.headphone.bands ? dr.headphone.bands : []).concat(dr.bands);
const autoHeadroom = dr => window.Biquad ? window.Biquad.headroom(dspSetting(Object.assign({}, dr, { headroom: "auto" }), true), 48000) : 0;
const fmtDb = v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + " dB";
async function api(url, method, payload) {
  const r = await fetch(url, method ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}
const fmtRate = hz => String(hz / 1000);
const stateWord = d => d.state === "playing" ? "Playing" : d.state === "paused" ? "Paused" : d.online ? "Idle" : "Offline";
const fmtWhen = ts => ts ? new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";

async function load() {
  try { const j = await api("/api/audio-devices"); devices = j.devices || []; away = !!j.away; local = j.local || null; err = ""; }
  catch (e) { err = e.message; }
  renderList();
  if (current) refreshCurrent();
}
async function refreshCurrent() {
  const id = current.id;
  try {
    const d = await api("/api/audio-devices/" + encodeURIComponent(id));
    if (current && current.id === id) { current = d; renderDetail(true); }
  } catch (e) { /* the list carries the error */ }
}

function renderList() {
  // Away, the app sees the phone it is on and nothing else; the network
  // can't be searched from there, so Look again goes.
  if (rescan) rescan.classList.toggle("hidden", away);
  if (away && !devices.length) { list.innerHTML = '<div class="settings-note"' + ' data-parity="settings-audio.note"' + '>Away from home, this phone is the only player — and it shows here once the app has started playing.</div>'; return; }
  // Sound devices on the server's computer that it can't open (v0.6.18); a Mac's, not yet played (item 153).
  const localNote = away || !local || local.off ? ""
    : local.platform === "darwin" ? (local.mac ? "This Mac's own sound outputs can't be played from Mandarin yet: its audio engine doesn't play through Core Audio yet." : "")
    : local.platform !== "linux" || local.count || !(local.hidden || local.docker) ? "" : local.docker ? "To play through a USB DAC or speakers plugged into the computer Mandarin runs on, start its container with --device /dev/snd and --privileged."
      : "This computer has sound devices Mandarin isn’t allowed to open: add the user Mandarin runs as to the audio group.";
  if (!devices.length) { list.innerHTML = '<div class="settings-note"' + ' data-parity="settings-audio.note"' + ">" + esc(err || "Nothing found yet — the network is being searched.") + "</div>" + (localNote ? '<div class="settings-note"' + ' data-parity="settings-audio.note"' + ">" + localNote + "</div>" : ""); paintHideTools(); return; }
  let html = "";
  const shown = devices.filter(d => !d.hidden);
  const hidden = devices.filter(d => d.hidden);
  const row = (d) => {
    const sub = [d.model || (d.profile && d.profile.label) || "", d.renamed ? d.network_name : "", d.hidden ? "hidden" : ""].filter(Boolean).join(" · ");
    const off = d.can_toggle && !d.enabled;
    if (hideMode) {
      const picked = picks.has(d.id);
      return '<div class="dev-row is-selecting' + (picked ? " is-picked" : "") + (d.hidden ? " is-hidden" : "") + '">' +
        '<button type="button" class="dev-open dev-pickrow"' + ' data-parity="settings-audio.pick"' + ' data-pick="' + esc(d.id) + '" aria-pressed="' + (picked ? "true" : "false") + '" aria-label="' + esc(d.name) + '">' +
        '<span class="dev-pick" aria-hidden="true">' + (picked ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : "") + "</span>" +
        '<span class="dev-ico">' + (ICONS[d.kind] || ICONS.upnp) + "</span>" +
        '<span class="dev-txt"><span class="dev-name">' + esc(d.name) + "</span>" + (sub ? '<span class="dev-sub">' + esc(sub) + "</span>" : "") + "</span>" +
        (d.hidden ? "" : '<span class="dev-state' + (d.state === "playing" ? " is-playing" : "") + '">' + (off ? "Off" : stateWord(d)) + "</span>") +
        "</button></div>";
    }
    return '<div class="dev-row' + (d.online ? "" : " is-off") + (off ? " is-disabled" : "") + '">' +
      '<button type="button" class="dev-open"' + ' data-parity="settings-audio.device"' + ' data-dev="' + esc(d.id) + '" aria-label="' + esc(d.name) + '">' +
      '<span class="dev-ico">' + (ICONS[d.kind] || ICONS.upnp) + "</span>" +
      '<span class="dev-txt"><span class="dev-name">' + esc(d.name) + "</span>" + (sub ? '<span class="dev-sub">' + esc(sub) + "</span>" : "") + "</span>" +
      '<span class="dev-state' + (d.state === "playing" ? " is-playing" : "") + '">' + (off ? "Off" : stateWord(d)) + "</span>" +
      '<span class="dev-chev" aria-hidden="true">›</span></button>' +
      (d.can_toggle ? '<label class="switch dev-switch"' + ' data-parity="settings-audio.device-on"' + ' title="' + (d.enabled ? "On: offered as a zone" : "Off: not offered as a zone") + '">' +
        '<input type="checkbox" data-dev-enable="' + esc(d.id) + '"' + (d.enabled ? " checked" : "") + ' aria-label="' + esc(d.name) + ' on">' +
        '<span class="switch-track"><span class="switch-thumb"></span></span></label>' : "") +
      "</div>";
  };
  for (const d of shown) html += row(d);
  if (hideMode && hidden.length) {
    html += '<div class="dev-rule"' + ' data-parity="settings-audio.rule"' + ' aria-hidden="true"><span>Hidden</span></div>';
    for (const d of hidden) html += row(d);
  } else if (!hideMode && hidden.length) {
    html += '<div class="settings-note dev-hidden-count"' + ' data-parity="settings-audio.note"' + ">" + hidden.length + (hidden.length === 1 ? " device hidden" : " devices hidden") + "</div>";
  }
  if (localNote) html += '<div class="settings-note"' + ' data-parity="settings-audio.note"' + ">" + localNote + "</div>";
  if (away) html += '<div class="settings-note"' + ' data-parity="settings-audio.note"' + ">" + (window.__musicdOffline
    ? "No network: this phone is the player, through its speaker, headphones, Bluetooth or a USB DAC. Sonos rooms and streamers come back with the network."
    : "Away from home, this phone is the only player. Sonos rooms and streamers are shown at home.") + "</div>";
  if (err) html += '<div class="settings-note away-error"' + ' data-parity="settings-audio.note"' + ">" + esc(err) + "</div>";
  list.innerHTML = html;
  paintHideTools();
}
// The buttons for the mode: Hide / unhide beside Look again; selecting,
// Cancel until something is ticked, then OK, and Look again steps aside.
function paintHideTools() {
  if (!hideBtn) return;
  hideBtn.classList.toggle("hidden", away || !devices.length);
  hideBtn.textContent = !hideMode ? "Hide / unhide" : picks.size ? "OK" : "Cancel";
  hideBtn.classList.toggle("is-primary", hideMode && picks.size > 0);
  hideBtn.setAttribute("aria-pressed", String(hideMode));
  if (rescan) rescan.classList.toggle("hidden", away || hideMode);
  if (hideNote) hideNote.classList.toggle("hidden", !hideMode);
}
async function applyHide() {
  const chosen = devices.filter(d => picks.has(d.id));
  hideMode = false; picks = new Set();
  if (!chosen.length) { renderList(); return; }
  let hid = 0, shown = 0;
  hideBtn.disabled = true;
  try {
    for (const d of chosen) {
      await api("/api/audio-devices/" + encodeURIComponent(d.id), "PATCH", { hidden: !d.hidden });
      if (d.hidden) shown++; else hid++;
    }
    err = "";
  } catch (e) { err = e.message; }
  hideBtn.disabled = false;
  await load();
  const parts = [];
  if (hid) parts.push(hid + (hid === 1 ? " device hidden" : " devices hidden"));
  if (shown) parts.push(shown + (shown === 1 ? " device shown again" : " devices shown again"));
  const notice = window.__noticeDialog || (m => Promise.resolve(window.alert(m)));
  await notice(parts.join(", ") + ".\n\n" + (hid
    ? "A hidden device stays off this list; one that can be switched off has been, so it leaves the zone picker too. To bring one back, tap Hide / unhide again: hidden devices are listed at the bottom under Hidden. Tick the one you want and tap OK."
    : "They are back on the list, switched off until you switch them on."), "OK");
}

function chip(kind, v, label, on, source, editable) {
  const tag = editable ? "button" : "span";
  return "<" + tag + (editable ? ' type="button"' : "") + (editable ? ' data-parity="settings-device.chip"' : ' data-parity="settings-device.cap"') + ' class="cap-chip' + (on ? " is-on" : "") + (source === "later" ? " is-later" : "") +
    '" data-cap="' + kind + '" data-v="' + v + '" title="' + esc(SOURCE[source] || "") + '">' + esc(label) +
    (on && MARK[source] ? '<span class="cap-mark">' + MARK[source] + "</span>" : "") + "</" + tag + ">";
}

function renderDetail(keepInput) {
  const d = current;
  if (!d) return;
  // A refresh while a band is being typed would take the field away
  // mid-edit: the draft is kept and the block left as it is.
  if (keepInput && body.querySelector("[data-dsp-block]:focus-within")) return;
  title.textContent = d.name;
  const inp = keepInput && body.querySelector(".dev-name-input");
  const draft = inp && document.activeElement === inp ? inp.value : null;
  const ed = !!d.editable;
  let html = "";

  if (d.can_toggle) {
    html += '<div class="settings-block"><div class="settings-row"><span class="settings-label"' + ' data-parity="settings-device.name"' + '>' + (d.enabled ? "On" : "Off") + "</span>" +
      '<label class="switch"' + ' data-parity="settings-device.enabled"' + '><input type="checkbox" data-dev-enable="' + esc(d.id) + '"' + (d.enabled ? " checked" : "") + ' aria-label="On">' +
      '<span class="switch-track"><span class="switch-thumb"></span></span></label></div>' +
      '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>' + (d.enabled ? "Offered as a zone: in the zone picker and everywhere you play."
        : (d.kind === "upnp" ? "Not offered as a zone. A device found on the network stays off until you turn it on."
          : d.kind === "local" ? "Not offered as a zone. A sound device on this computer stays off until you turn it on." : "Not offered as a zone.")) +
      "</div></div><div class=\"settings-divider\"></div>";
  }
  // Random album radio, per zone: what plays when this device's queue runs out.
  if (d.radio !== undefined && d.enabled && d.playable !== false) {
    html += '<div class="settings-block"><div class="settings-row"><span class="settings-label"' + ' data-parity="settings-device.name"' + '>Random album radio</span>' +
      '<label class="switch"' + ' data-parity="settings-device.radio"' + '><input type="checkbox" data-dev-radio="' + esc(d.id) + '"' + (d.radio ? " checked" : "") + ' aria-label="Random album radio">' +
      '<span class="switch-track"><span class="switch-thumb"></span></span></label></div>' +
      '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>' + (d.radio
        ? "On. When this device’s queue ends, whole random albums keep coming — ones you haven’t played in the last two months."
        : "Off. When this device’s queue ends, it stops.") + "</div></div><div class=\"settings-divider\"></div>";
  }
  // A phone others at home may play to (v0.5.51).
  if (d.kind === "phone" && d.shared !== undefined) {
    html += '<div class="settings-block"><div class="settings-row"><span class="settings-label"' + ' data-parity="settings-device.name"' + '>Other devices can play here' + settingsInfo("At home, your other devices list this phone as a player while the Mandarin app is running on it, and can play to it and change its volume. Away from home it plays for itself only.", "settings-device.info") + "</span>" +
      '<label class="switch"' + ' data-parity="settings-device.shared"' + '><input type="checkbox" data-dev-shared="' + esc(d.id) + '"' + (d.shared ? " checked" : "") + ' aria-label="Other devices can play here">' +
      '<span class="switch-track"><span class="switch-thumb"></span></span></label></div>' +
      '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>' + (d.shared
        ? "On. Your other devices at home can play here."
        : "Off. Only this phone plays to itself.") + "</div></div><div class=\"settings-divider\"></div>";
  }
  html += '<div class="settings-block"><div class="settings-block-title"' + ' data-parity="settings-device.title"' + '>Name</div>';
  if (d.kind === "phone") {
    html += '<div class="dev-kv"' + ' data-parity="settings-device.kv"' + '><span class="dev-v">' + esc(d.network_name) + '</span></div><div class="settings-note"' + ' data-parity="settings-device.note"' + '>Named in the app on the phone.</div>';
  } else {
    html += '<input class="dev-name-input"' + ' data-parity="settings-device.rename"' + ' type="text" maxlength="60" value="' + esc(draft != null ? draft : d.name) + '" aria-label="Name" autocomplete="off" autocapitalize="words">' +
      '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>On the network: ' + esc(d.network_name) +
      (d.renamed ? ' · <button type="button" class="dev-link"' + ' data-parity="settings-device.reset"' + ' data-dev-reset>Use the network name</button>' : "") +
      (d.kind === "sonos" ? " · A name for Mandarin only; the Sonos app keeps its own." : "") + "</div>";
  }
  html += "</div>";

  const rows = [["Model", d.model], ["Made by", d.manufacturer], ["Firmware", d.firmware], ["Address", d.ip],
    ["Device", d.kind === "local" ? d.location : ""],
    ["Found by", d.found_by], ["Standard", d.kind === "upnp" ? (d.openhome ? "UPnP AV + OpenHome" : "UPnP AV / DLNA") : ""],
    ["Updates", d.kind === "upnp" && d.playable ? (d.events === "live" ? "Sent by the device (events)" : "Read every few seconds") : ""],
    ["Last seen", d.online ? "Now" : fmtWhen(d.last_seen)], ["First seen", fmtWhen(d.first_seen)]].filter(r => r[1]);
  html += '<div class="settings-divider"></div><div class="settings-block"><div class="settings-block-title"' + ' data-parity="settings-device.title"' + '>About</div><div class="dev-about">' +
    rows.map(r => '<div class="dev-kv"' + ' data-parity="settings-device.kv"' + '><span class="dev-k">' + esc(r[0]) + '</span><span class="dev-v">' + esc(r[1]) + "</span></div>").join("") + "</div>";
  if (d.kind === "upnp" && !d.playable) html += '<div class="settings-note away-error"' + ' data-parity="settings-device.note"' + '>This device offers no AVTransport service, so it cannot be played to.</div>';
  else if (d.kind === "upnp" && d.takes_flac === false) html += '<div class="settings-note away-error"' + ' data-parity="settings-device.note"' + '>This device doesn’t take FLAC, which is how Mandarin sends audio for now, so it isn’t offered as a zone yet.</div>';
  if (d.last_error && d.last_error.message) html += '<div class="settings-note away-error"' + ' data-parity="settings-device.note"' + '>Last trouble (' + esc(fmtWhen(d.last_error.at)) + '): ' + esc(d.last_error.message) + "</div>";
  html += "</div>";

  html += '<div class="settings-divider"></div><div class="settings-block"><div class="settings-block-title"' + ' data-parity="settings-device.title"' + '>Capabilities</div>';
  html += '<div class="cap-group"><span class="cap-label"' + ' data-parity="settings-device.cap-label"' + '>Sample rates (kHz)</span><div class="cap-chips">' +
    d.rates.map(r => chip("rate", r.hz, fmtRate(r.hz), r.on, r.source, ed)).join("") + "</div></div>";
  html += '<div class="cap-group"><span class="cap-label"' + ' data-parity="settings-device.cap-label"' + '>Bit depth</span><div class="cap-chips">' +
    d.bits.map(b => chip("bits", b.n, b.n + "-bit", b.on, b.source, ed)).join("") + "</div></div>";
  // DSD (v0.6.0-RC3): sent as the file itself where the device says it takes
  // DSD files; tap one off and that multiple goes as PCM.
  const takesDsd = (d.containers || []).includes("dsd");
  html += '<div class="cap-group"><span class="cap-label"' + ' data-parity="settings-device.cap-label"' + '>DSD</span><div class="cap-chips">' +
    d.dsd.map(x => chip("dsd", x.n, "DSD" + x.n, x.on, x.source, ed && takesDsd)).join("") + "</div></div>";
  if (d.containers && d.containers.length) {
    html += '<div class="cap-group"><span class="cap-label"' + ' data-parity="settings-device.cap-label"' + '>Formats</span><div class="dev-v"' + ' data-parity="settings-device.value"' + '>' + esc(d.containers.map(c => c.toUpperCase()).join(", ")) + "</div></div>";
  }
  html += '<div class="cap-legend"' + ' data-parity="settings-device.legend"' + '>' + (ed ? "Tap a rate or depth to change what Mandarin may send it. " : "") + "✓ confirmed by the device · ◆ known for this model · ✎ you set it.</div>";
  if (d.kind === "upnp") html += '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>' + (takesDsd
    ? "DSD files go to it as they are, at the DSD rates that are on; any other goes as PCM. If DSD doesn’t play, tap it off."
    : "It doesn’t say it takes DSD files, so DSD goes to it as PCM.") + "</div>";
  if (d.kind === "sonos") html += '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>Sonos plays up to 24-bit/48 kHz. Mandarin’s 24/48 rule applies; nothing to set here.</div>';
  if (d.kind === "phone") html += '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>At home the phone plays the file as it is; away from home, Opus 256 kbps.</div>';
  if (d.kind === "local") html += '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>Mandarin sends the rates that are on; ALSA converts its 32-bit samples to the depth the device takes. DSD goes as PCM.</div>';
  if (d.profile && d.profile.notes) html += '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>' + esc(d.profile.notes) + "</div>";
  html += "</div>";

  if (d.kind === "upnp" || d.kind === "local") {
    const o = d.output || { mode: "original", bits: "auto", flac32: false };
    const seg = (name, opts, cur) => '<div class="seg" data-seg="' + name + '">' + opts.map(x =>
      '<button type="button"' + (name === "mode" ? ' data-parity="settings-device.mode"' : ' data-parity="settings-device.depth"') + ' class="seg-btn' + (String(x.v) === String(cur) ? " is-on" : "") + '" data-seg-v="' + x.v + '"' + (x.off ? " disabled" : "") + ">" + esc(x.label) + "</button>").join("") + "</div>";
    const has32 = d.bits.some(b => b.n === 32 && b.on);
    const topOf = fam => { const on = d.rates.filter(r => r.on && (fam === 44100 ? r.hz % 44100 === 0 : r.hz % 44100 !== 0)).map(r => r.hz); return on.length ? Math.max(...on) : 0; };
    const outBits = (has32 && o.flac32 && o.bits !== 24) ? 32 : 24;
    const example = (() => {
      const top = topOf(44100);
      let rate = 44100;
      if (o.mode === "x2") rate = Math.min(88200, top || 44100); else if (o.mode === "x4") rate = Math.min(176400, top || 44100); else if (o.mode === "max") rate = top || 44100;
      if (o.mode === "original" || rate <= 44100) return "A 16-bit/44.1 kHz file plays as it is.";
      return "A 16-bit/44.1 kHz file plays as " + outBits + "-bit/" + (rate / 1000) + " kHz FLAC" + (rate === 176400 ? " (×4)" : rate === 88200 ? " (×2)" : "") + ".";
    })();
    html += '<div class="settings-divider"></div><div class="settings-block"><div class="settings-block-title"' + ' data-parity="settings-device.title"' + '>Output' + settingsInfo("Original sends the file as stored wherever this device takes its rate, depth and format; above its ceiling, FLAC at the highest rate it takes. Upsampling stays in the file's family (44.1 → 88.2 → 176.4; 48 → 96 → 192), runs in 64-bit float, and goes out at " + (has32 && o.flac32 ? "24 or 32 bits" : "24 bits") + ".", "settings-device.info") + "</div>" +
      '<div class="cap-group"><span class="cap-label"' + ' data-parity="settings-device.cap-label"' + '>Mode</span>' +
      seg("mode", [{ v: "original", label: "Original" }, { v: "x2", label: "×2" }, { v: "x4", label: "×4" }, { v: "max", label: "Max" }], o.mode) + "</div>" +
      (has32 ? '<div class="cap-group"><span class="cap-label"' + ' data-parity="settings-device.cap-label"' + '>Bit depth</span>' +
        seg("bits", [{ v: "auto", label: "Auto" }, { v: 24, label: "24" }, { v: 32, label: "32", off: !o.flac32 }], o.bits) +
        "" +
        (!o.flac32 ? '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>32-bit needs an ffmpeg that writes 32-bit FLAC; this one stops at 24.</div>' : "") + "</div>" : "") +
      '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>' + esc(example) + "</div>" +
      (d.can_fix_volume ? '<div class="settings-row" style="margin-top:14px"><span class="settings-label"' + ' data-parity="settings-device.name"' + '>Fixed volume</span>' +
        '<label class="switch"' + ' data-parity="settings-device.fixvol"' + '><input type="checkbox" data-dev-fixvol' + (d.volume_fixed ? " checked" : "") + ' aria-label="Fixed volume">' +
        '<span class="switch-track"><span class="switch-thumb"></span></span></label></div>' +
        '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>' + (d.kind === "local" ? (d.volume_fixed
          ? "The audio goes to the device at full level, untouched; set the volume on the DAC or amplifier. Mandarin shows no slider for it."
          : "Mandarin’s slider and mute scale the audio before it reaches the device; at 100% it is untouched. Turn on to set the volume on the DAC or amplifier instead.")
          : d.volume_fixed
          ? "The volume is set on the device itself (its knob, or its line out on fixed), so Mandarin shows no slider for it."
          : "Mandarin’s slider and mute drive the device. Turn on if the device’s volume is fixed — a WiiM on fixed line out, a Poly feeding a Mojo.") + "</div>" : "") +
      "</div>";
  }
  if (d.levelling) html += renderLevelling(d);
  if ((d.kind === "upnp" || d.kind === "local" || d.kind === "phone") && d.dsp) html += renderDsp(d);
  if (d.kind === "phone" && isThisPhone(d)) html += renderUsb();
  if (!d.online) {
    html += '<div class="settings-divider"></div><div class="settings-block"><div class="settings-row"><span class="settings-label"' + ' data-parity="settings-device.name"' + '>' + (d.kind === "local" ? "Not connected" : "Not on the network") + '</span>' +
      '<button type="button" class="settings-update-btn"' + ' data-parity="settings-device.forget"' + ' data-dev-forget' + (busy ? " disabled" : "") + ">Forget this device</button></div>" +
      '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>Its name and settings go. If it turns up again it starts afresh.</div></div>';
  }
  if (err) html += '<div class="settings-note away-error"' + ' data-parity="settings-device.note"' + '>' + esc(err) + "</div>";
  body.innerHTML = html;
  drawDsp();
}
