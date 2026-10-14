/* The mini transport (app/mini-transport.js), 5 of 5: the room picker, the volume buttons, and the long-poll for what is playing. */
// Zone picker on the bar (Roon-style speaker button)
async function renderBarZoneList() {
  if (!zoneList) return;
  let list = [];
  try {
    const r = await fetch("/api/zones", { cache: "no-store" });
    if (r.ok) { const j = await r.json(); if (Array.isArray(j.zones)) list = j.zones; }
  } catch (e) { /* zone list is non-critical; picker shows "No zones available" */ }
  zoneList.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "np-device-empty";
    empty.textContent = "No zones available";
    zoneList.appendChild(empty);
    return;
  }
  const sel = document.getElementById("zone-select");
  const cur = sel && sel.value;
  for (const z of list) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "np-device-item" + (z.zone_id === cur ? " is-current" : "");
    if (window.__fillZoneRow) window.__fillZoneRow(item, z);
    else item.textContent = z.display_name;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      zonePop.classList.add("hidden");
      btnZone.setAttribute("aria-expanded", "false");
      if (!sel || z.zone_id === cur) return;
      sel.value = z.zone_id;
      sel.dispatchEvent(new Event("change"));   // reuse the existing switch flow
    });
    zoneList.appendChild(item);
  }
}
if (btnZone && zonePop) {
  btnZone.addEventListener("click", async (e) => {
    e.stopPropagation();
    volPop.classList.add("hidden");
    btnVol.setAttribute("aria-expanded", "false");
    const willShow = zonePop.classList.contains("hidden");
    if (willShow) await renderBarZoneList();
    zonePop.classList.toggle("hidden", !willShow);
    btnZone.setAttribute("aria-expanded", String(willShow));
  });
  document.addEventListener("click", (e) => {
    if (zonePop.classList.contains("hidden")) return;
    if (zonePop.contains(e.target) || btnZone.contains(e.target)) return;
    zonePop.classList.add("hidden");
    btnZone.setAttribute("aria-expanded", "false");
  });
  const popoverAction = (id, open) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      zonePop.classList.add("hidden");
      btnZone.setAttribute("aria-expanded", "false");
      const fn = window[open];
      if (fn) fn();
    });
  };
  popoverAction("mt-group-open", "__openGroupSheet");
  popoverAction("mt-power-open", "__openDevicePowerSheet");
  // Same three all-zone actions as the now-playing picker, same source.
  for (const act of ["pause-all", "mute-all", "unmute-all"]) {
    const b = document.getElementById("mt-" + act);
    if (!b) continue;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      zonePop.classList.add("hidden");
      btnZone.setAttribute("aria-expanded", "false");
      const fn = window.__allZoneActions && window.__allZoneActions[act];
      if (fn) fn();
    });
  }
}

// Tap the info area (art + text) to open the now-playing album in the modal
const infoArea = bar.querySelector(".mt-info");
infoArea.addEventListener("click", () => {
  if (!currentZone || !currentZone.now_playing) return;
  if (typeof window.__openAlbum !== "function") return;
  const np = currentZone.now_playing;
  window.__openAlbum({
    title:     np.line3 || np.line1 || "",
    subtitle:  np.line2 || "",
    image_key: np.image_key
  }, { source: "now-playing", zoneId: currentZone.zone_id });
});

// Volume +/- buttons (shared by the mini-bar sheet and the NP sheet)
const stepMinus   = document.getElementById("mt-vol-minus");
const stepPlus    = document.getElementById("mt-vol-plus");
const npStepMinus = document.getElementById("np-vol-minus");
const npStepPlus  = document.getElementById("np-vol-plus");
async function stepVolume(delta) {
  const vo = currentVolOutput();   // read-time — never a stale mirror
  if (!vo) return;
  if ((vo.volume.type || null) === "incremental") {
    // Relative-only output: no absolute scale exists — send a nudge.
    try {
      await fetch("/api/volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone_or_output_id: currentZone.zone_id, relative: delta > 0 ? 1 : -1 })
      });
    } catch (e) { /* best-effort, like setVolume */ }
    return;
  }
  // Safe to step from the painted value: volumeHeld() keeps a stale poll from
  // reverting it, so what is on screen IS what we last sent. Without that hold
  // this read is what silently lost taps — the display having gone back to 50,
  // a second + recomputed 51 and re-sent a value already sent.
  const cur = parseFloat(volSlider.value);
  // Range and step come from the output itself, not from the slider's
  // attributes. Those attributes are only a mirror written by renderZone, and
  // reading state back out of a mirror is the exact thing currentVolOutput()
  // exists to avoid.
  const vol = vo.volume;
  const min = vol.min != null ? vol.min : 0;
  // The zone's own step, not a hardcoded 2: Roon `number` volumes step by 1,
  // dB outputs commonly by 0.5, so a fixed 2 moved two or four positions.
  // `delta * stepSz` rather than sign(delta), so a caller can still ask for a
  // multi-step nudge later without rewriting this.
  const stepSz = vol.step != null ? vol.step : 1;
  const next = Math.max(min, Math.min(volCeiling(vol), cur + delta * stepSz));
  syncVolumeUI(next);
  setVolume(next);
}
if (stepMinus)   stepMinus  .addEventListener("click", (e) => { e.stopPropagation(); stepVolume(-1); });
if (stepPlus)    stepPlus   .addEventListener("click", (e) => { e.stopPropagation(); stepVolume(+1); });
if (npStepMinus) npStepMinus.addEventListener("click", (e) => { e.stopPropagation(); stepVolume(-1); });
if (npStepPlus)  npStepPlus .addEventListener("click", (e) => { e.stopPropagation(); stepVolume(+1); });

