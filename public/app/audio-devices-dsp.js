/* Settings → Audio Devices (app/audio-devices.js), 3 of 3: DSP, headphones, and the pane kept current. */
/*
 * Headphones: an AutoEq profile (searched on the server, which fetches
 * and keeps it) or one pasted from a ParametricEQ.txt. The profile's
 * bands run before the PEQ's; they are shown, not edited.
 */
function renderHeadphones(dr) {
  const hp = dr.headphone;
  const ui = dr.hp || null;
  let html = '<div class="cap-group" data-hp-group><span class="cap-label"' + ' data-parity="settings-device.cap-label"' + '>Headphones</span>';
  if (hp) {
    html += '<div class="hp-current"><div class="hp-name"' + ' data-parity="settings-device.hp-name"' + ">" + esc(hp.name || "Profile") + '</div><div class="hp-sub"' + ' data-parity="settings-device.hp-sub"' + ">" +
      esc((hp.source === "autoeq" ? "AutoEq · " : "") + hp.bands.length + " band" + (hp.bands.length === 1 ? "" : "s") + (typeof hp.preamp === "number" ? " · preamp " + fmtDb(hp.preamp) : "")) + "</div></div>";
  } else if (!ui) {
    html += '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>None. A profile from AutoEq corrects a headphone’s measured response; pick yours, or paste one you have.</div>';
  }
  if (!ui) {
    html += '<div class="hp-actions"><button type="button" class="settings-update-btn"' + ' data-parity="settings-device.hp-choose"' + ' data-hp-choose>' + (hp ? "Change…" : "Choose from AutoEq…") + '</button>' +
      '<button type="button" class="settings-update-btn"' + ' data-parity="settings-device.hp-paste"' + ' data-hp-paste>Paste a profile…</button>' +
      (hp ? '<button type="button" class="settings-update-btn"' + ' data-parity="settings-device.hp-remove"' + ' data-hp-remove>Remove</button>' : "") + "</div>";
  } else if (ui.mode === "search") {
    html += '<div class="hp-search"><input type="search" class="dev-name-input"' + ' data-parity="settings-device.hp-search"' + ' aria-label="Headphone name" data-hp-q placeholder="Headphone name — HD 650, Aria, AirPods…" value="' + esc(ui.q || "") + '" autocomplete="off" autocapitalize="off">' +
      '<div class="hp-results" data-hp-results>' + renderHpResults(ui) + "</div>" +
      '<div class="hp-actions"><button type="button" class="settings-update-btn"' + ' data-parity="settings-device.hp-cancel"' + ' data-hp-cancel>Cancel</button></div></div>';
  } else if (ui.mode === "paste") {
    html += '<div class="hp-paste"><input type="text" class="dev-name-input"' + ' data-parity="settings-device.hp-label"' + ' aria-label="A name for it" data-hp-name placeholder="A name for it" maxlength="120" value="' + esc(ui.name || "") + '">' +
      '<textarea class="hp-text"' + ' data-parity="settings-device.hp-text"' + ' aria-label="The profile" data-hp-text rows="6" placeholder="Preamp: -6.1 dB&#10;Filter 1: ON LSC Fc 105 Hz Gain 6.4 dB Q 0.70&#10;Filter 2: ON PK Fc 8800 Hz Gain 5.1 dB Q 1.42">' + esc(ui.text || "") + "</textarea>" +
      (ui.error ? '<div class="settings-note away-error"' + ' data-parity="settings-device.note"' + '>' + esc(ui.error) + "</div>" : "") +
      '<div class="hp-actions"><button type="button" class="action-btn primary"' + ' data-parity="settings-device.hp-use"' + ' data-hp-use>Use it</button><button type="button" class="settings-update-btn"' + ' data-parity="settings-device.hp-cancel"' + ' data-hp-cancel>Cancel</button></div></div>';
  }
  html += "</div>";
  return html;
}
function renderHpResults(ui) {
  if (ui.busy) return '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>Looking…</div>';
  if (ui.error) return '<div class="settings-note away-error"' + ' data-parity="settings-device.note"' + '>' + esc(ui.error) + "</div>";
  if (!ui.q || ui.q.trim().length < 2) return '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>Type a name. AutoEq has profiles for most headphones and earphones that have been measured.</div>';
  if (!ui.results || !ui.results.length) return '<div class="settings-note"' + ' data-parity="settings-device.note"' + '>Nothing by that name. Try fewer words, or paste a profile.</div>';
  return ui.results.map(r => '<button type="button" class="hp-row"' + ' data-parity="settings-device.hp-result"' + ' aria-label="' + esc(r.name) + '" data-hp-pick="' + esc(r.id) + '"><span class="hp-row-name">' + esc(r.name) + '</span><span class="hp-row-sub">' + esc([r.source, r.rig, r.form].filter(Boolean).join(" · ")) + "</span></button>").join("");
}
let hpTimer = null;
async function hpSearch(dr) {
  const ui = dr.hp; if (!ui) return;
  const q = (ui.q || "").trim();
  if (q.length < 2) { ui.results = []; ui.busy = false; paintHpResults(dr); return; }
  ui.busy = true; paintHpResults(dr);
  try { const j = await api("/api/dsp/headphones?q=" + encodeURIComponent(q)); if (dr.hp === ui && ui.q.trim() === q) { ui.results = j.results || []; ui.error = ""; } }
  catch (e) { if (dr.hp === ui) ui.error = e.message; }
  ui.busy = false; paintHpResults(dr);
}
function paintHpResults(dr) { const el = body.querySelector("[data-hp-results]"); if (el && dr.hp) el.innerHTML = renderHpResults(dr.hp); }
async function hpPick(dr, id) {
  const ui = dr.hp; if (!ui) return;
  ui.busy = true; paintHpResults(dr);
  try {
    const j = await api("/api/dsp/headphones/profile?id=" + encodeURIComponent(id));
    dr.headphone = j.profile; dr.hp = null; dr.dirty = true;
    renderDetail();
    deviceToast(j.profile.name + " — Save to use it");
  } catch (e) { ui.busy = false; ui.error = e.message; paintHpResults(dr); }
}
async function hpUse(dr) {
  const ui = dr.hp; if (!ui) return;
  try {
    const j = await api("/api/dsp/headphones/parse", "POST", { name: ui.name || "", text: ui.text || "" });
    dr.headphone = j.profile; dr.hp = null; dr.dirty = true;
    renderDetail();
  } catch (e) { ui.error = e.message; renderDetail(); }
}
function drawDsp() {
  const c = body.querySelector("[data-dsp-curve]");
  const B = window.Biquad;
  if (!c || !B || !current) return;
  const dr = dspOf(current);
  const cssW = c.clientWidth || 320, cssH = 150, dpr = window.devicePixelRatio || 1;
  c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);
  const cs = getComputedStyle(document.documentElement);
  const col = n => cs.getPropertyValue(n).trim();
  const padL = 30, padR = 8, padT = 8, padB = 18;
  const W = cssW - padL - padR, H = cssH - padT - padB;
  const fx = f => padL + W * (Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20));
  const freqs = [];
  for (let i = 0; i <= 240; i++) freqs.push(Math.pow(10, Math.log10(20) + (Math.log10(20000) - Math.log10(20)) * i / 240));
  const r = B.response(allBands(dr), 48000, freqs);
  const pre = B.headroom(dspSetting(dr, true), 48000);
  const top = Math.max(6, Math.ceil(Math.max(...r.map(Math.abs), Math.abs(pre)) / 3) * 3);
  const fy = db => padT + H * (top - db) / (2 * top);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.font = "10px " + (col("--font-sans") || "sans-serif");
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.strokeStyle = col("--border") || "#444"; ctx.fillStyle = col("--text-faint") || "#888"; ctx.lineWidth = 1;
  for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
    const x = Math.round(fx(f)) + 0.5;
    ctx.globalAlpha = [100, 1000, 10000].includes(f) ? 1 : .45;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + H); ctx.stroke();
    ctx.globalAlpha = 1;
    if ([20, 100, 1000, 10000, 20000].includes(f)) ctx.fillText(f >= 1000 ? (f / 1000) + "k" : String(f), x, padT + H + 4);
  }
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (const db of [top, top / 2, 0, -top / 2, -top]) {
    const y = Math.round(fy(db)) + 0.5;
    ctx.globalAlpha = db === 0 ? 1 : .45;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + W, y); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText((db > 0 ? "+" : "") + db, padL - 4, y);
  }
  // The bands' response, and — dashed — the same with the headroom taken.
  const line = (dbs, colour, dash) => {
    ctx.beginPath();
    dbs.forEach((db, i) => { const x = fx(freqs[i]), y = fy(db); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.setLineDash(dash || []); ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
  };
  if (pre < 0) line(r.map(db => db + pre), col("--plum") || "#8b6fb0", [4, 4]);
  line(r, col("--accent") || "#c9a45c");
}
function bumpDsp() {
  const dr = dspOf(current);
  dr.dirty = true;
  const note = body.querySelector("[data-dsp-headroom-note]");
  const B = window.Biquad;
  if (note && B) note.textContent = headroomNote(dr, B.peakDb(allBands(dr), 48000), autoHeadroom(dr));
  const dirty = body.querySelector("[data-dsp-dirty]"); if (dirty) dirty.textContent = "Not saved yet";
  const save = body.querySelector("[data-dsp-save]"); if (save) save.disabled = false;
  drawDsp();
}
async function saveDsp(enabled) {
  const dr = dspOf(current);
  const on = enabled === undefined ? !!current.dsp.enabled : enabled;
  await patch({ dsp: dspSetting(dr, on) });
  if (!err) { dspDraft = null; deviceToast(on ? (current.kind === "phone" ? "DSP saved — the phone has it" : "DSP saved — on from the next track") : "DSP is off"); }
  renderDetail();
}

async function openDevice(id) {
  dspDraft = null;
  try { current = await api("/api/audio-devices/" + encodeURIComponent(id)); err = ""; }
  catch (e) { err = e.message; return renderList(); }
  renderDetail();
  if (window.__settingsShowView) window.__settingsShowView("device");
}
async function patch(payload) {
  if (!current) return;
  busy = true;
  try { current = await api("/api/audio-devices/" + encodeURIComponent(current.id), "PATCH", payload); err = ""; }
  catch (e) { err = e.message; }
  busy = false;
  renderDetail();
  load();
}
function toggleChip(el) {
  const kind = el.getAttribute("data-cap"), v = Number(el.getAttribute("data-v"));
  if (kind === "dsd") {
    // All off is allowed: DSD then goes as PCM.
    const on = current.dsd.filter(x => x.n === v ? !x.on : x.on).map(x => x.n);
    patch({ caps: { user: { dsd: on } } });
    return;
  }
  if (kind !== "rate" && kind !== "bits") return;
  const all = kind === "rate" ? current.rates.map(r => ({ v: r.hz, on: r.on })) : current.bits.map(b => ({ v: b.n, on: b.on }));
  const on = all.filter(x => x.v === v ? !x.on : x.on).map(x => x.v);
  if (!on.length) { deviceToast("Leave at least one on", "error"); return; }
  patch({ caps: { user: { [kind === "rate" ? "rates" : "bits"]: on } } });
}

list.addEventListener("click", (e) => {
  const b = e.target.closest("[data-dev]");
  if (b) openDevice(b.getAttribute("data-dev"));
});
// The switch on a row, or on the device's page: on or off, kept on the server.
async function setEnabled(id, on, input) {
  if (busy) { input.checked = !on; return; }
  busy = true;
  try {
    const d = await api("/api/audio-devices/" + encodeURIComponent(id), "PATCH", { enabled: on });
    if (current && current.id === id) current = d;
    err = "";
    deviceToast(on ? d.name + " is on — it’s in the zone picker now" : d.name + " is off");
  } catch (x) { err = x.message; input.checked = !on; }
  busy = false;
  if (current) renderDetail();
  load();
}
list.addEventListener("change", (e) => {
  const inp = e.target.closest("[data-dev-enable]");
  if (inp) setEnabled(inp.getAttribute("data-dev-enable"), inp.checked, inp);
});
if (hideBtn) {
  hideBtn.addEventListener("click", () => {
    if (!hideMode) { hideMode = true; picks = new Set(); renderList(); return; }
    applyHide();
  });
}
list.addEventListener("click", (e) => {
  const b = e.target.closest("[data-pick]");
  if (!b || !hideMode) return;
  const id = b.getAttribute("data-pick");
  if (picks.has(id)) picks.delete(id); else picks.add(id);
  renderList();
});
if (rescan) {
  rescan.addEventListener("click", async () => {
    rescan.disabled = true; rescan.textContent = "Looking…";
    try { const j = await api("/api/audio-devices/rescan", "POST", {}); devices = j.devices || []; local = j.local || local; err = ""; }
    catch (e) { err = e.message; }
    rescan.disabled = false; rescan.textContent = "Look again";
    renderList();
  });
}
body.addEventListener("click", async (e) => {
  if (!current || busy) return;
  const c = e.target.closest("button.cap-chip");
  if (c) return toggleChip(c);
  const sb = e.target.closest(".seg-btn");
  if (sb && !sb.disabled) {
    const name = sb.closest(".seg").getAttribute("data-seg");
    const raw = sb.getAttribute("data-seg-v");
    const v = name === "bits" && raw !== "auto" ? Number(raw) : raw;
    return patch({ output: { [name]: v } });
  }
  const add = e.target.closest("[data-dsp-add]");
  if (add) { const dr = dspOf(current); if (dr.bands.length < 10) { dr.bands.push({ type: "peak", freq: 1000, gain: 0, q: 1.41 }); dr.dirty = true; renderDetail(); } return; }
  const rm = e.target.closest("[data-dsp-remove]");
  if (rm) { const dr = dspOf(current); dr.bands.splice(Number(rm.getAttribute("data-dsp-remove")), 1); dr.dirty = true; renderDetail(); return; }
  const hr = e.target.closest("[data-dsp-headroom]");
  if (hr) {
    const dr = dspOf(current);
    dr.headroom = hr.getAttribute("data-dsp-headroom") === "auto" ? "auto" : autoHeadroom(dr);
    dr.dirty = true; renderDetail(); return;
  }
  if (e.target.closest("[data-dsp-save]")) return saveDsp();
  if (e.target.closest("[data-hp-choose]")) { const dr = dspOf(current); dr.hp = { mode: "search", q: "", results: [] }; renderDetail(); const q = body.querySelector("[data-hp-q]"); if (q) q.focus(); return; }
  if (e.target.closest("[data-hp-paste]")) { const dr = dspOf(current); dr.hp = { mode: "paste", name: "", text: "" }; renderDetail(); return; }
  if (e.target.closest("[data-hp-cancel]")) { const dr = dspOf(current); dr.hp = null; renderDetail(); return; }
  if (e.target.closest("[data-hp-remove]")) { const dr = dspOf(current); dr.headphone = null; dr.dirty = true; renderDetail(); return; }
  const pick = e.target.closest("[data-hp-pick]");
  if (pick) return hpPick(dspOf(current), pick.getAttribute("data-hp-pick"));
  if (e.target.closest("[data-hp-use]")) return hpUse(dspOf(current));
  if (e.target.closest("[data-dev-reset]")) { await patch({ name: "" }); return deviceToast("Back to its network name"); }
  if (e.target.closest("[data-usb-allow]")) { try { usbApp.request(); } catch (x) { deviceToast(x.message, "error"); } return; }
  if (e.target.closest("[data-usb-copy]")) {
    try { await navigator.clipboard.writeText(usbApp.diagnostics()); deviceToast("Copied — paste it into a report"); }
    catch (x) { deviceToast("Couldn't copy: " + x.message, "error"); }
    return;
  }
  if (e.target.closest("[data-dev-forget]")) {
    if (!(await ask("Forget “" + current.name + "”?\n\nIts name and settings go. If it turns up again it starts afresh."))) return;
    busy = true;
    try { await api("/api/audio-devices/" + encodeURIComponent(current.id) + "/forget", "POST", {}); current = null; err = ""; deviceToast("Forgotten"); }
    catch (x) { err = x.message; }
    busy = false;
    if (!current) { await load(); if (window.__settingsShowView) window.__settingsShowView("playback"); }
    else renderDetail();
  }
});
body.addEventListener("change", async (e) => {
  const sw = e.target.closest("[data-dev-enable]");
  if (sw) return setEnabled(sw.getAttribute("data-dev-enable"), sw.checked, sw);
  const fv = e.target.closest("[data-dev-fixvol]");
  if (fv) return patch({ output: { volume: fv.checked ? "fixed" : "upnp" } });
  const ud = e.target.closest("[data-usb-direct]");
  if (ud) { try { usbApp.setDirect(ud.checked); } catch (x) { deviceToast(x.message, "error"); } return; }
  const uf = e.target.closest("[data-usb-fixed]");
  if (uf) { try { usbApp.setFixed(uf.checked); renderDetail(true); } catch (x) { deviceToast(x.message, "error"); } return; }
  const ul = e.target.closest("[data-usb-limit]");
  if (ul) { try { usbApp.setLimit(Number(ul.value)); renderDetail(true); } catch (x) { deviceToast(x.message, "error"); } return; }
  const udsd = e.target.closest("[data-usb-dsd]");
  if (udsd) { try { usbApp.setDsdMode(udsd.value); renderDetail(true); } catch (x) { deviceToast(x.message, "error"); } return; }
  const dspOn = e.target.closest("[data-dsp-on]");
  if (dspOn) return saveDsp(dspOn.checked);
  const lv = e.target.closest("select[data-lv]");
  if (lv) {
    const key = lv.getAttribute("data-lv");
    await patch({ levelling: { [key]: key === "mode" ? lv.value : Number(lv.value) } });
    if (!err && key === "mode") deviceToast("Volume levelling: " + (LV_MODES.find(m => m[0] === lv.value) || [null, ""])[1]);
    return;
  }
  const bandType = e.target.closest("select[data-dsp-f='type']");
  if (bandType) {
    const dr = dspOf(current);
    const b = dr.bands[Number(bandType.closest("[data-dsp-band]").getAttribute("data-dsp-band"))];
    if (b) { b.type = bandType.value; if (isPass(b.type)) b.gain = 0; dr.dirty = true; renderDetail(); }
    return;
  }
  const sh = e.target.closest("[data-dev-shared]");
  if (sh) {
    const on = sh.checked;
    await patch({ shared: on });
    if (!err) deviceToast(on ? "Your other devices can play to " + current.name : "Only " + current.name + " plays to itself now");
    return;
  }
  const rd = e.target.closest("[data-dev-radio]");
  if (rd) {
    const on = rd.checked;
    await patch({ radio: on });
    if (!err) deviceToast(on ? "Random album radio is on for " + current.name : "Random album radio is off for " + current.name);
    return;
  }
  const inp = e.target.closest(".dev-name-input");
  if (inp && current && inp.value.trim() !== current.name) patch({ name: inp.value.trim() });
});
body.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.closest(".dev-name-input")) e.target.blur();
});
// A band's numbers as they are typed: the curve and the headroom follow.
body.addEventListener("input", (e) => {
  if (!current) return;
  const ul = e.target.closest("[data-usb-limit]");
  if (ul) { const v = body.querySelector("[data-usb-limit-value]"); if (v) v.textContent = ul.value + "%"; return; }
  const hq = e.target.closest("[data-hp-q]");
  if (hq) { const dr = dspOf(current); if (dr.hp) { dr.hp.q = hq.value; clearTimeout(hpTimer); hpTimer = setTimeout(() => hpSearch(dr), 250); } return; }
  const hn = e.target.closest("[data-hp-name]"); if (hn) { const dr = dspOf(current); if (dr.hp) dr.hp.name = hn.value; return; }
  const ht = e.target.closest("[data-hp-text]"); if (ht) { const dr = dspOf(current); if (dr.hp) dr.hp.text = ht.value; return; }
  const inp = e.target.closest("input[data-dsp-f]");
  if (!inp) return;
  const dr = dspOf(current);
  const v = Number(inp.value);
  if (!Number.isFinite(v)) return;
  const f = inp.getAttribute("data-dsp-f");
  if (f === "headroom") { dr.headroom = Math.min(0, Math.max(-30, v)); return bumpDsp(); }
  const row = inp.closest("[data-dsp-band]");
  const b = row && dr.bands[Number(row.getAttribute("data-dsp-band"))];
  if (!b) return;
  if (f === "freq") b.freq = Math.min(24000, Math.max(10, v));
  else if (f === "gain") b.gain = Math.min(20, Math.max(-20, v));
  else if (f === "q") b.q = Math.min(20, Math.max(0.1, v));
  bumpDsp();
});
window.addEventListener("resize", () => { if (current && body.querySelector("[data-dsp-curve]")) drawDsp(); });
navItem.addEventListener("click", () => { current = null; load(); });
// Rows and states follow the network while either pane is open.
setInterval(() => {
  if (busy) return;
  if (!pane.classList.contains("hidden") || !detail.classList.contains("hidden")) load();
}, 10000);
