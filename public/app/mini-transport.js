/* ------------------------------------------------------------------ */
/*  Mini transport (now-playing bar at the bottom)                     */
/* ------------------------------------------------------------------ */
const bar       = document.getElementById("mini-transport");
const titleEl   = document.getElementById("mt-title");
const kickerEl  = document.getElementById("mt-kicker");
const artistEl  = document.getElementById("mt-artist");
const artEl     = document.getElementById("mt-art");
const btnPP     = document.getElementById("mt-playpause");
const btnZone   = document.getElementById("mt-zone");
const zonePop   = document.getElementById("mt-zone-popover");
const zoneList  = document.getElementById("mt-zone-list");
const progFill  = document.getElementById("mt-progress-fill");
const btnVol    = document.getElementById("mt-vol-btn");
const iconPlay  = document.getElementById("mt-icon-play");
const iconPause = document.getElementById("mt-icon-pause");
const iconVol   = document.getElementById("mt-icon-vol");
const iconMute  = document.getElementById("mt-icon-mute");
const volPop    = document.getElementById("mt-vol-popover");
const volSlider = document.getElementById("mt-vol-slider");
const volVal    = document.getElementById("mt-vol-value");
const volMinL   = document.getElementById("mt-vol-min");
const volMaxL   = document.getElementById("mt-vol-max");
const volWrap   = document.getElementById("mt-vol-sliderwrap");

// The selected zone's controllable output, looked up at READ time — never a
// mirrored global (same principle as window.__getCurrentNp below: mirrors
// strand stale state across zone switches and early-return render paths).
// type "incremental" means relative-only (no absolute scale): the sheets
// hide the slider/scale and the −/+ send relative nudges.
function currentVolOutput() {
  return (currentZone && (currentZone.outputs || []).find(o => o.volume)) || null;
}

// WebKit has no ::range-progress, so the accent fill left of the thumb is a
// gradient driven by --vol-fill; keep it in sync whenever value/min/max move.
function paintVolFill(slider) {
  if (!slider) return;
  const val = parseFloat(slider.value);
  if (!Number.isFinite(val)) return;   // empty/cleared attrs — leave the fill untouched
  const min = parseFloat(slider.min) || 0;
  const max = parseFloat(slider.max);
  const hi  = Number.isFinite(max) && max > min ? max : min + 100;
  const pct = ((val - min) / (hi - min)) * 100;
  slider.style.setProperty("--vol-fill", Math.max(0, Math.min(100, pct)) + "%");
}

// One writer for "both sliders + both readouts + both fills" — the mini bar
// and the NP sheet must always show the same number for the same output.
function syncVolumeUI(v) {
  volSlider.value = v;
  volVal.textContent = Math.round(v);
  if (npVolSlider) npVolSlider.value = v;
  if (npVolValue)  npVolValue.textContent = Math.round(v);
  paintVolFill(volSlider); paintVolFill(npVolSlider);
}
// The highest value this output will actually accept. soft_limit is Roon's
// own ceiling: it has always been sent (index.js) and nothing read it, so a
// request above it was clamped by Roon and the next poll dragged the thumb
// back down — indistinguishable from the jitter. Applied to the slider's own
// max as well as the −/+ buttons, or dragging could still ask for a value the
// zone will never report back, leaving the hold waiting on an echo that can
// never match.
function volCeiling(v) {
  const max = v.max != null ? v.max : 100;
  return v.soft_limit != null ? Math.min(max, v.soft_limit) : max;
}
// Scale labels show the output's real range (0/100 for number volumes,
// e.g. -80/0 for dB volumes) — matches what the slider actually spans.
function paintVolScale(minEl, maxEl, v) {
  if (minEl) minEl.textContent = Math.round(v.min != null ? v.min : 0);
  if (maxEl) maxEl.textContent = Math.round(volCeiling(v));
}

// Now-playing screen (Roon-style) elements — shared modal, driven by the
// same poll loop so there's a single source of truth.
const modalEl     = document.getElementById("album-modal");
const bigArt      = document.getElementById("modal-img");
const npTrack     = document.getElementById("np-track");
const npArtist    = document.getElementById("np-artist");
const npAlbum     = document.getElementById("np-album");
const npFormat    = document.getElementById("np-format");
const npSeek      = document.getElementById("np-seek");
const npCur       = document.getElementById("np-cur");
const npTot       = document.getElementById("np-tot");
const npPrev      = document.getElementById("np-prev");
const npPlayPause = document.getElementById("np-playpause");
const npNext      = document.getElementById("np-next");
const npIconPlay  = document.getElementById("np-icon-play");
const npIconPause = document.getElementById("np-icon-pause");
const npVolBtn    = document.getElementById("np-volbtn");
const npVolPopover= document.getElementById("np-vol-popover");
const npVolFixed  = document.getElementById("np-vol-fixed");
const npVolControls = document.getElementById("np-vol-controls");
const npVolValue  = document.getElementById("np-vol-value");
const npVolMinL   = document.getElementById("np-vol-min");
const npVolMaxL   = document.getElementById("np-vol-max");
const npVolWrap   = document.getElementById("np-vol-sliderwrap");
const npIconVol   = document.getElementById("np-icon-vol");
const npIconMute  = document.getElementById("np-icon-mute");
const npVolSlider = document.getElementById("np-vol-slider");
const npShuffle   = document.getElementById("np-shuffle");
const npLoop      = document.getElementById("np-loop");
const npLoopBadge = document.getElementById("np-loop-badge");

