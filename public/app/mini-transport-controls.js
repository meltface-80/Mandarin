/* The mini transport (app/mini-transport.js), 4 of 5: shuffle, repeat and radio, the volume written, and the controls wired. */
// Shuffle / repeat / Roon Radio. Mirrors control(): fire, then re-poll, so the
// buttons show what the ZONE reports rather than what we asked for — a change
// the Core rejects must not leave a button lit.
async function changeZoneSettings(patch) {
  if (!currentZone) return;
  try {
    const r = await fetch("/api/zone-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ zone_or_output_id: currentZone.zone_id }, patch))
    });
    const j = await r.json().catch(() => ({}));
    // Shuffle and repeat only — Roon Radio moved to Settings → Playback in
    // v1.7.71, where the exclusivity rule announces itself by the two
    // switches moving. So a failure is the only thing left to report here.
    if (!r.ok) {
      console.warn("zone-settings failed:", j.error || r.status);
      if (window.__showToast) window.__showToast(j.error || "Could not change that", "error");
    }
  } catch (e) {
    // Network blip. The finally below still re-polls, so the buttons resync.
  } finally {
    setTimeout(fetchState, 200);
  }
}

// The single choke point for every ABSOLUTE volume write — drag, release and
// the −/+ buttons — so the hold cannot be forgotten at one of them the way it
// was for the buttons. (The incremental branch of stepVolume sends a RELATIVE
// nudge and deliberately does not come through here; there is no absolute
// value to hold.)
//
// Serialised and latest-wins. These are absolute writes issued fire-and-forget
// over separate connections, so a drag from 40 to 60 could emit 45, 52, 60 and
// have 52 arrive last — leaving the zone at 52 and the poll then faithfully
// dragging the thumb backwards. One in flight at a time, with only the newest
// value queued behind it, makes that impossible.
let volInFlight = false, volQueued = null;

// The zone id travels WITH the value. It used to be read off currentZone
// inside the loop, which is after an await on every iteration but the first —
// so switching zones mid-drag posted the queued value to the zone just
// switched TO, and a switch to nothing threw a TypeError the catch swallowed
// as a network blip.
async function postVolume(zoneId, value) {
  // Bounded, because neither this fetch nor /api/volume had any timeout: the
  // server only answers once Roon's change_volume callback fires, and if the
  // Core drops mid-call that promise never settles. volInFlight would then
  // stay true for the lifetime of the page and every later write would queue
  // behind it forever — volume dead until reload.
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), 5000) : null;
  try {
    await fetch("/api/volume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zone_or_output_id: zoneId, value }),
      signal: ctl ? ctl.signal : undefined
    });
  } finally {
    if (t) clearTimeout(t);
  }
}

async function setVolume(value) {
  if (!currentZone) return;
  const zoneId = currentZone.zone_id;
  holdVolume(value);                         // covers the drag AND the buttons
  if (volInFlight) { volQueued = { zoneId, value }; return; }
  volInFlight = true;
  let job = { zoneId, value };
  while (job) {
    // Inside the loop, so one failed write does not abandon a value already
    // queued and already painted — the user would be looking at a number
    // nothing had been told about.
    try { await postVolume(job.zoneId, job.value); }
    catch (e) { /* blip or 5s timeout — the poll resyncs once the hold expires */ }
    job = volQueued; volQueued = null;
  }
  volInFlight = false;
  // Pull the echo rather than waiting up to 1.5s for it — the same pattern
  // control() and toggleMute() use (they wait 200ms and 150ms). Coalesced:
  // stepVolume has no debounce, so four fast taps would otherwise schedule
  // four refreshes all landing within a few hundred ms of each other.
  scheduleEchoFetch();
}
let volEchoTimer = null;
function scheduleEchoFetch() {
  clearTimeout(volEchoTimer);
  volEchoTimer = setTimeout(fetchState, 200);
}
async function toggleMute() {
  if (!currentZone) return;
  const muted = (currentZone.outputs || []).some(o => o.is_muted);
  try {
    await fetch("/api/volume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zone_or_output_id: currentZone.zone_id, mute: !muted })
    });
    setTimeout(fetchState, 150);
  } catch (e) { /* mute is best-effort; fetchState() already scheduled above */ }
}

// Wire controls
btnPP  .addEventListener("click", () => control("playpause"));

// Now-playing screen transport (mirrors the mini bar's controls)
if (npPlayPause) npPlayPause.addEventListener("click", () => control("playpause"));
if (npPrev)      npPrev.addEventListener("click", () => control("previous"));
if (npNext)      npNext.addEventListener("click", () => control("next"));

// Playback modes. Each reads the zone's CURRENT value at click time (not a
// mirrored local flag) and sends the concrete state it wants.
if (npShuffle) npShuffle.addEventListener("click", () => changeZoneSettings({ shuffle: !zoneModes().shuffle }));
if (npLoop)    npLoop.addEventListener("click", () => changeZoneSettings({ loop: LOOP_NEXT[zoneModes().loop] }));