// Long-poll (v0.6.10): rather than asking every 1.5s, ask the server to
// answer when something changes (wait_for = the last revision seen) or after
// 10s regardless. Between answers the bar's clock moves the progress, and
// the server bumps the revision on a seek or a drift of more than 3s, so the
// screen is as current as before for a fraction of the requests — the phone's
// radio and CPU idle instead of waking forty times a minute. 10s, not longer:
// each ask also keeps the room "watched" (polled fast on the server), which
// lapses after 15s. pollTimer holds the loop's AbortController.
async function pollLoop(ctl) {
  let fails = 0;
  while (pollTimer === ctl) {
    const zid = barZoneId();
    if (!zid) { renderZone(null); await new Promise(r => setTimeout(r, 1500)); continue; }
    const since = zid === stateZone && stateRev >= 0 ? stateRev : -1;
    const wait = since >= 0 ? "&wait_for=" + since + "&timeout=10000" : "";
    // A connection that has silently died (the phone left its Wi-Fi with
    // mobile data up: the relayed socket to the home address hangs rather
    // than fails) would hold this ask for minutes and the bar with it
    // (v0.7.2). The server answers within 10 s; 25 s and it is given up.
    const one = new AbortController();
    const onCtl = () => one.abort();
    ctl.signal.addEventListener("abort", onCtl, { once: true });
    const timer = setTimeout(() => one.abort(), 25000);
    try {
      const r = await fetch("/api/zone-state?zone=" + encodeURIComponent(zid) + wait, { cache: "no-store", signal: one.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (pollTimer !== ctl) return;
      // A counter below the one waited on (v0.8.46): the server started
      // again since (an update, a restore), or the app's own copy answered
      // while the server couldn't be reached. Its counter is the one now.
      // Before, every answer was taken for an old one and dropped, and the
      // screen kept the track from before the restart while what was
      // tapped played, until the app was closed and opened again.
      if (since >= 0 && zid === stateZone && typeof j.revision === "number" && j.revision < since) stateRev = -1;
      // Not newer (a one-off fetch got there first, or the room changed):
      // a breath before asking again, so a mismatch can never spin.
      if (!applyState(zid, j)) await new Promise(r => setTimeout(r, 250));
      fails = 0;
    } catch (e) {
      if (pollTimer !== ctl) return;
      // Server or network trouble: back off (1.5s, 3s … 15s) and keep what we have.
      fails++;
      await new Promise(r => setTimeout(r, Math.min(15000, 1500 * fails)));
    } finally {
      clearTimeout(timer);
      ctl.signal.removeEventListener("abort", onCtl);
    }
  }
}
function startPolling() {
  if (pollTimer) return;
  pollTimer = new AbortController();
  pollLoop(pollTimer);
}
function stopPolling() {
  if (pollTimer) { pollTimer.abort(); pollTimer = null; }
}
// A new room: the waiting ask is for the old one, so start again at once.
function restartPolling() { if (!pollTimer) return; stopPolling(); startPolling(); }
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { stopPolling(); return; }
  // Discard the elapsed time accumulated while hidden before anything paints.
  // The poll stops when the page is hidden but the clock does not, so after a
  // long background the first tick would compute a position minutes ahead,
  // clamp it to the track length, and flash the bar at 100% with the full
  // duration in the readout until the refresh landed. Holding the last known
  // position instead is stale by the same amount but never absurd, and
  // startPolling() corrects it within one round trip.
  npSetBase(npBase);
  npWasPlaying = npPlaying();
  startPolling();
});

// Refresh when zone selector changes
const barZoneSel = document.getElementById("zone-select");
if (barZoneSel) barZoneSel.addEventListener("change", restartPolling);

// v1.7.81 gave the pill a backdrop-filter and stripped it here for the
// duration of every scroll, so the look and the frame rate could coexist.
// Both halves of that are gone as of v1.7.85: `saturate()` brightens whatever
// shows through the pill, so the filtered and unfiltered states never looked
// alike no matter how opaque the background got, and the pill is now
// translucent with no filter at all. Nothing styles .is-scrolling any more,
// so the listener that set it — a capture-phase document scroll handler with
// a 260ms settle timer — has gone with it rather than being left to toggle a
// class on every scroll frame for nothing.

// Boot — restore last known state instantly, then let the poll loop refresh it.
restoreTransportState();
startPolling();