let currentZone = null;       // server-side zone state
let pollTimer   = null;
let lastNpImgKey = null;
let userIsDraggingVolume = false;

// The volume the user last ASKED for, held until the server echoes it back.
//
// The only guard used to be userIsDraggingVolume, set on the slider's `input`
// event and cleared on `change`. The −/+ buttons never touched it, so from the
// moment a tap painted 51 until Roon echoed 51 (a round trip, plus Roon's own
// ~1Hz event cadence), any poll tick wrote the PRE-tap 50 straight back over
// it: the thumb retreating after +, advancing after −. That is the reported
// "increase it and it jumps back, vice versa".
//
// Held, not locked: the hold ends the moment the echo matches, and lapses on
// its own after volEchoMs() so a change made in the Roon app or on a hardware
// knob still reaches the slider.
const VOL_ECHO_MS   = 2000;
let volPending      = null;   // value written locally, not yet echoed
let volPendingUntil = 0;      // Date.now() after which we stop believing it
let volPendingZone  = null;   // the zone it was written to — see settleVolumeHold
function holdVolume(v) {
  volPending = v;
  volPendingUntil = Date.now() + VOL_ECHO_MS;
  volPendingZone = currentZone && currentZone.zone_id;
}
function clearVolumeHold() { volPending = null; volPendingZone = null; }

// Retire the hold when it is spent. Called ONCE per poll, from renderZone.
//
// Kept separate from the predicate below because two render paths ask whether
// the volume is held (the mini bar, and the now-playing sheet), and a
// predicate that also retires the hold means whichever happens to ask first
// consumes it — a property neither call site can see.
function settleVolumeHold(serverValue, stepSz) {
  if (volPending === null) return;
  // A hold belongs to the zone it was taken for. Without this, tapping + on
  // one zone and switching to another inside the window left the new zone's
  // slider showing the OLD zone's number, and the next tap stepped from it —
  // sending a wildly wrong absolute value to a zone never touched.
  if (volPendingZone !== (currentZone && currentZone.zone_id)) { clearVolumeHold(); return; }
  if (Date.now() > volPendingUntil) { clearVolumeHold(); return; }
  // Match within half a step rather than exactly: Roon quantises to the
  // output's own grid, so an exact compare never matches on a dB output and
  // the hold runs its full 2s before snapping — the very symptom it exists
  // to remove.
  const tol = Math.max(0.001, (stepSz || 0) / 2);
  if (serverValue != null && Math.abs(serverValue - volPending) < tol) clearVolumeHold();
}
// Pure — safe to call from any render path, in any order, any number of times.
function volumeHeld() {
  if (userIsDraggingVolume) return true;
  if (volPending === null) return false;
  return Date.now() <= volPendingUntil;
}

let userIsDraggingSeek   = false;
let npLen = 0;                // current track length (s)
// The position is a BASE plus elapsed wall-clock, not a counter. It used to be
// `npPos += 1` on a 1000ms interval while the 1500ms poll assigned the server's
// value unconditionally: two unsynchronised timers writing one variable,
// realigning every 3s, so the bar hopped forward a second, snapped back a
// second, then caught up two. That beat IS the jerkiness. Wall-clock also
// survives a late or throttled timer, which a counter cannot.
// Same shape display.js has always used (seekBase / seekBaseAt).
let npBase   = 0;             // last known position (s)
let npBaseAt = 0;             // Date.now() when npBase was set
let npWasPlaying = false;     // play state over the interval just elapsed
let npSeekHold = 0;           // ignore server re-baselining until this time
// The last position the server reported, to tell a MOVING feed from a stuck
// one. See the reconcile in refreshTransport for why a repeated value must
// not be treated as news.
let npPrevSrv = null;
function npPlaying() {
  return !!currentZone && (currentZone.state === "playing" || currentZone.state === "loading");
}
// Current position: the base, plus real time since it was taken.
function npNow() {
  const pos = npBase + (npPlaying() ? (Date.now() - npBaseAt) / 1000 : 0);
  return npLen > 0 ? Math.max(0, Math.min(npLen, pos)) : Math.max(0, pos);
}
function npSetBase(seconds) {
  npBase = Math.max(0, seconds || 0);
  npBaseAt = Date.now();
}