// Volume popover: tap the speaker to reveal the slider (or the "fixed" note).
if (npVolBtn && npVolPopover) {
  npVolBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const dp = document.getElementById("np-device-popover");
    if (dp) dp.classList.add("hidden");
    const willShow = npVolPopover.classList.contains("hidden");
    npVolPopover.classList.toggle("hidden", !willShow);
    npVolBtn.setAttribute("aria-expanded", String(willShow));
  });
}

// Shut both now-playing popovers (volume, device) and reset their buttons.
function closeNpPopovers() {
  if (npVolPopover) npVolPopover.classList.add("hidden");
  if (npVolBtn) npVolBtn.setAttribute("aria-expanded", "false");
  const dp = document.getElementById("np-device-popover");
  const db = document.getElementById("np-device");
  if (dp) dp.classList.add("hidden");
  if (db) db.setAttribute("aria-expanded", "false");
}

// Close the now-playing popovers when tapping outside the controls row.
document.addEventListener("click", (e) => {
  if (e.target.closest && e.target.closest(".np-secondary")) return;
  closeNpPopovers();
});

// Now-playing scrubber: show the dragged time live, seek on release.
if (npSeek) {
  npSeek.addEventListener("input", () => {
    userIsDraggingSeek = true;
    npCur.textContent = fmtTime(parseFloat(npSeek.value));
    paintSeek(parseFloat(npSeek.value));
    paintBarProgress();
  });
  npSeek.addEventListener("change", () => {
    const target = parseFloat(npSeek.value);
    userIsDraggingSeek = false;
    seek(target);         // sets the base + hold synchronously, then posts
    paintSeek(target);
    paintBarProgress();   // the thumb and the mini bar's line must land together
  });
}

// Now-playing volume slider (kept in sync with the mini bar)
let npVolDebounce = null;
if (npVolSlider) {
  npVolSlider.addEventListener("input", () => {
    userIsDraggingVolume = true;
    const v = parseFloat(npVolSlider.value);
    syncVolumeUI(v);
    clearTimeout(npVolDebounce);
    npVolDebounce = setTimeout(() => setVolume(v), 90);
  });
  npVolSlider.addEventListener("change", () => {
    userIsDraggingVolume = false;
    // Drop the queued mid-drag write: it holds an older value and would land
    // AFTER this final one, re-sending a position the user has moved past.
    clearTimeout(npVolDebounce);
    setVolume(parseFloat(npVolSlider.value));
  });
}

// Paint the progress bar from the clock, four times a second.
//
// It PAINTS, it does not advance — npNow() derives the position from the base
// and elapsed time, so a late or throttled tick cannot make the bar drift, and
// missing ticks entirely just means it repaints correctly when it resumes.
// 250ms matches display.js; rAF would be waste, since the fill moves about a
// pixel and a half per second.
setInterval(() => {
  // npPlaying() already null-checks currentZone, and no now_playing implies
  // npLen === 0, so those two clauses are covered by what remains.
  if (userIsDraggingSeek || !npPlaying() || npLen <= 0) return;
  const pos = npNow();                 // already clamped to [0, npLen]
  paintBarProgress(pos);
  if (onNowPlayingScreen()) {
    npSeek.value = pos;
    paintSeek(pos);
    npCur.textContent = fmtTime(pos);
  }
}, 250);

// Let the modal code refresh bar visibility + the now-playing screen on open,
// tab switch, and close.
window.__refreshTransport = () => { refreshVisibility(); updateNpScreen(); };

// Live getter for the share button: reads currentZone directly at call time
// instead of relying on a mirrored global kept in sync by convention. This
// is the third fix for "share card shows a stale album" (v1.5.89, v1.5.90,
// and the Queue-tab case fixed alongside this getter) — a read-time getter
// makes the whole class of "forgot to update the mirror" bug impossible.
window.__getCurrentNp = () => currentZone && currentZone.now_playing;

btnVol.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!currentZone) { btnZone.click(); return; }
  if (!currentVolOutput()) { if (window.__showToast) window.__showToast("This zone's volume is set on the device itself"); return; }
  volPop.classList.toggle("hidden");
  btnVol.setAttribute("aria-expanded", !volPop.classList.contains("hidden"));
});
// Long-press the speaker icon to mute (kept simple: shift-click also mutes on desktop)
btnVol.addEventListener("dblclick", (e) => {
  e.preventDefault();
  toggleMute();
});

let volDebounce = null;
volSlider.addEventListener("input", () => {
  userIsDraggingVolume = true;
  const v = parseFloat(volSlider.value);
  syncVolumeUI(v);
  clearTimeout(volDebounce);
  volDebounce = setTimeout(() => setVolume(v), 90);
});
volSlider.addEventListener("change", () => {
  userIsDraggingVolume = false;
  clearTimeout(volDebounce);   // see the NP slider's change handler
  setVolume(parseFloat(volSlider.value));
});

// Close volume popover when clicking outside it
document.addEventListener("click", (e) => {
  if (volPop.classList.contains("hidden")) return;
  if (volPop.contains(e.target) || btnVol.contains(e.target)) return;
  volPop.classList.add("hidden");
  btnVol.setAttribute("aria-expanded", "false");
});