// Tap the album name on the now-playing screen to open that album's detail.
// We must search the index first to find the album's offset — the now-playing
// data alone doesn't carry it, and /api/album requires a valid numeric offset.
if (npAlbum) {
  npAlbum.addEventListener("click", async () => {
    const np = currentZone && currentZone.now_playing;
    if (!np || typeof window.__openAlbum !== "function") return;
    const albumTitle = np.line3 || "";
    const artist     = np.line2 || "";
    if (!albumTitle) return;
    const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    // The album the playing track is actually from, by the track's own id
    // (v0.6.24): a Qobuz or Tidal album you started opens as itself, not the
    // copy of the same record on your drive that a search by name finds first.
    try {
      const r0 = await fetch("/api/album/now-playing?zone=" + encodeURIComponent(currentZone.zone_id), { cache: "no-store" });
      if (r0.ok) {
        const j0 = await r0.json();
        if (j0.album && typeof j0.album.offset === "number") { window.__openAlbum(j0.album, { source: "search" }); return; }
      }
    } catch (e) { /* the search below */ }
    try {
      const r = await fetch("/api/search?q=" + encodeURIComponent(albumTitle) + "&limit=20");
      if (r.ok) {
        const j  = await r.json();
        const rs = j.results || [];
        // Whole credited NAME agreement, not "contains the artist's first
        // word" (which opened Bonnie "Prince" Billy's album for Prince) and
        // not whole-string equality either — the now-playing line is the
        // track artist, so "Prince" must still match "Prince & The
        // Revolution". Split both sides on the credit separators and look
        // for a shared name.
        const names = (s) => (s || "")
          .split(/ \/ |\/| feat\.? | featuring | ft\.? |,| & | \+ | and /i)
          .map(x => norm(x)).filter(Boolean);
        const wanted = names(artist);
        const shares = (sub) => {
          const got = names(sub);
          return wanted.some(w => got.includes(w));
        };
        const match =
          rs.find(a => norm(a.title) === norm(albumTitle) &&
                       (!wanted.length || shares(a.subtitle))) ||
          (!wanted.length ? rs.find(a => norm(a.title) === norm(albumTitle)) : null);
        if (match && typeof match.offset === "number") {
          window.__openAlbum(match, { source: "search" }); return;
        }
      }
    } catch (e) { /* sessionStorage/JSON parse error — fall through to "not indexed" toast */ }
    if (window.__showToast) window.__showToast("Album not yet indexed — try again in a moment");
  });
}

// Is the Roon-style now-playing screen currently on view?
function onNowPlayingScreen() {
  return modalEl
    && !modalEl.classList.contains("hidden")
    && modalEl.classList.contains("np-mode")
    && modalEl.classList.contains("tab-album");
}

function fmtTime(secs) {
  secs = Math.max(0, Math.floor(secs || 0));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m + ":" + String(s).padStart(2, "0");
}

function barZoneId() {
  // Read from the existing zone selector in the topbar
  const sel = document.getElementById("zone-select");
  return sel && sel.value || null;
}

let lastTransportSig = "";
function saveTransportState(zone) {
  if (!zone || !zone.now_playing) return;
  const np = zone.now_playing;
  // The 1.5s poll calls this every tick — synchronous localStorage writes
  // are only worth paying when the persisted fields actually changed.
  const sig = [np.line1, np.line2, np.line3, np.image_key, zone.state].join("|");
  if (sig === lastTransportSig) return;
  lastTransportSig = sig;
  try {
    localStorage.setItem("rra-transport", JSON.stringify({
      line1: np.line1 || "", line2: np.line2 || "", line3: np.line3 || "",
      image_key: np.image_key || "", state: zone.state || "stopped"
    }));
  } catch (e) { /* localStorage optional — transport bar persistence is best-effort */ }
}

// The cover for the playing track. Hidden rather than broken when the zone
// reports no art (a stream, a zone mid-handshake): an empty <img> draws the
// browser's broken-image glyph, which looks like a fault.
function paintTransportArt(imageKey) {
  if (!artEl) return;
  if (imageKey) {
    const src = `/api/image/${encodeURIComponent(imageKey)}?size=120`;
    // Guarded: assigning the same src restarts the request on some browsers,
    // and this runs off a 1.5s poll.
    if (artEl.getAttribute("src") !== src) artEl.setAttribute("src", src);
    artEl.classList.remove("hidden");
  } else {
    artEl.removeAttribute("src");
    artEl.classList.add("hidden");
  }
}

function restoreTransportState() {
  try {
    const saved = JSON.parse(localStorage.getItem("rra-transport") || "null");
    if (!saved || !saved.line1) return;
    titleEl.textContent  = saved.line1;
    const sub = [saved.line2, saved.line3].filter(Boolean).join(" · ");
    artistEl.textContent = sub || "—";
    paintTransportArt(saved.image_key);
    bar.classList.remove("hidden");
  } catch (e) { /* corrupt localStorage — transport bar stays hidden, no action needed */ }
}
